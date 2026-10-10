import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AIClarificationError, planQuestion } from "../ai/planner";
import { createPlan } from "./plan";

const basePlan = createPlan({
  datasetId: "demo",
  metric: "score",
  dimension: "course",
  chartType: "bar",
});

describe("MVP boundary cases (B01–B10)", () => {
  let fixtureRoot: string;
  let runAnalysis: typeof import("./duckdb").runAnalysis;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "student-analytics-boundary-"));
    const sampleDir = path.join(fixtureRoot, "data", "sample");
    await mkdir(sampleDir, { recursive: true });
    // Isolated synthetic data: one group at the threshold, one below it,
    // and one with a quoted name. No live project data is changed.
    await writeFile(
      path.join(sampleDir, "student_outcomes.csv"),
      [
        "id_student,code_module,code_presentation,score,completed",
        "S001,AAA,2024J,86,1",
        "S002,AAA,2024J,61,1",
        "S003,AAA,2024J,92,1",
        "S004,SMALL,2024J,60,0",
        "S005,SMALL,2024J,70,1",
        "S006,O'NEIL,2024J,80,1",
        "S007,O'NEIL,2024J,80,1",
        "S008,O'NEIL,2024J,80,1",
      ].join("\n") + "\n",
    );
    await writeFile(
      path.join(sampleDir, "learning_activity.csv"),
      [
        "id_student,code_module,code_presentation,week,activity_count",
        "S001,AAA,2024J,1,10",
        "S002,AAA,2024J,1,10",
        "S003,AAA,2024J,1,10",
        "S004,SMALL,2024J,1,10",
        "S004,SMALL,2024J,2,10",
        "S005,SMALL,2024J,1,10",
        "S005,SMALL,2024J,2,10",
      ].join("\n") + "\n",
    );
    // DuckDB fixes its controlled data paths at import time. Redirect that
    // import to the fixture, then immediately restore cwd for the test runner.
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);
    try {
      runAnalysis = (await import("./duckdb")).runAnalysis;
    } finally {
      cwd.mockRestore();
    }
  });

  afterAll(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  it("B01 rejects a client file path as the dataset ID", async () => {
    await expect(
      runAnalysis({ ...basePlan, datasetId: "../../private.csv" }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it("B02 rejects metrics, dimensions and chart types outside the whitelist", async () => {
    for (const invalid of [
      { metric: "risk" },
      { dimensions: ["id_student"] },
      { chartType: "pie" },
    ]) {
      await expect(runAnalysis({ ...basePlan, ...invalid })).rejects.toBeInstanceOf(z.ZodError);
    }
  });

  it("B03 rejects an aggregation that changes the metric meaning", async () => {
    await expect(runAnalysis({ ...basePlan, aggregation: "sum" })).rejects.toBeInstanceOf(
      z.ZodError,
    );
  });

  it("B04 rejects repeated grouping dimensions", async () => {
    await expect(
      runAnalysis({ ...basePlan, dimensions: ["course", "course"] }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });

  it("B05 rejects limits outside the bounded integer range", async () => {
    for (const limit of [0, 101, 1.5]) {
      await expect(runAnalysis({ ...basePlan, limit })).rejects.toBeInstanceOf(z.ZodError);
    }
  });

  it("B06 rejects illegal filter fields, operators and value shapes", async () => {
    for (const filter of [
      { field: "id_student", op: "eq", value: "S001" },
      { field: "course", op: "like", value: "AAA" },
      { field: "course", op: "eq", value: ["AAA", "BBB"] },
      { field: "course", op: "in", value: "AAA" },
      { field: "course", op: "in", value: [] },
      { field: "course", op: "eq", value: "" },
    ]) {
      await expect(runAnalysis({ ...basePlan, filters: [filter] })).rejects.toBeInstanceOf(
        z.ZodError,
      );
    }
  });

  it("B07 treats an injection string as a literal and returns a valid empty result", async () => {
    const { result } = await runAnalysis({
      ...basePlan,
      filters: [{ field: "course", op: "eq", value: "AAA') OR 1=1 --" }],
    });
    expect(result.rows).toEqual([]);
    const quoted = await runAnalysis({
      ...basePlan,
      filters: [{ field: "course", op: "eq", value: "O'NEIL" }],
    });
    expect(quoted.result.rows).toEqual([{ dimension: "O'NEIL", value: 80, sampleSize: 3 }]);
  });

  it("B08 suppresses groups below three distinct students, including repeated activity rows", async () => {
    const score = await runAnalysis(basePlan);
    expect(score.result.rows).not.toContainEqual(expect.objectContaining({ dimension: "SMALL" }));
    expect(score.result.rows).toContainEqual({ dimension: "AAA", value: 79.67, sampleSize: 3 });
    const completion = await runAnalysis({
      ...basePlan,
      metric: "completion_rate",
      aggregation: "rate",
    });
    expect(completion.result.rows).not.toContainEqual(
      expect.objectContaining({ dimension: "SMALL" }),
    );
    expect(completion.result.rows).toContainEqual({ dimension: "AAA", value: 100, sampleSize: 3 });
    const activity = await runAnalysis({ ...basePlan, metric: "activity", aggregation: "sum" });
    expect(activity.result.rows).toEqual([{ dimension: "AAA", value: 30, sampleSize: 3 }]);
  });

  it("B09 reports missing dataset files without querying", async () => {
    // The isolated fixture intentionally contains no OULAD files.
    await expect(runAnalysis({ ...basePlan, datasetId: "oulad" })).rejects.toThrow(
      "数据源 oulad 不可用",
    );
  });

  it("B10 requires clarification for an ambiguous question instead of producing a plan", async () => {
    const generator = vi.fn(async () => ({
      canAnalyze: false,
      metric: "score" as const,
      dimension: "course" as const,
      chartType: "bar" as const,
      rationale: "问题没有明确指标口径。",
      clarificationQuestion: "你想比较平均成绩、活跃次数还是完成率？",
    }));
    await expect(
      planQuestion({ question: "哪个课程最好？", datasetId: "demo" }, generator),
    ).rejects.toBeInstanceOf(AIClarificationError);
    expect(generator).toHaveBeenCalledOnce();
  });
});
