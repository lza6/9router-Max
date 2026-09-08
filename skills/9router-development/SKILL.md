---
name: 9router-development
description: 9Router 项目开发 SOP —— 给任何要在这个仓库加功能/修 bug 的 AI 或开发者的入口技能。先读它（含加 provider / 加 API / 加 skill / 加测试四步 + 验收门禁），再动代码。
---

# 9Router 开发工作流

本技能是 9Router 仓库的**开发入口**。看到本技能时，先按它执行，再读实际代码——避免重复发现项目约定。

## 0. 先读这些（顺序固定）

1. `docs/DEV-GUIDE.md` — 本技能的 Markdown 母版（内容同步来源）
2. `CLAUDE.md` — 项目契约（Windows 规则、TDD/审查铁律）
3. `.specify/memory/constitution.md` — 宪法（真实优先 / 生产可交付 / 小白可用）
4. `open-sse/AGENTS.md` — **改 open-sse 引擎前必读**（provider/executor/translator 约定）
5. `参考的结果计划指南.md` + `workflow_status.md` — 对标路线图 + 当前阶段
6. 记忆：`~/.claude/projects/*9router*/memory/MEMORY.md`（**先读 `9router-skills-hardening-audit.md`**，避免重复审计 skills 区域）

**规则**：文档与代码/运行结果冲突时，以实际代码为准，并同步过时文档。

## 1. 加新 Provider

1. 复制 `open-sse/providers/REGISTRY_TEMPLATE.js` → `registry/<id>.js`，填 `id/alias/category/display/transport/models`；OAuth 加 `oauth`；媒体加 `media{*Config}`
2. 模型表同步 `open-sse/config/providerModels.js`
3. **必须**在 `open-sse/providers/registry/index.js` 静态导入（translator 同理，见 `open-sse/translator/index.js`）
4. 重建目录：`node scripts/migrate-registry.mjs` / `injectDisplayToRegistry.mjs`
5. 验证：`npm run build`；真实连通用 `tests/e2e/llm-e2e.mjs`（key 走环境变量，不落库）

## 2. 加新 API / 能力

- 路由 `src/app/api/**`（LLM 端点 `src/app/api/v1/**`）；`dynamic="force-dynamic"` + `revalidate=0` + `no-store`
- 鉴权默认 `dashboardGuard` deny-by-default（JWT/CLI token）；公开端点才加 `PUBLIC_API_PATHS`
- 输入强校验 + 长度上限；500 统一收敛不泄漏；数据走 `src/lib/db/repos/*`（repo 模式、参数化 SQL）
- 验证：单测 + standalone E2E（`node .next/standalone/custom-server.js --port 20128`）

## 3. 加新 Skill

- 参考 `skills/9router-template/SKILL.md`（Muse 三段式：Triggering / Execution / Output）
- 内置技能：`skills/<id>/SKILL.md` + **在 `src/shared/constants/skills.js` 加条目**（否则 dashboard 看不到）
- 必备要素：首次成功路径、新手错误表、Console Log 排障链路、调用前先确认、负面清单（不自动重试计费请求）、语言跟随

## 4. 加测试

- 单测在 `tests/`（独立 vitest）：`cd tests && npm install`
- 覆盖正常/错误/边界/权限；回归门禁 **不允许新增基线外失败**：
  `npx vitest run --reporter=json --outputFile=test-results.json && node ../tests/__baseline__/verify-no-regression.mjs test-results.json`
- E2E：`tests/e2e/`（`llm-e2e.mjs` 真实 LLM、`concurrency-smoke.mjs` 并发）

## 5. 验收门禁（Done）

- [ ] `npm run build` 通过
- [ ] 相关单测 / 回归门禁通过（真实运行）
- [ ] 关键路径真实环境验证（standalone E2E）
- [ ] 无未解决 blocker / major；无密钥入仓（`sk-` 等扫描）
- [ ] 文档同步（README/CHANGELOG/DEV-GUIDE）；`workflow_status.md` 基于证据 passed

## 6. 已知边界

- 付费消耗型 API（图片/视频生成）默认不真实调用——用 Mock/fixture 验证参数拼装；负面清单已防重复计费
- 限流默认关（`RATE_LIMIT_ENABLED=true` 生效）；`/api/ready` 不探测付费上游
- 组件分层：新组件放 `src/shared/components/{primitives,modal,auth,layout,data,provider}/`（旧路径 re-export 桩保留兼容）