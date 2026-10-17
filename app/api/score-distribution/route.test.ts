import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { requireUser } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { scoreDistribution } from "@/lib/analysis/duckdb";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { QueryExecutionError } from "@/lib/security/query-execution";

vi.mock("@/lib/auth/http", async (original) => ({
  ...(await original<typeof import("@/lib/auth/http")>()),
  requireUser: vi.fn(),
}));
vi.mock("@/lib/analysis/duckdb", () => ({ scoreDistribution: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitConfigs: { analysis: {} },
}));
const request = (source = "demo") =>
  new Request(`http://localhost/api/score-distribution?datasetId=${source}`);

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    id: "test-user",
    username: "test",
    displayName: "测试",
    role: "user",
  });
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 20, resetAfter: 60000 });
  vi.mocked(scoreDistribution).mockResolvedValue({
    datasetId: "demo",
    groups: [],
    minSampleSize: 3,
  });
});

describe("score distribution endpoint", () => {
  it("requires authentication before running queries", async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError(401, "UNAUTHENTICATED", "请先登录"));
    expect((await GET(request())).status).toBe(401);
    expect(scoreDistribution).not.toHaveBeenCalled();
  });

  it("rejects unknown data sources", async () => {
    expect((await GET(request("arbitrary-file.csv"))).status).toBe(400);
    expect(scoreDistribution).not.toHaveBeenCalled();
  });

  it("returns aggregate data without caching and propagates cancellation", async () => {
    const req = request();
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ datasetId: "demo", groups: [], minSampleSize: 3 });
    expect(scoreDistribution).toHaveBeenCalledWith("demo", { signal: req.signal });
  });

  it("limits repeated requests per user", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAfter: 1200 });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(scoreDistribution).not.toHaveBeenCalled();
  });

  it("keeps query failure details private", async () => {
    vi.mocked(scoreDistribution).mockRejectedValue(new Error("/private/path secret detail"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("/private/path");
  });

  it("classifies query timeouts", async () => {
    vi.mocked(scoreDistribution).mockRejectedValue(
      new QueryExecutionError("TIMEOUT", "driver detail"),
    );
    const response = await GET(request());
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ code: "TIMEOUT" });
  });
});
