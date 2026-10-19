import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveAnalysisRecord,
  saveAnalysisAudit,
  loadAnalysisRecords,
  findRecordById,
  analysisRecordContext,
} from "./index";

describe("analysis records", () => {
  let testRoot: string;
  let testRecordsDir: string;

  beforeEach(() => {
    testRoot = fs.mkdtempSync(path.join(tmpdir(), "analytics-records-test-"));
    testRecordsDir = path.join(testRoot, "records");
    vi.stubEnv("ANALYSIS_RECORDS_DIR", testRecordsDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(testRoot, { recursive: true, force: true });
  });

  it("should save and load analysis records", async () => {
    const recordData = {
      datasetId: "demo" as const,
      datasetVersion: "1.0",
      metricId: "score" as const,
      metricVersion: "1.0",
      plan: {
        version: 1 as const,
        datasetId: "demo" as const,
        metric: "score" as const,
        aggregation: "avg" as const,
        dimensions: ["course" as const],
        filters: [],
        sort: { by: "value" as const, direction: "desc" as const },
        limit: 20,
        chartType: "bar" as const,
      },
      result: {
        rowCount: 3,
        period: "demo period",
        durationMs: 100,
      },
      errorCode: null,
      errorMessage: null,
    };

    const id = await saveAnalysisRecord(recordData);
    expect(id).toBeTruthy();
    expect(typeof id).toBe("string");

    const records = loadAnalysisRecords();
    expect(records).toHaveLength(1);
    expect(records[0].id).toBe(id);
    expect(records[0].datasetId).toBe("demo");
    expect(records[0].result.rowCount).toBe(3);
  });

  it("should find record by id", async () => {
    const recordData = {
      datasetId: "demo" as const,
      datasetVersion: "1.0",
      metricId: "activity" as const,
      metricVersion: "1.0",
      plan: {
        version: 1 as const,
        datasetId: "demo" as const,
        metric: "activity" as const,
        aggregation: "sum" as const,
        dimensions: ["term" as const],
        filters: [],
        sort: { by: "value" as const, direction: "desc" as const },
        limit: 20,
        chartType: "line" as const,
      },
      result: {
        rowCount: 2,
        period: "demo period",
        durationMs: 150,
      },
      errorCode: null,
      errorMessage: null,
    };

    const id = await saveAnalysisRecord(recordData);
    const found = findRecordById(id);
    expect(found).toBeTruthy();
    expect(found?.id).toBe(id);
    expect(found?.metricId).toBe("activity");
  });

  it("should return undefined for non-existent id", () => {
    const found = findRecordById("non-existent");
    expect(found).toBeUndefined();
    expect(fs.existsSync(testRecordsDir)).toBe(false);
  });

  it("should handle error records", async () => {
    const errorRecord = {
      datasetId: "oulad" as const,
      datasetVersion: "1.0",
      metricId: null,
      metricVersion: "1.0",
      plan: null,
      result: {
        rowCount: 0,
        period: "",
        durationMs: 0,
      },
      errorCode: "INVALID_PLAN",
      errorMessage: "Plan validation failed",
    };

    const id = await saveAnalysisRecord(errorRecord);
    const records = loadAnalysisRecords();
    expect(records).toHaveLength(1);
    expect(records[0].errorCode).toBe("INVALID_PLAN");
    expect(records[0].errorMessage).toBe("Plan validation failed");
    expect(records[0]).toMatchObject({ datasetId: "oulad", metricId: null, plan: null });
  });

  it("should append multiple records", async () => {
    const baseRecord = {
      datasetId: "demo" as const,
      datasetVersion: "1.0",
      metricId: "score" as const,
      metricVersion: "1.0",
      plan: {
        version: 1 as const,
        datasetId: "demo" as const,
        metric: "score" as const,
        aggregation: "avg" as const,
        dimensions: ["course" as const],
        filters: [],
        sort: { by: "value" as const, direction: "desc" as const },
        limit: 20,
        chartType: "bar" as const,
      },
      result: {
        rowCount: 3,
        period: "demo period",
        durationMs: 100,
      },
      errorCode: null,
      errorMessage: null,
    };

    const id1 = await saveAnalysisRecord(baseRecord);
    const id2 = await saveAnalysisRecord(baseRecord);

    const records = loadAnalysisRecords();
    expect(records).toHaveLength(2);
    expect(records[0].id).toBe(id1);
    expect(records[1].id).toBe(id2);
  });

  it("should include timestamp when saving", async () => {
    const recordData = {
      datasetId: "demo" as const,
      datasetVersion: "1.0",
      metricId: "score" as const,
      metricVersion: "1.0",
      plan: {
        version: 1 as const,
        datasetId: "demo" as const,
        metric: "score" as const,
        aggregation: "avg" as const,
        dimensions: ["course" as const],
        filters: [],
        sort: { by: "value" as const, direction: "desc" as const },
        limit: 20,
        chartType: "bar" as const,
      },
      result: {
        rowCount: 3,
        period: "demo period",
        durationMs: 100,
      },
      errorCode: null,
      errorMessage: null,
    };

    const now = new Date();
    await saveAnalysisRecord(recordData);
    const records = loadAnalysisRecords();
    expect(records).toHaveLength(1);
    expect(records[0].timestamp).toBeTruthy();
    const recordTime = new Date(records[0].timestamp);
    expect(recordTime.getTime()).toBeGreaterThanOrEqual(now.getTime() - 1000);
    expect(recordTime.getTime()).toBeLessThanOrEqual(new Date().getTime() + 1000);
  });

  it("extracts only verified context from invalid input", () => {
    expect(analysisRecordContext({ datasetId: "oulad", metric: "unsupported", password: "secret" }))
      .toEqual({ datasetId: "oulad", metricId: null, plan: null });
    expect(analysisRecordContext({ datasetId: "../private.csv", metric: "activity" }))
      .toEqual({ datasetId: null, metricId: "activity", plan: null });
    expect(analysisRecordContext(null)).toEqual({ datasetId: null, metricId: null, plan: null });
  });

  it("strips credentials and unrecognized properties from a validated stored plan", async () => {
    const verifiedPlan = {
      version: 1 as const, datasetId: "oulad" as const, metric: "activity" as const,
      aggregation: "sum" as const, dimensions: ["term" as const], filters: [],
      sort: { by: "value" as const, direction: "desc" as const }, limit: 20, chartType: "line" as const,
    };
    const record = {
      datasetId: "oulad" as const, datasetVersion: "1.0", metricId: "activity" as const, metricVersion: "1.0",
      plan: { ...verifiedPlan, apiKey: "secret-key", password: "secret-password" },
      result: { rowCount: 1, period: "period", durationMs: 1, rows: [{ id_student: "private-student" }] },
      errorCode: null, errorMessage: null, userId: "opaque-user-id", requestSource: "analysis" as const,
      question: "private-question", username: "private-username", apiKey: "secret-key",
    };
    await saveAnalysisRecord(record);
    const stored = loadAnalysisRecords()[0];
    expect(stored).toMatchObject({ plan: verifiedPlan, userId: "opaque-user-id", requestSource: "analysis" });
    const json = fs.readFileSync(path.join(testRecordsDir, "analysis.jsonl"), "utf8");
    for (const privateText of ["secret-key", "secret-password", "private-student", "private-question", "private-username"]) expect(json).not.toContain(privateText);
  });

  it("loads old records without assigning them to a current user", () => {
    fs.mkdirSync(testRecordsDir, { recursive: true });
    const legacy = {
      id: "legacy", timestamp: "2026-01-01T00:00:00.000Z", datasetId: "demo", metricId: "score",
      datasetVersion: "1.0", metricVersion: "1.0", plan: {},
      result: { rowCount: 0, period: "", durationMs: 0 }, errorCode: "INVALID_PLAN", errorMessage: "invalid",
    };
    fs.writeFileSync(path.join(testRecordsDir, "analysis.jsonl"), `${JSON.stringify(legacy)}\n`);
    expect(loadAnalysisRecords()).toEqual([{ ...legacy, plan: null }]);
    expect(findRecordById("legacy")?.userId).toBeUndefined();
  });

  it("validates requestId and usage instead of persisting malformed AI metadata", async () => {
    const base = {
      datasetId: "demo" as const,
      metricId: "score" as const,
      plan: null,
      userId: "user-1",
      requestSource: "ask" as const,
      stage: "execution" as const,
      promptVersion: "test",
      model: "fixture",
      result: { rowCount: 0, period: "", durationMs: 1 },
      errorCode: null,
      errorMessage: null,
    };
    const validUsage = {
      modelCalls: 2,
      promptTokens: 100,
      completionTokens: 20,
      totalTokens: 120,
      costUsd: 0.001,
      estimated: false,
    };
    // Malformed shapes are dropped, not thrown.
    await saveAnalysisAudit({
      ...base,
      requestId: "bad id!",
      usage: { ...validUsage, modelCalls: -1 },
    });
    let records = loadAnalysisRecords();
    expect(records[0].requestId).toBeUndefined();
    expect(records[0].usage).toBeUndefined();
    // Valid shapes are persisted for request-level tracing.
    await saveAnalysisAudit({
      ...base,
      requestId: "11111111-1111-4111-8111-111111111111",
      usage: validUsage,
    });
    records = loadAnalysisRecords();
    expect(records[1]).toMatchObject({
      requestId: "11111111-1111-4111-8111-111111111111",
      usage: validUsage,
    });
  });
});
