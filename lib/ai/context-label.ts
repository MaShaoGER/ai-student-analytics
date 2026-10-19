import { toolLabel } from "./chart-capabilities";
import type { ChatIntent } from "./chat-types";

/**
 * Display-only mapping for the chat contract. Two readers share it:
 * - `describeChatContext` turns the follow-up `ChatIntent` into the one-line
 *   scope chip above the composer, so the current filters are never invisible.
 * - `planningMethodLabel` maps `ChatResponse.planning` to the sentence shown
 *   under each answer ("已验证的常用问题 / 本地规则 / AI 对话分析").
 */

const METRIC_SCOPE_LABELS: Record<"score" | "activity" | "completion_rate", string> = {
  score: "平均成绩",
  activity: "活跃次数",
  completion_rate: "完成率",
};

const ALL_TERMS = "全部学期";
const ALL_COURSES = "全部课程";

function joinScope(values: string[], noun: "门课程" | "个学期"): string {
  // A long list is a data scope, not something the user filtered by hand:
  // phrase it as a count so the chip is not read as a user condition.
  if (values.length > 6) return `共 ${values.length} ${noun}（含 ${values[0]}）`;
  if (values.length > 2) return `${values[0]} 等 ${values.length} ${noun}`;
  return values.join("、");
}

function filterValues(
  filters: Array<{ field: "course" | "term"; op: "eq" | "in"; value: string | string[] }>,
  field: "course" | "term",
): string | null {
  const filter = filters.find((item) => item.field === field);
  if (!filter) return null;
  const values = filter.op === "eq" ? [filter.value as string] : (filter.value as string[]);
  const joined = joinScope(values, field === "course" ? "门课程" : "个学期");
  return joined || null;
}

/**
 * A compact scope line such as `限定：2024J · 全部课程 · 平均成绩`.
 * Returns null when there is no follow-up context to show.
 */
export function describeChatContext(intent: ChatIntent | null | undefined): string | null {
  if (!intent) return null;
  if (intent.kind === "analysis") {
    const term = filterValues(intent.filters, "term") ?? ALL_TERMS;
    const course = filterValues(intent.filters, "course") ?? ALL_COURSES;
    const metric = METRIC_SCOPE_LABELS[intent.metric];
    return `限定：${term} · ${course}${metric ? ` · ${metric}` : ""}`;
  }
  if (intent.kind === "distribution") {
    return `限定：${intent.term || ALL_TERMS} · ${intent.course || ALL_COURSES} · 成绩分布`;
  }
  const term = intent.term || ALL_TERMS;
  const course = intent.courses.length ? joinScope(intent.courses, "门课程") : ALL_COURSES;
  return `限定：${term} · ${course} · ${toolLabel(intent.tool)}`;
}

export type PlanningSource = "golden_case" | "local" | "openai" | "external";
export type PlanningInfo = {
  source: PlanningSource;
  rationale: string;
  model?: string | null;
};

const PLANNING_SOURCE_LABELS: Record<PlanningSource, string> = {
  golden_case: "已验证的常用问题",
  local: "本地规则",
  openai: "AI 对话分析",
  external: "AI 对话分析",
};

/** `已验证的常用问题` / `AI 对话分析（qwen3.7-flash）` — no model, no suffix. */
export function planningMethodLabel(planning: PlanningInfo): string {
  const label = PLANNING_SOURCE_LABELS[planning.source] ?? "本地规则";
  return planning.model ? `${label}（${planning.model}）` : label;
}
