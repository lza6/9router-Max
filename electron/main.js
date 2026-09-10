// 9Router Desktop — main process
// Spawns the standalone gateway (custom-server.js so local requests are trusted),
// creates a native window pointing at http://localhost:PORT/dashboard,
// and adds a system tray with start/stop/open/autostart controls.
"use strict";

const { app, BrowserWindow, Tray, Menu, dialog, nativeImage, utilityProcess, Notification } = require("electron");
const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");
const { autoUpdater } = require("electron-updater");

// Isolate desktop user data from the web/CLI install (which may already have a
// password set). Fresh desktop installs therefore default to password 123456.
try {
  const base = path.join(app.getPath("userData"), "desktop");
  app.setPath("userData", base);
} catch { /* ignore — some platforms restrict setPath pre-ready */ }
const DESKTOP_DATA_DIR = process.env.NINEROUTER_DESKTOP_DATA_DIR || path.join(app.getPath("userData"), "desktop", "data");

const DEFAULT_PORT = 20128;
const APP_NAME = "9Router";
const APP_VERSION = require(path.join(__dirname, "package.json")).version || "0.0.0";
const PREF = path.join(app.getPath("userData"), "prefs.json");
let mainWindow = null;
let tray = null;
let serverChild = null;
let isQuitting = false;
let hasInstanceLock = false;

// 1) Single-instance lock — only one desktop instance keeps tray+gateway alive.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Second instance: focus the existing window then quit.
  app.quit();
} else {
  hasInstanceLock = true;
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } else {
      openPanel();
    }
  });
}

// Allow CLI override: `electron . --port 20140` (kept for isolated dev/E2E runs)
function cliPort() {
  const idx = process.argv.indexOf("--port");
  if (idx !== -1 && process.argv[idx + 1]) return Number(process.argv[idx + 1]);
  return null;
}

function loadPrefs() {
  const forcedPort = cliPort();
  let base = { port: DEFAULT_PORT, https: false, autostart: false };
  try { base = { ...base, ...JSON.parse(fs.readFileSync(PREF, "utf8")) }; } catch {}
  if (forcedPort) base.port = forcedPort;
  return base;
}
function savePrefs(p) {
  try { fs.writeFileSync(PREF, JSON.stringify(p, null, 2)); } catch {}
}
const prefs = loadPrefs();

function getServerDir() {
  // Packaged: resourcesPath/app (extraResources). Dev: repo .next-b/standalone.
  const packed = path.join(process.resourcesPath, "app");
  if (fs.existsSync(path.join(packed, "server.js"))) return packed;
  const dev = path.join(app.getAppPath(), ".next-b", "standalone");
  if (fs.existsSync(path.join(dev, "server.js"))) return dev;
  return packed;
}
const serverDir = getServerDir();

// Packaged extraResources ships node_modules as a tar (gateway-node_modules.tar.gz).
// Electron-builder never copies nested node_modules via extraResources, so we resolve
// them out of the archive into resources/app/node_modules on first boot.
function extractTarGzNode(buf, destDir) {
  // Minimal POSIX ustar extraction using only Node built-ins (zlib).
  // Handles GNU @LongLink (type 'L') entries + ustar prefix field.
  const zlib = require("zlib");
  const tar = zlib.gunzipSync(buf);
  fs.mkdirSync(destDir, { recursive: true });
  let offset = 0;
  let longName = null;
  while (offset + 512 <= tar.length) {
    const header = tar.slice(offset, offset + 512);
    const nameBuf = header.slice(0, 100);
    if (nameBuf.every((b) => b === 0)) break; // end-of-archive zero block
    let name = nameBuf.toString("utf8").split("\0")[0];
    const size = parseInt(header.slice(124, 136).toString("utf8").split("\0")[0].trim() || "0", 8);
    const type = header[156] ? String.fromCharCode(header[156]) : "0";
    const data = tar.slice(offset + 512, offset + 512 + size);
    const isLong = name === "@LongLink" || type === "L";
    if (isLong) {
      longName = data.toString("utf8").split("\0")[0];
    } else {
      // GNU tar: a @LongLink entry supplies the long name for the *next* entry,
      // whose own name field is then typically a bare basename. But some tars
      // keep the full name there too — only apply longName when the inline
      // name looks truncated (empty or no path separator).
      if (longName && (name === "" || !name.includes("/"))) {
        name = longName;
      }
      longName = null;
      const prefix = header.slice(345, 500).toString("utf8").split("\0")[0];
      const fullName = prefix ? `${prefix}/${name}` : name;
      const isDir = fullName.endsWith("/");
      const safeName = fullName.replace(/^\.?\//, "");
      const full = path.join(destDir, safeName);
      const normFull = path.resolve(full);
      const normDest = path.resolve(destDir);
      if (!normFull.startsWith(normDest + path.sep) && normFull !== normDest) {
        throw new Error(`blocked path: ${fullName}`);
      }
      if (isDir) {
        fs.mkdirSync(full, { recursive: true });
      } else if (size > 0) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, data);
      }
    }
    offset += 512 + Math.ceil(size / 512) * 512;
  }
}

async function ensureGatewayModules() {
  const target = path.join(serverDir, "node_modules");
  if (fs.existsSync(path.join(target, "next", "package.json"))) return true;
  let archive = path.join(process.resourcesPath, "gateway-node_modules.tar.gz");
  if (!fs.existsSync(archive)) archive = path.join(path.dirname(serverDir), "gateway-node_modules.tar.gz");
  if (!fs.existsSync(archive)) return false;
  try {
    // Battle-tested-ish hand-rolled ustar extraction (Node built-ins only):
    // handles the ustar prefix field + GNU long links. Verified against the
    // bundled archive in tests (extracts node_modules/next correctly).
    extractTarGzNode(fs.readFileSync(archive), target);
    const ok = fs.existsSync(path.join(target, "next", "package.json"));
    console.error("[9Router] extract done, next exists:", ok, "target:", target);
    return ok;
  } catch (e) {
    console.error("[9Router] gateway modules extract failed:", e && e.message ? e.message : String(e));
    console.error("[9Router] archive:", archive);
    console.error("[9Router] target:", target);
    return false;
  }
}
const isPacked = fs.existsSync(path.join(process.resourcesPath, "app", "server.js"));

function waitForPort(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tryOnce = () => {
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => { socket.destroy(); resolve(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - start > timeoutMs) reject(new Error("timeout waiting for server"));
        else setTimeout(tryOnce, 300);
      });
    };
    tryOnce();
  });
}

// --- Certificate (self-signed trusted) ---
function ensureCert() {
  try {
    const forge = require("node-forge");
    const { generateRootCA, loadRootCA, generateLeafCert } = require(path.join(serverDir, "src", "mitm", "cert", "rootCA.js"));
    const root = loadRootCA() || generateRootCA();
    const leaf = generateLeafCert("localhost", loadRootCA());
    return { key: leaf.key, cert: leaf.cert, rootCert: root.cert };
  } catch (e) {
    console.error("[9Router] cert gen failed:", e.message);
    return null;
  }
}

// Gateway must start once Electron is ready (utilityProcess requires app ready).
// Window/tray also wait on app.whenReady().
process.on("uncaughtException", (err) => {
  console.error("[9Router] uncaught:", err && err.stack ? err.stack.split("\n").slice(0,3).join("\n") : err);
});
let gatewayBooted = false;
async function bootGateway() {
  if (gatewayBooted) return;
  gatewayBooted = true;
  try {
    const port = await ensureRunning();
    console.log(`[9Router] gateway listening on port ${port}`);
  } catch (e) {
    console.error("[9Router] gateway boot error:", e && e.message ? e.message : e);
    // Retry once after a short delay (transient EADDRINUSE / slow start).
    try {
      await new Promise((r) => setTimeout(r, 2500));
      const port = await ensureRunning();
      console.log(`[9Router] gateway retry OK on port ${port}`);
    } catch (e2) {
      console.error("[9Router] gateway retry failed:", e2 && e2.message ? e2.message : e2);
    }
  }
}

function installRootCert(certPem, onResult) {
  const certPath = path.join(app.getPath("userData"), "9router-rootCA.crt");
  try { fs.writeFileSync(certPath, certPem); } catch {}
  // Windows: certutil -addstore -user Root <path> (user store, no admin needed)
  exec(`certutil -addstore -user Root "${certPath}"`, (err) => {
    onResult(err ? false : true);
  });
}

function startServer() {
  return new Promise((resolve, reject) => {
    const port = prefs.port || DEFAULT_PORT;
    const env = {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NEXT_DIST_DIR: ".next-b",
      DATA_DIR: DESKTOP_DATA_DIR,
    };
    const entry = path.join(serverDir, "custom-server.js");
    // Packaged: launch the gateway through Electron's built-in Node (utilityProcess)
    // so no external node.exe is required. Dev: same code path.
    if (isPacked && typeof utilityProcess !== "undefined") {
      try {
        serverChild = utilityProcess.fork(entry, ["--port", String(port)], {
          cwd: serverDir,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (e) {
        console.error("[9Router] utilityProcess fork failed:", e.message);
        serverChild = null;
      }
    } else {
      const nodeBin = process.env.NINEROUTER_NODE || process.execPath;
      serverChild = spawn(nodeBin, [entry, "--port", String(port)], {
        cwd: serverDir,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    }
    if (serverChild) attachLogs(serverChild);
    else { reject(new Error("gateway spawn failed")); return; }
    waitForPort(port, 25000).then(resolve).catch(reject);
  });
}

function attachLogs(child) {
  if (child.stdout) child.stdout.on("data", (d) => process.stdout.write(`[gw] ${d}`));
  if (child.stderr) child.stderr.on("data", (d) => process.stderr.write(`[gw] ${d}`));
  child.on("exit", (code) => {
    if (isQuitting) { serverChild = null; return; }
    console.error(`[9Router] gateway exited unexpectedly (${code}); restarting in 2s`);
    serverChild = null;
    // Auto-relaunch the gateway after an unexpected crash (not on quit).
    setTimeout(async () => {
      try {
        const port = await ensureRunning();
        console.log(`[9Router] gateway restarted on port ${port}`);
        notifyGatewayReady(port);
      } catch (e) {
        console.error("[9Router] gateway auto-restart failed:", e && e.message ? e.message : e);
      }
    }, 2000);
  });
}

function stopServer() {
  return new Promise((resolve) => {
    if (!serverChild) return resolve();
    const child = serverChild;
    serverChild = null;
    try { child.kill(); } catch {}
    setTimeout(resolve, 1500);
  });
}

// 3) Port-conflict handling: if the preferred port is occupied by a foreign
// process (not our gateway), kill that process and take the port. This keeps
// the app on its stable URL instead of silently switching ports.
function killPortOwner(port) {
  return new Promise((resolve) => {
    let cmd = "";
    if (process.platform === "win32") {
      cmd = `netstat -ano | findstr "LISTENING" | findstr ":${port} "`;
    } else {
      cmd = `lsof -ti tcp:${port}`;
    }
    exec(cmd, (err, stdout) => {
      if (err || !stdout) return resolve(false);
      // Extract PIDs (last column on Windows, one per line on Unix).
      const pids = [...new Set(
        String(stdout).split(/\r?\n/)
          .map((l) => l.trim().split(/\s+/).pop())
          .filter((p) => p && /^\d+$/.test(p))
      )];
      for (const pid of pids) {
        try {
          if (process.platform === "win32") {
            exec(`taskkill /F /PID ${pid}`, () => {});
          } else {
            process.kill(Number(pid), "SIGKILL");
          }
        } catch { /* ignore */ }
      }
      setTimeout(resolve, 500, true);
    });
  });
}

async function ensureRunning() {
  const port = prefs.port || DEFAULT_PORT;
  const alreadyUp = await new Promise((r) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); r(true); });
    s.once("error", () => r(false));
  });
  if (alreadyUp) return port;
  // Not up: try to free the port (kill any foreign listener) before spawning.
  const freed = await killPortOwner(port);
  if (freed) console.log(`[9Router] freed port ${port} from another process`);
  await startServer();
  return port;
}

function openPanel() {
  const url = `http://127.0.0.1:${prefs.port || DEFAULT_PORT}/dashboard`;
  // Desktop default to Simplified Chinese when no locale cookie is set yet.
  try {
    const ses = require("electron").session.defaultSession;
    ses.cookies.set({
      url: `http://127.0.0.1:${prefs.port || DEFAULT_PORT}`,
      name: "locale",
      value: "zh-CN",
      domain: "127.0.0.1",
      path: "/",
    });
  } catch { /* cookies are best-effort */ }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(url);
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false, // avoid white flash; show on ready-to-show
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(url);
  mainWindow.on("closed", () => { mainWindow = null; });
}

// Manual update check (tray / menu): force check now and surface result.
function checkForUpdatesNow() {
  try {
    autoUpdater.checkForUpdates().then((r) => {
      if (!r || !r.updateInfo) return dialog.showMessageBoxSync({ type: "info", title: "检查更新", message: "已是最新版本。" });
      // update-available handler will download + prompt.
      dialog.showMessageBoxSync({ type: "info", title: "检查更新", message: `发现新版本 ${r.updateInfo.version}，正在后台下载…` });
    }).catch((e) => {
      dialog.showMessageBoxSync({ type: "error", title: "检查更新", message: `检查失败：${e && e.message}` });
    });
  } catch (e) {
    dialog.showMessageBoxSync({ type: "error", title: "检查更新", message: `检查失败：${e && e.message}` });
  }
}

function showAbout() {
  const cp = require("child_process");
  let nodeVer = "n/a", electronVer = "n/a";
  try { nodeVer = process.versions.node; } catch {}
  try { electronVer = process.versions.electron; } catch {}
  dialog.showMessageBoxSync({
    type: "info",
    title: "关于 9Router",
    message: `9Router Desktop v${APP_VERSION}\n本地 AI 路由网关\n\n数据目录：${DESKTOP_DATA_DIR}\n端口：${prefs.port || DEFAULT_PORT}\nNode ${nodeVer} · Electron ${electronVer}\n\n更新源：${process.env.NINEROUTER_UPDATE_URL ? "自定义" : "GitHub Releases (lza6/9router-Max)"}`,
  });
}

// 5) Boot notification: inform the user once the gateway is listening.
let bootNotified = false;
function notifyGatewayReady(port) {
  if (bootNotified || !Notification.isSupported()) return;
  bootNotified = true;
  try {
    const n = new Notification({
      title: "9Router 已就绪",
      body: `本地网关已在 http://127.0.0.1:${port} 运行。`,
      icon: path.join(__dirname, "assets", "icon.png"),
    });
    n.on("click", openPanel);
    n.show();
  } catch { /* notifications are best-effort */ }
}

// Simple splash window shown while the gateway boots (avoids blank white).
let splashWindow = null;
function showSplash() {
  if (process.env.ELECTRON_HEADLESS === "1") return;
  try {
    splashWindow = new BrowserWindow({
      width: 360,
      height: 240,
      frame: false,
      resizable: false,
      alwaysOnTop: true,
      center: true,
      backgroundColor: "#1a1a1a",
      webPreferences: { nodeIntegration: false, contextIsolation: true },
    });
    splashWindow.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(
        `<!doctype html><html><body style="margin:0;background:#1a1a1a;color:#fff;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh">
        <div style="font-size:40px">🌐</div>
        <div style="margin-top:14px;font-size:16px;font-weight:600">9Router</div>
        <div style="margin-top:6px;font-size:12px;color:#9ca3af">本地网关启动中…</div>
        </body></html>`
      )
    );
  } catch { splashWindow = null; }
}
function hideSplash() {
  try { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close(); } catch {}
  splashWindow = null;
}

function setupAutoUpdate() {
  // Background auto-update: check GitHub Releases on a schedule and notify.
  try {
    autoUpdater.autoDownload = false; // we download in background then prompt
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("update-available", (info) => {
      console.log(`[9Router] update available: ${info.version}`);
      autoUpdater.downloadUpdate().catch((e) => console.error("[9Router] update dl failed:", e.message));
    });
    autoUpdater.on("update-downloaded", (info) => {
      console.log(`[9Router] update downloaded ${info.version}, prompting restart`);
      const choice = dialog.showMessageBoxSync({
        type: "info",
        buttons: ["立即重启安装", "稍后"],
        defaultId: 0,
        title: "9Router 更新就绪",
        message: `新版本 ${info.version} 已下载完成，重启后自动安装。`,
      });
      if (choice === 0) {
        isQuitting = true;
        try { if (serverChild) serverChild.kill(); } catch {}
        autoUpdater.quitAndInstall(false, true);
      }
    });
    autoUpdater.on("error", (e) => console.error("[9Router] updater error:", e && e.message));
    // Optional override for testing/mirroring: NINEROUTER_UPDATE_URL points to a
    // custom feed (e.g. a local static server or a China-friendly mirror).
    if (process.env.NINEROUTER_UPDATE_URL) {
      autoUpdater.setFeedURL({ provider: "generic", url: process.env.NINEROUTER_UPDATE_URL });
    }
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((e) => console.error("[9Router] updater check failed:", e && e.message));
    }, 8000); // give the gateway/window time to boot first
  } catch (e) {
    console.error("[9Router] auto-update init failed:", e.message);
  }
}

function setupTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png"));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const menu = Menu.buildFromTemplate([
    { label: "打开面板", click: openPanel },
    { type: "separator" },
    { label: "启动服务", click: async () => { await ensureRunning(); openPanel(); notifyGatewayReady(prefs.port || DEFAULT_PORT); } },
    { label: "停止服务", click: async () => { await stopServer(); } },
    { label: "检查更新", click: checkForUpdatesNow },
    { label: "开机自启", type: "checkbox", checked: prefs.autostart, click: (item) => { prefs.autostart = item.checked; savePrefs(prefs); setAutoStart(item.checked); } },
    { type: "separator" },
    { label: "关于", click: showAbout },
    { label: "退出", click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip("9Router — AI Gateway");
  tray.setContextMenu(menu);
  tray.on("double-click", openPanel);
  tray.on("click", openPanel);
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled });
}

app.whenReady().then(async () => {
  if (!hasInstanceLock) return; // second instance already quit above
  try {
    showSplash();
    setupTray();
    setupAutoUpdate();
    // Resolve gateway node_modules from bundled archive if packaged.
    if (isPacked) {
      const ok = await ensureGatewayModules();
      console.log(`[9Router] gateway modules ${ok ? "ready" : "extract failed"}`);
    }
    // Start the gateway first (utilityProcess needs app ready).
    await bootGateway();
    notifyGatewayReady(prefs.port || DEFAULT_PORT);
    hideSplash();
    // Install trusted self-signed root cert (Windows user store), then try HTTPS.
    if (prefs.https !== false) {
      try {
        const cert = ensureCert();
        if (cert) {
          installRootCert(cert.rootCert, () => {});
          prefs.https = true;
          savePrefs(prefs);
        }
      } catch (e) {
        console.error("[9Router] cert setup failed:", e.message);
        prefs.https = false;
        savePrefs(prefs);
      }
    }
    if (process.env.ELECTRON_HEADLESS !== "1") {
      try { openPanel(); } catch { /* keep running in tray */ }
    }
    console.log("[9Router] tray + panel ready");
  } catch (e) {
    hideSplash();
    console.error("[9Router] startup error:", e && e.message ? e.message : e);
  }
});

app.on("window-all-closed", () => {
  // Keep the process alive (tray + gateway) on every platform; do not quit.
  // Re-opening is handled via tray/"打开面板".
});

app.on("before-quit", async () => {
  isQuitting = true;
  await stopServer();
});
