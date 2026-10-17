import { z } from "zod";
import {
  dataSourceSchema,
  dimensionSchema,
  filterSchema,
  metricSchema,
  type AnalysisPlan,
  type AnalysisResult,
} from "../analysis/types";
import type { ScoreDistributionData } from "../analysis/score-distribution";

export const chatViewSchema = z.enum([
  "bar",
  "line",
  "table",
  "pie",
  "treemap",
  "radar",
  "scatter",
  "heatmap",
]);
export const chatIntentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("analysis"),
    metric: metricSchema,
    dimension: dimensionSchema,
    filters: z.array(filterSchema).max(4),
    sort: z.object({ by: z.enum(["value", "dimension"]), direction: z.enum(["asc", "desc"]) }),
    limit: z.number().int().min(1).max(100),
    view: chatViewSchema.exclude(["heatmap"]),
  }),
  z.object({
    kind: z.literal("distribution"),
    course: z.string().max(100),
    term: z.string().max(100),
    binWidth: z.union([z.literal(2), z.literal(5), z.literal(10)]),
    view: z.enum(["table", "heatmap"]),
  }),
]);
export const chatInputSchema = z.object({
  question: z.string().trim().min(2).max(500),
  datasetId: dataSourceSchema,
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(3000) }))
    .max(12)
    .default([]),
  context: chatIntentSchema.nullable().default(null),
});
export type ChatIntent = z.infer<typeof chatIntentSchema>;
export type ChatInput = z.infer<typeof chatInputSchema>;
export type ChatMessage = ChatInput["history"][number];
export type ChatArtifact =
  | {
      kind: "analysis";
      plan: AnalysisPlan;
      result: AnalysisResult;
      view: Exclude<z.infer<typeof chatViewSchema>, "heatmap">;
    }
  | {
      kind: "distribution";
      data: ScoreDistributionData;
      course: string;
      term: string;
      binWidth: 2 | 5 | 10;
      view: "table" | "heatmap";
    };
export type ChatResponse = {
  kind: "answer" | "clarification" | "result";
  answer: string;
  facts: string[];
  suggestions: string[];
  context: ChatIntent | null;
  artifact: ChatArtifact | null;
  planning: {
    source: "golden_case" | "local" | "openai" | "external";
    rationale: string;
    model: string | null;
  };
  warning?: string;
};
