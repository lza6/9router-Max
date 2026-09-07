# 实施任务：生产加固与终局闭环审计

## Phase 1：审计汇总与修复清单

- [ ] 1.1 汇总三个子代理（API契约/数据安全/UX文档）发现的问题
  - 合并去重，标注 P0/P1/P2 与 [文件:行号]
  - **Depends on**: 3 个子代理完成
- [ ] 1.2 输出修复清单到 workflow_status.md

## Phase 2：后端/数据层加固

- [ ] 2.1 skillsRepo 加固
  - rowToSkill：损坏 JSON 容错（try/catch 返回 null）
  - createUserSkill：name/content/description/tags 长度上限，超长抛错
  - recordSkillUse：确认事务内原子递增（并发安全）
  - **Depends on**: 1.1
- [ ] 2.2 API 路由加固
  - POST / PUT：400 返回明确参数错误（含超长）
  - 错误信息收敛：500 不泄漏内部细节
  - 确认 no-store 头
  - **Depends on**: 2.1

## Phase 3：前端页面补齐

- [ ] 3.1 空态/加载态/错误态检查并补齐
- [ ] 3.2 表单防重复提交/删除确认/使用反馈
- [ ] 3.3 与既有页面风格一致性检查
  - **Depends on**: 2.2

## Phase 4：测试与验证

- [ ] 4.1 单测增加：并发 uses、损坏 JSON、长度上限、非法入参
- [ ] 4.2 `npm run build` 通过
- [ ] 4.3 standalone E2E 全链路（含 400/404/鉴权）
- [ ] 4.4 回归：db-driver-chain 通过
  - **Depends on**: 3.3

## Phase 5：文档同步

- [ ] 5.1 README.md 技能系统章节与真实 API 一致性复核
- [ ] 5.2 i18n/README.zh-CN.md 同步
- [ ] 5.3 README.en.md 补充技能章节
- [ ] 5.4 CHANGELOG v0.5.70/v0.5.71 更新
  - **Depends on**: 4.4

## Phase 6：独立审查与收尾

- [ ] 6.1 启动独立 Critic 子代理（不改代码，六维验证）
- [ ] 6.2 修复 Critic 发现的 P0/P1 → 复验
- [ ] 6.3 提交推送 + tag + release（用户已授权）
- [ ] 6.4 workflow_status.md 标注最终状态
  - **Depends on**: 5.4

## 注意事项

- `[P]` 标记的并行任务按说明并行
- 所有验证提供真实命令输出证据
- 不引入新依赖，遵循既有 repo/路由模式