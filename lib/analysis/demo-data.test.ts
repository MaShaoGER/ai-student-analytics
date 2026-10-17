import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import summary from "../../data/sample/summary.json";
import { withBoundedQueryConnection } from "../security/query-execution";
import { API_QUERY_LIMITS } from "../security/query-limits";
import { GOLDEN_CASES } from "./golden-cases";
import { createPlan } from "./plan";

describe("expanded fictional demo dataset", () => {
  let runAnalysis: typeof import("./duckdb").runAnalysis;
  let profileDatasets: typeof import("./duckdb").profileDatasets;

  beforeAll(async () => {
    vi.stubEnv("DEMO_DATA_DIR", "data/sample");
    ({ runAnalysis, profileDatasets } = await import("./duckdb"));
  });
  afterAll(() => vi.unstubAllEnvs());

  it("keeps enrollments, weekly facts and valid value ranges consistent", async () => {
    const [stats] = await withBoundedQueryConnection(
      (sql) =>
        sql(`
      WITH outcomes AS (SELECT * FROM read_csv_auto('data/sample/student_outcomes.csv')),
      activities AS (SELECT * FROM read_csv_auto('data/sample/learning_activity.csv')),
      weeks AS (
        SELECT id_student, code_module, code_presentation, COUNT(*) AS rows,
               COUNT(DISTINCT week) AS weeks, MIN(week) AS first_week, MAX(week) AS last_week
        FROM activities GROUP BY ALL
      )
      SELECT
        (SELECT COUNT(*) FROM outcomes) AS outcomes,
        (SELECT COUNT(*) FROM activities) AS activities,
        (SELECT COUNT(DISTINCT id_student) FROM outcomes) AS students,
        (SELECT COUNT(DISTINCT code_module) FROM outcomes) AS courses,
        (SELECT COUNT(DISTINCT code_presentation) FROM outcomes) AS terms,
        (SELECT COUNT(*) FROM (
          SELECT id_student, code_module, code_presentation FROM outcomes GROUP BY ALL HAVING COUNT(*) <> 1
        )) AS duplicate_outcomes,
        (SELECT COUNT(*) FROM outcomes o FULL OUTER JOIN weeks w USING (id_student, code_module, code_presentation)
         WHERE o.id_student IS NULL OR w.id_student IS NULL OR w.rows <> 16 OR w.weeks <> 16
           OR w.first_week <> 1 OR w.last_week <> 16) AS broken_enrollments,
        (SELECT COUNT(*) FROM outcomes WHERE score IS NULL OR score < 0 OR score > 100
           OR completed IS NULL OR completed NOT IN (0, 1)) AS invalid_outcomes,
        (SELECT COUNT(*) FROM activities WHERE activity_count IS NULL OR activity_count < 0
           OR activity_count <> FLOOR(activity_count)) AS invalid_activities,
        (SELECT COUNT(*) FROM outcomes WHERE score = 0 AND completed = 0) AS zero_scores,
        (SELECT COUNT(*) FROM outcomes WHERE score = 100 AND completed = 1) AS perfect_scores,
        (SELECT COUNT(*) FROM outcomes WHERE score < 60 AND completed = 1) AS completed_below_pass,
        (SELECT COUNT(*) FROM activities WHERE activity_count = 0) AS zero_activities
    `),
      API_QUERY_LIMITS.profile,
    );
    const counts = Object.fromEntries(
      Object.entries(stats).map(([key, value]) => [key, Number(value)]),
    );
    expect(counts).toMatchObject({
      outcomes: 14400,
      activities: 230400,
      students: 1200,
      courses: 18,
      terms: 4,
      duplicate_outcomes: 0,
      broken_enrollments: 0,
      invalid_outcomes: 0,
      invalid_activities: 0,
    });
    for (const key of [
      "zero_scores",
      "perfect_scores",
      "completed_below_pass",
      "zero_activities",
    ]) {
      expect(counts[key]).toBeGreaterThan(0);
    }
  });

  it("covers the added subjects in every term with three distinct courses per student", async () => {
    const rows = await withBoundedQueryConnection(
      (sql) =>
        sql(`
        SELECT code_module AS course, code_presentation AS term,
               COUNT(DISTINCT id_student) AS students
        FROM read_csv_auto('data/sample/student_outcomes.csv') GROUP BY ALL
      `),
      API_QUERY_LIMITS.profile,
    );
    expect(rows).toHaveLength(18 * 4);
    expect(new Set(rows.map((row) => row.course)).size).toBe(18);
    for (const course of [
      "大学语文",
      "大学英语",
      "线性代数",
      "大学物理",
      "体育与健康",
      "人工智能基础",
      "软件工程",
      "信息安全基础",
    ]) {
      expect(
        rows
          .filter((row) => row.course === course)
          .map((row) => row.term)
          .sort(),
      ).toEqual([...summary.terms].sort());
    }
    for (const row of rows) expect(Number(row.students)).toBeGreaterThanOrEqual(199);
    const [enrollments] = await withBoundedQueryConnection(
      (sql) =>
        sql(`
        SELECT COUNT(*) AS invalid FROM (
          SELECT id_student, code_presentation
          FROM read_csv_auto('data/sample/student_outcomes.csv')
          GROUP BY ALL HAVING COUNT(DISTINCT code_module) <> 3
        )
      `),
      API_QUERY_LIMITS.profile,
    );
    expect(Number(enrollments.invalid)).toBe(0);
  });

  it.each(GOLDEN_CASES)(
    "$id queries the expanded source and matches independent aggregates",
    async (goldenCase) => {
      const { result } = await runAnalysis(goldenCase.expectedPlan);
      const key =
        `${goldenCase.expectedPlan.metric}_${goldenCase.expectedPlan.dimensions[0]}` as keyof typeof summary.expectedRows;
      expect(result.rows).toEqual(
        summary.expectedRows[key].map(([dimension, value, sampleSize]) => ({
          dimension,
          value,
          sampleSize,
        })),
      );
      expect(result.query).toContain("./data/sample/");
      expect(result.period).not.toContain("1–3");
    },
  );

  it("filters a named course and term and retains the distinct-student sample", async () => {
    const { result } = await runAnalysis({
      ...createPlan({
        datasetId: "demo",
        metric: "score",
        dimension: "course",
        chartType: "table",
      }),
      dimensions: ["course", "term"],
      filters: [
        { field: "course", op: "eq", value: "高等数学" },
        { field: "term", op: "eq", value: "2025J" },
      ],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ dimension: "高等数学 / 2025J", sampleSize: 200 });
    expect(result.rows[0].value).toBeGreaterThan(0);
    expect(result.rows[0].value).toBeLessThan(100);
  });

  it("reports the expanded file sizes and complete field coverage", async () => {
    const demo = (await profileDatasets()).find((dataset) => dataset.id === "demo")!;
    expect(demo.available).toBe(true);
    expect(Object.fromEntries(demo.tables.map((table) => [table.name, table.rows]))).toEqual(
      summary.tables,
    );
    const nullableFields = new Set([
      "average_homework_score",
      "submitted_date",
      "assignment_score",
    ]);
    expect(
      demo.tables.every((table) =>
        table.fields?.every((field) => nullableFields.has(field.name) || field.missing === 0),
      ),
    ).toBe(true);
    expect(demo.tables.find((table) => table.name === "student_outcomes")?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "attendance_rate", missing: 0 }),
        expect.objectContaining({ name: "homework_completion_rate", missing: 0 }),
      ]),
    );
    const [missing] = await withBoundedQueryConnection(
      (sql) =>
        sql(`SELECT
      (SELECT COUNT(*) FROM read_csv_auto('data/sample/student_outcomes.csv')
        WHERE average_homework_score IS NULL) AS outcome_average,
      (SELECT COUNT(*) FROM read_csv_auto('data/sample/student_term_summary.csv')
        WHERE average_homework_score IS NULL) AS term_average,
      (SELECT COUNT(*) FROM read_csv_auto('data/sample/assignment_submissions.csv')
        WHERE submission_status = '未交') AS unsubmitted
    `),
      API_QUERY_LIMITS.profile,
    );
    for (const [tableName, fieldName, type, count] of [
      ["student_outcomes", "average_homework_score", "DOUBLE", Number(missing.outcome_average)],
      ["student_term_summary", "average_homework_score", "DOUBLE", Number(missing.term_average)],
      ["assignment_submissions", "submitted_date", "DATE", Number(missing.unsubmitted)],
      ["assignment_submissions", "assignment_score", "DOUBLE", Number(missing.unsubmitted)],
    ] as const) {
      expect(count).toBeGreaterThan(0);
      expect(demo.tables.find((table) => table.name === tableName)?.fields).toContainEqual({
        name: fieldName,
        type,
        missing: count,
      });
    }
    expect(demo.description).not.toContain("9 名");
  });
});
