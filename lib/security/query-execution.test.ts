import { DuckDBConnection, DuckDBInstance } from "@duckdb/node-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_QUERY_LIMITS } from "./query-limits";
import { QueryExecutionError, withBoundedQueryConnection } from "./query-execution";

const limits = { ...DEFAULT_QUERY_LIMITS, timeoutMs: 5_000, maxMemoryMb: 64 };
// A trillion combinations cannot finish within the test's deadline. It returns
// only one aggregate row, so a row limit cannot accidentally short-circuit it.
const heavyQuery =
  "SELECT SUM(a.i * b.i) AS total FROM range(1000000) a(i) CROSS JOIN range(1000000) b(i)";

afterEach(() => vi.restoreAllMocks());

function observeNativeLifecycle(delayDispatchMs = 0) {
  let started = false;
  let dispatched = false;
  let settled = false;
  let nativeFailure: unknown;
  const originalRun = DuckDBConnection.prototype.runAndRead;
  vi.spyOn(DuckDBConnection.prototype, "runAndRead").mockImplementation(async function (
    this: DuckDBConnection,
    query,
  ) {
    if (query !== heavyQuery) return originalRun.call(this, query);
    started = true;
    try {
      // Hold dispatch to reproduce a busy native worker queue deterministically.
      // The query itself still executes through the real native DuckDB driver.
      if (delayDispatchMs) await new Promise((resolve) => setTimeout(resolve, delayDispatchMs));
      dispatched = true;
      return await originalRun.call(this, query);
    } catch (error) {
      nativeFailure = error;
      throw error;
    } finally {
      settled = true;
    }
  });
  const originalClose = DuckDBConnection.prototype.closeSync;
  const close = vi.spyOn(DuckDBConnection.prototype, "closeSync").mockImplementation(function (
    this: DuckDBConnection,
  ) {
    // Calling disconnect while a native worker still holds this connection is
    // the lifecycle bug the old Promise.race implementation could trigger.
    if (started) expect(settled).toBe(true);
    return originalClose.call(this);
  });
  const interrupt = vi.spyOn(DuckDBConnection.prototype, "interrupt");
  return {
    close,
    interrupt,
    hasStarted: () => started,
    hasDispatched: () => dispatched,
    hasSettled: () => settled,
    nativeFailure: () => nativeFailure,
  };
}

async function expectNextQueryToWork() {
  const rows = await withBoundedQueryConnection((sql) => sql("SELECT 42 AS recovered"), limits);
  expect(rows).toEqual([{ recovered: 42 }]);
}

describe("bounded native DuckDB execution", () => {
  it("configures engine memory and disables temporary disk spills", async () => {
    const [settings] = await withBoundedQueryConnection(
      (sql) =>
        sql(
          "SELECT current_setting('memory_limit') AS memory, current_setting('temp_directory') AS temp, current_setting('threads') AS threads",
        ),
      limits,
    );
    // DuckDB formats decimal MB as binary MiB, with one decimal place.
    expect(parseFloat(String(settings.memory))).toBeCloseTo((64 * 1_000_000) / 2 ** 20, 0);
    expect(settings.temp).toBe("");
    expect(Number(settings.threads)).toBe(2);
  });

  it("interrupts a running heavy query on timeout and settles it before closing", async () => {
    const lifecycle = observeNativeLifecycle();
    const startedAt = performance.now();
    await expect(
      withBoundedQueryConnection(
        async (sql) => {
          await sql("SELECT 1 AS ready");
          return sql(heavyQuery);
        },
        limits,
        { timeoutMs: 100 },
      ),
    ).rejects.toMatchObject({
      name: "QueryExecutionError",
      code: "TIMEOUT",
    });
    expect(lifecycle.hasStarted()).toBe(true);
    expect(lifecycle.hasSettled()).toBe(true);
    expect(lifecycle.interrupt).toHaveBeenCalled();
    expect(lifecycle.nativeFailure()).toHaveProperty(
      "message",
      expect.stringMatching(/interrupt/i),
    );
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(performance.now() - startedAt).toBeLessThan(2_000);
    await expectNextQueryToWork();
  });

  it("interrupts an in-flight query on AbortSignal cancellation", async () => {
    const lifecycle = observeNativeLifecycle();
    const controller = new AbortController();
    let cancelTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(
        withBoundedQueryConnection(
          async (sql) => {
            await sql("SELECT 1 AS ready");
            cancelTimer = setTimeout(() => controller.abort(), 40);
            return sql(heavyQuery);
          },
          limits,
          { signal: controller.signal },
        ),
      ).rejects.toMatchObject({
        name: "QueryExecutionError",
        code: "CANCELLED",
      });
    } finally {
      clearTimeout(cancelTimer);
    }
    expect(lifecycle.hasStarted()).toBe(true);
    expect(lifecycle.hasSettled()).toBe(true);
    expect(lifecycle.interrupt).toHaveBeenCalled();
    expect(lifecycle.nativeFailure()).toHaveProperty(
      "message",
      expect.stringMatching(/interrupt/i),
    );
    expect(lifecycle.close).toHaveBeenCalledOnce();
    await expectNextQueryToWork();
  });

  it("rejects an already cancelled operation before opening a database", async () => {
    const create = vi.spyOn(DuckDBInstance, "create");
    const controller = new AbortController();
    controller.abort();
    await expect(
      withBoundedQueryConnection((sql) => sql("SELECT 1"), limits, {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(create).not.toHaveBeenCalled();
  });

  it("cannot extend the configured server deadline", async () => {
    const lifecycle = observeNativeLifecycle();
    await expect(
      withBoundedQueryConnection(
        async (sql) => {
          await sql("SELECT 1 AS ready");
          return sql(heavyQuery);
        },
        { ...limits, timeoutMs: 100 },
        { timeoutMs: 60_000 },
      ),
    ).rejects.toMatchObject({
      code: "TIMEOUT",
    });
    expect(lifecycle.interrupt).toHaveBeenCalled();
  });

  it("returns a typed memory error when the real engine exhausts its budget", async () => {
    await expect(
      withBoundedQueryConnection(
        (sql) => sql("SELECT COUNT(DISTINCT i) FROM range(10000000) t(i)"),
        { ...limits, maxMemoryMb: 16 },
      ),
    ).rejects.toMatchObject({ name: "QueryExecutionError", code: "OUT_OF_MEMORY" });
    await expectNextQueryToWork();
  });

  it("rejects real result row overflow before converting all rows to objects", async () => {
    await expect(
      withBoundedQueryConnection((sql) => sql("SELECT i FROM range(101) t(i)"), {
        ...limits,
        maxResultRows: 100,
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_ROWS" });
  });

  it("checks result fields even when the result has no rows", async () => {
    await expect(
      withBoundedQueryConnection((sql) => sql("SELECT 1 AS first, 2 AS second WHERE false"), {
        ...limits,
        maxFieldCount: 1,
      }),
    ).rejects.toMatchObject({ code: "TOO_MANY_FIELDS" });
  });

  it("drains an outstanding native query if the callback fails", async () => {
    const lifecycle = observeNativeLifecycle(50);
    const startedAt = performance.now();
    await expect(
      withBoundedQueryConnection(async (sql) => {
        await sql("SELECT 1 AS ready");
        void sql(heavyQuery);
        throw new Error("callback failed");
      }, limits),
    ).rejects.toThrow("callback failed");
    expect(lifecycle.hasDispatched()).toBe(true);
    expect(lifecycle.hasSettled()).toBe(true);
    expect(lifecycle.interrupt.mock.calls.length).toBeGreaterThan(1);
    expect(lifecycle.nativeFailure()).toHaveProperty(
      "message",
      expect.stringMatching(/interrupt/i),
    );
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(performance.now() - startedAt).toBeLessThan(1_000);
    await expectNextQueryToWork();
  });

  it("keeps cancellation asserted if the worker starts after the initial interrupt", async () => {
    const lifecycle = observeNativeLifecycle(50);
    const controller = new AbortController();
    const startedAt = performance.now();
    await expect(
      withBoundedQueryConnection(
        async (sql) => {
          await sql("SELECT 1 AS ready");
          const pending = sql(heavyQuery);
          expect(lifecycle.hasDispatched()).toBe(false);
          controller.abort();
          return pending;
        },
        limits,
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ code: "CANCELLED" });
    expect(lifecycle.hasDispatched()).toBe(true);
    expect(lifecycle.hasSettled()).toBe(true);
    expect(lifecycle.interrupt.mock.calls.length).toBeGreaterThan(1);
    expect(lifecycle.nativeFailure()).toHaveProperty(
      "message",
      expect.stringMatching(/interrupt/i),
    );
    expect(lifecycle.close).toHaveBeenCalledOnce();
    expect(performance.now() - startedAt).toBeLessThan(1_000);
    await expectNextQueryToWork();
  });

  it.each([0, -1, NaN, Infinity])("rejects invalid timeout %s", async (timeoutMs) => {
    await expect(
      withBoundedQueryConnection((sql) => sql("SELECT 1"), limits, { timeoutMs }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("preserves a stable error type and code for HTTP callers", () => {
    const error = new QueryExecutionError("CANCELLED", "分析已取消。");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("QueryExecutionError");
    expect(error.code).toBe("CANCELLED");
  });
});
