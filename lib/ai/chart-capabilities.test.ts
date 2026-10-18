import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { converse, parseConversationDecision } from "./conversation";
import { chartStudioData, runAnalysis, scoreDistribution } from "../analysis/duckdb";
import { requestedTool } from "./chart-capabilities";
import { generateStructured } from "./planner";

const plan = {
  action: "analysis",
  message: "查询成绩",
  metric: "score",
  dimension: "course",
  course: null,
  term: "2024J",
  binWidth: null,
  view: "bar",
  sortBy: "value",
  sortDirection: "asc",
  limit: 1,
  courses: null,
  terms: null,
  dimensions: null,
  tool: null,
  threshold: null,
};
describe("chart requests preserve the requested task", () => {
  let directory: string;
  const generate = vi.fn<typeof generateStructured>();
  const analyze = vi.fn<typeof runAnalysis>();
  const distribution = vi.fn<typeof scoreDistribution>();
  const studio = vi.fn<typeof chartStudioData>();
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "chat-charts-"));
    vi.stubEnv("APP_STATE_DIR", directory);
    vi.resetAllMocks();
    distribution.mockResolvedValue({
      datasetId: "demo",
      minSampleSize: 3,
      groups: ["数学", "英语"].flatMap((course) =>
        ["2024B", "2024J"].map((term) => ({ course, term, count: 3, bins: Array(100).fill(0) })),
      ),
    });
    analyze.mockImplementation(async (raw) => ({
      plan: raw as never,
      result: {
        datasetId: "demo",
        dimension: "course",
        chartType: "bar",
        rows: [],
        unit: "分",
        metricLabel: "平均成绩",
        period: "",
        query: "SELECT aggregate",
        durationMs: 1,
        minSampleSize: 3,
        filteredOutGroupCount: 0,
      },
    }));
    generate.mockResolvedValueOnce({ fields: plan, usedModel: "fixture" }).mockResolvedValue({
      fields: { answer: "可继续比较分布。", suggestions: [] },
      usedModel: "fixture",
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
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  const deps = () => ({ generate, analyze, distribution, studio });
  it("keeps both explicitly requested courses even if the model omits their filters", async () => {
    const r = await converse(
      { question: "只比较数学和英语在2024J的平均成绩", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({
      kind: "analysis",
      plan: {
        filters: expect.arrayContaining([
          { field: "course", op: "in", value: expect.arrayContaining(["数学", "英语"]) },
        ]),
      },
    });
  });
  it("preserves both grouping dimensions rather than silently aggregating across terms", async () => {
    const r = await converse(
      { question: "每门课程在每个学期的平均成绩，按课程和学期分组", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({
      kind: "analysis",
      plan: { dimensions: ["course", "term"], filters: [] },
    });
  });
  it("does not let an arbitrary model limit truncate an all-course request", async () => {
    const r = await converse({ question: "2024J各门课程平均成绩", datasetId: "demo" }, {}, deps());
    expect(r.artifact).toMatchObject({ kind: "analysis", plan: { limit: 100 } });
  });
  it("directly executes an explicit supported boxplot without asking a model for permission", async () => {
    const r = await converse({ question: "画2024J数学的箱线图", datasetId: "demo" }, {}, deps());
    expect(r.artifact).toMatchObject({
      kind: "studio",
      tool: "boxplot",
      table: { description: "五数概要" },
    });
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
    expect(analyze).not.toHaveBeenCalled();
  });
  it("returns the missing-data explanation for an OULAD Sankey rather than fabricating it", async () => {
    const r = await converse({ question: "画一个桑基图", datasetId: "oulad" }, {}, deps());
    expect(r.kind).toBe("clarification");
    expect(r.answer).toContain("出勤");
    expect(studio).not.toHaveBeenCalled();
  });
  it("accepts an empty planning narration without losing a valid query", async () => {
    generate
      .mockReset()
      .mockResolvedValueOnce({ fields: { ...plan, message: "" }, usedModel: "fixture" })
      .mockRejectedValue(new Error("explanation unavailable"));
    const r = await converse({ question: "2024J各门课程均分", datasetId: "demo" }, {}, deps());
    expect(r.kind).toBe("result");
  });
  it("normalizes inactive tool metadata while rejecting invalid executable metrics", () => {
    expect(parseConversationDecision({ ...plan, tool: "bar" }).tool).toBeNull();
    expect(() =>
      parseConversationDecision({ ...plan, metric: "student_name", tool: "bar" }),
    ).toThrow();
    expect(() => parseConversationDecision({ ...plan, action: "tool", tool: "bar" })).toThrow();
  });
  it("accepts a known goal used as an action only through the existing validated analysis path", () => {
    expect(parseConversationDecision({ ...plan, action: "lookup" })).toMatchObject({
      action: "analysis",
      goal: "lookup",
    });
    expect(() =>
      parseConversationDecision({ ...plan, action: "lookup", metric: "student_name" }),
    ).toThrow();
    expect(() => parseConversationDecision({ ...plan, action: "arbitrary_sql" })).toThrow();
  });

  it("does not drop a missing term when the same request also mentions a valid term", async () => {
    const r = await converse(
      { question: "从2024J到2099J的成绩哑铃图", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.kind).toBe("clarification");
    expect(studio).not.toHaveBeenCalled();
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
  it("distinguishes explaining a chart from requesting one", () => {
    expect(requestedTool("箱线图是什么？")).toBeUndefined();
    expect(requestedTool("桑基图和箱线图的区别")).toBeUndefined();
    expect(requestedTool("给我一张箱线图")).toBe("boxplot");
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
    expect(studio.mock.calls[0][4]).toMatchObject({ courses: ["数学"], densityMetric: "activity" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("chooses an absence/score relationship chart without requiring a chart name", async () => {
    const r = await converse(
      { question: "那我想看看这个缺勤次数与成绩的关系图", datasetId: "demo" },
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
  it("uses a comparison chart for broad course comparison even when the model chooses table", async () => {
    generate
      .mockReset()
      .mockResolvedValueOnce({
        fields: { ...plan, view: "table", goal: "compare" },
        usedModel: "fixture",
      })
      .mockRejectedValue(new Error("no explanation"));
    const r = await converse(
      { question: "帮我比较一下2024J各门课的成绩", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({ kind: "analysis", view: "bar" });
    expect(r.presentation).toBe("chart");
  });
  it("keeps explicit table requests", async () => {
    const r = await converse(
      { question: "把2024J各门课平均成绩列成表格", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({ view: "table" });
    expect(r.presentation).toBe("table");
  });
  it("returns a short factual text for a scalar lookup instead of forcing a table", async () => {
    analyze.mockResolvedValueOnce({
      plan: {} as never,
      result: {
        datasetId: "demo",
        dimension: "course",
        chartType: "bar",
        rows: [{ dimension: "数学", value: 73.5, sampleSize: 3 }],
        unit: "分",
        metricLabel: "平均成绩",
        period: "2024J",
        query: "SELECT aggregate",
        durationMs: 1,
        minSampleSize: 3,
        filteredOutGroupCount: 0,
      },
    });
    const r = await converse(
      { question: "2024J数学平均成绩是多少？", datasetId: "demo" },
      {},
      deps(),
    );
    expect(r.presentation).toBe("text");
    expect(r.answer).toContain("73.5");
    expect(r.answer.length).toBeLessThan(200);
    expect(generate).toHaveBeenCalledTimes(1);
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
  });
  it("asks the model for a score distribution instead of guessing a boxplot", async () => {
    generate
      .mockReset()
      .mockResolvedValueOnce({
        fields: {
          ...plan,
          action: "distribution",
          goal: "distribution",
          metric: "score",
          dimension: null,
          course: null,
          term: null,
          view: "heatmap",
          sortBy: null,
          sortDirection: null,
          limit: null,
        },
        usedModel: "fixture",
      })
      .mockRejectedValue(new Error("no explanation"));
    const r = await converse(
      { question: "想看看各科成绩的分布情况", datasetId: "demo" },
      {},
      deps(),
    );
    expect(generate).toHaveBeenCalledTimes(1);
    expect(r.artifact).toMatchObject({ kind: "distribution" });
  });
  it("clears an old course filter when the new goal compares all courses", async () => {
    const r = await converse(
      {
        question: "比较一下各门课的平均成绩",
        datasetId: "demo",
        context: {
          kind: "analysis",
          metric: "score",
          dimension: "course",
          filters: [
            { field: "course", op: "eq", value: "数学" },
            { field: "term", op: "eq", value: "2024J" },
          ],
          sort: { by: "value", direction: "desc" },
          limit: 100,
          view: "table",
        },
      },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({
      kind: "analysis",
      view: "bar",
      plan: { filters: [{ field: "term", op: "eq", value: "2024J" }] },
    });
  });
  it("compares terms chronologically when the user changes a filtered lookup into a trend", async () => {
    const r = await converse(
      {
        question: "看看数学平均成绩随学期的变化趋势",
        datasetId: "demo",
        context: {
          kind: "analysis",
          metric: "score",
          dimension: "course",
          filters: [
            { field: "course", op: "eq", value: "数学" },
            { field: "term", op: "eq", value: "2024J" },
          ],
          sort: { by: "value", direction: "desc" },
          limit: 100,
          view: "table",
        },
      },
      {},
      deps(),
    );
    expect(r.artifact).toMatchObject({
      kind: "analysis",
      view: "line",
      plan: {
        dimensions: ["term"],
        filters: [{ field: "course", op: "eq", value: "数学" }],
        sort: { by: "dimension", direction: "asc" },
      },
    });
  });
});
