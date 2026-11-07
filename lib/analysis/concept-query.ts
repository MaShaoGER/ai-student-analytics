import type { DataSource } from "./types";
import {
  CONCEPT_METRICS,
  type ConceptAttendanceBand,
  type ConceptBin,
  type ConceptCourse,
  type ConceptCourseDetail,
  type ConceptExplorerData,
  type ConceptMetric,
  type ConceptReading,
} from "./concept-explorer";
import { conceptExplorerSource, type ConceptExplorerSource } from "./duckdb";
import { AuthError } from "../auth/service";
import { assertCurrentAccess } from "../auth/access";
import { API_QUERY_LIMITS } from "../security/query-limits";
import {
  withBoundedQueryConnection,
  type QueryExecutionOptions,
  type QueryExecutor,
} from "../security/query-execution";

const MIN_SAMPLE = 3;
const COURSE_LIMIT = 100;
const CONCEPT_LIMITS = { ...API_QUERY_LIMITS.analysis, maxResultRows: 500 };

type Row = Record<string, unknown>;

const UNSUPPORTED: Record<ConceptMetric, string> = {
  attendance: "当前数据源没有校园出勤记录。",
  score: "当前数据源没有有效成绩记录。",
  pass: "当前数据源没有有效成绩记录。",
  completion: "当前数据源没有课程完成标记。",
  homework: "当前数据源没有作业提交记录。",
  ontime: "当前数据源没有作业提交记录。",
};
const HIDDEN_COURSE = "课程样本不足 3 人，数值已隐藏。";
const HIDDEN_METRIC = "该指标有效记录不足 3 人，数值已隐藏。";
const NO_RECORD = "该课程没有可用记录。";

function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function integer(value: unknown): number {
  return Math.round(numberOrNull(value) ?? 0);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function percent(part: number, total: number): number | null {
  return total > 0 ? round2((part / total) * 100) : null;
}

function hidden(reason: string): ConceptReading {
  return { value: null, count: null, reason };
}

function hiddenMetrics(reason: string): Record<ConceptMetric, ConceptReading> {
  return Object.fromEntries(CONCEPT_METRICS.map((metric) => [metric, hidden(reason)])) as Record<
    ConceptMetric,
    ConceptReading
  >;
}

function reading(value: number | null, count: number | null, reason?: string): ConceptReading {
  if (value === null || count === null) return hidden(reason ?? NO_RECORD);
  return { value, count };
}

type AttendanceAggregate = { students: number; scheduled: number; attended: number };
type CompletionAggregate = { known: number; completed: number; incomplete: number };
type HomeworkAggregate = {
  students: number;
  scheduled: number;
  submitted: number;
  onTime: number;
  late: number;
  missing: number;
};

function attendanceReading(
  aggregate: AttendanceAggregate | undefined,
  supported: boolean,
): ConceptReading {
  if (!supported) return hidden(UNSUPPORTED.attendance);
  if (!aggregate || aggregate.students === 0) return hidden(NO_RECORD);
  if (aggregate.students < MIN_SAMPLE) return hidden(HIDDEN_METRIC);
  if (aggregate.scheduled <= 0) return hidden(NO_RECORD);
  return reading(percent(aggregate.attended, aggregate.scheduled), aggregate.students);
}

function completionReading(
  aggregate: CompletionAggregate | undefined,
  supported: boolean,
): ConceptReading {
  if (!supported) return hidden(UNSUPPORTED.completion);
  if (!aggregate || aggregate.known === 0) return hidden(NO_RECORD);
  if (aggregate.known < MIN_SAMPLE) return hidden(HIDDEN_METRIC);
  return reading(percent(aggregate.completed, aggregate.known), aggregate.known);
}

function homeworkReading(
  aggregate: HomeworkAggregate | undefined,
  supported: boolean,
): ConceptReading {
  if (!supported) return hidden(UNSUPPORTED.homework);
  if (!aggregate || aggregate.students === 0 || aggregate.scheduled <= 0)
    return hidden(NO_RECORD);
  if (aggregate.students < MIN_SAMPLE) return hidden(HIDDEN_METRIC);
  return reading(percent(aggregate.submitted, aggregate.scheduled), aggregate.students);
}

function onTimeReading(
  aggregate: HomeworkAggregate | undefined,
  supported: boolean,
): ConceptReading {
  if (!supported) return hidden(UNSUPPORTED.ontime);
  if (!aggregate || aggregate.students === 0 || aggregate.scheduled <= 0)
    return hidden(NO_RECORD);
  if (aggregate.students < MIN_SAMPLE) return hidden(HIDDEN_METRIC);
  return reading(percent(aggregate.onTime, aggregate.scheduled), aggregate.students);
}

function scoreBins(rows: Row[]): ConceptBin[] {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(integer(row.bin), integer(row.n));
  return Array.from({ length: 10 }, (_, index) => {
    const count = counts.get(index) ?? 0;
    const suppressed = count > 0 && count < MIN_SAMPLE;
    return {
      min: index * 10,
      max: index === 9 ? 100 : (index + 1) * 10,
      includeMax: index === 9,
      count: suppressed ? null : count,
      suppressed,
    };
  });
}

function attendanceBands(rows: Row[]): ConceptAttendanceBand[] {
  const byBand = new Map<number, Row>();
  for (const row of rows) byBand.set(integer(row.band), row);
  return Array.from({ length: 5 }, (_, index) => {
    const row = byBand.get(index);
    const count = integer(row?.n);
    if (!row || count === 0)
      return {
        min: index * 20,
        max: index === 4 ? 100 : (index + 1) * 20,
        includeMax: index === 4,
        count: 0,
        suppressed: false,
        meanScore: null,
        passRate: null,
        attendanceRate: null,
      };
    if (count < MIN_SAMPLE)
      return {
        min: index * 20,
        max: index === 4 ? 100 : (index + 1) * 20,
        includeMax: index === 4,
        count: null,
        suppressed: true,
        meanScore: null,
        passRate: null,
        attendanceRate: null,
      };
    const scheduled = numberOrNull(row.scheduled) ?? 0;
    const attended = numberOrNull(row.attended) ?? 0;
    const mean = numberOrNull(row.mean_score);
    const passed = integer(row.passed);
    return {
      min: index * 20,
      max: index === 4 ? 100 : (index + 1) * 20,
      includeMax: index === 4,
      count,
      suppressed: false,
      meanScore: mean === null ? null : round2(mean),
      passRate: percent(passed, count),
      attendanceRate: percent(attended, scheduled),
    };
  });
}

async function courseDetail(
  sql: QueryExecutor,
  source: ConceptExplorerSource,
  course: string,
  term: string,
): Promise<ConceptCourseDetail> {
  const courseLiteral = literal(course);
  const termLiteral = literal(term);
  const scoreRows = await sql(`
    SELECT LEAST(9, FLOOR(score / 10)::INTEGER) AS bin, COUNT(*) AS n
    FROM concept_scores
    WHERE code_module = ${courseLiteral} AND code_presentation = ${termLiteral}
    GROUP BY bin
  `);

  let bands: ConceptAttendanceBand[] | null = null;
  if (source.attendance) {
    const bandRows = await sql(`
      WITH cohort AS (
        SELECT s.id_student, s.score, a.scheduled, a.attended
        FROM concept_scores s
        JOIN concept_attendance a
          ON a.code_module = s.code_module
         AND a.code_presentation = s.code_presentation
         AND a.id_student = s.id_student
        WHERE s.code_module = ${courseLiteral}
          AND s.code_presentation = ${termLiteral}
          AND a.scheduled > 0
      )
      SELECT LEAST(4, FLOOR((attended / scheduled * 100) / 20)::INTEGER) AS band,
             COUNT(*) AS n,
             SUM(scheduled) AS scheduled,
             SUM(attended) AS attended,
             AVG(score) AS mean_score,
             COUNT(*) FILTER (WHERE score >= 60) AS passed
      FROM cohort
      GROUP BY band
    `);
    const covered = bandRows.reduce((total, row) => total + integer(row.n), 0);
    if (covered > 0) bands = attendanceBands(bandRows);
  }

  let weekly: ConceptCourseDetail["weeklyAttendance"] = null;
  if (source.weeklyAttendance) {
    const weekRows = await sql(`
      SELECT w.week AS week, COUNT(DISTINCT w.id_student) AS n,
             SUM(w.scheduled) AS scheduled, SUM(w.attended) AS attended
      FROM concept_weekly w
      JOIN concept_scores s
        ON s.code_module = w.code_module
       AND s.code_presentation = w.code_presentation
       AND s.id_student = w.id_student
      WHERE w.code_module = ${courseLiteral}
        AND w.code_presentation = ${termLiteral}
      GROUP BY w.week
      ORDER BY w.week
    `);
    if (weekRows.length > 0)
      weekly = weekRows.map((row) => {
        const count = integer(row.n);
        const suppressed = count < MIN_SAMPLE;
        const scheduled = numberOrNull(row.scheduled) ?? 0;
        const attended = numberOrNull(row.attended) ?? 0;
        return {
          week: integer(row.week),
          value: suppressed ? null : percent(attended, scheduled),
          count: suppressed ? null : count,
          suppressed,
        };
      });
  }

  let homework: ConceptCourseDetail["homework"] = null;
  if (source.homework) {
    const [row] = await sql(`
      SELECT COUNT(DISTINCT h.id_student) AS n,
             SUM(h.scheduled) AS scheduled, SUM(h.on_time) AS on_time,
             SUM(h.late) AS late, SUM(h.missing_count) AS missing_count
      FROM concept_homework h
      JOIN concept_scores s
        ON s.code_module = h.code_module
       AND s.code_presentation = h.code_presentation
       AND s.id_student = h.id_student
      WHERE h.code_module = ${courseLiteral}
        AND h.code_presentation = ${termLiteral}
    `);
    const students = integer(row?.n);
    const scheduled = integer(row?.scheduled);
    if (students >= MIN_SAMPLE && scheduled > 0)
      homework = {
        scheduled,
        onTime: integer(row.on_time),
        late: integer(row.late),
        missing: integer(row.missing_count),
      };
  }

  const [passRow] = await sql(`
    SELECT COUNT(*) FILTER (WHERE score >= 60) AS passed,
           COUNT(*) FILTER (WHERE score < 60) AS failed
    FROM concept_scores
    WHERE code_module = ${courseLiteral} AND code_presentation = ${termLiteral}
  `);
  const passCounts = {
    passed: integer(passRow?.passed),
    failed: integer(passRow?.failed),
  };

  let completionCounts: ConceptCourseDetail["completionCounts"] = null;
  if (source.completion) {
    const [row] = await sql(`
      SELECT COUNT(*) FILTER (WHERE c.completed = 1) AS completed,
             COUNT(*) FILTER (WHERE c.completed = 0) AS incomplete
      FROM concept_completion c
      JOIN concept_scores s
        ON s.code_module = c.code_module
       AND s.code_presentation = c.code_presentation
       AND s.id_student = c.id_student
      WHERE c.code_module = ${courseLiteral}
        AND c.code_presentation = ${termLiteral}
        AND c.completed IN (0, 1)
    `);
    const known = integer(row?.completed) + integer(row?.incomplete);
    if (known >= MIN_SAMPLE)
      completionCounts = {
        completed: integer(row.completed),
        incomplete: integer(row.incomplete),
      };
  }

  return {
    course,
    scoreBins: scoreBins(scoreRows),
    attendanceBands: bands,
    weeklyAttendance: weekly,
    homework,
    passCounts,
    completionCounts,
  };
}

/**
 * Server-side aggregation for the concept explorer. The cohort is always a
 * real student-course-term score group; other sources join that cohort on the
 * same keys and never replace missing fields with demo values. Catalog rows
 * and readings below three students are hidden explicitly (`null` + reason),
 * never reported as zero.
 */
export async function conceptExplorerData(
  datasetId: DataSource,
  input: { term?: string; course?: string } = {},
  options: QueryExecutionOptions = {},
): Promise<ConceptExplorerData> {
  assertCurrentAccess(datasetId);
  const requestedTerm = input.term?.trim();
  if (input.term !== undefined && !requestedTerm)
    throw new AuthError(400, "INVALID_TERM", "学期参数不能为空。");
  const requestedCourse = input.course?.trim();
  if (input.course !== undefined && !requestedCourse)
    throw new AuthError(400, "INVALID_QUERY", "课程参数不能为空。");
  const source = conceptExplorerSource(datasetId);

  return withBoundedQueryConnection(
    async (sql) => {
      await sql(`CREATE TEMP TABLE concept_scores AS ${source.score}`);

      const termRows = await sql(`
        SELECT code_presentation AS term
        FROM concept_scores
        GROUP BY code_presentation
        ORDER BY code_presentation DESC
      `);
      const terms = termRows.map((row) => String(row.term));
      if (requestedTerm !== undefined && !terms.includes(requestedTerm))
        throw new AuthError(400, "INVALID_TERM", "当前数据源没有该学期。");
      const term = requestedTerm ?? terms[0] ?? null;
      const base = {
        datasetId,
        datasetName: source.datasetName,
        ...(source.datasetVersion ? { datasetVersion: source.datasetVersion } : {}),
        synthetic: source.synthetic,
        term,
        terms,
        courseLimit: COURSE_LIMIT,
        capabilities: source.capabilities,
      };

      if (!term) {
        if (requestedCourse)
          throw new AuthError(
            400,
            "COURSE_NOT_IN_TERM",
            "当前数据源没有可用学期，无法定位该课程。",
          );
        return { ...base, courses: [], totalCourses: 0, detail: null };
      }

      if (requestedCourse) {
        const [known] = await sql(`
          SELECT COUNT(*) AS n FROM concept_scores WHERE code_module = ${literal(requestedCourse)}
        `);
        if (integer(known?.n) === 0)
          throw new AuthError(404, "COURSE_NOT_FOUND", "当前数据源没有该课程。");
        const [inTerm] = await sql(`
          SELECT COUNT(*) AS n FROM concept_scores
          WHERE code_module = ${literal(requestedCourse)}
            AND code_presentation = ${literal(term)}
        `);
        if (integer(inTerm?.n) === 0)
          throw new AuthError(
            400,
            "COURSE_NOT_IN_TERM",
            `该课程在学期「${term}」没有成绩记录，请选择其他学期。`,
          );
      }

      if (source.attendance)
        await sql(`
          CREATE TEMP TABLE concept_attendance AS
          SELECT code_module, code_presentation, id_student,
                 SUM(scheduled) AS scheduled, SUM(attended) AS attended
          FROM (${source.attendance})
          GROUP BY ALL
        `);
      if (requestedCourse && source.weeklyAttendance)
        await sql(`
          CREATE TEMP TABLE concept_weekly AS
          SELECT code_module, code_presentation, id_student, week,
                 SUM(scheduled) AS scheduled, SUM(attended) AS attended
          FROM (${source.weeklyAttendance})
          GROUP BY ALL
        `);
      if (source.homework)
        await sql(`
          CREATE TEMP TABLE concept_homework AS
          SELECT code_module, code_presentation, id_student,
                 SUM(scheduled) AS scheduled, SUM(submitted) AS submitted,
                 SUM(on_time) AS on_time, SUM(late) AS late, SUM(missing_count) AS missing_count
          FROM (${source.homework})
          GROUP BY ALL
        `);
      if (source.completion)
        await sql(`
          CREATE TEMP TABLE concept_completion AS
          SELECT code_module, code_presentation, id_student, AVG(completed) AS completed
          FROM (${source.completion})
          GROUP BY ALL
        `);

      const [totalRow] = await sql(`
        SELECT COUNT(DISTINCT code_module) AS n
        FROM concept_scores
        WHERE code_presentation = ${literal(term)}
      `);
      // The catalog shows at most COURSE_LIMIT courses, so every per-course
      // aggregate must be bounded to that same selection: aggregating all
      // courses would exceed the result-row safety limit on wide data sources
      // (501 courses) even though only the first 100 are ever displayed.
      // `totalCourses` still reports the real count for the term.
      await sql(`
        CREATE TEMP TABLE concept_courses AS
        SELECT * FROM (
          SELECT code_module AS course,
                 COUNT(*) AS n,
                 AVG(score) AS mean,
                 COUNT(*) FILTER (WHERE score >= 60) AS passed,
                 COUNT(*) FILTER (WHERE score < 60) AS failed
          FROM concept_scores
          WHERE code_presentation = ${literal(term)}
          GROUP BY code_module
          ORDER BY ${requestedCourse ? `(code_module = ${literal(requestedCourse)}) DESC, ` : ""}code_module ASC
          LIMIT ${COURSE_LIMIT}
        )
      `);
      const courseRows = await sql(`
        SELECT course, n, mean, passed, failed
        FROM concept_courses
        ORDER BY ${requestedCourse ? `(course = ${literal(requestedCourse)}) DESC, ` : ""}course ASC
      `);

      const attendanceByCourse = new Map<string, AttendanceAggregate>();
      if (source.attendance) {
        const rows = await sql(`
          SELECT a.code_module AS course, COUNT(DISTINCT a.id_student) AS n,
                 SUM(a.scheduled) AS scheduled, SUM(a.attended) AS attended
          FROM concept_attendance a
          JOIN concept_scores s
            ON s.code_module = a.code_module
           AND s.code_presentation = a.code_presentation
           AND s.id_student = a.id_student
          JOIN concept_courses sel ON sel.course = a.code_module
          WHERE a.code_presentation = ${literal(term)}
          GROUP BY a.code_module
        `);
        for (const row of rows)
          attendanceByCourse.set(String(row.course), {
            students: integer(row.n),
            scheduled: numberOrNull(row.scheduled) ?? 0,
            attended: numberOrNull(row.attended) ?? 0,
          });
      }

      const completionByCourse = new Map<string, CompletionAggregate>();
      if (source.completion) {
        const rows = await sql(`
          SELECT c.code_module AS course, COUNT(*) AS n,
                 COUNT(*) FILTER (WHERE c.completed = 1) AS completed,
                 COUNT(*) FILTER (WHERE c.completed = 0) AS incomplete
          FROM concept_completion c
          JOIN concept_scores s
            ON s.code_module = c.code_module
           AND s.code_presentation = c.code_presentation
           AND s.id_student = c.id_student
          JOIN concept_courses sel ON sel.course = c.code_module
          WHERE c.code_presentation = ${literal(term)}
            AND c.completed IN (0, 1)
          GROUP BY c.code_module
        `);
        for (const row of rows)
          completionByCourse.set(String(row.course), {
            known: integer(row.n),
            completed: integer(row.completed),
            incomplete: integer(row.incomplete),
          });
      }

      const homeworkByCourse = new Map<string, HomeworkAggregate>();
      if (source.homework) {
        const rows = await sql(`
          SELECT h.code_module AS course, COUNT(DISTINCT h.id_student) AS n,
                 SUM(h.scheduled) AS scheduled, SUM(h.submitted) AS submitted,
                 SUM(h.on_time) AS on_time, SUM(h.late) AS late,
                 SUM(h.missing_count) AS missing_count
          FROM concept_homework h
          JOIN concept_scores s
            ON s.code_module = h.code_module
           AND s.code_presentation = h.code_presentation
           AND s.id_student = h.id_student
          JOIN concept_courses sel ON sel.course = h.code_module
          WHERE h.code_presentation = ${literal(term)}
          GROUP BY h.code_module
        `);
        for (const row of rows)
          homeworkByCourse.set(String(row.course), {
            students: integer(row.n),
            scheduled: numberOrNull(row.scheduled) ?? 0,
            submitted: numberOrNull(row.submitted) ?? 0,
            onTime: numberOrNull(row.on_time) ?? 0,
            late: numberOrNull(row.late) ?? 0,
            missing: numberOrNull(row.missing_count) ?? 0,
          });
      }

      const courses: ConceptCourse[] = courseRows.map((row) => {
        const course = String(row.course);
        const count = integer(row.n);
        if (count < MIN_SAMPLE)
          return {
            course,
            count: null,
            suppressed: true,
            metrics: hiddenMetrics(HIDDEN_COURSE),
          };
        const mean = numberOrNull(row.mean);
        const passed = integer(row.passed);
        const failed = integer(row.failed);
        const metrics: Record<ConceptMetric, ConceptReading> = {
          attendance: attendanceReading(
            attendanceByCourse.get(course),
            source.capabilities.attendance,
          ),
          score:
            mean === null
              ? hidden(UNSUPPORTED.score)
              : { value: round2(mean), count },
          pass:
            passed + failed === 0
              ? hidden(UNSUPPORTED.pass)
              : { value: percent(passed, passed + failed)!, count: passed + failed },
          completion: completionReading(
            completionByCourse.get(course),
            source.capabilities.completion,
          ),
          homework: homeworkReading(homeworkByCourse.get(course), source.capabilities.homework),
          ontime: onTimeReading(homeworkByCourse.get(course), source.capabilities.homework),
        };
        return { course, count, suppressed: false, metrics };
      });

      let detail: ConceptCourseDetail | null = null;
      if (requestedCourse) {
        const [cohort] = await sql(`
          SELECT COUNT(*) AS n FROM concept_scores
          WHERE code_module = ${literal(requestedCourse)}
            AND code_presentation = ${literal(term)}
        `);
        const cohortSize = integer(cohort?.n);
        if (cohortSize >= MIN_SAMPLE)
          detail = await courseDetail(
            sql,
            source,
            requestedCourse,
            term,
          );
      }

      return {
        ...base,
        courses,
        totalCourses: integer(totalRow?.n),
        detail,
      };
    },
    CONCEPT_LIMITS,
    options,
  );
}