"use client";

import { useState, useEffect, useRef } from "react";
import { Card, Button } from "@/shared/components";
import { CONSOLE_LOG_CONFIG } from "@/shared/constants/config";

const LOG_LEVEL_COLORS = {
  LOG: "text-green-400",
  INFO: "text-blue-400",
  WARN: "text-yellow-400",
  ERROR: "text-red-400",
  DEBUG: "text-purple-400",
};

function colorLine(line) {
  const match = line.match(/\[(\w+)\]/g);
  const levelTag = match ? match[1]?.replace(/\[|\]/g, "") : null;
  const color = LOG_LEVEL_COLORS[levelTag] || "text-green-400";
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
        <a href="/dashboard/expert" className="text-xs text-primary hover:underline underline-offset-2">去「练习」页做 3 分钟小测验</a>
      </div>
    </div>
  );
}

export default function ConsoleLogClient() {
  const [logs, setLogs] = useState([]);
  const [connected, setConnected] = useState(false);
  const logRef = useRef(null);

  const handleClear = async () => {
    try {
      await fetch("/api/console-logs", { method: "DELETE" });
      // UI cleared via SSE "clear" event
    } catch (err) {
      console.error("Failed to clear console logs:", err);
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

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  return (
    <div className="">
      <Card>
        <div className="px-4 pt-3 pb-1">
          <LogTeachingHeader hasLogs={logs.length > 0} />
        </div>
        <div className="flex items-center justify-end px-4 pt-2 pb-2">
          <Button size="sm" variant="outline" icon="delete" onClick={handleClear}>
            Clear
          </Button>
        </div>
        <div
          ref={logRef}
          className="bg-black rounded-b-lg p-4 text-xs font-mono h-[calc(100vh-220px)] overflow-y-auto"
        >
          {logs.length === 0 ? (
            <span className="text-text-muted">还没有日志。发一条请求后这里会实时出现。</span>
          ) : (
            <div className="space-y-0.5">
              {logs.map((line, i) => (
                <div key={i}>{colorLine(line)}</div>
              ))}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
