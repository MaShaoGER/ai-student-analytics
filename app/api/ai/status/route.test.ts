import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { getAIStatus } from "@/lib/ai/planner";
import { requireUser } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { getAIConfig } from "@/lib/settings/ai";

vi.mock("@/lib/ai/planner", () => ({ getAIStatus: vi.fn() }));
vi.mock("@/lib/settings/ai", () => ({ getAIConfig: vi.fn() }));
vi.mock("@/lib/auth/http", async (original) => ({
  ...(await original<typeof import("@/lib/auth/http")>()),
  requireUser: vi.fn(),
}));

const request = () => new Request("http://localhost/api/ai/status");

describe("AI status endpoint", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireUser).mockResolvedValue({
      id: "status-user",
      username: "fixture",
      displayName: "测试",
      role: "user",
    });
    vi.mocked(getAIStatus).mockReturnValue({
      configured: true,
      enabled: true,
      model: "qwen3.7-flash",
    });
    vi.mocked(getAIConfig).mockReturnValue({
      model: "qwen3.7-flash",
      pricing: { inputPerMillion: 1, outputPerMillion: 1 },
    } as never);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the configured model so the UI can attribute AI replies", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      configured: true,
      enabled: true,
      model: "qwen3.7-flash",
    });
  });

  it("keeps AI disabled when pricing is incomplete and never leaks the base URL", async () => {
    vi.mocked(getAIConfig).mockReturnValue({
      model: "qwen3.7-flash",
      baseUrl: "https://secret.example/v1",
      pricing: { inputPerMillion: null, outputPerMillion: null },
    } as never);
    const payload = (await (await GET(request())).json()) as Record<string, unknown>;
    expect(payload.configured).toBe(false);
    expect(payload.model).toBe("qwen3.7-flash");
    expect(JSON.stringify(payload)).not.toContain("secret.example");
  });

  it("requires a signed-in user", async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError(401, "UNAUTHENTICATED", "请先登录"));
    expect((await GET(request())).status).toBe(401);
  });
});
