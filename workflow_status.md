# workflow_status.md — 参考项目深度对标（CL4R1T4S + agent/编排/媒体）

## Task Contract

- **原始目标**：参考目录 848 项目每个都可能有可汲取点。重点：CL4R1T4S（顶级模型系统提示词）→ 优化主项目 agent 人格/流程；agent/编排/记忆/媒体/PPT 项目 → 扩展主项目。
- **当前阶段**：Phase A（ANALYSIS_ONLY）。T01/T03 已完成，T02 进行中 → 汇总 9 节报告 → **等待用户确认实施范围**。

## Task Graph

| ID | Agent | Goal | Depends | Deliverable | Status |
|----|-------|------|---------|-------------|--------|
| T00 | 主协调 | 基线框架 | 无 | 报告骨架 | DONE |
| T01 | a26905ee | CL4R1T4S 系统提示词深挖 | 无 | 设计模式清单 | **VERIFIED** |
| T02 | a839743dc | agent/编排/记忆/媒体对标 | 无 | 可迁移清单 | IN_PROGRESS |
| T03 | a2e99ff1 | skills 空白审计 | T01 | 强化清单 | **VERIFIED** |
| T04 | 主协调 | 汇总 9 节报告 + 路线图 | T01+T02+T03 | 正式报告 | PENDING |

## T01 已验证（CL4R1T4S 精华）
见上轮记录（10 维度：先搜/简练/负面清单/验证后完成/并行/不猜/跟语言/协议化输出/保密盾/密钥通道；+Muse 三段式等独门模式）。

## T03 已验证（skills 空白审计）

### 现状
- 9 个 SKILL.md 全英文、全「curl 就上」，10 个设计维度除「简练」外**全缺**。
- 无「先确认 provider 已连接/模型存在再发请求」。
- 无「不」负面清单（video 的「绝不自动重试防重复计费」写成 prose 非指令）。
- 无排障链路：日志/Console Log 页（真实存在）**零提及** → 黑匣子。
- 无语言跟随/输出约束/保密盾。
- 小白缺口：入口 SKILL.md 无 first-call 成功路径、无 Windows/`curl (7)`/404 新手错误表、无「不知道选哪个 provider 怎么办」。
- **数据断层**：`skills.js` 常量缺 `9router-video`（文件存在但 dashboard 不可见）。

### 强化清单（P0/P1/P2）
**P0**（不改就烧钱/用不起来）：
- P0-1 `9router-video` 加显式「不」清单（POST 绝不自动重试防重复计费、缺 connection-id 不 poll、403 先问用户）
- P0-2 入口 SKILL.md 补「首次成功路径 + 新手错误表（curl(7)/404/Windows set）」
- P0-3 dashboard「使用一次」加成功反馈（confidence 机制可视化）

**P1**（30 分钟级对齐产品核心）：
- P1-1 9 技能统一加「调用前先确认 provider/模型」
- P1-2 打破黑匣子：入口加「排查」段（Console Log 页 /error 字段/metrics 字段），Console Log + Skills 提上主导航
- P1-3 入口加「行为」节：语言跟随 + 贴证据 + 保密盾
- P1-4 dashboard 内置技能列补「复制即用」引导 + **补 video 断层**
- （新增）P1-5 tools.js 常量补 `9router-video` 条目（修 dashboard 数据断层）

**P2**：
- P2-1 用户自定义技能表单加 SKILL.md 三段式模板占位
- P2-2 入口补「0 配置默认可用」提示

### Muse 三段式验证结论
**值得**：Triggering/Execution/Output 一段式修复审计里 7 个「无」，是 9 个工具型技能最贴合的模板；成本约 +100 行 Markdown。建议新增 `skills/9router-template/SKILL.md` 供用户自定义技能参考；8 个能力技能按三段式重排。

## Next Gate
等待 T02（agent/编排/媒体对标）完成 → 主协调输出 9 节报告 + P0/P1/P2 路线图 → **停止，等用户确认实施范围**。