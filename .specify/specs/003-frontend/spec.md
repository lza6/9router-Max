# 特性规格：前端结构加固（App Router 边界 + 组件目录分层）

## 问题陈述

9router 前端已生产运行。终端审计发现两个结构问题（有证据）：
1. `(dashboard)/(dashboard)` 组**没有 `loading.js` / `error.js` / `not-found.js`** 边界文件 → 大页面（providers/combos/usage）首屏白闪、运行期异常无兜底。
2. `src/shared/components` **42+ 组件平铺无子目录**，Modal 系 8+、Auth 系 7+ → 随功能增长成"杂物抽屉"。

不改变任何现有行为与 import 路径（index.js 全量聚合保留），纯结构加固。

## 用户故事

### 故事 1：dashboard 有加载/错误/404 边界
作为终端用户
我想要在 dashboard 页面加载时看到骨架屏、出错时不白屏、地址不存在时有 404 引导
以便于首次使用不困惑、异常可恢复。

**验收标准：**
- [ ] `(dashboard)/loading.js` 存在且渲染骨架（复用既有 Skeleton）
- [ ] `(dashboard)/error.js` 存在，错误有「重试」按钮
- [ ] `(dashboard)/not-found.js` 存在，404 有回首页链接
- [ ] 构建通过、`/dashboard/skills` 等页面仍可达

### 故事 2：共享组件目录分层
作为维护者
我想要 `src/shared/components` 按 `primitives/modal/auth/layout/data` 归类
以便于找组件快、新增不迷路。

**验收标准：**
- [ ] 新增子目录 + `index.js` 聚合（**所有既有导入**通过 `@/shared/components` 仍可解析）
- [ ] `npm run build` 全绿（无 import 断裂）

## 非功能需求
- 零行为变化（不改样式/逻辑，只移动/新增文件）
- 构建 + 3 个定向单测回归（skills/db-chain/rateLimit）
- 文档：README 前端章节同步

## 范围外
- 不做 Modal 懒加载/响应式导航（P2，后续批次）

## 成功度量
- 边界三文件存在且生效；build 通过；既有 21 单测全绿；提交推送。