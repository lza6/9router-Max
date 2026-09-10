import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// P1-4 生产线执行器 —— 断点恢复 / 阶段推进 / 失败落库 / 幂等。
//
// 用**纯本地阶段**替换真实 LLM 阶段（不产生任何付费调用），
// 只验证执行器语义；LLM 阶段的端到端验证在 e2e 脚本里用 mock 上游做。
//
// ⚠️ 隔离：DATA_DIR 必须在动态 import 之前设置（见 dataDir.js 的模块级求值）。

const NEW_TABLES = ["pipelineRuns", "pipelineArtifacts"];
let tempDir;
let dbDir;
let pipelineRepo;
let runner;
let stagesMod;

const originalDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-run-"));
  process.env.DATA_DIR = tempDir;
  dbDir = path.join(tempDir, "db");
  if (global._dbAdapter) {
    try { global._dbAdapter.instance?.close?.(); } catch {}
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
  pipelineRepo = await import("@/lib/db/repos/pipelineRepo.js");
  stagesMod = await import("@/lib/pipeline/stages.js");
  runner = await import("@/lib/pipeline/runner.js");
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

/** 注册一条纯本地测试生产线，避免任何模型调用。 */
function registerEvilStages() {
  stagesMod.STAGES.__test = [
    { name: "A", run: ({ topic, artifacts }) => `A:${topic}:${Object.keys(artifacts).length}` },
    { name: "B", run: ({ artifacts }) => `B:${artifacts.A}` },
    { name: "C", run: ({ artifacts }) => `C:${artifacts.B}` },
  ];
}

describe("checkStage（本地校验阶段，确定性、无模型调用）", () => {
  it("合格文稿通过", () => {
    const good = "## 一\n" + "字".repeat(120) + "。\n## 二\n" + "字".repeat(120) + "。\n## 三\n" + "字".repeat(120) + "。";
    const r = stagesMod.checkStage({ draft: good });
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
    expect(r.stats.headings).toBe(3);
  });

  it("章节不足被指出", () => {
    const r = stagesMod.checkStage({ draft: "## 一\n" + "字".repeat(300) + "。" });
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/章节数不足/);
  });

  it("正文过短被指出", () => {
    const r = stagesMod.checkStage({ draft: "## 一\n短。\n## 二\n短。\n## 三\n短。" });
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/正文过短/);
  });

  it("空输入被指出（不抛错）", () => {
    const r = stagesMod.checkStage({ draft: "" });
    expect(r.ok).toBe(false);
    expect(r.issues.length).toBeGreaterThan(0);
  });
});

describe("listPipelineKinds / getStages", () => {
  it("内置 doc 生产线存在且阶段有名字", () => {
    const kinds = stagesMod.listPipelineKinds();
    const doc = kinds.find((k) => k.kind === "doc");
    expect(doc).toBeTruthy();
    expect(doc.stages.length).toBeGreaterThanOrEqual(3);
    expect(doc.stages.every((s) => typeof s === "string" && s.length > 0)).toBe(true);
  });

  it("未知 kind 返回 null", () => {
    expect(stagesMod.getStages("nope")).toBeNull();
  });
});

describe("runPipeline（执行器语义）", () => {
  it("隔离自检：使用临时 DATA_DIR", () => {
    expect(dbDir.startsWith(tempDir)).toBe(true);
    expect(dbDir).not.toContain("Roaming");
  });

  it("顺序执行全部阶段并落产物，最终 completed", async () => {
    registerEvilStages();
    const run = await pipelineRepo.createPipelineRun({ kind: "__test", title: "T", input: { topic: "咖啡" } });
    const result = await runner.runPipeline(run.id);

    expect(result.run.status).toBe("completed");
    expect(result.artifacts.map((a) => a.name)).toEqual(["A", "B", "C"]);
    expect(result.artifacts[0].content).toBe("A:咖啡:0");
    expect(result.artifacts[1].content).toBe("B:A:咖啡:0");
    expect(result.artifacts[2].content).toBe("C:B:A:咖啡:0");
    expect(result.skipped).toHaveLength(0);
  });

  it("阶段推进被落库（stage/stageIndex/stageTotal）", async () => {
    registerEvilStages();
    const run = await pipelineRepo.createPipelineRun({ kind: "__test", title: "T2", input: { topic: "x" } });
    const result = await runner.runPipeline(run.id);
    expect(result.run.stageTotal).toBe(3);
    expect(result.run.stageIndex).toBe(2);
    expect(result.run.stage).toBe("C");
  });

  it("断点恢复：重复调用跳过已有产物的阶段（幂等）", async () => {
    registerEvilStages();
    const run = await pipelineRepo.createPipelineRun({ kind: "__test", title: "T3", input: { topic: "y" } });

    // 先只手工产出阶段 A 的产物，模拟"跑到一半崩溃"
    await pipelineRepo.addPipelineArtifact({ runId: run.id, stage: "A", name: "A", content: "A:手工" });
    await pipelineRepo.updatePipelineRun(run.id, { status: "running", stage: "B", stageIndex: 1 });

    const result = await runner.runPipeline(run.id);
    expect(result.run.status).toBe("completed");
    expect(result.skipped).toEqual(["A"]);            // A 被跳过
    expect(result.artifacts[0].content).toBe("A:手工"); // 原有产物未被覆盖
    expect(result.artifacts).toHaveLength(3);
  });

  it("已完成的 run 再次调用是安全空操作（全跳过）", async () => {
    registerEvilStages();
    const run = await pipelineRepo.createPipelineRun({ kind: "__test", title: "T4", input: { topic: "z" } });
    await runner.runPipeline(run.id);
    const second = await runner.runPipeline(run.id);
    expect(second.run.status).toBe("completed");
    expect(second.skipped).toEqual(["A", "B", "C"]);
  });

  it("阶段抛错 → run 置 failed + error，已完成的产物保留", async () => {
    stagesMod.STAGES.__boom = [
      { name: "ok", run: () => "done" },
      { name: "bad", run: () => { throw new Error("模拟上游 429"); } },
      { name: "never", run: () => "should-not-run" },
    ];
    const run = await pipelineRepo.createPipelineRun({ kind: "__boom", title: "B", input: { topic: "q" } });
    const result = await runner.runPipeline(run.id);

    expect(result.run.status).toBe("failed");
    expect(result.run.error).toContain("bad");
    expect(result.run.error).toContain("模拟上游 429");
    expect(result.failedStage).toBe("bad");

    const arts = await pipelineRepo.getPipelineArtifacts(run.id);
    expect(arts.map((a) => a.name)).toEqual(["ok"]); // ok 的产物保留，never 未执行
  });

  it("failed 后可续跑：修好阶段再 run 能完成", async () => {
    // 复用上一个 __boom run 的语义：把 bad 阶段改成成功
    stagesMod.STAGES.__boom = [
      { name: "ok", run: () => "done" },
      { name: "bad", run: () => "fixed" },
      { name: "never", run: () => "now-ran" },
    ];
    const run = await pipelineRepo.createPipelineRun({ kind: "__boom", title: "B2", input: { topic: "q" } });
    await pipelineRepo.updatePipelineRun(run.id, { status: "failed", error: "bad: 旧的失败" });

    const result = await runner.runPipeline(run.id);
    expect(result.run.status).toBe("completed");
    expect(result.artifacts.map((a) => a.name)).toEqual(["ok", "bad", "never"]);
  });

  it("未知 kind 抛错", async () => {
    const run = await pipelineRepo.createPipelineRun({ kind: "__ghost", title: "G" });
    await expect(runner.runPipeline(run.id)).rejects.toThrow(/unknown pipeline kind/);
  });

  it("不存在的 runId 抛错", async () => {
    await expect(runner.runPipeline("no-such-run")).rejects.toThrow(/not found/);
  });

  it("cancelled 的 run 不能被续跑", async () => {
    registerEvilStages();
    const run = await pipelineRepo.createPipelineRun({ kind: "__test", title: "T5", input: { topic: "c" } });
    await pipelineRepo.updatePipelineRun(run.id, { status: "cancelled" });
    await expect(runner.runPipeline(run.id)).rejects.toThrow(/cancelled/);
  });

  it("新增表存在性（确认走的是隔离库）", async () => {
    const db = (await import("@/lib/db/driver.js")).getAdapter;
    const adapter = await db();
    const names = adapter.all("SELECT name FROM sqlite_master WHERE type='table'").map((r) => r.name);
    for (const t of NEW_TABLES) expect(names).toContain(t);
  });
});
