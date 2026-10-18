import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { POST as postAnalysis } from "./analysis/route";
import { POST as postAsk } from "./ask/route";
import { GET as getProfile } from "./profile/route";
import { runAnalysis, profileDatasets } from "../../lib/analysis/duckdb";
import { analysisPlanSchema, type AnalysisPlan, type AnalysisResult } from "../../lib/analysis/types";
import { loadAnalysisRecords } from "../../lib/records";
import { requireUser } from "../../lib/auth/http";
import { AuthError } from "../../lib/auth/service";
import { checkRateLimit } from "../../lib/security/rate-limit";
import { QueryExecutionError, type QueryExecutionErrorCode } from "../../lib/security/query-execution";
import { BudgetExceededError, UnknownModelPricingError } from "../../lib/security/ai-cost";
import { AIClarificationError, AIConfigurationError, planQuestion } from "../../lib/ai/planner";
import { PROMPT_VERSION } from "../../lib/ai/prompts/version";
import { AIProviderError } from "../../lib/ai/provider-errors";

vi.mock("@/lib/analysis/duckdb", () => ({ runAnalysis: vi.fn(), profileDatasets: vi.fn() }));
vi.mock("@/lib/auth/http", async (original) => ({ ...await original<typeof import("../../lib/auth/http")>(), requireUser: vi.fn() }));
vi.mock("@/lib/ai/planner", async (original) => ({ ...await original<typeof import("../../lib/ai/planner")>(), planQuestion: vi.fn() }));
vi.mock("@/lib/security/rate-limit", async (original) => ({ ...await original<typeof import("../../lib/security/rate-limit")>(), checkRateLimit: vi.fn() }));

const plan: AnalysisPlan = {
  version: 1,
  datasetId: "oulad",
  metric: "activity",
  aggregation: "sum",
  dimensions: ["term"],
  filters: [{ field: "course", op: "eq", value: "AAA" }],
  sort: { by: "value", direction: "desc" },
  limit: 20,
  chartType: "line",
};
const result: AnalysisResult = {
  datasetId: "oulad",
  dimension: "term",
  chartType: "line",
  rows: [{ dimension: "2014J", value: 123, sampleSize: 50 }],
  unit: "次",
  metricLabel: "学习活动次数",
  period: "OULAD 本地 CSV 全部记录",
  query: "SELECT aggregate_only",
  durationMs: 12,
  minSampleSize: 3,
  filteredOutGroupCount: 0,
};
const question = "对比每学期的学习活动";
const privateValue = "private-user-text sk-credential-must-not-persist";

function request(endpoint: "analysis" | "ask", payload: unknown, signal?: AbortSignal): Request {
  return new Request(`http://localhost/api/${endpoint}`, {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });
}

describe("analysis API classification and persisted audit", () => {
  let directory: string;
  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(path.join(tmpdir(), "analytics-route-audit-"));
    vi.stubEnv("ANALYSIS_RECORDS_DIR", directory);
    vi.stubEnv("APP_ORIGIN", "http://localhost");
    vi.mocked(requireUser).mockResolvedValue({ id: "user-id-123", username: "private-username", displayName: "私有姓名", role: "user" });
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 10, resetAfter: 60_000 });
    vi.mocked(planQuestion).mockResolvedValue({ plan, source: "golden_case", rationale: "已验证问题", matchedCaseId: "activity-by-term", model: null });
    vi.mocked(runAnalysis).mockResolvedValue({ plan, result });
    vi.mocked(profileDatasets).mockResolvedValue([]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it.each(["analysis", "ask"] as const)("preserves successful %s response and audits only aggregate metadata", async (endpoint) => {
    const payload = endpoint === "analysis"
      ? { ...plan, password: privateValue, apiKey: privateValue, studentName: privateValue }
      : { question, datasetId: "oulad", password: privateValue, apiKey: privateValue };
    const req = request(endpoint, payload);
    const response = await (endpoint === "analysis" ? postAnalysis : postAsk)(req);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ plan, result });
    expect(runAnalysis).toHaveBeenCalledWith(plan, { signal: req.signal });
    if (endpoint === "ask") expect(planQuestion).toHaveBeenCalledWith({ question, datasetId: "oulad" }, undefined, { signal: req.signal });
    expect(loadAnalysisRecords()).toEqual([expect.objectContaining({
      datasetId: "oulad", metricId: "activity", plan,
      userId: "user-id-123", requestSource: endpoint, stage: "execution",
      ...(endpoint === "ask" ? { promptVersion: PROMPT_VERSION, model: null } : {}),
      result: { rowCount: 1, period: result.period, durationMs: 12 }, errorCode: null,
    })]);
    const saved = readFileSync(path.join(directory, "analysis.jsonl"), "utf8");
    for (const text of [privateValue, question, "private-username", "私有姓名", "SELECT aggregate_only", "2014J"]) expect(saved).not.toContain(text);
  });

  it.each(["analysis", "ask"] as const)("returns 422 and records real context for an empty %s result", async (endpoint) => {
    vi.mocked(runAnalysis).mockResolvedValue({ plan, result: { ...result, rows: [] } });
    const response = await (endpoint === "analysis" ? postAnalysis : postAsk)(request(endpoint, endpoint === "analysis" ? plan : { question, datasetId: "oulad" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: "NO_DATA" });
    expect(loadAnalysisRecords()).toEqual([expect.objectContaining({ datasetId: "oulad", metricId: "activity", plan, errorCode: "NO_DATA", requestSource: endpoint, userId: "user-id-123", result: { rowCount: 0, period: result.period, durationMs: 12 } })]);
  });

  it("does not manufacture a metric or a plan when validation fails", async () => {
    const response = await postAnalysis(request("analysis", { ...plan, metric: privateValue, filters: [{ field: "studentName", op: "eq", value: privateValue }], apiKey: privateValue }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PLAN" });
    expect(runAnalysis).not.toHaveBeenCalled();
    expect(loadAnalysisRecords()).toEqual([expect.objectContaining({ datasetId: "oulad", metricId: null, plan: null, stage: "validation", errorCode: "INVALID_PLAN" })]);
    expect(readFileSync(path.join(directory, "analysis.jsonl"), "utf8")).not.toContain(privateValue);
  });

  it("keeps a known metric but uses null for an unknown dataset", async () => {
    await postAnalysis(request("analysis", { ...plan, datasetId: privateValue }));
    expect(loadAnalysisRecords()[0]).toMatchObject({ datasetId: null, metricId: "activity", plan: null });
  });

  it.each(["analysis", "ask"] as const)("classifies malformed JSON as a validation error for %s", async (endpoint) => {
    const req = new Request(`http://localhost/api/${endpoint}`, { method: "POST", headers: { origin: "http://localhost" }, body: "{" });
    const response = await (endpoint === "analysis" ? postAnalysis : postAsk)(req);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: endpoint === "analysis" ? "INVALID_PLAN" : "INVALID_QUESTION" });
    expect(loadAnalysisRecords()[0]).toMatchObject({ datasetId: null, metricId: null, plan: null, stage: "validation" });
  });

  it.each(["analysis", "ask"] as const)("rejects an oversized %s body with 413 and audits the failure", async (endpoint) => {
    const oversized = "x".repeat(70_000);
    const payload = endpoint === "analysis"
      ? { ...plan, padding: oversized }
      : { question, datasetId: "oulad", padding: oversized };
    const response = await (endpoint === "analysis" ? postAnalysis : postAsk)(request(endpoint, payload));
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "请求内容过大，请缩小查询范围后重试。",
      code: "REQUEST_TOO_LARGE",
      // The conversational endpoint reports whether the client may retry.
      ...(endpoint === "ask" ? { retryable: false } : {}),
    });
    expect(runAnalysis).not.toHaveBeenCalled();
    expect(loadAnalysisRecords()).toEqual([
      expect.objectContaining({
        requestSource: endpoint,
        stage: "validation",
        errorCode: "REQUEST_TOO_LARGE",
        datasetId: null,
        metricId: null,
      }),
    ]);
  });

  it("enforces the filter size limits without changing valid requests", async () => {
    const atLimit = await postAnalysis(request("analysis", {
      ...plan,
      filters: [
        { field: "course", op: "eq", value: "x".repeat(200) },
        { field: "term", op: "in", value: Array.from({ length: 50 }, (_, index) => `term-${index}`) },
      ],
    }));
    expect(atLimit.status).toBe(200);

    for (const filters of [
      [{ field: "course", op: "eq", value: "x".repeat(201) }],
      [{ field: "course", op: "in", value: Array.from({ length: 51 }, (_, index) => `course-${index}`) }],
      [{ field: "course", op: "in", value: ["x".repeat(201)] }],
    ]) {
      const response = await postAnalysis(request("analysis", { ...plan, filters }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_PLAN" });
    }
    expect(runAnalysis).toHaveBeenCalledTimes(1);
  });

  it("returns a no-store 429 when the profile rate limit is exhausted", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAfter: 1_200 });
    const response = await getProfile(new Request("http://localhost/api/profile"));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("2");
    expect(await response.json()).toEqual({
      error: "请求过于频繁，请稍后再试。",
      code: "RATE_LIMIT_EXCEEDED",
    });
    expect(profileDatasets).not.toHaveBeenCalled();
  });

  it("records an invalid question without persisting its text or a supplied fake metric", async () => {
    const response = await postAsk(request("ask", { question: "x", datasetId: "oulad", metric: "score", apiKey: privateValue }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_QUESTION" });
    expect(planQuestion).not.toHaveBeenCalled();
    expect(loadAnalysisRecords()[0]).toMatchObject({ datasetId: "oulad", metricId: null, plan: null, errorCode: "INVALID_QUESTION", stage: "validation" });
  });

  it.each<[{ code: QueryExecutionErrorCode; status: number }]>([
    [{ code: "TIMEOUT", status: 504 }],
    [{ code: "CANCELLED", status: 499 }],
    [{ code: "OUT_OF_MEMORY", status: 422 }],
    [{ code: "TOO_MANY_ROWS", status: 422 }],
    [{ code: "TOO_MANY_FIELDS", status: 422 }],
  ])("maps and audits execution $code consistently in both routes", async ({ code, status }) => {
    vi.mocked(runAnalysis).mockRejectedValue(new QueryExecutionError(code, privateValue));
    for (const endpoint of ["analysis", "ask"] as const) {
      const response = await (endpoint === "analysis" ? postAnalysis : postAsk)(request(endpoint, endpoint === "analysis" ? plan : { question, datasetId: "oulad" }));
      expect(response.status).toBe(status);
      const body = await response.json();
      expect(body.code).toBe(code);
      expect(body.error).not.toContain(privateValue);
    }
    expect(loadAnalysisRecords()).toEqual(["analysis", "ask"].map((requestSource) => expect.objectContaining({ requestSource, datasetId: "oulad", metricId: "activity", plan, stage: "execution", errorCode: code })));
    expect(readFileSync(path.join(directory, "analysis.jsonl"), "utf8")).not.toContain(privateValue);
  });

  it.each(["TIMEOUT", "CANCELLED"] as const)("recognizes %s even during AI planning", async (code) => {
    vi.mocked(planQuestion).mockRejectedValue(new QueryExecutionError(code, privateValue));
    const response = await postAsk(request("ask", { question: privateValue, datasetId: "oulad" }));
    expect(response.status).toBe(code === "TIMEOUT" ? 504 : 499);
    expect(await response.json()).toMatchObject({ code });
    expect(runAnalysis).not.toHaveBeenCalled();
    expect(loadAnalysisRecords()[0]).toMatchObject({ datasetId: "oulad", metricId: null, plan: null, stage: "planning", errorCode: code });
  });

  it.each(["analysis", "ask"] as const)("reports an ordinary %s execution failure without blaming AI or leaking driver details", async (endpoint) => {
    vi.mocked(runAnalysis).mockRejectedValue(new Error(privateValue));
    const response = await (endpoint === "analysis" ? postAnalysis : postAsk)(request(endpoint, endpoint === "analysis" ? plan : { question, datasetId: "oulad" }));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toMatchObject({ code: "ANALYSIS_FAILED" });
    expect(body.error).not.toContain(privateValue);
    expect(loadAnalysisRecords()[0]).toMatchObject({ datasetId: "oulad", metricId: "activity", plan, errorCode: "ANALYSIS_FAILED", stage: "execution" });
  });

  it.each([
    { failure: new Error(privateValue), status: 502, code: "AI_PLANNING_FAILED" },
    { failure: new AIConfigurationError(privateValue), status: 503, code: "AI_NOT_CONFIGURED" },
    { failure: new AIClarificationError(privateValue), status: 422, code: "CLARIFICATION_REQUIRED" },
    { failure: new BudgetExceededError("单次请求", 1, 0.5), status: 429, code: "AI_BUDGET_EXCEEDED" },
    { failure: new UnknownModelPricingError(privateValue), status: 503, code: "AI_PRICING_REQUIRED" },
    { failure: new AIProviderError("AI_PROVIDER_OVERLOADED"), status: 429, code: "AI_PROVIDER_OVERLOADED" },
    { failure: new AIProviderError("AI_PROVIDER_RATE_LIMITED"), status: 429, code: "AI_PROVIDER_RATE_LIMITED" },
  ])("retains $code planning response and audits safe context", async ({ failure, status, code }) => {
    vi.mocked(planQuestion).mockRejectedValue(failure);
    const response = await postAsk(request("ask", { question: privateValue, datasetId: "oulad" }));
    expect(response.status).toBe(status);
    if (failure instanceof AIProviderError) {
      expect(response.headers.get("retry-after")).toBe("30");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(runAnalysis).not.toHaveBeenCalled();
    }
    expect(await response.json()).toMatchObject({ code });
    expect(loadAnalysisRecords()[0]).toMatchObject({ datasetId: "oulad", metricId: null, plan: null, stage: "planning", errorCode: code });
    expect(readFileSync(path.join(directory, "analysis.jsonl"), "utf8")).not.toContain(privateValue);
  });

  it("does not label an invalid AI output as an invalid user question", async () => {
    const invalid = analysisPlanSchema.safeParse({ ...plan, aggregation: "avg" });
    if (invalid.success) throw new Error("Fixture must be an invalid plan");
    vi.mocked(planQuestion).mockRejectedValue(invalid.error);
    const response = await postAsk(request("ask", { question, datasetId: "oulad" }));
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ code: "AI_PLANNING_FAILED" });
    expect(loadAnalysisRecords()[0]).toMatchObject({ stage: "planning", metricId: null });
  });

  it("retains known context when the generated plan is invalid", async () => {
    const invalidPlan = { ...plan, aggregation: "avg" as const };
    vi.mocked(planQuestion).mockResolvedValue({ plan: invalidPlan, source: "openai", rationale: "", matchedCaseId: null, model: "test" });
    const invalid = analysisPlanSchema.safeParse(invalidPlan);
    if (invalid.success) throw new Error("Fixture must be an invalid plan");
    vi.mocked(runAnalysis).mockRejectedValue(invalid.error);
    const response = await postAsk(request("ask", { question, datasetId: "oulad" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PLAN" });
    expect(loadAnalysisRecords()[0]).toMatchObject({ datasetId: "oulad", metricId: "activity", plan: null, stage: "execution", errorCode: "INVALID_PLAN" });
  });

  it("does not hide a successful result when audit storage fails", async () => {
    vi.stubEnv("ANALYSIS_RECORDS_DIR", path.join(directory, "not-a-directory"));
    // Point the record directory to a regular file so persistence fails deterministically.
    const fs = await import("node:fs");
    fs.writeFileSync(path.join(directory, "not-a-directory"), "file");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect((await postAsk(request("ask", { question, datasetId: "oulad" }))).status).toBe(200);
      expect(warning).toHaveBeenCalledWith("Warning: failed to save analysis audit record");
      expect(error).toHaveBeenCalledWith("Failed to save analysis record");
    } finally {
      warning.mockRestore();
      error.mockRestore();
    }
  });

  it("passes cancellation to dataset profiling and preserves the timeout response", async () => {
    vi.mocked(profileDatasets).mockRejectedValue(new QueryExecutionError("TIMEOUT", privateValue));
    const req = new Request("http://localhost/api/profile");
    const response = await getProfile(req);
    expect(profileDatasets).toHaveBeenCalledWith({ signal: req.signal });
    expect(response.status).toBe(504);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ code: "TIMEOUT" });
    expect(loadAnalysisRecords()).toEqual([]);
  });

  it("does not run analysis or write an audit for an unauthorized request", async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError(401, "UNAUTHENTICATED", "请先登录。"));
    const response = await postAnalysis(request("analysis", plan));
    expect(response.status).toBe(401);
    expect(runAnalysis).not.toHaveBeenCalled();
    expect(loadAnalysisRecords()).toEqual([]);
  });
});
