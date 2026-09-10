import { NextResponse } from "next/server";
import { createPipelineRun, getPipelineRuns, getResumablePipelineRuns, toPublicRun } from "@/lib/db/index.js";
import { listPipelineKinds, getStages } from "@/lib/pipeline/stages.js";
import { runPipeline } from "@/lib/pipeline/runner.js";
import { extractApiKey } from "@/sse/services/auth.js";
import { initRateLimiter, checkRateLimit } from "@/lib/rateLimit.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_TOPIC_LEN = 500;

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

function err(message, status = 400) {
  return json({ error: { message } }, status);
}

/** GET /v1/pipelines — 列出流水线运行（可选 ?status= &kind= &limit= &resumable=1）与可用生产线类型 */
export async function GET(request) {
  try {
    const sp = request?.nextUrl?.searchParams;
    // ?resumable=1：只返回未完成（pending/running）的 run —— 进程重启后可据此续跑。
    const runs = sp?.get("resumable") === "1"
      ? await getResumablePipelineRuns()
      : await getPipelineRuns({
          status: sp?.get("status") || undefined,
          kind: sp?.get("kind") || undefined,
          limit: sp?.has("limit") ? Number(sp.get("limit")) : undefined,
        });
    return json({ success: true, runs: runs.map(toPublicRun), kinds: listPipelineKinds() });
  } catch (error) {
    console.error("Error listing pipelines:", error);
    return err("操作失败", 500);
  }
}

/**
 * POST /v1/pipelines — 创建并执行一条流水线
 * body: { kind: "doc", topic: string, model?: string, async?: boolean }
 *   async=true 时立即返回 pending 的 run（后台继续跑），默认同步等到完成。
 */
export async function POST(request) {
  // 应用层限流（默认关闭；RATE_LIMIT_ENABLED=true 时生效）。
  // 与 /v1/chat/completions 同款：一次 run 会触发 N 次上游调用，因此在**路由层**
  // 按客户端计数才是正确的放大倍数控制点（内部阶段调用不再重复计数，
  // 它们同属用户这一次操作）。
  const rl = initRateLimiter();
  const lim = await checkRateLimit(request, rl);
  if (!lim.ok) {
    return NextResponse.json(
      { error: { message: "Rate limit exceeded", type: "rate_limit_error", code: "rate_limit_exceeded" } },
      { status: 429, headers: { ...NO_STORE, "Retry-After": String(lim.retryAfter || 1) } }
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return err("Request body must be valid JSON");
  }

  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;

  if (!kind) return err("kind is required");
  if (!getStages(kind)) {
    return err(`unknown pipeline kind: ${kind}. 可用：${listPipelineKinds().map((k) => k.kind).join(", ")}`);
  }
  if (!topic) return err("topic is required");
  if (topic.length > MAX_TOPIC_LEN) return err(`topic exceeds ${MAX_TOPIC_LEN} chars`);

  const apiKey = extractApiKey(request);

  try {
    const stages = getStages(kind);
    const run = await createPipelineRun({
      kind,
      title: topic,
      input: { topic, model: model || null },
      stageTotal: stages.length,
      stages: stages.map((s) => s.name),
    });

    if (body.async === true) {
      // 后台推进；错误已在 runner 内落库为 failed，此处仅防未捕获拒绝。
      Promise.resolve()
        .then(() => runPipeline(run.id, { apiKey, model }))
        .catch((e) => console.error("[pipeline] async run failed:", e?.message || e));
      return json({ success: true, run: toPublicRun(run), async: true }, 202);
    }

    const result = await runPipeline(run.id, { apiKey, model });
    const ok = result.run?.status === "completed";
    return json(
      {
        success: ok,
        run: toPublicRun(result.run),
        artifacts: result.artifacts.map((a) => ({ stage: a.stage, name: a.name, kind: a.kind, content: a.content })),
        skipped: result.skipped,
        ...(result.failedStage ? { failedStage: result.failedStage } : {}),
      },
      ok ? 200 : 502
    );
  } catch (error) {
    console.error("Error running pipeline:", error);
    return err(error?.message || "操作失败", 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
