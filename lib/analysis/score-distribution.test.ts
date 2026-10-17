import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { distributionRows, scoreInterval, type ScoreDistributionGroup } from "./score-distribution";

describe("score distribution from source records", () => {
  let directory: string;
  let query: typeof import("./duckdb").scoreDistribution;
  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "analytics-score-bins-"));
    writeFileSync(
      path.join(directory, "learning_activity.csv"),
      "id_student,code_module,code_presentation,activity_count\nS1,数学,2025J,1\n",
    );
    writeFileSync(
      path.join(directory, "student_outcomes.csv"),
      [
        "id_student,code_module,code_presentation,score,completed",
        "S1,数学,2025J,0,0",
        "S2,数学,2025J,100,1",
        "S3,数学,2025J,59.99,1",
        "S4,数学,2025J,60,1",
        "S5,数学,2025J,80,1",
        "S5,数学,2025J,100,1",
        "S6,数学,2025J,,0",
        "S7,数学,2025J,-1,0",
        "S8,数学,2025J,101,0",
        "S9,数学,2025J,NaN,0",
        "S10,数学,2025J,Infinity,0",
        ",数学,2025J,75,1",
        "S1,数学,2024J,25,0",
        "S2,数学,2024J,35,0",
        "S3,数学,2024J,45,0",
        "S1,小样本,2025J,50,0",
        "S2,小样本,2025J,60,1",
      ].join("\n"),
    );
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.resetModules();
    query = (await import("./duckdb")).scoreDistribution;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("includes zero and full marks, assigns exact boundaries and excludes invalid scores", async () => {
    const result = await query("demo");
    expect(result.groups).toHaveLength(2);
    const latest = result.groups.find((group) => group.term === "2025J")!;
    expect(latest.count).toBe(5);
    expect(latest.bins).toHaveLength(100);
    expect(latest.bins.reduce((a, b) => a + b, 0)).toBe(5);
    for (const index of [0, 59, 60, 90, 99]) expect(latest.bins[index]).toBe(1);
    expect(JSON.stringify(result)).not.toContain("S1");
    expect(result.groups.some((group) => group.course === "小样本")).toBe(false);
  });

  it("keeps separate enrollments across terms and deduplicates within a term", async () => {
    const result = await query("demo");
    const rows = distributionRows(result.groups, "", "", 2);
    expect(rows[0].count).toBe(8);
    expect(rows[0].bins.reduce((a, b) => a + b, 0)).toBe(8);
    expect(distributionRows(result.groups, "2024J", "数学", 5)[0].count).toBe(3);
    expect(distributionRows(result.groups, "2024J", "不存在", 5)).toEqual([]);
  });

  it.each([2, 5, 10] as const)("preserves total counts with %i-point intervals", async (width) => {
    const { groups } = await query("demo");
    const [row] = distributionRows(groups, "2025J", "", width);
    expect(row.bins).toHaveLength(100 / width);
    expect(row.bins.reduce((a, b) => a + b, 0)).toBe(row.count);
    // The 90-point student and the 100-point student share the final 10-point bin.
    expect(row.bins.at(-1)).toBe(width === 10 ? 2 : 1);
    expect(row.bins[60 / width]).toBe(1);
  });

  it("honors cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(query("demo", { signal: controller.signal })).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });
});

describe("distribution labels and filtering", () => {
  it("labels half-open intervals and includes 100 only in the last interval", () => {
    expect(scoreInterval(29, 2)).toBe("58 ≤ 分数 < 60");
    expect(scoreInterval(49, 2)).toBe("98 ≤ 分数 ≤ 100");
  });

  it("adds course histograms without normalizing away different class sizes", () => {
    const group = (course: string, term: string, count: number): ScoreDistributionGroup => ({
      course,
      term,
      count,
      bins: [count, ...Array(99).fill(0)],
    });
    const rows = distributionRows(
      [group("数学", "2025J", 30), group("英语", "2025J", 60), group("数学", "2024J", 50)],
      "2025J",
      "",
      2,
    );
    expect(rows.find((row) => row.course === "数学")?.bins[0]).toBe(30);
    expect(rows.find((row) => row.course === "英语")?.bins[0]).toBe(60);
  });
});
