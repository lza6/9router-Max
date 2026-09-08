import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;

async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

// POST /api/dashboard/chat/completions — 复用网关统一 chat 入口（handleChat），
// 供 dashboard Basic Chat 页消费。与 /v1/chat/completions 走同一解析/翻译/回退链路，
// 仅请求来源不同（浏览器会话 → dashboardGuard 已鉴权；此处仅透传）。
export async function POST(request) {
  await ensureInitialized();
  return await handleChat(request);
}
