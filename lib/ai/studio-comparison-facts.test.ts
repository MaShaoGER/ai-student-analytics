import { describe, expect, it } from "vitest";
import { studioComparisonLines } from "./studio-comparison-facts";
import { describeResponseArtifacts } from "./artifact-results";
import { resultNarrative } from "./response-presentation";
import type { ChatArtifact } from "./chat-types";
const artifact: Extract<ChatArtifact, { kind: "studio" }> = {
  kind: "studio",
  tool: "dumbbell",
  view: "chart",
  term: "2025J",
  comparisonTerm: "2025B",
  courses: ["Web前端开发"],
  table: {
    columns: ["课程", "前期均分", "后期均分", "前期样本", "后期样本", "变化"],
    description: "两期群体比较",
    rows: [
      {
        课程: "Web前端开发",
        前期均分: 72.72,
        后期均分: 69.65,
        前期样本: 199,
        后期样本: 200,
        变化: -3.07,
      },
    ],
  },
};
describe("dumbbell facts share the exact trusted table", () => {
  it("retains both means, change and independent samples in the answer and numeric fact refs", () => {
    const answer = resultNarrative(artifact, "lookup", "下降了多少");
    for (const value of ["2025B", "2025J", "72.72", "69.65", "3.07", "199", "200"])
      expect(answer).toContain(value);
    expect(answer).toContain("两期选课群体可能不同");
    const { resultRefs, factRefs } = describeResponseArtifacts([artifact], "demo");
    expect(factRefs.filter((f) => f.semantic?.role === "before")[0].numeric).toMatchObject({
      value: 72.72,
      sampleSize: 199,
    });
    expect(factRefs.filter((f) => f.semantic?.role === "after")[0].numeric).toMatchObject({
      value: 69.65,
      sampleSize: 200,
    });
    expect(factRefs.filter((f) => f.semantic?.role === "change")[0].numeric?.value).toBe(-3.07);
    expect(factRefs.every((f) => f.resultId === resultRefs[0].resultId)).toBe(true);
  });
  it("does not fill missing means or reveal a suppressed tiny group", () => {
    expect(
      studioComparisonLines({
        ...artifact,
        table: { ...artifact.table, rows: [{ ...artifact.table.rows[0], 前期样本: 2 }] },
      }),
    ).toEqual([]);
    expect(
      studioComparisonLines({
        ...artifact,
        table: { ...artifact.table, rows: [{ ...artifact.table.rows[0], 前期均分: null }] },
      }),
    ).toEqual([]);
  });
});
