import { describe, expect, it } from "vitest";
import { runAnalysis } from "./duckdb";
import { findGoldenCase, GOLDEN_CASES } from "./golden-cases";

describe("MVP golden cases", () => {
  it("defines exactly ten stable questions", () => {
    expect(GOLDEN_CASES).toHaveLength(10);
    expect(new Set(GOLDEN_CASES.map((item) => item.id)).size).toBe(10);
    expect(findGoldenCase("哪门课程平均成绩最高? ")?.id).toBe("score-course-top");
  });

  it.each(GOLDEN_CASES)("$id matches the expected plan and rows", async (goldenCase) => {
    const analysis = await runAnalysis(goldenCase.expectedPlan);
    expect(analysis.plan).toEqual(goldenCase.expectedPlan);
    expect(analysis.result.rows).toHaveLength(goldenCase.expectedRows.length);

    analysis.result.rows.forEach((row, index) => {
      const expected = goldenCase.expectedRows[index];
      expect(row.dimension).toBe(expected.dimension);
      expect(row.sampleSize).toBe(expected.sampleSize);
      expect(row.value).toBeCloseTo(expected.value, 2);
      expect(Math.abs(row.value - expected.value)).toBeLessThanOrEqual(goldenCase.tolerance);
    });
  });
});
