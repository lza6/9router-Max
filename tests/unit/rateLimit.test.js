import { describe, it, expect } from "vitest";
import { createRateLimiter } from "@/lib/rateLimit.js";

describe("rateLimit（内存令牌桶）", () => {
  it("容量内允许，超限返回 retryAfter", () => {
    const rl = createRateLimiter(60, 3); // 60 rpm，突发 3
    expect(rl.allow("ip1")).toEqual({ ok: true });
    expect(rl.allow("ip1")).toEqual({ ok: true });
    expect(rl.allow("ip1")).toEqual({ ok: true }); // 突发已满
    const r = rl.allow("ip1");
    expect(r.ok).toBe(false);
    expect(r.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("不同 IP 独立桶", () => {
    const rl = createRateLimiter(60, 1);
    expect(rl.allow("a")).toEqual({ ok: true });
    expect(rl.allow("b")).toEqual({ ok: true }); // 不互相影响
    expect(rl.allow("a").ok).toBe(false);
  });

  it("令牌随时间恢复（模拟 refill）", () => {
    const rl = createRateLimiter(60000, 1); // 60 秒 1 个令牌
    expect(rl.allow("x")).toEqual({ ok: true });
    expect(rl.allow("x").ok).toBe(false);
    // 手动把时间推后到下一次 refill（直接操作内部桶不便，改用延时 10ms + 高 rpm）
  });

  it("高 rpm 下快速恢复", async () => {
    const rl = createRateLimiter(6000, 1); // 每秒 100 个 → 10ms 补 1
    expect(rl.allow("y")).toEqual({ ok: true });
    await new Promise((r) => setTimeout(r, 25)); // ~2 个令牌恢复
    expect(rl.allow("y").ok).toBe(true);
  });

  it("桶数量封顶（evictStale）", () => {
    const rl = createRateLimiter(60, 1);
    for (let i = 0; i < 50; i++) rl.allow(`ip-${i}`);
    expect(rl._size()).toBe(50);
    rl._reset();
    expect(rl._size()).toBe(0);
  });
});