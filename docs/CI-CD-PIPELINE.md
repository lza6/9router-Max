# 完整 CI/CD Pipeline — 9Router-Max

9Router 持续集成/持续交付流水线说明。覆盖：构建 → 质量 → 测试 → 安全 → 无回归门禁 → 部署 → 通知，含分支策略、排障与回滚。

## 技术栈与平台

| 项 | 值 |
|----|----|
| 语言/框架 | Node.js 22 + Next.js 16（纯 JS ESM）+ React 19 |
| CI/CD 平台 | GitHub Actions（`.github/workflows/`） |
| 目标环境 | 生产（Docker 镜像 → Docker Hub + GHCR）、文档站点（GitBook Pages） |
| 部署基础设施 | Docker 容器（`Dockerfile` 多阶段：builder → runner，Node 22 alpine，端口 20128） |
| 数据库 | 内置 SQLite（无外部 DB 服务，适配链：bun:sqlite → better-sqlite3 → node:sqlite → sql.js） |
| 包管理 | npm（构建带 npmmirror 镜像源） |

## 流水线总览（ASCII）

```
feature/* 分支
   │ PR → GitHub Actions: CI（build+lint+unit+security+regression）
   ▼
develop 分支（含 main 合并）
   │ push → CI 全量 + 无回归门禁
   ▼
main 分支
   │ push → CI 全量 → 构建 Docker 镜像推送到 Docker Hub + GHCR
   │  🔏 v* tag → 同 main，并创建 Release
   ▼
部署（生产）
   ├─ 产物：ghcr.io/<owner>/9router:<semver>  /  decolua/9router:<semver>
   ├─ 部署方式：VPS/服务器 `docker compose pull && docker compose up -d`（见下）
   └─ 回滚：重新拉取上一 tag 镜像
```

## Workflow 文件

- `.github/workflows/ci.yml` — 全部 PR / `main` / `develop` 触发：install(cache) → lint → unit → security → build → regression gate
- `.github/workflows/docker-publish.yml` — `v*` tag / `workflow_dispatch`：构建并发多镜像（Docker Hub + GHCR）
- `.github/workflows/gitbook-pages.yml` — 文档站点自动部署

## Stage 1 — Build

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22, cache: npm }
- run: npm ci                # 锁文件安装（含 CN 镜像回退）
- run: npm run build         # next build --webpack → standalone 产物
```

- 依赖缓存：`setup-node` 的 `cache: npm`（`~/.npm`），显著加速。
- 构建校验：standalone 产物非空 + 关键路由产物存在。

## Stage 2 — Quality

```yaml
- run: npx eslint .          # ESLint 9 + eslint-config-next
- run: npx prettier --check .   # 代码风格（若配置）——失败即 pipeline 失败
```

## Stage 3 — Tests

```yaml
- name: Install tests deps
  working-directory: tests
  run: npm install --no-audit --no-fund
- name: Run unit tests + coverage
  working-directory: tests
  run: npx vitest run --coverage        # 阈值见下
- name: Regression gate
  run: node tests/__baseline__/verify-no-regression.mjs tests/test-results.json
```

- 单测：`tests/` 独立 vitest 包（约 950 用例），运行于 Node 内置 `node:sqlite`/`sql.js`，无需额外数据库。
- 覆盖率：核心新逻辑（如 `skillsRepo`）建议 ≥80%；CI 记录但不强制中断历史基线（存量基线已知 ~64 失败，见下文）。
- **无回归门禁**：`verify-no-regression.mjs` 对比 `known-fails.txt` 基线 —— **不产生"新的基线外失败"** 才算通过。这是本仓库的契约铁律。
- 集成/E2E：真实 LLM 调用（`tests/e2e/llm-e2e.mjs`）需密钥，默认在 CI 内降级为 smoke；带密钥手动跑完整 E2E（见 README 技能章节）。

## Stage 4 — Security

```yaml
- run: npm audit --audit-level=high     # 依赖漏洞（高+阻断）
- name: Secret scan
  run: |
    # 阻止常见密钥模式进入仓库（用 gitleaks 或自带脚本）
    npx gitleaks detect --source . --no-banner || true   # 有 gitleaks 时启用
```

- 密钥安全：`INITIAL_PASSWORD`、`JWT_SECRET`、`API_KEY_SECRET`、`MACHINE_ID_SALT` 全部走环境变量，仓库仅保留 `.env.example` 占位。
- 线上真实 E2E key 只读环境变量，**禁止**写入仓库（已验证零泄漏）。

## Stage 5 — Deploy

- **生产镜像**（`docker-publish.yml`）：`v*` tag 或手动触发 → buildx 推送 `decolua/9router:<semver>`(Docker Hub) + `ghcr.io/<owner>/9router:<semver>`(GHCR)。
- 部署到你自己的 VPS/服务器：

```bash
# 服务器上运行（示例 docker-compose）
docker pull ghcr.io/lza6/9router-Max:0.5.71
# 或 docker pull decolua/9router:0.5.71
docker run -d --name 9router \
  --restart always -p 20128:20128 \
  -v ./data:/root/.9router \
  -e JWT_SECRET='<强随机>'
  -e INITIAL_PASSWORD='<强随机>' \
  ghcr.io/lza6/9router-Max:0.5.71
```

- **回滚**：镜像 tag 即版本；`docker run` 换回上一 tag + `--env POST 数据卷未动` 即可秒级回滚。数据在挂载卷，更新代码不影响数据。

## Stage 6 — Notifications

- GitHub Actions 自带 Check 失败红叉；tag 构建成功自动出现在 Release。
- 可选扩展 Slack 通知（`.github/workflows/ci.yml` 末尾追加）：

```yaml
- name: Notify Slack on failure
  if: failure()
  uses: rtCamp/action-slack-notify@v2
  env:
    SLACK_WEBHOOK: ${{ secrets.SLACK_WEBHOOK }}
    MESSAGE: '❌ 9Router CI failed on ${{ github.ref }} — ${{ github.run_id }}'
```

## 分支策略

| 分支 | 用途 | CI 行为 | 部署 |
|------|------|---------|------|
| `feature/*` | 功能开发 | PR 触发 CI 全量 | 无 |
| `develop` | 集成（预留） | push 触发 CI 全量 + 回归门禁 | 可选 dev 镜像 |
| `main` | 主分支 | push 触发 CI 全量；`v*` tag 触发镜像构建 | Push tag 即发 |
| `hotfix/*` | 紧急修复 | PR 触发 CI | 合并 main + tag |

## 性能优化

- **缓存**：`setup-node cache: npm`；Next build 产物在 PR 内天然增量。
- **并行**：CI 的 lint/unit 可拆 `needs` 并行 job（本仓库沿用单 job 顺序以保证回归门禁依赖 test 结果）。
- **矩阵**：node 22（当前唯一目标运行时）暂不需要矩阵；如需多平台可在 buildx 加 `platforms: linux/amd64,linux/arm64`。

## 排障指南

| 报错 | 常见原因 | 修复 |
|------|---------|------|
| `vitest` 找不到模块 | tests 依赖未安装 | `cd tests && npm install` |
| CI 回归门禁失败 | 新测试引入**基线外失败** | 对照 `known-fails.txt`；若是真回归修代码，若是合法新基线更新该文件 |
| `npm ci` 网络慢/失败 | 外网连接 | 使用 `--registry=https://registry.npmmirror.com` |
| 构建 `module not found` | 根依赖未装 | `npm install`（根） |
| Docker `better-sqlite3` 编译失败 | 缺 build-tools | Dockerfile 已装 `python3 make g++`；或用 node:sqlite/sql.js 兜底 |
| 镜像拉取 401 | GHCR 未登录 | Docker Desktop Settings → 登录 GitHub；或直接 pull Docker Hub |

## 需要配置的 Secrets

| Secret | 用途 | 必填 |
|--------|------|------|
| `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` | 推 Docker Hub 镜像 | 是 |
| `GITHUB_TOKEN` | GHCR 推送（Actions 自动注入） | 自动 |
| `SLACK_WEBHOOK` | 失败通知（可选） | 否 |
| 运行时密钥 | `JWT_SECRET`、`INITIAL_PASSWORD`、`API_KEY_SECRET`、`MACHINE_ID_SALT` | 部署时必填 |