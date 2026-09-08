import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "@/lib/db/driver.js";
import {
  getUserSkills, getUserSkillById,
  createUserSkill, updateUserSkill, deleteUserSkill, recordSkillUse, rejectSkillUse,
} from "@/lib/db/repos/skillsRepo.js";

// 负反馈（reject）专项测试：confidence 反向收敛、不炸、404 语义一致。
// 使用独立临时 DATA_DIR，避免与 skills.test.js 共享 DB。

describe("skillsRepo 负反馈（rejectSkillUse）", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-skills-reject-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    await getAdapter();
  });

  afterAll(async () => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
  });

  it("reject 使 confidence 向 0 收敛且 uses 不变", async () => {
    const skill = await createUserSkill({
      name: "reject-me",
      description: "负反馈测试",
      content: "## Triggering\nX\n## Execution\n1. a\n2. b\n## Output\n成功贴 ID；失败报 status+error",
      tags: ["test"],
    });
    const id = skill.id;

    // 2 次使用把 confidence 推高一点
    await recordSkillUse(id);
    const boosted = await getUserSkillById(id);
    expect(boosted.confidence).toBeGreaterThan(0.5);

    // reject 反向收敛
    const rejected = await rejectSkillUse(id);
    expect(rejected.confidence).toBeLessThan(boosted.confidence);
    expect(rejected.uses).toBe(boosted.uses);
    expect(rejected.rejectedAt).toBeTruthy();

    // 清理
    await deleteUserSkill(id);
  });

  it("连续 reject 不会低于 0", async () => {
    const skill = await createUserSkill({
      name: "reject-to-zero",
      description: "负反馈压底",
      content: "## Triggering\nX\n## Execution\n1\n## Output\nY",
      tags: ["test"],
    });
    const id = skill.id;
    let cur = await getUserSkillById(id);
    for (let i = 0; i < 30; i++) {
      cur = await rejectSkillUse(id);
    }
    expect(cur.confidence).toBeGreaterThanOrEqual(0);
    expect(cur.confidence).toBeLessThan(0.05);
    await deleteUserSkill(id);
  });

  it("reject 不存在的 id 返回 null（404 语义）", async () => {
    const res = await rejectSkillUse("does-not-exist");
    expect(res).toBeNull();
  });

  it("reject 后技能仍在列表且排序不崩", async () => {
    const skill = await createUserSkill({
      name: "reject-in-list",
      description: "列表稳定性",
      content: "## Triggering\nX\n## Execution\n1\n## Output\nY",
      tags: ["test"],
    });
    await rejectSkillUse(skill.id);
    const list = await getUserSkills();
    const found = list.find((s) => s.id === skill.id);
    expect(found).toBeTruthy();
    expect(Array.isArray(list)).toBe(true);
    await deleteUserSkill(skill.id);
  });

  it("updateUserSkill 不因 rejectedAt 字段破坏（兼容）", async () => {
    const skill = await createUserSkill({
      name: "reject-then-update",
      description: "拒后更新",
      content: "## Triggering\nX\n## Execution\n1\n## Output\nY",
      tags: ["test"],
    });
    await rejectSkillUse(skill.id);
    const updated = await updateUserSkill(skill.id, { description: "更新后的描述" });
    expect(updated.description).toBe("更新后的描述");
    expect(updated.confidence).toBeLessThan(0.5);
    await deleteUserSkill(skill.id);
  });
});