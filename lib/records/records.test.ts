import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { saveAnalysisRecord, loadAnalysisRecords, findRecordById } from "./index";
import type { AnalysisRecord } from "../analysis/types";

describe("analysis records", () => {
  const testRecordsDir = path.join(process.cwd(), "records");

  beforeEach(() => {
    // Clean test records file before each test
    const recordsFile = path.join(testRecordsDir, "analysis.jsonl");
    if (fs.existsSync(recordsFile)) {
      fs.unlinkSync(recordsFile);
    }
  });

  afterEach(() => {
    // Clean up after tests
    const recordsFile = path.join(testRecordsDir, "analysis.jsonl");
    if (fs.existsSync(recordsFile)) {
      fs.unlinkSync(recordsFile);
    }
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
  });

  it("should handle error records", async () => {
    const errorRecord = {
      datasetId: "demo" as const,
      datasetVersion: "1.0",
      metricId: "score" as const,
      metricVersion: "1.0",
      plan: {} as any,
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
});
