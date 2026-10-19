import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getAdminOverview,
  overviewRange,
  readOverviewRecords,
  summarizeCosts,
  summarizeRequests,
  MAX_RECORD_BYTES,
} from "./overview";
import { appendAdminEvent, ADMIN_AUDIT_EVENT_LIMIT, readAdminAudit } from "./audit";
import { collectAdminEvents, parseAdminLogQuery, queryAdminLogs } from "./logs";
import { getAIConfig, saveAIConfig } from "../settings/ai";
import { getAnalysisSettings, saveAnalysisSettings } from "../settings/analysis";

describe("admin overview independent fixtures and atomic audit", () => {
  let directory: string;
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "admin-metrics-"));
    vi.stubEnv("APP_STATE_DIR", directory);
    vi.stubEnv("ANALYSIS_RECORDS_DIR", directory);
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  const timestamp = "2026-10-19T00:00:00Z";
  const row = (id: string, outcome?: string, durationMs = 10) => ({
    requestId: id,
    timestamp,
    stage: "execution",
    outcome,
    errorCode: outcome === "failure" ? "FAILED" : null,
    result: { rowCount: 3, durationMs },
  });
  it("uses Shanghai calendar-day boundaries around UTC midnight", () => {
    const now = new Date("2026-10-19T17:30:00Z");
    expect(overviewRange("today", now)).toEqual({
      start: "2026-10-19T16:00:00.000Z",
      end: now.toISOString(),
      timezone: "Asia/Shanghai",
    });
    expect(overviewRange("7d", now).start).toBe("2026-10-13T16:00:00.000Z");
    expect(overviewRange("30d", now).start).toBe("2026-09-20T16:00:00.000Z");
  });
  it("deduplicates stages, prefers explicit outcomes and excludes uncorrelated legacy rows", () => {
    const records = [
      row("request-01", "success", 25),
      { ...row("request-01", undefined, 1), stage: "planning", timestamp: "2026-10-19T00:00:01Z" },
      row("request-02", "partial", 50),
      row("request-03", "failure", 75),
      { ...row("unused"), requestId: undefined },
    ];
    const stats = summarizeRequests(records, Date.parse(timestamp), Date.parse(timestamp) + 10000);
    expect(stats).toMatchObject({
      total: 3,
      success: 1,
      partial: 1,
      failure: 1,
      successRate: 1 / 3,
      legacyWithoutRequestId: 1,
      durationMs: { samples: 3, p95: null },
    });
  });
  it("computes P95 only with enough samples and does not invent duration samples", () => {
    const records = Array.from({ length: 20 }, (_, i) =>
      row(`request-${String(i).padStart(2, "0")}`, "success", i + 1),
    );
    expect(summarizeRequests(records, 0, Date.now()).durationMs).toEqual({ samples: 20, p95: 19 });
    expect(
      summarizeRequests(
        [{ ...row("request-01", "failure"), result: { durationMs: null } }],
        0,
        Date.now(),
      ).durationMs.samples,
    ).toBe(0);
  });
  it("keeps valid JSONL evidence when other lines are malformed", () => {
    writeFileSync(
      join(directory, "analysis.jsonl"),
      JSON.stringify(row("request-01", "success")) + "\n{broken\n{}\n",
    );
    const read = readOverviewRecords();
    expect(read.coverage).toMatchObject({
      scanned: 3,
      valid: 1,
      malformed: 2,
      truncatedTail: false,
      status: "ok",
    });
    expect(read.records).toHaveLength(1);
  });
  it("bounds legacy log reads and discloses missing and truncated sources", () => {
    expect(readOverviewRecords().coverage.status).toBe("missing");
    writeFileSync(
      join(directory, "analysis.jsonl"),
      "x".repeat(MAX_RECORD_BYTES + 32) +
        "\n" +
        JSON.stringify(row("request-01", "success")) +
        "\n",
    );
    const read = readOverviewRecords();
    expect(read.coverage.truncatedTail).toBe(true);
    expect(read.records).toHaveLength(1);
  });
  it("independently recomputes model-call counts, tokens and estimated cost", () => {
    const cost = (price: number, estimated: boolean) => ({
      timestamp: Date.parse(timestamp),
      usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
      cost: { totalCost: price },
      usageEstimated: estimated,
    });
    const stats = summarizeCosts(
      {
        records: [
          cost(0.2, false),
          cost(0.3, true),
          { ...cost(20, false), timestamp: 0 },
          { usage: "broken" },
        ],
      },
      Date.parse(timestamp),
      Date.parse(timestamp) + 1000,
    );
    expect(stats.ai).toEqual({
      calls: 2,
      measuredCalls: 1,
      estimatedCalls: 1,
      promptTokens: 200,
      completionTokens: 40,
      totalTokens: 240,
      costUsd: 0.5,
      estimated: true,
    });
    expect(stats.coverage).toMatchObject({ status: "invalid", malformed: 1, records: 4 });
    expect(summarizeCosts(null, 0, Date.now()).coverage.status).toBe("invalid");
  });
  it("counts actual roles/statuses, leaves empty rates unknown and surfaces cost corruption", () => {
    writeFileSync(
      join(directory, "accounts.json"),
      JSON.stringify({
        version: 2,
        users: [
          { role: "admin", disabled: false },
          { role: "user", disabled: true },
          { role: "readonly", disabled: false, mustChangePassword: true },
        ],
        sessions: [],
      }),
    );
    writeFileSync(join(directory, "cost-history.json"), "not JSON");
    const stats = getAdminOverview("today");
    expect(stats.accounts).toEqual({
      total: 3,
      active: 2,
      disabled: 1,
      byRole: { admin: 1, user: 1, readonly: 1 },
      mustChangePassword: 1,
    });
    expect(stats.requests.successRate).toBeNull();
    expect(stats.coverage.costHistory.status).toBe("invalid");
    expect(stats.datasets.total).toBe(2);
  });
  it("fails a mutation atomically if its embedded audit is damaged", () => {
    const config = {
      version: 1,
      enabled: true,
      model: "fixture-model",
      budgets: { perRequest: 1, perHour: 2, perDay: 3, perMonth: 4 },
      pricing: { inputPerMillion: 1, outputPerMillion: 1 },
      encryptedApiKey: null,
      __adminAudit: { version: 1, events: [{ broken: true }] },
    };
    const file = join(directory, "ai-config.json");
    writeFileSync(file, JSON.stringify(config));
    const before = readFileSync(file, "utf8");
    expect(() => saveAIConfig({ ...getAIConfig(), enabled: false }, "admin-1")).toThrow(/audit/);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  it("audits configuration changes without endpoint, keys or model secrets", () => {
    saveAIConfig(
      { ...getAIConfig(), enabled: false, baseUrl: "https://example.com/v1", model: "token-model" },
      "admin-1",
    );
    saveAnalysisSettings({ ...getAnalysisSettings(), maxToolCalls: 4 }, "admin-1");
    const logs = collectAdminEvents();
    expect(logs.events.map((event) => event.action)).toEqual(
      expect.arrayContaining(["ai-config.update", "analysis-settings.update"]),
    );
    expect(JSON.stringify(logs.events)).not.toContain("example.com");
    expect(JSON.stringify(logs.events)).not.toContain("token-model");
  });
  it("filters and pages events while excluding untrusted legacy payloads", () => {
    const state = { __adminAudit: [{ password: "legacy-secret-not-exposed" }] };
    appendAdminEvent(state, {
      actorId: "admin-1",
      action: "user.create",
      targetType: "user",
      targetId: "user-1",
      summary: { role: "readonly", datasetIds: "" },
    });
    appendAdminEvent(state, {
      actorId: "admin-1",
      action: "user.password.reset",
      targetType: "user",
      targetId: "user-1",
      result: "failure",
      errorCode: "ADMIN_PROTECTED",
    });
    writeFileSync(join(directory, "accounts.json"), JSON.stringify(state));
    const result = queryAdminLogs(
      parseAdminLogQuery(new URLSearchParams("result=failure&pageSize=1")),
    );
    expect(result.total).toBe(1);
    expect(result.events[0].errorCode).toBe("ADMIN_PROTECTED");
    expect(JSON.stringify(result)).not.toContain("legacy-secret");
    expect(() => parseAdminLogQuery(new URLSearchParams("page=1&page=2"))).toThrow();
    expect(() => parseAdminLogQuery(new URLSearchParams("pageSize=1000"))).toThrow();
  });
  it("bounds audit retention and rejects invalid new sensitive summaries", () => {
    const state: { __adminAudit?: unknown } = {};
    appendAdminEvent(state, {
      actorId: "admin-1",
      action: "user.create",
      targetType: "user",
      targetId: "user-1",
      summary: { datasetIds: "", role: "user" },
    });
    const event = readAdminAudit(state.__adminAudit).events[0];
    state.__adminAudit = {
      version: 1,
      events: Array.from({ length: ADMIN_AUDIT_EVENT_LIMIT + 1 }, (_, i) => ({
        ...event,
        id: `event-${i}`,
      })),
    };
    appendAdminEvent(state, {
      actorId: "admin-1",
      action: "user.sessions.revoke",
      targetType: "user",
      targetId: "user-1",
    });
    expect(readAdminAudit(state.__adminAudit).events).toHaveLength(ADMIN_AUDIT_EVENT_LIMIT);
    expect(() =>
      appendAdminEvent(state, {
        actorId: "admin-1",
        action: "user.update",
        targetType: "user",
        targetId: "user-1",
        summary: { password: "never-store" },
      }),
    ).toThrow();
  });
});
