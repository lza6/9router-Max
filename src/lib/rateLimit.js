// 内存令牌桶限流（默认关闭，RATE_LIMIT_ENABLED=true 时经 middleware 生效）。
// 无外部依赖；多实例部署时应换 Redis 等共享存储（见 docs/CI-CD-PIPELINE.md）。
const DEFAULT_RPM = 60;
const DEFAULT_CAPACITY = 60;

/**
 * 创建限流器。
 * @param {number} [rpm] 每分钟允许请求数（令牌补充速率）
 * @param {number} [capacity] 桶容量（突发上限）
 * @returns {{ allow: (ip: string) => {ok: boolean, retryAfter?: number} }}
 */
export function createRateLimiter(rpm = DEFAULT_RPM, capacity = DEFAULT_CAPACITY) {
  // key(ip) -> { tokens, lastRefill }
  const buckets = new Map();
  const interval = 60_000 / rpm; // ms per token
  const MAX_BUCKETS = 10_000;

  function refill(bucket, now) {
    const elapsed = now - bucket.lastRefill;
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed / interval);
    bucket.lastRefill = now;
  }

  function evictStale(now) {
    // 简单清理：超过 capacity 个桶时删除最旧（遍历一次，量级可控）
    if (buckets.size > MAX_BUCKETS) {
      let oldestKey = null;
      let oldest = Infinity;
      for (const [k, b] of buckets) {
        if (b.lastRefill < oldest) { oldest = b.lastRefill; oldestKey = k; }
      }
      if (oldestKey) buckets.delete(oldestKey);
    }
  }

  return {
    allow(ip) {
      const now = Date.now();
      let bucket = buckets.get(ip);
      if (!bucket) {
        bucket = { tokens: capacity, lastRefill: now };
        buckets.set(ip, bucket);
      } else {
        refill(bucket, now);
      }
      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        evictStale(now);
        return { ok: true };
      }
      const refillMs = Math.max(1, Math.ceil((1 - bucket.tokens) * interval));
      evictStale(now);
      return { ok: false, retryAfter: Math.ceil(refillMs / 1000) };
    },
    // 测试/管理用
    _size: () => buckets.size,
    _reset: () => buckets.clear(),
  };
}

export function isRateLimitEnabled() {
  return process.env.RATE_LIMIT_ENABLED === "true";
}

export function rateLimitConfig() {
  const rpm = Number(process.env.RATE_LIMIT_RPM) || DEFAULT_RPM;
  const capacity = Number(process.env.RATE_LIMIT_CAPACITY) || DEFAULT_CAPACITY;
  return { rpm, capacity };
}

export async function getClientIp(request) {
  // 与 custom-server 的 IP 还原一致：只信任 loopback 反向代理的 XFF，其余忽略
  const forwarded = request.headers.get("x-forwarded-for");
  const isViaProxy = request.headers.get("x-9r-via-proxy");
  if (isViaProxy && forwarded) {
    const first = forwarded.split(",")[0].trim();
    if (first) return first;
  }
  // 无代理时用 socket 地址（custom-server 已 set 到真实 IP）
  const cf = request.headers.get("cf-connecting-ip");
  return cf || request.headers.get("x-real-ip") || "local";
}

// 供路由使用的便捷包装：默认关闭，开启时对超限返回 429 结构
export async function checkRateLimit(request, limiter = globalThis.__rateLimiter__) {
  if (!isRateLimitEnabled()) return { ok: true };
  if (!limiter) return { ok: true }; // 未初始化则放行（安全兜底）
  const ip = await getClientIp(request);
  return limiter.allow(ip);
}

export function initRateLimiter() {
  if (globalThis.__rateLimiter__) return globalThis.__rateLimiter__;
  const { rpm, capacity } = rateLimitConfig();
  globalThis.__rateLimiter__ = createRateLimiter(rpm, capacity);
  return globalThis.__rateLimiter__;
}