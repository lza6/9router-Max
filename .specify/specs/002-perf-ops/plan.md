# 实施计划：生产性能与运维加固

## 技术栈（沿用现有，零新增依赖）
- Next.js App Router 路由 + 内存令牌桶（无 Redis）
- 轻量 metrics 端点（JSON，非 Prometheus 格式，避免新依赖）
- 压测脚本用原生 Node `fetch`/`http`（无 k6/artillery 依赖）

## 架构

### 新增模块
1. **`src/lib/rateLimit.js`**：内存令牌桶
   - `createRateLimiter({rpm, capacity})` → `{allow(ip) -> {ok, retryAfter}}`
   - 每 key（IP）桶；滑动窗口+令牌；O(1) 内存清理
   - env：`RATE_LIMIT_ENABLED`、`RATE_LIMIT_RPM`（默认 60）、`RATE_LIMIT_CAPACITY`
2. **`src/app/api/ready/route.js`**：就绪探针
   - `getAdapter()` 快速探活 + 返回 `{ok, db: "sqlite", driver}`；不加付费上游调用（降级说明）
3. **`src/app/api/metrics/route.js`**：服务指标
   - 进程：uptime/memory/pid；服务：请求计数（复用 statsEmitter 或自计数）；动作计数
4. **限流接入 `/v1/*`**：在 `src/app/api/v1/chat/completions/route.js`、`models/route.js` 等入口调用 `withRateLimit`（默认关闭，开启才走）
5. **`tests/e2e/concurrency-smoke.mjs`**：并发 100 请求打 `/api/skills`（需 CLI token）；`/v1` 无 key 时优雅降级

### 设计决策
- **限流默认关闭**：不改变现有生产行为；`RATE_LIMIT_ENABLED=true` 显式开启
- **不引入 opentelemetry**：成本/复杂度高；改用轻量 metrics + 现有 console-log（观测已够）；文档说明何时需要 OTel
- **不引入 Redis**：单机 SQLite 场景；文档说明多实例才需要外部限流存储

## 验证
1. 单测：rateLimit 令牌桶（正常/超限/恢复/清理）
2. build：通过
3. E2E：并发 100 打 /api/skills 全绿 + uses 无丢失；/v1 无 key 优雅降级
4. 手动：开启限流后 429 验证
5. 文档：README.md / docs/CI-CD-PIPELINE.md 补「限流/健康/指标/压测」章节；CHANGELOG v0.5.74

## 批次
1. rateLimit 模块 + 单测
2. ready/metrics 端点
3. 限流接入 v1 入口
4. 压测脚本 + E2E
5. 文档 + 提交推送 + 发版