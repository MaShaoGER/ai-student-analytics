import OpenAI from "openai";
import { APIConnectionTimeoutError, APIUserAbortError } from "openai/core/error";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { findGoldenCase, planForDataset } from "../analysis/golden-cases";
import { METRICS } from "../analysis/metrics";
import { createPlan } from "../analysis/plan";
import { dataSourceSchema, type AnalysisPlan } from "../analysis/types";
import { calculateCost, reserveBudget, settleBudget, type TokenUsage } from "../security/ai-cost";
import { getAIConfig, getRuntimeAIConfig } from "../settings/ai";
import { QueryExecutionError } from "../security/query-execution";
import { isBailianQwenFlash } from "./bailian";
import { isZhipuGLMFlash } from "./zhipu";
import { classifyAIProviderError } from "./provider-errors";

const aiPlanFieldsSchema = z.object({
  canAnalyze: z.boolean(),
  metric: z.enum(["score", "activity", "completion_rate"]),
  dimension: z.enum(["course", "term"]),
  chartType: z.enum(["line", "bar", "table"]),
  rationale: z.string().min(1).max(200),
  clarificationQuestion: z.string().min(1).max(200).nullable(),
});

// A clarification has no executable plan. Responses still requires every wire field.
const aiPlanResponseSchema = aiPlanFieldsSchema.extend({
  metric: aiPlanFieldsSchema.shape.metric.nullable(),
  dimension: aiPlanFieldsSchema.shape.dimension.nullable(),
  chartType: aiPlanFieldsSchema.shape.chartType.nullable(),
});
const aiClarificationSchema = aiPlanFieldsSchema.pick({
  canAnalyze: true, rationale: true, clarificationQuestion: true,
}).extend({ canAnalyze: z.literal(false) });

export const planQuestionInputSchema = z.object({
  question: z.string().trim().min(2).max(500),
  datasetId: dataSourceSchema,
});

type AIPlanFields = z.infer<typeof aiPlanFieldsSchema>;
type PlanningOptions = { signal?: AbortSignal };
type StructuredPlanGenerator = (
  question: string,
  options?: PlanningOptions,
) => Promise<AIPlanFields & { usedModel?: string }>;

function assertPlanningActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw new QueryExecutionError("CANCELLED", "分析请求已取消。");
}

export class AIConfigurationError extends Error {
  constructor(message = "AI 尚未配置，请让管理员在系统管理中设置模型和密钥。你仍可以使用常用分析问题。") {
    super(message);
    this.name = "AIConfigurationError";
  }
}

export class AIClarificationError extends Error {
  constructor(public readonly clarificationQuestion: string) {
    super(clarificationQuestion);
    this.name = "AIClarificationError";
  }
}

export type PlannedQuestion = {
  plan: AnalysisPlan;
  source: "golden_case" | "openai" | "external";
  rationale: string;
  matchedCaseId: string | null;
  model: string | null;
};

export function getAIStatus() {
  const config = getAIConfig();
  return {
    configured: Boolean(config.keyConfigured && config.model),
    enabled: config.enabled,
    model: config.model || null,
  };
}

async function generateWithOpenAI(question: string, options: PlanningOptions = {}, endpoint = "planner"): Promise<AIPlanFields & { usedModel: string }> {
  assertPlanningActive(options.signal);
  if (!getAIConfig().enabled) throw new AIConfigurationError("AI 当前已停用，请使用常用分析问题，或联系管理员开启 AI。");
  const config = getRuntimeAIConfig();
  if (!config.enabled) throw new AIConfigurationError("AI 当前已停用，请使用常用分析问题，或联系管理员开启 AI。");
  if (!config.apiKey || !config.model) throw new AIConfigurationError();
  const client = new OpenAI({
    apiKey: config.apiKey,
    ...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
    maxRetries: 0,
    timeout: 20_000,
  });
  const instructions = [
      "你是高校教学数据分析规划器。只为允许的指标和维度生成计划，不计算数字，不生成 SQL。",
      `允许指标：score（${METRICS.score.description}）、activity（${METRICS.activity.description}）、completion_rate（${METRICS.completion_rate.description}）。`,
      "允许维度：course（课程）、term（学期）。趋势或按学期的问题优先使用折线图，课程比较优先使用柱状图；用户明确要求表格时使用 table。",
      "只有问题能由允许的指标和维度准确回答时，canAnalyze 才为 true，clarificationQuestion 为 null。",
      "口径含糊或超出能力时，canAnalyze 必须为 false，并在 clarificationQuestion 中提出一个简短、可回答的澄清问题；不要强行选择近似指标。",
      "需要澄清时 metric、dimension、chartType 可为 null。请求具体学生名单或个体排名时，说明当前仅支持课程、学期分组统计，并询问是否改为相应的群体统计；不要暗示补充课程或分数阈值就能查询个体。",
    ].join("\n");
  const payload = {
    model: config.model,
    instructions,
    input: question,
    max_output_tokens: 500,
    text: {
      format: zodTextFormat(aiPlanResponseSchema, "analysis_plan", {
        description: "受限的学生学习数据分析计划",
      }),
    },
  };
  const chatPayload = {
    model: config.model,
    messages: [
      { role: "system" as const, content: `${instructions}\n只输出一个 JSON 对象，包含 canAnalyze(boolean)、metric(score|activity|completion_rate|null)、dimension(course|term|null)、chartType(line|bar|table|null)、rationale(string)、clarificationQuestion(string|null)。不要使用 Markdown。` },
      { role: "user" as const, content: question },
    ],
    max_tokens: 500,
    // Provider extensions are top-level fields in the JavaScript SDK request.
    ...(isBailianQwenFlash(config) ? {
      enable_thinking: false,
      response_format: { type: "json_object" as const },
    } : {}),
    ...(isZhipuGLMFlash(config) ? {
      thinking: { type: "disabled" as const },
      response_format: { type: "json_object" as const },
    } : {}),
  };
  // A UTF-8 byte bound covers input, instructions and the structured output schema.
  // Pending calls reserve this amount atomically before any provider request.
  const requestPayload = config.apiFormat === "chat_completions" ? chatPayload : payload;
  const upperInputTokens = Buffer.byteLength(JSON.stringify(requestPayload), "utf8") + 512;
  const estimatedUsage: TokenUsage = { promptTokens: upperInputTokens, completionTokens: 500, totalTokens: upperInputTokens + 500 };
  const estimatedCost = calculateCost(config.model, estimatedUsage, config.pricing).totalCost;
  const reservation = reserveBudget(estimatedCost, config.budgets);
  let usage = estimatedUsage;
  let usageEstimated = true;
  try {
    let fields: unknown;
    if (config.apiFormat === "chat_completions") {
      const response = await client.chat.completions.create(chatPayload, { signal: options.signal });
      if (response.usage) {
        usage = { promptTokens: response.usage.prompt_tokens, completionTokens: response.usage.completion_tokens, totalTokens: response.usage.total_tokens };
        usageEstimated = false;
      }
      if (response.choices[0]?.finish_reason === "length") {
        throw new Error("模型输出已达到长度上限，未返回完整分析计划。");
      }
      const content = response.choices[0]?.message.content;
      if (!content) throw new Error("模型没有返回可验证的分析计划，请换一种问法。");
      fields = JSON.parse(content);
    } else {
      const response = await client.responses.parse(payload, { signal: options.signal });
      if (response.usage) {
        usage = { promptTokens: response.usage.input_tokens, completionTokens: response.usage.output_tokens, totalTokens: response.usage.total_tokens };
        usageEstimated = false;
      }
      fields = response.output_parsed;
    }
    if (!fields) throw new Error("模型没有返回可验证的分析计划，请换一种问法。");
    if (typeof fields === "object" && "canAnalyze" in fields && fields.canAnalyze === false) {
      const clarification = aiClarificationSchema.parse(fields);
      throw new AIClarificationError(
        clarification.clarificationQuestion ?? "这个问题的指标或分组口径不够明确，请补充说明。",
      );
    }
    return { ...aiPlanFieldsSchema.parse(fields), usedModel: config.model };
  } catch (error) {
    if (options.signal?.aborted || error instanceof APIUserAbortError) {
      throw new QueryExecutionError("CANCELLED", "分析请求已取消。");
    }
    if (error instanceof APIConnectionTimeoutError) {
      throw new QueryExecutionError("TIMEOUT", "AI 响应超时，请稍后重试或使用推荐问题。");
    }
    const providerError = classifyAIProviderError(error);
    if (providerError) throw providerError;
    throw error;
  } finally {
    // Network failures may still have been billed: retain a conservative estimate.
    settleBudget(reservation, config.model, usage, endpoint, config.pricing, usageEstimated);
  }
}

export async function testAIConnection(): Promise<{ model: string }> {
  const fields = await generateWithOpenAI("比较各课程的平均成绩，用柱状图展示。", {}, "admin-test");
  if (!fields.canAnalyze) throw new Error("AI 已返回内容，但未通过分析计划验证，请检查模型能否按当前协议返回有效计划。");
  return { model: fields.usedModel };
}

export async function planQuestion(
  input: z.infer<typeof planQuestionInputSchema>,
  generator: StructuredPlanGenerator = generateWithOpenAI,
  options: PlanningOptions = {},
): Promise<PlannedQuestion> {
  assertPlanningActive(options.signal);
  const parsed = planQuestionInputSchema.parse(input);
  const goldenCase = findGoldenCase(parsed.question);
  if (goldenCase) {
    return {
      plan: planForDataset(goldenCase, parsed.datasetId),
      source: "golden_case",
      rationale: "命中已验证的 MVP 固定问题，使用对应的金标准分析计划。",
      matchedCaseId: goldenCase.id,
      model: null,
    };
  }

  const fields = await generator(parsed.question, options);
  assertPlanningActive(options.signal);
  if (!fields.canAnalyze) {
    throw new AIClarificationError(
      fields.clarificationQuestion ?? "这个问题的指标或分组口径不够明确，请补充说明。",
    );
  }
  return {
    plan: createPlan({
      datasetId: parsed.datasetId,
      metric: fields.metric,
      dimension: fields.dimension,
      chartType: fields.chartType,
    }),
    source: getAIConfig().baseUrl ? "external" : "openai",
    rationale: fields.rationale,
    matchedCaseId: null,
    model: fields.usedModel ?? getAIStatus().model,
  };
}
