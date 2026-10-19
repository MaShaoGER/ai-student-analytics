import { beforeEach, describe, expect, it, vi } from "vitest";
import { converse } from "./conversation";
import {
  chartStudioData,
  coursePanorama,
  courseRelations,
  runAnalysis,
  scoreDistribution,
} from "../analysis/duckdb";
import { requestedTool } from "./chart-capabilities";

/**
 * These tests only cover what still works with no model at all: an explicitly
 * requested native chart, the relationship/chart heuristics, and typed
 * presentation follow-ups. The unified tool loop is disabled by an unverified
 * capability, so every response here comes from the deterministic local
 * fallback. Model-chosen tools/views are covered by `unified.test.ts`.
 */
describe("deterministic chart requests without a model", () => {
  const generate = vi.fn();
  const analyze = vi.fn<typeof runAnalysis>();
  const distribution = vi.fn<typeof scoreDistribution>();
  const studio = vi.fn<typeof chartStudioData>();
  const relations = vi.fn<typeof courseRelations>();
  const panorama = vi.fn<typeof coursePanorama>();
  beforeEach(() => {
    vi.resetAllMocks();
    distribution.mockResolvedValue({
      datasetId: "demo",
      minSampleSize: 3,
      groups: ["数学", "英语"].flatMap((course) =>
        ["2024B", "2024J"].map((term) => ({ course, term, count: 3, bins: Array(100).fill(0) })),
      ),
    });
    studio.mockResolvedValue({
      datasetId: "demo",
      term: "2024J",
      terms: ["2024J", "2024B"],
      courses: ["数学", "英语"],
      course: "",
      tables: {
        density: {
          columns: ["活动量区间中心", "成绩区间中心", "频数"],
          rows: [],
          description: "活动量与成绩",
        },
        boxplot: {
          columns: ["课程", "中位数"],
          rows: [{ 课程: "数学", 中位数: 70 }],
          description: "五数概要",
        },
        dumbbell: {
          columns: ["课程", "前期均分", "后期均分"],
          rows: [{ 课程: "数学", 前期均分: 60, 后期均分: 70 }],
          description: "2024B → 2024J",
        },
      },
    });
    relations.mockResolvedValue({
      datasetId: "demo",
      term: "2024J",
      terms: ["2024B", "2024J"],
      threshold: 60,
      minSampleSize: 3,
      courseLimit: 12,
      totalCourses: 2,
      courses: [
        { name: "数学", count: 3 },
        { name: "英语", count: 3 },
      ],
      relations: [{ source: "数学", target: "英语", commonCount: 3, belowCount: 1, rate: 1 / 3 }],
    });
  });
  /** The unified tool loop is unavailable, so `converse` must take the local fallback. */
  const offline = {
    capability: () => ({ status: "unknown" as const, checkedAt: null }),
    settings: () => ({ enabled: true, maxToolCalls: 6, timeoutSeconds: 60 }),
    generate: generate as never,
  };
  const deps = () => ({
    analyze: analyze as unknown as typeof runAnalysis,
    distribution: distribution as unknown as typeof scoreDistribution,
    studio: studio as unknown as typeof chartStudioData,
    relations: relations as unknown as typeof courseRelations,
    panorama: panorama as unknown as typeof coursePanorama,
    unified: offline,
  });

  it("executes an explicitly requested boxplot locally without asking a model", async () => {
    const r = await converse({ question: "画2024J数学的箱线图", datasetId: "demo" }, {}, deps());
    expect(r.artifact).toMatchObject({
      kind: "studio",
      tool: "boxplot",
      table: { description: "五数概要" },
    });
    expect(r.planning).toMatchObject({ source: "local", model: null });
    expect(studio).toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("executes the actual two-term comparison for an improvement question", async () => {
    const r = await converse(
      { question: "数学从2024B到2024J平均成绩提升了多少分", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({
      kind: "studio",
      tool: "dumbbell",
      table: { rows: [expect.objectContaining({ 变化: 10 })] },
    });
    expect(r.context).toMatchObject({
      kind: "tool",
      tool: "dumbbell",
      term: "2024J",
      comparisonTerm: "2024B",
    });
    expect(analyze).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps an explicit comparison direction", async () => {
    const r = await converse(
      { question: "从2024J到2024B的成绩哑铃图", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.context).toMatchObject({ term: "2024B", comparisonTerm: "2024J" });
    expect(studio.mock.calls[0][4]).toMatchObject({ beforeTerm: "2024J" });
  });

  it("executes a requested chord chart against the existing relations query", async () => {
    const r = await converse(
      { question: "画2024J数学和英语的学科关联弦图", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({ kind: "relations", course: "", view: "chart" });
    expect(relations).toHaveBeenCalled();
    expect(r.facts.join(" ")).toContain("薄弱共现");
    expect(generate).not.toHaveBeenCalled();
  });

  it("chooses an absence/score relationship chart without requiring a chart name", async () => {
    const r = await converse(
      { question: "缺勤次数和成绩有关系吗？", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.context).toMatchObject({
      kind: "tool",
      tool: "density",
      densityMetric: "absence",
      densityMode: "scatter",
      view: "chart",
    });
    expect(r.presentation).toBe("chart");
    expect(studio.mock.calls[0][4]).toMatchObject({ densityMetric: "absence" });
    expect(analyze).not.toHaveBeenCalled();
  });

  it("returns the missing-data explanation for an OULAD Sankey rather than fabricating it", async () => {
    const r = await converse({ question: "画一个桑基图", datasetId: "oulad" }, {}, deps());
    expect(r.kind).toBe("clarification");
    expect(r.answer).toContain("出勤");
    expect(r.planning).toMatchObject({ source: "local", model: null });
    expect(studio).not.toHaveBeenCalled();
  });

  it("does not substitute activity when absence data is unavailable", async () => {
    const r = await converse(
      { question: "看看缺勤次数与成绩的关系", datasetId: "oulad" },
      {},
      deps(),
    );
    expect(r.kind).toBe("clarification");
    expect(r.answer).toContain("缺勤");
    expect(studio).not.toHaveBeenCalled();
  });

  it("asks for a valid scope when the requested term is not in the data", async () => {
    const r = await converse(
      { question: "从2024J到2099J的成绩哑铃图", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.kind).toBe("clarification");
    expect(r.answer).toContain("2099J");
    expect(studio).not.toHaveBeenCalled();
  });

  it("changes an old table into a relationship chart for a new analytical goal", async () => {
    const r = await converse(
      {
        question: "那缺勤和成绩之间有什么关系",
        datasetId: "demo",
        context: {
          kind: "tool",
          tool: "density",
          courses: ["数学"],
          term: "2024J",
          comparisonTerm: null,
          threshold: 60,
          densityMetric: "attendance",
          view: "table",
        },
      },
      {},
      deps(),
    );
    expect(r.context).toMatchObject({
      courses: ["数学"],
      term: "2024J",
      densityMetric: "absence",
      densityMode: "scatter",
      view: "chart",
    });
    expect(r.artifact).toMatchObject({ kind: "studio", tool: "density", view: "chart" });
  });

  it("retains axes and scope on a density-table followup without a model call", async () => {
    const r = await converse(
      {
        question: "改成表格",
        datasetId: "demo",
        context: {
          kind: "tool",
          tool: "density",
          courses: ["数学"],
          term: "2024J",
          comparisonTerm: null,
          threshold: 60,
          densityMetric: "activity",
          view: "chart",
        },
      },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({ kind: "studio", tool: "density", view: "table" });
    expect(studio.mock.calls[0][4]).toMatchObject({ courses: ["数学"], densityMetric: "activity" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("preserves distribution scope when changing the bin width", async () => {
    const r = await converse(
      {
        question: "按10分一档",
        datasetId: "demo",
        context: {
          kind: "distribution",
          course: "数学",
          term: "2024J",
          binWidth: 5,
          view: "heatmap",
        },
      },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({
      kind: "distribution",
      course: "数学",
      term: "2024J",
      binWidth: 10,
    });
    expect(distribution).toHaveBeenLastCalledWith("demo", expect.anything(), {
      course: "数学",
      term: "2024J",
    });
    expect(generate).not.toHaveBeenCalled();
  });

  it("keeps an explicit table request on a named chart", async () => {
    const r = await converse(
      { question: "画2024J数学的箱线图，改用表格", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({ kind: "studio", tool: "boxplot", view: "table" });
    expect(r.presentation).toBe("table");
  });
});

describe("requestedTool", () => {
  it("distinguishes explaining a chart from requesting one", () => {
    expect(requestedTool("箱线图是什么？")).toBeUndefined();
    expect(requestedTool("桑基图和箱线图的区别")).toBeUndefined();
    expect(requestedTool("给我一张箱线图")).toBe("boxplot");
  });
});
