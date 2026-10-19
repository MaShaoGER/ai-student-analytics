# Stage 4 admin metrics and audit API contract

Admin-only, read-only aggregate APIs. Both responses use `Cache-Control: no-store`.

`updatedAt` is the server observation time in ISO UTC. Request outcome classification prefers a persisted, validated `outcome` (`success`, `partial`, or `failure`); older rows without it use the disclosed legacy heuristic.

## `GET /api/admin/overview?window=today|7d|30d`

Default window: `7d`. `today`, `7d`, and `30d` start at Asia/Shanghai calendar-day boundaries; the range end is the observation time and is exclusive.

```ts
type OverviewResponse = {
  updatedAt: string;
  window: "today" | "7d" | "30d";
  updatedAt: string;
  range: { start: string; end: string; timezone: "Asia/Shanghai" };
  accounts: {
    total: number;
    active: number;
    disabled: number;
    byRole: { admin: number; user: number; readonly: number };
    mustChangePassword: number;
  };
  datasets: { total: number; enabled: number; available: number; unavailable: number };
  requests: {
    total: number;
    success: number;
    partial: number;
    failure: number;
    successRate: number | null;
    partialRate: number | null;
    failureRate: number | null;
    legacyWithoutRequestId: number;
    durationMs: { p95: number | null; samples: number };
  };
  ai: {
    calls: number;
    estimatedCalls: number;
    measuredCalls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costUsd: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimated: true;
  };
  coverage: {
    records: {
      status: "ok" | "missing" | "invalid";
      scanned: number;
      valid: number;
      malformed: number;
      legacy: number;
      truncatedTail: boolean;
    };
    costHistory: { status: "ok" | "missing" | "invalid"; records: number; malformed: number };
    limitations: string[];
  };
};
```

Counts are aggregate only. `requests.total` counts unique in-window request IDs; rows without a request ID are reported as legacy evidence and are not assigned an invented identity. Each request ID is reconciled across stages. A validated persisted `outcome` is authoritative. For older rows without it, any failure is `failure`; evidence of a non-terminal/cancelled step or a missing completion timestamp is `partial`; otherwise execution evidence is `success`. Response limitations disclose when historical rows use this fallback.

`ai.calls`, estimated/measured call counts, token totals, and cost come from persisted `records/system/cost-history.json`. They are model-call counts, not business requests, and cost is an estimate.

Request coverage is limited to audited business calls to `/api/analysis`, `/api/ask`, and `/api/chat`. Deterministic chart/profile GET endpoints are not individually audited in this stage. Evaluation and connection probes are included in AI calls when their cost-history records fall in the window; request statistics do not claim to identify them as user traffic.

## `GET /api/admin/logs`

Query parameters are optional unless stated: `page=1`, `pageSize=25` (1–100), `from` and `to` (ISO date/time; `to` is exclusive), `actorId`, `action`, and `result=success|failure`. Invalid or repeated parameters return `400 INVALID_QUERY`.

```ts
type LogsResponse = {
  events: Array<{
    version: 1;
    id: string;
    timestamp: string;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    summary: Record<string, string | number | boolean | null>;
    result: "success" | "failure";
    errorCode?: string;
    requestId?: string;
    source: "accounts" | "datasets" | "ai-config" | "analysis-settings";
  }>;
  total: number;
  page: number;
  pageSize: number;
  filters: {
    from: string | null;
    to: string | null;
    actorId: string | null;
    action: string | null;
    result: "success" | "failure" | null;
  };
  coverage: {
    sources: Array<{
      source: "accounts" | "datasets" | "ai-config" | "analysis-settings";
      status: "ok" | "missing" | "invalid";
      events: number;
      legacy: number;
    }>;
  };
};
```

Events are merged newest first. `legacy` counts non-versioned audit entries retained by a compatible older source shape; such entries are not exposed. Missing sources are distinguished from sources with zero events.
