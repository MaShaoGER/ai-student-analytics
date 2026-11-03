import type { QueryExecutor } from "../security/query-execution";
import {
  explorationFocusSchema,
  focusStepLabel,
  type ExplorationFocus,
  type FocusStep,
  type FocusSummary,
} from "./selection";

/** Sources are owned by the existing DuckDB connection; no IDs cross its boundary. */
export type CohortSources = {
  scores: string;
  activity: () => Promise<string | null>;
  attributes: () => Promise<string | null>;
  completion: () => Promise<string | null>;
};

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const scope = (step: FocusStep) =>
  `code_presentation = ${literal(step.term)}${"course" in step && step.course ? ` AND code_module = ${literal(step.course)}` : ""}`;

/** Keep this CASE identical to the project Sankey's complete three-layer paths. */
export const pathBands = `CASE WHEN attendance < 80 THEN 0 WHEN attendance < 95 THEN 1 ELSE 2 END AS attendance_band,
  CASE WHEN homework < 60 THEN 0 WHEN homework < 90 THEN 1 ELSE 2 END AS homework_band,
  CASE WHEN score < 60 THEN 0 WHEN score < 80 THEN 1 ELSE 2 END AS score_band`;

export function cohortPredicate(table = "focus_students"): string {
  return `id_student IN (SELECT id_student FROM ${table})`;
}

/** Each step is evaluated in its own original scope, inside the preceding cohort. */
export async function createFocusCohort(
  sql: QueryExecutor,
  input: ExplorationFocus,
  sources: CohortSources,
): Promise<FocusSummary> {
  const focus = explorationFocusSchema.parse(input);
  for (const [index, step] of focus.steps.entries()) {
    const previous = index ? ` AND ${cohortPredicate(`focus_step_${index - 1}`)}` : "";
    const narrowed = (source: string) => `SELECT * FROM ${source} WHERE ${scope(step)}${previous}`;
    const empty = `SELECT id_student FROM ${sources.scores} WHERE FALSE`;
    let members: string;
    switch (step.kind) {
      case "course":
      case "term": {
        const source =
          step.population === "activity"
            ? await sources.activity()
            : step.population === "completion_rate"
              ? await sources.completion()
              : sources.scores;
        members = source ? narrowed(source) : empty;
        break;
      }
      case "week": {
        const source = await sources.activity();
        members = source ? `${narrowed(source)} AND week = ${step.week}` : empty;
        break;
      }
      case "score":
        members = `${narrowed(sources.scores)} AND score >= ${step.min} AND score ${step.includeMax ? "<=" : "<"} ${step.max}`;
        break;
      case "pair":
        members = `SELECT a.id_student FROM (${narrowed(sources.scores)}) a
          JOIN (${narrowed(sources.scores)}) b USING (id_student, code_presentation)
          WHERE a.code_module = ${literal(step.source)} AND b.code_module = ${literal(step.target)}
            AND a.score < 60 AND b.score < 60`;
        break;
      case "density": {
        const source =
          step.metric === "attendance" ? await sources.attributes() : await sources.activity();
        if (!source) {
          members = empty;
          break;
        }
        const behavior =
          step.metric === "attendance"
            ? narrowed(source)
            : `SELECT code_module, code_presentation, id_student, SUM(activity) AS activity FROM (${narrowed(source)}) GROUP BY ALL`;
        const x =
          step.metric === "attendance"
            ? "LEAST(9, FLOOR(attendance / 10)) * 10 + 5"
            : "FLOOR(activity / 100) * 100 + 50";
        members = `WITH cells AS (
          SELECT s.id_student, ${x} AS x, LEAST(19, FLOOR(score / 5)) * 5 + 2.5 AS y
          FROM (${narrowed(sources.scores)}) s JOIN (${behavior}) b USING (code_module, code_presentation, id_student)
          ${step.metric === "attendance" ? "WHERE attendance IS NOT NULL" : ""}
        ), visible AS (
          SELECT x, y FROM cells GROUP BY x, y HAVING COUNT(*) >= 3 ORDER BY x, y
          ${step.metric === "activity" ? "LIMIT 2000" : ""}
        ) SELECT c.id_student FROM cells c JOIN visible v USING (x, y)
          WHERE x = ${step.x} AND y = ${step.y}`;
        break;
      }
      case "path": {
        const source = await sources.attributes();
        if (!source) {
          members = empty;
          break;
        }
        const conditions = (["attendance", "homework", "score"] as const)
          .filter((key) => step[key] !== undefined)
          .map((key) => `${key}_band = ${step[key]}`)
          .join(" AND ");
        members = `WITH paths AS (
          SELECT s.id_student, ${pathBands}
          FROM (${narrowed(sources.scores)}) s JOIN (${narrowed(source)}) a USING (code_module, code_presentation, id_student)
          WHERE attendance IS NOT NULL AND homework IS NOT NULL
        ), visible AS (
          SELECT attendance_band, homework_band, score_band FROM paths GROUP BY ALL HAVING COUNT(*) >= 3
        ) SELECT p.id_student FROM paths p JOIN visible v USING (attendance_band, homework_band, score_band)
          WHERE ${conditions}`;
        break;
      }
    }
    await sql(`CREATE TEMP TABLE focus_step_${index} AS
      SELECT DISTINCT id_student FROM (${members}) WHERE id_student IS NOT NULL`);
  }
  await sql(
    `CREATE TEMP VIEW focus_students AS SELECT id_student FROM focus_step_${focus.steps.length - 1}`,
  );
  // Even the application receives only the privacy-safe aggregate, never a small exact count.
  const [summary] = await sql(
    `SELECT CASE WHEN COUNT(*) >= 3 THEN COUNT(*) ELSE NULL END AS count FROM focus_students`,
  );
  return {
    label: focus.steps.map(focusStepLabel).join(" ∩ "),
    count: summary.count == null ? null : Number(summary.count),
    suppressed: summary.count == null,
  };
}
