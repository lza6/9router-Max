import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "@/lib/db/driver.js";
import {
  getUserSkills, getUserSkillById,
  createUserSkill, updateUserSkill, deleteUserSkill, recordSkillUse,
} from "@/lib/db/repos/skillsRepo.js";

describe("skillsRepo（用户自定义技能 + 使用强化）", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-skills-"));
    process.env.DATA_DIR = tempDir;
    // 重置全局单例，确保适配器指向临时目录
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

  beforeEach(async () => {
    // 清掉测试 scope，保证用例独立
    const db = await getAdapter();
    db.run(`DELETE FROM kv WHERE scope = 'userSkills'`);
  });

  it("创建技能：name 必填、content 必填、返回完整对象", async () => {
    const skill = await createUserSkill({
      name: "海报设计",
      description: "生成产品海报",
      content: "1. 确定主题\n2. 选风格\n3. 出图",
      tags: ["design", "poster"],
    });
    expect(skill.name).toBe("海报设计");
    expect(skill.content).toContain("选风格");
    expect(skill.uses).toBe(0);
    expect(skill.confidence).toBe(0.5);
    expect(skill.source).toBe("user");
    expect(skill.id).toBeTruthy();

    const fetched = await getUserSkillById(skill.id);
    expect(fetched.name).toBe("海报设计");
  });

  it("创建技能缺 content 抛错", async () => {
    await expect(createUserSkill({ name: "x", content: "" })).rejects.toThrow("content is required");
    await expect(createUserSkill({ name: "", content: "y" })).rejects.toThrow("name is required");
  });

  it("用户技能列表：uses 降序排列", async () => {
    const a = await createUserSkill({ name: "A", content: "a" });
    const b = await createUserSkill({ name: "B", content: "b" });
    await recordSkillUse(a.id); // A 用 1 次
    await recordSkillUse(a.id); // A 用 2 次
    const list = await getUserSkills();
    expect(list.map((s) => s.name)).toEqual(["A", "B"]);
    expect(list[0].uses).toBe(2);
    expect(list[1].uses).toBe(0);
  });

  it("recordSkillUse：uses+1，confidence 向 1 收敛", async () => {
    const skill = await createUserSkill({ name: "C", content: "c" });
    const first = await recordSkillUse(skill.id);
    expect(first.uses).toBe(1);
    // confidence = 0.5 + 0.1*(1-0.5) = 0.55
    expect(first.confidence).toBeCloseTo(0.55, 5);

    let cur = first;
    for (let i = 0; i < 20; i++) cur = await recordSkillUse(skill.id);
    expect(cur.uses).toBe(21);
    expect(cur.confidence).toBeLessThanOrEqual(0.95); // 强化但封顶 <1 附近
  });

  it("updateUserSkill：改 name/description/content/tags", async () => {
    const skill = await createUserSkill({ name: "D", content: "d" });
    const updated = await updateUserSkill(skill.id, {
      name: "D2",
      description: "desc2",
      content: "d-new",
      tags: ["x"],
    });
    expect(updated.name).toBe("D2");
    expect(updated.description).toBe("desc2");
    expect(updated.content).toBe("d-new");
    expect(updated.tags).toEqual(["x"]);
    // 不影响 uses/confidence
    expect(updated.uses).toBe(skill.uses);
    expect(updated.confidence).toBe(skill.confidence);
  });

  it("updateUserSkill 对不存在 id 返回 null", async () => {
    expect(await updateUserSkill("nope" , { name: "z" })).toBeNull();
  });

  it("deleteUserSkill：删除后 get 返回 null，再删返回 false", async () => {
    const skill = await createUserSkill({ name: "E", content: "e" });
    const deleted = await deleteUserSkill(skill.id);
    expect(deleted).toBe(true);
    expect(await getUserSkillById(skill.id)).toBeNull();
    expect(await deleteUserSkill(skill.id)).toBe(false);
  });

  it("内置技能常量不被混入用户技能列表", async () => {
    const list = await getUserSkills();
    // 内置技能是常量不带 id，不会出现在这里
    expect(list.every((s) => s.source === "user")).toBe(true);
  });
});