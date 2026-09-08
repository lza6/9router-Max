import Link from "next/link";
import { Button } from "@/shared/components";

// Dashboard 组 404 兜底（App Router 约定文件）。
export default function DashboardNotFound() {
  return (
    <div className="p-6 flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center">
      <div className="text-5xl" aria-hidden="true">🧭</div>
      <h2 className="text-lg font-semibold text-text-main">页面不存在</h2>
      <p className="text-sm text-text-muted max-w-md">
        你访问的地址不存在或已被移动。返回仪表盘看看有什么可用功能。
      </p>
      <Link href="/dashboard" className="inline-flex">
        <Button size="sm" icon="home">
          返回仪表盘
        </Button>
      </Link>
    </div>
  );
}