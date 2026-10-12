import { NextResponse } from "next/server";
import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { AIConfigurationError, testAIConnection } from "@/lib/ai/planner";
import { BudgetExceededError, getPublicCostStats, UnknownModelPricingError } from "@/lib/security/ai-cost";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireAdmin(request);
    const limit = checkRateLimit(`ai-test:${user.id}`, rateLimitConfigs.strict);
    if (!limit.allowed) return NextResponse.json({ error: "连接测试过于频繁，请稍后重试。", code: "RATE_LIMIT_EXCEEDED" }, { status: 429 });
    const result = await testAIConnection();
    return noStoreJson({ success: true, message: "已收到可验证的分析计划，AI 连接正常。本次测试已产生一次实际调用。", model: result.model, stats: getPublicCostStats() });
  } catch (error) {
    if (error instanceof BudgetExceededError) return NextResponse.json({ error: error.message, code: "AI_BUDGET_EXCEEDED" }, { status: 429 });
    if (error instanceof UnknownModelPricingError) return NextResponse.json({ error: error.message, code: "AI_PRICING_REQUIRED" }, { status: 503 });
    if (error instanceof AIConfigurationError) return NextResponse.json({ error: error.message, code: "AI_NOT_CONFIGURED" }, { status: 503 });
    const handled = apiError(error);
    if (handled.status !== 500) return handled;
    return NextResponse.json({ error: "AI 连接测试未通过，请检查密钥、模型是否支持结构化输出，以及服务端网络。调用失败也可能产生费用，详情以服务商账单为准。", code: "AI_TEST_FAILED" }, { status: 502 });
  }
}
