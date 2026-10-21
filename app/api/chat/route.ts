import { registerTurnCancellation } from "@/lib/conversations/cancellation";
import { assertTurnActive } from "@/lib/conversations/repository";
import { getUserById } from "@/lib/auth/service";
import { applyResponsePresentation } from "@/lib/analysis/presentation-policy";
import {
  beginConversationTurn,
  replayConversationTurn,
  presentationFromHistory,
  persistConversationResponse,
  failConversationTurn,
} from "@/lib/ai/conversation-session";
import { ConversationError, type ClaimTurnResult } from "@/lib/conversations/types";
import { isGradeDataset } from "@/lib/datasets/id";
import { getGradeSnapshot } from "@/lib/datasets/grade-store";
import { assertBusinessAccess, withBusinessAccess } from "@/lib/auth/access";
import type { SessionUser } from "@/lib/client-types";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createChatStream } from "@/lib/ai/chat-stream";
import type { AnalysisStep } from "@/lib/ai/chat-types";
import { converse } from "@/lib/ai/conversation";
import { UnifiedConversationError } from "@/lib/ai/unified";
import { chatInputSchema } from "@/lib/ai/chat-types";
import { PROMPT_VERSION } from "@/lib/ai/prompts/version";
import { AIConfigurationError } from "@/lib/ai/planner";
import { AIProviderError, AI_PROVIDER_RETRY_AFTER } from "@/lib/ai/provider-errors";
import { apiError, assertSameOrigin, noStoreJson, requireUser } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { isRetryableErrorCode, queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { analysisRecordContext, saveAnalysisAudit } from "@/lib/records";
import {
  BudgetExceededError,
  UnknownModelPricingError,
  type RequestUsage,
} from "@/lib/security/ai-cost";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  // One id per HTTP request: every model call made for it lands in cost history
  // and in the audit row under this id, including failures before a response.
  const requestId = crypto.randomUUID();
  let userId: string;
  let user: SessionUser;
  try {
    assertSameOrigin(request);
    user = await requireUser(request);
    userId = user.id;
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
  let durableTurn: ClaimTurnResult | null = null;
  let context = analysisRecordContext(null);
  let datasetVersion: string | undefined;
  const executionSteps = new Map<
    string,
    { operation: string; status: AnalysisStep["status"]; durationMs: number }
  >();
  const operations: Record<string, string> = {
    读取可用课程与学期: "catalog",
    选择下一步分析: "decision",
    查询聚合指标: "aggregate",
    比较学期成绩: "compare_terms",
    查询课程成绩分布: "score_distribution",
    // Absence is a real execution step; without this mapping its steps vanish
    // from the audit and its failures are misclassified as planning failures.
    查询缺勤课时与人数: "absence_stats",
    检索指标与教学依据: "search_knowledge",
    生成高级分析图表: "advanced_chart",
    确认分析范围: "clarify",
    // One corrective answer attempt after failed fact binding.
    重写最终回答: "compose_retry",
    校验统计结果与来源: "validate",
  };
  let stage: "validation" | "planning" | "execution" = "validation";
  const startedAt = performance.now();
  const currentStage = (): "validation" | "planning" | "execution" => stage;
  const audit = (
    errorCode: string | null,
    errorMessage: string | null,
    rowCount = 0,
    period = "",
    model: string | null = null,
    usage?: RequestUsage,
    outcome: "success" | "partial" | "failure" = errorCode ? "failure" : "success",
  ) =>
    saveAnalysisAudit({
      datasetVersion,
      ...context,
      userId,
      requestSource: "ask",
      stage,
      promptVersion: PROMPT_VERSION,
      model,
      requestId,
      outcome,
      ...(usage ? { usage } : {}),
      ...(executionSteps.size ? { executionSteps: [...executionSteps.values()] } : {}),
      result: { rowCount, period, durationMs: Math.round(performance.now() - startedAt) },
      errorCode,
      errorMessage,
    });
  const classify = (error: unknown) => {
    const queryFailure = queryExecutionHttpError(error);
    return (
      queryFailure ??
      (error instanceof ConversationError
        ? { status: error.status, code: error.code, error: error.message }
        : error instanceof UnifiedConversationError
          ? { status: 422, code: error.code, error: error.message }
          : error instanceof AuthError
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
                          })
    );
  };
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
    assertBusinessAccess(user, input.datasetId, "ai");
    durableTurn = beginConversationTurn(user, input);
    if (durableTurn?.claim.replayed) {
      const replayed = replayConversationTurn(user, durableTurn);
      return request.headers.get("accept")?.includes("text/event-stream")
        ? createChatStream(
            request.signal,
            async () => replayed,
            async () => ({ error: "无法恢复这轮结果。", code: "TURN_FINISHED", retryable: false }),
          )
        : noStoreJson(replayed);
    }
    // For durable sessions all model context comes from the server repository.
    const trustedInput = durableTurn
      ? { ...input, history: durableTurn.history, context: durableTurn.context }
      : input;
    const run = async (transportSignal: AbortSignal, onStep?: (step: AnalysisStep) => void) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      transportSignal.addEventListener("abort", abort, { once: true });
      if (transportSignal.aborted) abort();
      const signal = controller.signal;
      const unregister = durableTurn
        ? registerTurnCancellation(
            user.id,
            durableTurn.claim.conversationId,
            durableTurn.claim.turnId,
            abort,
          )
        : () => {};
      // Observe a durable stop handled by another server worker as well.
      const checker = durableTurn
        ? setInterval(() => {
            try {
              assertTurnActive(user.id, durableTurn!.claim);
              const currentUser = getUserById(user.id);
              if (!currentUser) {
                abort();
                return;
              }
              assertBusinessAccess(currentUser, input.datasetId, "ai");
            } catch {
              abort();
            }
          }, 1000)
        : null;
      checker?.unref();
      try {
        const computed = await withBusinessAccess(user, input.datasetId, "ai", () => {
          datasetVersion = isGradeDataset(input.datasetId)
            ? getGradeSnapshot(input.datasetId).version
            : undefined;
          const displayOnly = durableTurn
            ? presentationFromHistory(user, durableTurn, input.question)
            : null;
          if (displayOnly) return Promise.resolve(displayOnly);
          return converse(trustedInput, {
            signal,
            requestId,
            onStep(step) {
              const operation = operations[step.label];
              if (operation)
                executionSteps.set(step.id, {
                  operation,
                  status: step.status,
                  durationMs: step.durationMs,
                });
              stage = operation === "decision" ? "planning" : "execution";
              onStep?.(step);
            },
            onExecution(plan) {
              stage = "execution";
              if (plan) context = analysisRecordContext(plan);
            },
          });
        });
        const response = applyResponsePresentation(computed, input.question);
        const artifact = response.artifact;
        await audit(
          response.failureCode ?? null,
          response.failureCode ? "对话部分步骤未完成。" : null,
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
          // Partial results still report the usage/cost already spent this request.
          response.usage,
          response.failureCode ? "partial" : "success",
        );
        return durableTurn ? persistConversationResponse(user, durableTurn, response) : response;
      } finally {
        if (checker) clearInterval(checker);
        unregister();
        transportSignal.removeEventListener("abort", abort);
      }
    };
    // Transport negotiation is the only branch left: one execution entry for
    // every question, streamed when the client asks for it.
    if (request.headers.get("accept")?.includes("text/event-stream")) {
      return createChatStream(request.signal, run, async (error) => {
        const failure = classify(error);
        try {
          failConversationTurn(
            user,
            durableTurn,
            failure.code,
            error instanceof Error && (error.name === "AbortError" || failure.code === "CANCELLED"),
          );
        } catch {
          /* Deleted/expired/stopped results remain terminal. */
        }
        await audit(failure.code, "对话请求未完成。");
        return { ...failure, retryable: isRetryableErrorCode(failure.code) };
      });
    }
    return noStoreJson(await run(request.signal));
  } catch (error) {
    const failure = classify(error);
    try {
      failConversationTurn(
        user,
        durableTurn,
        failure.code,
        request.signal.aborted || failure.code === "CANCELLED",
      );
    } catch {
      /* Do not revive a terminal session. */
    }
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
