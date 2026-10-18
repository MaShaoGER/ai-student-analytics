import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { validateQueryResult, type QueryLimits } from "./query-limits";

export type QueryExecutionErrorCode =
  | "TIMEOUT"
  | "CANCELLED"
  | "OUT_OF_MEMORY"
  | "TOO_MANY_ROWS"
  | "TOO_MANY_FIELDS"
  // Data files are missing/unreadable. Separate from query failures so the user
  // and administrator are pointed at the data source instead of the AI provider.
  | "DATA_SOURCE_UNAVAILABLE";

export class QueryExecutionError extends Error {
  constructor(
    public readonly code: QueryExecutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "QueryExecutionError";
  }
}

export interface QueryExecutionOptions {
  signal?: AbortSignal;
  /** May shorten the server's deadline, but cannot increase it. */
  timeoutMs?: number;
}

export type QueryExecutor = (query: string) => Promise<Record<string, unknown>[]>;

export function assertQueryResultLimits(
  rowCount: number,
  fieldCount: number,
  limits: QueryLimits,
): void {
  const error = validateQueryResult(rowCount, fieldCount, limits);
  if (error) throw new QueryExecutionError(error.code, error.message);
}

function executionTimeout(limits: QueryLimits, options: QueryExecutionOptions): number {
  if (options.timeoutMs === undefined) return limits.timeoutMs;
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new RangeError("查询超时必须是大于 0 的有限数值。");
  }
  return Math.min(options.timeoutMs, limits.timeoutMs);
}

/**
 * Each operation owns a bounded in-memory database. Cancellation interrupts
 * native work and waits for its promise to settle before closing the handles.
 */
export async function withBoundedQueryConnection<T>(
  callback: (sql: QueryExecutor) => Promise<T>,
  limits: QueryLimits,
  options: QueryExecutionOptions = {},
): Promise<T> {
  const timeoutMs = executionTimeout(limits, options);
  const deadline = performance.now() + timeoutMs;
  let instance: DuckDBInstance | undefined;
  let connection: DuckDBConnection | undefined;
  let stopped: QueryExecutionError | undefined;
  let interruptRetry: ReturnType<typeof setInterval> | undefined;
  const pendingQueries = new Set<Promise<Record<string, unknown>[]>>();

  const interruptUntilSettled = () => {
    connection?.interrupt();
    if (interruptRetry || pendingQueries.size === 0) return;
    // Native query submission is asynchronous. DuckDB resets its interrupted
    // state when a queued query actually starts, so an interrupt delivered
    // between submission and worker startup can be lost. Keep cancellation
    // asserted until all submitted native work has acknowledged it.
    interruptRetry = setInterval(() => {
      if (pendingQueries.size === 0) {
        clearInterval(interruptRetry);
        interruptRetry = undefined;
        return;
      }
      connection?.interrupt();
    }, 10);
  };

  const stop = (code: "TIMEOUT" | "CANCELLED") => {
    if (stopped) return;
    stopped = new QueryExecutionError(
      code,
      code === "CANCELLED"
        ? "分析已取消。"
        : `查询超时（${timeoutMs / 1000} 秒）。请简化查询或添加筛选条件。`,
    );
    interruptUntilSettled();
  };
  const onAbort = () => stop("CANCELLED");
  const checkStopped = () => {
    if (options.signal?.aborted) onAbort();
    if (performance.now() >= deadline) stop("TIMEOUT");
    if (stopped) throw stopped;
  };

  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => stop("TIMEOUT"), timeoutMs);
  try {
    checkStopped();
    instance = await DuckDBInstance.create(":memory:", {
      threads: "2",
      memory_limit: `${limits.maxMemoryMb}MB`,
      // Keep temporary query data off disk; exhausting this operation's memory
      // budget must fail explicitly rather than grow an unbounded spill file.
      temp_directory: "",
    });
    checkStopped();
    connection = await instance.connect();
    checkStopped();
    const queryConnection = connection;
    const sql: QueryExecutor = (query) => {
      const operation = (async () => {
        checkStopped();
        const reader = await queryConnection.runAndRead(query);
        checkStopped();
        assertQueryResultLimits(0, reader.columnCount, limits);
        // Bound conversion to JavaScript objects. Read one extra row to detect
        // overflow; DuckDB returns whole chunks, which may contain more rows.
        await reader.readUntil(limits.maxResultRows + 1);
        checkStopped();
        assertQueryResultLimits(reader.currentRowCount, reader.columnCount, limits);
        const rows = reader.getRowObjectsJson() as Record<string, unknown>[];
        checkStopped();
        return rows;
      })();
      pendingQueries.add(operation);
      void operation.then(
        () => pendingQueries.delete(operation),
        () => pendingQueries.delete(operation),
      );
      return operation;
    };

    const result = await callback(sql);
    checkStopped();
    return result;
  } catch (error) {
    if (stopped) throw stopped;
    if (error instanceof QueryExecutionError) throw error;
    if (error instanceof Error && /out of memory|failed to allocate/i.test(error.message)) {
      throw new QueryExecutionError(
        "OUT_OF_MEMORY",
        "查询超过内存限制。请缩小数据范围或简化查询。",
      );
    }
    throw error;
  } finally {
    // A callback can fail while another SQL call is still running. Interrupt
    // and drain it before native handles are destroyed.
    if (pendingQueries.size > 0) {
      interruptUntilSettled();
      await Promise.allSettled(pendingQueries);
    }
    clearInterval(interruptRetry);
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    try {
      connection?.closeSync();
    } finally {
      instance?.closeSync();
    }
  }
}
