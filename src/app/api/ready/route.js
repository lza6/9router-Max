import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// GET /api/ready — 就绪探针：DB 可写即 ready。
// 不加真实付费上游调用（避免误触配额）；上游可达性由 /api/health + 各 provider 的 test 端点覆盖。
export async function GET() {
  try {
    const db = await getAdapter();
    // 快速写探针：不改变任何数据
    db.run(`SELECT 1`);
    const driver = db.driver || "sqlite";
    return NextResponse.json(
      { ok: true, db: "sqlite", driver, note: "ready — upstream reachability not probed to avoid paid calls" },
      { headers: NO_STORE_HEADERS }
    );
  } catch (error) {
    console.log("Ready check failed:", error);
    return NextResponse.json({ ok: false, db: "unavailable" }, { status: 503, headers: NO_STORE_HEADERS });
  }
}