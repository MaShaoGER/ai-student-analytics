import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { findGoldenCase, planForDataset } from "../analysis/golden-cases";
import { METRICS } from "../analysis/metrics";
import { createPlan } from "../analysis/plan";
import { dataSourceSchema, type AnalysisPlan } from "../analysis/types";

const aiPlanFieldsSchema = z.object({
  canAnalyze: z.boolean(),
  metric: z.enum(["score", "activity", "completion_rate"]),
  dimension: z.enum(["course", "term"]),
  chartType: z.enum(["line", "bar", "table"]),
  rationale: z.string().min(1).max(200),
  clarificationQuestion: z.string().min(1).max(200).nullable(),
});

export const planQuestionInputSchema = z.object({
  question: z.string().trim().min(2).max(500),
  datasetId: dataSourceSchema,
});

type AIPlanFields = z.infer<typeof aiPlanFieldsSchema>;
type StructuredPlanGenerator = (question: string) => Promise<AIPlanFields>;

export class AIConfigurationError extends Error {
  constructor() {
    super("AI 尚未配置。请设置 OPENAI_API_KEY 和 OPENAI_MODEL，或选择一个固定问题。");
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
  source: "golden_case" | "openai";
  rationale: string;
  matchedCaseId: string | null;
  model: string | null;
};

export function getAIStatus() {
  const model = process.env.OPENAI_MODEL?.trim() || null;
  return {
    configured: Boolean(process.env.OPENAI_API_KEY?.trim() && model),
    model,
  };
}

async function generateWithOpenAI(question: string): Promise<AIPlanFields> {
  const { configured, model } = getAIStatus();
  if (!configured || !model) throw new AIConfigurationError();

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    maxRetries: 1,
    timeout: 20_000,
  });
  const response = await client.responses.parse({
    model,
    instructions: [
      "你是高校教学数据分析规划器。只为允许的指标和维度生成计划，不计算数字，不生成 SQL。",
      `允许指标：score（${METRICS.score.description}）、activity（${METRICS.activity.description}）、completion_rate（${METRICS.completion_rate.description}）。`,
      "允许维度：course（课程）、term（学期）。趋势或按学期的问题优先使用折线图，课程比较优先使用柱状图；用户明确要求表格时使用 table。",
      "只有问题能由允许的指标和维度准确回答时，canAnalyze 才为 true，clarificationQuestion 为 null。",
      "口径含糊或超出能力时，canAnalyze 必须为 false，并在 clarificationQuestion 中提出一个简短、可回答的澄清问题；不要强行选择近似指标。",
    ].join("\n"),
    input: question,
    max_output_tokens: 500,
    text: {
      format: zodTextFormat(aiPlanFieldsSchema, "analysis_plan", {
        description: "受限的学生学习数据分析计划",
      }),
    },
  });

  if (!response.output_parsed) {
    throw new Error("模型没有返回可验证的分析计划，请换一种问法。");
  }
  return aiPlanFieldsSchema.parse(response.output_parsed);
}

export async function planQuestion(
  input: z.infer<typeof planQuestionInputSchema>,
  generator: StructuredPlanGenerator = generateWithOpenAI,
): Promise<PlannedQuestion> {
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

  const fields = await generator(parsed.question);
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
    source: "openai",
    rationale: fields.rationale,
    matchedCaseId: null,
    model: getAIStatus().model,
  };
}
