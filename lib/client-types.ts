/** Public API contracts. Never add credential or session secrets here. */
export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  role: "admin" | "user";
};

export type ManagedUser = SessionUser & { disabled: boolean; createdAt: string };
export type SessionResponse = { user: SessionUser | null; setupRequired: boolean };

export type AIBudgets = {
  perRequest: number;
  perHour: number;
  perDay: number;
  perMonth: number;
};
export type AIPricing = {
  inputPerMillion: number | null;
  outputPerMillion: number | null;
};
export type AIConfig = {
  enabled: boolean;
  apiFormat: "responses" | "chat_completions";
  baseUrl: string;
  model: string;
  keyConfigured: boolean;
  budgets: AIBudgets;
  pricing: AIPricing;
};
export type AICostStats = {
  totalCalls: number;
  /** Calls billed from provider-reported usage. */
  measuredCalls: number;
  /** Calls billed from the request heuristic (network failure or no usage). */
  estimatedCalls: number;
  /** Cost attributed to estimated calls, fixed to 4 decimals. */
  estimatedCost: string;
  /** Share of total cost that came from estimates, 0–1 rounded to 2 decimals. */
  estimatedShare: number;
  lastHour: { totalCost: string; currency: string };
  last24Hours: { totalCost: string; currency: string };
  byModel: { model: string; calls: number; totalCost: string }[];
  /** Kept for compatibility: every figure here is an estimate, not a bill. */
  estimated: true;
};
export type AIConfigResponse = { config: AIConfig; stats: AICostStats };
export type AITestResponse = { success: true; message: string; model: string; stats: AICostStats };
