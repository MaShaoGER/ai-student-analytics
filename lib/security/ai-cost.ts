/**
 * OpenAI API cost tracking and budget enforcement.
 * 
 * Tracks token usage and estimated costs to prevent runaway spending.
 */

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CostEstimate {
  promptCost: number;
  completionCost: number;
  totalCost: number;
  currency: string;
}

/**
 * Pricing as of 2024 (USD per 1M tokens)
 * https://openai.com/api/pricing/
 */
const MODEL_PRICING: Record<string, { prompt: number; completion: number }> = {
  "gpt-4o": { prompt: 2.5, completion: 10.0 },
  "gpt-4o-mini": { prompt: 0.15, completion: 0.6 },
  "gpt-4o-2024-08-06": { prompt: 2.5, completion: 10.0 },
  "gpt-4-turbo": { prompt: 10.0, completion: 30.0 },
  "gpt-3.5-turbo": { prompt: 0.5, completion: 1.5 },
};

/**
 * Calculate cost for token usage with a specific model.
 */
export function calculateCost(model: string, usage: TokenUsage): CostEstimate {
  const pricing = MODEL_PRICING[model] || MODEL_PRICING["gpt-4o-mini"];
  
  const promptCost = (usage.promptTokens / 1_000_000) * pricing.prompt;
  const completionCost = (usage.completionTokens / 1_000_000) * pricing.completion;
  
  return {
    promptCost,
    completionCost,
    totalCost: promptCost + completionCost,
    currency: "USD",
  };
}

/**
 * In-memory cost tracker for current session.
 * For production, persist to database or use Redis.
 */
interface CostRecord {
  timestamp: number;
  model: string;
  usage: TokenUsage;
  cost: CostEstimate;
  endpoint: string;
}

const costHistory: CostRecord[] = [];

/**
 * Record a single API call's cost.
 */
export function recordCost(
  model: string,
  usage: TokenUsage,
  endpoint: string = "unknown"
): CostEstimate {
  const cost = calculateCost(model, usage);
  costHistory.push({
    timestamp: Date.now(),
    model,
    usage,
    cost,
    endpoint,
  });
  return cost;
}

/**
 * Get total cost for a time window.
 */
export function getTotalCost(windowMs: number = 24 * 60 * 60 * 1000): CostEstimate {
  const now = Date.now();
  const cutoff = now - windowMs;
  
  const recentRecords = costHistory.filter((r) => r.timestamp > cutoff);
  
  return recentRecords.reduce(
    (acc, record) => ({
      promptCost: acc.promptCost + record.cost.promptCost,
      completionCost: acc.completionCost + record.cost.completionCost,
      totalCost: acc.totalCost + record.cost.totalCost,
      currency: "USD",
    }),
    { promptCost: 0, completionCost: 0, totalCost: 0, currency: "USD" }
  );
}

/**
 * Budget limits (USD)
 */
export const BUDGET_LIMITS = {
  perRequest: 0.1, // Max $0.10 per request
  perHour: 5.0, // Max $5/hour
  perDay: 20.0, // Max $20/day
  perMonth: 200.0, // Max $200/month
};

export class BudgetExceededError extends Error {
  constructor(
    public readonly limit: string,
    public readonly current: number,
    public readonly max: number
  ) {
    super(`预算超限（${limit}）：当前 $${current.toFixed(4)}，上限 $${max.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

/**
 * Check if a request would exceed budget limits.
 */
export function checkBudget(estimatedCost: number = 0.05): void {
  const hourCost = getTotalCost(60 * 60 * 1000).totalCost;
  const dayCost = getTotalCost(24 * 60 * 60 * 1000).totalCost;
  const monthCost = getTotalCost(30 * 24 * 60 * 60 * 1000).totalCost;

  if (estimatedCost > BUDGET_LIMITS.perRequest) {
    throw new BudgetExceededError("单次请求", estimatedCost, BUDGET_LIMITS.perRequest);
  }

  if (hourCost + estimatedCost > BUDGET_LIMITS.perHour) {
    throw new BudgetExceededError("每小时", hourCost, BUDGET_LIMITS.perHour);
  }

  if (dayCost + estimatedCost > BUDGET_LIMITS.perDay) {
    throw new BudgetExceededError("每天", dayCost, BUDGET_LIMITS.perDay);
  }

  if (monthCost + estimatedCost > BUDGET_LIMITS.perMonth) {
    throw new BudgetExceededError("每月", monthCost, BUDGET_LIMITS.perMonth);
  }
}

/**
 * Get cost statistics for monitoring.
 */
export function getCostStats() {
  return {
    total: costHistory.length,
    last24h: getTotalCost(24 * 60 * 60 * 1000),
    lastHour: getTotalCost(60 * 60 * 1000),
    byModel: costHistory.reduce(
      (acc, record) => {
        if (!acc[record.model]) {
          acc[record.model] = { calls: 0, totalCost: 0 };
        }
        acc[record.model].calls += 1;
        acc[record.model].totalCost += record.cost.totalCost;
        return acc;
      },
      {} as Record<string, { calls: number; totalCost: number }>
    ),
  };
}

/**
 * Clear old records (cleanup to prevent memory leak).
 * Call this periodically or on a schedule.
 */
export function cleanupOldRecords(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
  const now = Date.now();
  const cutoff = now - maxAgeMs;
  const before = costHistory.length;
  
  // Remove records older than cutoff
  let i = 0;
  while (i < costHistory.length) {
    if (costHistory[i].timestamp < cutoff) {
      costHistory.splice(i, 1);
    } else {
      i++;
    }
  }
  
  return before - costHistory.length;
}

// Cleanup every 6 hours
setInterval(() => cleanupOldRecords(), 6 * 60 * 60 * 1000);
