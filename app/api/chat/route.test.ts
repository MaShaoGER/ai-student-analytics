import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST } from "./route";
import { converse } from "@/lib/ai/conversation";
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
    expect((await POST(request({ question: "长".repeat(60000), datasetId: "demo" }))).status).toBe(
      413,
    );
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

  it("propagates cancellation even during planning", async () => {
    vi.mocked(converse).mockRejectedValue(new QueryExecutionError("CANCELLED", secret));
    const response = await POST(request({ question: secret, datasetId: "demo" }));
    expect(response.status).toBe(499);
    expect(await response.json()).toMatchObject({ code: "CANCELLED" });
  });
});
