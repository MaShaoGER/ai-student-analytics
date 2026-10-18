import { z } from "zod";
import { toolSchema } from "./chart-capabilities";
import { chatViewSchema, type ChatIntent } from "./chat-types";
import { inferGoal, wantsTable, type AnalysisGoal } from "./response-presentation";

/**
 * Single place where a model decision becomes an executable plan.
 *
 * Contract (from output/ai-review P0-1): the model owns meaning, code only
 * fills blanks and repairs contradictions. The previous implementation let
 * Chinese keyword regexes overwrite `goal`, `action`, `dimension` and `view`,
 * which turned correct model decisions into wrong behaviour (e.g. a lookup
 * question containing "是什么" was forced into a reply with no query at all).
 *
 * Rule priority, top to bottom:
 * 1. `goal` is the model value when present; the regex classifier is only a
 *    fallback for a missing/null/auto goal.
 * 2. Contradictions between the model's own fields may be repaired (a
 *    distribution goal with action=analysis, a relationship metric without the
 *    density tool).
 * 3. Everything else uses `??=` to fill blanks and never rewrites a model
 *    value, with one documented exception: when `goal` itself came from the
 *    keyword fallback (the model left it null/auto), a trend goal restores the
 *    coherent single-series shape (term dimension + time sort), because under a
 *    trend goal the time dimension is not optional. An action is never rewritten
 *    based on question text.
 */

// Flat, required nullable fields work with both Responses and JSON-only providers.
export const conversationDecisionSchema = z.object({
  action: z.enum(["analysis", "distribution", "tool", "reply", "clarify"]),
  tool: toolSchema.nullable(),
  goal: z
    .enum(["explain", "lookup", "compare", "trend", "distribution", "relationship", "auto"])
    .nullable(),
  relationMetric: z.enum(["activity", "attendance", "absence", "unexcused"]).nullable(),
  courses: z.array(z.string().max(100)).max(100).nullable(),
  terms: z.array(z.string().max(100)).max(100).nullable(),
  dimensions: z
    .array(z.enum(["course", "term"]))
    .min(1)
    .max(2)
    .nullable(),
  threshold: z.number().int().min(1).max(100).nullable(),
  // Aligned with the planning token budget: a 1500-char message could only be
  // produced by truncating the JSON, which made a legal decision fail Zod.
  message: z.string().max(300),
  metric: z.enum(["score", "activity", "completion_rate"]).nullable(),
  dimension: z.enum(["course", "term"]).nullable(),
  course: z.string().max(100).nullable(),
  term: z.string().max(100).nullable(),
  binWidth: z.union([z.literal(2), z.literal(5), z.literal(10)]).nullable(),
  view: chatViewSchema.nullable(),
  sortBy: z.enum(["value", "dimension"]).nullable(),
  sortDirection: z.enum(["asc", "desc"]).nullable(),
  limit: z.number().int().min(1).max(100).nullable(),
});
export type ConversationDecision = z.infer<typeof conversationDecisionSchema>;

export function parseConversationDecision(value: unknown): ConversationDecision {
  if (value && typeof value === "object" && "action" in value) {
    const normalized: Record<string, unknown> = { goal: null, relationMetric: null, ...value };
    // Some JSON-only providers put a goal name in action. Map only known goals;
    // the same metric, scope and tool schemas still validate before execution.
    const goalActions: Record<string, string> = {
      lookup: "analysis",
      compare: "analysis",
      trend: "analysis",
      explain: "reply",
      relationship: "tool",
    };
    if (typeof normalized.action === "string" && Object.hasOwn(goalActions, normalized.action)) {
      normalized.goal ??= normalized.action;
      normalized.action = goalActions[normalized.action];
    }
    const goal = conversationDecisionSchema.shape.goal.safeParse(normalized.goal);
    normalized.goal = goal.success ? goal.data : null;
    if (!(normalized.action === "tool" && normalized.tool === "density")) {
      const metric = conversationDecisionSchema.shape.relationMetric.safeParse(
        normalized.relationMetric,
      );
      normalized.relationMetric = metric.success ? metric.data : null;
    }
    if (normalized.action !== "tool")
      return conversationDecisionSchema.parse({ ...normalized, tool: null, threshold: null });
    return conversationDecisionSchema.parse(normalized);
  }
  return conversationDecisionSchema.parse(value);
}

export type ResolvedPlan = {
  goal: AnalysisGoal;
  decision: ConversationDecision;
};

function resolveGoal(
  proposed: AnalysisGoal | null,
  question: string,
): { goal: AnalysisGoal; fromModel: boolean } {
  // The model's semantic judgement always wins; the regex is a fallback only.
  if (proposed && proposed !== "auto") return { goal: proposed, fromModel: true };
  return { goal: inferGoal(question), fromModel: false };
}

function requestedChartView(question: string): "bar" | "line" | "pie" | null {
  if (/柱状图|条形图/.test(question)) return "bar";
  if (/折线图/.test(question)) return "line";
  if (/饼图|环形图/.test(question)) return "pie";
  return null;
}

/**
 * Pure decision resolver: `resolvePlan(decision, question, context)`.
 *
 * Returns a new decision object; the input is never mutated.
 */
export function resolvePlan(
  decision: ConversationDecision,
  question: string,
  context: ChatIntent | null,
): ResolvedPlan {
  const { goal, fromModel } = resolveGoal(decision.goal, question);
  const resolved: ConversationDecision = { ...decision };

  // 1. Repair a model contradiction: it identified a relationship metric but
  //    did not select the density tool. Only the tool is filled; a tool the
  //    model already chose is kept.
  if (
    goal === "relationship" &&
    resolved.relationMetric !== null &&
    resolved.metric === "score" &&
    resolved.action !== "tool"
  ) {
    resolved.action = "tool";
    resolved.tool ??= "density";
  }

  // 2. Compare goals: fill the default grouping only where the model left it
  //    empty. A model-provided dimension/dimensions pair is never overwritten,
  //    and the filled pair must stay mutually consistent because downstream
  //    plan building prefers `dimensions[0]`.
  if (goal === "compare" && resolved.action === "analysis" && /各门课|各科|每门课/.test(question)) {
    resolved.dimension ??= resolved.dimensions?.[0] ?? "course";
    if (resolved.dimensions === null && resolved.dimension === "course")
      resolved.dimensions = ["course"];
  }

  // 3. Trend goals: fill-only when the model named the goal itself. When the
  //    goal only came from the keyword fallback (the model left it undecided),
  //    restore the single coherent trend shape instead of producing a course
  //    comparison: under a trend goal the time dimension is not optional.
  if (goal === "trend" && resolved.action === "analysis") {
    if (!fromModel) {
      resolved.dimension = "term";
      resolved.dimensions = ["term"];
      resolved.sortBy = "dimension";
      resolved.sortDirection = /倒序|从新到旧/.test(question) ? "desc" : "asc";
    } else {
      resolved.dimension ??= resolved.dimensions?.[0] ?? "term";
      if (resolved.dimensions === null && resolved.dimension === "term")
        resolved.dimensions = ["term"];
      resolved.sortBy ??= "dimension";
      resolved.sortDirection ??= /倒序|从新到旧/.test(question) ? "desc" : "asc";
    }
  }

  // 4. Explicit chart wording fills a missing view for data actions only; it
  //    must never change the action the model chose (e.g. distribution).
  const requestedView = requestedChartView(question);
  if (
    requestedView &&
    resolved.view === null &&
    (resolved.action === "analysis" || resolved.action === "distribution") &&
    (resolved.metric !== null || context?.kind === "analysis")
  ) {
    resolved.view = requestedView;
  }

  // 5. Repair the other contradiction: a distribution goal with a score metric
  //    but action=analysis. The default view is filled only when missing; a
  //    chart view that distribution cannot render is replaced by a valid one.
  if (goal === "distribution" && resolved.metric === "score" && resolved.action === "analysis") {
    resolved.action = "distribution";
    resolved.view ??= wantsTable(question) ? "table" : "heatmap";
  }
  if (
    resolved.action === "distribution" &&
    resolved.view !== null &&
    resolved.view !== "table" &&
    resolved.view !== "heatmap"
  ) {
    resolved.view = wantsTable(question) ? "table" : "heatmap";
  }

  return { goal, decision: resolved };
}
