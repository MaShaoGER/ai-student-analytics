import { describe, it, expect } from "vitest";
import {
  binnedCorrelation,
  chooseAnalysisView,
  inferGoal,
  resultNarrative,
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
