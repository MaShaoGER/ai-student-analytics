import {
  ADMIN_AUDIT_VERSION,
  auditEventFromStored,
  readAdminAudit,
  type AdminAuditResult,
  type AdminAuditSource,
} from "./audit";
import { readState } from "../settings/storage";

export const ADMIN_AUDIT_SOURCES: readonly AdminAuditSource[] = [
  "accounts",
  "datasets",
  "ai-config",
  "analysis-settings",
];
const SOURCE_FILES: Record<AdminAuditSource, string> = {
  accounts: "accounts.json",
  datasets: "datasets.json",
  "ai-config": "ai-config.json",
  "analysis-settings": "analysis-settings.json",
};
const SOURCE_LIMIT = 5_000;
const MAX_FILTER_LENGTH = 256;
const ACTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

export type AdminLogEvent = ReturnType<typeof auditEventFromStored>;
export type AdminLogFilter = {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  actorId?: string;
  action?: string;
  result?: AdminAuditResult;
};
export type AdminLogSourceCoverage = {
  source: AdminAuditSource;
  status: "ok" | "missing" | "invalid";
  events: number;
  legacy: number;
};
export type AdminLogQuery = {
  events: AdminLogEvent[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    from: string | null;
    to: string | null;
    actorId: string | null;
    action: string | null;
    result: AdminAuditResult | null;
  };
  coverage: { sources: AdminLogSourceCoverage[] };
};

export class AdminLogQueryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AdminLogQueryError";
  }
}

function boundedText(value: string | null, name: string): string | undefined {
  if (value === null || value === "") return undefined;
  if (value.length > MAX_FILTER_LENGTH || /[\u0000-\u001f\u007f]/.test(value))
    throw new AdminLogQueryError("INVALID_QUERY", `${name} 参数格式不正确。`);
  return value;
}

function positiveInteger(
  value: string | null,
  fallback: number,
  max: number,
  name: string,
): number {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value))
    throw new AdminLogQueryError("INVALID_QUERY", `${name} 参数必须是整数。`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > max)
    throw new AdminLogQueryError("INVALID_QUERY", `${name} 参数超出允许范围。`);
  return number;
}

function isoBoundary(value: string | null, name: string): string | undefined {
  const text = boundedText(value, name);
  if (!text) return undefined;
  const timestamp = Date.parse(text);
  if (!Number.isFinite(timestamp))
    throw new AdminLogQueryError("INVALID_QUERY", `${name} 参数不是有效时间。`);
  return new Date(timestamp).toISOString();
}

/** Parse once at the route boundary; repeated keys are rejected. */
export function parseAdminLogQuery(searchParams: URLSearchParams): AdminLogFilter {
  const seen = new Set<string>();
  for (const key of searchParams.keys()) {
    if (!["page", "pageSize", "from", "to", "actorId", "action", "result"].includes(key))
      throw new AdminLogQueryError("INVALID_QUERY", "包含未知的查询参数。");
    if (seen.has(key)) throw new AdminLogQueryError("INVALID_QUERY", "查询参数不能重复。");
    seen.add(key);
  }
  const page = positiveInteger(searchParams.get("page"), 1, 1_000_000, "page");
  const pageSize = positiveInteger(searchParams.get("pageSize"), 25, 100, "pageSize");
  const from = isoBoundary(searchParams.get("from"), "from");
  const to = isoBoundary(searchParams.get("to"), "to");
  if (from && to && Date.parse(from) >= Date.parse(to))
    throw new AdminLogQueryError("INVALID_QUERY", "from 必须早于 to。");
  const actorId = boundedText(searchParams.get("actorId"), "actorId");
  const action = boundedText(searchParams.get("action"), "action");
  if (actorId && !IDENTIFIER_PATTERN.test(actorId))
    throw new AdminLogQueryError("INVALID_QUERY", "actorId 参数格式不正确。");
  if (action && !ACTION_PATTERN.test(action))
    throw new AdminLogQueryError("INVALID_QUERY", "action 参数格式不正确。");
  const resultValue = searchParams.get("result");
  if (resultValue !== null && resultValue !== "success" && resultValue !== "failure")
    throw new AdminLogQueryError("INVALID_QUERY", "result 只能是 success 或 failure。");
  return {
    page,
    pageSize,
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(actorId ? { actorId } : {}),
    ...(action ? { action } : {}),
    ...(resultValue ? { result: resultValue } : {}),
  };
}

function sourceState(name: string): { status: "ok" | "missing" | "invalid"; raw: unknown } {
  try {
    return { status: "ok", raw: readState<unknown>(name, () => undefined) };
  } catch {
    return { status: "invalid", raw: undefined };
  }
}

/** Every source is read independently, so one damaged file does not erase others. */
export function collectAdminEvents(): {
  events: AdminLogEvent[];
  coverage: { sources: AdminLogSourceCoverage[] };
} {
  const events: AdminLogEvent[] = [];
  const sources: AdminLogSourceCoverage[] = [];
  for (const source of ADMIN_AUDIT_SOURCES) {
    const state = sourceState(SOURCE_FILES[source]);
    if (state.status === "invalid") {
      sources.push({ source, status: "invalid", events: 0, legacy: 0 });
      continue;
    }
    if (state.raw === undefined) {
      sources.push({ source, status: "missing", events: 0, legacy: 0 });
      continue;
    }
    if (typeof state.raw !== "object" || state.raw === null || Array.isArray(state.raw)) {
      sources.push({ source, status: "invalid", events: 0, legacy: 0 });
      continue;
    }
    const audit = readAdminAudit((state.raw as { __adminAudit?: unknown }).__adminAudit);
    // A non-versioned bucket remains visible as coverage rather than being
    // silently treated as an empty log.
    for (const event of audit.events.slice(-SOURCE_LIMIT))
      events.push(auditEventFromStored(source, event));
    sources.push({
      source,
      status: audit.malformed > 0 ? "invalid" : "ok",
      events: audit.events.length,
      legacy: audit.legacy,
    });
  }
  return { events, coverage: { sources } };
}

export function queryAdminLogs(
  filter: AdminLogFilter,
  collected = collectAdminEvents(),
): AdminLogQuery {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 25;
  const fromMs = filter.from ? Date.parse(filter.from) : null;
  const toMs = filter.to ? Date.parse(filter.to) : null;
  const matches = collected.events
    .filter((event) => {
      const timestamp = Date.parse(event.timestamp);
      return (
        (fromMs === null || timestamp >= fromMs) &&
        (toMs === null || timestamp < toMs) &&
        (!filter.actorId || event.actorId === filter.actorId) &&
        (!filter.action || event.action === filter.action) &&
        (!filter.result || event.result === filter.result)
      );
    })
    .sort(
      (left, right) =>
        right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id),
    );
  return {
    events: matches.slice((page - 1) * pageSize, page * pageSize),
    total: matches.length,
    page,
    pageSize,
    filters: {
      from: filter.from ?? null,
      to: filter.to ?? null,
      actorId: filter.actorId ?? null,
      action: filter.action ?? null,
      result: filter.result ?? null,
    },
    coverage: collected.coverage,
  };
}

export { ADMIN_AUDIT_VERSION };
