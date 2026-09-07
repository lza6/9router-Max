# 实施计划：生产加固与终局闭环审计

## 技术栈（沿用现有，不引入新依赖）

- Next.js 16 App Router（纯 JS，无 TS）
- `src/lib/db` repo 模式 + kv 表（userSkills scope）——零迁移
- vitest（tests/ 独立包）做单测；standalone `node custom-server.js` 做真实 E2E
- dashboardGuard deny-by-default 鉴权（JWT / CLI token）

## 架构

### 系统总览

```mermaid
graph TD
    Browser[浏览器 /dashboard/skills] -->|fetch /api/skills| Guard[dashboardGuard 鉴权]
    Guard --> API[/api/skills 路由]
    API --> Repo[skillsRepo]
    Repo --> KV[(SQLite kv userSkills)]
    Guard -->|未鉴权| Deny[401 / 重定向登录]
```

### 组件

#### 1. API 路由（已存在，按审计意见加固）
- `src/app/api/skills/route.js`（GET 列表 / POST 创建）
- `src/app/api/skills/[id]/route.js`（GET / PUT / DELETE）
- `src/app/api/skills/[id]/use/route.js`（POST 记录使用）
- 加固点：输入长度上限、错误收敛、no-store

#### 2. skillsRepo（已存在，按审计意见加固）
- `src/lib/db/repos/skillsRepo.js`
- 加固点：rowToSkill 损坏 JSON 容错、输入长度上限、并发原子递增

#### 3. 前端页面（已存在，按审计意见补空错态）
- `src/app/(dashboard)/dashboard/skills/page.js`

#### 4. 文档（对齐）
- README.md / i18n/README.zh-CN.md / README.en.md / CHANGELOG.md

## 设计模式

- **Repository 模式**：所有 DB 访问收敛到 skillsRepo，路由不直接碰 DB
- **Fail-closed 鉴权**：/api/* 默认需登录
- **事务原子**：recordSkillUse 在 db.transaction 内完成读-改-写

## 安全

- 鉴权：沿用 dashboardGuard，无需新增
- 输入：`MAX_NAME=100`、`MAX_DESC=500`、`MAX_CONTENT=20000`、`MAX_TAGS=20`，超长返回 400
- XSS：前端用 `pre` + React 转义渲染内容（不注入 HTML）
- 错误：500 时返回通用 message，不打印到响应

## 性能

- kv 表有 scope 索引（schema.js 已建 idx_kv_scope）
- 列表按 uses 降序内存排序（量级小，可接受）

## 错误处理

- 400：参数缺失/非法/超长，返回明确 message
- 404：技能不存在
- 401/403：未鉴权（dashboardGuard 拦截）
- 500：DB 异常，记录日志 + 通用错误

## 验证策略

1. 单测：`tests/unit/skills.test.js` 增加并发/容错/上限用例
2. 构建：`npm run build`
3. E2E：standalone 启动，真实 HTTP 全链路（创建/列表/使用/详情/更新/删除/404/400/鉴权）
4. 回归：`db-driver-chain` 确认 SQLite 链未受影响
5. 文档复核：逐项对照 README/CHANGELOG

## 依赖与顺序

1. 等待三个审计子代理结果（并行已启动）
2. 汇总修复清单 → 按 P0/P1/P2 实施
3. 单测 + 构建 + E2E 验证
4. 文档同步
5. 独立 Critic 复验 → 修复 → 复验
6. 提交推送 + 创建 release（用户已授权）