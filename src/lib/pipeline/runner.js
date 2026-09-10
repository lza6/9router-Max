import {
  getPipelineRunById,
  getPipelineArtifacts,
  addPipelineArtifact,
  updatePipelineRun,
} from "@/lib/db/index.js";
import { getStages } from "./stages.js";

// P1-4 生产线执行器。
//
// 语义：
//   • 阶段按序执行，每个阶段产出 1 条 artifact（name = 阶段名）。
//   • **断点恢复**：已存在同名 artifact 的阶段直接跳过（幂等），因此重复调用
//     runPipeline 只会补跑未完成的部分 —— 这是「重启后可继续」的实现基础。
//   • 任一阶段失败 → run 置 failed + error，并**保留已完成阶段的产物**。
//   • stage/stageIndex/stageTotal 每次推进都落库，前端可展示「分镜 3/5」。

/**
 * 执行（或续跑）一条流水线。
 * @param {string} runId
 * @param {{ apiKey?: string, model?: string }} opts model 缺省用 run.input.model，再缺省 "gpt-4o-mini"
 * @returns {Promise<{run: object, artifacts: object[], skipped: string[]}>}
 */
export async function runPipeline(runId, opts = {}) {
  const run = await getPipelineRunById(runId);
  if (!run) throw new Error("pipeline run not found");

  const stages = getStages(run.kind);
  if (!stages) throw new Error(`unknown pipeline kind: ${run.kind}`);

  if (run.status === "completed") {
    const artifacts = await getPipelineArtifacts(runId);
    return { run, artifacts, skipped: stages.map((s) => s.name) };
  }
  if (run.status === "cancelled") {
    throw new Error("pipeline run is cancelled");
  }

  const model = opts.model || run.input?.model || "gpt-4o-mini";
  const topic = run.input?.topic || run.title || "未命名主题";
  const apiKey = opts.apiKey;

  // 断点恢复：已被产出的阶段直接跳过
  const existing = await getPipelineArtifacts(runId);
  const artifacts = {};
  for (const a of existing) {
    if (a.name && a.content != null) artifacts[a.name] = a.content;
  }
  const skipped = [];

  await updatePipelineRun(runId, { status: "running", stageTotal: stages.length });

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];

    if (Object.prototype.hasOwnProperty.call(artifacts, stage.name)) {
      skipped.push(stage.name);
      continue;
    }

    await updatePipelineRun(runId, { stage: stage.name, stageIndex: i, stageTotal: stages.length });

    let output;
    try {
      output = await stage.run({ topic, apiKey, model, artifacts });
    } catch (e) {
      const message = e?.message ? String(e.message) : String(e);
      await updatePipelineRun(runId, { status: "failed", error: `${stage.name}: ${message}` });
      const after = await getPipelineArtifacts(runId);
      return { run: await getPipelineRunById(runId), artifacts: after, skipped, failedStage: stage.name };
    }

    await addPipelineArtifact({
      runId,
      stage: stage.name,
      kind: "text",
      name: stage.name,
      content: output,
      meta: { index: i, model },
    });
    artifacts[stage.name] = output;
  }

  await updatePipelineRun(runId, {
    status: "completed",
    stage: stages[stages.length - 1]?.name || null,
    stageIndex: stages.length - 1,
    stageTotal: stages.length,
    error: null,
  });

  return { run: await getPipelineRunById(runId), artifacts: await getPipelineArtifacts(runId), skipped };
}
