import { NextResponse } from "next/server";
import {
  getUserSkillById, updateUserSkill, deleteUserSkill,
} from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS });
}

function notFound(message) {
  return NextResponse.json({ error: message }, { status: 404, headers: NO_STORE_HEADERS });
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
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// PUT /api/skills/[id] — 更新
export async function PUT(request, { params }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON body");
    const updated = await updateUserSkill(id, body);
    if (!updated) return notFound("Skill not found");
    return NextResponse.json({ skill: updated }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error updating user skill:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
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
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}