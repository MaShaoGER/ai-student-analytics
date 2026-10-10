/**
 * Query execution limits and safety constraints.
 */

export interface QueryLimits {
  timeoutMs: number; // Query execution timeout
  maxMemoryMb: number; // Max memory per query (soft limit, advisory)
  maxResultRows: number; // Max rows in result
  maxFieldCount: number; // Max fields per table
}

export const DEFAULT_QUERY_LIMITS: QueryLimits = {
  timeoutMs: 30_000, // 30 seconds
  maxMemoryMb: 512, // 512 MB
  maxResultRows: 10_000,
  maxFieldCount: 100,
};

export interface QueryExecutionConfig extends QueryLimits {
  abortSignal?: AbortSignal;
}

/**
 * Create an AbortSignal that times out after the specified duration.
 */
export function createTimeoutSignal(timeoutMs: number): AbortSignal {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Wrap the signal to clean up the timeout when aborted
  const signal = controller.signal;
  signal.addEventListener("abort", () => clearTimeout(timeoutId));

  return signal;
}

/**
 * Validate query execution result against limits.
 */
export interface QueryValidationError {
  code: "TOO_MANY_ROWS" | "TOO_MANY_FIELDS" | "TIMEOUT" | "OUT_OF_MEMORY";
  message: string;
}

export function validateQueryResult(
  rowCount: number,
  fieldCount: number,
  limits: QueryLimits
): QueryValidationError | null {
  if (rowCount > limits.maxResultRows) {
    return {
      code: "TOO_MANY_ROWS",
      message: `查询结果超过限制（最多 ${limits.maxResultRows} 行，实际 ${rowCount} 行）。请添加筛选条件或限制返回条数。`,
    };
  }

  if (fieldCount > limits.maxFieldCount) {
    return {
      code: "TOO_MANY_FIELDS",
      message: `表字段过多（最多 ${limits.maxFieldCount} 个，实际 ${fieldCount} 个）。`,
    };
  }

  return null;
}

/**
 * Describe limits in human-readable format.
 */
export function describeLimits(limits: QueryLimits): string {
  return [
    `查询超时：${(limits.timeoutMs / 1000).toFixed(0)} 秒`,
    `最大内存：${limits.maxMemoryMb} MB`,
    `最多返回行数：${limits.maxResultRows}`,
  ].join("；");
}

/**
 * API-specific limits (stricter for user-facing endpoints).
 */
export const API_QUERY_LIMITS = {
  // User-facing analysis API
  analysis: {
    timeoutMs: 10_000, // 10 seconds
    maxMemoryMb: 256,
    maxResultRows: 1000,
    maxFieldCount: 50,
  } as QueryLimits,

  // AI planning (may need to profile dataset)
  ask: {
    timeoutMs: 15_000, // 15 seconds
    maxMemoryMb: 512,
    maxResultRows: 1000,
    maxFieldCount: 50,
  } as QueryLimits,

  // Profile endpoint (scans all files)
  profile: {
    timeoutMs: 30_000, // 30 seconds
    maxMemoryMb: 1024,
    maxResultRows: 10000,
    maxFieldCount: 100,
  } as QueryLimits,

  // Internal/administrative queries (should still be bounded)
  admin: {
    timeoutMs: 60_000, // 60 seconds
    maxMemoryMb: 2048,
    maxResultRows: 100_000,
    maxFieldCount: 200,
  } as QueryLimits,
};
