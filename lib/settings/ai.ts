import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
import type { AIBudgets, AIConfig, AIPricing } from "../client-types";
import { AuthError } from "../auth/service";
import { readState, updateState } from "./storage";

export const DEFAULT_BUDGETS: AIBudgets = { perRequest: 0.1, perHour: 5, perDay: 20, perMonth: 200 };
/** Reference estimates only. Administrators can override them for their account. */
export const REFERENCE_PRICING: Record<string, AIPricing> = {
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gpt-4o-2024-08-06": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4-turbo": { inputPerMillion: 10, outputPerMillion: 30 },
  "gpt-3.5-turbo": { inputPerMillion: 0.5, outputPerMillion: 1.5 },
};
const amount = z.number().finite().nonnegative().max(1_000_000);
export const aiConfigInputSchema = z.object({
  enabled: z.boolean(),
  apiFormat: z.enum(["responses", "chat_completions"]),
  baseUrl: z.string().trim().max(2048).refine((value) => {
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
    } catch { return false; }
  }, "接口地址必须是 HTTPS URL，且不能包含账号、查询参数或片段。"),
  model: z.string().trim().max(100).regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9._:-]{0,99})?$/),
  keyConfigured: z.boolean().optional(),
  apiKey: z.string().trim().max(1024).optional(),
  budgets: z.object({ perRequest: amount, perHour: amount, perDay: amount, perMonth: amount }).strict(),
  pricing: z.object({ inputPerMillion: amount.nullable(), outputPerMillion: amount.nullable() }).strict(),
}).strict();

type EncryptedKey = { iv: string; tag: string; ciphertext: string };
type Settings = {
  version: 1;
  enabled: boolean;
  apiFormat?: AIConfig["apiFormat"];
  baseUrl?: string;
  model: string;
  budgets: AIBudgets;
  pricing: AIPricing;
  encryptedApiKey: EncryptedKey | null;
  apiKeyOrigin?: string;
};
const encryptionContext = Buffer.from("student-analytics:ai-key:v1");

export const OFFICIAL_AI_BASE_URL = "https://api.openai.com/v1";
function endpointOrigin(baseUrl: string | undefined): string {
  return new URL(baseUrl || OFFICIAL_AI_BASE_URL).origin;
}
function environmentKey(state: Settings): string | null {
  if (!aiConfigInputSchema.shape.baseUrl.safeParse(process.env.OPENAI_BASE_URL?.trim() || "").success ||
      !aiConfigInputSchema.shape.baseUrl.safeParse(state.baseUrl || "").success) return null;
  const environmentOrigin = endpointOrigin(process.env.OPENAI_BASE_URL?.trim());
  return endpointOrigin(state.baseUrl) === environmentOrigin
    ? process.env.OPENAI_API_KEY?.trim() || null : null;
}
function savedKeyMatches(state: Settings): boolean {
  // Legacy ciphertext belongs to its existing endpoint; the next save persists the binding.
  return Boolean(state.encryptedApiKey) && aiConfigInputSchema.shape.baseUrl.safeParse(state.baseUrl || "").success &&
    (!state.apiKeyOrigin || state.apiKeyOrigin === endpointOrigin(state.baseUrl));
}

function envPrice(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}
function defaults(): Settings {
  const model = process.env.OPENAI_MODEL?.trim() || "";
  const reference = Object.hasOwn(REFERENCE_PRICING, model) ? REFERENCE_PRICING[model] : { inputPerMillion: null, outputPerMillion: null };
  return {
    version: 1,
    enabled: Boolean(process.env.OPENAI_API_KEY?.trim() && model),
    apiFormat: "responses",
    baseUrl: process.env.OPENAI_BASE_URL?.trim().replace(/\/+$/, "") || "",
    model,
    budgets: { ...DEFAULT_BUDGETS },
    pricing: {
      inputPerMillion: envPrice(process.env.OPENAI_INPUT_PRICE) ?? reference.inputPerMillion,
      outputPerMillion: envPrice(process.env.OPENAI_OUTPUT_PRICE) ?? reference.outputPerMillion,
    },
    encryptedApiKey: null,
  };
}

function encryptionKey(): Buffer {
  const encoded = process.env.APP_SETTINGS_KEY?.trim() || "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded) || Buffer.from(encoded, "base64").length !== 32) {
    throw new AuthError(503, "SETTINGS_KEY_REQUIRED", "服务器尚未配置有效的 APP_SETTINGS_KEY（32 字节 base64），无法安全保存或使用已保存的 AI 密钥。");
  }
  return Buffer.from(encoded, "base64");
}

function encrypt(value: string): EncryptedKey {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(encryptionContext);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: encrypted.toString("base64") };
}
function decrypt(key: EncryptedKey): string {
  const secret = encryptionKey();
  try {
    const decipher = createDecipheriv("aes-256-gcm", secret, Buffer.from(key.iv, "base64"));
    decipher.setAAD(encryptionContext);
    decipher.setAuthTag(Buffer.from(key.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(key.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch {
    throw new AuthError(503, "SETTINGS_KEY_INVALID", "AI 密钥无法解密，请恢复保存时使用的 APP_SETTINGS_KEY，或重新保存 AI 密钥。");
  }
}
function publicConfig(state: Settings): AIConfig {
  return {
    enabled: state.enabled,
    apiFormat: state.apiFormat ?? "responses",
    baseUrl: state.baseUrl ?? "",
    model: state.model,
    keyConfigured: state.encryptedApiKey ? savedKeyMatches(state) : Boolean(environmentKey(state)),
    budgets: { ...state.budgets },
    pricing: { ...state.pricing },
  };
}

export function getAIConfig(): AIConfig {
  return publicConfig(readState("ai-config.json", defaults));
}

export function saveAIConfig(payload: unknown): AIConfig {
  const input = aiConfigInputSchema.parse(payload);
  const encryptedApiKey = input.apiKey ? encrypt(input.apiKey) : undefined;
  return updateState("ai-config.json", defaults, (state) => {
    const origin = endpointOrigin(input.baseUrl);
    if (!encryptedApiKey && (
      (origin !== endpointOrigin(state.baseUrl) && (state.encryptedApiKey || environmentKey(state))) ||
      (state.encryptedApiKey && !savedKeyMatches(state))
    )) {
      throw new AuthError(400, "AI_KEY_REENTRY_REQUIRED", "接口所属域名或端口已更换，请重新填写该接口对应的 API 密钥。");
    }
    state.enabled = input.enabled;
    state.apiFormat = input.apiFormat;
    state.baseUrl = input.baseUrl.replace(/\/+$/, "");
    state.model = input.model;
    state.budgets = { ...input.budgets };
    state.pricing = { ...input.pricing };
    if (encryptedApiKey) state.encryptedApiKey = encryptedApiKey;
    if (state.encryptedApiKey) state.apiKeyOrigin = origin;
    return publicConfig(state);
  });
}

/** Server-side use only. The API must return getAIConfig(), never this object. */
export function getRuntimeAIConfig(): AIConfig & { apiKey: string | null } {
  const state = readState("ai-config.json", defaults);
  const apiKey = state.encryptedApiKey
    ? savedKeyMatches(state) ? decrypt(state.encryptedApiKey) : null
    : environmentKey(state);
  return { ...publicConfig(state), apiKey };
}
