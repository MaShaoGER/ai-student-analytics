import { NextResponse } from "next/server";
import { z } from "zod";
import { converse } from "@/lib/ai/conversation";
import { chatInputSchema } from "@/lib/ai/chat-types";
import { PROMPT_VERSION } from "@/lib/ai/prompts/version";
import { AIConfigurationError } from "@/lib/ai/planner";
import { AIProviderError, AI_PROVIDER_RETRY_AFTER } from "@/lib/ai/provider-errors";
import { apiError, assertSameOrigin, noStoreJson, requireUser } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { isRetryableErrorCode, queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { analysisRecordContext, saveAnalysisAudit } from "@/lib/records";
import { BudgetExceededError, UnknownModelPricingError } from "@/lib/security/ai-cost";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let userId: string;
  try {
    assertSameOrigin(request);
    userId = (await requireUser(request)).id;
  } catch (error) {
    // Every /api/chat error carries the same { error, code, retryable } shape.
    if (error instanceof AuthError)
      return NextResponse.json(
        { error: error.message, code: error.code, retryable: false },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    return apiError(error);
  }
  // Share the existing natural-language quota; switching endpoints cannot bypass it.
  const limit = checkRateLimit(`ask:${userId}`, rateLimitConfigs.ask);
  if (!limit.allowed)
    return NextResponse.json(
      { error: "请求过于频繁，请约 30 秒后再试。", code: "RATE_LIMIT_EXCEEDED", retryable: true },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store",
          "Retry-After": String(Math.ceil(limit.resetAfter / 1000)),
        },
      },
    );
  let context = analysisRecordContext(null);
  let stage: "validation" | "planning" | "execution" = "validation";
  const startedAt = performance.now();
  const currentStage = (): "validation" | "planning" | "execution" => stage;
  const audit = (
    errorCode: string | null,
    errorMessage: string | null,
    rowCount = 0,
    period = "",
    model: string | null = null,
  ) =>
    saveAnalysisAudit({
      ...context,
      userId,
      requestSource: "ask",
      stage,
      promptVersion: PROMPT_VERSION,
      model,
      result: { rowCount, period, durationMs: Math.round(performance.now() - startedAt) },
      errorCode,
      errorMessage,
    });
  try {
    // Bound the body before parsing untrusted history, even for chunked requests.
    const reader = request.body?.getReader();
    let text = "";
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > 150_000) {
          await reader.cancel();
          await audit("INVALID_QUESTION", "对话内容超过长度限制。");
          return NextResponse.json(
            {
              error: "对话内容过长，请开始新对话。",
              code: "INVALID_QUESTION",
              retryable: false,
            },
            { status: 413, headers: { "Cache-Control": "no-store" } },
          );
        }
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    }
    const payload: unknown = JSON.parse(text);
    context = { ...analysisRecordContext(payload), metricId: null, plan: null };
    const input = chatInputSchema.parse(payload);
    stage = "planning";
    const response = await converse(input, {
      signal: request.signal,
      onExecution(plan) {
        stage = "execution";
        if (plan) context = analysisRecordContext(plan);
      },
    });
    const artifact = response.artifact;
    await audit(
      null,
      null,
      artifact?.kind === "analysis"
        ? artifact.result.rows.length
        : artifact?.kind === "distribution"
          ? artifact.data.groups.length
          : artifact?.kind === "studio"
            ? artifact.table.rows.length
            : artifact?.kind === "relations" || artifact?.kind === "panorama"
              ? artifact.data.relations.length
              : 0,
      artifact?.kind === "analysis" ? artifact.result.period : "",
      response.planning.model,
    );
    return noStoreJson(response);
  } catch (error) {
    const queryFailure = queryExecutionHttpError(error);
    const failure =
      queryFailure ??
      (error instanceof AuthError
        ? { status: error.status, code: error.code, error: error.message }
        : error instanceof AIConfigurationError
          ? { status: 503, code: "AI_NOT_CONFIGURED", error: error.message }
          : error instanceof AIProviderError
            ? { status: error.status, code: error.code, error: error.message }
            : error instanceof BudgetExceededError
              ? { status: 429, code: "AI_BUDGET_EXCEEDED", error: error.message }
              : error instanceof UnknownModelPricingError
                ? { status: 503, code: "AI_PRICING_REQUIRED", error: error.message }
                : currentStage() === "validation" &&
                    (error instanceof z.ZodError || error instanceof SyntaxError)
                  ? {
                      status: 400,
                      code: "INVALID_QUESTION",
                      error: "请输入2–500字的问题，或开始新对话后重试。",
                    }
                  : currentStage() === "execution"
                    ? {
                        status: 500,
                        code: "ANALYSIS_FAILED",
                        error: "数据查询暂未完成，请稍后重试。",
                      }
                    : {
                        status: 502,
                        code: "AI_PLANNING_FAILED",
                        error: "AI 暂未完成回复，请稍后重试。",
                      });
    // Never persist conversational text, model replies, raw result rows or driver details.
    await audit(failure.code, "对话请求未完成。");
    return NextResponse.json(
      { error: failure.error, code: failure.code, retryable: isRetryableErrorCode(failure.code) },
      {
        status: failure.status,
        headers: {
          "Cache-Control": "no-store",
          ...(error instanceof AIProviderError && error.status === 429
            ? { "Retry-After": String(AI_PROVIDER_RETRY_AFTER) }
            : {}),
        },
      },
    );
  }
}
