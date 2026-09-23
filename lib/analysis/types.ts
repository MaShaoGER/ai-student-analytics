import { z } from "zod";

export const metricSchema = z.enum(["score", "activity", "completion_rate"]);
export const dimensionSchema = z.enum(["course", "term"]);
export const chartTypeSchema = z.enum(["line", "bar", "table"]);
export const dataSourceSchema = z.enum(["demo", "oulad"]);

export const filterSchema = z.object({
  field: dimensionSchema,
  op: z.enum(["eq", "in"]),
  value: z.union([z.string(), z.array(z.string()).min(1)]),
});

export const analysisPlanSchema = z
  .object({
    version: z.literal(1),
    datasetId: dataSourceSchema,
    metric: metricSchema,
    aggregation: z.enum(["avg", "sum", "count_distinct", "rate"]),
    dimensions: z.array(dimensionSchema).min(1).max(2),
    filters: z.array(filterSchema).max(4).default([]),
    sort: z
      .object({
        by: z.enum(["value", "dimension"]),
        direction: z.enum(["asc", "desc"]),
      })
      .default({ by: "value", direction: "desc" }),
    limit: z.number().int().min(1).max(100).default(20),
    chartType: chartTypeSchema,
  })
  .superRefine((plan, context) => {
    const expectedAggregation =
      plan.metric === "activity" ? "sum" : plan.metric === "completion_rate" ? "rate" : "avg";
    if (plan.aggregation !== expectedAggregation) {
      context.addIssue({
        code: "custom",
        path: ["aggregation"],
        message: `指标 ${plan.metric} 必须使用 ${expectedAggregation} 聚合`,
      });
    }
    if (new Set(plan.dimensions).size !== plan.dimensions.length) {
      context.addIssue({
        code: "custom",
        path: ["dimensions"],
        message: "分组维度不能重复",
      });
    }
  });

export type Metric = z.infer<typeof metricSchema>;
export type Dimension = z.infer<typeof dimensionSchema>;
export type ChartType = z.infer<typeof chartTypeSchema>;
export type DataSource = z.infer<typeof dataSourceSchema>;
export type AnalysisPlan = z.infer<typeof analysisPlanSchema>;

export type AnalysisRow = {
  dimension: string;
  value: number;
  sampleSize: number;
};

export type AnalysisResult = {
  datasetId: DataSource;
  dimension: Dimension;
  chartType: ChartType;
  rows: AnalysisRow[];
  unit: string;
  metricLabel: string;
  period: string;
  query: string;
  durationMs: number;
};

export type DatasetProfile = {
  id: DataSource;
  name: string;
  description: string;
  source: string;
  tables: Array<{
    name: string;
    rows: number | null;
    grain: string;
    status: "ready" | "not_found";
    fields?: Array<{
      name: string;
      type: string;
      missing: number;
    }>;
  }>;
  available: boolean;
};
