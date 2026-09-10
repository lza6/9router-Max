import { handleChat } from "@/sse/handlers/chat.js";

// P1-4 生产线「阶段执行器」。
//
// 设计要点：
//   • 每个阶段是纯函数 (ctx) => artifact，便于单测与替换。
//   • LLM 阶段通过**内部调用统一的 /v1/chat/completions 处理器**完成 ——
//     复用既有的 provider 选择、翻译、回退、用量记账，不另造一条上游通道。
//   • 调用方传入自己的 apiKey（若 settings.requireApiKey 打开），不做任何鉴权绕过。
//   • 失败即抛出：由 runner 捕获并落库成 failed + error，不吞错。

/**
 * 调一次非流式 chat，返回正文文本。
 * 失败（HTTP 非 2xx / 无内容）抛错，由调用方决定如何呈现。
 */
export async function callChat({ apiKey, model, messages, temperature = 0, maxTokens }) {
  const body = { model, messages, stream: false, temperature };
  if (Number.isFinite(maxTokens)) body.max_tokens = maxTokens;

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const req = new Request("http://internal.local/v1/chat/completions", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const res = await handleChat(req);
  const status = res?.status ?? 0;

  let payload = null;
  try { payload = await res.json(); } catch { payload = null; }

  if (status < 200 || status >= 300) {
    const msg = payload?.error?.message || payload?.error || `HTTP ${status}`;
    throw new Error(String(msg).slice(0, 500));
  }

  const text =
    payload?.choices?.[0]?.message?.content ??
    (typeof payload?.content === "string" ? payload.content : null) ??
    null;

  if (!text || typeof text !== "string" || !text.trim()) {
    throw new Error("上游返回空内容");
  }
  return text.trim();
}

/**
 * 阶段性提示词。集中在此，便于审阅与本地化。
 */
export const PROMPTS = {
  outline: (topic) =>
    [
      "你是资深内容策划。请为主题输出一份结构化大纲。",
      "",
      `主题：${topic}`,
      "",
      "要求：",
      "1. 用 Markdown 输出，章节用 `## ` 开头；",
      "2. 3–5 个章节，每章 2–4 个要点；",
      "3. 只输出大纲，不要前言后语。",
    ].join("\n"),

  draft: (topic, outline) =>
    [
      "你是资深撰稿人。请依据大纲写出完整正文。",
      "",
      `主题：${topic}`,
      "",
      "大纲：",
      outline,
      "",
      "要求：",
      "1. 保留大纲的 `## ` 章节结构；",
      "2. 每章 150–300 字，言之有物；",
      "3. 只输出正文。",
    ].join("\n"),

  polish: (draft) =>
    [
      "你是严格的技术编辑。请润色下面这篇文稿。",
      "",
      draft,
      "",
      "要求：",
      "1. 保留 `## ` 章节结构；",
      "2. 删掉空话套话，替换模糊表述为具体表述；",
      "3. 只输出润色后的正文。",
    ].join("\n"),
};

/**
 * 本地校验阶段：不调模型，纯规则检查。
 * 存在的意义：给流水线一个「确定性收尾」，同时示范 Stage 可以是任意计算。
 */
export function checkStage({ draft }) {
  const text = String(draft || "");
  const issues = [];
  const headings = (text.match(/^##\s+/gm) || []).length;
  if (headings < 3) issues.push(`章节数不足（${headings} < 3）`);
  const chars = text.replace(/\s/g, "").length;
  if (chars < 200) issues.push(`正文过短（${chars} < 200 字）`);
  if (!/。|\./.test(text)) issues.push("未检测到完整句子结尾");
  return {
    ok: issues.length === 0,
    issues,
    stats: { headings, chars },
  };
}

/**
 * 生产线注册表。新增一条生产线 = 在 STAGES 里加一个键。
 * pipelines 的 kind 即这里的键。
 */
export const STAGES = {
  doc: [
    {
      name: "大纲",
      run: ({ topic, apiKey, model }) => callChat({ apiKey, model, messages: [{ role: "user", content: PROMPTS.outline(topic) }] }),
    },
    {
      name: "正文",
      run: ({ topic, apiKey, model, artifacts }) =>
        callChat({ apiKey, model, messages: [{ role: "user", content: PROMPTS.draft(topic, artifacts["大纲"]) }] }),
    },
    {
      name: "润色",
      run: ({ apiKey, model, artifacts }) =>
        callChat({ apiKey, model, messages: [{ role: "user", content: PROMPTS.polish(artifacts["正文"]) }] }),
    },
    {
      name: "校验",
      run: ({ artifacts }) => JSON.stringify(checkStage({ draft: artifacts["润色"] }), null, 2),
    },
  ],
};

export function getStages(kind) {
  return STAGES[kind] || null;
}

export function listPipelineKinds() {
  return Object.keys(STAGES).map((kind) => ({ kind, stages: STAGES[kind].map((s) => s.name) }));
}
