import { EventEmitter } from "events";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config.js";

const consoleLevels = ["log", "info", "warn", "error", "debug"];

if (!global._consoleLogBufferState) {
  global._consoleLogBufferState = {
    logs: [],
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  global._consoleLogBufferState.emitter.setMaxListeners(50);
}

const state = global._consoleLogBufferState;

// Ensure emitter exists (handles hot reload with stale global)
if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}

// 结构化记录（P1-3）：{ level, text, ts }。这是过滤/查询的权威来源。
// 兼容热重载：老 global 只有 state.logs（纯字符串数组），此处做一次性迁移。
if (!Array.isArray(state.records)) {
  state.records = (Array.isArray(state.logs) ? state.logs : []).map((text) => ({ level: "info", text, ts: Date.now() }));
}

if (!state.pendingLines) state.pendingLines = [];
if (!state.flushTimer) state.flushTimer = null;

const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_LINES = 50;

function flushPendingLines() {
  state.flushTimer = null;
  if (!state.pendingLines.length) return;

  const lines = state.pendingLines.splice(0, state.pendingLines.length);
  state.emitter.emit("lines", lines);
}

function scheduleFlush() {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(flushPendingLines, FLUSH_INTERVAL_MS);
  state.flushTimer?.unref?.();
}

function toLogLine(level, args) {
  return args.map(formatArg).join(" ");
}

// Strip ANSI escape codes so terminal colors don't bleed into UI
const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(str) {
  return str.replace(ANSI_RE, "");
}

function formatArg(arg) {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try {
    return stripAnsi(JSON.stringify(arg));
  } catch {
    return stripAnsi(String(arg));
  }
}

function appendLine(level, text) {
  state.records.push({ level, text, ts: Date.now() });
  const maxLines = CONSOLE_LOG_CONFIG.maxLines;
  if (state.records.length > maxLines) {
    state.records = state.records.slice(-maxLines);
  }
  state.pendingLines.push(text);
  if (state.pendingLines.length >= MAX_BATCH_LINES) {
    if (state.flushTimer) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
    flushPendingLines();
  } else {
    scheduleFlush();
  }
}

export function initConsoleLogCapture() {
  if (state.patched) return;

  for (const level of consoleLevels) {
    state.originals[level] = console[level];
    console[level] = (...args) => {
      appendLine(level, toLogLine(level, args));
      state.originals[level](...args);
    };
  }

  state.patched = true;
}

export function getConsoleLogs() {
  return state.records.map((r) => r.text);
}

// P1-3：日志查询。纯内存谓词过滤（不依赖 FTS5 —— sql.js 回退驱动不支持 fts5）。
//   q     : 大小写不敏感子串匹配（同时匹配 text 与 level）
//   level : "error" | "warn" | "info" | "log" | "debug"；也接受逗号分隔多值
//   since : 毫秒时间戳或 ISO 字符串；只返回 ts >= since 的行
//   limit : 返回上限（默认 500，最大 maxLines）
// 返回 { logs: string[], items: {level,text,ts}[], total, matched, levelCounts }
export function queryConsoleLogs({ q, level, since, limit } = {}) {
  const all = state.records;
  const levelCounts = { error: 0, warn: 0, info: 0, log: 0, debug: 0 };
  for (const r of all) {
    if (levelCounts[r.level] !== undefined) levelCounts[r.level]++;
    else levelCounts[r.level] = 1;
  }

  const needle = typeof q === "string" && q.trim() ? q.trim().toLowerCase() : null;
  const sinceTs = parseSince(since);
  const wanted = parseLevels(level);

  let matched = all;
  if (needle) matched = matched.filter((r) => r.text.toLowerCase().includes(needle) || r.level.toLowerCase().includes(needle));
  if (wanted) matched = matched.filter((r) => wanted.has(r.level));
  if (sinceTs !== null) matched = matched.filter((r) => r.ts >= sinceTs);

  const maxLines = CONSOLE_LOG_CONFIG.maxLines;
  const cap = Number.isFinite(limit) && limit > 0 ? Math.min(limit, maxLines) : 500;
  const sliced = matched.length > cap ? matched.slice(-cap) : matched;

  return {
    logs: sliced.map((r) => r.text),
    items: sliced,
    total: all.length,
    matched: matched.length,
    returned: sliced.length,
    truncated: matched.length > sliced.length,
    levelCounts,
  };
}

function parseSince(since) {
  if (since === undefined || since === null || since === "") return null;
  if (typeof since === "number" && Number.isFinite(since)) return since;
  const asNum = Number(since);
  if (Number.isFinite(asNum) && String(since).trim() !== "") return asNum;
  const parsed = Date.parse(String(since));
  return Number.isNaN(parsed) ? null : parsed;
}

function parseLevels(level) {
  if (typeof level !== "string" || !level.trim()) return null;
  const parts = level.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) return null;
  // 允许 "error,warn" 这类多选；非法值直接弃用而非报错（查询接口容忍脏输入）
  const valid = parts.filter((p) => consoleLevels.includes(p));
  return valid.length ? new Set(valid) : null;
}

export function clearConsoleLogs() {
  state.records = [];
  state.emitter.emit("clear");
}

export function getConsoleEmitter() {
  return state.emitter;
}
