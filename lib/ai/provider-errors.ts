import { APIError } from "openai/core/error";

export const AI_PROVIDER_RETRY_AFTER = 30;

/**
 * Stable, user-facing provider failure categories. Keep the wire contract in
 * `AIProviderErrorStatus` in sync: routes map `status`/`code`/`message` only.
 */
export type AIProviderErrorCode =
  | "AI_PROVIDER_OVERLOADED"
  | "AI_PROVIDER_RATE_LIMITED"
  | "AI_PROVIDER_BAD_REQUEST"
  | "AI_PROVIDER_AUTH"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_INVALID_OUTPUT";

/**
 * Fixed messages only: provider errors can contain request credentials and raw
 * upstream bodies. Every message tells the operator which side to fix.
 */
const MESSAGES: Record<AIProviderErrorCode, string> = {
  AI_PROVIDER_OVERLOADED:
    "模型服务当前访问量过大，暂时无法响应。请稍后重试，或在 AI 配置中选择其他模型。",
  AI_PROVIDER_RATE_LIMITED:
    "模型服务暂时限制了请求，请稍后重试，或检查服务商控制台的额度与并发限制。",
  AI_PROVIDER_BAD_REQUEST:
    "模型服务拒绝了本次请求，可能是模型名称、协议或高级参数不受支持。请管理员检查 AI 配置后重试。",
  AI_PROVIDER_AUTH:
    "模型服务拒绝了身份验证，密钥可能已过期、被停用或额度不足。请管理员更新 AI 密钥后重试。",
  AI_PROVIDER_UNAVAILABLE:
    "模型服务暂时不可用。请稍后重试；若持续失败，请管理员检查服务商状态页或接口地址。",
  AI_INVALID_OUTPUT:
    "模型返回的分析计划不完整或无法解析（可能被截断）。请换一种问法重试；若持续失败，请管理员确认模型支持结构化输出。",
};

/**
 * Status sent to this app's clients. Upstream 4xx codes are deliberately not
 * passed through: provider 401 would be mistaken for an expired session (the
 * workspace logs the user out on any 401) and provider 400/422 would be
 * mistaken for invalid user input. From the client's point of view an upstream
 * contract/auth failure is a gateway failure (502), not their problem.
 */
const STATUSES: Record<AIProviderErrorCode, number> = {
  AI_PROVIDER_OVERLOADED: 429,
  AI_PROVIDER_RATE_LIMITED: 429,
  AI_PROVIDER_BAD_REQUEST: 502,
  AI_PROVIDER_AUTH: 502,
  AI_PROVIDER_UNAVAILABLE: 503,
  AI_INVALID_OUTPUT: 502,
};

export class AIProviderError extends Error {
  readonly status: number;
  /** Matches the shared retryable whitelist in lib/analysis/http-errors.ts. */
  readonly retryable: boolean;

  constructor(public readonly code: AIProviderErrorCode) {
    super(MESSAGES[code]);
    this.status = STATUSES[code];
    this.retryable =
      code === "AI_PROVIDER_OVERLOADED" ||
      code === "AI_PROVIDER_RATE_LIMITED" ||
      code === "AI_PROVIDER_UNAVAILABLE";
    this.name = "AIProviderError";
  }
}

const BAD_REQUEST_STATUSES = new Set([400, 404, 422]);

export function classifyAIProviderError(error: unknown): AIProviderError | null {
  if (!(error instanceof APIError)) return null;
  const status = error.status;
  if (status === 429) {
    // Zhipu overloads are reported as HTTP 429 with proprietary code 1305.
    return new AIProviderError(
      String(error.code) === "1305" ? "AI_PROVIDER_OVERLOADED" : "AI_PROVIDER_RATE_LIMITED",
    );
  }
  if (status === 401 || status === 403) return new AIProviderError("AI_PROVIDER_AUTH");
  if (status !== undefined && BAD_REQUEST_STATUSES.has(status))
    return new AIProviderError("AI_PROVIDER_BAD_REQUEST");
  if (status !== undefined && status >= 500 && status <= 599)
    return new AIProviderError("AI_PROVIDER_UNAVAILABLE");
  return null;
}
