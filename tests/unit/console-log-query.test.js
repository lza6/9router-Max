import { describe, it, expect, beforeEach } from "vitest";
import {
  initConsoleLogCapture,
  getConsoleLogs,
  clearConsoleLogs,
  queryConsoleLogs,
} from "@/lib/consoleLogBuffer";

// P1-3 日志查询/过滤/聚合 专项单测。
// 注意：本模块会 patch console，故唯一一次 init 后按需 clear。

initConsoleLogCapture();

function seed() {
  clearConsoleLogs();
  console.log("[CHAT] plain line alpha");
  console.info("[TOKEN] info line beta");
  console.warn("[CHAT] warn line gamma");
  console.error("[ERROR] boom delta");
  console.error("[ERROR] boom epsilon");
}

describe("queryConsoleLogs（内存谓词过滤，不依赖 FTS5）", () => {
  beforeEach(() => {
    seed();
  });

  it("无参数时返回全部，且与 getConsoleLogs 一致", () => {
    const r = queryConsoleLogs();
    expect(r.total).toBe(5);
    expect(r.matched).toBe(5);
    expect(r.logs).toEqual(getConsoleLogs());
  });

  it("levelCounts 按级别聚合", () => {
    const r = queryConsoleLogs();
    expect(r.levelCounts.error).toBe(2);
    expect(r.levelCounts.warn).toBe(1);
    expect(r.levelCounts.info).toBe(1);
    expect(r.levelCounts.log).toBe(1);
  });

  it("level=error 只返回 error 行", () => {
    const r = queryConsoleLogs({ level: "error" });
    expect(r.matched).toBe(2);
    expect(r.logs.every((l) => l.includes("boom"))).toBe(true);
  });

  it("level 支持逗号分隔多值", () => {
    const r = queryConsoleLogs({ level: "error,warn" });
    expect(r.matched).toBe(3);
  });

  it("非法 level 被忽略而非报错（容忍脏输入）", () => {
    const r = queryConsoleLogs({ level: "not-a-level" });
    expect(r.matched).toBe(5);
  });

  it("q 大小写不敏感子串匹配", () => {
    const lower = queryConsoleLogs({ q: "boom" });
    const upper = queryConsoleLogs({ q: "BOOM" });
    expect(lower.matched).toBe(2);
    expect(upper.matched).toBe(2);
  });

  it("q 也能匹配级别名", () => {
    const r = queryConsoleLogs({ q: "error" });
    expect(r.matched).toBeGreaterThanOrEqual(2);
  });

  it("q + level 组合为 AND 语义", () => {
    const r = queryConsoleLogs({ q: "boom", level: "warn" });
    expect(r.matched).toBe(0);
  });

  it("limit 截断并置 truncated", () => {
    const r = queryConsoleLogs({ limit: 2 });
    expect(r.returned).toBe(2);
    expect(r.truncated).toBe(true);
    expect(r.matched).toBe(5);
  });

  it("since 未来时间返回 0 条", () => {
    const r = queryConsoleLogs({ since: Date.now() + 60_000 });
    expect(r.matched).toBe(0);
  });

  it("since 过去时间返回全部", () => {
    const r = queryConsoleLogs({ since: Date.now() - 60_000 });
    expect(r.matched).toBe(5);
  });

  it("since 支持 ISO 字符串", () => {
    const r = queryConsoleLogs({ since: new Date(Date.now() - 60_000).toISOString() });
    expect(r.matched).toBe(5);
  });

  it("非法 since 被忽略（返回全部）而非报错", () => {
    const r = queryConsoleLogs({ since: "not-a-date" });
    expect(r.matched).toBe(5);
  });

  it("clear 后为空", () => {
    clearConsoleLogs();
    expect(queryConsoleLogs().total).toBe(0);
    expect(getConsoleLogs()).toEqual([]);
  });

  it("返回结构含 total/matched/returned/truncated/levelCounts", () => {
    const r = queryConsoleLogs();
    for (const k of ["logs", "items", "total", "matched", "returned", "truncated", "levelCounts"]) {
      expect(r).toHaveProperty(k);
    }
    expect(Array.isArray(r.items)).toBe(true);
    expect(r.items[0]).toHaveProperty("level");
    expect(r.items[0]).toHaveProperty("text");
    expect(r.items[0]).toHaveProperty("ts");
  });
});
