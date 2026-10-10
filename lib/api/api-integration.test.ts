/**
 * HTTP API integration tests
 * Tests real API endpoints with rate limiting, timeouts, and error handling
 * 
 * NOTE: These tests require a running dev server on port 3000.
 * Run with: ./scripts/test-api.sh
 * Or manually: pnpm dev (in one terminal), then pnpm vitest run lib/api/api-integration.test.ts
 */

import { describe, it, expect } from "vitest";
import { createPlan } from "../analysis/plan";

const BASE_URL = "http://localhost:3000";

describe.skip("API integration tests (requires running server)", () => {
  describe("POST /api/analysis", () => {
    it("should return valid analysis result", async () => {
      const plan = createPlan({
        datasetId: "demo",
        metric: "score",
        dimension: "course",
        chartType: "bar",
      });

      const response = await fetch(`${BASE_URL}/api/analysis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(plan),
      });

      if (!response.ok) {
        const error = await response.json();
        console.error("API error:", error);
      }

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.result).toBeDefined();
      expect(data.result.rows).toBeInstanceOf(Array);
      expect(data.result.minSampleSize).toBe(3);
    });

    it("should reject invalid plan with 400", async () => {
      const invalidPlan = {
        version: 1,
        datasetId: "demo",
        metric: "invalid_metric",
        aggregation: "avg",
        dimensions: ["course"],
        filters: [],
        sort: { by: "value", direction: "desc" },
        limit: 20,
        chartType: "bar",
      };

      const response = await fetch(`${BASE_URL}/api/analysis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(invalidPlan),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("should return 422 for no data", async () => {
      const plan = createPlan({
        datasetId: "demo",
        metric: "score",
        dimension: "course",
        chartType: "bar",
      });

      // Add filter that matches nothing
      plan.filters = [{ field: "course", op: "eq", value: "NONEXISTENT" }];

      const response = await fetch(`${BASE_URL}/api/analysis`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(plan),
      });

      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.error).toContain("未找到满足条件");
      expect(data.code).toBe("NO_DATA");
    });

    it("should enforce rate limiting with 429", async () => {
      const plan = createPlan({
        datasetId: "demo",
        metric: "score",
        dimension: "course",
        chartType: "bar",
      });

      // Make many requests quickly to trigger rate limit
      const requests = Array.from({ length: 35 }, () =>
        fetch(`${BASE_URL}/api/analysis`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "test-rate-limit-" + Date.now(),
          },
          body: JSON.stringify(plan),
        })
      );

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      // Should have at least some rate limited (limit is 30/min)
      expect(rateLimited.length).toBeGreaterThan(0);

      if (rateLimited.length > 0) {
        const data = await rateLimited[0].json();
        expect(data.code).toBe("RATE_LIMIT_EXCEEDED");
        expect(data.retryAfter).toBeGreaterThan(0);
      }
    }, 30000); // Allow more time for this test
  });

  describe("POST /api/ask", () => {
    it("should handle golden case without AI", async () => {
      const response = await fetch(`${BASE_URL}/api/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: "哪门课程平均成绩最高？",
          datasetId: "demo",
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        console.log("Ask API response:", error);
      }

      expect(response.ok).toBe(true);
      const data = await response.json();
      expect(data.planning).toBeDefined();
      expect(data.planning.source).toBe("golden_case");
      expect(data.result.rows).toBeInstanceOf(Array);
    });

    it("should return AI_NOT_CONFIGURED for non-golden questions without API key", async () => {
      const response = await fetch(`${BASE_URL}/api/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: "这是一个需要AI处理的新问题",
          datasetId: "demo",
        }),
      });

      // Could be 503 (AI not configured) or 200 if API key is set
      if (response.status === 503) {
        const data = await response.json();
        expect(data.code).toBe("AI_NOT_CONFIGURED");
      } else if (response.status === 200) {
        // AI is configured, should work
        const data = await response.json();
        expect(data.planning.source).toBe("openai");
      }
    });

    it("should reject invalid question with 400", async () => {
      const response = await fetch(`${BASE_URL}/api/ask`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question: "a", // Too short
          datasetId: "demo",
        }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.code).toBe("INVALID_QUESTION");
    });

    it("should enforce stricter rate limiting for ask", async () => {
      // Ask has limit of 20/min, analysis has 30/min
      const requests = Array.from({ length: 25 }, () =>
        fetch(`${BASE_URL}/api/ask`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": "test-ask-rate-" + Date.now(),
          },
          body: JSON.stringify({
            question: "哪门课程平均成绩最高？",
            datasetId: "demo",
          }),
        })
      );

      const responses = await Promise.all(requests);
      const rateLimited = responses.filter((r) => r.status === 429);

      // Should hit 20/min limit
      expect(rateLimited.length).toBeGreaterThan(0);
    }, 30000);
  });

  describe("GET /api/profile", () => {
    it("should return dataset profiles", async () => {
      const response = await fetch(`${BASE_URL}/api/profile`);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.datasets).toBeInstanceOf(Array);
      expect(data.datasets.length).toBeGreaterThan(0);

      const demo = data.datasets.find((d: any) => d.id === "demo");
      expect(demo).toBeDefined();
      expect(demo.available).toBe(true);
    });
  });

  describe("GET /api/ai/status", () => {
    it("should return AI configuration status", async () => {
      const response = await fetch(`${BASE_URL}/api/ai/status`);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("configured");
      expect(data).toHaveProperty("model");
    });
  });

  describe("GET /api/ai/cost", () => {
    it("should return cost statistics", async () => {
      const response = await fetch(`${BASE_URL}/api/ai/cost`);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.stats).toBeDefined();
      expect(data.stats).toHaveProperty("totalCalls");
      expect(data.stats).toHaveProperty("lastHour");
      expect(data.stats).toHaveProperty("last24Hours");
    });
  });
});
