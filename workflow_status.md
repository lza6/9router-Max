# workflow_status.md — 生产加固与终局闭环审计

## Task Contract

- **原始目标**：对 9router-Max 做终局闭环总审计（API 契约/数据安全/UX 文档），将「技能系统」从"代码可跑"提升到"一次调用即通、边界完整、文档一致、生产可交付"。
- **当前阶段**：Phase B（生产加固批次）修复+验证中
- **授权**：用户已授权修复、验证、提交推送、创建发行版。

## 审计发现（三个子代理汇总，已修复项标注）

### 数据层/安全审计（a54aadea2）
| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| 1 | rowToSkill 裸 JSON.parse，坏数据炸列表接口 | 需改 | ✅ 已修复（try/catch 容错，单测覆盖） |
| 2 | 错误信息泄漏 DB 内部细节 | 需改 | ✅ 已修复（统一 500 "操作失败"），route 层 badRequest 白名单 |
| 3 | 输入无长度上限 | 建议 | ✅ 已修复（MAX_NAME/MAX_DESC/MAX_CONTENT/MAX_TAGS/MAX_TAG 常量 + route 校验） |
| 4 | update 字段类型强转/静默吞 | 建议 | ✅ 已修复（PUT 白名单+类型强校验，非字符串返回 400） |
| 5 | recordSkillUse 跨进程 lost-update | 建议 | ✅ 已修复（单条 SQL json_set 原子自增，20 并发单测验证无丢） |
| 6 | /use 可无限重放刷信任 | 建议 | 记录（单用户本地面板，非安全边界，暂不加节流） |
| 7 | 缺 skillsRepo 单测 | 建议 | ✅ 已修复（新增 5 用例：404/损坏JSON/上限/并发/类型） |

### API/前后端审计（acf1f8f57e）
| # | 问题 | 严重度 | 状态 |
|---|------|--------|------|
| B1 | 损坏 JSON 首屏 500 | 阻塞 | ✅ 已修复（同上） |
| B2 | /use 竞态丢 uses | 阻塞 | ✅ 已修复（json_set 原子 SQL） |
| B3 | isLocalRequest 生产恒 false，远程 /v1beta 鉴权盲区 | 阻塞 | ⏳ 待处理（见下） |
| B4 | 非法 JSON 文案与业务 400 混用 | 阻塞 | ✅ 已修复（"Request body must be valid JSON" 区分） |
| M1 | content 长度缺失 | 需改 | ✅ 已修复 |
| M2 | tags 类型/空白过滤 | 需改 | ✅ 已修复（route 校验 tags 元素类型） |
| M3 | 500 泄漏 message | 需改 | ✅ 已修复 |
| M4 | 删除缺防重复 | 需改 | ✅ 已修复（deletingId/usingId 状态 + 404 幂等） |
| M5 | PUT 无条件信任类型 | 需改 | ✅ 已修复 |

### B3 待处理分析
- 现象：`dashboardGuard.js` 的 `isLocalRequest` 生产恒 false（需 `hasTrustedPeerHeaders` 或开发环境）。
- 影响面：仅当产品提供 `/v1beta/skills` 这类 LLM API 前缀内的「工具调用写技能」路径时才阻塞。但当前**并无 `/v1beta/skills` 路由存在**（skills 只有 `/api/skills`，走 dashboard 鉴权），故 B3 实际为"未来扩展路径的鉴权设计预留"，非当前功能阻塞。
- 决策：记录到 ARCHITECTURE 备注；若未来加 `/v1beta/skills` 工具调用，需在 guard 增加「带合法 API key 可写」专用分支。当前不新增不存在的路由。

## 验证证据

| 验证 | 命令 | 结果 |
|------|------|------|
| 单元测试 | `npx vitest run unit/skills.test.js unit/db-driver-chain.test.js` | 16 passed ✅ |
| 构建 | `npm run build` | Compiled successfully ✅ |
| E2E（standalone） | 创建/缺content/非法JSON/超长/use/非法类型/删除/404/鉴权 9 项 | 全部符合预期 ✅ |
| 并发 | tests 内 20 并发 recordSkillUse | uses=20 无丢失 ✅ |
| 文档 | README.md / zh-CN / en.md 已补技能章节+校验说明 | 已同步 ✅ |

## Next Gate

1. 等待 UX/文档审计子代理（a2f9d2387）结果
2. 启动独立 Critic 复验修复
3. 提交推送 + tag + release（已授权）
4. 更新 CHANGELOG 与 .specify 完成状态