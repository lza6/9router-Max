import { NextResponse } from "next/server";
import { getPipelineRunById, getPipelineArtifacts, deletePipelineRun, toPublicRun } from "@/lib/db/index.js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE = { "Cache-Control": "no-store" };

function json(body, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/** GET /v1/pipelines/{id} — 运行详情 + 全部阶段产物 */
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const run = await getPipelineRunById(id);
    if (!run) return json({ error: { message: "pipeline run not found" } }, 404);

    const artifacts = await getPipelineArtifacts(id);
    return json({
      success: true,
      run: toPublicRun(run),
      artifacts: artifacts.map((a) => ({
        id: a.id, stage: a.stage, name: a.name, kind: a.kind, content: a.content, meta: a.meta, createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    console.error("Error getting pipeline run:", error);
    return json({ error: { message: "操作失败" } }, 500);
  }
}

/** DELETE /v1/pipelines/{id} — 删除运行及其产物（幂等：不存在也返回成功） */
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const run = await getPipelineRunById(id);
    if (!run) return json({ success: true, deleted: false });
    await deletePipelineRun(id);
    return json({ success: true, deleted: true });
  } catch (error) {
    console.error("Error deleting pipeline run:", error);
    return json({ error: { message: "操作失败" } }, 500);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
