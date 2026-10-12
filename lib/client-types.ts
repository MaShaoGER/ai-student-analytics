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
  model: string;
  keyConfigured: boolean;
  budgets: AIBudgets;
  pricing: AIPricing;
};
export type AICostStats = {
  totalCalls: number;
  lastHour: { totalCost: string; currency: string };
  last24Hours: { totalCost: string; currency: string };
  byModel: { model: string; calls: number; totalCost: string }[];
  estimated: true;
};
export type AIConfigResponse = { config: AIConfig; stats: AICostStats };
export type AITestResponse = { success: true; message: string; model: string; stats: AICostStats };
