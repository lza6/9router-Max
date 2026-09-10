"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/shared/components";

// Dashboard 组运行期错误兜底（App Router 约定文件）。
// #310 这类水合/瞬时错误：首次出现自动重试一次（自愈），仍失败才展示按钮。
export default function DashboardError({ error, reset }) {
  const [retried, setRetried] = useState(false);
  const autoRetried = useRef(false);

  useEffect(() => {
    if (!autoRetried.current && !retried) {
      autoRetried.current = true;
      setRetried(true);
      // Auto-retry once after a tick so React can re-hydrate cleanly.
      const t = setTimeout(() => { try { reset(); } catch {} }, 400);
      return () => clearTimeout(t);
    }
  }, [reset, retried]);

  // If we already auto-retried and still failing, show the manual recovery UI.
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
      <div className="text-5xl" aria-hidden="true">⚠️</div>
      <h2 className="text-lg font-semibold text-text-main">页面出错了</h2>
      <p className="text-sm text-text-muted max-w-md">
        加载过程遇到异常（{error?.message || "未知错误"}）。已尝试自动恢复，仍可点击下方「重试」。
      </p>
      <div className="flex gap-2">
        <Button size="sm" icon="refresh" onClick={() => reset()}>
          重试
        </Button>
        <Link href="/dashboard" className="inline-flex">
          <Button size="sm" variant="outline" icon="home">
            返回仪表盘
          </Button>
        </Link>
      </div>
    </div>
  );
}