import { NextResponse } from "next/server";
import { getUserSkillById, recordSkillUse } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

// POST /api/skills/[id]/use — 记录一次成功使用（uses+1, confidence 强化）
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const skill = await getUserSkillById(id);
    if (!skill) {
      return NextResponse.json({ error: "Skill not found" }, { status: 404, headers: NO_STORE_HEADERS });
    }
    const updated = await recordSkillUse(id);
    return NextResponse.json({ skill: updated }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error recording skill use:", error);
    return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS });
  }
}