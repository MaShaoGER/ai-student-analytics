import { NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysis } from "@/lib/analysis/duckdb";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload: unknown = await request.json();
    const analysis = await runAnalysis(payload);
    return NextResponse.json(analysis);
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "分析计划不合法，请检查指标、聚合方式、维度和返回条数。"
        : error instanceof Error
          ? error.message
          : "分析请求失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
