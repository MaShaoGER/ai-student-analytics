import { describe, expect, it } from "vitest";
import { runAnalysis } from "./duckdb";

describe("demo DuckDB analysis", () => {
  it("calculates average score by course from the source rows", async () => {
    const { result } = await runAnalysis({
      version: 1,
      datasetId: "demo",
      metric: "score",
      aggregation: "avg",
      dimensions: ["course"],
      filters: [],
      sort: { by: "value", direction: "desc" },
      limit: 20,
      chartType: "bar",
    });

    expect(result.rows).toEqual([
      { dimension: "AAA", value: 79.67, sampleSize: 3 },
      { dimension: "CCC", value: 70.67, sampleSize: 3 },
      { dimension: "BBB", value: 67.67, sampleSize: 3 },
    ]);
    expect(result.query).toContain("read_csv_auto");
    expect(result.query).toContain("./data/sample/student_outcomes.csv");
    expect(result.query).not.toContain(process.cwd());
  });

  it("calculates activity and completion rate with the same plan contract", async () => {
    const activity = await runAnalysis({
      version: 1,
      datasetId: "demo",
      metric: "activity",
      aggregation: "sum",
      dimensions: ["course"],
      filters: [],
      sort: { by: "value", direction: "desc" },
      limit: 20,
      chartType: "line",
    });
    const completion = await runAnalysis({
      version: 1,
      datasetId: "demo",
      metric: "completion_rate",
      aggregation: "rate",
      dimensions: ["course"],
      filters: [],
      sort: { by: "value", direction: "desc" },
      limit: 20,
      chartType: "bar",
    });

    expect(activity.result.rows[0]).toEqual({ dimension: "AAA", value: 186, sampleSize: 3 });
    expect(completion.result.rows[0]).toEqual({ dimension: "AAA", value: 100, sampleSize: 3 });
  });
});
