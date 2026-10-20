import type { ChatArtifact } from "./chat-types";
import { METRICS } from "../analysis/metrics";
import { distributionRows, distributionCountingUnit } from "../analysis/score-distribution";
import { toolLabel } from "./chart-capabilities";
import {
  buildFactRef,
  buildResultRef,
  danglingFactRefs,
  type FactRef,
  type ResultRef,
  type ResultRefInput,
} from "./result-contract";
import {
  ABSENCE_METRIC_LABELS,
  ABSENCE_SCOPE_LIMITATIONS,
  type AbsenceStats,
} from "../analysis/absence-stats";
import type { DataSource } from "../analysis/types";

/**
 * Bridge from the existing `ChatArtifact` union to the unified result contract.
 *
 * Nothing here re-queries: a ref is derived from data already computed for the
 * artifact, so chart/table switching cannot produce a second result id or a
 * second database read.
 */

/** The subset of an AnalysisPlan filter this module needs. */
type PlanFilter = { field: "course" | "term"; op: "eq" | "in"; value: string | string[] };

function filterScope(filters: PlanFilter[] | undefined) {
  return (filters ?? []).map((filter) => ({
    field: filter.field,
    op: filter.op,
    value: filter.value,
  }));
}

function valuesOf(filters: PlanFilter[] | undefined, field: "course" | "term") {
  return (filters ?? [])
    .filter((filter) => filter.field === field)
    .flatMap((filter) => (Array.isArray(filter.value) ? filter.value : [filter.value]));
}

function scopeLabel(datasetId: DataSource, parts: string[]): string {
  return [
    datasetId === "demo"
      ? "模拟校园数据"
      : datasetId === "oulad"
        ? "OULAD 本地数据"
        : "导入成绩数据",
    ...parts.filter(Boolean),
  ].join(" · ");
}

/**
 * Absence results are not a `ChatArtifact` (there is no chart to render), but
 * they are still statistical results that must be identified and verifiable.
 * Without this, a pure absence answer would carry numbers with no `resultId`,
 * no `factRef`, and would fall through to the "clarification" branch.
 */
export function describeAbsence(
  stats: AbsenceStats,
  datasetId: DataSource,
): { result: ResultRef; facts: FactRef[] } | null {
  const unit = stats.unit === "students" ? "人" : stats.unit === "days" ? "天" : "课时";
  const resultRef = buildResultRef({
    datasetId,
    datasetVersion: stats.datasetVersion,
    kind: "absence",
    metric: stats.metric,
    granularity: "student_course_term",
    courses: stats.course ? [stats.course] : stats.rows.map((row) => row.course),
    terms: stats.term ? [stats.term] : stats.terms,
    filters: [
      ...(stats.course
        ? [{ field: "course" as const, op: "eq" as const, value: stats.course }]
        : []),
      ...(stats.term ? [{ field: "term" as const, op: "eq" as const, value: stats.term }] : []),
    ],
    extra: { absenceMetric: stats.metric, unit: stats.unit },
    unit,
    minSampleSize: stats.minSampleSize,
    // Per-course groups can share students, so no single headcount is asserted;
    // the deduplicated figure is a separate measured fact below.
    sampleSize: null,
    scopeLabel: `${datasetId === "demo" ? "模拟校园数据" : datasetId === "oulad" ? "OULAD 本地数据" : "导入成绩数据"} · ${
      stats.term ? `学期：${stats.term}` : "全部学期"
    } · ${stats.course ? `课程：${stats.course}` : "全部课程"} · ${ABSENCE_METRIC_LABELS[stats.metric]}`,
    limitations: ABSENCE_SCOPE_LIMITATIONS,
  });
  // An unsupported request produced no statistics: returning a ResultRef would
  // let the UI claim "1 statistical result" for an answer that computed nothing.
  // Callers must treat `null` as "explained refusal, no data".
  if (!stats.supported) return null;
  const facts: FactRef[] = [];
  const scope = stats.term ? `学期 ${stats.term}` : "全部学期";
  for (const row of stats.rows) {
    if (stats.unit === "students") {
      facts.push(
        buildFactRef(resultRef, {
          label: `${row.course}受影响学生数`,
          text: `${scope} · ${row.course}：有${ABSENCE_METRIC_LABELS[stats.metric]}的学生 ${row.students} 人。`,
          numeric: { value: row.students, unit: "人", sampleSize: row.students },
          limitations: ["各课程人数可能包含同一学生，不能直接相加当作去重人数。"],
        }),
      );
    } else {
      facts.push(
        buildFactRef(resultRef, {
          label: `${row.course}${ABSENCE_METRIC_LABELS[stats.metric]}`,
          text: `${scope} · ${row.course}：${ABSENCE_METRIC_LABELS[stats.metric]} ${row.sessions} 课时。`,
          numeric: {
            value: row.sessions,
            unit: "课时",
            // The affected-student count is not a denominator for a sum of
            // periods; keep it as sample context only.
            sampleSize: row.students,
          },
          limitations: [`每课时 ${stats.minutesPerPeriod} 分钟；不是请假申请次数。`],
        }),
      );
    }
  }
  if (stats.totals.sessions > 0) {
    facts.push(
      buildFactRef(resultRef, {
        label: "缺勤课时合计",
        text: `${scope} · 全部课程合计 ${ABSENCE_METRIC_LABELS[stats.metric]} ${stats.totals.sessions} 课时。`,
        numeric: { value: stats.totals.sessions, unit: "课时", sampleSize: null },
        limitations: ["按课程分别统计后求和，不是跨课程去重结果。"],
      }),
    );
  }
  if (stats.totals.distinctStudents > 0) {
    facts.push(
      buildFactRef(resultRef, {
        label: "去重受影响学生数",
        text: `${scope} · 跨课程去重后有${ABSENCE_METRIC_LABELS[stats.metric]}的学生 ${stats.totals.distinctStudents} 人；各课程人数相加为 ${stats.totals.studentCourseCount} 人次，不能当作人数。`,
        numeric: {
          value: stats.totals.distinctStudents,
          unit: "人",
          sampleSize: stats.totals.distinctStudents,
        },
        limitations: ["按学生去重，跨课程只计一次。"],
      }),
    );
  }
  return { result: resultRef, facts };
}

/** Identity + facts for one artifact. Returns null for artifacts without numbers. */
export function describeArtifact(
  artifact: ChatArtifact,
  datasetId: DataSource,
): { result: ResultRef; facts: FactRef[] } | null {
  return artifact.kind === "analysis"
    ? describeAnalysis(artifact)
    : artifact.kind === "distribution"
      ? describeDistribution(artifact)
      : describeTool(artifact, datasetId);
}

function describeAnalysis(artifact: Extract<ChatArtifact, { kind: "analysis" }>) {
  const { plan, result } = artifact;
  const planFilters = plan.filters as PlanFilter[] | undefined;
  const courses = valuesOf(planFilters, "course");
  const terms = valuesOf(planFilters, "term");
  // Never trust the artifact's plan shape here: derivation must not fail a
  // successful query only because a fixture (or an older snapshot) is partial.
  const dimensions = plan.dimensions ?? [result.dimension];
  const metric = METRICS[plan.metric] ?? {
    label: result.metricLabel,
    unit: result.unit,
  };
  const resultRef = buildResultRef({
    datasetId: plan.datasetId,
    datasetVersion: result.datasetVersion,
    kind: "aggregate",
    metric: plan.metric,
    granularity: dimensions.length > 1 ? "course_term" : dimensions[0],
    courses,
    terms,
    filters: filterScope(planFilters),
    extra: {
      aggregation: plan.aggregation ?? null,
      limit: plan.limit ?? null,
    },
    unit: result.unit,
    minSampleSize: result.minSampleSize,
    // Grouped rows may share students; a single overall figure is only asserted
    // when the query actually produced one row.
    sampleSize: result.rows.length === 1 ? result.rows[0].sampleSize : null,
    // `result.period` already starts with the dataset name; appending the
    // helper's prefix produced "模拟校园数据 · 模拟校园数据 · …".
    scopeLabel: result.period,
    limitations: [
      ...(result.rows.length > 1
        ? ["各组样本可能重叠，人数不能直接相加；汇总差异不能证明原因或评价个体。"]
        : []),
      ...(result.filteredOutGroupCount
        ? [
            `有 ${result.filteredOutGroupCount} 个分组因不足 ${result.minSampleSize} 人被隐藏；隐藏不表示为零。`,
          ]
        : []),
    ],
  });
  const facts: FactRef[] = [];
  if (result.rows.length) {
    const sorted = [...result.rows].sort((a, b) => b.value - a.value);
    const top = sorted[0];
    const own = result.rows.find((row) => row.dimension === top.dimension)!;
    facts.push(
      buildFactRef(resultRef, {
        label: `最高分组的${metric.label}`,
        text: `返回分组中最高：${top.dimension}，${result.metricLabel} ${top.value} ${result.unit}，参与统计 ${top.sampleSize} 人。`,
        numeric: {
          value: top.value,
          unit: result.unit,
          sampleSize: own.sampleSize,
          // A rate keeps its denominator so the ratio can be recomputed.
          ...(plan.metric === "completion_rate" ? { numerator: own.value, denominator: 100 } : {}),
        },
        semantic: { subject: top.dimension, metric: plan.metric, role: "maximum" },
        limitations: [],
      }),
    );
    if (sorted.length > 1) {
      const low = sorted.at(-1)!;
      facts.push(
        buildFactRef(resultRef, {
          label: "平均值差",
          text: `${top.dimension} 与 ${low.dimension} 相差 ${Math.round((top.value - low.value) * 100) / 100} ${result.unit === "%" ? "个百分点" : result.unit}。`,
          numeric: {
            value: Math.round((top.value - low.value) * 100) / 100,
            unit: result.unit === "%" ? "个百分点" : result.unit,
            sampleSize: null,
          },
          semantic: { subject: top.dimension, metric: plan.metric, role: "range" },
          limitations: ["差值由各组自己的样本计算，样本可能重叠。"],
        }),
        buildFactRef(resultRef, {
          label: `最低分组的${metric.label}`,
          text: `返回分组中最低：${low.dimension}，${result.metricLabel} ${low.value} ${result.unit}，参与统计 ${low.sampleSize} 人。`,
          numeric: { value: low.value, unit: result.unit, sampleSize: low.sampleSize },
          semantic: { subject: low.dimension, metric: plan.metric, role: "minimum" },
          limitations: [],
        }),
      );
    }
  }
  return { result: resultRef, facts };
}

function describeDistribution(artifact: Extract<ChatArtifact, { kind: "distribution" }>) {
  const { data, course, term, binWidth } = artifact;
  const groups = data.groups;
  const rows = distributionRows(groups, term, course, binWidth);
  const unit = distributionCountingUnit(groups, term);
  const resultRef = buildResultRef({
    datasetId: data.datasetId,
    datasetVersion: data.datasetVersion,
    kind: "distribution",
    metric: "score",
    granularity: "student_course_term",
    courses: course ? [course] : [...new Set(groups.map((group) => group.course))],
    terms: term ? [term] : [...new Set(groups.map((group) => group.term))],
    filters: [
      ...(course ? [{ field: "course" as const, op: "eq" as const, value: course }] : []),
      ...(term ? [{ field: "term" as const, op: "eq" as const, value: term }] : []),
    ],
    extra: { binWidth },
    unit,
    minSampleSize: data.minSampleSize,
    // One course + one term is one cohort of distinct students; anything wider
    // may repeat the same student across terms.
    sampleSize: rows.length === 1 && term ? rows[0].count : null,
    scopeLabel: scopeLabel(data.datasetId, [
      term ? `学期：${term}` : "全部学期",
      course ? `课程：${course}` : "全部课程",
      `按 ${binWidth} 分一档`,
    ]),
    limitations: [
      `只统计有效成绩，先按学生、课程、学期取均值；不足 ${data.minSampleSize} 人的课程学期分组已排除，缺失值不作零分。`,
      ...(term ? [] : ["跨学期统计的是人次，同一学生可能被多次计入。"]),
    ],
  });
  const facts: FactRef[] = rows.slice(0, 4).map((row) =>
    buildFactRef(resultRef, {
      label: `${row.course}有效成绩人数`,
      text: `${row.course}：有效成绩 ${row.count} ${term ? "人" : "人次"}。`,
      numeric: {
        value: row.count,
        unit: term ? "人" : "人次",
        sampleSize: row.count,
        numerator: row.count,
      },
      limitations: [`按 ${binWidth} 分一档；缺失值不作零分。`],
    }),
  );
  return { result: resultRef, facts };
}

function describeTool(
  artifact: Exclude<ChatArtifact, { kind: "analysis" | "distribution" }>,
  datasetId: DataSource,
): { result: ResultRef; facts: FactRef[] } {
  if (artifact.kind === "relations") {
    const relations = artifact as Extract<ChatArtifact, { kind: "relations" }>;
    const { data } = relations;
    const resultRef = buildResultRef({
      datasetId: data.datasetId,
      datasetVersion: data.datasetVersion,
      kind: "relations",
      metric: "chord",
      granularity: "course_term",
      courses: relations.course ? [relations.course] : data.courses.map((item) => item.name),
      terms: data.term ? [data.term] : [],
      filters: [],
      extra: { threshold: data.threshold, courseLimit: data.courseLimit },
      unit: "人",
      minSampleSize: data.minSampleSize,
      sampleSize: null,
      scopeLabel: scopeLabel(data.datasetId, [
        `学期：${data.term ?? "无可用学期"}`,
        `阈值 ${data.threshold} 分`,
      ]),
      limitations: [
        "共同未达标占比的分母为同时具有两科有效成绩的学生数。",
        "共现不等于因果，也不能解释为个体风险。",
      ],
    });
    return { result: resultRef, facts: relationshipFacts(resultRef, data.relations.length) };
  }
  if (artifact.kind === "panorama") {
    const { data } = artifact;
    const resultRef = buildResultRef({
      datasetId: data.datasetId,
      datasetVersion: data.datasetVersion,
      kind: "panorama",
      metric: "panorama",
      granularity: "course_term",
      courses: data.courses.map((item) => item.name),
      terms: data.term ? [data.term] : [],
      filters: [],
      extra: { threshold: data.threshold },
      unit: "分",
      minSampleSize: data.minSampleSize,
      sampleSize: null,
      scopeLabel: scopeLabel(data.datasetId, [`学期：${data.term ?? "无可用学期"}`]),
      limitations: [
        "全景图为同批次选课学生的聚合统计，不能跨学期直接比较。",
        "共现关系不代表因果。",
      ],
    });
    return { result: resultRef, facts: relationshipFacts(resultRef, data.relations.length) };
  }
  // Studio artifacts (density, boxplot, dumbbell, heatmap, sankey).
  const studio = artifact as Extract<ChatArtifact, { kind: "studio" }>;
  const kind = studio.tool;
  const courses = studio.courses ?? [];
  const resultRef = buildResultRef({
    datasetId,
    datasetVersion: studio.datasetVersion,
    kind: "advanced_chart",
    metric: kind,
    granularity: "student_course_term",
    courses,
    terms: [studio.comparisonTerm, studio.term].filter((term): term is string => Boolean(term)),
    filters: courses.map((course) => ({
      field: "course" as const,
      op: "eq" as const,
      value: course,
    })),
    extra: { tool: kind },
    unit: kind === "density" ? "频数" : "分",
    minSampleSize: 3,
    sampleSize: null,
    scopeLabel: [
      studio.term || "所选学期",
      courses.length
        ? courses.length > 2
          ? `${courses[0]} 等 ${courses.length} 门课程`
          : courses.join("、")
        : "全部课程",
      toolLabel(kind),
    ].join(" · "),
    limitations: [studio.table.description].filter(Boolean),
  });
  return {
    result: resultRef,
    facts: [
      buildFactRef(resultRef, {
        label: "聚合数据行",
        // Same wording as `toolFacts()` so the UI can bind the displayed prose
        // fact to this factId (exact text match).
        text: `返回 ${studio.table.rows.length} 个聚合数据行；下方图表和数值表使用同一份真实统计。`,
        numeric: { value: studio.table.rows.length, unit: "行", sampleSize: null },
        limitations: [],
      }),
    ],
  };
}

function relationshipFacts(result: ResultRef, relations: number): FactRef[] {
  return [
    buildFactRef(result, {
      label: "共现组数",
      text: `返回 ${relations} 组共现关系。`,
      numeric: { value: relations, unit: "组", sampleSize: null },
      limitations: ["共现不等于因果。"],
    }),
  ];
}

/**
 * Refs for a response, with dangling facts removed at the output boundary.
 * A fact that cites a result the response does not contain must never be shown
 * as verified; the caller gets a warning instead of a silent drop.
 */
export function describeResponseArtifacts(
  artifacts: ChatArtifact[],
  datasetId: DataSource,
): {
  resultRefs: ResultRef[];
  factRefs: FactRef[];
  warning: string | null;
} {
  const { resultRefs, factRefs } = describeArtifacts(artifacts, datasetId);
  const dangling = danglingFactRefs(resultRefs, factRefs);
  const kept = dangling.length
    ? factRefs.filter((fact) => !dangling.some((item) => item.factId === fact.factId))
    : factRefs;
  return {
    resultRefs,
    factRefs: kept,
    warning: dangling.length
      ? "部分解释引用了本次没有返回的统计结果，已隐藏这些数字；其余结果仍可核对。"
      : null,
  };
}

/** Collect refs for a list of artifacts, keeping artifact order. */
export function describeArtifacts(
  artifacts: ChatArtifact[],
  datasetId: DataSource,
): {
  resultRefs: ResultRef[];
  factRefs: FactRef[];
} {
  const resultRefs: ResultRef[] = [];
  const factRefs: FactRef[] = [];
  for (const artifact of artifacts) {
    const described = describeArtifact(artifact, datasetId);
    if (!described) continue;
    resultRefs.push(described.result);
    factRefs.push(...described.facts);
  }
  return { resultRefs, factRefs };
}

export type { ResultRefInput };
