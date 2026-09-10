import { NextResponse } from "next/server";
import { getUserSkills, createUserSkill } from "@/lib/localDb";
import { skillValidationErrorMessages, skillValidationWarnings } from "@/lib/skillValidation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// 与 skillsRepo 常量保持一致的输入上限
const MAX_NAME_LEN = 100;
const MAX_DESC_LEN = 500;
const MAX_CONTENT_LEN = 20000;
const MAX_TAGS = 20;
const MAX_TAG_LEN = 50;

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS });
}

function serverError() {
  return NextResponse.json({ error: "操作失败" }, { status: 500, headers: NO_STORE_HEADERS });
}

// GET /api/skills — 用户自定义技能列表（uses 降序）
export async function GET() {
  try {
    const skills = await getUserSkills();
    return NextResponse.json({ skills }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error listing user skills:", error);
    return serverError();
  }
}

// POST /api/skills — 创建自定义技能（save_skill）
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON");
  }
  try {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    const description = typeof body.description === "string" ? body.description.trim() : "";
    const tags = Array.isArray(body.tags) ? body.tags : [];
    if (!name) return badRequest("name is required");
    if (!content) return badRequest("content is required");
    if (name.length > MAX_NAME_LEN) return badRequest(`name exceeds ${MAX_NAME_LEN} chars`);
    if (content.length > MAX_CONTENT_LEN) return badRequest(`content exceeds ${MAX_CONTENT_LEN} chars`);
    if (description.length > MAX_DESC_LEN) return badRequest(`description exceeds ${MAX_DESC_LEN} chars`);
    if (tags.length > MAX_TAGS) return badRequest(`tags exceeds ${MAX_TAGS} items`);
    for (const t of tags) {
      if (typeof t !== "string") return badRequest("tags must be an array of strings");
      if (t.trim().length > MAX_TAG_LEN) return badRequest(`tag exceeds ${MAX_TAG_LEN} chars`);
    }
    // 质量门禁（P1-B）+ 安全静态扫描（P2-b）：description 触发词 + content 结构 + 密钥/私有地址检测。
    // 兼容存量：description 为空放行（前端标「待完善」），但内容结构/密钥问题为硬性错误。
    const validationErrors = skillValidationErrorMessages({ description, content });
    if (validationErrors) return badRequest(validationErrors.join("; "));
    const skill = await createUserSkill({ name, description, content, tags });
    // 表达质量建议（负触发/四要素/输出契约）：非阻断，仅在非空时回给前端展示。
    const warnings = skillValidationWarnings({ description, content });
    const payload = { skill };
    if (warnings.length) payload.warnings = warnings;
    return NextResponse.json(payload, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error creating user skill:", error);
    // 业务校验错误（必填/超长）应原样透出给前端；DB 异常收敛为通用错误。
    if (error?.message && /(required|exceeds)/i.test(error.message)) return badRequest(error.message);
    return serverError();
  }
}