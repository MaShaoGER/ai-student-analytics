import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST } from "./route";
import { converse } from "@/lib/ai/conversation";
import { AIConfigurationError } from "@/lib/ai/planner";
import { PROMPT_VERSION } from "@/lib/ai/prompts/version";
import { requireUser } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { QueryExecutionError } from "@/lib/security/query-execution";
import { loadAnalysisRecords } from "@/lib/records";

vi.mock("@/lib/ai/conversation", () => ({ converse: vi.fn() }));
vi.mock("@/lib/auth/http", async (original) => ({
  ...(await original<typeof import("@/lib/auth/http")>()),
  requireUser: vi.fn(),
}));
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/security/rate-limit")>()),
  checkRateLimit: vi.fn(),
}));

const request = (payload: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { origin },
    body: JSON.stringify(payload),
  });
const secret = "private-question-should-not-persist";
describe("conversation HTTP boundary", () => {
  let directory: string;
  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), "analytics-chat-route-"));
    vi.stubEnv("ANALYSIS_RECORDS_DIR", directory);
    vi.stubEnv("APP_ORIGIN", "http://localhost");
    vi.mocked(requireUser).mockResolvedValue({
      id: "chat-user",
      username: "fixture",
      displayName: "测试",
      role: "user",
    });
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 10, resetAfter: 60000 });
    vi.mocked(converse).mockResolvedValue({
      kind: "clarification",
      answer: secret,
      facts: [],
      suggestions: [],
      artifact: null,
      context: null,
      planning: { source: "external", rationale: secret, model: "fixture" },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("streams actual steps and audits only fixed operation metadata", async () => {
    vi.mocked(converse).mockImplementationOnce(async (_input, options) => {
      options?.onStep?.({ id: "one", label: "比较学期成绩", status: "running", durationMs: 0 });
      options?.onStep?.({ id: "one", label: "比较学期成绩", status: "completed", durationMs: 7 });
      return {
        kind: "answer",
        answer: secret,
        facts: [],
        suggestions: [],
        artifact: null,
        context: null,
        planning: { source: "external", rationale: secret, model: "fixture" },
      };
    });
    const request = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { origin: "http://localhost", accept: "text/event-stream" },
      body: JSON.stringify({ mode: "comprehensive", question: secret, datasetId: "demo" }),
    });
    const response = await POST(request);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const events = (await response.text())
      .trim()
      .split("\n\n")
      .map((frame) => JSON.parse(frame.slice(6)));
    expect(events.map((event) => event.type)).toEqual(["step", "step", "result"]);
    expect(new Set(events.map((event) => event.requestId)).size).toBe(1);
    expect(loadAnalysisRecords()[0].executionSteps).toEqual([
      { operation: "compare_terms", status: "completed", durationMs: 7 },
    ]);
    expect(readFileSync(join(directory, "analysis.jsonl"), "utf8")).not.toContain(secret);
  });

  it("sanitizes failures after stream headers have been sent", async () => {
    vi.mocked(converse).mockRejectedValueOnce(new Error(secret));
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { origin: "http://localhost", accept: "text/event-stream" },
        body: JSON.stringify({ mode: "comprehensive", question: secret, datasetId: "demo" }),
      }),
    );
    const body = await response.text();
    expect(body).not.toContain(secret);
    expect(body).toContain('"type":"error"');
    expect(loadAnalysisRecords()[0].errorCode).toBe("AI_PLANNING_FAILED");
  });

  it("returns conversational clarifications as successful turns and never persists their text", async () => {
    const response = await POST(request({ question: secret, datasetId: "demo" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ kind: "clarification", answer: secret });
    expect(loadAnalysisRecords()[0]).toMatchObject({
      userId: "chat-user",
      datasetId: "demo",
      metricId: null,
      plan: null,
      errorCode: null,
    });
    expect(readFileSync(join(directory, "analysis.jsonl"), "utf8")).not.toContain(secret);
  });

  it("rejects unauthenticated and cross-origin requests before running the conversation", async () => {
    expect(
      (await POST(request({ question: "帮我分析", datasetId: "demo" }, "https://other.example")))
        .status,
    ).toBe(403);
    vi.mocked(requireUser).mockRejectedValue(new AuthError(401, "UNAUTHENTICATED", "请先登录"));
    expect((await POST(request({ question: "帮我分析", datasetId: "demo" }))).status).toBe(401);
    expect(converse).not.toHaveBeenCalled();
  });

  it("shares the old ask rate limit and returns a retry header", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAfter: 1000 });
    const response = await POST(request({ question: "帮我分析", datasetId: "demo" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("1");
    expect(checkRateLimit).toHaveBeenCalledWith("ask:chat-user", expect.anything());
    expect(converse).not.toHaveBeenCalled();
  });

  it("rejects malformed history and oversized bodies before any model call", async () => {
    expect(
      (
        await POST(
          request({
            question: "帮我分析",
            datasetId: "demo",
            history: [{ role: "system", content: secret }],
          }),
        )
      ).status,
    ).toBe(400);
    const oversized = await POST(request({ question: "长".repeat(60000), datasetId: "demo" }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toMatchObject({
      code: "INVALID_QUESTION",
      retryable: false,
    });
    expect(converse).not.toHaveBeenCalled();
  });

  it("classifies query errors after execution starts without leaking provider details", async () => {
    vi.mocked(converse).mockImplementation(async (_input, options) => {
      options?.onExecution?.(null);
      throw new Error(secret);
    });
    const response = await POST(request({ question: secret, datasetId: "demo" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "ANALYSIS_FAILED" });
    expect(loadAnalysisRecords()[0]).toMatchObject({
      stage: "execution",
      errorCode: "ANALYSIS_FAILED",
    });
    expect(readFileSync(join(directory, "analysis.jsonl"), "utf8")).not.toContain(secret);
  });

  it("records prompt version and the model without persisting question text", async () => {
    vi.mocked(converse).mockResolvedValue({
      kind: "result",
      presentation: "text",
      answer: "本次共返回 1 个分组。",
      facts: ["本次返回 1 个分组。"],
      suggestions: [],
      artifact: null,
      context: null,
      planning: { source: "external", rationale: "按问题选择真实统计。", model: "fixture-model" },
    });
    const response = await POST(request({ question: secret, datasetId: "demo" }));
    expect(response.status).toBe(200);
    expect(loadAnalysisRecords()[0]).toMatchObject({
      requestSource: "ask",
      promptVersion: PROMPT_VERSION,
      model: "fixture-model",
      errorCode: null,
    });
    expect(readFileSync(join(directory, "analysis.jsonl"), "utf8")).not.toContain(secret);
  });

  it("classifies unreadable data sources as retryable data errors, not AI failures", async () => {
    vi.mocked(converse).mockImplementation(async (_input, options) => {
      options?.onExecution?.(null);
      throw new QueryExecutionError("DATA_SOURCE_UNAVAILABLE", secret);
    });
    const response = await POST(request({ question: "比较各课程平均成绩", datasetId: "demo" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "DATA_SOURCE_UNAVAILABLE",
      retryable: true,
    });
    expect(loadAnalysisRecords()[0]).toMatchObject({
      stage: "execution",
      errorCode: "DATA_SOURCE_UNAVAILABLE",
    });
    expect(readFileSync(join(directory, "analysis.jsonl"), "utf8")).not.toContain(secret);
  });

  it("marks configuration failures as non-retryable", async () => {
    vi.mocked(converse).mockRejectedValue(new AIConfigurationError());
    const response = await POST(request({ question: "比较各课程平均成绩", datasetId: "demo" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "AI_NOT_CONFIGURED",
      retryable: false,
    });
  });

  it("propagates cancellation even during planning", async () => {
    vi.mocked(converse).mockRejectedValue(new QueryExecutionError("CANCELLED", secret));
    const response = await POST(request({ question: secret, datasetId: "demo" }));
    expect(response.status).toBe(499);
    expect(await response.json()).toMatchObject({ code: "CANCELLED" });
  });
});
