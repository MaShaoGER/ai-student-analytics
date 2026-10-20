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
import { RESULT_KINDS, type FactRef, type ResultRef } from "./result-contract";
// Type-only import: keeps this module (and every client component importing it)
// free of the server-only ai-cost runtime (node:crypto, settings storage).
import type { RequestUsage } from "../security/ai-cost";

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
/**
 * Compact, server-produced identity of one result shown in an earlier turn.
 * It only lets the next turn keep "what was already looked at"; it is never
 * evidence for a number (the model must re-query through a tool).
 */
export const chatHistoryResultSchema = z.object({
  resultId: z.string().regex(/^r-[0-9a-f]{16}$/),
  kind: z.enum(RESULT_KINDS),
  label: z.string().trim().min(1).max(200),
});
export type ChatHistoryResult = z.infer<typeof chatHistoryResultSchema>;
export const chatInputSchema = z
  .object({
    question: z.string().trim().min(2).max(500),
    datasetId: dataSourceSchema,
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string().max(3000),
          /** Only assistant turns carry this; see `chatHistoryResultSchema`. */
          results: z.array(chatHistoryResultSchema).max(4).optional(),
        }),
      )
      .max(12)
      .default([]),
    context: chatIntentSchema.nullable().default(null),
  })
  .superRefine((value, ctx) => {
    value.history.forEach((message, index) => {
      if (message.role === "user" && message.results?.length)
        ctx.addIssue({
          code: "custom",
          path: ["history", index, "results"],
          message: "用户消息不能携带结果引用。",
        });
    });
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
      /** Reference term is part of a comparison result's identity. */
      comparisonTerm?: string;
      view: "chart" | "table";
      /**
       * Courses the chart was narrowed to. Optional for older snapshots, but
       * required for result identity: two different course scopes must not hash
       * to the same `resultId`.
       */
      courses?: string[];
      datasetId?: import("../analysis/types").DataSource;
      datasetVersion?: string;
      datasetName?: string;
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
  completion?: "complete" | "partial";
  failureCode?: string;
  artifacts?: ChatArtifact[];
  citations?: KnowledgeCitation[];
  steps?: AnalysisStep[];
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
  /**
   * Unified result contract (unified-AI roadmap stage 2). `resultRefs` identify
   * every numeric result in `artifacts`; `factRefs` bind prose numbers to those
   * ids. Charts and tables share a `resultId`, so switching the view never
   * changes identity or triggers another query.
   */
  resultRefs?: ResultRef[];
  factRefs?: FactRef[];
  /** Server-generated id correlating every model call made for this request. */
  requestId?: string;
  /** Aggregated model usage/cost for this request, when it called a model. */
  usage?: RequestUsage;
};

export type KnowledgeCitation = {
  id: string;
  title: string;
  version: string;
  source: string;
  scope: "all" | "demo" | "oulad";
  excerpt: string;
};
export type AnalysisStep = {
  id: string;
  label: string;
  status: "running" | "completed" | "failed" | "cancelled";
  durationMs: number;
  summary?: string;
};
export type ChatStreamEvent =
  | { type: "step"; requestId: string; step: AnalysisStep }
  | { type: "result"; requestId: string; response: ChatResponse }
  | { type: "error"; requestId: string; error: string; code: string; retryable: boolean };

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
