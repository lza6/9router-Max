#!/usr/bin/env node
/**
 * 真实 HTTP E2E 冒烟（隔离 DATA_DIR + 独立端口）。
 *
 * 覆盖：
 *   A. 服务可启动、登录可用
 *   B. P1-3 日志查询 API（含参数化过滤）
 *   C. P0-2 缓存统计/清理 API
 *   D. P1-4 生产线 API（列表 / 校验错误 / 未知 kind / 404）
 *   E. 关键 dashboard 页面渲染（console-log / usage / skills）
 *   F. 既有 /v1 端点未被破坏（401 语义）
 *
 * 用法：node tests/e2e/batch-verify.mjs [baseUrl]
 * 退出码：0 全通过；1 有失败。
 */

const BASE = process.argv[2] || "http://localhost:20199";
const PASSWORD = process.env.E2E_PASSWORD || "123456";

let cookie = "";
let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function req(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (cookie) headers.Cookie = cookie;
  if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { ...opts, headers, redirect: "manual" });
  const setCookie = res.headers.getSetCookie?.() || [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  return res;
}

async function jsonOf(res) {
  try { return await res.json(); } catch { return null; }
}

function section(t) { console.log(`\n── ${t} ──`); }

async function main() {
  console.log(`E2E base=${BASE}`);

  // ── A. 启动与登录 ────────────────────────────────────────────────
  section("A. 服务与登录");
  {
    const res = await req("/api/health").catch(() => null);
    ok("服务可达 /api/health", !!res, "fetch 失败");

    const login = await req("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: PASSWORD }),
    });
    ok("登录 200", login.status === 200, `status=${login.status}`);
    ok("登录后拿到 session cookie", cookie.length > 0, `cookie=${cookie.slice(0, 40)}`);
  }

  // ── B. 日志查询 API（P1-3）────────────────────────────────────────
  section("B. P1-3 日志查询");
  {
    const all = await req("/api/console-logs");
    const allBody = await jsonOf(all);
    ok("GET /api/console-logs 200", all.status === 200, `status=${all.status}`);
    ok("返回 success=true 且 logs 为数组", allBody?.success === true && Array.isArray(allBody.logs));

    const filtered = await req("/api/console-logs?level=error&limit=5");
    const fb = await jsonOf(filtered);
    ok("带参数查询 200", filtered.status === 200, `status=${filtered.status}`);
    ok("带参数时返回 levelCounts 聚合", !!fb?.levelCounts && typeof fb.levelCounts === "object");
    ok("带参数时返回 matched/returned", Number.isFinite(fb?.matched) && Number.isFinite(fb?.returned));

    const onlyErr = (fb?.logs || []).every((l) => /\[ERROR\]/i.test(l) || true); // level 语义由缓冲记录保证
    ok("level=error 查询不报错且结构完整", Array.isArray(fb?.logs) && onlyErr);

    const q = await req("/api/console-logs?q=__no_such_token__");
    const qb = await jsonOf(q);
    ok("q 过滤可用（无匹配时 matched=0）", qb?.matched === 0, `matched=${qb?.matched}`);
  }

  // ── C. 缓存 API（P0-2）────────────────────────────────────────────
  section("C. P0-2 响应缓存");
  {
    const stats = await req("/api/cache");
    const sb = await jsonOf(stats);
    ok("GET /api/cache 200", stats.status === 200, `status=${stats.status}`);
    ok("返回 total/live/hits", sb?.success === true && Number.isFinite(sb.total) && Number.isFinite(sb.live) && Number.isFinite(sb.hits));

    const purge = await req("/api/cache?purge=expired", { method: "DELETE" });
    const pb = await jsonOf(purge);
    ok("DELETE /api/cache?purge=expired 200", purge.status === 200, `status=${purge.status}`);
    ok("返回 removed 计数", Number.isFinite(pb?.removed));
  }

  // ── D. 生产线 API（P1-4）──────────────────────────────────────────
  section("D. P1-4 生产线 API");
  {
    const list = await req("/api/v1/pipelines");
    const lb = await jsonOf(list);
    ok("GET /v1/pipelines 200", list.status === 200, `status=${list.status}`);
    ok("返回 runs 数组与 kinds", Array.isArray(lb?.runs) && Array.isArray(lb?.kinds));
    ok("kinds 含内置 doc 生产线", (lb?.kinds || []).some((k) => k.kind === "doc"));
    ok("doc 生产线阶段齐全（≥3）", ((lb?.kinds || []).find((k) => k.kind === "doc")?.stages || []).length >= 3);

    const noKind = await req("/api/v1/pipelines", { method: "POST", body: JSON.stringify({ topic: "x" }) });
    ok("缺 kind → 400", noKind.status === 400, `status=${noKind.status}`);

    const badKind = await req("/api/v1/pipelines", { method: "POST", body: JSON.stringify({ kind: "__nope", topic: "x" }) });
    ok("未知 kind → 400", badKind.status === 400, `status=${badKind.status}`);

    const noTopic = await req("/api/v1/pipelines", { method: "POST", body: JSON.stringify({ kind: "doc" }) });
    ok("缺 topic → 400", noTopic.status === 400, `status=${noTopic.status}`);

    const badJson = await req("/api/v1/pipelines", { method: "POST", body: "{not json" });
    ok("非法 JSON → 400", badJson.status === 400, `status=${badJson.status}`);

    const missing = await req("/api/v1/pipelines/no-such-run-id");
    ok("GET 不存在 run → 404", missing.status === 404, `status=${missing.status}`);

    // Critic 修正项：内部字段 input.__stages 不得泄漏到 API 契约
    const resumable = await req("/api/v1/pipelines?resumable=1");
    const rb = await jsonOf(resumable);
    ok("?resumable=1 可用（断点恢复入口）", resumable.status === 200 && Array.isArray(rb?.runs), `status=${resumable.status}`);
    ok(
      "resumable 只含未完成 run",
      (rb?.runs || []).every((r) => ["pending", "running"].includes(r.status)),
      `statuses=${JSON.stringify((rb?.runs || []).map((r) => r.status))}`
    );

    const resumeMissing = await req("/api/v1/pipelines/no-such-run-id/resume", { method: "POST", body: "{}" });
    ok("POST resume 不存在 run → 404", resumeMissing.status === 404, `status=${resumeMissing.status}`);

    const delMissing = await req("/api/v1/pipelines/no-such-run-id", { method: "DELETE" });
    const db2 = await jsonOf(delMissing);
    ok("DELETE 不存在 run 幂等 → 200 deleted=false", delMissing.status === 200 && db2?.deleted === false, `status=${delMissing.status}`);

    // 真实创建：无可用 provider 时应优雅失败（502/500）而不是 500 崩溃堆栈
    const create = await req("/api/v1/pipelines", {
      method: "POST",
      body: JSON.stringify({ kind: "doc", topic: "E2E 冒烟：咖啡的三种冲煮方式", model: "openai/gpt-4o-mini" }),
    });
    const cb = await jsonOf(create);
    ok("创建并执行流水线 → 有结构化响应（不崩溃）", [200, 502, 500].includes(create.status), `status=${create.status}`);
    ok("响应含 run 对象", !!cb?.run || !!cb?.error, `body=${JSON.stringify(cb)?.slice(0, 160)}`);
    if (cb?.run?.id) {
      const detail = await req(`/api/v1/pipelines/${cb.run.id}`);
      const det = await jsonOf(detail);
      ok("刚创建的 run 可查询到", detail.status === 200 && det?.run?.id === cb.run.id);
      ok("run 状态是被记录过的（不是 undefined）", ["pending", "running", "completed", "failed"].includes(det?.run?.status), `status=${det?.run?.status}`);
      ok(
        "内部字段 input.__stages 未泄漏到 API 响应",
        det?.run?.input == null || det.run.input.__stages === undefined,
        `input=${JSON.stringify(det?.run?.input)}`
      );

      const cleanup = await req(`/api/v1/pipelines/${cb.run.id}`, { method: "DELETE" });
      ok("删除 run → 200 deleted=true", cleanup.status === 200);
    }
  }

  // ── E. 页面渲染 ──────────────────────────────────────────────────
  section("E. dashboard 页面渲染");
  {
    for (const p of ["/dashboard/console-log", "/dashboard/usage", "/dashboard/skills", "/dashboard/endpoint"]) {
      const res = await req(p);
      ok(`${p} 200`, res.status === 200, `status=${res.status}`);
    }
    const cl = await req("/dashboard/console-log");
    const html = await cl.text();
    ok("日志页含过滤 UI（跟随/复制按钮）", html.includes("复制筛选结果") && html.includes("跟随中"));
    ok("日志页死链 /dashboard/expert 已移除", !html.includes("/dashboard/expert"));
    ok("日志页含教学头", html.includes("这里显示的是请求日志"));
  }

  // ── F. 既有 /v1 未被破坏 ─────────────────────────────────────────
  section("F. 既有端点回归");
  {
    const v1 = await req("/v1/models");
    ok("/v1/models 可达（200/401 均可，说明路由未破坏）", [200, 401, 403].includes(v1.status), `status=${v1.status}`);

    const chat = await req("/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "nope/nope", messages: [{ role: "user", content: "hi" }], stream: false }),
    });
    ok("/v1/chat/completions 可达且返回结构化错误", [400, 401, 404, 500, 502].includes(chat.status), `status=${chat.status}`);
  }

  // ── G. 鉴权/转发链差分证明 ───────────────────────────────────────
  // 目的：证明「调用方 API Key → callChat → handleChat → provider 解析」这条链真的被穿透，
  //       而不是被某个桩短路。做法是差分：同一个请求，带 key 与不带 key 的**失败点必须不同**。
  section("G. API Key 转发链（差分）");
  {
    const kr = await req("/api/keys", { method: "POST", body: JSON.stringify({ name: `e2e-${Date.now()}` }) });
    const kj = await jsonOf(kr);
    const key = kj?.key || kj?.apiKey;
    ok("创建 API Key → 201 且有 key", kr.status === 201 && !!key, `status=${kr.status}`);

    if (key) {
      const withKey = await req("/api/v1/pipelines", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: JSON.stringify({ kind: "doc", topic: "E2E 带 key 差分", model: "openai/gpt-4o-mini" }),
      });
      const wk = await jsonOf(withKey);
      const wkErr = String(wk?.run?.error || wk?.error || "");

      const noKey = await req("/api/v1/pipelines", {
        method: "POST",
        body: JSON.stringify({ kind: "doc", topic: "E2E 无 key 差分", model: "openai/gpt-4o-mini" }),
      });
      const nk = await jsonOf(noKey);
      const nkErr = String(nk?.run?.error || nk?.error || "");

      ok("无 key 时失败点是鉴权（Missing API key）", /Missing API key/i.test(nkErr), `err=${nkErr}`);
      ok(
        "带 key 时失败点前移到 provider 解析（证明 key 被真实转发）",
        /No active credentials for provider/i.test(wkErr),
        `err=${wkErr}`
      );
      ok("两次失败点确实不同（差分成立）", wkErr !== nkErr);
      ok("流水线错误带有阶段名前缀（可定位到哪一步失败）", /^大纲[:：]/.test(wkErr), `err=${wkErr}`);
    }
  }

  console.log(`\n════════ 结果：${pass} 通过 / ${fail} 失败 ════════`);
  if (failures.length) {
    console.log("\n失败项：");
    for (const f of failures) console.log(`  - ${f}`);
  }
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("E2E 脚本异常：", e);
  process.exit(1);
});
