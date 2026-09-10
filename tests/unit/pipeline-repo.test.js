import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// P0-1 任务/流水线数据模型 —— 真实 DB 写读。
//
// ⚠️ 隔离要点：src/lib/dataDir.js 的 `DATA_DIR` 是**模块加载时求值**的常量，
//    必须先设 process.env.DATA_DIR、再**动态 import** DB 模块链，否则会读真实用户库。

let tempDir;
let dbDir;
let getAdapter;
let pipelineRepo;
const originalDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-pl-"));
  process.env.DATA_DIR = tempDir;
  dbDir = path.join(tempDir, "db");
  if (global._dbAdapter) {
    try { global._dbAdapter.instance?.close?.(); } catch {}
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  ({ getAdapter } = await import("@/lib/db/driver.js"));
  pipelineRepo = await import("@/lib/db/repos/pipelineRepo.js");
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  if (global._dbAdapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("pipelineRepo（任务/流水线数据模型）", () => {
  it("隔离自检：使用临时 DATA_DIR，而非用户真实库", () => {
    expect(dbDir.startsWith(tempDir)).toBe(true);
    expect(dbDir).not.toContain("Roaming");
  });

  it("createPipelineRun 建 run 并回读，初始 status=pending", async () => {
    const run = await pipelineRepo.createPipelineRun({ kind: "video", title: "一条测试视频" });
    expect(run.id).toBeTruthy();
    expect(run.kind).toBe("video");
    expect(run.status).toBe("pending");
    expect(run.title).toBe("一条测试视频");
    expect(run.createdAt).toBeTruthy();
    expect(run.finishedAt).toBeNull();
  });

  it("缺 kind 抛错（输入校验）", async () => {
    await expect(pipelineRepo.createPipelineRun({})).rejects.toThrow(/kind is required/);
  });

  it("阶段推进：更新 status/stage/stageIndex/stageTotal 供进度展示", async () => {
    const run = await pipelineRepo.createPipelineRun({ kind: "ppt", stageTotal: 7 });
    const updated = await pipelineRepo.updatePipelineRun(run.id, {
      status: "running", stage: "分镜", stageIndex: 2, stageTotal: 7,
    });
    expect(updated.status).toBe("running");
    expect(updated.stage).toBe("分镜");
    expect(updated.stageIndex).toBe(2);
    expect(updated.stageTotal).toBe(7);
    expect(updated.finishedAt).toBeNull();
  });

  it("非法 status 被拒（显式状态机）", async () => {
    const run = await pipelineRepo.createPipelineRun({ kind: "video" });
    await expect(pipelineRepo.updatePipelineRun(run.id, { status: "whatever" })).rejects.toThrow(/invalid status/);
  });

  it("终态自动写 finishedAt", async () => {
    const run = await pipelineRepo.createPipelineRun({ kind: "video" });
    const done = await pipelineRepo.updatePipelineRun(run.id, { status: "completed" });
    expect(done.status).toBe("completed");
    expect(done.finishedAt).toBeTruthy();
  });

  it("failed 也写 finishedAt，并保留 error", async () => {
    const run = await pipelineRepo.createPipelineRun({ kind: "video" });
    const failed = await pipelineRepo.updatePipelineRun(run.id, { status: "failed", error: "上游 429" });
    expect(failed.finishedAt).toBeTruthy();
    expect(failed.error).toBe("上游 429");
  });

  it("update 不存在的 id 返回 null（幂等，不抛）", async () => {
    expect(await pipelineRepo.updatePipelineRun("nope", { status: "running" })).toBeNull();
  });

  it("空 patch 原样返回当前值", async () => {
    const run = await pipelineRepo.createPipelineRun({ kind: "video" });
    const same = await pipelineRepo.updatePipelineRun(run.id, {});
    expect(same.id).toBe(run.id);
    expect(same.status).toBe("pending");
  });

  it("input 与 stages 以 JSON 往返", async () => {
    const run = await pipelineRepo.createPipelineRun({
      kind: "video", input: { topic: "咖啡" }, stages: ["脚本", "分镜", "成片", "校验"],
    });
    expect(run.input.topic).toBe("咖啡");
    expect(run.input.__stages).toEqual(["脚本", "分镜", "成片", "校验"]);
  });

  it("getPipelineRuns 支持 status/kind 过滤与 limit", async () => {
    const r1 = await pipelineRepo.createPipelineRun({ kind: "ppt" });
    await pipelineRepo.updatePipelineRun(r1.id, { status: "running" });
    await pipelineRepo.createPipelineRun({ kind: "ppt" });

    const running = await pipelineRepo.getPipelineRuns({ status: "running" });
    expect(running.every((r) => r.status === "running")).toBe(true);
    expect(running.some((r) => r.id === r1.id)).toBe(true);

    const pptOnly = await pipelineRepo.getPipelineRuns({ kind: "ppt", limit: 1 });
    expect(pptOnly).toHaveLength(1);
    expect(pptOnly[0].kind).toBe("ppt");
  });

  it("产物写入与读取（按 runId 过滤、按时间升序）", async () => {
    const run = await pipelineRepo.createPipelineRun({ kind: "video" });
    await pipelineRepo.addPipelineArtifact({ runId: run.id, stage: "脚本", kind: "text", name: "script.md", content: "# 脚本" });
    await pipelineRepo.addPipelineArtifact({ runId: run.id, stage: "分镜", kind: "json", name: "shots.json", content: '{"n":3}', meta: { count: 3 } });

    const arts = await pipelineRepo.getPipelineArtifacts(run.id);
    expect(arts).toHaveLength(2);
    expect(arts[0].stage).toBe("脚本");
    expect(arts[1].stage).toBe("分镜");
    expect(arts[1].meta.count).toBe(3);
    expect(arts[1].content).toBe('{"n":3}');
  });

  it("产物按 runId 隔离（不串到别的 run）", async () => {
    const a = await pipelineRepo.createPipelineRun({ kind: "video" });
    const b = await pipelineRepo.createPipelineRun({ kind: "video" });
    await pipelineRepo.addPipelineArtifact({ runId: a.id, name: "a.txt", content: "A" });
    expect(await pipelineRepo.getPipelineArtifacts(b.id)).toHaveLength(0);
  });

  it("缺 runId 的产物被拒", async () => {
    await expect(pipelineRepo.addPipelineArtifact({ content: "x" })).rejects.toThrow(/runId is required/);
  });

  it("getResumablePipelineRuns 只返回 pending/running（断点恢复）", async () => {
    const done = await pipelineRepo.createPipelineRun({ kind: "video" });
    await pipelineRepo.updatePipelineRun(done.id, { status: "completed" });
    const running = await pipelineRepo.createPipelineRun({ kind: "video" });
    await pipelineRepo.updatePipelineRun(running.id, { status: "running" });

    const resumable = await pipelineRepo.getResumablePipelineRuns();
    const ids = resumable.map((r) => r.id);
    expect(ids).toContain(running.id);
    expect(ids).not.toContain(done.id);
    expect(resumable.every((r) => ["pending", "running"].includes(r.status))).toBe(true);
  });

  it("deletePipelineRun 连带删除其产物", async () => {
    const run = await pipelineRepo.createPipelineRun({ kind: "video" });
    await pipelineRepo.addPipelineArtifact({ runId: run.id, name: "x", content: "y" });
    await pipelineRepo.deletePipelineRun(run.id);
    expect(await pipelineRepo.getPipelineRunById(run.id)).toBeNull();
    expect(await pipelineRepo.getPipelineArtifacts(run.id)).toHaveLength(0);
  });

  it("PIPELINE_STATUSES 是显式状态机白名单", () => {
    expect(pipelineRepo.PIPELINE_STATUSES).toEqual(["pending", "running", "completed", "failed", "cancelled"]);
  });

  it("toPublicRun 剥掉内部字段 input.__stages（不属于 API 契约）", async () => {
    const run = await pipelineRepo.createPipelineRun({
      kind: "doc", title: "T", input: { topic: "咖啡" }, stages: ["A", "B", "C"],
    });
    expect(run.input.__stages).toEqual(["A", "B", "C"]); // 库内保留
    const pub = pipelineRepo.toPublicRun(run);
    expect(pub.input.topic).toBe("咖啡");
    expect(pub.input.__stages).toBeUndefined();
    // 不修改原对象（纯投影）
    expect(run.input.__stages).toEqual(["A", "B", "C"]);
  });

  it("toPublicRun 对 null / 无 input 的 run 安全", () => {
    expect(pipelineRepo.toPublicRun(null)).toBeNull();
    expect(() => pipelineRepo.toPublicRun({ id: "x", input: null })).not.toThrow();
    expect(pipelineRepo.toPublicRun({ id: "x", input: null }).input).toBeNull();
  });
});
