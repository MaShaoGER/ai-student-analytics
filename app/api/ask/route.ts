import { NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysis } from "@/lib/analysis/duckdb";
import {
  AIClarificationError,
  AIConfigurationError,
  planQuestion,
  planQuestionInputSchema,
} from "@/lib/ai/planner";
import { saveAnalysisRecord } from "@/lib/records";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";
import { apiError, assertSameOrigin, requireUser } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { BudgetExceededError, UnknownModelPricingError } from "@/lib/security/ai-cost";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let clientId: string;
  try {
    assertSameOrigin(request);
    clientId = `ask:${(await requireUser(request)).id}`;
  } catch (error) { return apiError(error); }
  // Check rate limit (stricter for ask due to AI cost)
  const rateLimitResult = checkRateLimit(clientId, rateLimitConfigs.ask);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: "自然语言请求过于频繁。请稍后再试。",
        code: "RATE_LIMIT_EXCEEDED",
        retryAfter: Math.ceil(rateLimitResult.resetAfter / 1000),
      },
      {
        status: 429,
        headers: {
          "Retry-After": Math.ceil(rateLimitResult.resetAfter / 1000).toString(),
        },
      }
    );
  }

  try {
    const input = planQuestionInputSchema.parse(await request.json());
    const planned = await planQuestion(input);
    const analysis = await runAnalysis(planned.plan);

    // Save analysis record
    try {
      await saveAnalysisRecord({
        datasetId: analysis.result.datasetId,
        datasetVersion: "1.0",
        metricId: analysis.plan.metric,
        metricVersion: "1.0",
        plan: analysis.plan,
        result: {
          rowCount: analysis.result.rows.length,
          period: analysis.result.period,
          durationMs: analysis.result.durationMs,
        },
        errorCode: null,
        errorMessage: null,
      });
    } catch (recordError) {
      console.error("Warning: failed to save analysis record", recordError);
    }

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
    if (error instanceof AuthError) return apiError(error);
    if (error instanceof BudgetExceededError) return NextResponse.json({ error: error.message, code: "AI_BUDGET_EXCEEDED" }, { status: 429 });
    if (error instanceof UnknownModelPricingError) return NextResponse.json({ error: error.message, code: "AI_PRICING_REQUIRED" }, { status: 503 });
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
    return NextResponse.json(
      { error: "AI 暂时无法生成分析计划，请稍后重试。", code: "AI_PLANNING_FAILED" },
      { status: 502 },
    );
  }
}
