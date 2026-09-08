# 9Router Desktop（Windows 桌面版）

双击 `release/win-unpacked/9Router.exe` 即可使用：
- 自动启动本地网关于 `http://127.0.0.1:20128`
- 系统托盘：打开面板 / 启动服务 / 停止服务 / 开机自启 / 退出
- 自动打开原生窗口加载 Dashboard
- 默认密码 `123456`（首次登录后请修改）

## 构建

```bash
# 1. 构建 Next.js standalone（若 .next-b/standalone 不存在）
NEXT_DIST_DIR=.next-b npm run build

# 2. 一键产出桌面版（electron-builder --dir + 自动补齐网关依赖）
node scripts/build-desktop-win.cjs
# 产物: release/win-unpacked/9Router.exe

# 3. （可选）NSIS 安装包 — 需 electron-builder 自带打包器
cd electron && npx electron-builder --win nsis
# 产物: release/9Router Setup <version>.exe
```

## 结构
- `electron/main.js` — 主进程：拉起网关（utilityProcess）、托盘、窗口、证书自举
- `electron/gateway/` — 从 `.next-b/standalone` 复制的网关运行时（脚本自动生成）
- `scripts/build-desktop-win.mjs(cjs)` — 一键构建脚本（robocopy 补 node_modules）

> 说明：electron-builder 的 `extraResources` 不会拷贝嵌套 `node_modules`（硬编码排除），
> 因此构建脚本在打包后用 robocopy 将网关 `node_modules` 补入 `resources/app`。
