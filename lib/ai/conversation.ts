import { assertCurrentAccess } from "../auth/access";
import { runAnalysis, scoreDistribution } from "../analysis/duckdb";
import { findGoldenCase, planForDataset } from "../analysis/golden-cases";
import { analysisPlanSchema } from "../analysis/types";
import { metricAggregation } from "../analysis/metrics";
import { chartUnavailableReason } from "../analysis/visualization";
import { QueryExecutionError } from "../security/query-execution";
import { makeToolIntent, executeChartTool, ChartClarification, toolQueries } from "./chart-tools";
import {
  inferChartTool,
  inferGoal,
  responsePresentation,
  resultNarrative,
} from "./response-presentation";
import { AIConfigurationError } from "./planner";
import {
  chatInputSchema,
  type ChatArtifact,
  type ChatInput,
  type ChatIntent,
  type ChatResponse,
} from "./chat-types";
import { describeResponseArtifacts } from "./artifact-results";
import { resultFacts } from "./result-facts";
import {
  converseUnified,
  unifiedDefaults,
  type UnifiedDependencies,
  type UnifiedOptions,
} from "./unified";

// The single conversation entry. `resultFacts` is re-exported for modules that
// previously imported it from here.
export { resultFacts } from "./result-facts";

export type ConversationDependencies = Partial<typeof toolQueries> & {
  analyze?: typeof runAnalysis;
  distribution?: typeof scoreDistribution;
  /** Overrides for the unified tool loop (used by tests and the real eval). */
  unified?: Partial<UnifiedDependencies>;
};

function assertActive(options: UnifiedOptions) {
  if (options.signal?.aborted) throw new QueryExecutionError("CANCELLED", "分析请求已取消。");
}

/**
 * Presentation-only follow-ups ("改成表格", "按10分一档"). These are handled
 * locally without a model because they reuse the already confirmed scope: they
 * are not a second analysis mode and they never invent a new query decision.
 */
function presentationFollowup(input: ChatInput): ChatIntent | null {
  if (!input.context) return null;
  const question = input.question.replace(/[。！？?\s]/g, "");
  if (/^(改成|换成|用|切换到?)表格(展示|显示)?$/.test(question))
    return { ...input.context, view: "table" };
  if (
    input.context.kind === "tool" &&
    /^(?:改成|换成|用|切换到?)(?:图表|图形|原图)(?:展示|显示)?$/.test(question)
  )
    return { ...input.context, view: "chart" };
  if (input.context.kind === "analysis") {
    if (/^(?:改成|换成|用)(?:图表|图形)(?:展示|显示)?$/.test(question))
      return { ...input.context, view: input.context.dimension === "term" ? "line" : "bar" };
    const view = /^(?:改成|换成|用)?(?:柱状图|条形图)$/.test(question)
      ? "bar"
      : /^(?:改成|换成|用)?折线图$/.test(question)
        ? "line"
        : /^(?:改成|换成|用)?(?:饼图|环形图)$/.test(question)
          ? "pie"
          : null;
    if (view) return { ...input.context, view };
  }
  if (input.context.kind === "distribution") {
    const match = question.match(/^(?:改成|改为|按)?(2|5|10)分一档$/);
    if (match) return { ...input.context, binWidth: Number(match[1]) as 2 | 5 | 10 };
    if (/^(改成|换成|用)热力图(展示|显示)?$/.test(question))
      return { ...input.context, view: "heatmap" };
  }
  return null;
}

/** Exact verified preset questions; only used when no model can run. */
function intentForGolden(input: ChatInput): Extract<ChatIntent, { kind: "analysis" }> | null {
  // An ongoing conversation must keep its scope, so presets only apply to a
  // fresh turn; otherwise the verified plan would silently drop the context.
  if (input.history.length || input.context) return null;
  const golden = findGoldenCase(input.question);
  if (!golden) return null;
  const plan = planForDataset(golden, input.datasetId);
  return {
    kind: "analysis",
    metric: plan.metric,
    dimension: plan.dimensions[0],
    filters: plan.filters,
    sort: plan.sort,
    limit: plan.limit,
    view: plan.chartType,
  };
}

/**
 * Deterministic fallback for an explicitly requested chart when the unified AI
 * path cannot run. This preserves the documented "recommended questions work
 * without an AI connection" behavior; it is never used while a model is
 * available, so the model still decides tool use in normal operation.
 */
async function localChartIntent(
  input: ChatInput,
  options: UnifiedOptions,
  dependencies: ConversationDependencies,
): Promise<Extract<ChatIntent, { kind: "tool" }> | null> {
  const distribution = dependencies.distribution ?? scoreDistribution;
  let distributionData: Awaited<ReturnType<typeof scoreDistribution>>;
  try {
    distributionData = await distribution(input.datasetId, options);
  } catch (error) {
    // Cancellation and timeouts must keep their own classification; only a
    // missing catalog can be treated as "no local chart available".
    assertActive(options);
    // Any real query failure (cancelled, timeout, unreadable data source) keeps
    // its own classification; only a genuinely unavailable catalog means "no
    // local chart can be resolved here".
    if (error instanceof QueryExecutionError) throw error;
    return null;
  }
  assertActive(options);
  const catalog = {
    courses: [...new Set(distributionData.groups.map((group) => group.course))].sort(),
    terms: [...new Set(distributionData.groups.map((group) => group.term))].sort(),
  };
  const comparison =
    /提升|提高.*多少|变化幅度|差值|下降.*多少|增幅/.test(input.question) &&
    (/成绩|均分|平均分/.test(input.question) ||
      (input.context?.kind === "analysis" && input.context.metric === "score"));
  const directTool = inferChartTool(input) ?? (comparison ? "dumbbell" : undefined);
  return directTool ? makeToolIntent(input, catalog, directTool) : null;
}

/** Execute one already resolved intent locally (presets and view follow-ups). */
async function runLocalIntent(
  intent: ChatIntent,
  input: ChatInput,
  options: UnifiedOptions,
  dependencies: ConversationDependencies,
  planning: ChatResponse["planning"],
): Promise<ChatResponse> {
  const analyze = dependencies.analyze ?? runAnalysis;
  const distribution = dependencies.distribution ?? scoreDistribution;
  const goal = inferGoal(input.question);
  let artifact: ChatArtifact;
  let warning: string | undefined;
  let selected: ChatIntent = intent;
  if (intent.kind === "tool") {
    options.onExecution?.(null);
    artifact = await executeChartTool(intent, input, options, dependencies);
  } else if (intent.kind === "analysis") {
    const plan = analysisPlanSchema.parse({
      version: 1,
      datasetId: input.datasetId,
      metric: intent.metric,
      aggregation: metricAggregation(intent.metric),
      dimensions: intent.dimensions ?? [intent.dimension],
      filters: intent.filters,
      sort: intent.sort,
      limit: intent.limit,
      chartType: intent.view === "line" ? "line" : intent.view === "table" ? "table" : "bar",
    });
    options.onExecution?.(plan);
    const analysis = await analyze(plan, options);
    const reason = chartUnavailableReason(intent.view, analysis.result.unit, analysis.result.rows);
    let resolved = intent;
    if (reason) {
      warning = `${reason} 已改用柱状图，仍可查看数值表。`;
      resolved = { ...intent, view: "bar" };
    }
    artifact = { kind: "analysis", ...analysis, view: resolved.view };
    selected = resolved;
  } else {
    options.onExecution?.(null);
    const selection = intent;
    const distributionData =
      selection.course && selection.term
        ? await distribution(input.datasetId, options, {
            course: selection.course,
            term: selection.term,
          })
        : await distribution(input.datasetId, options);
    artifact = {
      ...selection,
      data: {
        ...distributionData,
        groups: distributionData.groups.filter(
          (group) =>
            (!selection.course || group.course === selection.course) &&
            (!selection.term || group.term === selection.term),
        ),
      },
    };
    selected = selection;
  }
  assertActive(options);
  const facts = resultFacts(artifact);
  const presentation = responsePresentation(input.question, artifact, goal);
  const answer = resultNarrative(artifact, goal, input.question);
  const suggestions =
    presentation === "text"
      ? ["改成图表", "改成表格"]
      : selected.kind === "tool"
        ? [selected.view === "table" ? "改成图表" : "改成表格"]
        : selected.kind === "distribution"
          ? ["改成表格", "按10分一档"]
          : ["改成表格", "按学期比较"];
  const described = describeResponseArtifacts([artifact], input.datasetId);
  if (described.warning) warning = [warning, described.warning].filter(Boolean).join(" ");
  return {
    kind: "result",
    presentation,
    answer,
    facts,
    suggestions,
    context: selected,
    artifact,
    // Both paths share the result contract, including dropping facts that cite
    // a result the response does not contain.
    resultRefs: described.resultRefs,
    factRefs: described.factRefs,
    planning,
    ...(warning ? { warning } : {}),
  };
}

/** A resolvable local intent is expected to ask for a narrower scope instead of failing. */
function clarificationResponse(message: string, input: ChatInput): ChatResponse {
  return {
    kind: "clarification",
    presentation: "text",
    answer: message,
    facts: [],
    suggestions: [],
    context: input.context,
    artifact: null,
    planning: { source: "local", rationale: "需要补充或调整查询范围。", model: null },
  };
}

async function runConversation(
  input: ChatInput,
  options: UnifiedOptions,
  dependencies: ConversationDependencies,
): Promise<ChatResponse> {
  const followup = presentationFollowup(input);
  if (followup)
    return runLocalIntent(followup, input, options, dependencies, {
      source: "local",
      rationale: "沿用上一轮筛选并调整展示。",
      model: null,
    });
  const unifiedDependencies: UnifiedDependencies = {
    ...unifiedDefaults,
    ...dependencies.unified,
    analyze: dependencies.analyze ?? dependencies.unified?.analyze ?? unifiedDefaults.analyze,
    distribution:
      dependencies.distribution ??
      dependencies.unified?.distribution ??
      unifiedDefaults.distribution,
  };
  try {
    return await converseUnified(input, options, unifiedDependencies);
  } catch (error) {
    assertActive(options);
    if (!(error instanceof AIConfigurationError)) throw error;
    const golden = intentForGolden(input);
    if (golden)
      return runLocalIntent(golden, input, options, dependencies, {
        source: "golden_case",
        rationale: "使用已验证的常用分析计划。",
        model: null,
      });
    const chart = await localChartIntent(input, options, dependencies);
    if (chart)
      return runLocalIntent(chart, input, options, dependencies, {
        source: "local",
        rationale: "使用已有统计工具直接生成所请求的图表。",
        model: null,
      });
    throw error;
  }
}

/**
 * The only `/api/chat` entry. One pipeline: reuse an already-confirmed scope for
 * presentation-only follow-ups, otherwise let the AI tool loop decide between a
 * direct answer, a statistical query, knowledge retrieval, or a chart. The
 * deterministic presets are a degraded fallback used only when the unified path
 * cannot run at all (no model / tool calling not verified / disabled).
 */
export async function converse(
  raw: unknown,
  options: UnifiedOptions = {},
  dependencies: ConversationDependencies = {},
): Promise<ChatResponse> {
  assertActive(options);
  const input = chatInputSchema.parse(raw);
  assertCurrentAccess(input.datasetId, "ai");
  try {
    return await runConversation(input, options, dependencies);
  } catch (error) {
    // A chart tool that cannot serve the requested scope explains why and asks
    // for a narrower range; that is a successful clarification turn, not a 502.
    assertActive(options);
    if (error instanceof ChartClarification) return clarificationResponse(error.message, input);
    throw error;
  }
}
