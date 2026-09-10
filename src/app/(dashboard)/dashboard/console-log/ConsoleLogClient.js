"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { Card, Button, Input } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

// 从形如 "... [CHAT] ..." 的行里取第一个方括号标签作为级别；取不到归为 LOG。
const LEVEL_RE = /\[(\w+)\]/;
const KNOWN_LEVELS = ["ERROR", "WARN", "INFO", "DEBUG", "LOG"];

function levelOf(line) {
  const m = String(line).match(LEVEL_RE);
  const tag = m ? m[1].toUpperCase() : null;
  return KNOWN_LEVELS.includes(tag) ? tag : "LOG";
}

function colorLine(line) {
  const color = LOG_LEVEL_COLORS[levelOf(line)] || "text-green-400";
  return <span className={color}>{line}</span>;
}

// 教学头（黑匣子打开）：给小白解释日志是什么、哪些行重要、以及下一步。
// 仅在「至少有一条日志」时展示实时事件；空态时给一句白话说明。
function LogTeachingHeader({ hasLogs }) {
  return (
    <div className="mb-3 rounded-[14px] border border-black/5 dark:border-white/5 bg-white/40 dark:bg-white/5 p-4 text-[13px] leading-6 text-text-main">
      <p className="font-semibold mb-1">这里显示的是请求日志</p>
      {hasLogs ? (
        <p className="text-text-muted">
          每条请求按时间顺序滚动展示。看到 <span className="text-red-500 font-mono text-xs">[ERROR]</span>{" "}
          行就说明那一步失败了——把那一行（连同前面的 <span className="text-blue-500 font-mono text-xs">[INFO]</span>{" "}
          上下文）复制给客服或 AI，就能快速定位问题。慢请求看响应里的{" "}
          <code className="font-mono text-[12px]">metrics.response_time_ms</code> 与{" "}
          <code className="font-mono text-[12px]">upstream_latency_ms</code>。
        </p>
      ) : (
        <p className="text-text-muted">
          发一条请求（或在 CLI 里调用一次）后，这里会实时出现日志。出错时打开它，把{" "}
          <span className="text-red-500 font-mono text-xs">[ERROR]</span> 行复制给客服/AI 即可。
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <a href="/dashboard/skills" className="text-xs text-primary hover:underline underline-offset-2">去「技能」页复制可用的技能</a>
        <span className="text-xs text-text-muted">·</span>
        <a href="/dashboard/usage" className="text-xs text-primary hover:underline underline-offset-2">去「用量」页看每次请求的执行轨迹</a>
      </div>
    </div>
  );
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [activeLevels, setActiveLevels] = useState(() => new Set()); // 空集 = 不按级别过滤
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const logRef = useRef(null);

  const handleClear = async () => {
    try {
      await fetch("/api/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
    }
  };

  const toggleLevel = (lv) => {
    setActiveLevels((prev) => {
      const next = new Set(prev);
      if (next.has(lv)) next.delete(lv);
      else next.add(lv);
      return next;
    });
  };

  const copyFiltered = async () => {
    try {
      await navigator.clipboard.writeText(filtered.map((l) => l.line).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  useEffect(() => {
    const es = new EventSource("/api/console-logs/stream");

    es.onopen = () => setConnected(true);

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "init") {
        setLogs(msg.logs.slice(-CONSOLE_LOG_CONFIG.maxLines));
      } else if (msg.type === "line") {
        setLogs((prev) => {
          const next = [...prev, msg.line];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "lines") {
        setLogs((prev) => {
          const next = [...prev, ...msg.lines];
          return next.length > CONSOLE_LOG_CONFIG.maxLines ? next.slice(-CONSOLE_LOG_CONFIG.maxLines) : next;
        });
      } else if (msg.type === "clear") {
        setLogs([]);
      }
    };

    es.onerror = () => setConnected(false);

    return () => es.close();
  }, []);

  // 预计算级别，避免每次渲染重复正则
  const tagged = useMemo(() => logs.map((line) => ({ line, level: levelOf(line) })), [logs]);

  const levelCounts = useMemo(() => {
    const c = { ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, LOG: 0 };
    for (const t of tagged) c[t.level] = (c[t.level] || 0) + 1;
    return c;
  }, [tagged]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tagged.filter((t) => {
      if (activeLevels.size > 0 && !activeLevels.has(t.level)) return false;
      if (q && !t.line.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tagged, activeLevels, query]);

  // Auto-scroll to bottom on new logs（可被"跟随"开关关闭，便于翻看历史）
  useEffect(() => {
    if (!follow || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [filtered, follow]);

  const hasFilter = activeLevels.size > 0 || query.trim().length > 0;

  return (
    <div className="">
      <Card>
        <div className="px-4 pt-3 pb-1">
          <LogTeachingHeader hasLogs={logs.length > 0} />
        </div>

        {/* 过滤条（P1-3）：级别多选 + 关键字 + 跟随/复制 */}
        <div className="flex flex-wrap items-center gap-2 px-4 pt-1 pb-2">
          {KNOWN_LEVELS.map((lv) => {
            const active = activeLevels.has(lv);
            const n = levelCounts[lv] || 0;
            return (
              <button
                key={lv}
                type="button"
                onClick={() => toggleLevel(lv)}
                aria-pressed={active}
                className={[
                  "rounded-full border px-2.5 py-1 text-[11px] font-mono transition-colors",
                  active
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-black/10 dark:border-white/10 text-text-muted hover:text-text-main",
                  n === 0 ? "opacity-40" : "",
                ].join(" ")}
                title={`只看 ${lv}（当前 ${n} 条）`}
              >
                {lv} <span className="opacity-70">{n}</span>
              </button>
            );
          })}

          <div className="min-w-[180px] flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="过滤关键字（如 429、provider 名、模型名）"
              aria-label="日志关键字过滤"
            />
          </div>

          <Button
            size="sm"
            variant={follow ? "primary" : "outline"}
            onClick={() => setFollow((v) => !v)}
            title="打开后自动滚到最新一条"
          >
            {follow ? "跟随中" : "已暂停"}
          </Button>
          <Button size="sm" variant="outline" onClick={copyFiltered} disabled={filtered.length === 0}>
            {copied ? "已复制" : "复制筛选结果"}
          </Button>
          {hasFilter && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => { setActiveLevels(new Set()); setQuery(""); }}
            >
              清除筛选
            </Button>
          )}
          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
            Clear
          </Button>

          <span className="text-[11px] text-text-muted">
            {hasFilter ? `${filtered.length} / ${logs.length} 条` : `${logs.length} 条`}
            {connected ? "" : " · 未连接"}
          </span>
        </div>

        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-260px)] overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-text-muted">还没有日志。发一条请求后这里会实时出现。</span>
          ) : filtered.length === 0 ? (
            <span className="text-text-muted">当前筛选条件下没有匹配的日志。试试「清除筛选」。</span>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((t, i) => (
                <div key={i}>{colorLine(t.line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
