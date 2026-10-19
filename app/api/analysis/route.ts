import { NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysis } from "@/lib/analysis/duckdb";
import { analysisPlanSchema, type AnalysisRecord } from "@/lib/analysis/types";
import { noDataHttpError, queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { analysisRecordContext, saveAnalysisAudit } from "@/lib/records";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";
import {
  readJsonBody,
  REQUEST_TOO_LARGE_CODE,
  REQUEST_TOO_LARGE_MESSAGE,
  RequestBodyTooLargeError,
} from "@/lib/security/request-body";
import { apiError, assertSameOrigin, requireUser } from "@/lib/auth/http";

export const runtime = "nodejs";
const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export async function POST(request: Request) {
  let userId: string;
  try {
    assertSameOrigin(request);
    userId = (await requireUser(request)).id;
  } catch (error) { return apiError(error); }
  // Check rate limit
  const rateLimitResult = checkRateLimit(`analysis:${userId}`, rateLimitConfigs.analysis);

  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: "请求过于频繁。请稍后再试。",
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
    const payload: unknown = await readJsonBody(request, { maxBytes: MAX_REQUEST_BODY_BYTES });
    context = analysisRecordContext(payload);
    const plan = analysisPlanSchema.parse(payload);
    stage = "execution";
    const analysis = await runAnalysis(plan, { signal: request.signal });

    const emptyResult = analysis.result.rows.length === 0 ? noDataHttpError(analysis.result) : null;
    await saveAnalysisAudit({
      ...analysisRecordContext(analysis.plan),
      userId,
      requestSource: "analysis",
      stage,
      result: {
        rowCount: analysis.result.rows.length,
        period: analysis.result.period,
        durationMs: analysis.result.durationMs,
      },
      errorCode: emptyResult?.code ?? null,
      errorMessage: emptyResult?.error ?? null,
    });

    // Check for empty results
    if (emptyResult) {
      return NextResponse.json(
        {
          error: emptyResult.error,
          code: emptyResult.code,
          ...analysis,
        },
        { status: 422 }
      );
    }

    return NextResponse.json(analysis);
  } catch (error) {
    const failure = queryExecutionHttpError(error) ?? (
      error instanceof RequestBodyTooLargeError
        ? { error: REQUEST_TOO_LARGE_MESSAGE, code: REQUEST_TOO_LARGE_CODE, status: 413 }
        : error instanceof z.ZodError || (stage === "validation" && error instanceof SyntaxError)
          ? { error: "分析计划不合法，请检查指标、聚合方式、维度和返回条数。", code: "INVALID_PLAN", status: 400 }
          : { error: "分析执行失败，请稍后重试或联系管理员检查数据源。", code: "ANALYSIS_FAILED", status: 500 }
    );
    await saveAnalysisAudit({
      ...context,
      userId,
      requestSource: "analysis",
      stage,
      result: { rowCount: 0, period: "", durationMs: Math.round(performance.now() - startedAt) },
      errorCode: failure.code,
      errorMessage: failure.error,
    });
    return NextResponse.json(
      { error: failure.error, code: failure.code },
      { status: failure.status, ...(failure.status === 413 ? { headers: { "Cache-Control": "no-store" } } : {}) },
    );
  }
}
