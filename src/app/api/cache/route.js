import { NextResponse } from "next/server";
import { getResponseCacheStats, clearResponseCache, purgeExpiredCache } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" };

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** GET /api/cache — 精确响应缓存统计（total / live / hits） */
export async function GET() {
  try {
    const stats = await getResponseCacheStats();
    return json({ success: true, ...stats });
  } catch (error) {
    console.error("Error reading cache stats:", error);
    return json({ error: "操作失败" }, 500);
  }
}

/** DELETE /api/cache — 清空缓存；?purge=expired 只清过期条目 */
export async function DELETE(request) {
  try {
    const purgeOnly = request?.nextUrl?.searchParams?.get("purge") === "expired";
    const removed = purgeOnly ? await purgeExpiredCache() : await clearResponseCache();
    return json({ success: true, removed, purgeOnly });
  } catch (error) {
    console.error("Error clearing cache:", error);
    return json({ error: "操作失败" }, 500);
  }
}
