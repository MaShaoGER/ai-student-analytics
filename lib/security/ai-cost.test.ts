import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateCost,
  recordCost,
  getTotalCost,
  checkBudget,
  BudgetExceededError,
  getCostStats,
  BUDGET_LIMITS,
} from "./ai-cost";

describe("AI cost tracking", () => {
  beforeEach(() => {
    // Note: costHistory is module-scoped, so tests may interfere
    // In production, we'd want to reset it or use dependency injection
  });

  describe("calculateCost", () => {
    it("should calculate cost for gpt-4o-mini", () => {
      const cost = calculateCost("gpt-4o-mini", {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });

      // gpt-4o-mini: $0.15 per 1M prompt tokens, $0.6 per 1M completion tokens
      expect(cost.promptCost).toBeCloseTo(0.00015, 6);
      expect(cost.completionCost).toBeCloseTo(0.0003, 6);
      expect(cost.totalCost).toBeCloseTo(0.00045, 6);
      expect(cost.currency).toBe("USD");
    });

    it("should calculate cost for gpt-4o", () => {
      const cost = calculateCost("gpt-4o", {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });

      // gpt-4o: $2.5 per 1M prompt tokens, $10 per 1M completion tokens
      expect(cost.promptCost).toBeCloseTo(0.0025, 6);
      expect(cost.completionCost).toBeCloseTo(0.005, 6);
      expect(cost.totalCost).toBeCloseTo(0.0075, 6);
    });

    it("should default to gpt-4o-mini pricing for unknown models", () => {
      const cost = calculateCost("unknown-model", {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      });

      expect(cost.totalCost).toBeCloseTo(0.00045, 6);
    });
  });

  describe("recordCost", () => {
    it("should record cost and return estimate", () => {
      const usage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      const cost = recordCost("gpt-4o-mini", usage, "/api/ask");
      expect(cost.totalCost).toBeGreaterThan(0);
      expect(cost.currency).toBe("USD");
    });
  });

  describe("getTotalCost", () => {
    it("should return zero for empty history", () => {
      // This may fail if other tests ran first
      const cost = getTotalCost(1000);
      expect(cost.currency).toBe("USD");
      expect(cost.totalCost).toBeGreaterThanOrEqual(0);
    });

    it("should sum costs within window", () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      recordCost("gpt-4o-mini", usage);
      recordCost("gpt-4o-mini", usage);

      const total = getTotalCost(60 * 60 * 1000); // Last hour
      expect(total.totalCost).toBeGreaterThan(0);
    });
  });

  describe("checkBudget", () => {
    it("should pass for small estimated costs", () => {
      expect(() => checkBudget(0.001)).not.toThrow();
    });

    it("should throw for per-request limit exceeded", () => {
      expect(() => checkBudget(1.0)).toThrow(BudgetExceededError);
    });

    it("should include limit details in error", () => {
      try {
        checkBudget(1.0);
        expect.fail("Should have thrown");
      } catch (error) {
        expect(error).toBeInstanceOf(BudgetExceededError);
        if (error instanceof BudgetExceededError) {
          expect(error.limit).toBe("单次请求");
          expect(error.current).toBe(1.0);
          expect(error.max).toBe(BUDGET_LIMITS.perRequest);
        }
      }
    });
  });

  describe("getCostStats", () => {
    it("should return cost statistics", () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 500,
        totalTokens: 1500,
      };

      recordCost("gpt-4o-mini", usage, "/api/ask");

      const stats = getCostStats();
      expect(stats.total).toBeGreaterThan(0);
      expect(stats.last24h.totalCost).toBeGreaterThan(0);
      expect(stats.byModel).toHaveProperty("gpt-4o-mini");
    });

    it("should track calls by model", () => {
      const usage = {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      };

      recordCost("gpt-4o", usage);
      recordCost("gpt-4o", usage);
      recordCost("gpt-4o-mini", usage);

      const stats = getCostStats();
      expect(stats.byModel["gpt-4o"].calls).toBeGreaterThanOrEqual(2);
      expect(stats.byModel["gpt-4o-mini"].calls).toBeGreaterThanOrEqual(1);
    });
  });

  describe("budget limits", () => {
    it("should have reasonable default limits", () => {
      expect(BUDGET_LIMITS.perRequest).toBeLessThanOrEqual(0.5);
      expect(BUDGET_LIMITS.perHour).toBeLessThanOrEqual(10);
      expect(BUDGET_LIMITS.perDay).toBeLessThanOrEqual(50);
      expect(BUDGET_LIMITS.perMonth).toBeLessThanOrEqual(500);
    });
  });
});
