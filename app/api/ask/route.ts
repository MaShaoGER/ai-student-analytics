import { NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysis } from "@/lib/analysis/duckdb";
import {
  AIClarificationError,
  AIConfigurationError,
  planQuestion,
  planQuestionInputSchema,
} from "@/lib/ai/planner";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = planQuestionInputSchema.parse(await request.json());
    const planned = await planQuestion(input);
    const analysis = await runAnalysis(planned.plan);
    return NextResponse.json({
      question: input.question,
      planning: {
        source: planned.source,
        rationale: planned.rationale,
        matchedCaseId: planned.matchedCaseId,
        model: planned.model,
      },
      ...analysis,
    });
  } catch (error) {
    if (error instanceof AIClarificationError) {
      return NextResponse.json(
        {
          error: error.message,
          code: "CLARIFICATION_REQUIRED",
          clarificationQuestion: error.clarificationQuestion,
        },
        { status: 422 },
      );
    }
    if (error instanceof AIConfigurationError) {
      return NextResponse.json(
        { error: error.message, code: "AI_NOT_CONFIGURED" },
        { status: 503 },
      );
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "问题不合法，请输入 2–500 个字符。", code: "INVALID_QUESTION" },
        { status: 400 },
      );
    }
    console.error("AI planning failed", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json(
      { error: "AI 暂时无法生成分析计划，请稍后重试。", code: "AI_PLANNING_FAILED" },
      { status: 502 },
    );
  }
}
