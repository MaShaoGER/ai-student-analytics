import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  analysisPlanSchema,
  dataSourceSchema,
  metricSchema,
  type AnalysisRecord,
} from "../analysis/types";
import type { RequestUsage } from "../security/ai-cost";

type RecordInput = Omit<AnalysisRecord, "id" | "timestamp">;
export type AnalysisRecordContext = Pick<RecordInput, "datasetId" | "metricId" | "plan">;

/** Request ids are server-generated UUIDs; accept UUID-ish opaque ids only. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
/** Upper bounds keep a hostile or buggy caller from persisting absurd usage. */
const MAX_MODEL_CALLS = 10_000;
const MAX_TOKEN_COUNT = 1_000_000_000;
const MAX_COST_USD = 10_000;

/** Keep only a plausible request id; anything else is dropped, never thrown. */
export function storedRequestId(value: unknown): string | undefined {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value) ? value : undefined;
}

/**
 * Keep only a fully numeric, finite, non-negative usage summary. Invalid shapes
 * are dropped instead of throwing: an audit row must never fail to persist
 * because of a malformed usage object.
 */
export function storedUsage(value: unknown): RequestUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const fields = value as Record<string, unknown>;
  const modelCalls = fields.modelCalls;
  const promptTokens = fields.promptTokens;
  const completionTokens = fields.completionTokens;
  const totalTokens = fields.totalTokens;
  const costUsd = fields.costUsd;
  const estimated = fields.estimated;
  if (
    typeof modelCalls !== "number" ||
    !Number.isInteger(modelCalls) ||
    modelCalls < 0 ||
    modelCalls > MAX_MODEL_CALLS ||
    typeof promptTokens !== "number" ||
    !Number.isFinite(promptTokens) ||
    promptTokens < 0 ||
    promptTokens > MAX_TOKEN_COUNT ||
    typeof completionTokens !== "number" ||
    !Number.isFinite(completionTokens) ||
    completionTokens < 0 ||
    completionTokens > MAX_TOKEN_COUNT ||
    typeof totalTokens !== "number" ||
    !Number.isFinite(totalTokens) ||
    totalTokens < 0 ||
    totalTokens > MAX_TOKEN_COUNT ||
    typeof costUsd !== "number" ||
    !Number.isFinite(costUsd) ||
    costUsd < 0 ||
    costUsd > MAX_COST_USD ||
    typeof estimated !== "boolean"
  )
    return undefined;
  return { modelCalls, promptTokens, completionTokens, totalTokens, costUsd, estimated };
}

/** Preserve only validated context; never persist an untrusted request or question. */
export function analysisRecordContext(input: unknown): AnalysisRecordContext {
  const plan = analysisPlanSchema.safeParse(input);
  if (plan.success) {
    return { datasetId: plan.data.datasetId, metricId: plan.data.metric, plan: plan.data };
  }
  const fields = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
  const dataset = dataSourceSchema.safeParse(fields.datasetId);
  const metric = metricSchema.safeParse(fields.metric);
  return {
    datasetId: dataset.success ? dataset.data : null,
    metricId: metric.success ? metric.data : null,
    plan: null,
  };
}

function recordsDirectory(): string {
  // Runtime records belong to the mounted state directory, never the build bundle.
  return path.resolve(/* turbopackIgnore: true */ process.env.ANALYSIS_RECORDS_DIR?.trim() || path.join(process.cwd(), "records"));
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

export async function saveAnalysisRecord(record: RecordInput): Promise<string> {
  const id = generateId();
  const timestamp = new Date().toISOString();
  const completeRecord: AnalysisRecord = {
    id,
    timestamp,
    ...(["success", "partial", "failure"].includes(record.outcome ?? "") ? { outcome: record.outcome } : {}),
    datasetId: record.datasetId,
    datasetVersion: record.datasetVersion,
    metricId: record.metricId,
    metricVersion: record.metricVersion,
    // Zod strips unknown fields such as credentials accidentally attached by a caller.
    plan: analysisRecordContext(record.plan).plan,
    userId: record.userId,
    requestSource: record.requestSource,
    stage: record.stage,
    // Prompt version and model make AI failures reproducible without storing text.
    promptVersion: record.promptVersion,
    model: record.model ?? null,
    // Request correlation and aggregated usage are validated and bounded; the
    // question/answer text and raw rows are still never persisted.
    requestId: storedRequestId(record.requestId),
    usage: storedUsage(record.usage),
    executionSteps: record.executionSteps?.filter((step) => ["catalog", "decision", "aggregate", "compare_terms", "score_distribution", "absence_stats", "search_knowledge", "advanced_chart", "clarify", "validate", "compose_retry"].includes(step.operation)).slice(0, 24).map((step) => ({
      operation: step.operation,
      status: ["running", "completed", "failed", "cancelled"].includes(step.status) ? step.status : "failed",
      durationMs: Number.isFinite(step.durationMs) ? Math.max(0, Math.round(step.durationMs)) : 0,
    })),
    result: {
      rowCount: record.result.rowCount,
      period: record.result.period,
      durationMs: record.result.durationMs,
    },
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
  };
  try {
    const directory = recordsDirectory();
    mkdirSync(directory, { recursive: true });
    appendFileSync(path.join(directory, "analysis.jsonl"), JSON.stringify(completeRecord) + "\n", "utf-8");
    return id;
  } catch (error) {
    console.error("Failed to save analysis record");
    throw new Error("Failed to persist analysis record");
  }
}

/** Audit failures must not hide a successful result or the original API error. */
export async function saveAnalysisAudit(
  record: AnalysisRecordContext &
    Pick<
      RecordInput,
      | "outcome"
      | "userId"
      | "requestSource"
      | "stage"
      | "result"
      | "errorCode"
      | "errorMessage"
      | "promptVersion"
      | "model"
      | "requestId"
      | "usage"
      | "executionSteps"
    >,
): Promise<void> {
  try {
    await saveAnalysisRecord({ datasetVersion: "1.0", metricVersion: "1.0", ...record });
  } catch {
    // Whole errors can include request details or credentials from upstream services.
    console.warn("Warning: failed to save analysis audit record");
  }
}

export function loadAnalysisRecords(): AnalysisRecord[] {
  try {
    const content = readFileSync(/* turbopackIgnore: true */ path.join(recordsDirectory(), "analysis.jsonl"), "utf-8");
    return content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        const record = JSON.parse(line) as AnalysisRecord;
        // Earlier failure records used {} as a fake plan. Expose an honest unknown value.
        return { ...record, plan: analysisRecordContext(record.plan).plan };
      });
  } catch (error) {
    // File may not exist yet or be empty
    return [];
  }
}

export function findRecordById(id: string): AnalysisRecord | undefined {
  const records = loadAnalysisRecords();
  return records.find((r) => r.id === id);
}
