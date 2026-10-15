import { APIError } from "openai/core/error";

export const AI_PROVIDER_RETRY_AFTER = 30;
export type AIProviderErrorCode = "AI_PROVIDER_OVERLOADED" | "AI_PROVIDER_RATE_LIMITED";

/** Fixed messages only: provider errors can contain request credentials. */
export class AIProviderError extends Error {
  readonly status = 429;

  constructor(public readonly code: AIProviderErrorCode) {
    super(code === "AI_PROVIDER_OVERLOADED"
      ? "模型服务当前访问量过大，暂时无法响应。请稍后重试，或在 AI 配置中选择其他模型。"
      : "模型服务暂时限制了请求，请稍后重试，或检查服务商控制台的额度与并发限制。");
    this.name = "AIProviderError";
  }
}

export function classifyAIProviderError(error: unknown): AIProviderError | null {
  if (!(error instanceof APIError) || error.status !== 429) return null;
  return new AIProviderError(String(error.code) === "1305" ? "AI_PROVIDER_OVERLOADED" : "AI_PROVIDER_RATE_LIMITED");
}
