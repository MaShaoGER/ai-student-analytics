import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { APIConnectionTimeoutError, APIUserAbortError } from "openai/core/error";
import { z } from "zod";
import type { AIConfig } from "../client-types";
import { generateStructured, getAIStatus, planQuestion } from "../ai/planner";
import { converse } from "../ai/conversation";
import { BAILIAN_QWEN_FLASH } from "../ai/bailian";
import {
  BudgetExceededError,
  checkBudget,
  getCostStats,
  getTotalCost,
  recordCost,
  releaseBudget,
  reserveBudget,
  settleBudget,
} from "../security/ai-cost";
import { getAIConfig, getRuntimeAIConfig, saveAIConfig } from "./ai";
import { readState, updateState } from "./storage";

const openAIStub = vi.hoisted(() => ({
  options: null as unknown,
  parse: vi.fn(),
  create: vi.fn(),
}));

// Exercise the real planner/configuration/cost path while forbidding network calls.
vi.mock("openai", () => ({
  default: class {
    responses = { parse: openAIStub.parse };
    chat = { completions: { create: openAIStub.create } };
    constructor(options: unknown) {
      openAIStub.options = options;
    }
  },
}));

const execute = promisify(execFile);
const SAVED_KEY = "sk-fictional-saved-key-for-unit-tests";
const ENV_KEY = "sk-fictional-env-key-for-unit-tests";
const SETTINGS_KEY = Buffer.alloc(32, 42).toString("base64");
const config: AIConfig = {
  enabled: true,
  apiFormat: "responses",
  baseUrl: "",
  model: "campus-analysis-custom",
  keyConfigured: true,
  budgets: { perRequest: 0.1, perHour: 1, perDay: 5, perMonth: 20 },
  pricing: { inputPerMillion: 2, outputPerMillion: 5 },
};
const usage = { promptTokens: 1_000, completionTokens: 500, totalTokens: 1_500 };
let stateDir: string;

describe("persistent AI settings and usage", () => {
  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "analytics-settings-test-"));
    vi.stubEnv("APP_STATE_DIR", stateDir);
    vi.stubEnv("APP_SETTINGS_KEY", SETTINGS_KEY);
    vi.stubEnv("OPENAI_API_KEY", ENV_KEY);
    vi.stubEnv("OPENAI_MODEL", "gpt-4o-mini");
    vi.stubEnv("OPENAI_INPUT_PRICE", "");
    vi.stubEnv("OPENAI_OUTPUT_PRICE", "");
    openAIStub.options = null;
    openAIStub.parse.mockReset();
    openAIStub.create.mockReset();
    openAIStub.parse.mockResolvedValue({
      output_parsed: {
        canAnalyze: true,
        metric: "score",
        dimension: "term",
        chartType: "line",
        rationale: "比较各学期的平均成绩。",
        clarificationQuestion: null,
      },
      usage: { input_tokens: 1_000, output_tokens: 500, total_tokens: 1_500 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it.each(["responses", "chat_completions"] as const)(
    "executes conversation planning, real aggregate query and explanation using %s",
    async (apiFormat) => {
      saveAIConfig({ ...config, apiFormat, apiKey: SAVED_KEY });
      const decision = {
        action: "analysis",
        tool: null, courses: null, terms: null, dimensions: null, threshold: null,
        message: "按指定课程和学期查询。",
        metric: "score",
        dimension: "course",
        course: "AAA",
        term: "2024J",
        binWidth: null,
        view: "table",
        sortBy: "value",
        sortDirection: "desc",
        limit: 20,
      };
      const explanation = {
        answer: "这些结果只描述当前课程学期，不能据此推断教学原因。",
        suggestions: ["按学期比较"],
      };
      if (apiFormat === "responses") {
        openAIStub.parse
          .mockReset()
          .mockResolvedValueOnce({
            output_parsed: decision,
            usage: { input_tokens: 200, output_tokens: 100, total_tokens: 300 },
          })
          .mockResolvedValueOnce({
            output_parsed: explanation,
            usage: { input_tokens: 250, output_tokens: 100, total_tokens: 350 },
          });
      } else {
        openAIStub.create
          .mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify(decision) } }],
            usage: { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 },
          })
          .mockResolvedValueOnce({
            choices: [{ message: { content: JSON.stringify(explanation) } }],
            usage: { prompt_tokens: 250, completion_tokens: 100, total_tokens: 350 },
          });
      }
      const result = await converse({
        question: "只看AAA课程在2024J的平均成绩，用表格显示并解读",
        datasetId: "demo",
      });
      expect(result.kind).toBe("result");
      expect(result.answer).toContain(explanation.answer);
      expect(result.answer).toContain("79.67");
      expect(result.artifact).toMatchObject({
        kind: "analysis",
        view: "table",
        result: { rows: [{ dimension: "AAA", sampleSize: 3 }] },
      });
      expect(result.facts.join(" ")).toContain("79.67");
      const calls =
        apiFormat === "responses" ? openAIStub.parse.mock.calls : openAIStub.create.mock.calls;
      expect(calls).toHaveLength(2);
      expect(JSON.stringify(calls[1][0])).toContain("79.67");
      expect(getCostStats().total).toBe(2);
      const cost = readState("cost-history.json", () => ({
        records: [] as { endpoint: string }[],
      }));
      expect(cost.records.map((record) => record.endpoint)).toEqual(["chat-plan", "chat-explain"]);
    },
  );

  it("applies the remaining conversation request budget before attempting another model call", async () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    await expect(
      generateStructured(
        "解释一下",
        "只解释方法。",
        z.object({ answer: z.string() }),
        { budgetContext: { spent: config.budgets.perRequest } },
        "chat-explain",
        900,
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(openAIStub.parse).not.toHaveBeenCalled();
    expect(getCostStats().total).toBe(0);
  });

  it("encrypts saved keys, exposes only configuration status, and keeps state files private", () => {
    const saved = saveAIConfig({ ...config, apiKey: SAVED_KEY });

    expect(saved).toEqual(config);
    expect(getAIConfig()).toEqual(config);
    expect(getRuntimeAIConfig().apiKey).toBe(SAVED_KEY);
    expect(JSON.stringify(saved)).not.toContain(SAVED_KEY);
    expect(saved).not.toHaveProperty("apiKey");
    const file = path.join(stateDir, "ai-config.json");
    const persisted = readFileSync(file, "utf8");
    expect(persisted).not.toContain(SAVED_KEY);
    expect(persisted).not.toContain(ENV_KEY);
    expect(persisted).not.toContain(SETTINGS_KEY);
    expect(persisted).toContain("encryptedApiKey");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("opens pre-upgrade settings with the official Responses defaults", () => {
    writeFileSync(path.join(stateDir, "ai-config.json"), JSON.stringify({
      version: 1, enabled: true, model: "gpt-4o-mini",
      budgets: config.budgets, pricing: config.pricing, encryptedApiKey: null,
    }));
    expect(getAIConfig()).toMatchObject({ apiFormat: "responses", baseUrl: "", model: "gpt-4o-mini" });
  });

  it("preserves the saved key when the administrator leaves the replacement field empty", () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    const updated = {
      ...config,
      model: "campus-analysis-v2",
      budgets: { ...config.budgets, perHour: 2 },
    };
    saveAIConfig({ ...updated, apiKey: "   " });

    expect(getAIConfig()).toEqual(updated);
    expect(getRuntimeAIConfig().apiKey).toBe(SAVED_KEY);
  });

  it("does not partially update configuration when validation or key encryption fails", () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    const before = readFileSync(path.join(stateDir, "ai-config.json"), "utf8");
    expect(() => saveAIConfig({ ...config, model: "invalid/model" })).toThrow();
    expect(() =>
      saveAIConfig({ ...config, budgets: { ...config.budgets, perRequest: -1 } }),
    ).toThrow();
    vi.stubEnv("APP_SETTINGS_KEY", "");
    expect(() =>
      saveAIConfig({ ...config, model: "different-model", apiKey: "sk-fictional-new-key" }),
    ).toThrow();

    expect(readFileSync(path.join(stateDir, "ai-config.json"), "utf8")).toBe(before);
    expect(getAIConfig()).toEqual(config);
  });

  it("fails closed when the encryption key changes instead of silently using the environment key", () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    vi.stubEnv("APP_SETTINGS_KEY", Buffer.alloc(32, 43).toString("base64"));

    expect(() => getRuntimeAIConfig()).toThrow();
    expect(getAIConfig()).not.toHaveProperty("apiKey");
  });

  it("uses saved model, key, and token prices for an actual planning request", async () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    expect(getAIStatus()).toMatchObject({ configured: true, model: config.model });
    const result = await planQuestion({
      question: "请把成绩按学期整理成一条时间趋势",
      datasetId: "demo",
    });

    expect(result).toMatchObject({ source: "openai", model: config.model });
    expect(openAIStub.options).toMatchObject({ apiKey: SAVED_KEY });
    expect(openAIStub.parse).toHaveBeenCalledWith(
      expect.objectContaining({ model: config.model }),
      { signal: undefined },
    );
    expect(getTotalCost().totalCost).toBeCloseTo(0.0045, 8);
    expect(getCostStats().total).toBe(1);
  });

  it("uses a custom Chat Completions endpoint and validates its JSON plan", async () => {
    saveAIConfig({ ...config, apiFormat: "chat_completions", baseUrl: "https://models.example.test/v1/", apiKey: SAVED_KEY });
    openAIStub.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        canAnalyze: true, metric: "score", dimension: "term", chartType: "line",
        rationale: "按学期比较成绩。", clarificationQuestion: null,
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    const result = await planQuestion({ question: "请按学期比较平均成绩变化", datasetId: "demo" });
    expect(result.source).toBe("external");
    expect(result.plan).toMatchObject({ metric: "score", dimensions: ["term"] });
    expect(openAIStub.options).toMatchObject({ apiKey: SAVED_KEY, baseURL: "https://models.example.test/v1" });
    expect(openAIStub.create).toHaveBeenCalledOnce();
    expect(openAIStub.create.mock.calls[0][0]).not.toHaveProperty("enable_thinking");
    expect(openAIStub.create.mock.calls[0][0]).not.toHaveProperty("response_format");
    expect(openAIStub.parse).not.toHaveBeenCalled();
  });

  it.each([
    { baseUrl: BAILIAN_QWEN_FLASH.baseUrl, model: "qwen3.8-flash" },
    { baseUrl: "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", model: "qwen3.8-flash" },
    { baseUrl: BAILIAN_QWEN_FLASH.baseUrl, model: "qwen3.7-flash" },
    { baseUrl: "https://workspace-123.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", model: "qwen3.7-flash" },
  ])("plans with Bailian JSON mode, non-thinking output and actual usage at $baseUrl using $model", async ({ baseUrl, model }) => {
    saveAIConfig({ ...config, ...BAILIAN_QWEN_FLASH, baseUrl, model, apiKey: SAVED_KEY });
    const controller = new AbortController();
    openAIStub.create.mockResolvedValue({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({
        canAnalyze: true, metric: "score", dimension: "course", chartType: "table",
        rationale: "按课程列出平均成绩。", clarificationQuestion: null,
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const result = await planQuestion({ question: "请把各门课的均分列成表格", datasetId: "demo" }, undefined, { signal: controller.signal });
    expect(result).toMatchObject({ source: "external", model, plan: {
      metric: "score", dimensions: ["course"], chartType: "table",
    } });
    expect(openAIStub.options).toMatchObject({ apiKey: SAVED_KEY, baseURL: baseUrl, maxRetries: 0, timeout: 20_000 });
    expect(openAIStub.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      model, enable_thinking: false,
      response_format: { type: "json_object" }, max_tokens: 500,
      messages: expect.arrayContaining([expect.objectContaining({ role: "system", content: expect.stringContaining("JSON") })]),
    }), { signal: controller.signal });
    expect(openAIStub.parse).not.toHaveBeenCalled();
    expect(getTotalCost().totalCost).toBeCloseTo(0.00045, 8);
    expect(getCostStats().total).toBe(1);
    const history = readState("cost-history.json", () => ({ records: [] as { usageEstimated: boolean }[] }));
    expect(history.records[0].usageEstimated).toBe(false);
  });

  it.each(["分析学生表现", "给我每个学生的家庭收入"])("keeps Bailian clarification outside query execution for %s", async (question) => {
    saveAIConfig({ ...config, ...BAILIAN_QWEN_FLASH, apiKey: SAVED_KEY });
    openAIStub.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({
        canAnalyze: false, metric: "score", dimension: "course", chartType: "bar",
        rationale: "问题不明确或超出当前数据能力。", clarificationQuestion: "是否改为比较各课程的平均成绩？",
      }) } }],
    });
    await expect(planQuestion({ question, datasetId: "demo" })).rejects.toMatchObject({
      name: "AIClarificationError", clarificationQuestion: "是否改为比较各课程的平均成绩？",
    });
    expect(getCostStats().total).toBe(1);
  });

  it.each(["chat_completions", "responses"] as const)("handles clarification with null plan fields via %s", async (apiFormat) => {
    saveAIConfig({ ...config, ...BAILIAN_QWEN_FLASH, model: "qwen3.7-flash", apiFormat, apiKey: SAVED_KEY });
    const fields = {
      canAnalyze: false, metric: null, dimension: null, chartType: null,
      rationale: "当前只支持课程和学期分组，不支持学生名单。",
      clarificationQuestion: "是否改为查看各课程的平均成绩？",
    };
    openAIStub.create.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(fields) } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    openAIStub.parse.mockResolvedValue({ output_parsed: fields, usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } });
    await expect(planQuestion({ question: "哪些同学成绩很不好", datasetId: "demo" })).rejects.toMatchObject({
      name: "AIClarificationError", clarificationQuestion: fields.clarificationQuestion,
    });
    expect(getCostStats().total).toBe(1);
    const history = readState("cost-history.json", () => ({ records: [] as { usageEstimated: boolean }[] }));
    expect(history.records[0].usageEstimated).toBe(false);
  });

  it("accepts omitted plan fields only for a valid clarification", async () => {
    saveAIConfig({ ...config, ...BAILIAN_QWEN_FLASH, apiKey: SAVED_KEY });
    const fields = { canAnalyze: false, rationale: "不支持学生个体名单。", clarificationQuestion: "是否按课程查看平均成绩？" };
    openAIStub.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(fields) } }] });
    await expect(planQuestion({ question: "哪些同学成绩很不好", datasetId: "demo" })).rejects.toMatchObject({ name: "AIClarificationError" });
    openAIStub.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ ...fields, clarificationQuestion: "" }) } }] });
    await expect(planQuestion({ question: "哪些同学成绩很不好", datasetId: "demo" })).rejects.toMatchObject({ name: "ZodError" });
  });

  it.each(["metric", "dimension", "chartType"])("rejects a successful plan with null %s", async (field) => {
    saveAIConfig({ ...config, ...BAILIAN_QWEN_FLASH, apiKey: SAVED_KEY });
    const fields = { canAnalyze: true, metric: "score", dimension: "course", chartType: "bar", rationale: "按课程比较成绩。", clarificationQuestion: null, [field]: null };
    openAIStub.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(fields) } }] });
    await expect(planQuestion({ question: "请比较各门课的均分", datasetId: "demo" })).rejects.toMatchObject({ name: "ZodError" });
  });

  it.each([
    { content: '{"canAnalyze":true,"metric":"household_income"}', finish_reason: "stop" },
    { content: '```json\n{"canAnalyze":true}\n```', finish_reason: "stop" },
    { content: null, finish_reason: "stop" },
    { content: JSON.stringify({ canAnalyze: true, metric: "score", dimension: "course", chartType: "table", rationale: "按课程列出平均成绩。", clarificationQuestion: null }), finish_reason: "length" },
  ])("rejects unusable Bailian output and retains billed usage: $finish_reason $content", async ({ content, finish_reason }) => {
    saveAIConfig({ ...config, ...BAILIAN_QWEN_FLASH, apiKey: SAVED_KEY });
    openAIStub.create.mockResolvedValue({
      choices: [{ finish_reason, message: { content } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });
    await expect(planQuestion({ question: "请把各门课的均分列成表格", datasetId: "demo" })).rejects.toThrow();
    expect(getCostStats().total).toBe(1);
    expect(getTotalCost().totalCost).toBeCloseTo(0.00045, 8);
  });

  it("reserves the Bailian request before calling and estimates usage on provider failure", async () => {
    saveAIConfig({ ...config, ...BAILIAN_QWEN_FLASH, apiKey: SAVED_KEY });
    openAIStub.create.mockImplementationOnce(async (payload) => {
      const expectedCost = ((Buffer.byteLength(JSON.stringify(payload), "utf8") + 512) * 2 + 500 * 5) / 1_000_000;
      const history = readState("cost-history.json", () => ({ reservations: [] as { amount: number }[] }));
      expect(history.reservations).toHaveLength(1);
      expect(history.reservations[0].amount).toBeCloseTo(expectedCost, 8);
      throw new APIConnectionTimeoutError();
    });
    await expect(planQuestion({ question: "请把各门课的均分列成表格", datasetId: "demo" })).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(getCostStats().total).toBe(1);
    expect(getTotalCost().totalCost).toBeGreaterThan(0);

    saveAIConfig({ ...config, ...BAILIAN_QWEN_FLASH, budgets: { ...config.budgets, perRequest: 0 } });
    await expect(planQuestion({ question: "请把各门课的均分列成表格", datasetId: "demo" })).rejects.toBeInstanceOf(BudgetExceededError);
    expect(openAIStub.create).toHaveBeenCalledOnce();
  });

  it("rejects unsafe endpoint URLs and invalid custom plans", async () => {
    expect(() => saveAIConfig({ ...config, baseUrl: "http://models.example.test/v1" })).toThrow();
    expect(() => saveAIConfig({ ...config, baseUrl: "https://user:pass@models.example.test/v1" })).toThrow();
    saveAIConfig({ ...config, apiFormat: "chat_completions", baseUrl: "https://models.example.test/v1", apiKey: SAVED_KEY });
    openAIStub.create.mockResolvedValue({ choices: [{ message: { content: '{"canAnalyze":true,"metric":"made_up"}' } }] });
    await expect(planQuestion({ question: "请按学期比较平均成绩变化", datasetId: "demo" })).rejects.toThrow();
  });

  it("passes cancellation to the provider and settles the conservative usage estimate", async () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    const controller = new AbortController();
    openAIStub.parse.mockImplementationOnce(async (_payload, options) => {
      expect(options.signal).toBe(controller.signal);
      controller.abort();
      throw new APIUserAbortError();
    });
    await expect(planQuestion(
      { question: "请把成绩按学期整理成一条时间趋势", datasetId: "demo" },
      undefined,
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: "CANCELLED" });
    expect(getCostStats().total).toBe(1);
    expect(getTotalCost().totalCost).toBeGreaterThan(0);
  });

  it("classifies provider timeouts and preserves estimated charges for the attempted call", async () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    openAIStub.parse.mockRejectedValueOnce(new APIConnectionTimeoutError());
    await expect(planQuestion(
      { question: "请把成绩按学期整理成一条时间趋势", datasetId: "demo" },
    )).rejects.toMatchObject({ code: "TIMEOUT" });
    expect(getCostStats().total).toBe(1);
    expect(getTotalCost().totalCost).toBeGreaterThan(0);
  });

  it("avoids provider calls and reservations for a request cancelled before planning", async () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    const controller = new AbortController();
    controller.abort();
    await expect(planQuestion(
      { question: "请把成绩按学期整理成一条时间趋势", datasetId: "demo" },
      undefined,
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: "CANCELLED" });
    expect(openAIStub.parse).not.toHaveBeenCalled();
    expect(getCostStats().total).toBe(0);
  });

  it("stops model calls immediately when saved settings disable AI or lower its budget", async () => {
    saveAIConfig({ ...config, enabled: false, apiKey: SAVED_KEY });
    expect(getAIStatus()).toMatchObject({ configured: true, enabled: false });
    await expect(
      planQuestion({ question: "请把成绩按学期整理成一条时间趋势", datasetId: "demo" }),
    ).rejects.toMatchObject({ name: "AIConfigurationError" });
    expect(openAIStub.parse).not.toHaveBeenCalled();

    saveAIConfig({ ...config, budgets: { ...config.budgets, perRequest: 0 }, apiKey: "" });
    await expect(
      planQuestion({ question: "请把成绩按学期整理成一条时间趋势", datasetId: "demo" }),
    ).rejects.toMatchObject({ name: "BudgetExceededError" });
    expect(openAIStub.parse).not.toHaveBeenCalled();
  });

  it("reserves concurrent requests atomically and releases unused reservations", async () => {
    saveAIConfig({
      ...config,
      budgets: { perRequest: 0.02, perHour: 0.04, perDay: 0.04, perMonth: 0.04 },
      apiKey: SAVED_KEY,
    });
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => Promise.resolve().then(() => reserveBudget(0.02))),
    );
    const accepted = attempts.flatMap((attempt) =>
      attempt.status === "fulfilled" ? [attempt.value] : [],
    );

    expect(accepted).toHaveLength(2);
    for (const attempt of attempts)
      if (attempt.status === "rejected") expect(attempt.reason).toBeInstanceOf(BudgetExceededError);
    expect(() => checkBudget(0.02)).toThrow(BudgetExceededError);
    releaseBudget(accepted[0]);
    expect(() => reserveBudget(0.02)).not.toThrow();
  });

  it("reloads configuration, usage totals, and outstanding reservations after module restart", async () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    const reservation = reserveBudget(0.01);
    settleBudget(reservation, config.model, usage, "test-planner", config.pricing);
    const outstanding = reserveBudget(0.01);
    const before = getCostStats();

    // Vitest isolates test-file modules; this reload does not affect other suites.
    vi.resetModules();
    const restartedConfig = await import("./ai");
    const restartedCost = await import("../security/ai-cost");
    expect(restartedConfig.getAIConfig()).toEqual(config);
    expect(restartedConfig.getRuntimeAIConfig().apiKey).toBe(SAVED_KEY);
    expect(restartedCost.getCostStats()).toEqual(before);
    expect(restartedCost.getTotalCost().totalCost).toBeCloseTo(0.0045, 8);
    expect(
      readState("cost-history.json", () => ({ reservations: [] as { id: string }[] })).reservations,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ id: outstanding })]));
    restartedCost.releaseBudget(outstanding);

    // Changing a current model price must not re-price historical usage.
    restartedConfig.saveAIConfig({
      ...config,
      pricing: { inputPerMillion: 50, outputPerMillion: 100 },
    });
    expect(restartedCost.getTotalCost().totalCost).toBeCloseTo(0.0045, 8);
  });

  it("retains cost records from parallel writers", async () => {
    saveAIConfig({ ...config, apiKey: SAVED_KEY });
    await Promise.all(
      Array.from({ length: 12 }, () =>
        Promise.resolve().then(() =>
          recordCost(config.model, usage, "test-parallel", config.pricing),
        ),
      ),
    );

    expect(getCostStats().total).toBe(12);
    expect(getTotalCost().totalCost).toBeCloseTo(12 * 0.0045, 8);
  });

  it("supports custom model names that coincide with object prototype properties", () => {
    saveAIConfig({ ...config, model: "constructor", apiKey: SAVED_KEY });
    recordCost("constructor", usage, "test-custom-model", config.pricing);

    const modelStats = getCostStats().byModel["constructor"];
    expect(modelStats.calls).toBe(1);
    expect(modelStats.totalCost).toBeCloseTo(0.0045, 8);
  });

  it("recovers a previous process instance's lock even when its PID is alive again", () => {
    const lock = path.join(stateDir, "reused-pid.json.lock");
    mkdirSync(lock);
    writeFileSync(
      path.join(lock, "owner-00000000-0000-0000-0000-000000000000.json"),
      JSON.stringify({
        version: 2,
        pid: process.pid,
        identity: "previous-container-process-start",
      }),
    );
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);

    updateState(
      "reused-pid.json",
      () => ({ count: 0 }),
      (state) => {
        state.count += 1;
      },
    );

    expect(readState("reused-pid.json", () => ({ count: 0 })).count).toBe(1);
    expect(existsSync(lock)).toBe(false);
  });

  it("upgrades abandoned legacy PID-only file locks without resetting state", () => {
    const lock = path.join(stateDir, "legacy.json.lock");
    writeFileSync(path.join(stateDir, "legacy.json"), JSON.stringify({ count: 7 }));
    writeFileSync(lock, JSON.stringify({ pid: process.pid }));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);

    updateState(
      "legacy.json",
      () => ({ count: 0 }),
      (state) => {
        state.count += 1;
      },
    );

    expect(readState("legacy.json", () => ({ count: 0 })).count).toBe(8);
    expect(existsSync(lock)).toBe(false);
  });

  it("never reclaims a lock held by the current process instance", () => {
    let owner: unknown;
    updateState(
      "capture.json",
      () => ({}),
      () => {
        const lock = path.join(stateDir, "capture.json.lock");
        owner = JSON.parse(readFileSync(path.join(lock, readdirSync(lock)[0]), "utf8"));
      },
    );
    const lock = path.join(stateDir, "active.json.lock");
    mkdirSync(lock);
    const ownerFile = path.join(lock, "owner-00000000-0000-0000-0000-000000000000.json");
    writeFileSync(ownerFile, JSON.stringify(owner));
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    let now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => (now += 6_000));

    expect(() =>
      updateState(
        "active.json",
        () => ({ count: 0 }),
        (state) => {
          state.count += 1;
        },
      ),
    ).toThrow("系统设置正在更新");
    expect(JSON.parse(readFileSync(ownerFile, "utf8"))).toEqual(owner);
    expect(existsSync(path.join(stateDir, "active.json"))).toBe(false);
  });

  it("recovers old instance locks in the administrator CLI using the same owner format", async () => {
    const lock = path.join(stateDir, "accounts.json.lock");
    mkdirSync(lock);
    writeFileSync(
      path.join(lock, "owner-00000000-0000-0000-0000-000000000000.json"),
      JSON.stringify({
        version: 2,
        pid: process.pid,
        identity: "previous-container-process-start",
      }),
    );
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const script = fileURLToPath(new URL("../../scripts/admin-init.mjs", import.meta.url));
    await execute(process.execPath, [script], {
      timeout: 10_000,
      env: {
        ...process.env,
        ANALYTICS_INIT_ENV_LOADED: "1",
        ADMIN_USERNAME: "recovery-admin",
        ADMIN_PASSWORD: "Fictional-Recovery-2026!",
      },
    });

    const accounts = readState("accounts.json", () => ({
      users: [] as { username: string; role: string }[],
    }));
    expect(accounts.users).toHaveLength(1);
    expect(accounts.users[0]).toMatchObject({ username: "recovery-admin", role: "admin" });
    expect(existsSync(lock)).toBe(false);
  });

  it("creates only one administrator when independent CLI processes initialize together", async () => {
    const script = fileURLToPath(new URL("../../scripts/admin-init.mjs", import.meta.url));
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, (_, index) =>
        execute(process.execPath, [script], {
          timeout: 10_000,
          env: {
            ...process.env,
            ANALYTICS_INIT_ENV_LOADED: "1",
            ADMIN_USERNAME: `concurrent-admin-${index}`,
            ADMIN_PASSWORD: "Fictional-Recovery-2026!",
          },
        }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const accounts = readState("accounts.json", () => ({ users: [] as { role: string }[] }));
    expect(accounts.users).toHaveLength(1);
    expect(accounts.users[0].role).toBe("admin");
    expect(existsSync(path.join(stateDir, "accounts.json.lock"))).toBe(false);
  });

  it("publishes a complete owner atomically so a racing rmdir cannot remove a new lock", async () => {
    const source = readFileSync(fileURLToPath(new URL("./storage.ts", import.meta.url)), "utf8");
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    }).outputText;
    const modulePath = path.join(stateDir, "publication-storage.cjs");
    writeFileSync(modulePath, compiled, { mode: 0o600 });
    const childCode = `
      const fs = require("node:fs");
      const assert = require("node:assert/strict");
      const path = require("node:path");
      const rename = fs.renameSync;
      let publications = 0;
      fs.renameSync = (prepared, target) => {
        if (!target.endsWith(".lock")) return rename(prepared, target);
        const names = fs.readdirSync(prepared);
        assert.equal(names.length, 1);
        const owner = JSON.parse(fs.readFileSync(path.join(prepared, names[0]), "utf8"));
        assert.equal(owner.version, 2);
        assert.ok(owner.identity);
        rename(prepared, target);
        // Simulate the stale reclaimer's final action immediately after publish.
        assert.throws(() => fs.rmdirSync(target), error => error.code === "ENOTEMPTY" || error.code === "EEXIST");
        assert.equal(fs.readdirSync(target)[0], names[0]);
        publications += 1;
      };
      const { updateState } = require(${JSON.stringify(modulePath)});
      updateState("published.json", () => ({ count: 0 }), state => { state.count += 1; });
      assert.equal(publications, 1);
    `;
    await execute(process.execPath, ["-e", childCode], { timeout: 10_000 });

    expect(readState("published.json", () => ({ count: 0 })).count).toBe(1);
    expect(readdirSync(stateDir).some((name) => name.includes(".lock"))).toBe(false);
  });

  it.each(
    (["storage", "administrator CLI"] as const).flatMap((implementation) =>
      (["new owner", "directory removed", "marker already removed", "unlink denied", "rmdir denied"] as const).map(
        (scenario) => ({ implementation, scenario }),
      ),
    ),
  )("releases $implementation locks safely when $scenario", async ({ implementation, scenario }) => {
    const source = readFileSync(fileURLToPath(new URL("./storage.ts", import.meta.url)), "utf8");
    const modulePath = path.join(stateDir, "release-storage.cjs");
    writeFileSync(modulePath, transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    }).outputText, { mode: 0o600 });
    const script = new URL("../../scripts/admin-init.mjs", import.meta.url).href;
    const stateName = implementation === "storage" ? "release.json" : "accounts.json";
    const lockPath = path.join(stateDir, `${stateName}.lock`);
    const replacementOwner = path.join(lockPath, "owner-11111111-1111-1111-1111-111111111111.json");
    const childCode = `
      const fs = require("node:fs");
      const assert = require("node:assert/strict");
      const path = require("node:path");
      const lockPath = ${JSON.stringify(lockPath)};
      const scenario = ${JSON.stringify(scenario)};
      const unlink = fs.unlinkSync;
      const rmdir = fs.rmdirSync;
      let releases = 0;
      const denied = () => Object.assign(new Error("release-test-denied"), { code: "EACCES" });
      fs.unlinkSync = target => {
        if (path.dirname(target) !== lockPath || !path.basename(target).startsWith("owner-")) return unlink(target);
        releases += 1;
        if (scenario === "unlink denied") throw denied();
        unlink(target);
        if (scenario === "new owner") {
          // Publish the next writer after the old marker disappears, before its
          // rmdir. This forces the interleaving that sporadically broke writes.
          const prepared = lockPath + ".replacement";
          fs.mkdirSync(prepared);
          fs.writeFileSync(path.join(prepared, path.basename(${JSON.stringify(replacementOwner)})), "new-owner");
          fs.renameSync(prepared, lockPath);
        } else if (scenario === "directory removed" || scenario === "marker already removed") {
          rmdir(lockPath);
          if (scenario === "marker already removed") throw Object.assign(new Error("already removed"), { code: "ENOENT" });
        }
      };
      fs.rmdirSync = target => {
        if (target === lockPath && scenario === "rmdir denied") throw denied();
        return rmdir(target);
      };
      // The CLI uses named ESM imports; make it observe the same controlled fs
      // interleaving as the transpiled CommonJS storage module.
      require("node:module").syncBuiltinESMExports();
      process.once("beforeExit", () => assert.equal(releases, 1));
      ${implementation === "storage"
        ? `const { updateState } = require(${JSON.stringify(modulePath)}); updateState("release.json", () => ({ count: 0 }), state => { state.count += 1; });`
        : `import(${JSON.stringify(script)});`}
    `;
    const execution = execute(process.execPath, ["-e", childCode], {
      timeout: 10_000,
      env: {
        ...process.env,
        ANALYTICS_INIT_ENV_LOADED: "1",
        ADMIN_USERNAME: "release-admin",
        ADMIN_PASSWORD: "Fictional-Release-2026!",
      },
    });
    if (scenario === "unlink denied" || scenario === "rmdir denied") {
      await expect(execution).rejects.toMatchObject({ stderr: expect.stringContaining("release-test-denied") });
    } else {
      await execution;
    }

    if (implementation === "storage") {
      expect(readState(stateName, () => ({ count: 0 })).count).toBe(1);
    } else {
      expect(readState(stateName, () => ({ users: [] })).users).toHaveLength(1);
    }
    if (scenario === "new owner") {
      expect(readdirSync(lockPath)).toEqual([path.basename(replacementOwner)]);
      expect(readFileSync(replacementOwner, "utf8")).toBe("new-owner");
    } else if (scenario === "directory removed" || scenario === "marker already removed") {
      expect(existsSync(lockPath)).toBe(false);
    } else {
      expect(readdirSync(lockPath)).toHaveLength(scenario === "unlink denied" ? 1 : 0);
    }
  });

  it("coordinates state updates from separate Node processes without lost writes", async () => {
    // Compile only the standalone storage primitive for the Node version in use.
    // The child process uses an isolated state directory and has no network work.
    const source = readFileSync(fileURLToPath(new URL("./storage.ts", import.meta.url)), "utf8");
    const compiled = transpileModule(source, {
      compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 },
    }).outputText;
    const modulePath = path.join(stateDir, "test-storage.cjs");
    writeFileSync(modulePath, compiled, { mode: 0o600 });
    // All writers start by reclaiming the same old process instance. Unique
    // markers must protect a freshly acquired owner from another reclaimer.
    const lock = path.join(stateDir, "concurrent.json.lock");
    mkdirSync(lock);
    writeFileSync(
      path.join(lock, "owner-00000000-0000-0000-0000-000000000000.json"),
      JSON.stringify({ version: 2, pid: process.pid, identity: "previous-process-instance" }),
    );
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const childCode = `const { updateState } = require(${JSON.stringify(modulePath)}); for (let i = 0; i < 25; i++) updateState("concurrent.json", () => ({ count: 0 }), state => { state.count += 1; });`;
    await Promise.all(
      Array.from({ length: 3 }, () =>
        execute(process.execPath, ["-e", childCode], { timeout: 10_000 }),
      ),
    );

    expect(readState("concurrent.json", () => ({ count: 0 })).count).toBe(75);
  });
});
