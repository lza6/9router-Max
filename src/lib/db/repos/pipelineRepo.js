import { getAdapter } from "../driver.js";
import { parseJson, stringifyJson } from "../helpers/jsonCol.js";

// P0-1 任务/流水线数据模型。
// 一次「做一件事」= 一条 pipelineRuns；其阶段产物落在 pipelineArtifacts。
// 目标：让长任务可持久化、可列举、可断点恢复、可向用户展示语义化进度。

export const PIPELINE_STATUSES = ["pending", "running", "completed", "failed", "cancelled"];

const MAX_TITLE_LEN = 200;
const MAX_ERROR_LEN = 2000;
const MAX_ARTIFACT_NAME_LEN = 200;
const MAX_ARTIFACT_CONTENT_LEN = 200_000;
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;

function nowIso() {
  return new Date().toISOString();
}

function makeId() {
  const rand = Math.random().toString(36).slice(2, 10);
  return `run_${Date.now()}_${rand}`;
}

function rowToRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    stage: row.stage || null,
    stageIndex: Number.isFinite(Number(row.stageIndex)) ? Number(row.stageIndex) : null,
    stageTotal: Number.isFinite(Number(row.stageTotal)) ? Number(row.stageTotal) : null,
    title: row.title || null,
    input: parseJson(row.input, null),
    error: row.error || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt || null,
  };
}

function rowToArtifact(row) {
  if (!row) return null;
  return {
    id: row.id,
    runId: row.runId,
    stage: row.stage || null,
    kind: row.kind || "text",
    name: row.name || null,
    content: row.content ?? null,
    meta: parseJson(row.meta, null),
    createdAt: row.createdAt,
  };
}

// 对外投影：剥掉内部字段（input.__stages 是运行器自己用的阶段清单，不属于 API 契约）。
export function toPublicRun(run) {
  if (!run) return run;
  const input = run.input && typeof run.input === "object" ? { ...run.input } : run.input;
  if (input && typeof input === "object") delete input.__stages;
  return { ...run, input };
}

export async function createPipelineRun({ kind, title = null, input = null, stageTotal = null, stages = null } = {}) {
  const k = typeof kind === "string" ? kind.trim() : "";
  if (!k) throw new Error("kind is required");
  const id = makeId();
  const ts = nowIso();
  // stages 是可选的阶段名清单 —— 存进 input.stages，供恢复时按序推进。
  const mergedInput = stages ? { ...(input || {}), __stages: stages } : input;
  const db = await getAdapter();
  db.run(
    `INSERT INTO pipelineRuns (id, kind, status, stage, stageIndex, stageTotal, title, input, error, createdAt, updatedAt, finishedAt)
     VALUES (?, ?, 'pending', NULL, NULL, ?, ?, ?, NULL, ?, ?, NULL)`,
    [id, k, stageTotal, title ? String(title).slice(0, MAX_TITLE_LEN) : null, stringifyJson(mergedInput), ts, ts]
  );
  return await getPipelineRunById(id);
}

export async function getPipelineRunById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT * FROM pipelineRuns WHERE id = ?`, [id]);
  return rowToRun(row);
}

export async function getPipelineRuns({ status, kind, limit = DEFAULT_LIST_LIMIT } = {}) {
  const db = await getAdapter();
  const conds = [];
  const params = [];
  if (status) { conds.push("status = ?"); params.push(status); }
  if (kind) { conds.push("kind = ?"); params.push(kind); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const cap = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_LIST_LIMIT) : DEFAULT_LIST_LIMIT;
  const rows = db.all(`SELECT * FROM pipelineRuns ${where} ORDER BY createdAt DESC LIMIT ?`, [...params, cap]);
  return rows.map(rowToRun);
}

// 阶段推进：同时更新 status/stage/stageIndex，供前端展示「分镜 3/5 · 生成插图」。
export async function updatePipelineRun(id, patch = {}) {
  const current = await getPipelineRunById(id);
  if (!current) return null;

  const sets = [];
  const params = [];

  if (patch.status !== undefined) {
    const s = String(patch.status);
    if (!PIPELINE_STATUSES.includes(s)) throw new Error(`invalid status: ${s}`);
    sets.push("status = ?"); params.push(s);
    if (s === "completed" || s === "failed" || s === "cancelled") {
      sets.push("finishedAt = ?"); params.push(nowIso());
    }
  }
  if (patch.stage !== undefined) { sets.push("stage = ?"); params.push(patch.stage ? String(patch.stage).slice(0, MAX_TITLE_LEN) : null); }
  if (patch.stageIndex !== undefined) { sets.push("stageIndex = ?"); params.push(Number.isFinite(Number(patch.stageIndex)) ? Number(patch.stageIndex) : null); }
  if (patch.stageTotal !== undefined) { sets.push("stageTotal = ?"); params.push(Number.isFinite(Number(patch.stageTotal)) ? Number(patch.stageTotal) : null); }
  if (patch.title !== undefined) { sets.push("title = ?"); params.push(patch.title ? String(patch.title).slice(0, MAX_TITLE_LEN) : null); }
  if (patch.error !== undefined) { sets.push("error = ?"); params.push(patch.error ? String(patch.error).slice(0, MAX_ERROR_LEN) : null); }

  if (!sets.length) return current;

  sets.push("updatedAt = ?"); params.push(nowIso());
  params.push(id);

  const db = await getAdapter();
  db.run(`UPDATE pipelineRuns SET ${sets.join(", ")} WHERE id = ?`, params);
  return await getPipelineRunById(id);
}

export async function deletePipelineRun(id) {
  const db = await getAdapter();
  db.run(`DELETE FROM pipelineArtifacts WHERE runId = ?`, [id]);
  db.run(`DELETE FROM pipelineRuns WHERE id = ?`, [id]);
}

// ── 产物 ────────────────────────────────────────────────────────────────
export async function addPipelineArtifact({ runId, stage = null, kind = "text", name = null, content = null, meta = null } = {}) {
  if (!runId) throw new Error("runId is required");
  const id = `art_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const db = await getAdapter();
  db.run(
    `INSERT INTO pipelineArtifacts (id, runId, stage, kind, name, content, meta, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, runId, stage,
      String(kind || "text"),
      name ? String(name).slice(0, MAX_ARTIFACT_NAME_LEN) : null,
      content == null ? null : String(content).slice(0, MAX_ARTIFACT_CONTENT_LEN),
      stringifyJson(meta),
      nowIso(),
    ]
  );
  return id;
}

export async function getPipelineArtifacts(runId) {
  const db = await getAdapter();
  const rows = db.all(`SELECT * FROM pipelineArtifacts WHERE runId = ? ORDER BY createdAt ASC`, [runId]);
  return rows.map(rowToArtifact);
}

// 断点恢复用：找出「未完成」的 run（进程重启后仍可继续）。
export async function getResumablePipelineRuns() {
  const db = await getAdapter();
  const rows = db.all(
    `SELECT * FROM pipelineRuns WHERE status IN ('pending','running') ORDER BY createdAt DESC`
  );
  return rows.map(rowToRun);
}
