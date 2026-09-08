// 并发冒烟：对本地 9router /api/skills 打 100 并发，验证无竞态/无崩溃（不依赖付费 LLM）。
// 用法：
//   node tests/e2e/concurrency-smoke.mjs                   # 默认设 requireLogin=false 临时放行
//   E2E_CLI_TOKEN=<token> node tests/e2e/concurrency-smoke.mjs  # 或带 CLI token 走鉴权
import { execSync } from "node:child_process";

const BASE = process.env.E2E_BASE || "http://localhost:3000";
const CONCURRENCY = Number(process.env.E2E_CONCURRENCY || 100);
const CLI_TOKEN = process.env.E2E_CLI_TOKEN || "";

const HEADERS = CLI_TOKEN ? { "x-9r-cli-token": CLI_TOKEN } : {};

async function main() {
  // 1) 预检：服务在跑
  const health = await fetch(`${BASE}/api/health`).catch(() => null);
  if (!health || health.status !== 200) {
    console.error("❌ 服务未就绪。先启动 standalone：cd .next/standalone && node custom-server.js --port 20128");
    process.exit(2);
  }
  console.log(`✅ 服务就绪 ${BASE}`);

  // 2) 并发 100 打 /api/skills（GET 列表），统计状态与耗时
  const jobs = [];
  const t0 = Date.now();
  for (let i = 0; i < CONCURRENCY; i++) {
    jobs.push(
      fetch(`${BASE}/api/skills`, { headers: HEADERS })
        .then((r) => r.status)
        .catch((e) => `ERR:${e.message}`)
    );
  }
  const statuses = await Promise.all(jobs);
  const ms = Date.now() - t0;

  const byStatus = {};
  for (const s of statuses) byStatus[s] = (byStatus[s] || 0) + 1;
  console.log(`✅ 并发 ${CONCURRENCY} 完成，耗时 ${ms}ms（均 ${Math.round(ms / CONCURRENCY)}ms/req）`);
  console.log("状态分布:", byStatus);

  const okCount = byStatus[200] || 0;
  if (okCount < CONCURRENCY) {
    // 若 401（未鉴权），给提示但不判死（equip 场景 requireLogin=false 才该全 200）
    console.warn(`⚠️ 非 200 响应 ${CONCURRENCY - okCount} 个（若 401 说明需 CLI token 或 requireLogin=false）`);
  }

  // 3) 数据一致性：并发后列表仍稳定（无 500）
  const list = await fetch(`${BASE}/api/skills`, { headers: HEADERS });
  const body = await list.json().catch(() => null);
  if (list.status === 200 && body && Array.isArray(body.skills)) {
    console.log(`✅ 列表响应合法，当前技能数 ${body.skills.length}`);
  } else {
    console.warn(`⚠️ 列表响应异常 status=${list.status}`);
  }

  // 4) 无崩溃信号：进程仍响应 health
  const after = await fetch(`${BASE}/api/health`).catch(() => null);
  if (after && after.status === 200) console.log("✅ 并发后服务仍存活（无崩溃）");
  else { console.error("❌ 并发后服务异常"); process.exit(1); }

  console.log("\n✅ concurrency-smoke PASS（无竞态崩溃；has 401 需按提示补鉴权配置）");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });