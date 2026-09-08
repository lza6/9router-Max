import { randomUUID } from "node:crypto";
import { getAdapter } from "../driver.js";

// 用户自定义技能（skills）仓储。
// - 内置技能是常量（src/shared/constants/skills.js），只读，不落库。
// - 用户保存的技能（save_skill 语义）存 kv 表，scope = "userSkills"。
//   "用得多 → 越信任"：每次成功使用调 recordSkillUse 递增 uses 并强化 confidence。
const SCOPE = "userSkills";

// 输入长度上限（防御恶意/误提交超大 payload）
const MAX_NAME_LEN = 100;
const MAX_DESC_LEN = 500;
const MAX_CONTENT_LEN = 20000;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 50;

function rowToSkill(row) {
  if (!row) return null;
  let val = row.value;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch {
      return null; // 损坏的 JSON 容错：跳过而非让整次列表崩掉
    }
  }
  if (!val || typeof val !== "object") return null;
  const tags = Array.isArray(val.tags) ? val.tags.filter((t) => typeof t === "string") : [];
  return {
    id: typeof val.id === "string" ? val.id : "",
    name: typeof val.name === "string" ? val.name : "",
    description: typeof val.description === "string" ? val.description : "",
    content: typeof val.content === "string" ? val.content : "",
    tags,
    uses: Number.isFinite(Number(val.uses)) ? Number(val.uses) : 0,
    confidence: Number.isFinite(Number(val.confidence)) ? Number(val.confidence) : 0.5,
    source: typeof val.source === "string" ? val.source : "user",
    createdAt: typeof val.createdAt === "string" ? val.createdAt : null,
    updatedAt: typeof val.updatedAt === "string" ? val.updatedAt : null,
    rejectedAt: typeof val.rejectedAt === "string" ? val.rejectedAt : null,
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
  const cleanName = String(name || "").trim();
  const cleanContent = String(content || "").trim();
  if (!cleanName) throw new Error("name is required");
  if (!cleanContent) throw new Error("content is required");
  if (cleanName.length > MAX_NAME_LEN) throw new Error(`name exceeds ${MAX_NAME_LEN} chars`);
  if (cleanContent.length > MAX_CONTENT_LEN) throw new Error(`content exceeds ${MAX_CONTENT_LEN} chars`);
  const cleanDesc = String(description || "").trim();
  if (cleanDesc.length > MAX_DESC_LEN) throw new Error(`description exceeds ${MAX_DESC_LEN} chars`);
  const cleanTags = Array.isArray(tags)
    ? tags.filter(Boolean).map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_TAGS)
    : [];
  for (const t of cleanTags) {
    if (t.length > MAX_TAG_LEN) throw new Error(`tag exceeds ${MAX_TAG_LEN} chars`);
  }
  const id = randomUUID();
  const skill = {
    id,
    name: cleanName,
    description: cleanDesc,
    content: cleanContent,
    tags: cleanTags,
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
    if (!cur) return;
    const next = {
      ...cur,
      ...(typeof patch.name === "string" && patch.name.trim() ? { name: patch.name.trim().slice(0, MAX_NAME_LEN) } : {}),
      ...(typeof patch.description === "string" ? { description: patch.description.trim().slice(0, MAX_DESC_LEN) } : {}),
      ...(typeof patch.content === "string" && patch.content.trim()
        ? { content: patch.content.trim().slice(0, MAX_CONTENT_LEN) }
        : {}),
      ...(Array.isArray(patch.tags)
        ? { tags: patch.tags.filter(Boolean).map((t) => String(t).trim()).filter(Boolean).slice(0, MAX_TAGS) }
        : {}),
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
// 用单条 SQL 原子自增（json_set + json_extract），避免跨进程读-改-写竞态丢 uses。
// 负反馈：用户把技能标记为「不好使/失效」时调用。
// confidence 反向收敛（-0.1*confidence），uses 不动；连续 reject 会让置信度趋近 0，
// 使该技能在「用得多=越信任」之外有一个可下坠的信号（对齐 held-out 门禁思想）。
// rowToSkill 只投影白名单字段，rejectedAt 需一并透出（否则前端看不到标记）。
export async function rejectSkillUse(id) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const changed = db.run(
    `UPDATE kv SET value = json_set(
       value,
       '$.confidence', MAX(0.0, COALESCE(json_extract(value, '$.confidence'), 0.5) - 0.1 * COALESCE(json_extract(value, '$.confidence'), 0.5)),
       '$.rejectedAt', ?
     ) WHERE scope = ? AND key = ?`,
    [now, SCOPE, id]
  );
  if ((changed?.changes ?? 0) === 0) return null;
  return getUserSkillById(id);
}

export async function recordSkillUse(id) {
  const db = await getAdapter();
  const now = new Date().toISOString();
  const updatedAt = now;
  const changed = db.run(
    `UPDATE kv SET value = json_set(
       value,
       '$.uses', COALESCE(json_extract(value, '$.uses'), 0) + 1,
       '$.confidence', MIN(1.0, COALESCE(json_extract(value, '$.confidence'), 0.5) + 0.1 * (1 - COALESCE(json_extract(value, '$.confidence'), 0.5))),
       '$.updatedAt', ?
     ) WHERE scope = ? AND key = ?`,
    [updatedAt, SCOPE, id]
  );
  if ((changed?.changes ?? 0) === 0) return null;
  return getUserSkillById(id);
}