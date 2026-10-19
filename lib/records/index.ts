import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  analysisPlanSchema,
  dataSourceSchema,
  metricSchema,
  type AnalysisRecord,
} from "../analysis/types";

type RecordInput = Omit<AnalysisRecord, "id" | "timestamp">;
export type AnalysisRecordContext = Pick<RecordInput, "datasetId" | "metricId" | "plan">;

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
    executionSteps: record.executionSteps?.filter((step) => ["catalog", "decision", "aggregate", "compare_terms", "score_distribution", "absence_stats", "search_knowledge", "advanced_chart", "clarify", "validate"].includes(step.operation)).slice(0, 24).map((step) => ({
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
      | "userId"
      | "requestSource"
      | "stage"
      | "result"
      | "errorCode"
      | "errorMessage"
      | "promptVersion"
      | "model"
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
