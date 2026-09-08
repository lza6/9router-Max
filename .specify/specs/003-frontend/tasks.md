# 任务：003-frontend 前端结构加固

## Phase 1：App Router 边界
- [ ] 1.1 创建 `(dashboard)/loading.js`（复用 Skeleton，骨架屏）
- [ ] 1.2 创建 `(dashboard)/error.js`（客户端组件，错误+重试按钮）
- [ ] 1.3 创建 `(dashboard)/not-found.js`（404 引导回首页）
- [ ] 1.4 build + 页面可达性验证

## Phase 2：共享组件目录分层
- [ ] 2.1 建 `primitives/`（Button/Input/Select/Card/Badge/…）并更新 index 导出
- [ ] 2.2 建 `modal/`（Modal/*AuthModal/…）
- [ ] 2.3 建 `layout/`（Sidebar/Header/Footer/Drawer）与 `data/`（Pagination/RequestLogger/…）
- [ ] 2.4 build 全绿（import 零断裂）+ 21 单测回归

## Phase 3：文档与提交
- [ ] 3.1 README 前端章节同步（组件目录结构 + 边界说明）
- [ ] 3.2 CHANGELOG v0.5.75
- [ ] 3.3 提交推送 + tag + release

## 依赖
- Phase 2 依赖 Phase 1（同批，先边界后目录）
- 每步验证：build + 定向单测 + E2E（standalone 启动 + 页面可达）