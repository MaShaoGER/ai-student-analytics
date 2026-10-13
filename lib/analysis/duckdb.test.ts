import { describe, expect, it } from "vitest";
import { profileDatasets, runAnalysis } from "./duckdb";
import { createPlan } from "./plan";
import type { AnalysisPlan } from "./types";
import { QueryExecutionError } from "../security/query-execution";

describe("demo DuckDB analysis", () => {
  it("supports cancellation without changing the existing plan contract", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runAnalysis(createPlan({
      datasetId: "demo", metric: "score", dimension: "course", chartType: "bar",
    }), { signal: controller.signal })).rejects.toBeInstanceOf(QueryExecutionError);
    await expect(profileDatasets({ signal: controller.signal })).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });

  it.each<{ sort: AnalysisPlan["sort"]; groups: string[] }>([
    { sort: { by: "dimension", direction: "asc" }, groups: ["AAA", "BBB", "CCC"] },
    { sort: { by: "dimension", direction: "desc" }, groups: ["CCC", "BBB", "AAA"] },
    { sort: { by: "value", direction: "asc" }, groups: ["BBB", "CCC", "AAA"] },
    { sort: { by: "value", direction: "desc" }, groups: ["AAA", "CCC", "BBB"] },
  ])(
    "respects $sort.by $sort.direction before applying the row limit",
    async ({ sort, groups }) => {
      const { result } = await runAnalysis({
        ...createPlan({
          datasetId: "demo",
          metric: "score",
          dimension: "course",
          chartType: "table",
        }),
        sort,
        limit: 2,
      });
      expect(result.rows.map((row) => row.dimension)).toEqual(groups.slice(0, 2));
    },
  );

  it("supports a valid IN filter without changing score calculations", async () => {
    const { result } = await runAnalysis({
      ...createPlan({ datasetId: "demo", metric: "score", dimension: "course", chartType: "bar" }),
      filters: [{ field: "course", op: "in", value: ["AAA", "CCC"] }],
    });
    expect(result.rows).toEqual([
      { dimension: "AAA", value: 79.67, sampleSize: 3 },
      { dimension: "CCC", value: 70.67, sampleSize: 3 },
    ]);
  });

  it("preserves both grouping dimensions for saved reports", async () => {
    const { result } = await runAnalysis({
      ...createPlan({ datasetId: "demo", metric: "score", dimension: "course", chartType: "table" }),
      dimensions: ["course", "term"],
    });
    expect(result.dimensions).toEqual(["course", "term"]);
    expect(result.dimension).toBe("course");
    expect(result.rows[0].dimension).toContain(" / ");
  });

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

  it("profiles demo fields and missing values without exposing records", async () => {
    const profiles = await profileDatasets();
    const demo = profiles.find((profile) => profile.id === "demo");
    expect(demo?.available).toBe(true);
    expect(demo?.tables[0].rows).toBe(27);
    expect(demo?.tables[0].fields).toEqual([
      { name: "id_student", type: "VARCHAR", missing: 0 },
      { name: "code_module", type: "VARCHAR", missing: 0 },
      { name: "code_presentation", type: "VARCHAR", missing: 0 },
      { name: "week", type: "BIGINT", missing: 0 },
      { name: "activity_count", type: "BIGINT", missing: 0 },
    ]);
  });
});
