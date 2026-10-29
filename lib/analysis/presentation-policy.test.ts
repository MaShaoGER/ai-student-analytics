import { describe, expect, it } from "vitest";
import type { ChatArtifact, ChatResponse } from "../ai/chat-types";
import type { FactRef, ResultRef } from "../ai/result-contract";
import {
  applyResponsePresentation,
  artifactPolicySnapshot,
  orderTimeRows,
  presentationForPolicies,
  presentationForView,
  policyForArtifact,
  requestedPresentationView,
  termSortKey,
} from "./presentation-policy";
import type { AnalysisRow, AnalysisPlan } from "./types";
import { analysisPlanSchema } from "./types";
import type { StudioTable } from "./chart-studio";
import { buildChartOption, type ChartColors } from "./chart-options";

const plan = (dimensions: Array<"course" | "term">, chartType: "bar" | "line" | "table") =>
  analysisPlanSchema.parse({
    version: 1,
    datasetId: "demo",
    metric: "score",
    aggregation: "avg",
    dimensions,
    filters: [],
    sort: { by: "dimension", direction: "asc" },
    limit: 20,
    chartType,
  }) satisfies AnalysisPlan;

const analysis = (
  rows: AnalysisRow[],
  dimension: "course" | "term" = "course",
  view: "bar" | "line" | "table" = dimension === "term" ? "line" : "bar",
): Extract<ChatArtifact, { kind: "analysis" }> => ({
  kind: "analysis",
  plan: plan([dimension], view),
  view,
  result: {
    datasetId: "demo",
    dimension,
    chartType: view,
    rows,
    unit: "分",
    metricLabel: "平均成绩",
    period: "模拟校园数据 · 全部学期",
    query: "synthetic fixture",
    durationMs: 1,
    minSampleSize: 3,
    filteredOutGroupCount: 0,
  },
});

const studio = (
  tool: "dumbbell" | "boxplot" | "density" | "sankey" | "rhythm",
  view: "chart" | "table" = "chart",
): Extract<ChatArtifact, { kind: "studio" }> => {
  const table: StudioTable = {
    columns: ["课程", "前期均分", "后期均分"],
    rows: [{ 课程: "A", 前期均分: 60, 后期均分: 62 }],
    description: "synthetic fixture",
  };
  return {
    kind: "studio",
    tool,
    table,
    term: "2025J",
    view,
    ...(tool === "density" ? { densityMode: "scatter" as const } : {}),
  };
};

const resultRef = (resultId: string): ResultRef => ({
  version: 1,
  resultId,
  datasetId: "demo",
  datasetVersion: "fixture",
  metricVersion: "fixture",
  kind: "aggregate",
  metric: "score",
  granularity: "course",
  courses: [],
  terms: [],
  filters: [],
  extra: {},
  unit: "分",
  minSampleSize: 3,
  sampleSize: null,
  scopeLabel: "fixture",
  limitations: [],
});

const fact = (resultId: string, factId: string): FactRef => ({
  factId,
  resultId,
  label: factId,
  text: factId,
  numeric: { value: 1, unit: "分", sampleSize: 3 },
  limitations: [],
});

describe("presentation policy: analysis semantics", () => {
  it("defaults course categories to a horizontal bar and never calls them a trend", () => {
    const artifact = analysis([
      { dimension: "课程 A", value: 81, sampleSize: 10 },
      { dimension: "课程 B", value: 76, sampleSize: 8 },
    ]);
    const policy = policyForArtifact(artifact);
    expect(policy.structure).toBe("category");
    expect(policy.defaultView).toBe("bar");
    expect(policy.effectiveView).toBe("bar");
    expect(policy.orientation).toBe("horizontal");
    expect(policy.allowedViews).toContain("table");
    expect(policy.rejectedViews).toContainEqual(
      expect.objectContaining({ view: "line", code: "requires_ordered_time" }),
    );
  });

  it("sorts real term observations chronologically before choosing a line", () => {
    const rows = [
      { dimension: "2025J", value: 69, sampleSize: 10 },
      { dimension: "2024B", value: 75, sampleSize: 9 },
      { dimension: "2024J", value: 73, sampleSize: 11 },
    ];
    const artifact = analysis(rows, "term");
    const policy = policyForArtifact(artifact);
    expect(policy.structure).toBe("ordered_time");
    expect(policy.defaultView).toBe("line");
    expect(policy.orientation).toBe("vertical");
    expect(policy.rows.map((row) => row.dimension)).toEqual(["2024B", "2024J", "2025J"]);
    expect(rows.map((row) => row.dimension)).toEqual(["2025J", "2024B", "2024J"]);
    // OULAD codes: B is February, J is October. B always precedes J in a year.
    expect(termSortKey("2013B")).toBeLessThan(termSortKey("2013J")!);
    expect(termSortKey("2024B")).toBeLessThan(termSortKey("2024J")!);
    expect(termSortKey("2024A")).toBeNull();
    expect(termSortKey("2024J")).toBeLessThan(termSortKey("2025B")!);
    expect(orderTimeRows(rows)?.map((row) => row.dimension)).toEqual(["2024B", "2024J", "2025J"]);
  });

  it("falls back from a two-point line, and from unknown term labels", () => {
    const twoPoints = policyForArtifact(
      analysis(
        [
          { dimension: "2024J", value: 70, sampleSize: 3 },
          { dimension: "2025J", value: 72, sampleSize: 3 },
        ],
        "term",
        "line",
      ),
      { requestedView: "line" },
    );
    expect(twoPoints.effectiveView).toBe("bar");
    expect(twoPoints.fallbackReason).toBeTruthy();
    expect(twoPoints.rejectedViews).toContainEqual(
      expect.objectContaining({ view: "line", code: "requires_ordered_time" }),
    );

    const unknown = policyForArtifact(
      analysis(
        [
          { dimension: "春季", value: 70, sampleSize: 3 },
          { dimension: "秋季", value: 72, sampleSize: 3 },
          { dimension: "夏季", value: 74, sampleSize: 3 },
        ],
        "term",
        "line",
      ),
    );
    expect(unknown.effectiveView).toBe("table");
    expect(unknown.rejectedViews).toContainEqual(
      expect.objectContaining({ code: "requires_time_order" }),
    );
  });

  it("keeps a single aggregate as a summary/table rather than inventing a chart", () => {
    const policy = policyForArtifact(
      analysis([{ dimension: "全部课程", value: 71, sampleSize: 30 }]),
    );
    expect(policy.structure).toBe("summary");
    expect(policy.defaultView).toBe("table");
    expect(policy.effectiveView).toBe("table");
    expect(policy.allowedViews).toEqual(["table"]);
  });

  it("allows composition only with explicit exclusivity, nonnegative values and an exact trusted total", () => {
    const rows = [
      { dimension: "甲", value: 40, sampleSize: 10 },
      { dimension: "乙", value: 60, sampleSize: 12 },
    ];
    const artifact = analysis(rows);
    const unproven = policyForArtifact(artifact);
    expect(unproven.allowedViews).not.toContain("pie");
    expect(unproven.allowedViews).not.toContain("treemap");

    const valid = policyForArtifact(artifact, {
      capabilities: { additiveParts: true, mutuallyExclusiveParts: true, explicitTotal: 100 },
      requestedView: "pie",
    });
    expect(valid.allowedViews).toEqual(expect.arrayContaining(["pie", "treemap"]));
    expect(valid.effectiveView).toBe("pie");

    const wrongTotal = policyForArtifact(artifact, {
      capabilities: { additiveParts: true, mutuallyExclusiveParts: true, explicitTotal: 99 },
      requestedView: "pie",
    });
    expect(wrongTotal.effectiveView).toBe("bar");
    expect(wrongTotal.fallbackReason).toBeTruthy();

    const negative = policyForArtifact(
      analysis([
        { dimension: "甲", value: -1, sampleSize: 3 },
        { dimension: "乙", value: 7, sampleSize: 3 },
      ]),
      {
        capabilities: { additiveParts: true, mutuallyExclusiveParts: true, explicitTotal: 6 },
        requestedView: "treemap",
      },
    );
    expect(negative.allowedViews).not.toContain("treemap");
  });

  it("never applies composition capabilities to ordered time rows", () => {
    const policy = policyForArtifact(
      analysis(
        [
          { dimension: "2024J", value: 40, sampleSize: 10 },
          { dimension: "2025J", value: 60, sampleSize: 12 },
        ],
        "term",
        "bar",
      ),
      {
        capabilities: { additiveParts: true, mutuallyExclusiveParts: true, explicitTotal: 100 },
        requestedView: "pie",
      },
    );
    expect(policy.structure).toBe("ordered_time");
    expect(policy.effectiveView).toBe("bar");
    expect(policy.allowedViews).not.toContain("pie");
  });

  it("renders horizontal category bars through the existing chart option builder", () => {
    const colors: ChartColors = {
      primary: "#333",
      neutral: "#666",
      text: "#111",
      muted: "#777",
      grid: "#ddd",
      tooltip: "#fff",
      border: "#ccc",
      surface: "#fff",
      palette: ["#333"],
    };
    const option = buildChartOption({
      rows: [
        { dimension: "课程A", value: 80, sampleSize: 10 },
        { dimension: "课程B", value: 70, sampleSize: 8 },
      ],
      chartType: "bar",
      unit: "分",
      metricLabel: "平均成绩",
      colors,
      fontFamily: "sans-serif",
      barOrientation: "horizontal",
    });
    expect(option.xAxis).toMatchObject({ type: "value" });
    expect(option.yAxis).toMatchObject({ type: "category", inverse: true });
  });

  it("never turns generic analysis bubbles into a relationship scatter", () => {
    const artifact = analysis([
      { dimension: "A", value: 80, sampleSize: 10 },
      { dimension: "B", value: 76, sampleSize: 8 },
    ]);
    const guessed = policyForArtifact(artifact, { requestedView: "scatter" });
    expect(guessed.effectiveView).toBe("bar");
    expect(guessed.rejectedViews).toContainEqual(
      expect.objectContaining({ view: "scatter", code: "requires_paired_observations" }),
    );
    const flagged = policyForArtifact(artifact, {
      capabilities: { pairedObservations: true },
      requestedView: "scatter",
    });
    expect(flagged.effectiveView).toBe("bar");
    expect(flagged.allowedViews).not.toContain("scatter");
  });

  it("extracts explicit visual requests without inventing a chart from category rows", () => {
    expect(requestedPresentationView("请用饼图看组成")).toBe("pie");
    expect(requestedPresentationView("换成横向条形图")).toBe("bar");
    expect(requestedPresentationView("给我看看精确数值表")).toBe("table");
    expect(requestedPresentationView("比较各课程平均成绩")).toBeNull();
    const artifact = analysis([
      { dimension: "A", value: 1, sampleSize: 3 },
      { dimension: "B", value: 2, sampleSize: 3 },
    ]);
    const askedForPie = policyForArtifact(artifact, { question: "请用饼图看课程组成" });
    expect(askedForPie.requestedView).toBe("pie");
    expect(askedForPie.effectiveView).toBe("bar");
    expect(askedForPie.fallbackReason).toBeTruthy();
    expect(policyForArtifact(artifact).requestedView).toBeNull();
  });

  it("uses table for multi-field output unless a separately established structure exists", () => {
    const artifact = analysis([
      { dimension: "A / 2025J", value: 80, sampleSize: 10 },
      { dimension: "B / 2025J", value: 76, sampleSize: 8 },
    ]);
    artifact.plan = plan(["course", "term"], "table");
    artifact.result.dimensions = ["course", "term"];
    const policy = policyForArtifact(artifact);
    expect(policy.structure).toBe("table");
    expect(policy.defaultView).toBe("table");
    expect(policy.effectiveView).toBe("table");
  });
});

describe("presentation policy: existing tool artifacts", () => {
  it("preserves the studio dumbbell and makes table a same-result switch", () => {
    const policy = policyForArtifact(studio("dumbbell"));
    expect(policy.structure).toBe("comparison");
    expect(policy.defaultView).toBe("chart");
    expect(policy.effectiveView).toBe("chart");
    expect(policy.allowedViews).toEqual(["chart", "table"]);
  });

  it("rejects structural charts without confirmed source data", () => {
    for (const tool of ["boxplot", "density", "sankey", "rhythm"] as const) {
      const policy = policyForArtifact(studio(tool));
      expect(policy.effectiveView).toBe("table");
      expect(policy.allowedViews).toEqual(["table"]);
      expect(policy.fallbackReason).toBeTruthy();
    }
  });

  it("recognizes structural capabilities proven by the trusted table schema", () => {
    const boxplot = studio("boxplot");
    boxplot.table.columns = [
      "课程",
      "最小值",
      "下四分位数",
      "中位数",
      "上四分位数",
      "最大值",
      "样本数",
    ];
    boxplot.table.rows = [
      { 课程: "A", 最小值: 50, 下四分位数: 60, 中位数: 70, 上四分位数: 80, 最大值: 90, 样本数: 20 },
    ];
    expect(policyForArtifact(boxplot).effectiveView).toBe("chart");

    const density = studio("density");
    density.table.columns = ["出勤率区间中心", "成绩区间中心", "频数"];
    density.table.rows = [{ 出勤率区间中心: 95, 成绩区间中心: 72.5, 频数: 12 }];
    expect(policyForArtifact(density).effectiveView).toBe("chart");

    const sankey = studio("sankey");
    sankey.table.columns = ["出勤档位", "作业档位", "成绩档位", "数量"];
    sankey.table.rows = [{ 出勤档位: "高", 作业档位: "高", 成绩档位: "高", 数量: 8 }];
    expect(policyForArtifact(sankey).effectiveView).toBe("chart");

    const rhythm = studio("rhythm");
    rhythm.table.columns = ["周次", "课程", "人均访问次数", "当周有记录人数"];
    rhythm.table.rows = [{ 周次: 1, 课程: "A", 人均访问次数: 12, 当周有记录人数: 8 }];
    expect(policyForArtifact(rhythm).effectiveView).toBe("chart");
  });

  it("opens each structural renderer only from explicit capabilities", () => {
    expect(
      policyForArtifact(studio("boxplot"), { capabilities: { groupedObservations: true } })
        .effectiveView,
    ).toBe("chart");
    expect(
      policyForArtifact(studio("density"), { capabilities: { jointDistribution: true } })
        .effectiveView,
    ).toBe("chart");
    expect(
      policyForArtifact(studio("sankey"), { capabilities: { stageFlow: true } }).effectiveView,
    ).toBe("chart");
    expect(
      policyForArtifact(studio("rhythm"), { capabilities: { jointDistribution: true } })
        .effectiveView,
    ).toBe("chart");
  });

  it("keeps distribution to heatmap/table and relations/panorama to their real renderer/table", () => {
    const distribution: ChatArtifact = {
      kind: "distribution",
      data: { datasetId: "demo", groups: [], minSampleSize: 3 },
      course: "",
      term: "",
      binWidth: 5,
      view: "heatmap",
    };
    expect(policyForArtifact(distribution).allowedViews).toEqual(["heatmap", "table"]);
    expect(policyForArtifact(distribution, { requestedView: "pie" }).effectiveView).toBe("heatmap");

    const relations: ChatArtifact = {
      kind: "relations",
      data: {
        datasetId: "demo",
        term: "2025J",
        terms: ["2025J"],
        threshold: 60,
        minSampleSize: 3,
        courseLimit: 12,
        totalCourses: 2,
        courses: [],
        relations: [],
      },
      course: "",
      view: "chart",
    };
    expect(policyForArtifact(relations).allowedViews).toEqual(["chart", "table"]);
    expect(policyForArtifact(relations, { requestedView: "scatter" }).effectiveView).toBe("chart");
  });
});

describe("response application and stored snapshots", () => {
  it("rewrites only presentation fields and binds facts by result identity", () => {
    const artifact = analysis([
      { dimension: "课程 A", value: 80, sampleSize: 10 },
      { dimension: "课程 B", value: 75, sampleSize: 8 },
    ]);
    artifact.view = "line";
    const first = resultRef("r-1111111111111111");
    const second = resultRef("r-2222222222222222");
    const firstFact = fact(first.resultId, "f-1111111111111111");
    const secondFact = fact(second.resultId, "f-2222222222222222");
    const response: ChatResponse = {
      kind: "result",
      answer: "fixture",
      facts: [],
      suggestions: [],
      context: null,
      artifact,
      artifacts: [artifact],
      planning: { source: "golden_case", rationale: "fixture", model: null },
      resultRefs: [first, second],
      factRefs: [firstFact, secondFact],
    };
    const applied = applyResponsePresentation(response, "比较各课程");
    expect(applied.artifacts?.[0]).toMatchObject({ view: "bar" });
    expect(applied.artifacts?.[0].kind === "analysis" && applied.artifacts[0].result).toBe(
      artifact.result,
    );
    expect(applied.presentationPolicies[0]).toMatchObject({
      resultId: first.resultId,
      effectiveView: "bar",
      factIds: [firstFact.factId],
    });
    expect(applied.resultRefs).toEqual(response.resultRefs);
    expect(applied.factRefs).toEqual(response.factRefs);
  });

  it("stores choices without rows or evidence, and rejects invalid chosen forms locally", () => {
    const artifact = analysis([
      { dimension: "A", value: 1, sampleSize: 3 },
      { dimension: "B", value: 2, sampleSize: 3 },
    ]);
    const snapshot = artifactPolicySnapshot(artifact, "折线趋势");
    expect(snapshot.effectiveView).toBe("bar");
    expect(snapshot).not.toHaveProperty("rows");
    expect(snapshot.rejectedViews).toContainEqual(
      expect.objectContaining({ view: "line", code: "requires_ordered_time" }),
    );
  });

  it("keeps a comparison attachment visible even when the old goal says lookup", () => {
    const comparison = studio("dumbbell");
    const response: ChatResponse = {
      kind: "result",
      answer: "fixture",
      facts: [],
      suggestions: [],
      context: null,
      artifact: comparison,
      artifacts: [comparison],
      planning: { source: "external", rationale: "fixture", model: null },
      presentation: "text",
    };
    const applied = applyResponsePresentation(
      response,
      "Web前端开发从2024J到2025J均分下降了多少？",
    );
    expect(applied.presentation).toBe("chart");
    expect(applied.presentationPolicies[0]?.structure).toBe("comparison");
  });

  it("keeps a single summary textual, and respects explicit text/table requests", () => {
    const summary = analysis([{ dimension: "全部课程", value: 71, sampleSize: 30 }]);
    const policies = [artifactPolicySnapshot(summary, "各课程均分是多少")];
    expect(presentationForPolicies([summary], policies, "各课程均分是多少")).toBe("text");
    expect(presentationForPolicies([summary], policies, "请用文字回答，不要图表")).toBe("text");
    const category = analysis([
      { dimension: "A", value: 80, sampleSize: 10 },
      { dimension: "B", value: 70, sampleSize: 8 },
    ]);
    const categoryPolicies = [artifactPolicySnapshot(category, "比较各课程")];
    expect(presentationForPolicies([category], categoryPolicies, "比较各课程")).toBe("chart");
    expect(presentationForPolicies([category], categoryPolicies, "改成表格")).toBe("table");
    expect(presentationForView("bar")).toBe("chart");
    expect(presentationForView("table")).toBe("table");
  });

  it("honors an explicit trusted requestedView over question text", () => {
    const artifact = analysis([
      { dimension: "A", value: 1, sampleSize: 3 },
      { dimension: "B", value: 2, sampleSize: 3 },
    ]);
    const policy = policyForArtifact(artifact, {
      question: "请用饼图比较",
      requestedView: "table",
    });
    expect(policy.effectiveView).toBe("table");
    expect(policy.fallbackReason).toBeNull();
  });
});
