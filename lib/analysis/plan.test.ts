import { describe, expect, it } from "vitest";
import { createPlan } from "./plan";
import { analysisPlanSchema } from "./types";

describe("AnalysisPlan v1", () => {
  it("creates a bounded plan for a supported metric", () => {
    const plan = createPlan({
      datasetId: "demo",
      metric: "completion_rate",
      dimension: "term",
      chartType: "bar",
    });
    expect(plan).toMatchObject({
      version: 1,
      metric: "completion_rate",
      aggregation: "rate",
      dimensions: ["term"],
    });
  });

  it("rejects unknown metrics and oversized limits", () => {
    expect(() =>
      analysisPlanSchema.parse({
        version: 1,
        datasetId: "demo",
        metric: "retention",
        aggregation: "avg",
        dimensions: ["course"],
        filters: [],
        sort: { by: "value", direction: "desc" },
        limit: 1000,
        chartType: "bar",
      }),
    ).toThrow();
  });
});
