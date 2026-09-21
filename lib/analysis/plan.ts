import { analysisPlanSchema, type AnalysisPlan, type Metric } from "./types";
import { metricAggregation } from "./metrics";

export function createPlan(options: {
  datasetId: "demo" | "oulad";
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
    sort: { by: "value", direction: "desc" },
    limit: 20,
    chartType: options.chartType,
  });
}
