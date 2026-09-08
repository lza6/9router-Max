import { NextResponse } from "next/server";
import { getAdapter } from "@/lib/db/driver.js";
import { initRateLimiter } from "@/lib/rateLimit.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// GET /api/metrics — 轻量服务指标（JSON）。
// 不引入 opentelemetry 依赖；多实例/规模化时再演进为 Prometheus/OTel（见 docs/CI-CD-PIPELINE.md）。
export async function GET() {
  const mem = process.memoryUsage();
  const rl = initRateLimiter();
  let dbDriver = "unknown";
  try {
    const db = await getAdapter();
    dbDriver = db.driver || "sqlite";
  } catch {}

  const metrics = {
    process: {
      uptimeSec: Math.round(process.uptime()),
      pid: process.pid,
      node: process.version,
      memory: {
        rssBytes: mem.rss,
        heapUsedBytes: mem.heapUsed,
        heapTotalBytes: mem.heapTotal,
        externalBytes: mem.external,
      },
    },
    service: {
      dbDriver,
      rateLimiterBuckets: typeof rl?._size === "function" ? rl._size() : null,
      rateLimitEnabled: process.env.RATE_LIMIT_ENABLED === "true",
    },
  };
  return NextResponse.json(metrics, { headers: NO_STORE_HEADERS });
}