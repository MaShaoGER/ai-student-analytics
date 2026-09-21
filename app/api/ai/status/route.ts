import { NextResponse } from "next/server";
import { getAIStatus } from "@/lib/ai/planner";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getAIStatus());
}
