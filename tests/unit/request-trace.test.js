import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// P1-2 执行轨迹（traceId + attemptIndex）专项单测。
// 契约：两个字段都是**可选**的 —— 老调用方不传时，产出对象与改动前逐字段一致。
//
// ⚠️ 为什么全用动态 import：
//   ① 本文件含真实 DB 往返断言，而 dataDir.js 的 DATA_DIR 是模块加载时求值的常量，
//      必须在设置 DATA_DIR **之后**再加载 DB 模块链，否则会读真实用户库；
//   ② requestDetail.js → @/lib/usageDb.js → DB 链，静态 import 会提前锁定路径。
//
// ⚠️ 为什么必须有 DB 往返断言：
//   requestDetailsRepo.flushToDatabase 用**显式字段白名单**组装落库对象，
//   只测 buildRequestDetail 无法发现"字段被白名单静默丢掉"。

let tempDir;
let dbDir;
let buildRequestDetail;
let requestDetailsRepo;

const originalDataDir = process.env.DATA_DIR;
const originalEnableLogs = process.env.ENABLE_REQUEST_LOGS;

const BASE = {
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  connectionId: "conn-1",
  latency: { ttft: 12, total: 200 },
  tokens: { prompt_tokens: 10, completion_tokens: 5 },
  request: { messages: [], model: "claude-sonnet-4-5", stream: false },
};

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-trace-"));
  process.env.DATA_DIR = tempDir;
  // 观测默认关闭（settings.enableObservability 默认 false），此时 saveRequestDetail
  // 会直接 return、不落库。本测试要验证的是「落库白名单」，故显式打开。
  process.env.ENABLE_REQUEST_LOGS = "true";
  dbDir = path.join(tempDir, "db");
  if (global._dbAdapter) {
    try { global._dbAdapter.instance?.close?.(); } catch {}
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  ({ buildRequestDetail } = await import("@/lib/../../open-sse/handlers/chatCore/requestDetail.js"));
  requestDetailsRepo = await import("@/lib/db/repos/requestDetailsRepo.js");
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  if (global._dbAdapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalEnableLogs === undefined) delete process.env.ENABLE_REQUEST_LOGS;
  else process.env.ENABLE_REQUEST_LOGS = originalEnableLogs;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("buildRequestDetail 含执行轨迹（traceId / attemptIndex）", () => {
  it("传入 traceId 时进入详情对象", () => {
    const d = buildRequestDetail({ ...BASE, traceId: "trace-abc", attemptIndex: 0 });
    expect(d.traceId).toBe("trace-abc");
    expect(d.attemptIndex).toBe(0);
  });

  it("attemptIndex=0 不被误当 falsy 丢弃", () => {
    const d = buildRequestDetail({ ...BASE, traceId: "t", attemptIndex: 0 });
    expect(d.attemptIndex).toBe(0);
  });

  it("重试链：同 traceId 不同 attemptIndex 可区分", () => {
    const first = buildRequestDetail({ ...BASE, traceId: "T1", attemptIndex: 0 });
    const second = buildRequestDetail({ ...BASE, traceId: "T1", attemptIndex: 1 });
    const third = buildRequestDetail({ ...BASE, traceId: "T1", attemptIndex: 2 });
    expect(first.traceId).toBe(second.traceId);
    expect(second.traceId).toBe(third.traceId);
    expect([first.attemptIndex, second.attemptIndex, third.attemptIndex]).toEqual([0, 1, 2]);
  });

  it("不传时两个字段为 undefined（向后兼容，不污染历史记录）", () => {
    const d = buildRequestDetail(BASE);
    expect(d.traceId).toBeUndefined();
    expect(d.attemptIndex).toBeUndefined();
    expect("traceId" in d).toBe(true); // 键存在但值为 undefined，JSON 序列化时会被丢弃
  });

  it("非法 attemptIndex（NaN/字符串）被规整为 undefined", () => {
    expect(buildRequestDetail({ ...BASE, attemptIndex: NaN }).attemptIndex).toBeUndefined();
    expect(buildRequestDetail({ ...BASE, attemptIndex: "3" }).attemptIndex).toBeUndefined();
    expect(buildRequestDetail({ ...BASE, attemptIndex: Infinity }).attemptIndex).toBeUndefined();
  });

  it("与 route_reason 共存互不影响", () => {
    const d = buildRequestDetail({
      ...BASE,
      traceId: "T9",
      attemptIndex: 1,
      route_reason: { clientModel: "claude-sonnet-4-5", provider: "anthropic" },
    });
    expect(d.traceId).toBe("T9");
    expect(d.attemptIndex).toBe(1);
    expect(d.route_reason.provider).toBe("anthropic");
  });

  it("overrides 可覆盖 traceId（保持既有 overrides 语义）", () => {
    const d = buildRequestDetail({ ...BASE, traceId: "orig" }, { traceId: "overridden" });
    expect(d.traceId).toBe("overridden");
  });

  it("JSON 序列化后不带 undefined 字段", () => {
    const d = JSON.parse(JSON.stringify(buildRequestDetail(BASE)));
    expect(Object.prototype.hasOwnProperty.call(d, "traceId")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(d, "attemptIndex")).toBe(false);
    const d2 = JSON.parse(JSON.stringify(buildRequestDetail({ ...BASE, traceId: "T", attemptIndex: 2 })));
    expect(d2.traceId).toBe("T");
    expect(d2.attemptIndex).toBe(2);
  });
});

describe("落库往返（真实 DB，隔离）—— 防止字段被白名单静默丢弃", () => {
  it("隔离自检：使用临时 DATA_DIR", () => {
    expect(dbDir.startsWith(tempDir)).toBe(true);
    expect(dbDir).not.toContain("Roaming");
  });

  it("traceId / attemptIndex 经 saveRequestDetail 落库后能原样读回", async () => {
    const id = `trace-rt-${Date.now()}`;
    await requestDetailsRepo.saveRequestDetail({
      ...buildRequestDetail({ ...BASE, traceId: "trace-roundtrip-2", attemptIndex: 1 }),
      id,
    });

    await requestDetailsRepo.__test__.flushToDatabase();

    const res = await requestDetailsRepo.getRequestDetails({ page: 1, pageSize: 50 });
    const hit = res.details.find((d) => d.id === id);
    expect(hit).toBeTruthy();
    expect(hit.traceId).toBe("trace-roundtrip-2");
    expect(hit.attemptIndex).toBe(1);
  });

  it("cache 命中标记（cached / cacheKey）同样能落库读回", async () => {
    const id = `cache-rt-${Date.now()}`;
    await requestDetailsRepo.saveRequestDetail({
      ...buildRequestDetail({ ...BASE }, { cached: true, cacheKey: "deadbeef" }),
      id,
    });
    await requestDetailsRepo.__test__.flushToDatabase();

    const res = await requestDetailsRepo.getRequestDetails({ page: 1, pageSize: 50 });
    const hit = res.details.find((d) => d.id === id);
    expect(hit).toBeTruthy();
    expect(hit.cached).toBe(true);
    expect(hit.cacheKey).toBe("deadbeef");
  });

  it("不传 trace 的旧记录落库后仍无 trace 字段（向后兼容）", async () => {
    const id = `legacy-rt-${Date.now()}`;
    await requestDetailsRepo.saveRequestDetail({ ...buildRequestDetail(BASE), id });
    await requestDetailsRepo.__test__.flushToDatabase();

    const res = await requestDetailsRepo.getRequestDetails({ page: 1, pageSize: 50 });
    const hit = res.details.find((d) => d.id === id);
    expect(hit).toBeTruthy();
    expect(hit.traceId).toBeUndefined();
    expect(hit.attemptIndex).toBeUndefined();
  });
});
