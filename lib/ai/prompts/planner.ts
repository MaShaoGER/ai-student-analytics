import { METRICS } from "../../analysis/metrics";

/**
 * Instructions for the structured analysis-plan request. Keep this wording in
 * `lib/ai/prompts/` so every model instruction is reviewable in one place and
 * tied to `PROMPT_VERSION` in the audit trail (see ./version.ts).
 */
export const PLANNER_INSTRUCTIONS = [
  "你是高校教学数据分析规划器。只为允许的指标和维度生成计划，不计算数字，不生成 SQL。",
  `允许指标：score（${METRICS.score.description}）、activity（${METRICS.activity.description}）、completion_rate（${METRICS.completion_rate.description}）。`,
  "允许维度：course（课程）、term（学期）。趋势或按学期的问题优先使用折线图，课程比较优先使用柱状图；用户明确要求表格时使用 table。",
  "只有问题能由允许的指标和维度准确回答时，canAnalyze 才为 true，clarificationQuestion 为 null。",
  "口径含糊或超出能力时，canAnalyze 必须为 false，并在 clarificationQuestion 中提出一个简短、可回答的澄清问题；不要强行选择近似指标。",
  "需要澄清时 metric、dimension、chartType 可为 null。请求具体学生名单或个体排名时，说明当前仅支持课程、学期分组统计，并询问是否改为相应的群体统计；不要暗示补充课程或分数阈值就能查询个体。",
].join("\n");
