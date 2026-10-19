import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, POST, PUT } from "./route";
import { requireAdmin } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { probeToolCalling } from "@/lib/ai/tool-provider";
import { saveAIConfig } from "@/lib/settings/ai";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { AIProviderError } from "@/lib/ai/provider-errors";

vi.mock("@/lib/auth/http", async (original) => ({
  ...(await original<typeof import("@/lib/auth/http")>()),
  requireAdmin: vi.fn(),
}));
vi.mock("@/lib/ai/tool-provider", async (original) => ({
  ...(await original<typeof import("@/lib/ai/tool-provider")>()),
  probeToolCalling: vi.fn(),
}));
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<typeof import("@/lib/security/rate-limit")>()),
  checkRateLimit: vi.fn(),
}));
const request = (method: string, body?: unknown, origin = "http://localhost") =>
  new Request("http://localhost/api/admin/analysis-settings", {
    method,
    headers: { origin, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
describe("analysis administration boundary", () => {
  let directory: string;
  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), "analysis-control-"));
    vi.stubEnv("APP_STATE_DIR", directory);
    vi.stubEnv("APP_ORIGIN", "http://localhost");
    vi.stubEnv("APP_SETTINGS_KEY", Buffer.alloc(32, 2).toString("base64"));
    vi.mocked(requireAdmin).mockResolvedValue({
      id: "admin",
      username: "admin",
      displayName: "Fixture",
      role: "admin",
    });
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 10, resetAfter: 60_000 });
    saveAIConfig({
      enabled: true,
      apiFormat: "chat_completions",
      model: "fixture",
      baseUrl: "https://provider.example/v1",
      apiKey: "never-expose-this",
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
      budgets: { perRequest: 0.1, perHour: 5, perDay: 20, perMonth: 200 },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  it("requires administrator permission and same-origin writes", async () => {
    expect((await PUT(request("PUT", { enabled: false }, "https://other.example"))).status).toBe(
      403,
    );
    vi.mocked(requireAdmin).mockRejectedValue(new AuthError(403, "FORBIDDEN", "管理员权限不足"));
    expect((await GET(request("GET"))).status).toBe(403);
    expect(probeToolCalling).not.toHaveBeenCalled();
  });
  it("returns safe status, validates bounded limits and rebuilds source metadata", async () => {
    const current = await GET(request("GET"));
    const body = await current.text();
    expect(body).not.toContain("never-expose-this");
    expect(body).not.toContain("fingerprint");
    expect(
      (await PUT(request("PUT", { enabled: true, maxToolCalls: 99, timeoutSeconds: 60 }))).status,
    ).toBe(400);
    const saved = await PUT(
      request("PUT", { enabled: false, maxToolCalls: 3, timeoutSeconds: 30 }),
    );
    expect(await saved.json()).toMatchObject({
      settings: { enabled: false, maxToolCalls: 3, timeoutSeconds: 30 },
    });
    const rebuilt = await POST(request("POST", { action: "rebuild" }));
    expect((await rebuilt.json()).knowledge.builtAt).toBeTruthy();
  });
  it("saves successful compatibility evidence but does not mislabel transient failures", async () => {
    vi.mocked(probeToolCalling).mockResolvedValue({ model: "fixture" });
    const success = await POST(request("POST", { action: "probe" }));
    expect((await success.json()).capability.status).toBe("supported");
    vi.mocked(probeToolCalling).mockRejectedValue(new AIProviderError("AI_PROVIDER_UNAVAILABLE"));
    expect((await POST(request("POST", { action: "probe" }))).status).toBe(503);
    expect((await (await GET(request("GET"))).json()).capability.status).toBe("supported");
    vi.mocked(probeToolCalling).mockRejectedValue(new AIProviderError("AI_INVALID_OUTPUT"));
    expect((await POST(request("POST", { action: "probe" }))).status).toBe(502);
    expect((await (await GET(request("GET"))).json()).capability.status).toBe("failed");
  });
  it("applies the operation rate limit before provider calls", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAfter: 60_000 });
    expect((await POST(request("POST", { action: "probe" }))).status).toBe(429);
    expect(probeToolCalling).not.toHaveBeenCalled();
  });
});
