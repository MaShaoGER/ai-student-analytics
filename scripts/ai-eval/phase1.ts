import { z } from "zod";
import { chatIntentSchema, type ChatResponse } from "../../lib/ai/chat-types";
import { filterSchema } from "../../lib/analysis/types";
import { conversationDecisionSchema } from "../../lib/ai/resolve-plan";

const expectedSchema = z
  .object({
    kind: z.enum(["result", "answer", "clarification"]),
    context: chatIntentSchema.nullable(),
    presentation: z.enum(["text", "chart", "table"]),
    rows: z
      .array(
        z.object({ dimension: z.string(), value: z.number(), sampleSize: z.number() }).strict(),
      )
      .optional(),
    warning: z.string().optional(),
  })
  .strict();
const turnSchema = z
  .object({
    question: z.string().min(2).max(500),
    // Simulated planner output only. Never sent to a live model.
    decision: conversationDecisionSchema.partial().optional(),
    expect: expectedSchema,
  })
  .strict();
export const phase1CaseSchema = z
  .object({
    id: z.string().min(1),
    category: z.enum(["followup", "conflict", "chart", "numeric"]),
    turns: z.array(turnSchema).min(1).max(4),
  })
  .strict();
export type Phase1Case = z.infer<typeof phase1CaseSchema>;
export type Checks = { planning: string[]; query: string[]; presentation: string[] };

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}

/** A failed plan never counts as a successful query/display check. */
export function assessResponse(
  response: ChatResponse,
  expected: z.infer<typeof expectedSchema>,
): Checks {
  const checks: Checks = { planning: [], query: [], presentation: [] };
  if (response.kind !== expected.kind)
    checks.planning.push(`kind: ${response.kind} != ${expected.kind}`);
  const actual = response.context;
  const target = expected.context;
  const withoutView = (context: typeof actual) => {
    if (!context) return null;
    const { view: _view, ...scope } = context;
    if (scope.kind === "analysis") scope.dimensions ??= [scope.dimension];
    if ("filters" in scope) {
      // Filter order is not semantic; contents, operators and values are.
      scope.filters = scope.filters
        .map((f) => {
          const parsed = filterSchema.parse(f);
          return parsed.op === "in" ? { ...parsed, value: [...parsed.value].sort() } : parsed;
        })
        .sort((a, b) => a.field.localeCompare(b.field));
    }
    return scope;
  };
  if (canonical(withoutView(actual)) !== canonical(withoutView(target)))
    checks.planning.push("解析后的指标、筛选、排序或限制与预期不符");
  if (expected.rows) {
    if (response.artifact?.kind !== "analysis") checks.query.push("缺少普通分析结果");
    else if (canonical(response.artifact.result.rows) !== canonical(expected.rows))
      checks.query.push("查询行、数值或去重人数与独立基准不符");
  }
  if (target?.kind === "analysis" && response.artifact?.kind === "analysis") {
    const plan = response.artifact.plan;
    if (
      canonical(
        withoutView({
          ...target,
          metric: plan.metric,
          dimensions: plan.dimensions,
          dimension: plan.dimensions[0],
          filters: plan.filters,
          sort: plan.sort,
          limit: plan.limit,
        }),
      ) !== canonical(withoutView(target))
    )
      checks.query.push("执行计划与解析后的统计范围不一致");
  }
  if (expected.kind !== "result" && response.artifact)
    checks.query.push("文字或澄清响应不应附带查询结果");
  if (response.presentation !== expected.presentation)
    checks.presentation.push(`展示形式: ${response.presentation} != ${expected.presentation}`);
  if (actual?.view !== target?.view)
    checks.presentation.push(`视图: ${actual?.view} != ${target?.view}`);
  if (response.artifact && target && response.artifact.view !== target.view)
    checks.presentation.push("附件视图与上下文视图不一致");
  if (expected.warning && !response.warning?.includes(expected.warning))
    checks.presentation.push("缺少图表降级说明");
  return checks;
}

export function stageResults(checks: Checks) {
  const planning = checks.planning.length ? "fail" : "pass";
  const query = planning === "fail" ? "blocked" : checks.query.length ? "fail" : "pass";
  return {
    planning,
    query,
    presentation: query !== "pass" ? "blocked" : checks.presentation.length ? "fail" : "pass",
  };
}

export const simulatedDecision = {
  action: "analysis",
  tool: null,
  goal: "compare",
  relationMetric: null,
  courses: null,
  terms: null,
  dimensions: null,
  threshold: null,
  message: "按所选范围统计。",
  metric: "score",
  dimension: "course",
  course: null,
  term: null,
  binWidth: null,
  view: "bar",
  sortBy: "value",
  sortDirection: "desc",
  limit: 100,
} satisfies z.infer<typeof conversationDecisionSchema>;
