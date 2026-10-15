import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { planQuestion } from "./planner";
import { isZhipuGLMFlash, ZHIPU_GLM_FLASH } from "./zhipu";
import { saveAIConfig } from "../settings/ai";
import { readState } from "../settings/storage";
import { getCostStats, UnknownModelPricingError } from "../security/ai-cost";

describe("Zhipu GLM Flash endpoint detection", () => {
  it.each([ZHIPU_GLM_FLASH.baseUrl, `${ZHIPU_GLM_FLASH.baseUrl}/`])("recognizes %s", (baseUrl) => {
    expect(isZhipuGLMFlash({ ...ZHIPU_GLM_FLASH, baseUrl })).toBe(true);
  });

  it.each([
    "", "https://models.example.test/v1",
    "https://open.bigmodel.cn.example.test/api/paas/v4",
    "https://open.bigmodel.cn@models.example.test/api/paas/v4",
    "https://user:pass@open.bigmodel.cn/api/paas/v4",
    "http://open.bigmodel.cn/api/paas/v4",
    "https://open.bigmodel.cn/api/coding/paas/v4",
    "https://open.bigmodel.cn/api/paas/v4?mode=coding",
  ])("does not send proprietary parameters to %s", (baseUrl) => {
    expect(isZhipuGLMFlash({ ...ZHIPU_GLM_FLASH, baseUrl })).toBe(false);
  });

  it("does not apply Flash parameters to a different model", () => {
    expect(isZhipuGLMFlash({ ...ZHIPU_GLM_FLASH, model: "glm-4.7-flashx" })).toBe(false);
  });
});

// Exercise the actual OpenAI SDK serialization; all HTTP traffic stops at this fake fetch.
describe("Zhipu GLM Flash planner transport and accounting", () => {
  let directory: string;
  let fetchStub: ReturnType<typeof vi.fn>;
  let sent: { url: string; authorization: string | null; body: Record<string, unknown> };
  let content: string | null;
  let finishReason: string;
  let status: number;
  let providerCode: string | null;
  const fields = {
    canAnalyze: true, metric: "score", dimension: "course", chartType: "table",
    rationale: "按课程比较平均成绩。", clarificationQuestion: null,
  };
  const question = "请把各门课的均分列成表格";
  const key = "fictional-zhipu-key-for-transport-tests";
  const config = {
    ...ZHIPU_GLM_FLASH,
    enabled: true,
    apiKey: key,
    pricing: { inputPerMillion: 0, outputPerMillion: 0 },
    budgets: { perRequest: 0.01, perHour: 0.1, perDay: 0.5, perMonth: 2 },
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "analytics-zhipu-test-"));
    vi.stubEnv("APP_STATE_DIR", directory);
    vi.stubEnv("APP_SETTINGS_KEY", Buffer.alloc(32, 44).toString("base64"));
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
    saveAIConfig(config);
    content = JSON.stringify(fields);
    finishReason = "stop";
    status = 200;
    providerCode = null;
    fetchStub = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      sent = { url: request.url, authorization: request.headers.get("authorization"), body: await request.json() };
      const body = status === 200 ? {
        id: "fictional-chat-completion", object: "chat.completion", created: 1,
        model: ZHIPU_GLM_FLASH.model,
        choices: [{ index: 0, finish_reason: finishReason, message: { role: "assistant", content } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      } : { error: { code: providerCode ?? String(status), message: `Fictional private provider details ${key}` } };
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("serializes JSON mode and disabled thinking, and records tokens at zero cost", async () => {
    const result = await planQuestion({ question, datasetId: "demo" });
    expect(result).toMatchObject({ source: "external", model: "glm-4.7-flash", plan: {
      metric: "score", dimensions: ["course"], chartType: "table",
    } });
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(sent.url).toBe("https://open.bigmodel.cn/api/paas/v4/chat/completions");
    expect(sent.authorization).toBe(`Bearer ${key}`);
    expect(sent.body).toMatchObject({ model: "glm-4.7-flash", max_tokens: 500,
      thinking: { type: "disabled" }, response_format: { type: "json_object" },
      messages: expect.arrayContaining([expect.objectContaining({ role: "system", content: expect.stringContaining("JSON") })]),
    });
    expect(sent.body).not.toHaveProperty("enable_thinking");
    expect(sent.body).not.toHaveProperty("extra_body");
    expect(JSON.stringify(sent.body)).not.toContain(key);
    expect(getCostStats()).toMatchObject({ total: 1, last24h: { totalCost: 0 } });
    expect(readState("cost-history.json", () => ({}))).toMatchObject({ reservations: [], records: [{
      model: "glm-4.7-flash", usageEstimated: false,
      usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 }, cost: { totalCost: 0 },
    }] });
  });

  it("builds activity trends from a valid Chinese planning response", async () => {
    content = JSON.stringify({ ...fields, metric: "activity", dimension: "term", chartType: "line" });
    const result = await planQuestion({ question: "按学期展示学习活动的变化趋势", datasetId: "demo" });
    expect(result.plan).toMatchObject({ metric: "activity", dimensions: ["term"], chartType: "line", aggregation: "sum" });
  });

  it.each(["分析学生表现", "给我每个学生的家庭收入"])("requests clarification for %s", async (question) => {
    content = JSON.stringify({ ...fields, canAnalyze: false, clarificationQuestion: "是否改为比较各课程的平均成绩？" });
    await expect(planQuestion({ question, datasetId: "demo" })).rejects.toMatchObject({ name: "AIClarificationError" });
    expect(getCostStats().total).toBe(1);
  });

  it.each(["invalid JSON", "invalid metric", "empty content", "truncated output"])("rejects %s while recording returned usage", async (scenario) => {
    if (scenario === "invalid JSON") content = '```json\n{}\n```';
    if (scenario === "invalid metric") content = JSON.stringify({ ...fields, metric: "household_income" });
    if (scenario === "empty content") content = null;
    if (scenario === "truncated output") finishReason = "length";
    await expect(planQuestion({ question, datasetId: "demo" })).rejects.toThrow();
    expect(getCostStats().total).toBe(1);
    expect(readState("cost-history.json", () => ({}))).toMatchObject({ reservations: [], records: [{ usageEstimated: false }] });
  });

  it.each([401, 429])("does not retry HTTP %s and settles zero-cost estimated usage", async (providerStatus) => {
    status = providerStatus;
    await expect(planQuestion({ question, datasetId: "demo" })).rejects.toMatchObject({ status: providerStatus });
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(readState("cost-history.json", () => ({}))).toMatchObject({ reservations: [], records: [{ usageEstimated: true, cost: { totalCost: 0 } }] });
  });

  it("classifies Zhipu overload code 1305 without leaking provider details or retrying", async () => {
    status = 429;
    providerCode = "1305";
    const error = await planQuestion({ question, datasetId: "demo" }).catch((error: unknown) => error);
    expect(error).toMatchObject({ name: "AIProviderError", status: 429, code: "AI_PROVIDER_OVERLOADED" });
    expect(String(error)).toContain("访问量过大");
    expect(String(error)).not.toContain(key);
    expect(String(error)).not.toContain("private provider details");
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(readState("cost-history.json", () => ({}))).toMatchObject({ reservations: [], records: [{ usageEstimated: true, cost: { totalCost: 0 } }] });
  });

  it("still requires explicit prices before calling, including for a free-model name", async () => {
    saveAIConfig({ ...config, pricing: { inputPerMillion: null, outputPerMillion: null } });
    await expect(planQuestion({ question, datasetId: "demo" })).rejects.toBeInstanceOf(UnknownModelPricingError);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});
