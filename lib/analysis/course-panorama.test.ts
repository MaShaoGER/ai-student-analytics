import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("course panorama shared cohorts", () => {
  let directory: string;
  let query: typeof import("./duckdb").coursePanorama;
  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "analytics-panorama-"));
    writeFileSync(
      path.join(directory, "learning_activity.csv"),
      "id_student,code_module,code_presentation,activity_count\nS1,A,2025J,1\n",
    );
    const rows = [
      "id_student,code_module,code_presentation,score,completed",
      "S1,A,2025J,0,0",
      "S1,B,2025J,10,0",
      "S1,C,2025J,80,1",
      "S2,A,2025J,59.99,0",
      "S2,B,2025J,59.99,0",
      "S2,C,2025J,100,1",
      "S3,A,2025J,50,0",
      "S3,A,2025J,70,1",
      "S3,B,2025J,20,0",
      "S3,C,2025J,60,1",
      "S4,A,2025J,60,1",
      "S4,B,2025J,40,0",
      "S4,C,2025J,50,0",
      "S5,A,2025J,100,1",
      "S5,B,2025J,50,0",
      "S5,C,2025J,0,0",
      "S6,A,2025J,20,0",
      "S6,B,2025J,0,0",
      "S7,A,2025J,40,0",
      "S7,B,2025J,,0",
      "S7,C,2025J,80,1",
      "S8,A,2025J,40,0",
      "S8,B,2024J,20,0",
      "S9,A,2025J,NaN,0",
      "S9,B,2025J,10,0",
      "S10,A,2025J,101,0",
      "S11,A,2025J,-1,0",
      "S12,A,2025J,Infinity,0",
      ",A,2025J,10,0",
      "S1,,2025J,10,0",
      "S1,A,,10,0",
      "S1,small,2025J,10,0",
      "S2,small,2025J,10,0",
    ];
    for (const student of ["S1", "S2", "S3"]) {
      for (const course of ["A", "B"]) rows.push(`${student},${course},2024J,20,0`);
      for (const course of ["C'quoted", "D"]) rows.push(`${student},${course},2022'J,20,0`);
      for (let i = 0; i < 13; i++)
        rows.push(`${student},C${String(i).padStart(2, "0")},2023J,20,0`);
    }
    writeFileSync(path.join(directory, "student_outcomes.csv"), rows.join("\n"));
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.resetModules();
    query = (await import("./duckdb")).coursePanorama;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns real course distributions, including zero and 100, without invalid or duplicate records", async () => {
    const data = await query({ datasetId: "demo" });
    expect(data.term).toBe("2025J");
    expect(data.totalStudents).toBe(9);
    expect(data.columns.map((c) => c.course)).toEqual(["A", "B", "C"]);
    const a = data.columns[0];
    expect(a.baseline).toMatchObject({ count: 8, mean: 47.5, passRate: 37.5 });
    expect(a.baseline.bins).toHaveLength(20);
    expect(a.baseline.bins[0]).toBe(1);
    expect(a.baseline.bins[12]).toBe(2);
    expect(a.baseline.bins[19]).toBe(1);
    expect(
      data.columns.every((c) => c.baseline.bins.reduce((s, n) => s + n, 0) === c.baseline.count),
    ).toBe(true);
    expect(a.cohort).toEqual(a.baseline);
    expect(data.selection).toBeNull();
    expect(JSON.stringify(data)).not.toMatch(/id_student|S1|NaN|Infinity/);
  });
  it("links every layer to the same strict-threshold student cohort and retains the full reference", async () => {
    const data = await query({ datasetId: "demo", source: "A", target: "B" });
    expect(data.selection).toEqual({ source: "A", target: "B", count: 3, commonCount: 6 });
    expect(data.relations).toEqual([
      { source: "A", target: "B", commonCount: 6, belowCount: 3, rate: 50 },
    ]);
    expect(data.columns[0].cohort).toMatchObject({ count: 3, mean: 26.66, passRate: 0 });
    expect(data.columns[1].cohort).toMatchObject({ count: 3, mean: 23.33, passRate: 0 });
    expect(data.columns[0].cohort?.bins.reduce((s, n) => s + n, 0)).toBe(3);
    expect(data.columns[0].baseline.count).toBe(8);
  });
  it("suppresses a third course with fewer than three cohort scores without inventing zero scores", async () => {
    const data = await query({ datasetId: "demo", source: "B", target: "A" });
    expect(data.selection?.source).toBe("A");
    expect(data.columns[2].baseline.count).toBe(6);
    expect(data.columns[2].cohort).toBeNull();
  });
  it("averages duplicates before filtering and keeps passing fixed at 60", async () => {
    const data = await query({ datasetId: "demo", threshold: 61, source: "A", target: "B" });
    expect(data.selection?.count).toBe(5);
    expect(data.columns[0].cohort).toMatchObject({ count: 5, mean: 40, passRate: 40 });
    expect(data.columns[2].cohort).toMatchObject({ count: 4, mean: 72.5, passRate: 75 });
  });
  it("never joins a student's course scores across terms", async () => {
    const data = await query({ datasetId: "demo", term: "2024J", source: "A", target: "B" });
    expect(data.selection).toMatchObject({ count: 3, commonCount: 3 });
    expect(data.columns[1].baseline.count).toBe(4);
  });
  it("escapes term and course literals, including valid names containing quotes", async () => {
    const data = await query({
      datasetId: "demo",
      term: "2022'J",
      source: "C'quoted",
      target: "D",
    });
    expect(data.selection?.count).toBe(3);
    expect((await query({ datasetId: "demo", term: "' OR 1=1 --" })).columns).toEqual([]);
    await expect(
      query({ datasetId: "demo", source: "A' OR 1=1 --", target: "B" }),
    ).rejects.toMatchObject({ name: "PanoramaSelectionError" });
  });
  it("rejects a suppressed or unavailable relation instead of silently displaying all students", async () => {
    await expect(query({ datasetId: "demo", source: "A", target: "C" })).rejects.toMatchObject({
      name: "PanoramaSelectionError",
    });
    await expect(
      query({ datasetId: "demo", source: "A", target: "B", threshold: 50 }),
    ).rejects.toMatchObject({ name: "PanoramaSelectionError" });
    await expect(
      query({ datasetId: "demo", source: "A", target: "B", term: "missing" }),
    ).rejects.toMatchObject({ name: "PanoramaSelectionError" });
    expect((await query({ datasetId: "demo", threshold: 1 })).columns).toHaveLength(3);
  });
  it("bounds the graph and all layers to twelve deterministic courses", async () => {
    const data = await query({ datasetId: "demo", term: "2023J" });
    expect(data.totalCourses).toBe(13);
    expect(data.columns).toHaveLength(12);
    expect(data.columns.at(-1)?.course).toBe("C11");
    expect(data.relations).toHaveLength(66);
    expect(data.totalStudents).toBe(3);
  });
  it("validates partial and self pairs, and honors cancellation", async () => {
    await expect(query({ datasetId: "demo", source: "A" })).rejects.toMatchObject({
      name: "ZodError",
    });
    await expect(query({ datasetId: "demo", source: "A", target: "A" })).rejects.toMatchObject({
      name: "ZodError",
    });
    const controller = new AbortController();
    controller.abort();
    await expect(query({ datasetId: "demo" }, { signal: controller.signal })).rejects.toMatchObject(
      { code: "CANCELLED" },
    );
  });
});
