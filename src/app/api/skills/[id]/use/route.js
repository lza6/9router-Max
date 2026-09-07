import { NextResponse } from "next/server";
import { recordSkillUse } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function notFound(message) {
  return NextResponse.json({ error: message }, { status: 404, headers: NO_STORE_HEADERS });
}

function serverError() {
  return NextResponse.json({ error: "操作失败" }, { status: 500, headers: NO_STORE_HEADERS });
}

// POST /api/skills/[id]/use — 记录一次成功使用（uses+1, confidence 原子强化）
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const updated = await recordSkillUse(id);
    if (!updated) return notFound("Skill not found");
    return NextResponse.json({ skill: updated }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error recording skill use:", error);
    return serverError();
  }
}