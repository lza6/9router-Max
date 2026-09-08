// 9Router Desktop — main process
// Spawns the standalone gateway (custom-server.js so local requests are trusted),
// creates a native window pointing at http://localhost:PORT/dashboard,
// and adds a system tray with start/stop/open/autostart controls.
"use strict";

const { app, BrowserWindow, Tray, Menu, dialog, nativeImage, utilityProcess } = require("electron");
const { spawn, exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const net = require("net");

const DEFAULT_PORT = 20128;
const APP_NAME = "9Router";
const PREF = path.join(app.getPath("userData"), "prefs.json");
let mainWindow = null;
let tray = null;
let serverChild = null;
let isQuitting = false;

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
    if (!isQuitting) console.error(`[9Router] gateway exited: ${code}`);
    serverChild = null;
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

async function ensureRunning() {
  const port = prefs.port || DEFAULT_PORT;
  const alreadyUp = await new Promise((r) => {
    const s = net.connect(port, "127.0.0.1");
    s.once("connect", () => { s.destroy(); r(true); });
    s.once("error", () => r(false));
  });
  if (alreadyUp) return port;
  await startServer();
  return port;
}

function openPanel() {
  const url = `http://127.0.0.1:${prefs.port || DEFAULT_PORT}/dashboard`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL(url);
    mainWindow.show();
    return;
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    autoHideMenuBar: true,
    icon: path.join(__dirname, "assets", "icon.png"),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  mainWindow.loadURL(url);
  mainWindow.on("closed", () => { mainWindow = null; });
}

function setupTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "assets", "icon.png"));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  const menu = Menu.buildFromTemplate([
    { label: "打开面板", click: openPanel },
    { type: "separator" },
    { label: "启动服务", click: async () => { await ensureRunning(); openPanel(); } },
    { label: "停止服务", click: async () => { await stopServer(); } },
    { label: "开机自启", type: "checkbox", checked: prefs.autostart, click: (item) => { prefs.autostart = item.checked; savePrefs(prefs); setAutoStart(item.checked); } },
    { type: "separator" },
    { label: "退出", click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setToolTip("9Router — AI Gateway");
  tray.setContextMenu(menu);
  tray.on("double-click", openPanel);
}

function setAutoStart(enabled) {
  app.setLoginItemSettings({ openAtLogin: enabled });
}

app.whenReady().then(async () => {
  try {
    setupTray();
    // Resolve gateway node_modules from bundled archive if packaged.
    if (isPacked) {
      const ok = await ensureGatewayModules();
      console.log(`[9Router] gateway modules ${ok ? "ready" : "extract failed"}`);
    }
    // Start the gateway first (utilityProcess needs app ready).
    await bootGateway();
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
