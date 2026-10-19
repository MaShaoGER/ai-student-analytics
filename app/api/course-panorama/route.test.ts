import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { requireUser } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { coursePanorama } from "@/lib/analysis/duckdb";
import { PanoramaSelectionError } from "@/lib/analysis/course-panorama";
import { checkRateLimit } from "@/lib/security/rate-limit";
import { QueryExecutionError } from "@/lib/security/query-execution";

vi.mock("@/lib/auth/http", async (original) => ({
  ...(await original<typeof import("@/lib/auth/http")>()),
  requireUser: vi.fn(),
}));
vi.mock("@/lib/analysis/duckdb", () => ({ coursePanorama: vi.fn() }));
vi.mock("@/lib/security/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  rateLimitConfigs: { analysis: {} },
}));
const request = (params = "datasetId=demo") =>
  new Request(`http://localhost/api/course-panorama?${params}`);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireUser).mockResolvedValue({
    id: "user-123",
    username: "test",
    displayName: "测试",
    role: "user",
    datasetIds: ["demo", "oulad"],
  });
  vi.mocked(checkRateLimit).mockReturnValue({ allowed: true, remaining: 10, resetAfter: 60000 });
  vi.mocked(coursePanorama).mockResolvedValue({
    datasetId: "demo",
    term: null,
    terms: [],
    threshold: 60,
    minSampleSize: 3,
    courseLimit: 12,
    totalCourses: 0,
    courses: [],
    relations: [],
    totalStudents: 0,
    selection: null,
    columns: [],
  });
});
describe("course panorama endpoint", () => {
  it("authenticates before reading data", async () => {
    vi.mocked(requireUser).mockRejectedValue(new AuthError(401, "UNAUTHENTICATED", "请先登录"));
    expect((await GET(request())).status).toBe(401);
    expect(coursePanorama).not.toHaveBeenCalled();
  });
  it.each([
    "datasetId=private.csv",
    "datasetId=demo&threshold=0",
    "datasetId=demo&threshold=101",
    "datasetId=demo&threshold=60.5",
    "datasetId=demo&threshold=NaN",
    "datasetId=demo&term=",
    "datasetId=demo&source=A",
    "datasetId=demo&target=B",
    "datasetId=demo&source=A&target=A",
  ])("validates input and keeps errors uncached: %s", async (params) => {
    const response = await GET(request(params));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(coursePanorama).not.toHaveBeenCalled();
  });
  it("passes the complete cohort and cancellation signal to one bounded operation", async () => {
    const req = request("datasetId=demo&term=2025J&threshold=70&source=A&target=B");
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(coursePanorama).toHaveBeenCalledWith(
      { datasetId: "demo", term: "2025J", threshold: 70, source: "A", target: "B" },
      { signal: req.signal },
    );
  });
  it("limits each authenticated user", async () => {
    vi.mocked(checkRateLimit).mockReturnValue({ allowed: false, remaining: 0, resetAfter: 1200 });
    const response = await GET(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("2");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(checkRateLimit).toHaveBeenCalledWith("course-panorama:user-123", expect.anything());
    expect(coursePanorama).not.toHaveBeenCalled();
  });
  it("returns a recoverable error for unavailable cohorts", async () => {
    vi.mocked(coursePanorama).mockRejectedValue(new PanoramaSelectionError());
    const response = await GET(request("datasetId=demo&source=A&target=B"));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_COHORT");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each([
    ["TIMEOUT", 504],
    ["CANCELLED", 499],
    ["OUT_OF_MEMORY", 422],
  ] as const)("classifies %s without exposing query internals", async (code, status) => {
    vi.mocked(coursePanorama).mockRejectedValue(new QueryExecutionError(code, "private query"));
    const response = await GET(request());
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("private query");
  });
  it("sanitizes unexpected errors", async () => {
    vi.mocked(coursePanorama).mockRejectedValue(new Error("/private/student-data.csv"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).not.toContain("/private");
  });
});
