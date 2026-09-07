import { NextResponse } from "next/server";
import { getUserSkills, createUserSkill } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function badRequest(message) {
  return NextResponse.json({ error: message }, { status: 400, headers: NO_STORE_HEADERS });
}

// GET /api/skills — 用户自定义技能列表（uses 降序）
export async function GET() {
  try {
    const skills = await getUserSkills();
    return NextResponse.json({ skills }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error listing user skills:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

// POST /api/skills — 创建自定义技能（save_skill）
export async function POST(request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) return badRequest("Invalid JSON body");
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const content = typeof body.content === "string" ? body.content.trim() : "";
    if (!name) return badRequest("name is required");
    if (!content) return badRequest("content is required");
    const skill = await createUserSkill({
      name,
      description: typeof body.description === "string" ? body.description : "",
      content,
      tags: Array.isArray(body.tags) ? body.tags : [],
    });
    return NextResponse.json({ skill }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error creating user skill:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}