import { NextResponse } from "next/server";
import { rejectSkillUse } from "@/lib/localDb";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

function notFound(message) {
  return NextResponse.json({ error: message }, { status: 404, headers: NO_STORE_HEADERS });
}

function serverError() {
  return NextResponse.json({ error: "操作失败" }, { status: 500, headers: NO_STORE_HEADERS });
}

// POST /api/skills/[id]/reject — 把技能标记为「不好使/失效」：confidence 反向收敛（负反馈）。
export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const updated = await rejectSkillUse(id);
    if (!updated) return notFound("Skill not found");
    return NextResponse.json({ skill: updated }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.log("Error rejecting skill:", error);
    return serverError();
  }
}
