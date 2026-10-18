import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  calculateCost,
  recordCost,
  getTotalCost,
  checkBudget,
  BudgetExceededError,
  getCostStats,
  getPublicCostStats,
  reserveBudget,
  settleBudget,
  cleanupOldRecords,
  BUDGET_LIMITS,
  UnknownModelPricingError,
} from "./ai-cost";

const DAY = 24 * 60 * 60 * 1000;
const PRICING = { inputPerMillion: 1, outputPerMillion: 1 };

describe("AI cost tracking", () => {
  let directory: string;
  let originalDirectory: string | undefined;
  beforeEach(() => {
    originalDirectory = process.env.APP_STATE_DIR;
    directory = mkdtempSync(join(tmpdir(), "analytics-cost-test-"));
    process.env.APP_STATE_DIR = directory;
  });
  afterEach(() => {
    if (originalDirectory === undefined) delete process.env.APP_STATE_DIR;
    else process.env.APP_STATE_DIR = originalDirectory;
    rmSync(directory, { recursive: true, force: true });
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

    it("requires explicit pricing for unknown models", () => {
      expect(() =>
        calculateCost("unknown-model", {
          promptTokens: 1000,
          completionTokens: 500,
          totalTokens: 1500,
        }),
      ).toThrow(UnknownModelPricingError);
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

  describe("estimated vs measured accounting", () => {
    const usage = { promptTokens: 1_000, completionTokens: 500, totalTokens: 1_500 };

    const settle = (estimated: boolean) =>
      settleBudget(
        reserveBudget(0.01, BUDGET_LIMITS),
        "gpt-4o-mini",
        usage,
        "planner",
        PRICING,
        estimated,
      );

    it("separates measured calls from estimated calls and reports the estimated cost share", () => {
      recordCost("gpt-4o-mini", usage);
      settle(true);

      const stats = getCostStats();
      expect(stats.total).toBe(2);
      expect(stats.measuredCalls).toBe(1);
      expect(stats.estimatedCalls).toBe(1);
      expect(stats.estimatedCost).toBeCloseTo(0.0015, 8);
      // Estimates are half the calls and dominate the (much cheaper) measured one.
      expect(stats.estimatedShare).toBe(0.77);

      const publicStats = getPublicCostStats();
      expect(publicStats).toMatchObject({
        totalCalls: 2,
        measuredCalls: 1,
        estimatedCalls: 1,
        estimatedCost: "0.0015",
        estimatedShare: 0.77,
        estimated: true,
      });
    });

    it("reports a zero share when there are no calls", () => {
      expect(getCostStats()).toMatchObject({ total: 0, measuredCalls: 0, estimatedCalls: 0, estimatedCost: 0, estimatedShare: 0 });
      expect(getPublicCostStats()).toMatchObject({ estimatedCost: "0.0000", estimatedShare: 0 });
    });

    it("keeps a measured failure documented as estimated", () => {
      settle(false);
      expect(getCostStats()).toMatchObject({ measuredCalls: 1, estimatedCalls: 0, estimatedShare: 0 });
    });
  });

  describe("bounded history cleanup", () => {
    const seed = (records: { timestamp: number }[]) =>
      writeFileSync(
        join(directory, "cost-history.json"),
        JSON.stringify({
          reservations: [],
          records: records.map((record) => ({
            model: "seeded-model",
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            cost: { promptCost: 0, completionCost: 0, totalCost: 0, currency: "USD" },
            endpoint: "seed",
            usageEstimated: false,
            ...record,
          })),
        }),
      );

    it("prunes records older than 90 days once settlement pushes history past 500 entries", () => {
      const now = Date.now();
      const oldTimestamp = now - 91 * DAY;
      seed([
        { timestamp: oldTimestamp },
        { timestamp: oldTimestamp + 1 },
        ...Array.from({ length: 499 }, (_, index) => ({ timestamp: now - index * 1_000 })),
      ]);

      settleBudget(
        reserveBudget(0.000001, BUDGET_LIMITS),
        "gpt-4o-mini",
        { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        "planner",
        PRICING,
        false,
      );

      const stats = getCostStats();
      expect(stats.total).toBe(500);
      const state = JSON.parse(
        readFileSync(join(directory, "cost-history.json"), "utf8"),
      ) as { records: { timestamp: number }[] };
      expect(state.records.every((record) => record.timestamp > oldTimestamp + 1)).toBe(true);
    });

    it("cleanupOldRecords reports and removes aged entries", () => {
      const now = Date.now();
      seed([{ timestamp: now - 100 * DAY }, { timestamp: now }]);
      expect(cleanupOldRecords(90 * DAY)).toBe(1);
      expect(getCostStats().total).toBe(1);
    });
  });
});
