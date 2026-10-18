import { describe, it, expect } from "vitest";
import {
  binnedCorrelation,
  chooseAnalysisView,
  inferChartTool,
  inferGoal,
  resultNarrative,
  sanitizeExplanation,
} from "./response-presentation";
import type { ChatArtifact } from "./chat-types";
const density = (rows: Record<string, number>[]): Extract<ChatArtifact, { kind: "studio" }> => ({
  kind: "studio",
  tool: "density",
  view: "chart",
  term: "2025J",
  table: { columns: ["缺勤课时", "成绩区间中心", "频数"], description: "测试聚合", rows },
});
describe("response form follows the analytical goal", () => {
  it("chooses relationship and trend goals from ordinary language", () => {
    expect(inferGoal("那我想看看这个缺勤次数与成绩的关系图")).toBe("relationship");
    expect(inferGoal("看看平均成绩随学期的变化趋势")).toBe("trend");
    expect(inferGoal("课程完成率是什么")).toBe("explain");
  });
  it("only routes explicit chart names and relationship questions to local tools", () => {
    const input = (question: string) =>
      ({ question, datasetId: "demo" as const, history: [], context: null });
    // Score distribution is a model-planned view; guessing a boxplot here
    // silently changed the requested artifact (and contradicted the eval case).
    expect(inferChartTool(input("各科成绩分布如何？"))).toBeUndefined();
    // The density tool is deterministic, so the relationship question runs offline.
    expect(inferChartTool(input("缺勤次数和成绩有关系吗？"))).toBe("density");
    // Explicit chart names still execute locally without asking a model.
    expect(inferChartTool(input("给我一张箱线图"))).toBe("boxplot");
  });
  it("uses a comparison chart rather than an inherited/model table", () => {
    expect(chooseAnalysisView("比较一下各门课平均成绩", "course", "table", null, "compare")).toBe(
      "bar",
    );
    expect(chooseAnalysisView("列成表格比较", "course", "bar", null, "compare")).toBe("table");
    expect(chooseAnalysisView("观察各学期趋势", "term", "table", null, "trend")).toBe("line");
    expect(
      chooseAnalysisView("每门课程每个学期的均分", "course", "bar", null, "compare", [
        "course",
        "term",
      ]),
    ).toBe("table");
  });
  it("labels an estimate from visible bins and distinguishes it from a causal finding", () => {
    const a = density([
      { 缺勤课时: 0, 成绩区间中心: 90, 频数: 3 },
      { 缺勤课时: 2, 成绩区间中心: 70, 频数: 6 },
      { 缺勤课时: 4, 成绩区间中心: 50, 频数: 3 },
    ]);
    expect(binnedCorrelation(a)).toBeCloseTo(-1);
    const answer = resultNarrative(a, "relationship", "用文字概括关系");
    expect(answer).toContain("可见分档数据估算");
    expect(answer).toContain("负向关联");
    expect(answer).toContain("不代表因果");
    expect(answer).not.toContain("横轴");
  });
  it("does not invent a correlation when a variable is constant", () => {
    const a = density([
      { 缺勤课时: 0, 成绩区间中心: 90, 频数: 3 },
      { 缺勤课时: 0, 成绩区间中心: 70, 频数: 3 },
    ]);
    expect(binnedCorrelation(a)).toBeNull();
    expect(resultNarrative(a, "relationship", "")).toContain("无法判断线性关联");
  });
  it("names the course when a scalar followup inherits term grouping", () => {
    const artifact = {
      kind: "analysis",
      view: "line",
      plan: {
        filters: [
          { field: "course", op: "eq", value: "高等数学" },
          { field: "term", op: "eq", value: "2025J" },
        ],
      },
      result: {
        dimension: "term",
        metricLabel: "平均成绩",
        unit: "分",
        rows: [{ dimension: "2025J", value: 57.65, sampleSize: 200 }],
      },
    } as Extract<ChatArtifact, { kind: "analysis" }>;
    expect(resultNarrative(artifact, "lookup", "")).toBe(
      "2025J，高等数学的平均成绩为 57.65分，参与统计 200 人。",
    );
  });
});
describe("model explanations are cleaned sentence by sentence", () => {
  it("drops numeric sentences and keeps the remaining prose", () => {
    const answer =
      "整体差异可能来自样本构成，需要结合课程难度核验。最高分达到 95 分。结论不能证明因果。";
    expect(sanitizeExplanation(answer)).toBe(
      "整体差异可能来自样本构成，需要结合课程难度核验。结论不能证明因果。",
    );
  });
  it("drops percent statements and full-width digits", () => {
    expect(sanitizeExplanation("通过率约为 80%。需要结合考核方式理解。")).toBe(
      "需要结合考核方式理解。",
    );
    expect(sanitizeExplanation("占比接近 ８０％。仅描述当前范围。")).toBe("仅描述当前范围。");
  });
  it("returns an empty string when every sentence carries a number", () => {
    expect(sanitizeExplanation("共999999人，最高100%。")).toBe("");
  });
  it("keeps clean text untouched", () => {
    expect(sanitizeExplanation("这些差异需要结合课程难度继续核验。")).toBe(
      "这些差异需要结合课程难度继续核验。",
    );
  });
});
