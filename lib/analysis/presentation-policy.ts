import type { ChatArtifact, ChatDisplayView, ChatResponse } from "../ai/chat-types";
import { wantsText } from "../ai/response-presentation";
import type { FactRef } from "../ai/result-contract";
import type { AnalysisRow } from "./types";

/**
 * Pure presentation policy for trusted, already-computed artifacts.
 *
 * This module does not query data, repair semantics, or create values. It only
 * describes which existing renderer/view combinations are supported by the
 * result structure. Unknown semantics are rejected rather than guessed.
 */

export type PresentationStructure =
  | "summary"
  | "category"
  | "ordered_time"
  | "comparison"
  | "distribution"
  | "joint_distribution"
  | "group_distribution"
  | "stage_flow"
  | "relation"
  | "panorama"
  | "table";

export type PresentationOrientation = "horizontal" | "vertical" | "not_applicable";

export type PresentationRejectionCode =
  | "unknown_structure"
  | "requires_ordered_time"
  | "requires_additive_parts"
  | "requires_explicit_total"
  | "requires_mutually_exclusive_parts"
  | "requires_nonnegative_values"
  | "requires_paired_observations"
  | "requires_grouped_observations"
  | "requires_real_scatter_points"
  | "requires_distribution"
  | "requires_join_distribution"
  | "requires_time_order"
  | "unsupported_artifact_view";

export type PresentationRejection = {
  view: ChatDisplayView;
  code: PresentationRejectionCode;
  reason: string;
};

export type StoredArtifactPresentationPolicy = {
  version: 1;
  /** Optional result identity supplied by the trusted response contract. */
  resultId: string | null;
  structure: PresentationStructure;
  requestedView: ChatDisplayView | null;
  defaultView: ChatDisplayView;
  effectiveView: ChatDisplayView;
  /** Category bars are horizontal by default; term lines run along the time axis. */
  orientation: PresentationOrientation;
  allowedViews: ChatDisplayView[];
  rejectedViews: PresentationRejection[];
  fallbackReason: string | null;
  /** Stable identities from the response contract, never model-written labels. */
  factIds: string[];
};

export type ArtifactPresentationPolicy = StoredArtifactPresentationPolicy & {
  /** Existing result rows in their semantic display order. Values are untouched. */
  rows: AnalysisRow[];
};

export type PresentationCapabilities = {
  /** Explicitly established by trusted result metadata, never inferred from a unit. */
  additiveParts?: boolean;
  explicitTotal?: number | null;
  mutuallyExclusiveParts?: boolean;
  /** Paired observations are required for a scatter plot of two metrics. */
  pairedObservations?: boolean;
  /** A real distribution structure such as bins, quantiles, or raw group values. */
  distribution?: boolean;
  /** Joint-count bins specifically; these only support a heatmap. */
  jointDistribution?: boolean;
  groupedObservations?: boolean;
  stageFlow?: boolean;
};

export type PolicyContext = {
  question?: string;
  /** Trusted intent supplied by planning; it takes precedence over text hints. */
  requestedView?: ChatDisplayView | null;
  capabilities?: PresentationCapabilities;
  facts?: readonly FactRef[];
  /** Filters facts to this result; presentation choice remains outside result identity. */
  resultId?: string | null;
};

const VIEW_LABEL: Record<ChatDisplayView, string> = {
  bar: "条形图",
  line: "折线图",
  pie: "环形组成图",
  treemap: "矩形组成图",
  radar: "雷达图",
  scatter: "散点图",
  heatmap: "热力图",
  table: "表格",
  chart: "原生图表",
};

const viewLabel = (view: ChatDisplayView) => VIEW_LABEL[view];

const rejection = (
  view: ChatDisplayView,
  code: PresentationRejectionCode,
  reason: string,
): PresentationRejection => ({ view, code, reason });

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

const isTermDimension = (dimension: string | undefined) => dimension === "term";

const termToken = /(?:^|\D)((?:19|20)\d{2})\s*([BJ])(?:$|\D)/u;

/**
 * OULAD presentation codes: B is the February start, J is the October start.
 * The demo uses the same B/J vocabulary. No other suffix is assigned an order.
 */
export function termSortKey(value: string): number | null {
  const match = termToken.exec(value);
  if (!match) return null;
  return Number(match[1]) * 2 + (match[2] === "B" ? 0 : 1);
}

/** Sort a copy only when every label has a trustworthy academic-term token. */
export function orderTimeRows(rows: readonly AnalysisRow[]): AnalysisRow[] | null {
  const keyed = rows.map((row) => ({ row, key: termSortKey(row.dimension) }));
  if (keyed.some((item) => item.key === null)) return null;
  return [...keyed]
    .sort((a, b) => a.key! - b.key! || a.row.dimension.localeCompare(b.row.dimension, "zh-CN"))
    .map((item) => item.row);
}

function hasExactSum(rows: readonly AnalysisRow[], total: number | null | undefined) {
  if (!finite(total) || total <= 0) return false;
  if (rows.some((row) => row.value < 0)) return false;
  const sum = rows.reduce((value, row) => value + row.value, 0);
  return Math.abs(sum - total) <= Math.max(1e-9, Math.abs(total) * 1e-9);
}

function numericFactIds(facts: readonly FactRef[], resultId?: string | null): string[] {
  return [
    ...new Set(
      facts
        .filter((fact) => fact.numeric && (!resultId || fact.resultId === resultId))
        .map((fact) => fact.factId),
    ),
  ].sort();
}

type BasePolicy = Pick<
  StoredArtifactPresentationPolicy,
  | "structure"
  | "requestedView"
  | "defaultView"
  | "effectiveView"
  | "orientation"
  | "allowedViews"
  | "rejectedViews"
  | "fallbackReason"
>;

function finishPolicy(
  base: BasePolicy,
  resultId: string | null | undefined,
  factIds: string[],
): StoredArtifactPresentationPolicy {
  return { version: 1, resultId: resultId ?? null, ...base, factIds };
}

function selectView(
  requested: ChatDisplayView | null,
  preferred: ChatDisplayView,
  allowed: ChatDisplayView[],
  rejections: PresentationRejection[],
): Pick<BasePolicy, "effectiveView" | "fallbackReason"> {
  if (requested && allowed.includes(requested))
    return { effectiveView: requested, fallbackReason: null };
  const knownRejection = requested ? rejections.find((item) => item.view === requested) : undefined;
  return {
    effectiveView: allowed.includes(preferred) ? preferred : "table",
    fallbackReason:
      knownRejection?.reason ??
      (requested
        ? `${viewLabel(requested)}不是当前结果可证实的展示形式；已回退到${viewLabel(
            allowed.includes(preferred) ? preferred : "table",
          )}。`
        : null),
  };
}

/**
 * Extract a user's explicit requested form. Only known visual words map to
 * renderer views; the result is later checked against the artifact structure.
 */
export function requestedPresentationView(question: string): ChatDisplayView | null {
  const patterns: Array<[ChatDisplayView, RegExp]> = [
    ["table", /(?:用|以|改为|换成|切换(?:为|到)?|显示为?|查看)?(?:表格|数值表|明细表|精确值)/u],
    ["line", /(?:用|以|改为|换成|切换(?:为|到)?|显示为?|画(?:成)?)?(?:折线图?|趋势图?)/u],
    [
      "bar",
      /(?:用|以|改为|换成|切换(?:为|到)?|显示为?|画(?:成)?)?(?:条形图?|柱状图?|横条图?|排行图?)/u,
    ],
    [
      "pie",
      /(?:用|以|改为|换成|切换(?:为|到)?|显示为?|画(?:成)?)?(?:饼图|环形图?|圆环图?|占比图?|组成图?)/u,
    ],
    ["treemap", /(?:用|以|改为|换成|切换(?:为|到)?|显示为?|画(?:成)?)?(?:矩形树图|树图|面积图?)/u],
    ["heatmap", /(?:用|以|改为|换成|切换(?:为|到)?|显示为?|画(?:成)?)?(?:热力图?|密度图?)/u],
    ["scatter", /(?:用|以|改为|换成|切换(?:为|到)?|显示为?|画(?:成)?)?(?:散点图?|气泡图?)/u],
    ["radar", /(?:用|以|改为|换成|切换(?:为|到)?|显示为?|画(?:成)?)?(?:雷达图?|蛛网图?)/u],
  ];
  // The longest/more specific tokens are intentionally checked first.
  return patterns.find(([, pattern]) => pattern.test(question))?.[0] ?? null;
}

function semanticRequestedView(
  artifact: ChatArtifact,
  context: PolicyContext,
): ChatDisplayView | null {
  return (
    context.requestedView ??
    requestedPresentationView(context.question ?? "") ??
    // Legacy artifact.view is a compatibility input only when the question did
    // not explicitly request a presentation and the caller gave no intent.
    null
  );
}

function analysisPolicy(
  artifact: Extract<ChatArtifact, { kind: "analysis" }>,
  context: PolicyContext,
): ArtifactPresentationPolicy {
  const { result, plan } = artifact;
  const rows = result.rows;
  const capabilities = context.capabilities ?? {};
  const requested = semanticRequestedView(artifact, context);
  const isTime =
    isTermDimension(result.dimension) && (result.dimensions ?? [result.dimension]).length === 1;
  const orderedRows = isTime ? orderTimeRows(rows) : null;
  const structure: PresentationStructure =
    rows.length === 1
      ? "summary"
      : isTime
        ? "ordered_time"
        : plan.dimensions.length > 1
          ? "table"
          : "category";
  const allowed: ChatDisplayView[] = [];
  const rejected: PresentationRejection[] = [];
  if (structure === "summary") {
    rejected.push(
      rejection("bar", "unknown_structure", "单个汇总值只有一项，条形图无法提供组间比较。"),
    );
    rejected.push(
      rejection("line", "requires_ordered_time", "折线图需要至少 3 个真实有序时间点。"),
    );
    rejected.push(
      rejection("scatter", "requires_paired_observations", "当前结果没有两个指标的成对观测。"),
    );
  } else if (structure === "category") {
    allowed.push("bar");
    rejected.push(
      rejection("line", "requires_ordered_time", "课程类别没有自然时间顺序，不能连接成趋势线。"),
    );
    rejected.push(
      rejection("pie", "requires_additive_parts", "课程分组人数可能重叠，未证明可加总为整体。"),
      rejection("treemap", "requires_additive_parts", "课程分组人数可能重叠，未证明可加总为整体。"),
      rejection("radar", "unknown_structure", "单指标课程比较缺少可比较、可归一化的多轴结构。"),
      rejection("scatter", "requires_paired_observations", "当前结果没有两个指标的成对观测。"),
    );
  } else if (structure === "ordered_time") {
    if (orderedRows && orderedRows.length >= 3) {
      allowed.push("line", "bar");
    } else {
      rejected.push(
        rejection("line", "requires_ordered_time", "折线图需要至少 3 个可解析、有序的学期观测点。"),
      );
      if (orderedRows) allowed.push("bar");
      else
        rejected.push(
          rejection("bar", "requires_time_order", "当前学期标签无法确定为真实先后顺序。"),
        );
    }
    rejected.push(
      rejection("pie", "requires_additive_parts", "时间观测之间的数值不能直接组成一个整体。"),
      rejection("treemap", "requires_additive_parts", "时间观测之间的数值不能直接组成一个整体。"),
      rejection("radar", "unknown_structure", "当前结果没有可比较的多轴结构。"),
      rejection("scatter", "requires_paired_observations", "当前结果没有两个指标的成对观测。"),
    );
  } else {
    // Multiple dimensions are a precise table by default. A chart requires a
    // separately established structure and is never guessed from row count.
    rejected.push(
      rejection("bar", "unknown_structure", "多字段结果不能压缩成单一类别轴。"),
      rejection("line", "requires_ordered_time", "多字段结果没有单一真实时间轴。"),
      rejection("pie", "requires_additive_parts", "多字段结果的组成关系尚未证实。"),
      rejection("treemap", "requires_additive_parts", "多字段结果的组成关系尚未证实。"),
      rejection("radar", "unknown_structure", "多字段结果的量纲和归一化依据尚未证实。"),
      rejection("scatter", "requires_paired_observations", "多字段结果没有证实真实成对观测。"),
    );
  }

  const explicitTotal = capabilities.explicitTotal;
  const additive =
    capabilities.additiveParts === true &&
    capabilities.mutuallyExclusiveParts === true &&
    hasExactSum(rows, explicitTotal);
  if (structure === "category" && additive && rows.length >= 2) {
    rejected.splice(
      0,
      rejected.length,
      ...rejected.filter((item) => item.view !== "pie" && item.view !== "treemap"),
    );
    allowed.push("pie", "treemap");
  } else if (
    capabilities.additiveParts === true ||
    capabilities.mutuallyExclusiveParts === true ||
    capabilities.explicitTotal !== undefined
  ) {
    const reason =
      capabilities.additiveParts !== true
        ? "未证明各分类可加总。"
        : capabilities.mutuallyExclusiveParts !== true
          ? "未证明各分类互斥。"
          : "各分类合计与可信总体不一致。";
    rejected.push(rejection("pie", "requires_additive_parts", reason));
    rejected.push(rejection("treemap", "requires_additive_parts", reason));
  }
  // The generic analysis renderer's "scatter" view is a sample-size bubble
  // chart, not paired observations. Never promote it from a capability flag;
  // true relationship points belong to the dedicated density/relationship tool.
  if (!rejected.some((item) => item.view === "scatter")) {
    rejected.push(
      rejection(
        "scatter",
        "requires_paired_observations",
        "通用分析没有两个指标的成对观测；样本量气泡图不等同于关系散点图。",
      ),
    );
  }

  const defaultView: ChatDisplayView =
    rows.length > 40
      ? "table"
      : structure === "summary"
        ? "table"
        : structure === "ordered_time" && orderedRows && orderedRows.length >= 3
          ? "line"
          : structure === "table"
            ? "table"
            : "bar";
  allowed.push("table");
  const uniqueAllowed = [...new Set(allowed)];
  const effective = selectView(requested, defaultView, uniqueAllowed, rejected);
  return {
    ...finishPolicy(
      {
        structure,
        requestedView: requested,
        defaultView,
        ...effective,
        orientation:
          defaultView === "bar"
            ? "horizontal"
            : defaultView === "line"
              ? "vertical"
              : "not_applicable",
        allowedViews: uniqueAllowed,
        rejectedViews: rejected,
      },
      context.resultId,
      numericFactIds(context.facts ?? [], context.resultId),
    ),
    rows: orderedRows ?? rows,
  };
}

/**
 * Derive only structural capabilities that the trusted table itself proves.
 * This avoids a second "chart mode" flag while never guessing a chart from a
 * tool name alone (fixtures and old snapshots can be partial).
 */
export function studioCapabilitiesFromTable(
  artifact: Extract<ChatArtifact, { kind: "studio" }>,
): PresentationCapabilities {
  const { table, tool } = artifact;
  const columns = new Set(table.columns);
  const rows = table.rows;
  const has = (...names: string[]) => names.every((name) => columns.has(name));
  if (!rows.length) return {};
  if (tool === "boxplot" && has("最小值", "下四分位数", "中位数", "上四分位数", "最大值", "样本数"))
    return { groupedObservations: true };
  if (tool === "rhythm" && has("周次", "课程", "人均访问次数", "当周有记录人数"))
    return { jointDistribution: true };
  if (tool === "sankey" && table.columns.length >= 3 && has("数量")) return { stageFlow: true };
  if (
    tool === "density" &&
    table.columns.length >= 3 &&
    Number.isFinite(Number(table.columns[1])) === false
  ) {
    const [x, y, weight] = table.columns;
    const valid = rows.some(
      (row) =>
        Number.isFinite(Number(row[x])) &&
        Number.isFinite(Number(row[y])) &&
        Number(row[weight]) > 0,
    );
    return valid ? { jointDistribution: true } : {};
  }
  return {};
}

function studioPolicy(
  artifact: Extract<ChatArtifact, { kind: "studio" }>,
  context: PolicyContext,
): ArtifactPresentationPolicy {
  const capabilities = {
    ...studioCapabilitiesFromTable(artifact),
    ...context.capabilities,
  };
  const requested = semanticRequestedView(artifact, context);
  const base = {
    requestedView: requested,
    allowedViews: ["chart", "table"] as ChatDisplayView[],
    rejectedViews: [] as PresentationRejection[],
    fallbackReason: null,
    orientation: "not_applicable" as const,
  };
  let structure: PresentationStructure;
  let defaultView: ChatDisplayView = "chart";
  switch (artifact.tool) {
    case "dumbbell":
      structure = "comparison";
      break;
    case "boxplot":
      if (!capabilities.groupedObservations) {
        return finishOnlyTable(
          artifact,
          base,
          "group_distribution",
          "箱线图需要真实分组分布结构。",
          context,
        );
      }
      structure = "group_distribution";
      break;
    case "rhythm":
      if (!capabilities.jointDistribution) {
        return finishOnlyTable(
          artifact,
          base,
          "joint_distribution",
          "热力图需要真实联合分箱结构。",
          context,
        );
      }
      structure = "joint_distribution";
      defaultView = "chart";
      break;
    case "density":
      if (
        !capabilities.distribution &&
        !capabilities.jointDistribution &&
        !capabilities.pairedObservations
      ) {
        return finishOnlyTable(
          artifact,
          base,
          "table",
          "散点或密度视图需要真实数值分布或成对观测。",
          context,
        );
      }
      structure = capabilities.jointDistribution ? "joint_distribution" : "table";
      if (capabilities.jointDistribution && !capabilities.pairedObservations)
        base.rejectedViews.push(
          rejection(
            "scatter",
            "requires_real_scatter_points",
            "当前只有联合分档频数，没有个体成对观测；已回退到联合分档密度图。",
          ),
        );
      defaultView = "chart";
      break;
    case "sankey":
      if (!capabilities.stageFlow) {
        return finishOnlyTable(
          artifact,
          base,
          "stage_flow",
          "桑基图需要有真实来源、去向和流量的阶段数据。",
          context,
        );
      }
      structure = "stage_flow";
      break;
    default:
      structure = "table";
      defaultView = "table";
  }
  const effective = selectView(requested, defaultView, ["chart", "table"], base.rejectedViews);
  return {
    ...finishPolicy(
      {
        ...base,
        structure,
        defaultView,
        ...effective,
      },
      context.resultId,
      numericFactIds(context.facts ?? [], context.resultId),
    ),
    rows: [],
  };
}

function finishOnlyTable(
  _artifact: ChatArtifact,
  base: Omit<BasePolicy, "structure" | "defaultView" | "effectiveView">,
  structure: PresentationStructure,
  reason: string,
  context: PolicyContext,
): ArtifactPresentationPolicy {
  return {
    ...finishPolicy(
      {
        ...base,
        structure,
        defaultView: "table",
        effectiveView: "table",
        allowedViews: ["table"],
        rejectedViews: [
          rejection("chart", "unknown_structure", reason),
          rejection("heatmap", "requires_join_distribution", reason),
          rejection("scatter", "requires_real_scatter_points", reason),
        ],
        fallbackReason: base.requestedView === "table" ? null : reason,
      },
      context.resultId,
      numericFactIds(context.facts ?? [], context.resultId),
    ),
    rows: [],
  };
}

function fixedArtifactPolicy(
  artifact: Extract<ChatArtifact, { kind: "distribution" | "relations" | "panorama" }>,
  context: PolicyContext,
): ArtifactPresentationPolicy {
  const requested = semanticRequestedView(artifact, context);
  const structure: PresentationStructure =
    artifact.kind === "distribution"
      ? "distribution"
      : artifact.kind === "relations"
        ? "relation"
        : "panorama";
  const allowed: ChatDisplayView[] =
    artifact.kind === "distribution" ? ["heatmap", "table"] : ["chart", "table"];
  const rejected =
    artifact.kind === "distribution"
      ? []
      : [
          rejection("heatmap", "requires_join_distribution", "当前结果没有二维联合分箱。"),
          rejection("scatter", "requires_real_scatter_points", "当前结果没有真实成对点记录。"),
        ];
  const defaultView: ChatDisplayView = artifact.kind === "distribution" ? "heatmap" : "chart";
  const effective = selectView(requested, defaultView, allowed, rejected);
  return {
    ...finishPolicy(
      {
        structure,
        requestedView: requested,
        defaultView,
        ...effective,
        orientation: "not_applicable",
        allowedViews: allowed,
        rejectedViews: rejected,
      },
      context.resultId,
      numericFactIds(context.facts ?? [], context.resultId),
    ),
    rows: [],
  };
}

/** Build the display policy for one trusted artifact. */
export function policyForArtifact(
  artifact: ChatArtifact,
  context: PolicyContext = {},
): ArtifactPresentationPolicy {
  if (artifact.kind === "analysis") return analysisPolicy(artifact, context);
  if (artifact.kind === "studio") return studioPolicy(artifact, context);
  return fixedArtifactPolicy(artifact, context);
}

/**
 * Return the exact, storage-safe policy snapshot. Existing artifact rows are
 * omitted so a cached preference cannot become evidence after history restore.
 */
export function artifactPolicySnapshot(
  artifact: ChatArtifact,
  questionOrContext: string | PolicyContext = {},
  facts?: readonly FactRef[],
): StoredArtifactPresentationPolicy {
  const context =
    typeof questionOrContext === "string"
      ? { question: questionOrContext, facts }
      : { ...questionOrContext, facts: questionOrContext.facts ?? facts };
  const { rows: _rows, ...snapshot } = policyForArtifact(artifact, context);
  return snapshot;
}

/**
 * Response-level visibility for the attachment. This is separate from a
 * viewer's chart/table choice: a single summary stays text, while a real
 * comparison must not be hidden merely because the question says "多少".
 */
/** Pure display switch: chart-like views mark the attachment as a chart. */
export function presentationForView(view: ChatDisplayView): "chart" | "table" {
  return view === "table" ? "table" : "chart";
}

export function presentationForPolicies(
  artifacts: readonly ChatArtifact[],
  policies: readonly StoredArtifactPresentationPolicy[],
  question: string,
  requestedView?: ChatDisplayView | null,
): "text" | "chart" | "table" {
  if (wantsText(question)) return "text";
  if (!artifacts.length || !policies.length) return "text";
  const explicit =
    requestedView === undefined ? requestedPresentationView(question) : requestedView;
  if (explicit === "table") return "table";
  if (explicit) return "chart";
  const primary = policies[0];
  if (primary.structure === "summary") return "text";
  if (primary.effectiveView === "table") return "table";
  return "chart";
}

/**
 * Apply policy without changing computed values or result identity. Presentation
 * choice stays out of result IDs; facts are read from the response contract and
 * attached to the snapshot only by their stable IDs.
 */
export function applyResponsePresentation(
  response: ChatResponse,
  question: string,
  requestedView?: ChatDisplayView | null,
): ChatResponse & { presentationPolicies: StoredArtifactPresentationPolicy[] } {
  const explicitView =
    requestedView === undefined ? requestedPresentationView(question) : requestedView;
  const artifacts = response.artifacts ?? (response.artifact ? [response.artifact] : []);
  const resultRefs = response.resultRefs ?? [];
  const policies = artifacts.map((artifact, index) => {
    const result = resultRefs[index];
    const facts = result
      ? (response.factRefs ?? []).filter((fact) => fact.resultId === result.resultId)
      : [];
    return artifactPolicySnapshot(artifact, {
      question,
      requestedView: explicitView,
      facts,
      resultId: result?.resultId ?? null,
    });
  });
  const adjustedArtifacts = artifacts.map((artifact, index) => {
    const policy = policies[index];
    if (
      artifact.kind === "studio" &&
      artifact.tool === "density" &&
      policy.structure === "joint_distribution"
    ) {
      return {
        ...artifact,
        densityMode: "density" as const,
        view: policy.effectiveView === "table" ? ("table" as const) : ("chart" as const),
      };
    }
    if (artifact.kind === "analysis") {
      return policy.effectiveView === "bar" ||
        policy.effectiveView === "line" ||
        policy.effectiveView === "table"
        ? { ...artifact, view: policy.effectiveView }
        : artifact;
    }
    if (
      artifact.kind === "studio" ||
      artifact.kind === "relations" ||
      artifact.kind === "panorama"
    ) {
      return policy.effectiveView === "chart" || policy.effectiveView === "table"
        ? { ...artifact, view: policy.effectiveView }
        : artifact;
    }
    return policy.effectiveView === "heatmap" || policy.effectiveView === "table"
      ? { ...artifact, view: policy.effectiveView }
      : artifact;
  });
  return {
    ...response,
    artifacts: response.artifacts ? adjustedArtifacts : undefined,
    artifact: response.artifact ? (adjustedArtifacts[0] ?? response.artifact) : null,
    presentation: presentationForPolicies(adjustedArtifacts, policies, question, explicitView),
    presentationPolicies: policies,
  };
}

/**
 * Reject exact chart/table values that the current renderer cannot actually
 * show, while keeping chart↔table switching on the same artifact and fact IDs.
 */
export function viewsForArtifact(
  artifact: ChatArtifact,
  context: PolicyContext = {},
): StoredArtifactPresentationPolicy {
  return artifactPolicySnapshot(artifact, context);
}
