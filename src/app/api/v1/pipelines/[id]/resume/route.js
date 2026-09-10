import { NextResponse } from "next/server";
import { getPipelineRunById, getPipelineArtifacts, toPublicRun } from "@/lib/db/index.js";
import { runPipeline } from "@/lib/pipeline/runner.js";
import { extractApiKey } from "@/sse/services/auth.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" };

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * POST /v1/pipelines/{id}/resume — 续跑（断点恢复）
 *
 * 幂等：已产出同名产物的阶段会被跳过，因此对已完成的 run 调用是安全的空操作。
 * body: { model?: string }
 */
export async function POST(request, { params }) {
  let body = {};
  try {
    body = (await request.json()) || {};
  } catch {
    body = {};
  }

  try {
    const { id } = await params;
    const run = await getPipelineRunById(id);
    if (!run) return json({ error: { message: "pipeline run not found" } }, 404);
    if (run.status === "cancelled") return json({ error: { message: "pipeline run is cancelled" } }, 409);

    const apiKey = extractApiKey(request);
    const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;

    const result = await runPipeline(id, { apiKey, model });
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
    console.error("Error resuming pipeline:", error);
    return json({ error: { message: error?.message || "操作失败" } }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
