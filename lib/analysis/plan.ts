import { analysisPlanSchema, type AnalysisPlan, type Metric, type DataSource } from "./types";
import { metricAggregation } from "./metrics";

export function createPlan(options: {
  datasetId: DataSource;
  metric: Metric;
  dimension: "course" | "term";
  chartType: "line" | "bar" | "table";
}): AnalysisPlan {
  return analysisPlanSchema.parse({
    version: 1,
    datasetId: options.datasetId,
    metric: options.metric,
    aggregation: metricAggregation(options.metric),
    dimensions: [options.dimension],
    filters: [],
    sort:
      options.dimension === "term" && options.chartType === "line"
        ? { by: "dimension", direction: "asc" }
        : { by: "value", direction: "desc" },
    limit: 20,
    chartType: options.chartType,
  });
}
