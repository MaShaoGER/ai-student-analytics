import { z } from "zod";
import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import {
  getAnalysisSettings,
  saveAnalysisSettings,
  getAnalysisCapability,
  analysisConfigFingerprint,
  saveAnalysisCapability,
} from "@/lib/settings/analysis";
import { knowledgeStatus, rebuildKnowledgeIndex } from "@/lib/ai/knowledge";
import { probeToolCalling } from "@/lib/ai/tool-provider";
import { AIConfigurationError } from "@/lib/ai/planner";
import { AIProviderError } from "@/lib/ai/provider-errors";
import { BudgetExceededError, UnknownModelPricingError } from "@/lib/security/ai-cost";
import { queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
function state() {
  return {
    settings: getAnalysisSettings(),
    capability: getAnalysisCapability(),
    knowledge: knowledgeStatus(),
  };
}
function failure(error: unknown) {
  const query = queryExecutionHttpError(error);
  if (query)
    return Response.json(query, { status: query.status, headers: { "Cache-Control": "no-store" } });
  if (error instanceof AIProviderError)
    return Response.json(
      { error: error.message, code: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  if (
    error instanceof AIConfigurationError ||
    error instanceof UnknownModelPricingError ||
    error instanceof BudgetExceededError
  )
    return Response.json(
      {
        error: error.message,
        code:
          error instanceof BudgetExceededError
            ? "AI_BUDGET_EXCEEDED"
            : error instanceof UnknownModelPricingError
              ? "AI_PRICING_REQUIRED"
              : "AI_NOT_CONFIGURED",
      },
      {
        status: error instanceof BudgetExceededError ? 429 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  return apiError(error);
}
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return noStoreJson(state());
  } catch (error) {
    return failure(error);
  }
}
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    await requireAdmin(request);
    saveAnalysisSettings(await request.json());
    return noStoreJson(state());
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin(request);
    const { action } = z
      .object({ action: z.enum(["probe", "rebuild"]) })
      .strict()
      .parse(await request.json());
    if (!checkRateLimit(`analysis-control:${user.id}`, rateLimitConfigs.strict).allowed)
      return Response.json(
        { error: "操作过于频繁，请稍后重试。", code: "RATE_LIMIT_EXCEEDED" },
        { status: 429 },
      );
    if (action === "rebuild") rebuildKnowledgeIndex();
    else {
      const fingerprint = analysisConfigFingerprint();
      try {
        await probeToolCalling(request.signal);
        saveAnalysisCapability(fingerprint, true);
      } catch (error) {
        // A transient network/price/budget failure is not evidence of an unsupported protocol.
        if (
          error instanceof AIProviderError &&
          (error.code === "AI_INVALID_OUTPUT" || error.code === "AI_PROVIDER_BAD_REQUEST")
        )
          saveAnalysisCapability(fingerprint, false);
        throw error;
      }
    }
    return noStoreJson(state());
  } catch (error) {
    return failure(error);
  }
}
