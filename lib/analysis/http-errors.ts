import { QueryExecutionError } from "../security/query-execution";
import type { AnalysisResult } from "./types";

export type AnalysisHttpError = { error: string; code: string; status: number };

/** Fixed messages prevent driver errors, paths and upstream credentials from escaping. */
export function queryExecutionHttpError(error: unknown): AnalysisHttpError | null {
  if (!(error instanceof QueryExecutionError)) return null;
  switch (error.code) {
    case "TIMEOUT":
      return { error: "分析请求超时，请缩小分析范围或稍后重试。", code: error.code, status: 504 };
    case "CANCELLED":
      return { error: "分析请求已取消。", code: error.code, status: 499 };
    case "DATA_SOURCE_UNAVAILABLE":
      // A missing/unreadable data file is not an AI failure. Point at the data
      // source so users and administrators look in the right place.
      return {
        error: "当前数据源读取失败，请换一个数据源，或联系管理员检查数据文件。",
        code: error.code,
        status: 503,
      };
    case "OUT_OF_MEMORY":
      return { error: "分析超过内存限制，请添加课程或学期筛选条件后重试。", code: error.code, status: 422 };
    case "TOO_MANY_ROWS":
      return { error: "分析结果超过行数限制，请添加筛选条件或减少返回条数。", code: error.code, status: 422 };
    case "TOO_MANY_FIELDS":
      return { error: "数据表字段超过安全限制，请联系管理员调整数据结构。", code: error.code, status: 422 };
  }
}

export function noDataHttpError(result: AnalysisResult): AnalysisHttpError {
  return {
    error: `未找到满足条件的分析结果。请检查所选指标、分组维度和筛选条件。最小样本阈值：${result.minSampleSize} 名学生。`,
    code: "NO_DATA",
    status: 422,
  };
}

/**
 * Whether retrying the same question can plausibly succeed without changing
 * anything. Used by the chat UI to render a "retry this question" action.
 */
const RETRYABLE_ERROR_CODES = new Set([
  "DATA_SOURCE_UNAVAILABLE",
  "AI_PROVIDER_OVERLOADED",
  "AI_PROVIDER_RATE_LIMITED",
  "AI_PROVIDER_UNAVAILABLE",
  "RATE_LIMIT_EXCEEDED",
  "ANALYSIS_FAILED",
  "AI_PLANNING_FAILED",
  "TIMEOUT",
]);

export function isRetryableErrorCode(code: string | null | undefined): boolean {
  return Boolean(code && RETRYABLE_ERROR_CODES.has(code));
}
