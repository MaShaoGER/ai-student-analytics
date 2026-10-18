import { randomUUID } from "node:crypto";
import type { AIBudgets, AICostStats, AIPricing } from "../client-types";
import { DEFAULT_BUDGETS, getAIConfig, REFERENCE_PRICING } from "../settings/ai";
import { readState, updateState } from "../settings/storage";

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
interface CostRecord {
  timestamp: number;
  model: string;
  usage: TokenUsage;
  cost: CostEstimate;
  endpoint: string;
  usageEstimated?: boolean;
}
type Reservation = { id: string; timestamp: number; amount: number };
type CostStore = { records: CostRecord[]; reservations: Reservation[] };
const initial = (): CostStore => ({ records: [], reservations: [] });
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Keep history bounded without paying a prune on every call. */
const COST_HISTORY_PRUNE_THRESHOLD = 500;
const COST_HISTORY_RETENTION_MS = 90 * DAY;
export const BUDGET_LIMITS = { ...DEFAULT_BUDGETS };

export class UnknownModelPricingError extends Error {
  constructor(public readonly model: string) {
    super("当前模型尚未设置估算单价，请让管理员填写输入与输出 token 单价后重试。");
    this.name = "UnknownModelPricingError";
  }
}
export class BudgetExceededError extends Error {
  constructor(public readonly limit: string, public readonly current: number, public readonly max: number) {
    super(`AI 预算已达上限（${limit}）：预计 $${current.toFixed(4)}，上限 $${max.toFixed(2)}。`);
    this.name = "BudgetExceededError";
  }
}

export function calculateCost(model: string, usage: TokenUsage, override?: AIPricing): CostEstimate {
  const pricing = override ?? (Object.hasOwn(REFERENCE_PRICING, model) ? REFERENCE_PRICING[model] : undefined);
  if (!pricing || pricing.inputPerMillion === null || pricing.outputPerMillion === null) throw new UnknownModelPricingError(model);
  for (const value of [usage.promptTokens, usage.completionTokens, usage.totalTokens, pricing.inputPerMillion, pricing.outputPerMillion]) {
    if (!Number.isFinite(value) || value < 0) throw new Error("AI 费用数据不合法。");
  }
  const promptCost = usage.promptTokens / 1_000_000 * pricing.inputPerMillion;
  const completionCost = usage.completionTokens / 1_000_000 * pricing.outputPerMillion;
  return { promptCost, completionCost, totalCost: promptCost + completionCost, currency: "USD" };
}

export function recordCost(model: string, usage: TokenUsage, endpoint = "unknown", pricing?: AIPricing): CostEstimate {
  const cost = calculateCost(model, usage, pricing);
  updateState("cost-history.json", initial, (state) => {
    state.records.push({ timestamp: Date.now(), model, usage, cost, endpoint });
  });
  return cost;
}

function totalFor(records: CostRecord[], windowMs: number): CostEstimate {
  const cutoff = Date.now() - windowMs;
  return records.filter((record) => record.timestamp > cutoff).reduce((total, record) => ({
    promptCost: total.promptCost + record.cost.promptCost,
    completionCost: total.completionCost + record.cost.completionCost,
    totalCost: total.totalCost + record.cost.totalCost,
    currency: "USD",
  }), { promptCost: 0, completionCost: 0, totalCost: 0, currency: "USD" });
}

export function getTotalCost(windowMs: number = DAY): CostEstimate {
  return totalFor(readState("cost-history.json", initial).records, windowMs);
}

function assertBudget(state: CostStore, estimatedCost: number, limits: AIBudgets): void {
  if (!Number.isFinite(estimatedCost) || estimatedCost < 0) throw new Error("AI 预计费用不合法。");
  if (estimatedCost > limits.perRequest) throw new BudgetExceededError("单次请求", estimatedCost, limits.perRequest);
  for (const [name, windowMs, limit] of [["每小时", HOUR, limits.perHour], ["每天", DAY, limits.perDay], ["每月", 30 * DAY, limits.perMonth]] as const) {
    const reservations = state.reservations.filter((reservation) => reservation.timestamp > Date.now() - windowMs).reduce((amount, reservation) => amount + reservation.amount, 0);
    const current = totalFor(state.records, windowMs).totalCost + reservations + estimatedCost;
    if (current > limit) throw new BudgetExceededError(name, current, limit);
  }
}

export function checkBudget(estimatedCost: number = 0.05, limits: AIBudgets = getAIConfig().budgets): void {
  assertBudget(readState("cost-history.json", initial), estimatedCost, limits);
}

/** Reservation and budget check share a transaction so parallel calls count each other. */
export function reserveBudget(estimatedCost: number, limits: AIBudgets = getAIConfig().budgets): string {
  return updateState("cost-history.json", initial, (state) => {
    // Crashed calls retain their conservative estimate in all budget windows.
    assertBudget(state, estimatedCost, limits);
    const id = randomUUID();
    state.reservations.push({ id, timestamp: Date.now(), amount: estimatedCost });
    return id;
  });
}

export function settleBudget(id: string, model: string, usage: TokenUsage, endpoint: string, pricing: AIPricing, usageEstimated = false): CostEstimate {
  const cost = calculateCost(model, usage, pricing);
  const recordCount = updateState("cost-history.json", initial, (state) => {
    const reservation = state.reservations.find((candidate) => candidate.id === id);
    if (!reservation) throw new Error("AI 预算记录不存在或已结算。");
    state.reservations = state.reservations.filter((candidate) => candidate.id !== id);
    state.records.push({ timestamp: Date.now(), model, usage, cost, endpoint, usageEstimated });
    return state.records.length;
  });
  // Bound unbounded history growth. Pruning runs as a separate transaction and
  // only once the file is large, so normal calls keep their single write.
  if (recordCount > COST_HISTORY_PRUNE_THRESHOLD) cleanupOldRecords(COST_HISTORY_RETENTION_MS);
  return cost;
}

export function releaseBudget(id: string): void {
  updateState("cost-history.json", initial, (state) => {
    state.reservations = state.reservations.filter((candidate) => candidate.id !== id);
  });
}

export function getCostStats() {
  const state = readState("cost-history.json", initial);
  const estimatedRecords = state.records.filter((record) => record.usageEstimated === true);
  const totalCost = state.records.reduce((sum, record) => sum + record.cost.totalCost, 0);
  const estimatedCost = estimatedRecords.reduce((sum, record) => sum + record.cost.totalCost, 0);
  return {
    total: state.records.length,
    estimatedCalls: estimatedRecords.length,
    measuredCalls: state.records.length - estimatedRecords.length,
    estimatedCost,
    // Cost share of calls billed from an estimate rather than provider usage.
    estimatedShare: totalCost > 0 ? Math.round((estimatedCost / totalCost) * 100) / 100 : 0,
    last24h: totalFor(state.records, DAY),
    lastHour: totalFor(state.records, HOUR),
    byModel: state.records.reduce((byModel, record) => {
      const existing = byModel[record.model] ?? { calls: 0, totalCost: 0 };
      byModel[record.model] = { calls: existing.calls + 1, totalCost: existing.totalCost + record.cost.totalCost };
      return byModel;
    }, Object.create(null) as Record<string, { calls: number; totalCost: number }>),
  };
}

export function getPublicCostStats(): AICostStats {
  const stats = getCostStats();
  return {
    totalCalls: stats.total,
    estimatedCalls: stats.estimatedCalls,
    measuredCalls: stats.measuredCalls,
    estimatedCost: stats.estimatedCost.toFixed(4),
    estimatedShare: stats.estimatedShare,
    lastHour: { totalCost: stats.lastHour.totalCost.toFixed(4), currency: "USD" },
    last24Hours: { totalCost: stats.last24h.totalCost.toFixed(4), currency: "USD" },
    byModel: Object.entries(stats.byModel).map(([model, data]) => ({ model, calls: data.calls, totalCost: data.totalCost.toFixed(4) })),
    estimated: true,
  };
}

export function cleanupOldRecords(maxAgeMs: number = 30 * DAY): number {
  return updateState("cost-history.json", initial, (state) => {
    const before = state.records.length;
    const cutoff = Date.now() - maxAgeMs;
    state.records = state.records.filter((record) => record.timestamp >= cutoff);
    state.reservations = state.reservations.filter((reservation) => reservation.timestamp >= cutoff);
    return before - state.records.length;
  });
}
