import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// P0-2 精确响应缓存 —— 键设计 / 多账号隔离 / 准入白名单 / TTL / 统计。
//
// ⚠️ 隔离要点：src/lib/dataDir.js 的 `DATA_DIR` 是**模块加载时求值**的常量。
//    responseCache.js → @/lib/db/index.js → paths.js 这条链会在 import 时锁定 DB 路径，
//    因此必须先设 process.env.DATA_DIR 再**动态 import**，否则会读真实用户库。

let tempDir;
let dbDir;
let getAdapter;
let cacheRepo;
let isCacheEligible;
const originalDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-rc-"));
  process.env.DATA_DIR = tempDir;
  dbDir = path.join(tempDir, "db");
  if (global._dbAdapter) {
    try { global._dbAdapter.instance?.close?.(); } catch {}
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  ({ getAdapter } = await import("@/lib/db/driver.js"));
  cacheRepo = await import("@/lib/db/repos/cacheRepo.js");
  ({ isCacheEligible } = await import("@/lib/../../open-sse/handlers/chatCore/responseCache.js"));
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  if (global._dbAdapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("computeCacheKey（键设计）", () => {
  const base = { connectionId: "c1", provider: "openai", model: "gpt-4o", body: { messages: [{ role: "user", content: "hi" }] } };

  it("相同输入得到相同键（确定性）", () => {
    expect(cacheRepo.computeCacheKey(base)).toBe(cacheRepo.computeCacheKey({ ...base }));
  });

  it("body 键顺序不同但语义相同 → 同键（stableStringify）", () => {
    const a = cacheRepo.computeCacheKey({ ...base, body: { a: 1, b: 2 } });
    const b = cacheRepo.computeCacheKey({ ...base, body: { b: 2, a: 1 } });
    expect(a).toBe(b);
  });

  it("嵌套对象键顺序也归一", () => {
    const a = cacheRepo.computeCacheKey({ ...base, body: { x: { p: 1, q: 2 } } });
    const b = cacheRepo.computeCacheKey({ ...base, body: { x: { q: 2, p: 1 } } });
    expect(a).toBe(b);
  });

  it("数组顺序不同 → 不同键（顺序有意义）", () => {
    const a = cacheRepo.computeCacheKey({ ...base, body: { l: [1, 2] } });
    const b = cacheRepo.computeCacheKey({ ...base, body: { l: [2, 1] } });
    expect(a).not.toBe(b);
  });

  it("connectionId 不同 → 不同键（防跨账号串答案，Critic 修正重点）", () => {
    const a = cacheRepo.computeCacheKey({ ...base, connectionId: "acct-A" });
    const b = cacheRepo.computeCacheKey({ ...base, connectionId: "acct-B" });
    expect(a).not.toBe(b);
  });

  it("sourceFormat 不同 → 不同键（防跨格式串答案，Critic 修正重点）", () => {
    // 同一个 body 打到 /v1/chat/completions 与 /v1/messages，来源格式不同、
    // 响应体格式也不同，绝不能共用缓存。
    const a = cacheRepo.computeCacheKey({ ...base, sourceFormat: "openai" });
    const b = cacheRepo.computeCacheKey({ ...base, sourceFormat: "claude" });
    expect(a).not.toBe(b);
  });

  it("sourceFormat 缺省与显式空串等价（都是缺失维度）", () => {
    const a = cacheRepo.computeCacheKey({ ...base });
    const b = cacheRepo.computeCacheKey({ ...base, sourceFormat: "" });
    expect(a).toBe(b);
  });

  it("provider / model 不同 → 不同键", () => {
    expect(cacheRepo.computeCacheKey(base)).not.toBe(cacheRepo.computeCacheKey({ ...base, provider: "anthropic" }));
    expect(cacheRepo.computeCacheKey(base)).not.toBe(cacheRepo.computeCacheKey({ ...base, model: "gpt-4o-mini" }));
  });

  it("body 不同 → 不同键", () => {
    expect(cacheRepo.computeCacheKey(base)).not.toBe(
      cacheRepo.computeCacheKey({ ...base, body: { messages: [{ role: "user", content: "hello" }] } })
    );
  });

  it("输出为 64 位十六进制 sha256", () => {
    expect(cacheRepo.computeCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isCacheEligible（准入白名单）", () => {
  it("默认关闭时一律不缓存", () => {
    expect(isCacheEligible({ body: {}, stream: false, enabled: false })).toBe(false);
  });

  it("开启 + 显式 temperature=0 + 非流式 → 可缓存", () => {
    expect(isCacheEligible({ body: { messages: [], temperature: 0 }, stream: false, enabled: true })).toBe(true);
  });

  it("⚠️ temperature **缺省** → 不可缓存（OpenAI 缺省值是 1，非确定性）", () => {
    expect(isCacheEligible({ body: { messages: [] }, stream: false, enabled: true })).toBe(false);
  });

  it("temperature=null → 不可缓存", () => {
    expect(isCacheEligible({ body: { temperature: null }, stream: false, enabled: true })).toBe(false);
  });

  it("temperature 为字符串 \"0\" → 可缓存（宽松数值解析）", () => {
    expect(isCacheEligible({ body: { temperature: "0" }, stream: false, enabled: true })).toBe(true);
  });

  it("temperature>0 → 不可缓存（输出非确定）", () => {
    expect(isCacheEligible({ body: { temperature: 0.7 }, stream: false, enabled: true })).toBe(false);
  });

  it("temperature 为非法字符串 → 不可缓存", () => {
    expect(isCacheEligible({ body: { temperature: "hot" }, stream: false, enabled: true })).toBe(false);
  });

  it("流式请求 → 不可缓存", () => {
    expect(isCacheEligible({ body: { temperature: 0 }, stream: true, enabled: true })).toBe(false);
  });

  it("带 tools → 不可缓存", () => {
    expect(isCacheEligible({ body: { temperature: 0, tools: [{ type: "function" }] }, stream: false, enabled: true })).toBe(false);
  });

  it("tools 为空数组 → 仍可缓存（无实际工具）", () => {
    expect(isCacheEligible({ body: { temperature: 0, tools: [] }, stream: false, enabled: true })).toBe(true);
  });

  it("带 tool_choice → 不可缓存", () => {
    expect(isCacheEligible({ body: { temperature: 0, tool_choice: "auto" }, stream: false, enabled: true })).toBe(false);
  });
});

describe("cacheRepo 读写 / TTL / 统计（真实 DB，隔离）", () => {
  it("隔离自检：使用临时 DATA_DIR，而非用户真实库", () => {
    expect(dbDir.startsWith(tempDir)).toBe(true);
    expect(dbDir).not.toContain("Roaming");
  });

  it("写后读回（JSON 往返）", async () => {
    const payload = { id: "chatcmpl-1", choices: [{ message: { role: "assistant", content: "你好" } }] };
    await cacheRepo.setCachedResponse({
      key: "k1", provider: "openai", model: "gpt-4o", connectionId: "c1", response: payload, ttlSeconds: 3600,
    });
    const back = await cacheRepo.getCachedResponse("k1");
    expect(back).toEqual(payload);
  });

  it("未命中返回 null", async () => {
    expect(await cacheRepo.getCachedResponse("does-not-exist")).toBeNull();
  });

  it("命中累加 hits 计数", async () => {
    await cacheRepo.setCachedResponse({ key: "k2", provider: "p", model: "m", connectionId: "c", response: { a: 1 }, ttlSeconds: 3600 });
    await cacheRepo.getCachedResponse("k2");
    await cacheRepo.getCachedResponse("k2");
    const stats = await cacheRepo.getResponseCacheStats();
    expect(stats.hits).toBeGreaterThanOrEqual(2);
  });

  it("过期条目读不到，并被惰性删除", async () => {
    const db = await getAdapter();
    db.run(
      `INSERT INTO responseCache (key, provider, model, connectionId, response, createdAt, expiresAt, hits, lastHitAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      ["k-expired", "p", "m", "c", JSON.stringify({ old: true }), new Date(Date.now() - 7200_000).toISOString(), new Date(Date.now() - 3600_000).toISOString()]
    );
    expect(await cacheRepo.getCachedResponse("k-expired")).toBeNull();
    const rows = db.all(`SELECT key FROM responseCache WHERE key = 'k-expired'`);
    expect(rows).toHaveLength(0);
  });

  it("同键覆盖更新（ON CONFLICT）", async () => {
    await cacheRepo.setCachedResponse({ key: "k3", provider: "p", model: "m", connectionId: "c", response: { v: 1 }, ttlSeconds: 3600 });
    await cacheRepo.setCachedResponse({ key: "k3", provider: "p", model: "m", connectionId: "c", response: { v: 2 }, ttlSeconds: 3600 });
    expect(await cacheRepo.getCachedResponse("k3")).toEqual({ v: 2 });
  });

  it("TTL 被夹到合理区间（过小抬到 60s，过大压到 7d）", async () => {
    const db = await getAdapter();
    await cacheRepo.setCachedResponse({ key: "k-ttl-min", provider: "p", model: "m", connectionId: "c", response: { a: 1 }, ttlSeconds: 1 });
    const minRow = db.get(`SELECT expiresAt FROM responseCache WHERE key = 'k-ttl-min'`);
    const minDelta = Date.parse(minRow.expiresAt) - Date.now();
    expect(minDelta).toBeGreaterThan(50_000);
    expect(minDelta).toBeLessThan(70_000);

    await cacheRepo.setCachedResponse({ key: "k-ttl-max", provider: "p", model: "m", connectionId: "c", response: { a: 1 }, ttlSeconds: 999_999_999 });
    const maxRow = db.get(`SELECT expiresAt FROM responseCache WHERE key = 'k-ttl-max'`);
    const maxDelta = Date.parse(maxRow.expiresAt) - Date.now();
    expect(maxDelta).toBeLessThanOrEqual(7 * 24 * 3600 * 1000 + 5000);
  });

  it("缺 key 时写入返回 false（不抛）", async () => {
    expect(await cacheRepo.setCachedResponse({ provider: "p", model: "m", response: {} })).toBe(false);
  });

  it("purgeExpiredCache 清理过期条目并返回条数", async () => {
    const db = await getAdapter();
    db.run(
      `INSERT INTO responseCache (key, provider, model, connectionId, response, createdAt, expiresAt, hits, lastHitAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      ["k-purge", "p", "m", "c", "{}", new Date().toISOString(), new Date(Date.now() - 1000).toISOString()]
    );
    const n = await cacheRepo.purgeExpiredCache();
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("clearResponseCache 清空并返回条数", async () => {
    const n = await cacheRepo.clearResponseCache();
    expect(typeof n).toBe("number");
    const stats = await cacheRepo.getResponseCacheStats();
    expect(stats.total).toBe(0);
    expect(stats.live).toBe(0);
  });

  it("getResponseCacheStats 区分 total 与 live", async () => {
    const db = await getAdapter();
    await cacheRepo.setCachedResponse({ key: "k-live", provider: "p", model: "m", connectionId: "c", response: {}, ttlSeconds: 3600 });
    db.run(
      `INSERT INTO responseCache (key, provider, model, connectionId, response, createdAt, expiresAt, hits, lastHitAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
      ["k-old", "p", "m", "c", "{}", new Date().toISOString(), new Date(Date.now() - 1000).toISOString()]
    );
    const stats = await cacheRepo.getResponseCacheStats();
    expect(stats.total).toBe(2);
    expect(stats.live).toBe(1);
  });
});
