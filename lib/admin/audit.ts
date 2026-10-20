import { randomUUID } from "node:crypto";

export const ADMIN_AUDIT_VERSION = 1 as const;
export const ADMIN_AUDIT_RETENTION_DAYS = 180;
export const ADMIN_AUDIT_EVENT_LIMIT = 5_000;

export type AdminAuditScalar = string | number | boolean | null;
export type AdminAuditResult = "success" | "failure";
export type AdminAuditSource =
  | "accounts"
  | "datasets"
  | "grades"
  | "ai-config"
  | "analysis-settings";

export type AdminEventInput = {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary?: Record<string, AdminAuditScalar>;
  result?: AdminAuditResult;
  errorCode?: string;
  requestId?: string;
};

export type StoredAdminEvent = {
  version: typeof ADMIN_AUDIT_VERSION;
  id: string;
  timestamp: string;
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: Record<string, AdminAuditScalar>;
  result: AdminAuditResult;
  errorCode?: string;
  requestId?: string;
};

type AuditRule = { targetType: string; fields: readonly string[] };
const common = ["changedFields"] as const;
const enabled = ["beforeEnabled", "enabled"] as const;

/**
 * The action and target shape are part of the persistence boundary. Changes
 * outside these rules are ignored rather than allowing an accidental secret or
 * free-form request body into the audit store.
 */
export const ADMIN_AUDIT_RULES: Readonly<Record<string, AuditRule>> = {
  "user.admin_initialize": { targetType: "user", fields: ["role", ...common] },
  "user.create": { targetType: "user", fields: ["role", "datasetIds", ...common] },
  "user.disabled": { targetType: "user", fields: ["beforeDisabled", "disabled", ...common] },
  "user.update": {
    targetType: "user",
    fields: [
      "nameChanged",
      "beforeRole",
      "role",
      "beforeDisabled",
      "disabled",
      "beforeDatasetIds",
      "datasetIds",
      ...common,
    ],
  },
  "user.password.reset": { targetType: "user", fields: ["mustChangePassword", ...common] },
  "user.sessions.revoke": { targetType: "user", fields: common },
  "dataset.status": {
    targetType: "dataset",
    fields: ["beforeEnabled", "enabled", ...common],
  },
  "dataset.publish": {
    targetType: "dataset",
    fields: [
      "rowCount",
      "studentCount",
      "courseCount",
      "termCount",
      "missingScores",
      "versionNumber",
    ],
  },
  "ai-config.update": {
    targetType: "ai-config",
    fields: [
      ...enabled,
      "beforeApiFormat",
      "apiFormat",
      "beforeModel",
      "model",
      "keyChanged",
      "modelChanged",
      "endpointChanged",
      "beforePerRequest",
      "perRequest",
      "beforePerHour",
      "perHour",
      "beforePerDay",
      "perDay",
      "beforePerMonth",
      "perMonth",
      "beforeInputPerMillion",
      "inputPerMillion",
      "beforeOutputPerMillion",
      "outputPerMillion",
      ...common,
    ],
  },
  "analysis-capability.update": { targetType: "analysis-settings", fields: ["supported"] },
  "analysis-settings.update": {
    targetType: "analysis-settings",
    fields: [
      ...enabled,
      "beforeMaxToolCalls",
      "maxToolCalls",
      "beforeTimeoutSeconds",
      "timeoutSeconds",
      ...common,
    ],
  },
};

const roleValues = new Set(["admin", "user", "readonly"]);
const apiFormats = new Set(["responses", "chat_completions"]);
const changedFieldNames = new Set([
  "enabled",
  "apiFormat",
  "model",
  "apiKey",
  "budgets",
  "pricing",
  "maxToolCalls",
  "timeoutSeconds",
]);
const modelPattern = /^(?:[A-Za-z0-9][A-Za-z0-9._:-]{0,99})?$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const gradeDatasetIdPattern =
  /^grades_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const requestIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const errorCodePattern = /^[A-Z][A-Z0-9_]{0,79}$/;
const sensitiveValuePattern =
  /(?:password|passwd|secret|token|authorization|cookie|api[_-]?key|bearer\s+|sk-[A-Za-z0-9])/i;

function safeString(value: unknown, max = 256): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= max &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function safeSummaryString(field: string, value: unknown): value is string {
  // Empty grants, field lists and model names are meaningful state. Validate
  // the field rule before requiring a non-empty string. Dataset grant lists can
  // include the two builtins and up to 50 imported datasets.
  const datasetList = field === "datasetIds" || field === "beforeDatasetIds";
  if (
    typeof value !== "string" ||
    value.length > (datasetList ? 4096 : 256) ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    return false;
  if (datasetList)
    return (
      value === "" ||
      (value.split(",").length <= 52 &&
        value
          .split(",")
          .every((id) => id === "demo" || id === "oulad" || gradeDatasetIdPattern.test(id)))
    );
  if (field === "changedFields")
    return value === "" || value.split(",").every((name) => changedFieldNames.has(name));
  if (field === "model" || field === "beforeModel")
    return modelPattern.test(value) && !sensitiveValuePattern.test(value);
  if (field === "role" || field === "beforeRole")
    return roleValues.has(value) && !sensitiveValuePattern.test(value);
  if (field === "apiFormat" || field === "beforeApiFormat")
    return apiFormats.has(value) && !sensitiveValuePattern.test(value);
  return false;
}

function safeSummaryScalar(field: string, value: unknown): AdminAuditScalar | undefined {
  if (typeof value === "boolean" || value === null) return value;
  if (typeof value === "number")
    return Number.isFinite(value) && value >= 0 && value <= 1_000_000 ? value : undefined;
  return safeSummaryString(field, value) ? value : undefined;
}

function sanitizeSummary(action: string, summary: unknown): Record<string, AdminAuditScalar> {
  const rule = ADMIN_AUDIT_RULES[action];
  if (!rule || typeof summary !== "object" || summary === null || Array.isArray(summary))
    throw new Error("Admin audit summary is invalid.");
  const result: Record<string, AdminAuditScalar> = {};
  for (const [field, value] of Object.entries(summary)) {
    if (!rule.fields.includes(field)) throw new Error("Admin audit summary field is not allowed.");
    const safe = safeSummaryScalar(field, value);
    if (safe === undefined) throw new Error("Admin audit summary value is not allowed.");
    result[field] = safe;
  }
  return result;
}

function safeAuditTarget(action: string, targetId: string): boolean {
  if (action === "dataset.publish") return gradeDatasetIdPattern.test(targetId);
  if (action === "dataset.status")
    return targetId === "demo" || targetId === "oulad" || gradeDatasetIdPattern.test(targetId);
  return identifierPattern.test(targetId);
}

function parseStoredEvent(raw: unknown): StoredAdminEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const event = raw as Partial<StoredAdminEvent>;
  if (
    event.version !== ADMIN_AUDIT_VERSION ||
    !safeString(event.id, 128) ||
    !safeString(event.actorId, 128)
  )
    return null;
  if (!safeString(event.action, 100) || !ADMIN_AUDIT_RULES[event.action]) return null;
  const rule = ADMIN_AUDIT_RULES[event.action];
  if (
    event.targetType !== rule.targetType ||
    !safeString(event.targetId, 256) ||
    !safeAuditTarget(event.action, event.targetId)
  )
    return null;
  if (typeof event.timestamp !== "string" || !Number.isFinite(Date.parse(event.timestamp)))
    return null;
  if (event.result !== "success" && event.result !== "failure") return null;
  let summary: Record<string, AdminAuditScalar>;
  try {
    summary = sanitizeSummary(event.action, event.summary);
  } catch {
    return null;
  }
  if (
    event.errorCode !== undefined &&
    (typeof event.errorCode !== "string" || !errorCodePattern.test(event.errorCode))
  )
    return null;
  if (
    event.requestId !== undefined &&
    (typeof event.requestId !== "string" || !requestIdPattern.test(event.requestId))
  )
    return null;
  return {
    version: ADMIN_AUDIT_VERSION,
    id: event.id,
    timestamp: new Date(event.timestamp).toISOString(),
    actorId: event.actorId,
    action: event.action,
    targetType: event.targetType,
    targetId: event.targetId,
    summary,
    result: event.result,
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
    ...(event.requestId ? { requestId: event.requestId } : {}),
  };
}

export type AdminAuditReadResult = {
  store: { version: typeof ADMIN_AUDIT_VERSION; events: StoredAdminEvent[]; legacy?: unknown[] };
  events: StoredAdminEvent[];
  legacy: number;
  malformed: number;
};

/** Read-only normalization. It never trims or writes a source state file. */
export function readAdminAudit(raw: unknown): AdminAuditReadResult {
  const legacy: unknown[] = [];
  const malformedValues: unknown[] = [];
  const sourceEvents: unknown[] = [];
  if (raw === undefined) {
    return {
      store: { version: ADMIN_AUDIT_VERSION, events: [] },
      events: [],
      legacy: 0,
      malformed: 0,
    };
  }
  if (Array.isArray(raw)) sourceEvents.push(...raw);
  else if (typeof raw === "object" && raw !== null) {
    const value = raw as { version?: unknown; events?: unknown; legacy?: unknown };
    if (value.version === ADMIN_AUDIT_VERSION && Array.isArray(value.events)) {
      sourceEvents.push(...value.events);
      if (Array.isArray(value.legacy)) legacy.push(...value.legacy);
      else if (value.legacy !== undefined) malformedValues.push(value.legacy);
    } else {
      legacy.push(raw);
    }
  } else malformedValues.push(raw);

  const events: StoredAdminEvent[] = [];
  for (const value of sourceEvents) {
    const parsed = parseStoredEvent(value);
    if (parsed) events.push(parsed);
    else {
      malformedValues.push(value);
      legacy.push(value);
    }
  }
  return {
    store: {
      version: ADMIN_AUDIT_VERSION,
      events,
      ...(legacy.length ? { legacy: legacy.slice(0, ADMIN_AUDIT_EVENT_LIMIT) } : {}),
    },
    events,
    legacy: legacy.length,
    malformed: malformedValues.length,
  };
}

function createEvent(input: AdminEventInput): StoredAdminEvent | null {
  const rule = ADMIN_AUDIT_RULES[input.action];
  if (!rule || input.targetType !== rule.targetType) return null;
  if (!identifierPattern.test(input.actorId) || !safeAuditTarget(input.action, input.targetId))
    return null;
  if (input.result !== undefined && input.result !== "success" && input.result !== "failure")
    return null;
  if (input.requestId !== undefined && !requestIdPattern.test(input.requestId)) return null;
  if (input.errorCode !== undefined && !errorCodePattern.test(input.errorCode)) return null;
  let summary: Record<string, AdminAuditScalar>;
  try {
    summary = sanitizeSummary(input.action, input.summary ?? {});
  } catch {
    return null;
  }
  return {
    version: ADMIN_AUDIT_VERSION,
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    summary,
    result: input.result ?? "success",
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
    ...(input.requestId ? { requestId: input.requestId } : {}),
  };
}

/**
 * Mutate an embedded audit bucket in the caller's existing state transaction.
 * Invalid input and damaged versioned storage throw so the owning transaction
 * rolls back instead of silently losing a privileged action. Legacy buckets
 * are preserved as evidence while new events use the versioned envelope.
 */
export function appendAdminEvent(state: object, input: AdminEventInput): void {
  const event = createEvent(input);
  if (!event) throw new Error("Admin audit event is invalid.");
  const holder = state as { __adminAudit?: unknown };
  const raw = holder.__adminAudit;
  let current: AdminAuditReadResult;
  if (raw === undefined) {
    current = {
      store: { version: ADMIN_AUDIT_VERSION, events: [] },
      events: [],
      legacy: 0,
      malformed: 0,
    };
  } else if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    (raw as { version?: unknown }).version === ADMIN_AUDIT_VERSION &&
    Array.isArray((raw as { events?: unknown }).events)
  ) {
    current = readAdminAudit(raw);
    // A current envelope with any malformed event is unsafe to rewrite: doing
    // so would erase evidence that this process could not parse.
    if (current.malformed > 0) throw new Error("Admin audit storage is malformed.");
  } else {
    // Never overwrite an unrecognized or legacy bucket. Retain it verbatim.
    current = readAdminAudit(raw);
  }
  const cutoff = Date.now() - ADMIN_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1_000;
  const retained = [...current.events, event]
    .filter((candidate) => Date.parse(candidate.timestamp) >= cutoff)
    .sort(
      (left, right) =>
        left.timestamp.localeCompare(right.timestamp) || left.id.localeCompare(right.id),
    )
    .slice(-ADMIN_AUDIT_EVENT_LIMIT);
  const legacy: unknown[] = [];
  if (Array.isArray(raw)) legacy.push(...raw);
  else if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const value = raw as { version?: unknown; events?: unknown; legacy?: unknown };
    if (value.version !== ADMIN_AUDIT_VERSION || !Array.isArray(value.events)) legacy.push(raw);
    else if (Array.isArray(value.legacy)) legacy.push(...value.legacy);
    else if (value.legacy !== undefined) legacy.push(value.legacy);
    for (const candidate of value.version === ADMIN_AUDIT_VERSION && Array.isArray(value.events)
      ? value.events
      : [])
      if (!parseStoredEvent(candidate)) legacy.push(candidate);
  } else if (raw !== undefined) legacy.push(raw);
  holder.__adminAudit = {
    version: ADMIN_AUDIT_VERSION,
    events: retained,
    ...(legacy.length ? { legacy: legacy.slice(0, ADMIN_AUDIT_EVENT_LIMIT) } : {}),
  };
}

export function auditEventFromStored(source: AdminAuditSource, event: StoredAdminEvent) {
  return { ...event, source };
}
