import { NextResponse } from "next/server";
import {
  getUserSkillById, updateUserSkill, deleteUserSkill,
} from "@/lib/localDb";
import { skillValidationErrorMessages } from "@/lib/skillValidation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS });
}

function notFound(message) {
  return NextResponse.json({ error: message }, { status: 404, headers: NO_STORE_HEADERS });
}

function serverError() {
  return NextResponse.json({ error: "操作失败" }, { status: 500, headers: NO_STORE_HEADERS });
}

// GET /api/skills/[id] — 单个技能详情
export async function GET(request, { params }) {
  try {
    const { id } = await params;
    const skill = await getUserSkillById(id);
    if (!skill) return notFound("Skill not found");
    return NextResponse.json({ skill }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error getting user skill:", error);
    return serverError();
  }
}

// PUT /api/skills/[id] — 更新（类型校验对齐 POST）
export async function PUT(request, { params }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return badRequest("Request body must be valid JSON");
  }
  try {
    const { id } = await params;
    // 白名单字段 + 类型强校验（非法类型 → 400，不静默吞）
    const patch = {};
    if (body.name !== undefined) {
      if (typeof body.name !== "string") return badRequest("name must be a string");
      patch.name = body.name;
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string") return badRequest("description must be a string");
      // description 更新同样过质量门禁（触发词）。
      const nextDesc = body.description;
      const current = await getUserSkillById(id).catch(() => null);
      const validationErrors = skillValidationErrorMessages({
        description: nextDesc,
        content: typeof body.content === "string" ? body.content : (current?.content || ""),
      });
      if (validationErrors) return badRequest(validationErrors.join("; "));
      patch.description = body.description;
    }
    if (body.content !== undefined) {
      if (typeof body.content !== "string") return badRequest("content must be a string");
      if (!body.content.trim()) return badRequest("content is required");
      // 质量门禁 / 安全扫描：对最终合并值校验（含新 description 的新 content）。
      const nextDesc = typeof body.description === "string" ? body.description : undefined;
      const validationErrors = skillValidationErrorMessages({
        description: nextDesc ?? "",
        content: body.content,
      });
      if (validationErrors) return badRequest(validationErrors.join("; "));
      patch.content = body.content;
    }
    if (body.tags !== undefined) {
      if (!Array.isArray(body.tags)) return badRequest("tags must be an array of strings");
      for (const t of body.tags) {
        if (typeof t !== "string") return badRequest("tags must be an array of strings");
      }
      patch.tags = body.tags;
    }
    const updated = await updateUserSkill(id, patch);
    if (!updated) return notFound("Skill not found");
    return NextResponse.json({ skill: updated }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error updating user skill:", error);
    return serverError();
  }
}

// DELETE /api/skills/[id]
export async function DELETE(request, { params }) {
  try {
    const { id } = await params;
    const deleted = await deleteUserSkill(id);
    if (!deleted) return notFound("Skill not found");
    return NextResponse.json({ success: true }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error deleting user skill:", error);
    return serverError();
  }
}