import OpenAI from "openai";
import { APIConnectionTimeoutError, APIUserAbortError } from "openai/core/error";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { calculateCost, reserveBudget, settleBudget, type TokenUsage } from "../security/ai-cost";
import { QueryExecutionError } from "../security/query-execution";
import { getRuntimeAIConfig, OFFICIAL_AI_BASE_URL } from "../settings/ai";
import { AIConfigurationError, estimatePromptTokens, type PlanningOptions } from "./planner";
import { AIProviderError, classifyAIProviderError } from "./provider-errors";
import { isBailianQwenFlash } from "./bailian";
import { isZhipuGLMFlash } from "./zhipu";

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};
export type ToolCall = { id: string; name: string; arguments: string };
export type ToolMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  calls?: ToolCall[];
  callId?: string;
  // Responses reasoning/output items must be passed back intact with function results.
  responseItems?: ResponseInputItem[];
};
export type ToolTurn = { message: ToolMessage; model: string };
export type ToolModelOptions = PlanningOptions & { required?: boolean; maxTokens?: number };

function chatMessages(messages: ToolMessage[]): ChatCompletionMessageParam[] {
  return messages.map((message): ChatCompletionMessageParam => {
    if (message.role === "tool")
      return { role: "tool", tool_call_id: message.callId!, content: message.content };
    if (message.role === "assistant")
      return {
        role: "assistant",
        content: message.content || null,
        ...(message.calls?.length
          ? {
              tool_calls: message.calls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    return { role: message.role, content: message.content };
  });
}
function responseInput(messages: ToolMessage[]): ResponseInputItem[] {
  return messages.flatMap((message): ResponseInputItem[] => {
    if (message.responseItems) return message.responseItems;
    if (message.role === "tool")
      return [{ type: "function_call_output", call_id: message.callId!, output: message.content }];
    return [{ role: message.role, content: message.content }];
  });
}

/** Every actual model request reserves and settles budget, including failures and probe calls. */
export async function generateToolTurn(
  messages: ToolMessage[],
  tools: ToolDefinition[],
  options: ToolModelOptions = {},
): Promise<ToolTurn> {
  if (options.signal?.aborted) throw new QueryExecutionError("CANCELLED", "分析请求已取消。");
  const config = getRuntimeAIConfig();
  if (!config.enabled || !config.apiKey || !config.model) throw new AIConfigurationError();
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl || OFFICIAL_AI_BASE_URL,
    maxRetries: 0,
    timeout: 20_000,
  });
  const maxTokens = options.maxTokens ?? 1000;
  const common = {
    model: config.model,
    tool_choice: options.required ? ("required" as const) : ("auto" as const),
  };
  const chatPayload = {
    ...common,
    messages: chatMessages(messages),
    max_tokens: maxTokens,
    tools: tools.map((tool) => ({ type: "function" as const, function: tool })),
    ...(isBailianQwenFlash(config) ? { enable_thinking: false } : {}),
    ...(isZhipuGLMFlash(config) ? { thinking: { type: "disabled" as const } } : {}),
  };
  const responsesPayload = {
    ...common,
    input: responseInput(messages),
    max_output_tokens: maxTokens,
    store: false,
    tools: tools.map((tool) => ({ type: "function" as const, ...tool, strict: false })),
  };
  const payload = config.apiFormat === "chat_completions" ? chatPayload : responsesPayload;
  const estimatedInput = estimatePromptTokens(JSON.stringify(payload));
  let usage: TokenUsage = {
    promptTokens: estimatedInput,
    completionTokens: maxTokens,
    totalTokens: estimatedInput + maxTokens,
  };
  let estimated = true;
  const reservation = reserveBudget(calculateCost(config.model, usage, config.pricing).totalCost, {
    ...config.budgets,
    perRequest: Math.max(0, config.budgets.perRequest - (options.budgetContext?.spent ?? 0)),
  });
  try {
    let message: ToolMessage;
    if (config.apiFormat === "chat_completions") {
      const response = await client.chat.completions.create(chatPayload, {
        signal: options.signal,
      });
      if (response.usage) {
        usage = {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          totalTokens: response.usage.total_tokens,
        };
        estimated = false;
      }
      if (!response.choices[0] || response.choices[0].finish_reason === "length")
        throw new AIProviderError("AI_INVALID_OUTPUT");
      const output = response.choices[0].message;
      if (output.refusal) throw new AIProviderError("AI_INVALID_OUTPUT");
      const calls = (output.tool_calls ?? []).map((call) => {
        if (call.type !== "function") throw new AIProviderError("AI_INVALID_OUTPUT");
        return { id: call.id, name: call.function.name, arguments: call.function.arguments };
      });
      message = { role: "assistant", content: output.content ?? "", calls };
    } else {
      const response = await client.responses.create(responsesPayload, { signal: options.signal });
      if (response.usage) {
        usage = {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens,
          totalTokens: response.usage.total_tokens,
        };
        estimated = false;
      }
      if (response.status !== "completed" || response.incomplete_details)
        throw new AIProviderError("AI_INVALID_OUTPUT");
      const calls = response.output
        .filter((item) => item.type === "function_call")
        .map((item) => ({
          id: item.call_id,
          name: item.name,
          arguments: item.arguments,
        }));
      message = {
        role: "assistant",
        content: response.output_text ?? "",
        calls,
        responseItems: response.output as ResponseInputItem[],
      };
    }
    if (
      message.calls?.some((call) => !call.id || !call.name || call.arguments.length > 12_000) ||
      new Set(message.calls?.map((call) => call.id)).size !== (message.calls?.length ?? 0)
    )
      throw new AIProviderError("AI_INVALID_OUTPUT");
    return { message, model: config.model };
  } catch (error) {
    if (options.signal?.aborted || error instanceof APIUserAbortError)
      throw new QueryExecutionError("CANCELLED", "分析请求已取消。");
    if (error instanceof APIConnectionTimeoutError)
      throw new QueryExecutionError("TIMEOUT", "模型响应超时。");
    throw classifyAIProviderError(error) ?? error;
  } finally {
    const cost = settleBudget(
      reservation,
      config.model,
      usage,
      "comprehensive",
      config.pricing,
      estimated,
    );
    if (options.budgetContext) options.budgetContext.spent += cost.totalCost;
  }
}

export async function probeToolCalling(signal?: AbortSignal, generate = generateToolTurn) {
  const nonce = crypto.randomUUID();
  const budgetContext = { spent: 0 };
  const definition: ToolDefinition = {
    name: "verify_tool",
    description: "Return a server verification value.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
  };
  const messages: ToolMessage[] = [
    {
      role: "user",
      content:
        "Call verify_tool once, then return exactly the verification value in its output. Never guess it.",
    },
  ];
  const first = await generate(messages, [definition], {
    signal,
    required: true,
    budgetContext,
    maxTokens: 256,
  });
  const call = first.message.calls?.[0];
  if (
    first.message.calls?.length !== 1 ||
    call?.name !== "verify_tool" ||
    Object.keys(JSON.parse(call.arguments)).length
  )
    throw new AIProviderError("AI_INVALID_OUTPUT");
  messages.push(first.message, { role: "tool", callId: call.id, content: nonce });
  const final = await generate(messages, [definition], { signal, budgetContext, maxTokens: 128 });
  if (final.message.calls?.length || !final.message.content.includes(nonce))
    throw new AIProviderError("AI_INVALID_OUTPUT");
  return { model: final.model };
}
