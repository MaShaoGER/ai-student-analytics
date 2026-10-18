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
import type { StudioTable } from "../analysis/chart-studio";
import type { CourseRelationData } from "../analysis/course-relations";
import type { CoursePanoramaData } from "../analysis/course-panorama";
import { toolSchema, type ChatTool } from "./chart-capabilities";

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
export type ChatDisplayView = z.infer<typeof chatViewSchema> | "chart";
export const chatIntentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("analysis"),
    metric: metricSchema,
    dimension: dimensionSchema,
    dimensions: z.array(dimensionSchema).min(1).max(2).optional(),
    filters: z.array(filterSchema).max(4),
    sort: z.object({ by: z.enum(["value", "dimension"]), direction: z.enum(["asc", "desc"]) }),
    limit: z.number().int().min(1).max(100),
    view: chatViewSchema.exclude(["heatmap"]),
  }),
  z.object({
    kind: z.literal("tool"),
    tool: toolSchema,
    courses: z.array(z.string().min(1).max(100)).max(100),
    term: z.string().max(100),
    comparisonTerm: z.string().max(100).nullable(),
    threshold: z.number().int().min(1).max(100),
    densityMetric: z.enum(["activity", "attendance", "absence", "unexcused"]).optional(),
    densityMode: z.enum(["density", "scatter"]).optional(),
    sortChange: z.enum(["asc", "desc"]).optional(),
    view: z.enum(["chart", "table"]),
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
      kind: "studio";
      tool: Exclude<ChatTool, "chord" | "panorama">;
      table: StudioTable;
      densityMode?: "density" | "scatter";
      term: string;
      view: "chart" | "table";
    }
  | { kind: "relations"; data: CourseRelationData; course: string; view: "chart" | "table" }
  | { kind: "panorama"; data: CoursePanoramaData; view: "chart" | "table" }
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
  presentation?: "text" | "chart" | "table";
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

export function artifactWithView(artifact: ChatArtifact, view: ChatDisplayView): ChatArtifact {
  if (artifact.kind === "analysis")
    return view === "chart" || view === "heatmap" ? artifact : { ...artifact, view };
  if (artifact.kind === "distribution")
    return view === "table" || view === "heatmap" ? { ...artifact, view } : artifact;
  return view === "table" || view === "chart" ? { ...artifact, view } : artifact;
}
export function intentWithView(intent: ChatIntent, view: ChatDisplayView): ChatIntent {
  if (intent.kind === "analysis")
    return view === "chart" || view === "heatmap" ? intent : { ...intent, view };
  if (intent.kind === "distribution")
    return view === "table" || view === "heatmap" ? { ...intent, view } : intent;
  return view === "table" || view === "chart" ? { ...intent, view } : intent;
}
