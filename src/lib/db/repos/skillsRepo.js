import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";

// 用户自定义技能（skills）仓储。
// - 内置技能是常量（src/shared/constants/skills.js），只读，不落库。
// - 用户保存的技能（save_skill 语义）存 kv 表，scope = "userSkills"。
//   "用得多 → 越信任"：每次成功使用调 recordSkillUse 递增 uses 并强化 confidence。
const SCOPE = "userSkills";

function rowToSkill(row) {
  if (!row) return null;
  const val = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
  return {
    id: val.id,
    name: val.name,
    description: val.description || "",
    content: val.content || "",
    tags: Array.isArray(val.tags) ? val.tags : [],
    uses: Number(val.uses || 0),
    confidence: Number(val.confidence || 0.5),
    source: val.source || "user",
    createdAt: val.createdAt,
    updatedAt: val.updatedAt,
  };
}

export async function getUserSkills() {
  const db = await getAdapter();
  const rows = db.all(`SELECT key, value FROM kv WHERE scope = ?`, [SCOPE]);
  const items = rows.map(rowToSkill).filter(Boolean);
  // 使用次数越多的排在前面
  return items.sort((a, b) => b.uses - a.uses);
}

export async function getUserSkillById(id) {
  const db = await getAdapter();
  const row = db.get(`SELECT key, value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, id]);
  return rowToSkill(row);
}

export async function createUserSkill({ name, description = "", content = "", tags = [] }) {
  if (!name || !name.trim()) throw new Error("name is required");
  if (!content || !content.trim()) throw new Error("content is required");
  const id = randomUUID();
  const skill = {
    id,
    name: name.trim(),
    description: description.trim(),
    content,
    tags: Array.isArray(tags) ? tags.filter(Boolean).map((t) => String(t).trim()) : [],
    uses: 0,
    confidence: 0.5, // 初始置信度，复用后强化
    source: "user",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const db = await getAdapter();
  db.run(
    `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
     ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
    [SCOPE, id, JSON.stringify(skill)]
  );
  return skill;
}

export async function updateUserSkill(id, patch) {
  const db = await getAdapter();
  let updated = null;
  db.transaction(() => {
    const row = db.get(`SELECT key, value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, id]);
    if (!row) return;
    const cur = rowToSkill(row);
    const next = {
      ...cur,
      ...(patch.name ? { name: String(patch.name).trim() } : {}),
      ...(patch.description !== undefined ? { description: String(patch.description).trim() } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: Array.isArray(patch.tags) ? patch.tags.filter(Boolean).map((t) => String(t).trim()) : [] } : {}),
      updatedAt: new Date().toISOString(),
    };
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, id, JSON.stringify(next)]
    );
    updated = next;
  });
  return updated;
}

export async function deleteUserSkill(id) {
  const db = await getAdapter();
  const res = db.run(`DELETE FROM kv WHERE scope = ? AND key = ?`, [SCOPE, id]);
  return (res?.changes ?? 0) > 0;
}

// 每次模型成功调用某技能后 +1 次使用；置信度向 1 收敛（越用越信任）。
export async function recordSkillUse(id) {
  const db = await getAdapter();
  let updated = null;
  db.transaction(() => {
    const row = db.get(`SELECT key, value FROM kv WHERE scope = ? AND key = ?`, [SCOPE, id]);
    if (!row) return;
    const cur = rowToSkill(row);
    const uses = Number(cur.uses || 0) + 1;
    const confidence = Math.min(1.0, Number(cur.confidence || 0.5) + 0.1 * (1 - Number(cur.confidence || 0.5)));
    const next = { ...cur, uses, confidence, updatedAt: new Date().toISOString() };
    db.run(
      `INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)
       ON CONFLICT(scope, key) DO UPDATE SET value = excluded.value`,
      [SCOPE, id, JSON.stringify(next)]
    );
    updated = next;
  });
  return updated;
}