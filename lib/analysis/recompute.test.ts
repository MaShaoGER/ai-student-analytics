import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scoreDistribution } from "./duckdb";
import { distributionRows } from "./score-distribution";

/**
 * Independent recomputation from the raw CSVs (roadmap §7: "数字可由原始数据复算").
 * This deliberately does not import the DuckDB query builder: it parses the
 * public sample files itself, so a SQL regression cannot hide behind shared code.
 */
/**
 * `DEMO_DATA_DIR` selects the fixture the query layer reads; recomputation must
 * read the same directory or it would validate a different dataset.
 */
const DATA_ROOT = process.env.DEMO_DATA_DIR ?? join("data", "sample");

function csv(file: string): Record<string, string>[] {
  const text = readFileSync(join(DATA_ROOT, file), "utf8").replace(/^\uFEFF/u, "");
  const lines = text.split(/\r?\n/u).filter((line) => line.trim());
  const header = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cells = line.split(",");
    return Object.fromEntries(header.map((key, index) => [key, cells[index] ?? ""]));
  });
}

describe("distribution numbers agree with an independent CSV recomputation", () => {
  it("matches exact per-course-term counts and mean scores", async () => {
    const outcomes = csv("student_outcomes.csv");
    // Deduplicate per student-course-term and average, exactly like the source CTE.
    const scores = new Map<string, number[]>();
    for (const row of outcomes) {
      const score = Number(row.score);
      if (!Number.isFinite(score) || score < 0 || score > 100) continue;
      if (!row.id_student || !row.code_module || !row.code_presentation) continue;
      const key = `${row.code_module}\u0000${row.code_presentation}\u0000${row.id_student}`;
      (scores.get(key) ?? scores.set(key, []).get(key)!).push(score);
    }
    // Per course-term eligibility: at least three distinct students.
    const perCourseTerm = new Map<string, number[]>();
    for (const [key, values] of scores) {
      const [course, term] = key.split("\u0000");
      const groupKey = `${course}\u0000${term}`;
      const studentMean = values.reduce((a, b) => a + b, 0) / values.length;
      const list = perCourseTerm.get(groupKey);
      if (list) list.push(studentMean);
      else perCourseTerm.set(groupKey, [studentMean]);
    }
    const expected = [...perCourseTerm.entries()]
      .filter(([, values]) => values.length >= 3)
      .map(([key, values]) => {
        const [course, term] = key.split("\u0000");
        return { course, term, count: values.length };
      });

    const actual = await scoreDistribution("demo");
    const actualList = actual.groups.map((group) => ({
      course: group.course,
      term: group.term,
      count: group.count,
    }));
    expect(actualList).toHaveLength(expected.length);
    for (const item of expected) {
      const match = actualList.find(
        (group) => group.course === item.course && group.term === item.term,
      );
      expect(match, `${item.course}/${item.term}`).toBeDefined();
      expect(match!.count, `${item.course}/${item.term}`).toBe(item.count);
    }
  });

  it("keeps bin totals equal to the group count after narrowing", async () => {
    const full = await scoreDistribution("demo");
    const target = full.groups.reduce((best, group) =>
      group.count > best.count ? group : best,
    );
    const narrowed = await scoreDistribution("demo", {}, {
      course: target.course,
      term: target.term,
    });
    expect(narrowed.groups).toHaveLength(1);
    const [row] = distributionRows(
      narrowed.groups,
      target.term,
      target.course,
      5,
    );
    expect(row.count).toBe(target.count);
    expect(row.bins.reduce((sum, value) => sum + value, 0)).toBe(target.count);
    // Narrowing must not change a single number for the same group.
    expect(narrowed.groups[0].bins).toEqual(target.bins);
  });
});
