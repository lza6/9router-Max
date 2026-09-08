# 特性规格：生产性能与运维加固（限流 / 观测 / 压测）

## 问题陈述

用户要 9router 达到「能抗高并发、高性能、低延迟」的成熟 SaaS 水平，并点名：限流、熔断、健康检查、可观测（Logs+Metrics+Traces）、压测。现状盘点（有证据）：登录已有 loginLimiter 限流；**/v1 核心链路无应用层限流**；health 端点就绪；无 metrics/opentelemetry；账号选择有 mutex+模型锁+退避（并发友好）；无慢查询猎杀（SQLite 单机量级可控）。

## 用户故事

### 故事 1：/v1 核心链路有应用层限流
作为网关运维者
我想要对 `/v1/chat/completions` 等核心 LLM 端点做 per-IP 限流
以便于防止单客户端打爆账号/上游。

**验收标准：**
- [ ] 内存令牌桶限流（无外部依赖）作用于 `/v1/*` 可配置开关
- [ ] 超限返回 `429` + `Retry-After`，错误信息不含内部细节
- [ ] 默认关闭（`RATE_LIMIT_ENABLED=false`），开启后可通过 env 配 RPM

### 故事 2：可观测端点（健康+就绪+指标）
作为运维者
我想要 `/api/health`、`/api/ready`、`/api/metrics`（服务级）
以便于接入探活、就绪判定与基础指标。

**验收标准：**
- [ ] `GET /api/ready` 返回 DB/上游可达性状态（无需真实付费调用，含降级说明）
- [ ] `GET /api/metrics` 返回核心服务指标（进程、请求计数、动作计数）JSON

### 故事 3：压测脚本证明并发安全性
作为验收者
我想要一个不依赖付费 API 的并发冒烟脚本
以便于证明高并发下无竞态/无崩溃。

**验收标准：**
- [ ] `tests/e2e/concurrency-smoke.mjs` 对 `/api/skills`（本地 DB）并发 100 请求，全绿且 uses 无丢失
- [ ] 对 `/v1/chat/completions` 的并发在无真实 key 时降级为优雅说明（不假报成功）

## 非功能需求
- 零新增依赖（避免脚手架含恶意/大体积包）
- 默认关闭限流（不改变现有生产行为）；开启后显式可回滚
- 文档 README.md/CI-CD-PIPELINE.md 同步；测试可跑

## 范围外
- 不引入 Redis/Kafka/消息队列（单机 SQLite 场景不需要）；文档说明何时才需要
- 不引入 opentelemetry 依赖（成本高，改为轻量 metrics 端点 + 现有 console-log 观测）；文档说明演进路径

## 成功度量
- 故事 1/2/3 验收全过；106 压测并发全绿；README/CHANGELOG 更新；提交推送 + 发版。