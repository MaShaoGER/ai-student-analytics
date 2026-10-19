import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { distributionCountingUnit, type ScoreDistributionData } from "./score-distribution";

/**
 * The roadmap requires that a requested course/term is applied inside the query
 * ("查询与展示范围一致"), not by loading the whole dataset and filtering rows
 * afterwards. These tests use independent fixture numbers so a post-filter and a
 * pushdown can be told apart: the pushdown must also drop groups that would
 * otherwise have been returned.
 */
describe("narrowed score distribution", () => {
  let directory: string;
  let query: typeof import("./duckdb").scoreDistribution;
  beforeAll(async () => {
    directory = mkdtempSync(path.join(tmpdir(), "distribution-scope-"));
    const rows = ["id_student,code_module,code_presentation,score,completed"];
    // 数学 2025J: 4 students, 英语 2025J: 3 students, 数学 2024J: 3 students.
    for (let i = 1; i <= 4; i++) rows.push(`S${i},数学,2025J,${50 + i * 10},1`);
    for (let i = 5; i <= 7; i++) rows.push(`S${i},英语,2025J,${30 + i},1`);
    for (let i = 8; i <= 10; i++) rows.push(`S${i},数学,2024J,${70 + i},1`);
    writeFileSync(path.join(directory, "student_outcomes.csv"), rows.join("\n"));
    writeFileSync(
      path.join(directory, "learning_activity.csv"),
      "id_student,code_module,code_presentation,week,activity_count\nS1,数学,2025J,1,10\n",
    );
    vi.stubEnv("DEMO_DATA_DIR", directory);
    vi.resetModules();
    query = (await import("./duckdb")).scoreDistribution;
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("returns only the requested course and term", async () => {
    const scoped = await query("demo", {}, { course: "数学", term: "2025J" });
    expect(scoped.groups).toHaveLength(1);
    expect(scoped.groups[0]).toMatchObject({ course: "数学", term: "2025J", count: 4 });
    // Same numbers as the full query for that group: narrowing is not a new metric.
    const full = await query("demo");
    const same = full.groups.find((group) => group.course === "数学" && group.term === "2025J");
    expect(scoped.groups[0]).toEqual(same);
  });

  it("keeps unrelated groups out even when only one dimension is pinned", async () => {
    const byCourse = await query("demo", {}, { course: "数学" });
    expect(byCourse.groups.map((group) => `${group.course}/${group.term}`).sort()).toEqual([
      "数学/2024J",
      "数学/2025J",
    ]);
    const byTerm = await query("demo", {}, { term: "2025J" });
    expect(byTerm.groups.map((group) => `${group.course}/${group.term}`).sort()).toEqual([
      "数学/2025J",
      "英语/2025J",
    ]);
  });

  it("treats an empty or blank scope as the full catalog", async () => {
    const full = await query("demo");
    for (const scope of [{}, { course: null, term: null }, { course: "", term: "  " }])
      expect((await query("demo", {}, scope)).groups).toEqual(full.groups);
  });

  it("escapes quotes instead of splicing free text into SQL", async () => {
    // A non-catalog label is simply absent; it must not change the predicate.
    const result = await query("demo", {}, { course: "数学' OR '1'='1", term: "2025J" });
    expect(result.groups).toEqual([]);
    expect((await query("demo", {}, { term: "2025J" })).groups).toHaveLength(2);
  });

  it("still applies the minimum sample threshold inside the scope", async () => {
    const rows = ["id_student,code_module,code_presentation,score,completed"];
    for (let i = 1; i <= 2; i++) rows.push(`S${i},小样本,2025J,60,1`);
    writeFileSync(path.join(directory, "student_outcomes.csv"), rows.join("\n"));
    const result = await query("demo", {}, { course: "小样本", term: "2025J" });
    expect(result.groups).toEqual([]);
    expect(result.minSampleSize).toBe(3);
  });

  it("labels person-terms as 人次 only when terms are mixed", () => {
    const data: ScoreDistributionData = {
      datasetId: "demo",
      minSampleSize: 3,
      groups: [
        { course: "数学", term: "2025J", count: 4, bins: Array(100).fill(0) },
        { course: "数学", term: "2024J", count: 3, bins: Array(100).fill(0) },
      ],
    };
    expect(distributionCountingUnit(data.groups, "2025J")).toBe("人");
    expect(distributionCountingUnit(data.groups, null)).toBe("人次");
    expect(distributionCountingUnit([data.groups[0]], null)).toBe("人");
  });


});
