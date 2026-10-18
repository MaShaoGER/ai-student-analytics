import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APIConnectionTimeoutError, APIError } from "openai/core/error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  estimatePromptTokens,
  generateStructured,
  planQuestion,
  planQuestionInputSchema,
  repairModelJSON,
} from "./planner";
import { AIProviderError, classifyAIProviderError } from "./provider-errors";
import { saveAIConfig } from "../settings/ai";
import { readState } from "../settings/storage";

const openAIStub = vi.hoisted(() => ({
  parse: vi.fn(),
  create: vi.fn(),
  options: null as unknown,
}));

// Same shape as production requests, but no network: the planner path resolves
// against this stub so truncation/JSON-repair/accounting can be exercised.
vi.mock("openai", () => ({
  default: class {
    responses = { parse: openAIStub.parse };
    chat = { completions: { create: openAIStub.create } };
    constructor(options: unknown) {
      openAIStub.options = options;
    }
  },
}));

describe("AI analysis planner", () => {
  let stateDirectory: string;
  beforeEach(() => {
    stateDirectory = mkdtempSync(join(tmpdir(), "analytics-planner-test-"));
    vi.stubEnv("APP_STATE_DIR", stateDirectory);
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(stateDirectory, { recursive: true, force: true });
  });

  it("uses a verified plan for an exact golden question without calling a model", async () => {
    let called = false;
    const result = await planQuestion(
      { question: "哪门课程平均成绩最高？", datasetId: "oulad" },
      async () => {
        called = true;
        throw new Error("should not be called");
      },
    );

    expect(called).toBe(false);
    expect(result.source).toBe("golden_case");
    expect(result.matchedCaseId).toBe("score-course-top");
    expect(result.plan).toMatchObject({
      datasetId: "oulad",
      metric: "score",
      dimensions: ["course"],
    });
  });

  it("turns structured model fields into the same validated AnalysisPlan", async () => {
    const result = await planQuestion(
      { question: "按学期看看学生是否完成课程", datasetId: "demo" },
      async () => ({
        canAnalyze: true,
        metric: "completion_rate",
        dimension: "term",
        chartType: "line",
        rationale: "问题要求按学期查看课程完成情况。",
        clarificationQuestion: null,
      }),
    );

    expect(result.source).toBe("openai");
    expect(result.plan).toMatchObject({
      datasetId: "demo",
      metric: "completion_rate",
      aggregation: "rate",
      dimensions: ["term"],
      chartType: "line",
    });
  });

  it("stops before querying when the model requests clarification", async () => {
    await expect(
      planQuestion({ question: "哪些学生有风险？", datasetId: "demo" }, async () => ({
        canAnalyze: false,
        metric: "completion_rate",
        dimension: "course",
        chartType: "bar",
        rationale: "当前 MVP 不提供个体风险名单。",
        clarificationQuestion: "是否改为比较各课程的群体完成率？",
      })),
    ).rejects.toMatchObject({
      name: "AIClarificationError",
      clarificationQuestion: "是否改为比较各课程的群体完成率？",
    });
  });

  it("rejects empty and oversized questions before any model call", () => {
    expect(() => planQuestionInputSchema.parse({ question: " ", datasetId: "demo" })).toThrow();
    expect(() =>
      planQuestionInputSchema.parse({ question: "问".repeat(501), datasetId: "demo" }),
    ).toThrow();
  });

  it("does not plan or call a model for an already cancelled request", async () => {
    const controller = new AbortController();
    controller.abort();
    const generator = vi.fn();
    await expect(planQuestion(
      { question: "哪门课程平均成绩最高？", datasetId: "demo" },
      generator,
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: "CANCELLED" });
    expect(generator).not.toHaveBeenCalled();
  });

  it("passes cancellation to the generator and rejects a late result after cancellation", async () => {
    const controller = new AbortController();
    const generator = vi.fn(async (_question: string, options?: { signal?: AbortSignal }) => {
      expect(options?.signal).toBe(controller.signal);
      controller.abort();
      return {
        canAnalyze: true,
        metric: "score" as const,
        dimension: "term" as const,
        chartType: "line" as const,
        rationale: "按学期比较成绩。",
        clarificationQuestion: null,
      };
    });
    await expect(planQuestion(
      { question: "请按学期比较成绩的变化", datasetId: "demo" },
      generator,
      { signal: controller.signal },
    )).rejects.toMatchObject({ code: "CANCELLED" });
  });

  describe("prompt token estimation", () => {
    it("estimates long Chinese text far below its UTF-8 byte length", () => {
      const text = "中".repeat(3_000);
      const estimate = estimatePromptTokens(text);
      expect(estimate).toBeGreaterThan(0);
      expect(estimate).toBeLessThan(Buffer.byteLength(text, "utf8"));
      expect(estimate).toBeLessThan(Buffer.byteLength(text, "utf8") / 2);
    });

    it("keeps a floor for tiny payloads and stays bounded for ASCII", () => {
      expect(estimatePromptTokens("")).toBe(128);
      expect(estimatePromptTokens("hi")).toBe(128);
      const ascii = "a".repeat(4_000);
      const estimate = estimatePromptTokens(ascii);
      expect(estimate).toBeGreaterThan(1_000);
      expect(estimate).toBeLessThan(1_100);
      expect(estimate).toBeLessThanOrEqual(Math.ceil(ascii.length * 1.08));
    });

    it("keeps the worst-case 12x3000-character history under the default per-request budget", () => {
      const history = Array.from({ length: 12 }, () => ({
        role: "user",
        content: "问".repeat(3_000),
      }));
      const payload = JSON.stringify({ input: "比较各课程平均成绩", history });
      // $1/M pricing with the default $0.1 per-request budget allows 100k tokens.
      expect(estimatePromptTokens(payload)).toBeLessThan(100_000);
      // The retired byte heuristic would have exceeded that budget.
      expect(Buffer.byteLength(payload, "utf8") + 512).toBeGreaterThan(100_000);
    });
  });

  describe("model JSON repair", () => {
    it("removes Markdown fences", () => {
      expect(repairModelJSON('```json\n{"answer":"ok"}\n```')).toBe('{"answer":"ok"}');
      expect(repairModelJSON('```\n{"answer":"ok"}\n```')).toBe('{"answer":"ok"}');
    });

    it("takes the outermost object when the model adds prose", () => {
      expect(repairModelJSON('结果如下：{"answer":{"nested":true}}，请核对。')).toBe(
        '{"answer":{"nested":true}}',
      );
    });

    it("leaves non-JSON text alone so parsing still fails safely", () => {
      expect(repairModelJSON("无法完成这个请求。")).toBe("无法完成这个请求。");
    });
  });

  describe("provider error classification", () => {
    const apiError = (status: number | undefined, code?: string) =>
      new APIError(
        status,
        code === undefined ? undefined : { code },
        "fictional private upstream detail",
        new Headers(),
      );

    it.each([
      [400, "AI_PROVIDER_BAD_REQUEST", 502, false],
      [404, "AI_PROVIDER_BAD_REQUEST", 502, false],
      [422, "AI_PROVIDER_BAD_REQUEST", 502, false],
      [401, "AI_PROVIDER_AUTH", 502, false],
      [403, "AI_PROVIDER_AUTH", 502, false],
      [500, "AI_PROVIDER_UNAVAILABLE", 503, true],
      [502, "AI_PROVIDER_UNAVAILABLE", 503, true],
      [503, "AI_PROVIDER_UNAVAILABLE", 503, true],
    ] as const)("maps HTTP %s to %s with status %s", (status, code, expectedStatus, retryable) => {
      const classified = classifyAIProviderError(apiError(status));
      expect(classified).toMatchObject({ name: "AIProviderError", code, status: expectedStatus, retryable });
      expect(classified?.message).not.toContain("fictional private upstream detail");
    });

    it.each([
      ["1305", "AI_PROVIDER_OVERLOADED"],
      ["rate_limit_exceeded", "AI_PROVIDER_RATE_LIMITED"],
      [undefined, "AI_PROVIDER_RATE_LIMITED"],
    ] as const)("keeps the 429 code mapping for %s", (providerCode, code) => {
      const classified = classifyAIProviderError(apiError(429, providerCode));
      expect(classified).toMatchObject({ code, status: 429, retryable: true });
    });

    it("ignores errors that are not provider HTTP failures", () => {
      expect(classifyAIProviderError(new Error("plain failure"))).toBeNull();
      expect(classifyAIProviderError(apiError(undefined))).toBeNull();
      expect(classifyAIProviderError(apiError(418))).toBeNull();
      expect(classifyAIProviderError({ status: 400 })).toBeNull();
    });

    it("exposes a fixed non-retryable invalid-output error", () => {
      const error = new AIProviderError("AI_INVALID_OUTPUT");
      expect(error).toMatchObject({ name: "AIProviderError", code: "AI_INVALID_OUTPUT", status: 502, retryable: false });
      expect(error.message).toContain("不完整或无法解析");
    });
  });

  describe("dual-protocol reliability", () => {
    const settingsKey = Buffer.alloc(32, 46).toString("base64");
    const saveProvider = (apiFormat: "responses" | "chat_completions") => {
      vi.stubEnv("APP_SETTINGS_KEY", settingsKey);
      saveAIConfig({
        enabled: true,
        apiFormat,
        baseUrl: "",
        model: "fictional-planner-model",
        keyConfigured: true,
        apiKey: "sk-fictional-planner-test",
        budgets: { perRequest: 0.1, perHour: 5, perDay: 20, perMonth: 200 },
        pricing: { inputPerMillion: 2, outputPerMillion: 5 },
      });
    };
    const costRecords = () =>
      readState("cost-history.json", () => ({
        records: [] as { usageEstimated: boolean; usage: { promptTokens: number } }[],
      })).records;

    beforeEach(() => {
      openAIStub.parse.mockReset();
      openAIStub.create.mockReset();
    });

    it("rejects a truncated Responses output as AI_INVALID_OUTPUT but keeps measured usage", async () => {
      saveProvider("responses");
      openAIStub.parse.mockResolvedValueOnce({
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output_parsed: { answer: "partial" },
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
      });
      await expect(
        generateStructured("解释一下", "只解释方法。", z.object({ answer: z.string() })),
      ).rejects.toMatchObject({ name: "AIProviderError", code: "AI_INVALID_OUTPUT", status: 502 });
      expect(costRecords()[0]).toMatchObject({ usageEstimated: false, usage: { promptTokens: 100 } });
    });

    it("repairs fenced chat JSON and parses the plan once", async () => {
      saveProvider("chat_completions");
      openAIStub.create.mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: '```json\n{"answer":"ok"}\n```' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      await expect(
        generateStructured("解释一下", "只解释方法。", z.object({ answer: z.string() })),
      ).resolves.toMatchObject({ fields: { answer: "ok" }, usedModel: "fictional-planner-model" });
    });

    it("rejects unparseable chat content as AI_INVALID_OUTPUT", async () => {
      saveProvider("chat_completions");
      openAIStub.create.mockResolvedValueOnce({
        choices: [{ finish_reason: "stop", message: { content: "抱歉，无法完成这个请求。" } }],
      });
      await expect(
        generateStructured("解释一下", "只解释方法。", z.object({ answer: z.string() })),
      ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT", status: 502 });
    });

    it("rejects a length-truncated chat output even when the JSON parses", async () => {
      saveProvider("chat_completions");
      openAIStub.create.mockResolvedValueOnce({
        choices: [{ finish_reason: "length", message: { content: '{"answer":"ok"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
      await expect(
        generateStructured("解释一下", "只解释方法。", z.object({ answer: z.string() })),
      ).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT", status: 502 });
    });

    it("reserves the character estimate and settles an estimate when the provider fails", async () => {
      saveProvider("chat_completions");
      let captured: unknown;
      openAIStub.create.mockImplementationOnce(async (payload: unknown) => {
        captured = payload;
        throw new APIConnectionTimeoutError();
      });
      await expect(
        generateStructured("解释一下", "只解释方法。", z.object({ answer: z.string() })),
      ).rejects.toMatchObject({ code: "TIMEOUT" });
      const records = costRecords();
      expect(records).toHaveLength(1);
      expect(records[0].usageEstimated).toBe(true);
      expect(records[0].usage.promptTokens).toBe(estimatePromptTokens(JSON.stringify(captured)));
    });
  });
});
