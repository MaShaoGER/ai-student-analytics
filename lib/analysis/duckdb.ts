import { isGradeDataset } from "../datasets/id";
import { getGradeSnapshot } from "../datasets/grade-store";
import { AuthError } from "../auth/service";
import { assertCurrentAccess } from "../auth/access";
import { createHash } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { API_QUERY_LIMITS } from "../security/query-limits";
import {
  assertQueryResultLimits,
  QueryExecutionError,
  withBoundedQueryConnection,
  type QueryExecutionOptions,
} from "../security/query-execution";
import {
  analysisPlanSchema,
  type AnalysisPlan,
  type AnalysisResult,
  type DatasetProfile,
  type DataSource,
} from "./types";
import { DIMENSIONS, METRICS } from "./metrics";
import type { ScoreDistributionData, DistributionScope } from "./score-distribution";
import {
  absenceRequestSchema,
  absenceSupport,
  ABSENCE_MINUTES_PER_PERIOD,
  type AbsenceCourseRow,
  type AbsenceStats,
} from "./absence-stats";
import { courseRelationRequestSchema, type CourseRelationData } from "./course-relations";
import type {
  StudioProjectData,
  StudioRow,
  StudioTable,
  StudioRelationshipMetric,
} from "./chart-studio";
import {
  coursePanoramaRequestSchema,
  PanoramaSelectionError,
  type CoursePanoramaData,
  type CoursePanoramaStats,
} from "./course-panorama";

const PROJECT_ROOT = process.cwd();
// Server-only override lets regression tests retain their tiny, stable fixtures.
const DEMO_ROOT = process.env.DEMO_DATA_DIR
  ? path.resolve(/* turbopackIgnore: true */ PROJECT_ROOT, process.env.DEMO_DATA_DIR)
  : path.join(PROJECT_ROOT, "data", "sample");
const DEMO_ACTIVITY = path.join(DEMO_ROOT, "learning_activity.csv");
const DEMO_OUTCOMES = path.join(DEMO_ROOT, "student_outcomes.csv");
const DEMO_TABLES = [
  { name: "learning_activity", grain: "学生-课程-开课期-周次", path: DEMO_ACTIVITY },
  { name: "student_outcomes", grain: "学生-课程-开课期", path: DEMO_OUTCOMES },
  { name: "students", grain: "学生", path: path.join(DEMO_ROOT, "students.csv") },
  {
    name: "student_residences",
    grain: "学生-开课期",
    path: path.join(DEMO_ROOT, "student_residences.csv"),
  },
  { name: "leave_requests", grain: "请假申请", path: path.join(DEMO_ROOT, "leave_requests.csv") },
  {
    name: "attendance_weekly",
    grain: "学生-课程-开课期-周次",
    path: path.join(DEMO_ROOT, "attendance_weekly.csv"),
  },
  {
    name: "assignment_submissions",
    grain: "学生-课程-开课期-作业",
    path: path.join(DEMO_ROOT, "assignment_submissions.csv"),
  },
  {
    name: "student_term_summary",
    grain: "学生-开课期",
    path: path.join(DEMO_ROOT, "student_term_summary.csv"),
  },
];
const OULAD = {
  assessments: path.join(PROJECT_ROOT, "oulad_raw", "assessments.csv"),
  courses: path.join(PROJECT_ROOT, "oulad_raw", "courses.csv"),
  studentAssessment: path.join(PROJECT_ROOT, "oulad_raw", "studentAssessment.csv"),
  studentInfo: path.join(PROJECT_ROOT, "oulad_raw", "studentInfo.csv"),
  studentVle: path.join(PROJECT_ROOT, "oulad_raw", "studentVle.csv"),
};

function sqlPath(filePath: string): string {
  return `'${filePath.replaceAll("'", "''")}'`;
}

function queryForDisplay(query: string): string {
  return query.trim().replace(/\s+/g, " ").replaceAll(PROJECT_ROOT, ".");
}

function fileExists(filePath: string): boolean {
  return existsSync(/*turbopackIgnore: true*/ filePath);
}

function sqlIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function csv(filePath: string, options = "") {
  const extras = options ? `, ${options}` : "";
  // OULAD uses '?'; campus CSVs also use empty cells for not-applicable values.
  return `read_csv_auto(${sqlPath(filePath)}, header=true, nullstr=['?', '']${extras})`;
}

function gradeSource(datasetId: DataSource): string {
  const snapshot = getGradeSnapshot(datasetId);
  if (!snapshot) throw new AuthError(503, "DATA_SOURCE_UNAVAILABLE", "成绩数据版本不可用。");
  return `(SELECT id_student, code_module, code_presentation,
    CAST(NULLIF(score, '') AS DECIMAL(5,2)) AS score,
    CAST(NULLIF(completed, '') AS INTEGER) AS completed
    FROM read_csv(${sqlPath(snapshot.path)}, header=true, all_varchar=true, nullstr=''))`;
}
function importedMetadata(datasetId: DataSource): {
  datasetVersion?: string;
  datasetName?: string;
} {
  if (!isGradeDataset(datasetId)) return {};
  const snapshot = getGradeSnapshot(datasetId);
  return { datasetVersion: snapshot.version, datasetName: snapshot.name };
}
function datasetName(datasetId: DataSource): string {
  return isGradeDataset(datasetId)
    ? getGradeSnapshot(datasetId).name
    : datasetId === "demo"
      ? "模拟校园数据"
      : "OULAD 本地数据";
}

function dimensionExpression(plan: AnalysisPlan, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const dimensions = plan.dimensions.map((dimension) => `${prefix}${DIMENSIONS[dimension].column}`);
  return dimensions.length === 1 ? dimensions[0] : `concat_ws(' / ', ${dimensions.join(", ")})`;
}

function whereClause(plan: AnalysisPlan, alias = "") {
  if (plan.filters.length === 0) return "";
  const prefix = alias ? `${alias}.` : "";
  const clauses = plan.filters.map((filter) => {
    const column = `${prefix}${DIMENSIONS[filter.field].column}`;
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
    return `${column} ${filter.op === "eq" ? "=" : "IN"} (${literals})`;
  });
  return `WHERE ${clauses.join(" AND ")}`;
}

function orderClause(plan: AnalysisPlan): string {
  const direction = plan.sort.direction === "asc" ? "ASC" : "DESC";
  if (plan.sort.by === "dimension") return `ORDER BY dimension ${direction}`;
  // Keep ties deterministic so golden cases and the UI do not depend on
  // DuckDB's incidental grouping order.
  return `ORDER BY value ${direction}, dimension ASC`;
}

/** All rows and scope metadata use this exact filtered source. */
function analysisSource(plan: AnalysisPlan): { source: string; aggregate: string } {
  const where = whereClause(plan);
  if (isGradeDataset(plan.datasetId)) {
    const snapshot = getGradeSnapshot(plan.datasetId);
    if (
      plan.metric === "activity" ||
      (plan.metric === "completion_rate" && !snapshot.hasCompletion)
    )
      throw new AuthError(
        422,
        "UNSUPPORTED_METRIC",
        "该数据集未提供此指标所需的原始记录，请选择成绩分析。",
      );
    const predicate = plan.metric === "score" ? "score IS NOT NULL" : "completed IS NOT NULL";
    return {
      source: `SELECT * FROM ${gradeSource(plan.datasetId)} ${where ? `${where} AND` : "WHERE"} ${predicate}`,
      aggregate: plan.metric === "score" ? "AVG(score)" : "AVG(completed) * 100",
    };
  }
  if (plan.datasetId === "demo") {
    return {
      source: `SELECT * FROM ${csv(plan.metric === "activity" ? DEMO_ACTIVITY : DEMO_OUTCOMES)} ${where}`,
      aggregate:
        plan.metric === "activity"
          ? "SUM(activity_count)"
          : plan.metric === "completion_rate"
            ? "AVG(completed) * 100"
            : "AVG(score)",
    };
  }
  if (plan.metric === "activity")
    return {
      source: `SELECT * FROM ${csv(OULAD.studentVle)} ${where}`,
      aggregate: "SUM(CAST(sum_click AS DOUBLE))",
    };
  if (plan.metric === "completion_rate")
    return {
      source: `SELECT * FROM ${csv(OULAD.studentInfo)} ${where}`,
      aggregate: "AVG(CASE WHEN final_result IN ('Pass', 'Distinction') THEN 1 ELSE 0 END) * 100",
    };
  return {
    source: `SELECT a.code_module, a.code_presentation, sa.id_student,
                    AVG(CAST(sa.score AS DOUBLE)) AS student_score
             FROM ${csv(OULAD.studentAssessment)} sa
             JOIN ${csv(OULAD.assessments)} a USING (id_assessment)
             ${whereClause(plan, "a")} GROUP BY ALL`,
    aggregate: "AVG(student_score)",
  };
}

function analysisQueries(plan: AnalysisPlan) {
  const { source, aggregate } = analysisSource(plan);
  const dimension = dimensionExpression(plan);
  return {
    query: `WITH analysis_source AS (${source})
      SELECT ${dimension} AS dimension, ROUND(${aggregate}, 2) AS value,
             COUNT(DISTINCT id_student) AS sample_size
      FROM analysis_source GROUP BY ALL
      HAVING COUNT(DISTINCT id_student) >= 3
      ${orderClause(plan)} LIMIT ${plan.limit}`,
    // Count suppressed groups before LIMIT. A row limit is not privacy filtering.
    metadata: `WITH analysis_source AS (${source}), grouped AS (
        SELECT ${dimension} AS dimension, COUNT(DISTINCT id_student) AS sample_size
        FROM analysis_source GROUP BY ALL
      ) SELECT
        (SELECT list_sort(list_distinct(list(code_presentation))) FROM analysis_source) AS terms,
        (SELECT COUNT(*) FROM grouped WHERE sample_size < 3) AS filtered_out_group_count`,
  };
}

function analysisPeriod(plan: AnalysisPlan, terms: string[]): string {
  const source = datasetName(plan.datasetId);
  const filters = plan.filters.map(
    (filter) =>
      `${filter.field === "course" ? "课程" : "学期"}筛选：${[filter.value].flat().join("、")}`,
  );
  return [
    source,
    terms.length ? `学期：${terms.join("、")}` : "无匹配记录",
    ...filters,
    plan.metric === "activity"
      ? plan.datasetId === "demo"
        ? "周活动记录"
        : "学习资源访问记录"
      : "开课期记录",
  ].join(" · ");
}

function validateFiles(source: DataSource) {
  if (isGradeDataset(source)) return fileExists(getGradeSnapshot(source).path);
  if (source === "demo") return fileExists(DEMO_ACTIVITY) && fileExists(DEMO_OUTCOMES);
  return Object.values(OULAD).every(fileExists);
}

type ProfileTable = {
  name: string;
  grain: string;
  path: string;
};

/**
 * Dataset profiles run many DESCRIBE/aggregate queries over local CSVs, so the
 * route serves a short-lived in-process snapshot. The cache is valid only for
 * the exact path+mtime+size signature of every profiling input, which makes a
 * replaced CSV invalidate it immediately.
 */
export const PROFILE_CACHE_TTL_MS = 30_000;
const PROFILE_INPUT_PATHS = [...DEMO_TABLES.map((table) => table.path), ...Object.values(OULAD)];

export type ProfileCacheEntry = {
  signature: string;
  expiresAt: number;
  profiles: DatasetProfile[];
};

type FileSignature = { mtimeMs: number; size: number };

function defaultFileSignature(filePath: string): FileSignature | null {
  try {
    const stats = statSync(/* turbopackIgnore: true */ filePath);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return null;
  }
}

export function profileCacheSignature(
  paths: readonly string[] = PROFILE_INPUT_PATHS,
  statFile: (filePath: string) => FileSignature | null = defaultFileSignature,
): string {
  const parts = paths.map((filePath) => {
    const signature = statFile(filePath);
    return `${filePath}\u0000${signature ? `${signature.mtimeMs}\u0000${signature.size}` : "missing"}`;
  });
  return createHash("sha256").update(parts.join("\n")).digest("hex");
}

export function readProfileCache(
  entry: ProfileCacheEntry | null | undefined,
  signature: string,
  now: number,
): DatasetProfile[] | null {
  return entry && entry.signature === signature && entry.expiresAt > now ? entry.profiles : null;
}

let profileCache: ProfileCacheEntry | null = null;

async function profileTable(
  sql: (query: string) => Promise<Record<string, unknown>[]>,
  table: ProfileTable,
) {
  const schema = await sql(`DESCRIBE SELECT * FROM ${csv(table.path)}`);
  const fields = schema.map((column) => ({
    name: String(column.column_name),
    type: String(column.column_type),
  }));
  assertQueryResultLimits(0, fields.length, API_QUERY_LIMITS.profile);
  if (fields.length === 0) {
    return { name: table.name, rows: 0, grain: table.grain, status: "ready" as const, fields: [] };
  }
  const missingExpressions = fields
    .map(
      (field) =>
        `${sqlIdentifier(field.name)} := SUM(CASE WHEN ${sqlIdentifier(field.name)} IS NULL THEN 1 ELSE 0 END)`,
    )
    .join(", ");
  const [stats] = await sql(
    `SELECT COUNT(*) AS row_count, struct_pack(${missingExpressions}) AS missing_counts FROM ${csv(table.path)}`,
  );
  const missingCounts = stats?.missing_counts as Record<string, unknown> | undefined;
  return {
    name: table.name,
    rows: Number(stats?.row_count ?? 0),
    grain: table.grain,
    status: "ready" as const,
    fields: fields.map((field) => ({
      ...field,
      missing: Number(missingCounts?.[field.name] ?? 0),
    })),
  };
}

export async function runAnalysis(
  input: unknown,
  options: QueryExecutionOptions = {},
): Promise<{ plan: AnalysisPlan; result: AnalysisResult }> {
  const plan = analysisPlanSchema.parse(input);
  assertCurrentAccess(plan.datasetId);
  if (!validateFiles(plan.datasetId)) {
    throw new QueryExecutionError(
      "DATA_SOURCE_UNAVAILABLE",
      `数据源 ${plan.datasetId} 不可用，请检查本地数据文件。`,
    );
  }
  const { query, metadata } = analysisQueries(plan);
  const minSampleSize = 3;
  const startedAt = performance.now();

  const { rows, scope } = await withBoundedQueryConnection(
    async (sql) => {
      const rows = await sql(query);
      const [scope] = await sql(metadata);
      return { rows, scope };
    },
    API_QUERY_LIMITS.analysis,
    options,
  );
  const durationMs = Math.round(performance.now() - startedAt);
  const terms = Array.isArray(scope.terms) ? scope.terms.map(String) : [];
  const filteredOutGroupCount = Number(scope.filtered_out_group_count);

  return {
    plan,
    result: {
      datasetId: plan.datasetId,
      ...importedMetadata(plan.datasetId),
      dimension: plan.dimensions[0],
      dimensions: plan.dimensions,
      chartType: plan.chartType,
      rows: rows.map((row) => ({
        dimension: String(row.dimension),
        value: Number(row.value),
        sampleSize: Number(row.sample_size),
      })),
      unit: METRICS[plan.metric].unit,
      metricLabel: METRICS[plan.metric].label,
      period: analysisPeriod(plan, terms),
      query: queryForDisplay(
        isGradeDataset(plan.datasetId)
          ? query.replaceAll(sqlPath(getGradeSnapshot(plan.datasetId).path), "'[私有成绩版本]'")
          : query,
      ),
      durationMs,
      minSampleSize,
      filteredOutGroupCount,
    },
  };
}

/** Aggregate on the server; no student identifiers leave the query boundary. */
function studentScoreSource(datasetId: DataSource) {
  return datasetId !== "oulad"
    ? `SELECT code_module, code_presentation, id_student,
              AVG(TRY_CAST(score AS DOUBLE)) AS score
       FROM ${isGradeDataset(datasetId) ? gradeSource(datasetId) : csv(DEMO_OUTCOMES)}
       WHERE TRY_CAST(score AS DOUBLE) BETWEEN 0 AND 100
         AND id_student IS NOT NULL AND code_module IS NOT NULL AND code_presentation IS NOT NULL
       GROUP BY ALL`
    : `SELECT a.code_module, a.code_presentation, sa.id_student,
              AVG(TRY_CAST(sa.score AS DOUBLE)) AS score
       FROM ${csv(OULAD.studentAssessment)} sa
       JOIN ${csv(OULAD.assessments)} a USING (id_assessment)
       WHERE TRY_CAST(sa.score AS DOUBLE) BETWEEN 0 AND 100
         AND sa.id_student IS NOT NULL AND a.code_module IS NOT NULL AND a.code_presentation IS NOT NULL
       GROUP BY ALL`;
}

export async function scoreDistribution(
  datasetId: DataSource,
  options: QueryExecutionOptions = {},
  scope: DistributionScope = {},
): Promise<ScoreDistributionData> {
  assertCurrentAccess(datasetId);
  if (!validateFiles(datasetId))
    throw new QueryExecutionError(
      "DATA_SOURCE_UNAVAILABLE",
      "成绩数据源不可用，请检查本地数据文件。",
    );
  const source = studentScoreSource(datasetId);
  // Narrow the source before aggregating: the optional course/term predicate is
  // applied inside the CTE so the histogram, the eligibility count and the
  // returned groups all describe exactly the requested scope. Filtering groups
  // after the fact used to read and aggregate the whole dataset.
  const narrowed = distributionPredicate(scope);
  const scopedSource = narrowed ? `SELECT * FROM (${source}) WHERE ${narrowed}` : source;
  const rows = await withBoundedQueryConnection(
    (sql) =>
      sql(`
      WITH student_scores AS (${scopedSource}),
      eligible AS (
        SELECT code_module, code_presentation, COUNT(*) AS sample_size
        FROM student_scores
        GROUP BY ALL HAVING COUNT(*) >= 3
      ), counts AS (
        SELECT code_module, code_presentation,
               LEAST(99, FLOOR(score)::INTEGER) AS bin, COUNT(*) AS frequency
        FROM student_scores GROUP BY ALL
      )
      SELECT e.code_module, e.code_presentation, e.sample_size,
             LIST(struct_pack(bin := c.bin, frequency := c.frequency) ORDER BY c.bin) AS histogram
      FROM eligible e JOIN counts c USING (code_module, code_presentation)
      GROUP BY ALL ORDER BY e.code_presentation DESC, e.code_module ASC
    `),
    { ...API_QUERY_LIMITS.analysis, maxResultRows: 1000 },
    options,
  );
  return {
    datasetId,
    ...importedMetadata(datasetId),
    minSampleSize: 3,
    groups: rows.map((row) => {
      const bins = Array<number>(100).fill(0);
      for (const cell of row.histogram as { bin: number; frequency: number | string }[]) {
        bins[Number(cell.bin)] = Number(cell.frequency);
      }
      return {
        course: String(row.code_module),
        term: String(row.code_presentation),
        count: Number(row.sample_size),
        bins,
      };
    }),
  };
}

/**
 * Exact-match predicate for an already-validated catalog label. Values are
 * escaped as SQL literals here; callers must not pass free text. Blank labels
 * are ignored rather than turned into `= '  '`, which would silently match
 * nothing.
 */
function distributionPredicate(scope: DistributionScope): string {
  const label = (value: string | null | undefined) => value?.trim() ?? "";
  const parts: string[] = [];
  const course = label(scope.course);
  const term = label(scope.term);
  if (course) parts.push(`code_module = '${course.replaceAll("'", "''")}'`);
  if (term) parts.push(`code_presentation = '${term.replaceAll("'", "''")}'`);
  return parts.join(" AND ");
}

/** Join only deduplicated scores from the same student and term; return aggregates. */
export async function courseRelations(
  input: unknown,
  options: QueryExecutionOptions = {},
): Promise<CourseRelationData> {
  const {
    datasetId,
    term,
    threshold,
    courses: requestedCourses = [],
  } = courseRelationRequestSchema.parse(input);
  assertCurrentAccess(datasetId);
  if (!validateFiles(datasetId))
    throw new QueryExecutionError(
      "DATA_SOURCE_UNAVAILABLE",
      "成绩数据源不可用，请检查本地数据文件。",
    );
  const minSampleSize = 3;
  const courseLimit = 12;
  return withBoundedQueryConnection(
    async (sql) => {
      await sql(`CREATE TEMP TABLE student_scores AS ${studentScoreSource(datasetId)}`);
      const termRows = await sql(`SELECT DISTINCT code_presentation FROM student_scores
      GROUP BY code_presentation, code_module HAVING COUNT(*) >= ${minSampleSize}
      ORDER BY code_presentation DESC`);
      const terms = termRows.map((row) => String(row.code_presentation));
      const activeTerm = term ?? terms[0] ?? null;
      const empty: CourseRelationData = {
        datasetId,
        ...importedMetadata(datasetId),
        term: activeTerm,
        terms,
        threshold,
        minSampleSize,
        courseLimit,
        totalCourses: 0,
        courses: [],
        relations: [],
      };
      if (!activeTerm || !terms.includes(activeTerm)) return empty;
      const literal = `'${activeTerm.replaceAll("'", "''")}'`;
      await sql(`CREATE TEMP TABLE eligible_courses AS
      SELECT code_module, COUNT(*) AS sample_size FROM student_scores
      WHERE code_presentation = ${literal}
      GROUP BY code_module HAVING COUNT(*) >= ${minSampleSize}`);
      const [total] = await sql("SELECT COUNT(*) AS total FROM eligible_courses");
      const preferred = requestedCourses.map((name) => `'${name.replaceAll("'", "''")}'`);
      const priority = preferred.length
        ? `CASE WHEN code_module IN (${preferred.join(", ")}) THEN 0 ELSE 1 END,`
        : "";
      await sql(`CREATE TEMP TABLE selected_courses AS SELECT * FROM eligible_courses
      ORDER BY ${priority} sample_size DESC, code_module ASC LIMIT ${courseLimit}`);
      const courses = await sql("SELECT * FROM selected_courses ORDER BY code_module ASC");
      const pairs = await sql(`
      WITH selected_scores AS (
        SELECT s.* FROM student_scores s JOIN selected_courses c USING (code_module)
        WHERE s.code_presentation = ${literal}
      )
      SELECT a.code_module AS source, b.code_module AS target,
             COUNT(*) AS common_count,
             COUNT(*) FILTER (WHERE a.score < ${threshold} AND b.score < ${threshold}) AS below_count
      FROM selected_scores a JOIN selected_scores b
        ON a.id_student = b.id_student AND a.code_presentation = b.code_presentation
        AND a.code_module < b.code_module
      GROUP BY a.code_module, b.code_module
      HAVING common_count >= ${minSampleSize} AND below_count >= ${minSampleSize}
      ORDER BY below_count DESC, source ASC, target ASC
    `);
      return {
        ...empty,
        totalCourses: Number(total.total),
        courses: courses.map((row) => ({
          name: String(row.code_module),
          count: Number(row.sample_size),
        })),
        relations: pairs.map((row) => ({
          source: String(row.source),
          target: String(row.target),
          commonCount: Number(row.common_count),
          belowCount: Number(row.below_count),
          rate: Math.round((Number(row.below_count) / Number(row.common_count)) * 10000) / 100,
        })),
      };
    },
    API_QUERY_LIMITS.analysis,
    options,
  );
}

/** All layers share a student/term cohort; identifiers remain inside DuckDB. */
export async function coursePanorama(
  input: unknown,
  options: QueryExecutionOptions = {},
): Promise<CoursePanoramaData> {
  const {
    datasetId,
    term,
    threshold,
    source,
    target,
    courses: requestedCourses = [],
  } = coursePanoramaRequestSchema.parse(input);
  assertCurrentAccess(datasetId);
  if (!validateFiles(datasetId))
    throw new QueryExecutionError(
      "DATA_SOURCE_UNAVAILABLE",
      "成绩数据源不可用，请检查本地数据文件。",
    );
  const minSampleSize = 3;
  const courseLimit = 12;
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  return withBoundedQueryConnection(
    async (sql) => {
      await sql(`CREATE TEMP TABLE student_scores AS ${studentScoreSource(datasetId)}`);
      const termRows = await sql(`SELECT DISTINCT code_presentation FROM student_scores
      GROUP BY code_presentation, code_module HAVING COUNT(*) >= ${minSampleSize}
      ORDER BY code_presentation DESC`);
      const terms = termRows.map((row) => String(row.code_presentation));
      const activeTerm = term ?? terms[0] ?? null;
      const empty: CoursePanoramaData = {
        datasetId,
        ...importedMetadata(datasetId),
        term: activeTerm,
        terms,
        threshold,
        minSampleSize,
        courseLimit,
        totalCourses: 0,
        courses: [],
        relations: [],
        totalStudents: 0,
        selection: null,
        columns: [],
      };
      if (!activeTerm || !terms.includes(activeTerm)) {
        if (source) throw new PanoramaSelectionError();
        return empty;
      }
      await sql(`CREATE TEMP TABLE eligible_courses AS
      SELECT code_module, COUNT(*) AS sample_size FROM student_scores
      WHERE code_presentation = ${literal(activeTerm)}
      GROUP BY code_module HAVING COUNT(*) >= ${minSampleSize}`);
      const [total] = await sql("SELECT COUNT(*) AS total FROM eligible_courses");
      const preferred = requestedCourses.map((name) => `'${name.replaceAll("'", "''")}'`);
      const priority = preferred.length
        ? `CASE WHEN code_module IN (${preferred.join(", ")}) THEN 0 ELSE 1 END,`
        : "";
      await sql(`CREATE TEMP TABLE selected_courses AS SELECT * FROM eligible_courses
      ORDER BY ${priority} sample_size DESC, code_module ASC LIMIT ${courseLimit}`);
      await sql(`CREATE TEMP TABLE selected_scores AS
      SELECT s.* FROM student_scores s JOIN selected_courses c USING (code_module)
      WHERE s.code_presentation = ${literal(activeTerm)}`);
      const courses = await sql("SELECT * FROM selected_courses ORDER BY code_module ASC");
      const pairs = await sql(`SELECT a.code_module AS source, b.code_module AS target,
        COUNT(*) AS common_count,
        COUNT(*) FILTER (WHERE a.score < ${threshold} AND b.score < ${threshold}) AS below_count
      FROM selected_scores a JOIN selected_scores b
        ON a.id_student = b.id_student AND a.code_presentation = b.code_presentation
        AND a.code_module < b.code_module
      GROUP BY a.code_module, b.code_module
      HAVING common_count >= ${minSampleSize} AND below_count >= ${minSampleSize}
      ORDER BY below_count DESC, source ASC, target ASC`);
      const relations = pairs.map((row) => ({
        source: String(row.source),
        target: String(row.target),
        commonCount: Number(row.common_count),
        belowCount: Number(row.below_count),
        rate: Math.round((Number(row.below_count) / Number(row.common_count)) * 10000) / 100,
      }));
      const relation = source
        ? relations.find(
            (item) =>
              (item.source === source && item.target === target) ||
              (item.source === target && item.target === source),
          )
        : undefined;
      if (source && !relation) throw new PanoramaSelectionError();
      if (relation) {
        await sql(`CREATE TEMP TABLE cohort_students AS
        SELECT a.id_student FROM selected_scores a JOIN selected_scores b USING (id_student, code_presentation)
        WHERE a.code_module = ${literal(relation.source)} AND b.code_module = ${literal(relation.target)}
          AND a.score < ${threshold} AND b.score < ${threshold}`);
      }
      const [population] = await sql(
        "SELECT COUNT(DISTINCT id_student) AS total FROM selected_scores",
      );
      const summary = (table: string) => `WITH stats AS (
        SELECT code_module, COUNT(*) AS count, ROUND(AVG(score), 2) AS mean,
          ROUND(100.0 * COUNT(*) FILTER (WHERE score >= 60) / COUNT(*), 2) AS pass_rate
        FROM ${table} GROUP BY code_module HAVING COUNT(*) >= ${minSampleSize}
      ), bins AS (
        SELECT code_module, LEAST(19, FLOOR(score / 5)::INTEGER) AS bin, COUNT(*) AS frequency
        FROM ${table} GROUP BY code_module, bin
      ) SELECT s.*, LIST(struct_pack(bin := b.bin, frequency := b.frequency) ORDER BY b.bin) AS histogram
        FROM stats s JOIN bins b USING (code_module) GROUP BY ALL ORDER BY code_module ASC`;
      const baselineRows = await sql(summary("selected_scores"));
      let cohortRows = baselineRows;
      if (relation) {
        await sql(`CREATE TEMP TABLE cohort_scores AS SELECT s.* FROM selected_scores s
        JOIN cohort_students c USING (id_student)`);
        cohortRows = await sql(summary("cohort_scores"));
      }
      const stats = (row: Record<string, unknown>): CoursePanoramaStats => {
        const bins = Array<number>(20).fill(0);
        for (const cell of row.histogram as { bin: number; frequency: number | string }[])
          bins[Number(cell.bin)] = Number(cell.frequency);
        return {
          count: Number(row.count),
          mean: Number(row.mean),
          passRate: Number(row.pass_rate),
          bins,
        };
      };
      const cohort = new Map(cohortRows.map((row) => [String(row.code_module), stats(row)]));
      return {
        ...empty,
        totalCourses: Number(total.total),
        totalStudents: Number(population.total),
        relations,
        courses: courses.map((row) => ({
          name: String(row.code_module),
          count: Number(row.sample_size),
        })),
        selection: relation
          ? {
              source: relation.source,
              target: relation.target,
              count: relation.belowCount,
              commonCount: relation.commonCount,
            }
          : null,
        columns: baselineRows.map((row) => ({
          course: String(row.code_module),
          baseline: stats(row),
          cohort: cohort.get(String(row.code_module)) ?? null,
        })),
      };
    },
    API_QUERY_LIMITS.analysis,
    options,
  );
}

export async function chartStudioData(
  datasetId: DataSource,
  term?: string,
  course = "",
  options: QueryExecutionOptions = {},
  selection: {
    courses?: string[];
    beforeTerm?: string;
    densityMetric?: StudioRelationshipMetric;
  } = {},
): Promise<StudioProjectData> {
  assertCurrentAccess(datasetId);
  if (!validateFiles(datasetId))
    throw new QueryExecutionError("DATA_SOURCE_UNAVAILABLE", "数据源不可用，请检查本地数据文件。");
  const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const table = (
    rows: Record<string, unknown>[],
    columns: string[],
    description: string,
  ): StudioTable => ({
    columns,
    rows: rows as StudioRow[],
    description,
  });
  return withBoundedQueryConnection(
    async (sql) => {
      await sql(`CREATE TEMP TABLE all_scores AS ${studentScoreSource(datasetId)}`);
      const termRows = await sql(`SELECT DISTINCT code_presentation FROM all_scores
      GROUP BY code_module, code_presentation HAVING COUNT(*) >= 3 ORDER BY code_presentation DESC`);
      const terms = termRows.map((row) => String(row.code_presentation));
      const activeTerm = term ?? terms[0] ?? null;
      const result: StudioProjectData = {
        datasetId,
        ...importedMetadata(datasetId),
        term: activeTerm,
        terms,
        course,
        courses: [],
        tables: {},
      };
      if (!activeTerm || !terms.includes(activeTerm)) return result;
      const whereTerm = `code_presentation = ${literal(activeTerm)}`;
      const chosen = selection.courses?.length ? selection.courses : course ? [course] : [];
      const whereCourse = chosen.length
        ? ` AND code_module IN (${chosen.map(literal).join(", ")})`
        : "";
      const courses = await sql(`SELECT code_module FROM all_scores WHERE ${whereTerm}
      GROUP BY code_module HAVING COUNT(*) >= 3 ORDER BY code_module ASC`);
      result.courses = courses.map((row) => String(row.code_module));
      await sql(`CREATE TEMP TABLE studio_scores AS SELECT * FROM all_scores
      WHERE ${whereTerm}${whereCourse}`);
      const box = await sql(`SELECT code_module AS "课程", MIN(score) AS "最小值",
      QUANTILE_CONT(score, 0.25) AS "下四分位数", MEDIAN(score) AS "中位数",
      QUANTILE_CONT(score, 0.75) AS "上四分位数", MAX(score) AS "最大值", COUNT(*) AS "样本数"
      FROM studio_scores GROUP BY code_module HAVING COUNT(*) >= 3 ORDER BY code_module LIMIT 40`);
      result.tables.boxplot = table(
        box,
        ["课程", "最小值", "下四分位数", "中位数", "上四分位数", "最大值", "样本数"],
        `${activeTerm} · 有效成绩五数概要，须线表示最小值和最大值；每组至少 3 人。`,
      );
      const index = terms.indexOf(activeTerm);
      const previous = selection.beforeTerm ?? terms[index + 1];
      if (previous && !terms.includes(previous)) throw new Error("对比学期不在当前数据中。");
      const comparison = previous
        ? await sql(`
      WITH before AS (SELECT code_module, AVG(score) AS mean, COUNT(*) AS n FROM all_scores
        WHERE code_presentation = ${literal(previous)}${whereCourse} GROUP BY code_module HAVING COUNT(*) >= 3),
      after AS (SELECT code_module, AVG(score) AS mean, COUNT(*) AS n FROM studio_scores
        GROUP BY code_module HAVING COUNT(*) >= 3)
      SELECT code_module AS "课程", ROUND(b.mean, 2) AS "前期均分", ROUND(a.mean, 2) AS "后期均分",
        b.n AS "前期样本", a.n AS "后期样本"
      FROM before b JOIN after a USING(code_module) ORDER BY code_module LIMIT 40`)
        : [];
      result.tables.dumbbell = table(
        comparison,
        ["课程", "前期均分", "后期均分", "前期样本", "后期样本"],
        previous
          ? `${previous} → ${activeTerm} · 两学期各自选课样本的课程均分比较，不等同于同一批学生的个人进步。`
          : "当前学期之前没有可比较的学期，可导入自己的前后对比数据。",
      );

      if (isGradeDataset(datasetId)) return result;

      const activitySource =
        datasetId === "demo"
          ? `SELECT code_module, code_presentation, id_student, TRY_CAST(week AS INTEGER) AS week,
           SUM(TRY_CAST(activity_count AS DOUBLE)) AS activity
         FROM ${csv(DEMO_ACTIVITY)} WHERE TRY_CAST(activity_count AS DOUBLE) >= 0 GROUP BY ALL`
          : `SELECT code_module, code_presentation, id_student, FLOOR(TRY_CAST(date AS DOUBLE) / 7)::INTEGER + 1 AS week,
           SUM(TRY_CAST(sum_click AS DOUBLE)) AS activity
         FROM ${csv(OULAD.studentVle)} WHERE TRY_CAST(sum_click AS DOUBLE) >= 0 GROUP BY ALL`;
      await sql(`CREATE TEMP TABLE studio_activity AS ${activitySource}`);
      const rhythm = await sql(`SELECT week AS "周次", code_module AS "课程",
        ROUND(AVG(activity), 2) AS "人均访问次数", COUNT(DISTINCT id_student) AS "当周有记录人数"
      FROM studio_activity WHERE ${whereTerm}${whereCourse} AND week IS NOT NULL AND id_student IS NOT NULL
      GROUP BY week, code_module HAVING COUNT(DISTINCT id_student) >= 3 ORDER BY code_module, week LIMIT 2000`);
      result.tables.heatmap = table(
        rhythm,
        ["周次", "课程", "人均访问次数", "当周有记录人数"],
        `${activeTerm} · 按学生-课程-周汇总访问次数，再计算当周有记录学生的人均值；缺失组合留空，不当作零。`,
      );
      if (datasetId === "demo") {
        await sql(`CREATE TEMP TABLE studio_attributes AS
        SELECT code_module, code_presentation, id_student,
          AVG(CASE WHEN TRY_CAST(attendance_rate AS DOUBLE) BETWEEN 0 AND 100 THEN TRY_CAST(attendance_rate AS DOUBLE) END) AS attendance,
          AVG(CASE WHEN TRY_CAST(homework_completion_rate AS DOUBLE) BETWEEN 0 AND 100 THEN TRY_CAST(homework_completion_rate AS DOUBLE) END) AS homework,
          AVG(CASE WHEN TRY_CAST(absent_sessions AS DOUBLE) BETWEEN 0 AND TRY_CAST(scheduled_sessions AS DOUBLE)
            AND TRY_CAST(excused_sessions AS DOUBLE) BETWEEN 0 AND TRY_CAST(scheduled_sessions AS DOUBLE)
            AND TRY_CAST(absent_sessions AS DOUBLE) + TRY_CAST(excused_sessions AS DOUBLE) <= TRY_CAST(scheduled_sessions AS DOUBLE)
            THEN TRY_CAST(absent_sessions AS DOUBLE) + TRY_CAST(excused_sessions AS DOUBLE) END) AS absence,
          AVG(CASE WHEN TRY_CAST(absent_sessions AS DOUBLE) BETWEEN 0 AND TRY_CAST(scheduled_sessions AS DOUBLE)
            THEN TRY_CAST(absent_sessions AS DOUBLE) END) AS unexcused
        FROM ${csv(DEMO_OUTCOMES)} WHERE ${whereTerm}${whereCourse} GROUP BY ALL`);
        const paths = await sql(`SELECT
          CASE WHEN attendance < 80 THEN '出勤低于80%' WHEN attendance < 95 THEN '出勤80–95%' ELSE '出勤至少95%' END AS "出勤档位",
          CASE WHEN homework < 60 THEN '作业完成低于60%' WHEN homework < 90 THEN '作业完成60–90%' ELSE '作业完成至少90%' END AS "作业档位",
          CASE WHEN score < 60 THEN '成绩低于60分' WHEN score < 80 THEN '成绩60–80分' ELSE '成绩至少80分' END AS "成绩档位",
          COUNT(*) AS "数量"
        FROM studio_scores JOIN studio_attributes USING(code_module, code_presentation, id_student)
        WHERE attendance IS NOT NULL AND homework IS NOT NULL GROUP BY ALL HAVING COUNT(*) >= 3 ORDER BY ALL`);
        result.tables.sankey = table(
          paths,
          ["出勤档位", "作业档位", "成绩档位", "数量"],
          `${activeTerm} · ${course ? "人数" : "选课人次"}，完整三层路径少于 3 人的不展示；按层汇总连接带，不表示因果或同一学生的时间流转。`,
        );
        const density =
          await sql(`SELECT LEAST(9, FLOOR(attendance / 10)) * 10 + 5 AS "出勤率区间中心",
          LEAST(19, FLOOR(score / 5)) * 5 + 2.5 AS "成绩区间中心", COUNT(*) AS "频数"
        FROM studio_scores JOIN studio_attributes USING(code_module, code_presentation, id_student)
        WHERE attendance IS NOT NULL GROUP BY ALL HAVING COUNT(*) >= 3 ORDER BY ALL`);
        result.tables.density = table(
          density,
          ["出勤率区间中心", "成绩区间中心", "频数"],
          `${activeTerm} · 按出勤率 10 个百分点、成绩 5 分聚合；坐标为区间中心，频数少于 3 人不展示。`,
        );
      }
      if (
        datasetId === "demo" &&
        (selection.densityMetric === "absence" || selection.densityMetric === "unexcused")
      ) {
        const metric = selection.densityMetric;
        const label = metric === "absence" ? "缺勤课时" : "旷课课时";
        const density = await sql(`SELECT ${metric} AS "${label}",
          LEAST(19, FLOOR(score / 5)) * 5 + 2.5 AS "成绩区间中心", COUNT(*) AS "频数"
        FROM studio_scores JOIN studio_attributes USING(code_module, code_presentation, id_student)
        WHERE ${metric} IS NOT NULL GROUP BY ALL HAVING COUNT(*) >= 3 ORDER BY ALL`);
        result.tables.density = table(
          density,
          [label, "成绩区间中心", "频数"],
          `${activeTerm} · ${label}按学生-课程-学期统计，${metric === "absence" ? "包含请假缺席与旷课" : "仅无有效批准请假的旷课，不含请假缺席"}；每课时45分钟，不等同于请假申请或缺勤事件次数。成绩按5分分档，频数为选课人次；少于3人的组合不展示，缺失记录不当作零，也不以活跃度替代。`,
        );
      }
      if (datasetId === "oulad" || selection.densityMetric === "activity") {
        const density =
          await sql(`WITH activity AS (SELECT code_module, code_presentation, id_student, SUM(activity) AS activity
          FROM studio_activity WHERE ${whereTerm}${whereCourse} GROUP BY ALL)
        SELECT FLOOR(activity / 100) * 100 + 50 AS "活动量区间中心",
          LEAST(19, FLOOR(score / 5)) * 5 + 2.5 AS "成绩区间中心", COUNT(*) AS "频数"
        FROM studio_scores JOIN activity USING(code_module, code_presentation, id_student)
        GROUP BY ALL HAVING COUNT(*) >= 3 ORDER BY ALL LIMIT 2000`);
        result.tables.density = table(
          density,
          ["活动量区间中心", "成绩区间中心", "频数"],
          `${activeTerm} · 活动量按 100 次、成绩按 5 分汇总，频数少于 3 人不展示；${datasetId === "oulad" ? "OULAD 不含校园出勤和作业完成率。" : "演示数据，活动量与成绩不代表因果关系。"}`,
        );
      }
      return result;
    },
    { ...API_QUERY_LIMITS.analysis, maxResultRows: 2500 },
    options,
  );
}

export async function profileDatasets(
  options: QueryExecutionOptions = {},
  datasetIds: DataSource[] = ["demo", "oulad"],
): Promise<DatasetProfile[]> {
  if (!datasetIds.length) return [];
  for (const id of datasetIds) assertCurrentAccess(id);
  const importedIds = datasetIds.filter(isGradeDataset);
  if (importedIds.length) {
    const builtins = datasetIds.filter((id) => !isGradeDataset(id));
    const profiles = builtins.length ? await profileDatasets(options, builtins) : [];
    for (const id of importedIds) {
      const snapshot = getGradeSnapshot(id);
      const table = await withBoundedQueryConnection(
        async (sql) => {
          const [counts] = await sql(
            `SELECT COUNT(*) AS rows, COUNT(*) FILTER (WHERE score IS NULL) AS missing_score FROM ${gradeSource(id)}`,
          );
          return {
            name: "student_outcomes",
            grain: "学生-课程-学期",
            rows: Number(counts.rows),
            status: "ready" as const,
            fields: [
              { name: "id_student", type: "VARCHAR", missing: 0 },
              { name: "code_module", type: "VARCHAR", missing: 0 },
              { name: "code_presentation", type: "VARCHAR", missing: 0 },
              { name: "score", type: "DECIMAL(5,2)", missing: Number(counts.missing_score) },
              {
                name: "completed",
                type: "INTEGER",
                missing: snapshot.hasCompletion ? 0 : Number(counts.rows),
              },
            ],
          };
        },
        API_QUERY_LIMITS.profile,
        options,
      );
      profiles.push({
        id,
        name: snapshot.name,
        datasetVersion: snapshot.version,
        available: true,
        metrics: snapshot.hasCompletion ? ["score", "completion_rate"] : ["score"],
        description:
          "管理员导入的教学成绩。空成绩不作为零分；无出勤和活动记录。仅提供至少3名学生的聚合结果。",
        source: "管理员上传 · " + snapshot.version,
        tables: [table],
      });
    }
    return profiles;
  }
  const signature = profileCacheSignature() + ":" + [...datasetIds].sort().join(",");
  const cacheNow = Date.now();
  // Cancellation must stay observable even when a warm snapshot exists.
  const cached = options.signal?.aborted
    ? null
    : readProfileCache(profileCache, signature, cacheNow);
  if (cached) return cached;
  const demoAvailable = validateFiles("demo");
  const ouladAvailable = validateFiles("oulad");
  // Legacy golden fixtures only contain the original two tables.
  const demoTables = DEMO_TABLES.filter((table, index) => index < 2 || fileExists(table.path));
  const profiledTables = await withBoundedQueryConnection(
    async (sql) => {
      const tables = new Map<string, Awaited<ReturnType<typeof profileTable>>>();
      const candidates: ProfileTable[] = [
        ...(datasetIds.includes("demo") ? demoTables : []),
        ...(datasetIds.includes("oulad")
          ? [
              { name: "studentInfo", grain: "学生-课程-开课期", path: OULAD.studentInfo },
              { name: "studentVle", grain: "学生-课程-开课期-日期-资源", path: OULAD.studentVle },
              { name: "studentAssessment", grain: "学生-考核项", path: OULAD.studentAssessment },
              { name: "assessments", grain: "课程-开课期-考核项", path: OULAD.assessments },
              { name: "courses", grain: "课程-开课期", path: OULAD.courses },
            ]
          : []),
      ];
      for (const candidate of candidates) {
        if (fileExists(candidate.path))
          tables.set(candidate.name, await profileTable(sql, candidate));
      }
      return tables;
    },
    API_QUERY_LIMITS.profile,
    options,
  );
  const profiles: DatasetProfile[] = [
    {
      id: "demo",
      name: "模拟校园数据",
      description:
        demoTables.length > 2
          ? "虚构的多课程、多学期校园数据，涵盖成绩、活动、出勤、作业、请假、学生档案与住宿。数据档案提供表结构与质量，指标分析目前支持成绩、活动和课程完成率。未交作业的日期和成绩、无已交作业时的均分为空，表示不适用。"
          : "虚构的多课程、多学期学习数据，涵盖成绩、完成结果和逐周活动。",
      source: "本地虚构演示数据",
      available: demoAvailable,
      tables: demoTables.map((table) => ({
        name: table.name,
        rows: profiledTables.get(table.name)?.rows ?? null,
        grain: table.grain,
        status: fileExists(table.path) ? "ready" : "not_found",
        fields: profiledTables.get(table.name)?.fields,
      })),
    },
    {
      id: "oulad",
      name: "OULAD 本地数据",
      description: "Open University Learning Analytics Dataset，读取本地 CSV，不上传数据。",
      source: "oulad_raw/，来源见 OULAD.names",
      available: ouladAvailable,
      tables: [
        {
          name: "studentInfo",
          rows: profiledTables.get("studentInfo")?.rows ?? null,
          grain: "学生-课程-开课期",
          status: fileExists(OULAD.studentInfo) ? "ready" : "not_found",
          fields: profiledTables.get("studentInfo")?.fields,
        },
        {
          name: "studentVle",
          rows: profiledTables.get("studentVle")?.rows ?? null,
          grain: "学生-课程-开课期-日期-资源",
          status: fileExists(OULAD.studentVle) ? "ready" : "not_found",
          fields: profiledTables.get("studentVle")?.fields,
        },
        {
          name: "studentAssessment",
          rows: profiledTables.get("studentAssessment")?.rows ?? null,
          grain: "学生-考核项",
          status: fileExists(OULAD.studentAssessment) ? "ready" : "not_found",
          fields: profiledTables.get("studentAssessment")?.fields,
        },
        {
          name: "assessments",
          rows: profiledTables.get("assessments")?.rows ?? null,
          grain: "课程-开课期-考核项",
          status: fileExists(OULAD.assessments) ? "ready" : "not_found",
          fields: profiledTables.get("assessments")?.fields,
        },
        {
          name: "courses",
          rows: profiledTables.get("courses")?.rows ?? null,
          grain: "课程-开课期",
          status: fileExists(OULAD.courses) ? "ready" : "not_found",
          fields: profiledTables.get("courses")?.fields,
        },
      ],
    },
  ];
  const scoped = profiles.filter((profile) => datasetIds.includes(profile.id));
  profileCache = { signature, expiresAt: cacheNow + PROFILE_CACHE_TTL_MS, profiles: scoped };
  return scoped;
}

/**
 * Absence statistics in their real units. The three units are measured
 * separately from the same source rows: class periods missed (sessions),
 * distinct students affected, and approved leave days (leave table only).
 * OULAD returns `supported: false` because it has no attendance fields.
 */
export async function absenceStats(
  input: unknown,
  options: QueryExecutionOptions = {},
): Promise<AbsenceStats> {
  const request = absenceRequestSchema.parse(input);
  assertCurrentAccess(request.datasetId);
  const support = absenceSupport(request.datasetId, request.unit);
  if (!support.supported)
    return {
      datasetId: request.datasetId,
      ...importedMetadata(request.datasetId),
      term: request.term ?? null,
      terms: [],
      course: request.course ?? null,
      metric: request.metric,
      unit: request.unit,
      supported: false,
      unsupportedReason: support.reason,
      rows: [],
      totals: { sessions: 0, studentCourseCount: 0, distinctStudents: 0, approvedLeaveDays: 0 },
      minutesPerPeriod: ABSENCE_MINUTES_PER_PERIOD,
      minSampleSize: 3,
    };
  if (!validateFiles(request.datasetId))
    throw new QueryExecutionError(
      "DATA_SOURCE_UNAVAILABLE",
      "成绩与出勤数据源不可用，请检查本地数据文件。",
    );
  const term = request.term?.trim() || null;
  const course = request.course?.trim() || null;
  // Probe the actual columns before building SQL: a dataset without absence
  // fields (or a trimmed fixture) must return "unsupported", not a driver error.
  const columns = new Set(
    (
      await withBoundedQueryConnection(
        (sql) => sql(`DESCRIBE SELECT * FROM ${csv(DEMO_OUTCOMES)}`),
        { ...API_QUERY_LIMITS.analysis, maxResultRows: 200 },
        options,
      )
    ).map((row) => String(row.column_name)),
  );
  const required = {
    absence: ["absent_sessions", "excused_sessions"],
    unexcused: ["absent_sessions"],
    excused: ["excused_sessions"],
  }[request.metric];
  const missing = required.filter((name) => !columns.has(name));
  if (missing.length)
    return {
      datasetId: request.datasetId,
      term,
      terms: [],
      course,
      metric: request.metric,
      unit: request.unit,
      supported: false,
      unsupportedReason: `当前数据源缺少缺勤字段（${missing.join("、")}），无法统计缺勤；不能用出勤率或活动量替代。`,
      rows: [],
      totals: { sessions: 0, studentCourseCount: 0, distinctStudents: 0, approvedLeaveDays: 0 },
      minutesPerPeriod: ABSENCE_MINUTES_PER_PERIOD,
      minSampleSize: 3,
    };
  // COALESCE before adding: a NULL in either column would make the sum NULL and
  // the row would be silently dropped by the FILTER below, which would treat
  // "missing" as "no absence happened".
  const column =
    request.metric === "absence"
      ? "(COALESCE(TRY_CAST(absent_sessions AS DOUBLE), 0) + COALESCE(TRY_CAST(excused_sessions AS DOUBLE), 0))"
      : request.metric === "unexcused"
        ? "TRY_CAST(absent_sessions AS DOUBLE)"
        : "TRY_CAST(excused_sessions AS DOUBLE)";
  const filters = [
    term ? `code_presentation = ${quoteLiteral(term)}` : "",
    course ? `code_module = ${quoteLiteral(course)}` : "",
  ].filter(Boolean);
  const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
  const minSampleSize = 3;
  // One connection answers all three questions: course rows, the term list, and
  // the approved-leave day total. They must describe the same source rows.
  const { result, terms, distinctStudents, approvedLeaveDays } = await withBoundedQueryConnection(
    async (sql) => {
      const result = await sql(`
        WITH outcomes AS (
          SELECT code_module, code_presentation, id_student,
                 ${column} AS missed
          FROM ${csv(DEMO_OUTCOMES)}
          ${where}
        ), grouped AS (
          SELECT code_module AS course,
                 SUM(missed) FILTER (WHERE missed IS NOT NULL) AS sessions,
                 -- The privacy threshold counts every student with a valid
                 -- absence record in the group, not only the affected ones:
                 -- gating on "affected >= 3" would leak the affected count.
                 COUNT(DISTINCT id_student) FILTER (WHERE missed IS NOT NULL) AS sample_size,
                 COUNT(DISTINCT id_student) FILTER (WHERE missed > 0) AS students
          FROM outcomes GROUP BY code_module
        )
        SELECT course, sessions, students FROM grouped
        WHERE sample_size >= ${minSampleSize}
        ORDER BY course ASC
      `);
      const termRows = await sql(`
        SELECT DISTINCT code_presentation FROM ${csv(DEMO_OUTCOMES)}
        ${where} ORDER BY code_presentation ASC
      `);
      // Distinct affected students across the scope. The per-course sums are
      // person-course counts and would overstate the headcount (measured on the
      // sample dataset: 3,184 person-course rows vs 1,194 distinct students).
      //
      // The suppression threshold applies here too. Calculating the total over
      // every row would count students from courses whose own group was hidden,
      // which both contradicts the returned rows and defeats the privacy rule
      // that a sub-threshold group is not disclosed. Only students in eligible
      // (>= minSampleSize valid records) course groups are counted.
      const distinctRows = await sql(`
        WITH outcomes AS (
          SELECT code_module, id_student, ${column} AS missed
          FROM ${csv(DEMO_OUTCOMES)}
          ${where}
        ), eligible AS (
          SELECT code_module FROM outcomes
          GROUP BY code_module HAVING COUNT(DISTINCT id_student) >= ${minSampleSize}
        )
        SELECT COUNT(DISTINCT o.id_student) AS students
        FROM outcomes o JOIN eligible e USING (code_module)
        WHERE o.missed > 0
      `);
      // Approved leave days live in the leave table, which has no course column:
      // the total is term-scoped and must never be split across courses. A
      // missing leave file must not fail the absence count that already worked;
      // it degrades to "leave days unavailable" instead of an IO error.
      const leavePath = path.join(DEMO_ROOT, "leave_requests.csv");
      const leaveRows =
        request.metric === "unexcused"
          ? []
          : fileExists(leavePath)
            ? await sql(`
                SELECT COALESCE(SUM(TRY_CAST(duration_days AS DOUBLE)), 0) AS days
                FROM ${csv(leavePath)}
                WHERE approval_status = '已批准'
                ${term ? `AND code_presentation = ${quoteLiteral(term)}` : ""}
              `)
            : [];
      return {
        result,
        terms: termRows.map((row) => String(row.code_presentation)),
        distinctStudents: Number(distinctRows[0]?.students ?? 0),
        approvedLeaveDays: Number(leaveRows[0]?.days ?? 0),
      };
    },
    { ...API_QUERY_LIMITS.analysis, maxResultRows: 1000 },
    options,
  );
  const rows: AbsenceCourseRow[] = result.map((row) => ({
    course: String(row.course),
    sessions: Number(row.sessions ?? 0),
    students: Number(row.students ?? 0),
  }));
  return {
    datasetId: request.datasetId,
    term,
    terms,
    course,
    metric: request.metric,
    unit: request.unit,
    supported: true,
    unsupportedReason: null,
    rows,
    totals: {
      sessions: rows.reduce((sum, row) => sum + row.sessions, 0),
      // Reported separately on purpose: the sum over groups counts one student
      // once per course, the query above counts distinct students overall.
      studentCourseCount: rows.reduce((sum, row) => sum + row.students, 0),
      distinctStudents,
      approvedLeaveDays,
    },
    minutesPerPeriod: ABSENCE_MINUTES_PER_PERIOD,
    minSampleSize,
  };
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
