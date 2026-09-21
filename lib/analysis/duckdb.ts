import { existsSync } from "node:fs";
import path from "node:path";
import { DuckDBInstance } from "@duckdb/node-api";
import {
  analysisPlanSchema,
  type AnalysisPlan,
  type AnalysisResult,
  type DatasetProfile,
  type DataSource,
} from "./types";
import { DIMENSIONS, METRICS } from "./metrics";

const PROJECT_ROOT = process.cwd();
const DEMO_ACTIVITY = path.join(PROJECT_ROOT, "data", "sample", "learning_activity.csv");
const DEMO_OUTCOMES = path.join(PROJECT_ROOT, "data", "sample", "student_outcomes.csv");
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

async function withConnection<T>(
  callback: (sql: (query: string) => Promise<Record<string, unknown>[]>) => Promise<T>,
): Promise<T> {
  const instance = await DuckDBInstance.create(":memory:", { threads: "2" });
  const connection = await instance.connect();
  try {
    const sql = async (query: string) => {
      const reader = await connection.runAndReadAll(query);
      return reader.getRowObjectsJson() as Record<string, unknown>[];
    };
    return await callback(sql);
  } finally {
    connection.closeSync();
    instance.closeSync();
  }
}

function csv(filePath: string, options = "") {
  const extras = options ? `, ${options}` : "";
  return `read_csv_auto(${sqlPath(filePath)}, header=true, nullstr='?'${extras})`;
}

function dimensionExpression(plan: AnalysisPlan, alias = "") {
  const prefix = alias ? `${alias}.` : "";
  const dimensions = plan.dimensions.map((dimension) => `${prefix}${DIMENSIONS[dimension].column}`);
  return dimensions.length === 1 ? dimensions[0] : `concat_ws(' / ', ${dimensions.join(", ")})`;
}

function whereClause(plan: AnalysisPlan, alias = "") {
  if (plan.filters.length === 0) return "";
  const prefix = alias ? `${alias}.` : "";
  const clauses = plan.filters.map((filter, index) => {
    const column = `${prefix}${DIMENSIONS[filter.field].column}`;
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    const literals = values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
    return `${column} ${filter.op === "eq" ? "=" : "IN"} (${literals})`;
  });
  return `WHERE ${clauses.join(" AND ")}`;
}

function queryForDemo(plan: AnalysisPlan) {
  const dimension = dimensionExpression(plan);
  const where = whereClause(plan);
  if (plan.metric === "activity") {
    return `
      SELECT ${dimension} AS dimension,
             ROUND(SUM(activity_count), 2) AS value,
             COUNT(DISTINCT id_student) AS sample_size
      FROM ${csv(DEMO_ACTIVITY)}
      ${where}
      GROUP BY ALL
      HAVING COUNT(DISTINCT id_student) >= 3
      ORDER BY value ${plan.sort.direction === "asc" ? "ASC" : "DESC"}
      LIMIT ${plan.limit}`;
  }
  const aggregate = plan.metric === "completion_rate" ? "AVG(completed) * 100" : "AVG(score)";
  return `
    SELECT ${dimension} AS dimension,
           ROUND(${aggregate}, 2) AS value,
           COUNT(DISTINCT id_student) AS sample_size
    FROM ${csv(DEMO_OUTCOMES)}
    ${where}
    GROUP BY ALL
    HAVING COUNT(DISTINCT id_student) >= 3
    ORDER BY value ${plan.sort.direction === "asc" ? "ASC" : "DESC"}
    LIMIT ${plan.limit}`;
}

function queryForOulad(plan: AnalysisPlan) {
  const dimension = dimensionExpression(plan);
  const where = whereClause(plan);
  if (plan.metric === "activity") {
    return `
      SELECT ${dimension} AS dimension,
             ROUND(SUM(CAST(sum_click AS DOUBLE)), 2) AS value,
             COUNT(DISTINCT id_student) AS sample_size
      FROM ${csv(OULAD.studentVle)}
      ${where}
      GROUP BY ALL
      HAVING COUNT(DISTINCT id_student) >= 3
      ORDER BY value ${plan.sort.direction === "asc" ? "ASC" : "DESC"}
      LIMIT ${plan.limit}`;
  }
  if (plan.metric === "completion_rate") {
    return `
      SELECT ${dimension} AS dimension,
             ROUND(AVG(CASE WHEN final_result IN ('Pass', 'Distinction') THEN 1 ELSE 0 END) * 100, 2) AS value,
             COUNT(DISTINCT id_student) AS sample_size
      FROM ${csv(OULAD.studentInfo)}
      ${where}
      GROUP BY ALL
      HAVING COUNT(DISTINCT id_student) >= 3
      ORDER BY value ${plan.sort.direction === "asc" ? "ASC" : "DESC"}
      LIMIT ${plan.limit}`;
  }
  return `
    WITH student_scores AS (
      SELECT a.code_module,
             a.code_presentation,
             sa.id_student,
             AVG(CAST(sa.score AS DOUBLE)) AS student_score
      FROM ${csv(OULAD.studentAssessment)} sa
      JOIN ${csv(OULAD.assessments)} a USING (id_assessment)
      ${whereClause(plan, "a")}
      GROUP BY ALL
    )
    SELECT ${dimension} AS dimension,
           ROUND(AVG(student_score), 2) AS value,
           COUNT(DISTINCT id_student) AS sample_size
    FROM student_scores
    GROUP BY ALL
    HAVING COUNT(DISTINCT id_student) >= 3
    ORDER BY value ${plan.sort.direction === "asc" ? "ASC" : "DESC"}
    LIMIT ${plan.limit}`;
}

function validateFiles(source: DataSource) {
  if (source === "demo") return fileExists(DEMO_ACTIVITY) && fileExists(DEMO_OUTCOMES);
  return Object.values(OULAD).every(fileExists);
}

export async function runAnalysis(
  input: unknown,
): Promise<{ plan: AnalysisPlan; result: AnalysisResult }> {
  const plan = analysisPlanSchema.parse(input);
  if (!validateFiles(plan.datasetId)) {
    throw new Error(`数据源 ${plan.datasetId} 不可用，请检查本地数据文件。`);
  }
  const query = plan.datasetId === "demo" ? queryForDemo(plan) : queryForOulad(plan);
  const startedAt = performance.now();
  const rows = await withConnection((sql) => sql(query));
  const durationMs = Math.round(performance.now() - startedAt);
  return {
    plan,
    result: {
      datasetId: plan.datasetId,
      dimension: plan.dimensions[0],
      chartType: plan.chartType,
      rows: rows.map((row) => ({
        dimension: String(row.dimension),
        value: Number(row.value),
        sampleSize: Number(row.sample_size),
      })),
      unit: METRICS[plan.metric].unit,
      metricLabel: METRICS[plan.metric].label,
      period:
        plan.datasetId === "demo"
          ? plan.metric === "activity"
            ? "模拟数据全部记录（课程第 1–3 周）"
            : "模拟数据全部开课期记录"
          : "OULAD 本地 CSV 全部记录",
      query: queryForDisplay(query),
      durationMs,
    },
  };
}

export async function profileDatasets(): Promise<DatasetProfile[]> {
  const demoAvailable = validateFiles("demo");
  const ouladAvailable = validateFiles("oulad");
  const profiles: DatasetProfile[] = [
    {
      id: "demo",
      name: "模拟校园数据",
      description: "9 名虚构学生、3 门课程、2 个开课期，用于快速演示和测试。",
      source: "仓库内 data/sample，虚构数据",
      available: demoAvailable,
      tables: [
        {
          name: "learning_activity",
          rows: demoAvailable ? 27 : null,
          grain: "学生-课程-开课期-周次",
          status: demoAvailable ? "ready" : "not_found",
        },
        {
          name: "student_outcomes",
          rows: demoAvailable ? 9 : null,
          grain: "学生-课程-开课期",
          status: demoAvailable ? "ready" : "not_found",
        },
      ],
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
          rows: ouladAvailable ? null : null,
          grain: "学生-课程-开课期",
          status: fileExists(OULAD.studentInfo) ? "ready" : "not_found",
        },
        {
          name: "studentVle",
          rows: ouladAvailable ? null : null,
          grain: "学生-课程-开课期-日期-资源",
          status: fileExists(OULAD.studentVle) ? "ready" : "not_found",
        },
        {
          name: "studentAssessment",
          rows: ouladAvailable ? null : null,
          grain: "学生-考核项",
          status: fileExists(OULAD.studentAssessment) ? "ready" : "not_found",
        },
        {
          name: "assessments",
          rows: ouladAvailable ? null : null,
          grain: "课程-开课期-考核项",
          status: fileExists(OULAD.assessments) ? "ready" : "not_found",
        },
        {
          name: "courses",
          rows: ouladAvailable ? null : null,
          grain: "课程-开课期",
          status: fileExists(OULAD.courses) ? "ready" : "not_found",
        },
      ],
    },
  ];
  return profiles;
}
