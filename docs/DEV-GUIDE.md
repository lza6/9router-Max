# 9Router-Max 开发工作流（DEV-GUIDE）

本指南给**新会话 / 新 Agent / 接手开发者**使用。先读它，再决定是否查代码——避免重复发现项目约定。

## 0. 先读这些（顺序固定）

1. `CLAUDE.md` — 项目契约（含 OpenWolf 协议、Windows 规则、TDD/审查铁律）
2. `.specify/memory/constitution.md` — 宪法：真实优先、生产可交付、小白可用
3. `参考的结果计划指南.md` — 对标分析 + P0/P1/P2 路线图 + 审计证据台账
4. `workflow_status.md` — 当前阶段 / 任务图 / 验证证据
5. 记忆（跨会话）：`~/.claude/projects/*9router*/memory/MEMORY.md`（**先读 `9router-skills-hardening-audit.md`**，避免重复全量审计 skills 区域）
6. `docs/ARCHITECTURE.md` + `open-sse/AGENTS.md` — 系统架构与引擎约定（**改 open-sse 前必读**）

**判断标准**：若上述文档描述与代码/运行结果冲突 → 以实际代码为准，并同步更新过时文档。

---

## 1. 加一个新的上游 Provider

1. 复制 `open-sse/providers/REGISTRY_TEMPLATE.js` → `open-sse/providers/registry/<id>.js`
2. 填写：`id` / `alias` / `category` / `display` / `transport{baseUrl}` / `models`；OAuth 加 `oauth`；媒体加 `media{...Config}`
3. 模型表同步：`open-sse/config/providerModels.js`
4. **必须**在 `open-sse/providers/registry/index.js` 静态导入（自注册：translator 同理，见 `open-sse/translator/index.js`）
5. 生成目录：`node scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`
6. 验证：
   - `npm run build`
   - 真实连通：`tests/e2e/llm-e2e.mjs`（环境变量传 key，**不落库**）
   - 回归：`tests/__baseline__/verify-no-regression.mjs`

## 2. 加一个新的 API / 能力

1. 路由放 `src/app/api/**`（LLM 端点是 `src/app/api/v1/**`）
2. 遵循：`export const dynamic="force-dynamic"` + `revalidate=0` + `Cache-Control: no-store`
3. 鉴权：默认走 `dashboardGuard` deny-by-default（JWT / CLI token）；公开端点才加入 `PUBLIC_API_PATHS`
4. 输入校验：类型强校验 + 长度上限；错误不泄漏内部细节（500 统一收敛）
5. 数据：走 `src/lib/db/repos/*`（repo 模式），SQL 参数化
6. 验证：单测 + standalone E2E（`node .next/standalone/custom-server.js --port 20128`）

## 3. 加一个新的 Skill

1. 参考模板 `skills/9router-template/SKILL.md`（Muse 三段式：Triggering / Execution / Output）
2. 内置技能：放 `skills/<id>/SKILL.md` + 在 `src/shared/constants/skills.js` 加条目（**否则 dashboard 页看不到**）
3. 用户技能：走 `/api/skills`（save_skill 语义，存 kv `userSkills`）
4. 必备要素：首次成功路径、新手错误表、`Console Log` 排障链路、调用前先确认、负面清单（不自动重试计费请求）、语言跟随

## 4. 加测试

- 单测：`tests/`（独立 vitest 包），`cd tests && npm install`
- 核心逻辑覆盖：正常 / 错误 / 边界 / 权限
- 回归门禁：全量跑 `npx vitest run --reporter=json --outputFile=test-results.json` → `node ../tests/__baseline__/verify-no-regression.mjs test-results.json`（**不允许新增基线外失败**）
- E2E：`tests/e2e/`（`llm-e2e.mjs` 真实 LLM、`concurrency-smoke.mjs` 并发压测）

---

## 5. 验收门禁（Definition of Done）

- [ ] `npm run build` 通过
- [ ] 相关单测 / 回归门禁通过（真实运行，非静态推断）
- [ ] 关键用户路径在真实环境验证（standalone E2E；浏览器可用时用浏览器）
- [ ] 无未解决 blocker / major
- [ ] 无密钥入仓（扫描 `sk-` 等模式）
- [ ] 文档同步（README / CHANGELOG / 本指南若受影响）
- [ ] `workflow_status.md` 相关节点基于证据标记 passed

## 6. 已知边界（避免踩坑）

- 付费消耗型 API（图片/视频生成）默认**不**真实调用——用 Mock/fixture 验证参数拼装；负面清单已把"防重复计费"写成显式契约
- 生产性能：限流默认关闭（`RATE_LIMIT_ENABLED=true` 才生效）；`/api/ready` 不探测付费上游
- 组件结构：`src/shared/components/` 已分层（primitives/modal/auth/layout/data/provider），**新组件放对应子目录**；旧路径 re-export 桩保留兼容
- 参考目录（`C:\Users\Administrator.DESKTOP-EGNE9ND\Desktop\智能渗透\参考项目`）的每个项目都可能有可迁移设计——按需深挖，产出记入 `参考的结果计划指南.md`