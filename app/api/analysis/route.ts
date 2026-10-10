import { NextResponse } from "next/server";
import { z } from "zod";
import { runAnalysis } from "@/lib/analysis/duckdb";
import { saveAnalysisRecord } from "@/lib/records";
import { checkRateLimit, extractClientId, rateLimitConfigs } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // Check rate limit
  const clientId = extractClientId(request);
  const rateLimitResult = checkRateLimit(clientId, rateLimitConfigs.analysis);

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

  try {
    const payload: unknown = await request.json();
    const analysis = await runAnalysis(payload);

    // Check for empty results
    if (analysis.result.rows.length === 0) {
      return NextResponse.json(
        {
          error: `未找到满足条件的分析结果。请检查所选指标、分组维度和筛选条件。最小样本阈值：${analysis.result.minSampleSize} 名学生。`,
          code: "NO_DATA",
        },
        { status: 422 }
      );
    }

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
      // Don't fail the whole request if record saving fails
    }

    return NextResponse.json(analysis);
  } catch (error) {
    // Try to save error record
    try {
      const errorMessage =
        error instanceof z.ZodError
          ? "分析计划不合法，请检查指标、聚合方式、维度和返回条数。"
          : error instanceof Error
            ? error.message
            : "分析请求失败，请稍后重试。";

      await saveAnalysisRecord({
        datasetId: "demo",
        datasetVersion: "1.0",
        metricId: "score",
        metricVersion: "1.0",
        plan: {} as any,
        result: {
          rowCount: 0,
          period: "",
          durationMs: 0,
        },
        errorCode: error instanceof z.ZodError ? "INVALID_PLAN" : "ANALYSIS_FAILED",
        errorMessage: errorMessage,
      });
    } catch (recordError) {
      console.error("Warning: failed to save error record", recordError);
    }

    const message =
      error instanceof z.ZodError
        ? "分析计划不合法，请检查指标、聚合方式、维度和返回条数。"
        : error instanceof Error
          ? error.message
          : "分析请求失败，请稍后重试。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
