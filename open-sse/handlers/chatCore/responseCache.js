import { computeCacheKey, getCachedResponse, setCachedResponse } from "@/lib/db/index.js";

// P0-2 精确响应缓存的**准入与读写**封装。
// 拆分到独立文件，让 chatCore 的改动保持最小、可读、可单测。
//
// 安全边界（独立审查 Critic-1 修正意见）：
//   • 只缓存「确定性」请求：temperature 必须为 0 或未指定。
//     temperature > 0 时同一 prompt 的合法输出本就不同，缓存会改变语义。
//   • 不缓存带工具调用的请求（响应含 tool_call，重放会触发副作用路径）。
//   • 不缓存流式请求（响应体是 SSE 流，无法整体复用）。
//   • 缓存键含 connectionId —— 多账号是 9router 核心能力，缺它会跨账号串答案。
//   • 全部 fail-open：缓存读写异常一律不影响正常请求。

/**
 * 请求是否可缓存。纯函数，便于单测。
 *
 * ⚠️ temperature 必须**显式**为 0：
 *   OpenAI / Anthropic 的 temperature 缺省值是 **1**（非确定性），
 *   因此"未指定"绝不等于"确定性"。若把缺省当放行，绝大多数请求都会被缓存，
 *   同一个 prompt 会拿到上次的答案 —— 这是语义错误，不是省钱。
 *   要缓存就必须由调用方显式写死 temperature: 0。
 */
export function isCacheEligible({ body, stream, enabled }) {
  if (!enabled) return false;
  if (stream) return false;
  const b = body || {};
  if (Array.isArray(b.tools) && b.tools.length > 0) return false;
  if (b.tool_choice) return false;
  const t = b.temperature;
  if (t === undefined || t === null) return false;
  return Number(t) === 0;
}

/**
 * 读缓存。命中返回 { key, body }，未命中或异常返回 null。
 */
export async function readCachedClientResponse({ connectionId, provider, model, sourceFormat, body }) {
  try {
    const key = computeCacheKey({ connectionId, provider, model, sourceFormat, body });
    const hit = await getCachedResponse(key);
    if (!hit) return null;
    return { key, body: hit };
  } catch {
    return null;
  }
}

/**
 * 写缓存。返回 key 或 null（失败静默）。
 */
export async function writeCachedClientResponse({ connectionId, provider, model, sourceFormat, body, response, ttlSeconds }) {
  try {
    if (response === undefined || response === null) return null;
    const key = computeCacheKey({ connectionId, provider, model, sourceFormat, body });
    const ok = await setCachedResponse({ key, provider, model, connectionId, response, ttlSeconds });
    return ok ? key : null;
  } catch {
    return null;
  }
}

/**
 * 构造缓存命中时的客户端响应。
 */
export function buildCachedResponse(cachedBody) {
  return new Response(JSON.stringify(cachedBody), {
    status: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}
