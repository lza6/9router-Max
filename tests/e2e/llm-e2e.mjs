// 9router 网关真实 LLM E2E 验证脚本（走本机代理 CONNECT 隧道，专治 curl/node-fetch 的 TLS ECONNRESET）
// 用法（不把密钥写入仓库，密钥从环境变量读取）：
//   E2E_API_BASE=https://api.yjs.im/v1 E2E_API_KEY=sk-... node tests/e2e/llm-e2e.mjs
//   node tests/e2e/llm-e2e.mjs --smoke   （只做连通性，不发模型）
import https from "node:https";
import http from "node:http";

const API_HOST = (process.env.E2E_API_BASE || "https://api.yjs.im/v1").replace(/^https:\/\//, "").replace(/\/v1$/, "");
const KEY = process.env.E2E_API_KEY || "";
const PROXY_PORT = Number(process.env.E2E_PROXY_PORT || 10808); // 本机 v2rayN/xray 默认端口
const SMOKE = process.argv.includes("--smoke");

if (!KEY) {
  console.error("[e2e-llm] 需要 E2E_API_KEY 环境变量（不落库、仅运行时传入）");
  process.exit(2);
}

// 通过本机 HTTP 代理 CONNECT 隧道 + 手动 https 请求，避免 node fetch / curl 对隧道 TLS 的兼容问题
function call(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const preq = http.request({
      host: "127.0.0.1", port: PROXY_PORT, method: "CONNECT",
      path: `${API_HOST}:443`,
      headers: { Host: `${API_HOST}:443` },
    });
    preq.on("connect", (res, socket) => {
      if (res.statusCode !== 200) { socket.destroy(); reject(new Error(`CONNECT failed: ${res.statusCode}`)); return; }
      const req = https.request({
        host: API_HOST, port: 443, method, path, socket, agent: false,
        headers: {
          Authorization: `Bearer ${KEY}`,
          "Content-Type": "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
        },
      });
      let buf = "";
      req.on("response", (resp) => {
        resp.on("data", (c) => buf += c);
        resp.on("end", () => resolve({ status: resp.statusCode, body: buf }));
      });
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
    preq.on("error", reject);
    preq.end();
  });
}

if (SMOKE) {
  const r = await call("GET", "/v1/models");
  console.log(`[smoke] GET /v1/models → ${r.status}`);
  const j = JSON.parse(r.body);
  const hasDeepseek = (j.data || []).some((m) => m.id.includes("deepseek"));
  console.log(`[smoke] 可用模型 ${j.data?.length || 0} 个，含 deepseek: ${hasDeepseek}`);
  process.exit(hasDeepseek && r.status === 200 ? 0 : 1);
}

// 非流式 chat
const t0 = Date.now();
const r = await call("POST", "/v1/chat/completions", {
  model: process.env.E2E_MODEL || "deepseek-v4-flash",
  messages: [{ role: "user", content: "用一句中文介绍 AI 网关的基本作用" }],
  max_tokens: 80,
});
console.log(`[non-stream] status=${r.status} 耗时=${Date.now() - t0}ms`);
const j = JSON.parse(r.body);
console.log("回复:", (j.choices?.[0]?.message?.content || "").slice(0, 120) || "(仅 reasoning，未输出 content)");
console.log("usage:", JSON.stringify(j.usage));

// 流式 chat（验证 SSE 格式可解析）
const t1 = Date.now();
const rs = await call("POST", "/v1/chat/completions", {
  model: process.env.E2E_MODEL || "deepseek-v4-flash",
  messages: [{ role: "user", content: "用 5 个字以内回答：1+1 等于几" }],
  max_tokens: 30,
  stream: true,
});
console.log(`[stream] status=${rs.status} 耗时=${Date.now() - t1}ms`);
console.log("流式首帧:", rs.body.slice(0, 200).replace(/\n/g, "⏎"));

process.exit(0);