import { closeSync, fstatSync, openSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { UserRole } from "../client-types";
import { listManagedDatasets } from "../datasets/service";
import { getStateDirectory, readState } from "../settings/storage";

export const overviewWindowSchema = z.enum(["today", "7d", "30d"]);
export type OverviewWindow = z.infer<typeof overviewWindowSchema>;
const DAY = 86_400_000;
export const MAX_RECORD_BYTES = 4 * 1024 * 1024;
export const MAX_RECORD_LINES = 20_000;
const MAX_STATE_BYTES = 16 * 1024 * 1024;
const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

export function overviewRange(window: OverviewWindow, now = new Date()) {
  const count = window === "today" ? 1 : window === "7d" ? 7 : 30;
  const shifted = now.getTime() + 8 * 3_600_000;
  const start = Math.floor(shifted / DAY) * DAY - 8 * 3_600_000 - (count - 1) * DAY;
  return {
    start: new Date(start).toISOString(),
    end: now.toISOString(),
    timezone: "Asia/Shanghai" as const,
  };
}

/** Read a bounded tail without loading an unbounded legacy JSONL file. */
export function readOverviewRecords() {
  const file = path.join(
    path.resolve(/* turbopackIgnore: true */ process.env.ANALYSIS_RECORDS_DIR || "records"),
    "analysis.jsonl",
  );
  const coverage = {
    scanned: 0,
    valid: 0,
    malformed: 0,
    legacy: 0,
    truncatedTail: false,
    status: "ok" as "ok" | "missing" | "invalid",
  };
  const records: Record<string, unknown>[] = [];
  let descriptor: number | undefined;
  try {
    descriptor = openSync(/* turbopackIgnore: true */ file, "r");
    const size = fstatSync(descriptor).size;
    const start = Math.max(0, size - MAX_RECORD_BYTES);
    const buffer = Buffer.alloc(Math.min(size, MAX_RECORD_BYTES));
    const bytes = readSync(descriptor, buffer, 0, buffer.length, start);
    let content = buffer.subarray(0, bytes).toString("utf8");
    coverage.truncatedTail = start > 0;
    if (start > 0) content = content.slice(content.indexOf("\n") + 1);
    let lines = content.split("\n").filter((line) => line.trim());
    if (lines.length > MAX_RECORD_LINES) {
      lines = lines.slice(-MAX_RECORD_LINES);
      coverage.truncatedTail = true;
    }
    coverage.scanned = lines.length;
    for (const line of lines) {
      try {
        const row: unknown = JSON.parse(line);
        if (
          !object(row) ||
          typeof row.timestamp !== "string" ||
          !Number.isFinite(Date.parse(row.timestamp)) ||
          !object(row.result)
        ) {
          coverage.malformed++;
          continue;
        }
        coverage.valid++;
        if (
          typeof row.requestId !== "string" ||
          !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(row.requestId)
        )
          coverage.legacy++;
        records.push(row);
      } catch {
        coverage.malformed++;
      }
    }
  } catch (error) {
    coverage.status = (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "invalid";
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  return { records, coverage };
}

export function summarizeRequests(records: Record<string, unknown>[], start: number, end: number) {
  const groups = new Map<string, Record<string, unknown>[]>();
  let legacyWithoutRequestId = 0;
  for (const row of records) {
    const time = Date.parse(String(row.timestamp));
    if (time < start || time >= end) continue;
    if (
      typeof row.requestId !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(row.requestId)
    ) {
      legacyWithoutRequestId++;
      continue;
    }
    const group = groups.get(row.requestId) ?? [];
    group.push(row);
    groups.set(row.requestId, group);
  }
  let success = 0,
    partial = 0,
    failure = 0;
  const durations: number[] = [];
  for (const rows of groups.values()) {
    // Explicit terminal outcomes take precedence over intermediate stage rows.
    const ordered = [...rows].sort(
      (a, b) => Date.parse(String(a.timestamp)) - Date.parse(String(b.timestamp)),
    );
    const terminal =
      ordered
        .filter((row) => ["success", "partial", "failure"].includes(String(row.outcome)))
        .at(-1) ?? ordered.at(-1)!;
    const result = object(terminal.result) ? terminal.result : {};
    const outcome =
      terminal.outcome ??
      (terminal.errorCode
        ? finite(result.rowCount) && result.rowCount > 0
          ? "partial"
          : "failure"
        : terminal.stage === "execution"
          ? "success"
          : "partial");
    if (outcome === "success") success++;
    else if (outcome === "partial") partial++;
    else failure++;
    if (finite(result.durationMs)) durations.push(result.durationMs);
  }
  durations.sort((a, b) => a - b);
  const total = groups.size;
  return {
    total,
    success,
    partial,
    failure,
    successRate: total ? success / total : null,
    partialRate: total ? partial / total : null,
    failureRate: total ? failure / total : null,
    legacyWithoutRequestId,
    durationMs: {
      samples: durations.length,
      p95: durations.length >= 20 ? durations[Math.ceil(durations.length * 0.95) - 1] : null,
    },
  };
}

function boundedState(name: string): unknown {
  try {
    if (
      statSync(/* turbopackIgnore: true */ path.join(getStateDirectory(), name)).size >
      MAX_STATE_BYTES
    )
      throw new Error("State exceeds overview read limit.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  return readState<unknown>(name, () => undefined);
}

export function summarizeCosts(raw: unknown, start: number, end: number) {
  const ai = {
    calls: 0,
    estimatedCalls: 0,
    measuredCalls: 0,
    costUsd: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    estimated: true as const,
  };
  const coverage = {
    status: raw === undefined ? ("missing" as const) : ("ok" as "ok" | "missing" | "invalid"),
    records: 0,
    malformed: 0,
  };
  if (raw === undefined) return { ai, coverage };
  if (!object(raw) || !Array.isArray(raw.records)) {
    coverage.status = "invalid";
    return { ai, coverage };
  }
  coverage.records = raw.records.length;
  for (const row of raw.records) {
    if (
      !object(row) ||
      !finite(row.timestamp) ||
      !object(row.cost) ||
      !finite(row.cost.totalCost) ||
      !object(row.usage) ||
      ![row.usage.promptTokens, row.usage.completionTokens, row.usage.totalTokens].every(finite)
    ) {
      coverage.malformed++;
      continue;
    }
    if (row.timestamp < start || row.timestamp >= end) continue;
    ai.calls++;
    if (row.usageEstimated === true) ai.estimatedCalls++;
    else ai.measuredCalls++;
    ai.costUsd += row.cost.totalCost;
    ai.promptTokens += row.usage.promptTokens as number;
    ai.completionTokens += row.usage.completionTokens as number;
    ai.totalTokens += row.usage.totalTokens as number;
  }
  if (coverage.malformed) coverage.status = "invalid";
  ai.costUsd = Number(ai.costUsd.toFixed(8));
  return { ai, coverage };
}

export function getAdminOverview(window: OverviewWindow = "7d", now = new Date()) {
  const range = overviewRange(window, now),
    start = Date.parse(range.start),
    end = Date.parse(range.end);
  const raw = boundedState("accounts.json");
  if (!object(raw) || !Array.isArray(raw.users))
    throw new Error("Account state unavailable for overview.");
  const accounts = {
    total: raw.users.length,
    active: 0,
    disabled: 0,
    byRole: { admin: 0, user: 0, readonly: 0 },
    mustChangePassword: 0,
  };
  for (const user of raw.users) {
    if (
      !object(user) ||
      !["admin", "user", "readonly"].includes(String(user.role)) ||
      typeof user.disabled !== "boolean"
    )
      throw new Error("Account state invalid for overview.");
    accounts.byRole[user.role as UserRole]++;
    if (user.disabled) accounts.disabled++;
    else accounts.active++;
    if (user.mustChangePassword === true) accounts.mustChangePassword++;
  }
  const catalog = listManagedDatasets();
  const datasets = {
    total: catalog.length,
    enabled: catalog.filter((d) => d.enabled).length,
    available: catalog.filter((d) => d.available).length,
    unavailable: catalog.filter((d) => !d.available).length,
  };
  const analysis = readOverviewRecords();
  let costs: ReturnType<typeof summarizeCosts>;
  try {
    costs = summarizeCosts(boundedState("cost-history.json"), start, end);
  } catch {
    costs = summarizeCosts(null, start, end);
  }
  return {
    updatedAt: now.toISOString(),
    window,
    range,
    accounts,
    datasets,
    requests: summarizeRequests(analysis.records, start, end),
    ai: costs.ai,
    coverage: {
      records: analysis.coverage,
      costHistory: costs.coverage,
      limitations: [
        "分析请求仅覆盖已落盘的 /api/analysis、/api/ask、/api/chat，不含画像或图表 GET 流量；无 requestId 的旧记录单独列示，不推算历史请求总数。",
        "同一 requestId 的显式终态优先；旧记录按最后阶段、错误和已有结果保守推断。耗时为最后终态的已记录耗时，P95 至少需要 20 个样本。",
        "模型调用数与业务请求数分别计算；费用全部为估算，不是供应商账单。无法可靠区分的评测、工具检测及连接测试可能混入模型用量。",
        "分析记录最多读取末尾 4 MiB / 20,000 行；超过上限仅代表该尾部窗口。账号与费用文件读取上限各 16 MiB。数据集可用性仅检查必需文件存在且可读，不代表数据质量或实时健康监控。",
        ...(analysis.coverage.status === "invalid"
          ? ["分析记录读取失败，当前请求计数不能代表实际业务。"]
          : []),
        ...(analysis.coverage.malformed ? ["部分分析记录损坏，已排除并计数。"] : []),
        ...(costs.coverage.status === "invalid"
          ? ["费用记录部分或全部不可读，当前用量不能代表完整费用。"]
          : []),
      ],
    },
  };
}
