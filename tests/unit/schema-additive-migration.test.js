import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// P0-1/P0-2 迁移安全性：**纯追加表**依赖 schema.js 的声明式自动同步
// （migrate.js:syncSchemaFromTables → CREATE TABLE IF NOT EXISTS + 列 diff）。
// 本测试验证「旧库（缺新表）→ 再初始化 → 新表被补上，且既有数据不丢」。
//
// ⚠️ 隔离要点：src/lib/dataDir.js 的 `DATA_DIR` 是**模块加载时求值**的常量，
//    因此必须「先设 process.env.DATA_DIR，再动态 import」，否则会读到真实用户库。
//    （静态 import 会被 ESM 提升到赋值之前，隔离失效。）

const NEW_TABLES = ["pipelineRuns", "pipelineArtifacts", "responseCache"];

let tempDir;
let dbDir;
let getAdapter;
let SCHEMA_VERSION;
let TABLES;
const originalDataDir = process.env.DATA_DIR;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-sync-"));
  process.env.DATA_DIR = tempDir;
  dbDir = path.join(tempDir, "db");
  // 关键：环境变量就位后再加载 DB 模块链
  ({ getAdapter } = await import("@/lib/db/driver.js"));
  ({ SCHEMA_VERSION, TABLES } = await import("@/lib/db/schema.js"));
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

function resetAdapter() {
  // ⚠️ 不能 `delete global._dbAdapter`：driver.js 在模块加载时执行
  //    `const state = global._dbAdapter`，删除全局引用不会改变 state 持有的对象，
  //    getAdapter() 会继续返回已 close 的旧实例（"database connection is not open"）。
  //    正确做法是就地清空它的 instance/initPromise。
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  if (global._dbAdapter) {
    global._dbAdapter.instance = null;
    global._dbAdapter.initPromise = null;
  }
}

function listTables(db) {
  // 不吞异常：列表本身是诊断信息，静默返回 [] 会掩盖真实驱动错误。
  const rows = db.all("SELECT name FROM sqlite_master WHERE type='table'");
  return (rows || []).map((r) => r.name);
}

// 失败时把实际表清单带进错误信息，避免"expected false to be true"式无信息失败。
function expectTable(db, name) {
  const names = listTables(db);
  if (!names.includes(name)) {
    throw new Error(`缺少表 ${name}；实际表：${JSON.stringify(names)}`);
  }
}

describe("隔离自检（防止再次误连真实库）", () => {
  it("确实使用了临时 DATA_DIR，而不是用户真实库", () => {
    expect(dbDir.startsWith(tempDir)).toBe(true);
    expect(dbDir).not.toContain("Roaming");
  });
});

describe("schema 版本与新增表声明", () => {
  it("SCHEMA_VERSION 已因新增表而提升", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
  });

  it("三张新表都在声明式 TABLES 中（这是自动同步的唯一前提）", () => {
    for (const t of NEW_TABLES) {
      expect(Object.prototype.hasOwnProperty.call(TABLES, t)).toBe(true);
      expect(TABLES[t].columns).toBeTruthy();
    }
  });

  it("新表主键在建表时就写好（补列会剥掉 PRIMARY KEY，不能靠后补）", () => {
    expect(TABLES.pipelineRuns.columns.id).toMatch(/PRIMARY KEY/);
    expect(TABLES.pipelineArtifacts.columns.id).toMatch(/PRIMARY KEY/);
    expect(TABLES.responseCache.columns.key).toMatch(/PRIMARY KEY/);
  });
});

describe("旧库升级：缺新表 → 重新初始化自动补上，且既有数据不丢", () => {
  it("drop 掉新表后重新 getAdapter，新表被自动重建；旧表数据保留", async () => {
    // 1) 首次初始化：三张新表存在，并往旧表写一行标记数据
    const db1 = await getAdapter();
    for (const t of NEW_TABLES) expectTable(db1, t);

    db1.run(
      `INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      [JSON.stringify({ __marker: "survives-migration" })]
    );

    // 2) 模拟"升级前的旧库"：把三张新表删掉
    for (const t of NEW_TABLES) db1.run(`DROP TABLE IF EXISTS ${t}`);
    for (const t of NEW_TABLES) expect(listTables(db1)).not.toContain(t);

    // 3) 关闭 adapter，重新初始化 → 触发 syncSchemaFromTables
    resetAdapter();
    const db2 = await getAdapter();

    // 4) 新表被自动补回（无需迁移文件）
    for (const t of NEW_TABLES) expectTable(db2, t);

    // 5) 旧表数据完好
    const row = db2.get(`SELECT data FROM settings WHERE id = 1`);
    expect(row).toBeTruthy();
    expect(JSON.parse(row.data).__marker).toBe("survives-migration");

    // 6) 新表可用（补建后能正常写读）
    db2.run(
      `INSERT INTO pipelineRuns (id, kind, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
      ["r1", "video", "pending", new Date().toISOString(), new Date().toISOString()]
    );
    expect(db2.get(`SELECT status FROM pipelineRuns WHERE id = 'r1'`).status).toBe("pending");
  });

  it("重复初始化是幂等的（不抛错、不重复建表）", async () => {
    resetAdapter();
    const db1 = await getAdapter();
    for (const t of NEW_TABLES) expectTable(db1, t);

    resetAdapter();
    const db2 = await getAdapter();
    for (const t of NEW_TABLES) expectTable(db2, t);

    resetAdapter();
    const db3 = await getAdapter();
    for (const t of NEW_TABLES) expectTable(db3, t);

    // 表数量稳定（无重复建表导致的异常增长）
    const names = listTables(db3);
    expect(new Set(names).size).toBe(names.length);
  });
});
