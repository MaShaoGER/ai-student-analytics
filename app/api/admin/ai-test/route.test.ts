import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
import { requireAdmin } from "../../../../lib/auth/http";
import { testAIConnection } from "../../../../lib/ai/planner";
import { AIProviderError } from "../../../../lib/ai/provider-errors";
import { checkRateLimit } from "../../../../lib/security/rate-limit";

vi.mock("@/lib/auth/http", async (original) => ({ ...await original<typeof import("../../../../lib/auth/http")>(), requireAdmin: vi.fn() }));
vi.mock("@/lib/ai/planner", async (original) => ({ ...await original<typeof import("../../../../lib/ai/planner")>(), testAIConnection: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({ checkRateLimit: vi.fn(), rateLimitConfigs: { strict: {} } }));

describe("admin AI connection provider errors", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    vi.mocked(requireAdmin).mockResolvedValue({ id: "fictional-admin", username: "admin", displayName: "测试管理员", role: "admin" });
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 9, resetAfter: 60_000 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each(["AI_PROVIDER_OVERLOADED", "AI_PROVIDER_RATE_LIMITED"] as const)("returns %s separately from connection failure", async (code) => {
    vi.mocked(testAIConnection).mockRejectedValue(new AIProviderError(code));
    const request = new Request("http://localhost:3000/api/admin/ai-test", { method: "POST", headers: { origin: "http://localhost:3000" } });
    const response = await POST(request);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("30");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ code, error: new AIProviderError(code).message });
    expect(testAIConnection).toHaveBeenCalledOnce();
  });

  it("does not expose raw provider details for unknown failures", async () => {
    const secret = "fictional-private-api-key-and-response";
    vi.mocked(testAIConnection).mockRejectedValue(new Error(secret));
    const response = await POST(new Request("http://localhost:3000/api/admin/ai-test", { method: "POST", headers: { origin: "http://localhost:3000" } }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(secret);
  });
});
