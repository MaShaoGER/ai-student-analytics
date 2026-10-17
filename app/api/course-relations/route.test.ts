import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { requireUser } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { courseRelations } from "@/lib/analysis/duckdb";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { QueryExecutionError } from "@/lib/security/query-execution";

vi.mock("@/lib/auth/http", async (original) => ({
  ...(await original<typeof import("@/lib/auth/http")>()),
  requireUser: vi.fn(),
}));
vi.mock("@/lib/analysis/duckdb", () => ({ courseRelations: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitConfigs: { analysis: {} },
}));
const request = (params = "datasetId=demo") =>
  new Request(`http://localhost/api/course-relations?${params}`);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    id: "user-123",
    username: "test",
    displayName: "测试",
    role: "user",
  });
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 10, resetAfter: 60000 });
  vi.mocked(courseRelations).mockResolvedValue({
    datasetId: "demo",
    term: null,
    terms: [],
    threshold: 60,
    minSampleSize: 3,
    courseLimit: 12,
    totalCourses: 0,
    courses: [],
    relations: [],
  });
});
describe("course relations endpoint", () => {
  it("authenticates before querying", async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError(401, "UNAUTHENTICATED", "请先登录"));
    expect((await GET(request())).status).toBe(401);
    expect(courseRelations).not.toHaveBeenCalled();
  });
  it.each([
    "datasetId=private.csv",
    "datasetId=demo&threshold=0",
    "datasetId=demo&threshold=101",
    "datasetId=demo&threshold=60.5",
    "datasetId=demo&threshold=NaN",
    "datasetId=demo&term=",
  ])("rejects invalid input: %s", async (params) => {
    expect((await GET(request(params))).status).toBe(400);
    expect(courseRelations).not.toHaveBeenCalled();
  });
  it("returns uncached aggregates and propagates filters and cancellation", async () => {
    const req = request("datasetId=demo&term=2025J&threshold=70");
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(courseRelations).toHaveBeenCalledWith(
      { datasetId: "demo", term: "2025J", threshold: 70 },
      { signal: req.signal },
    );
  });
  it("rate limits each authenticated user", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAfter: 1200 });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(checkRateLimit).toHaveBeenCalledWith("course-relations:user-123", expect.anything());
    expect(courseRelations).not.toHaveBeenCalled();
  });
  it.each([
    ["TIMEOUT", 504],
    ["CANCELLED", 499],
    ["OUT_OF_MEMORY", 422],
  ] as const)("classifies %s safely", async (code, status) => {
    vi.mocked(courseRelations).mockRejectedValue(
      new QueryExecutionError(code, "private driver details"),
    );
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private driver");
  });
  it("does not expose internal paths on unexpected failure", async () => {
    vi.mocked(courseRelations).mockRejectedValue(new Error("/private/data.csv"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("/private");
  });
});
