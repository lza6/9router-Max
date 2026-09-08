import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";
import { checkRateLimit, initRateLimiter } from "@/lib/rateLimit.js";

let initialized = false;

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

export async function POST(request) {
  // 应用层限流（默认关闭；RATE_LIMIT_ENABLED=true 时生效）
  const rl = initRateLimiter();
  const lim = await checkRateLimit(request, rl);
  if (!lim.ok) {
    return Response.json(
      { error: { message: "Rate limit exceeded", type: "rate_limit_error", code: "rate_limit_exceeded" } },
      { status: 429, headers: { "Retry-After": String(lim.retryAfter || 1) } }
    );
  }

  // Fallback to local handling
  await ensureInitialized();

  return await handleChat(request);
}

