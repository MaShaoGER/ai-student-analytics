import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { visibleRelations } from "./course-relations";

describe("course relations from deduplicated student scores", () => {
  let directory: string;
  let query: typeof import("./duckdb").courseRelations;
  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "analytics-course-relations-"));
    writeFileSync(
      path.join(directory, "learning_activity.csv"),
      "id_student,code_module,code_presentation,activity_count\nS1,A,2025J,1\n",
    );
    const rows = [
      "id_student,code_module,code_presentation,score,completed",
      "S1,A,2025J,0,0",
      "S1,B,2025J,10,0",
      "S2,A,2025J,59.99,0",
      "S2,B,2025J,59.99,0",
      "S3,A,2025J,50,0",
      "S3,A,2025J,70,1",
      "S3,B,2025J,20,0",
      "S4,A,2025J,60,1",
      "S4,B,2025J,40,0",
      "S5,A,2025J,100,1",
      "S5,B,2025J,50,0",
      "S6,A,2025J,20,0",
      "S6,B,2025J,0,0",
      "S7,A,2025J,40,0",
      "S7,B,2025J,,0",
      "S8,A,2025J,40,0",
      "S8,B,2024J,20,0",
      "S9,A,2025J,NaN,0",
      "S9,B,2025J,10,0",
      "S10,A,2025J,-1,0",
      "S11,A,2025J,101,0",
      "S12,A,2025J,Infinity,0",
      ",A,2025J,10,0",
      "S1,,2025J,10,0",
      "S1,A,,10,0",
      "S1,small,2025J,10,0",
      "S2,small,2025J,10,0",
    ];
    for (const student of ["S1", "S2", "S3"]) {
      for (const course of ["A", "B"]) rows.push(`${student},${course},2024'J,20,0`);
      for (let index = 0; index < 13; index++)
        rows.push(`${student},C${String(index).padStart(2, "0")},2023J,20,0`);
    }
    writeFileSync(path.join(directory, "student_outcomes.csv"), rows.join("\n"));
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.resetModules();
    query = (await import("./duckdb")).courseRelations;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("uses the latest eligible term and matches only students with both valid scores", async () => {
    const result = await query({ datasetId: "demo" });
    expect(result.term).toBe("2025J");
    expect(result.threshold).toBe(60);
    expect(result.courses).toEqual([
      { name: "A", count: 8 },
      { name: "B", count: 7 },
    ]);
    expect(result.relations).toEqual([
      { source: "A", target: "B", commonCount: 6, belowCount: 3, rate: 50 },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/id_student|S1|NaN|Infinity/);
  });
  it("averages duplicates before testing a strict threshold", async () => {
    const result = await query({ datasetId: "demo", threshold: 61 });
    expect(result.relations[0]).toMatchObject({ belowCount: 5, commonCount: 6, rate: 83.33 });
  });
  it("suppresses small co-occurrence counts rather than exposing one or two students", async () => {
    const result = await query({ datasetId: "demo", threshold: 50 });
    expect(result.courses).toHaveLength(2);
    expect(result.relations).toEqual([]);
  });
  it("escapes term literals and never joins enrollments across terms", async () => {
    const result = await query({ datasetId: "demo", term: "2024'J" });
    expect(result.relations[0]).toMatchObject({ commonCount: 3, belowCount: 3, rate: 100 });
    expect((await query({ datasetId: "demo", term: "2024J" })).relations).toEqual([]);
    expect((await query({ datasetId: "demo", term: "' OR 1=1 --" })).courses).toEqual([]);
  });
  it("bounds the join to twelve deterministic courses and returns each unordered pair once", async () => {
    const result = await query({ datasetId: "demo", term: "2023J" });
    expect(result.totalCourses).toBe(13);
    expect(result.courses).toHaveLength(12);
    expect(result.courses.at(-1)?.name).toBe("C11");
    expect(result.relations).toHaveLength(66);
    expect(new Set(result.relations.map((r) => `${r.source}/${r.target}`)).size).toBe(66);
    expect(result.relations.every((r) => r.source < r.target && r.belowCount === 3)).toBe(true);
  });
  it("filters and ranks relationships without changing their denominators", async () => {
    const result = await query({ datasetId: "demo", term: "2023J" });
    expect(visibleRelations(result.relations, "C00")).toHaveLength(11);
    expect(visibleRelations(result.relations, "C00").every((r) => r.commonCount === 3)).toBe(true);
    expect(visibleRelations(result.relations, "missing")).toEqual([]);
  });
  it("honors cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(query({ datasetId: "demo" }, { signal: controller.signal })).rejects.toMatchObject(
      { code: "CANCELLED" },
    );
  });
});
