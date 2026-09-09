#!/usr/bin/env node
/**
 * Build the 9Router Windows desktop app (Electron shell + bundled gateway).
 *
 * Flow:
 *   1. Prepares electron/gateway from the Next.js standalone build (.next-b/standalone).
 *   2. Runs electron-builder --dir → release/win-unpacked/9Router.exe.
 *   3. Copies gateway node_modules into the packaged resources/app (electron-builder
 *      never copies nested node_modules via extraResources — hard-coded exclusion),
 *      so the gateway resolves `next` at runtime.
 *
 * Result: release/win-unpacked/9Router.exe — double-click to launch the gateway
 * (port 20128) + tray + dashboard window.
 *
 * Requires (already in repo / this machine):
 *   - Node.js (>=18) with npm
 *   - node_modules/electron (dev) — installed with ELECTRON_MIRROR fallback
 *   - electron/ devDeps: electron-builder
 *   - An existing standalone build under .next-b/standalone
 *     (produce with: NEXT_DIST_DIR=.next-b npm run build)
 */
"use strict";

const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ELECTRON_DIR = path.join(ROOT, "electron");
const STANDALONE = path.join(ROOT, ".next-b", "standalone");
const GATEWAY = path.join(ELECTRON_DIR, "gateway");
const RELEASE = path.join(ROOT, "release");
const WIN_UNPACKED = path.join(RELEASE, "win-unpacked");

function sh(cmd, opts = {}) {
  console.log(`> ${cmd}`);
  return execSync(cmd, { stdio: "inherit", ...opts });
}

function step(name) {
  console.log(`\n== ${name} ==`);
}

function assertStandalone() {
  for (const f of ["server.js", "custom-server.js"]) {
    if (!fs.existsSync(path.join(STANDALONE, f))) {
      throw new Error(`Missing standalone file ${f} in ${STANDALONE}. Run: NEXT_DIST_DIR=.next-b npm run build`);
    }
  }
}

function copyDir(src, dest) {
  // robocopy returns 0/1 (success) or >=8 (failure). Use execSync with
  // status 1 tolerated (files copied) — exit >=8 is a real failure.
  try {
    require("child_process").execSync(
      `robocopy "${src}" "${dest}" /E /NFL /NDL /NJH /NJS /NP`,
      { stdio: "inherit" }
    );
  } catch (e) {
    if (!e.status || e.status >= 8) throw e;
  }
}

function prepareGateway() {
  step("1/4  Prepare electron/gateway from standalone build");
  fs.rmSync(GATEWAY, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(GATEWAY), { recursive: true });
  copyDir(STANDALONE, GATEWAY);
  // Ensure the gateway node_modules is present (it is traced into standalone).
  if (!fs.existsSync(path.join(GATEWAY, "node_modules", "next", "package.json"))) {
    throw new Error("Gateway node_modules missing next — standalone build incomplete");
  }
  console.log("gateway ready:", GATEWAY);
}

function runBuilder() {
  step("2/4  electron-builder --dir (win-unpacked)");
  const cmd = `npx.cmd electron-builder --dir --win`;
  const res = spawnSync("cmd.exe", ["/c", cmd], {
    cwd: ELECTRON_DIR,
    stdio: "inherit",
    env: {
      ...process.env,
      PATH: `${process.env.WINDIR}\\System32\\WindowsPowerShell\\v1.0;${process.env.PATH || ""}`,
    },
  });
  if (res.status !== 0) throw new Error("electron-builder failed");
}

function copyGatewayModules() {
  step("3/4  Copy gateway node_modules into packaged app");
  const target = path.join(WIN_UNPACKED, "resources", "app", "node_modules");
  fs.rmSync(target, { recursive: true, force: true });
  copyDir(path.join(GATEWAY, "node_modules"), target);
  console.log("copied node_modules ->", target);
}

function verify() {
  step("4/4  Verify artifacts");
  const exe = path.join(WIN_UNPACKED, "9Router.exe");
  if (!fs.existsSync(exe)) throw new Error(`Missing ${exe}`);
  if (!fs.existsSync(path.join(WIN_UNPACKED, "resources", "app", "node_modules", "next", "package.json"))) {
    throw new Error("next not in packaged app");
  }
  const size = (fs.statSync(exe).size / (1024 * 1024)).toFixed(1);
  console.log(`✅ ${exe} (${size} MB)`);
  console.log(`✅ Double-click 9Router.exe → gateway on :20128 + tray + dashboard`);
}

assertStandalone();
prepareGateway();
runBuilder();
copyGatewayModules();
verify();

// NSIS installer + blockmap + latest.yml — must run AFTER copyGatewayModules
// because electron-builder rebuilds win-unpacked and wipes app/node_modules.
step("5/5  Build NSIS installer (after node_modules copy)");
const nsis = spawnSync("cmd.exe", ["/c", "set PATH=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0;%PATH% && npx.cmd electron-builder --win nsis --publish never"], {
  cwd: ELECTRON_DIR,
  stdio: "inherit",
  env: { ...process.env },
});
if (nsis.status !== 0) throw new Error("NSIS build failed");

// Re-copy gateway node_modules into the packaged win-unpacked that NSIS just
// rebuilt (it wiped app/node_modules).
copyGatewayModules();
console.log("✅ Desktop build complete: win-unpacked + NSIS + blockmap + latest.yml");
console.log("   → release/win-unpacked/9Router.exe (double-click)");
console.log("   → release/9Router-Setup-*.exe (installer / auto-update)");
