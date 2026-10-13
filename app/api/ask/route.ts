import { NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysis } from "@/lib/analysis/duckdb";
import { type AnalysisRecord } from "@/lib/analysis/types";
import { type AnalysisHttpError, noDataHttpError, queryExecutionHttpError } from "@/lib/analysis/http-errors";
import {
  AIClarificationError,
  AIConfigurationError,
  planQuestion,
  planQuestionInputSchema,
} from "@/lib/ai/planner";
import { analysisRecordContext, saveAnalysisAudit } from "@/lib/records";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";
import { apiError, assertSameOrigin, requireUser } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { BudgetExceededError, UnknownModelPricingError } from "@/lib/security/ai-cost";

export const runtime = "nodejs";

function askHttpError(error: unknown, stage: AnalysisRecord["stage"]): AnalysisHttpError & { clarificationQuestion?: string } {
  const queryFailure = queryExecutionHttpError(error);
  if (queryFailure) return queryFailure;
  if (error instanceof AuthError) return { error: error.message, code: error.code, status: error.status };
  if (error instanceof BudgetExceededError) return { error: error.message, code: "AI_BUDGET_EXCEEDED", status: 429 };
  if (error instanceof UnknownModelPricingError) return { error: error.message, code: "AI_PRICING_REQUIRED", status: 503 };
  if (error instanceof AIClarificationError) {
    return { error: error.message, code: "CLARIFICATION_REQUIRED", clarificationQuestion: error.clarificationQuestion, status: 422 };
  }
  if (error instanceof AIConfigurationError) return { error: error.message, code: "AI_NOT_CONFIGURED", status: 503 };
  if (stage === "validation" && (error instanceof z.ZodError || error instanceof SyntaxError)) {
    return { error: "问题不合法，请输入 2–500 个字符并选择有效数据源。", code: "INVALID_QUESTION", status: 400 };
  }
  if (stage === "execution" && error instanceof z.ZodError) {
    return { error: "分析计划不合法，请检查指标、聚合方式、维度和返回条数。", code: "INVALID_PLAN", status: 400 };
  }
  if (stage === "execution") {
    return { error: "分析执行失败，请稍后重试或联系管理员检查数据源。", code: "ANALYSIS_FAILED", status: 500 };
  }
  return { error: "AI 暂时无法生成分析计划，请稍后重试。", code: "AI_PLANNING_FAILED", status: 502 };
}

export async function POST(request: Request) {
  let userId: string;
  try {
    assertSameOrigin(request);
    userId = (await requireUser(request)).id;
  } catch (error) { return apiError(error); }
  // Check rate limit (stricter for ask due to AI cost)
  const rateLimitResult = checkRateLimit(`ask:${userId}`, rateLimitConfigs.ask);

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

  let context = analysisRecordContext(null);
  let stage: AnalysisRecord["stage"] = "validation";
  const startedAt = performance.now();
  try {
    const payload: unknown = await request.json();
    // Question input has no metric yet; never infer one before a plan exists.
    context = { ...analysisRecordContext(payload), metricId: null, plan: null };
    const input = planQuestionInputSchema.parse(payload);
    stage = "planning";
    const planned = await planQuestion(input, undefined, { signal: request.signal });
    context = analysisRecordContext(planned.plan);
    stage = "execution";
    const analysis = await runAnalysis(planned.plan, { signal: request.signal });

    const emptyResult = analysis.result.rows.length === 0 ? noDataHttpError(analysis.result) : null;
    await saveAnalysisAudit({
      ...analysisRecordContext(analysis.plan),
      userId,
      requestSource: "ask",
      stage,
      result: {
        rowCount: analysis.result.rows.length,
        period: analysis.result.period,
        durationMs: analysis.result.durationMs,
      },
      errorCode: emptyResult?.code ?? null,
      errorMessage: emptyResult?.error ?? null,
    });
    if (emptyResult) {
      return NextResponse.json({ error: emptyResult.error, code: emptyResult.code }, { status: emptyResult.status });
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
    const failure = askHttpError(error, stage);
    // Clarification/configuration errors may quote user or provider text; audit a safe summary.
    const auditMessage = failure.code === "CLARIFICATION_REQUIRED" ? "问题口径需要澄清。"
      : failure.code === "AI_NOT_CONFIGURED" ? "AI 未配置或已停用。"
      : error instanceof AuthError ? "分析请求权限校验失败。"
      : failure.error;
    await saveAnalysisAudit({
      ...context,
      userId,
      requestSource: "ask",
      stage,
      result: { rowCount: 0, period: "", durationMs: Math.round(performance.now() - startedAt) },
      errorCode: failure.code,
      errorMessage: auditMessage,
    });
    if (error instanceof AuthError) return apiError(error);
    const { status, ...body } = failure;
    return NextResponse.json(body, { status });
  }
}
