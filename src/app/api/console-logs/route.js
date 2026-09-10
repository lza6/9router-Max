import { NextResponse } from "next/server";
import { clearConsoleLogs, getConsoleLogs, initConsoleLogCapture, queryConsoleLogs } from "@/lib/consoleLogBuffer";

initConsoleLogCapture();

// GET /api/console-logs            → 全量（向后兼容，保持原样）
// GET /api/console-logs?q=&level=&since=&limit=  → 过滤查询（P1-3）
// 返回体始终含 success/logs 两个原有字段；过滤时额外带 matched/returned/truncated/levelCounts。
export async function GET(request) {
  try {
    const sp = request?.nextUrl?.searchParams;
    const hasFilter = sp && (sp.has("q") || sp.has("level") || sp.has("since") || sp.has("limit"));

    if (!hasFilter) {
      const logs = getConsoleLogs();
      return NextResponse.json({ success: true, logs });
    }

    const result = queryConsoleLogs({
      q: sp.get("q") || undefined,
      level: sp.get("level") || undefined,
      since: sp.get("since") || undefined,
      limit: sp.has("limit") ? Number(sp.get("limit")) : undefined,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("Error getting console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    clearConsoleLogs();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error clearing console logs:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
