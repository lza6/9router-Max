---
name: 9router-template
description: 技能模板 — 用「触发场景 / 执行步骤 / 输出契约」三段式组织一个可用的自定义技能。新建用户技能时参考此结构（在 Dashboard → 技能 → 新建，或经 /api/skills 创建）。
---

# 技能模板（Triggering / Execution / Output）

## Triggering（什么时候用本技能）

- **必须用**：当用户请求 …（列出明确信号）
- **禁止用**：当用户只是 …（反例，防误触发）
- 例子：
  - 用 → 「帮我 …」
  - 不用 → 「告诉我 …」

## Execution（怎么执行）

1. **先确认前置条件**：`curl $NINEROUTER_URL/v1/models` 看目标 provider 已连接、模型 id 正确；不猜。
2. **发请求**：`curl -X POST $NINEROUTER_URL/<endpoint>` …（给一条可复制命令）
3. **处理响应**：成功要校验关键字段（如 `choices[0].message.content` 非空）；失败按错误阶梯处理（看 status → 查 Console Log → 问用户）。
4. **不自动重试计费型请求**；密钥只用环境变量，不写文件/日志。

## Output（输出契约）

- **成功**：贴出实际拿到的 模型 ID / 文件路径 / 响应片段（可验证），并一句话说明结果。
- **失败**：报告 HTTP 状态 + `error` 字段 + 下一步建议（打开 /dashboard/console-log 查 upstream 原始错误）。
- **回复语言跟随用户**；不纯说「成功」了事。

## 参考

- 入口技能 setup：https://raw.githubusercontent.com/decolua/9router/refs/heads/master/skills/9router/SKILL.md
