"use client";

import Link from "next/link";
import { Button } from "@/shared/components";

// Dashboard 组运行期错误兜底（App Router 约定文件）。
export default function DashboardError({ error, reset }) {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
      <div className="text-5xl" aria-hidden="true">⚠️</div>
      <h2 className="text-lg font-semibold text-text-main">页面出错了</h2>
      <p className="text-sm text-text-muted max-w-md">
        加载过程遇到异常（{error?.message || "未知错误"}）。可点击下方「重试」恢复，或返回仪表盘。
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