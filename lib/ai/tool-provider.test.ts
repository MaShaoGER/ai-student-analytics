import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateToolTurn, probeToolCalling, type ToolMessage } from "./tool-provider";
import { saveAIConfig } from "../settings/ai";
import { readState } from "../settings/storage";
import {
  analysisConfigFingerprint,
  getAnalysisCapability,
  saveAnalysisCapability,
} from "../settings/analysis";
import { BudgetExceededError } from "../security/ai-cost";

const stub = vi.hoisted(() => ({
  chat: vi.fn(),
  responses: vi.fn(),
  options: {} as Record<string, unknown>,
}));
vi.mock("openai", () => ({
  default: class {
    chat = { completions: { create: stub.chat } };
    responses = { create: stub.responses };
    constructor(options: Record<string, unknown>) {
      stub.options = options;
    }
  },
}));
const tool = {
  name: "aggregate",
  description: "Query aggregate",
  parameters: { type: "object", properties: {} },
};
const baseConfig = {
  enabled: true,
  apiFormat: "chat_completions",
  baseUrl: "https://provider.example/v1",
  model: "fixture",
  apiKey: "fixture-secret",
  pricing: { inputPerMillion: 1, outputPerMillion: 2 },
  budgets: { perRequest: 0.1, perHour: 5, perDay: 20, perMonth: 200 },
};
const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
describe("standard tool protocol and request accounting", () => {
  let directory: string;
  beforeEach(() => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), "tool-provider-"));
    vi.stubEnv("APP_STATE_DIR", directory);
    vi.stubEnv("APP_SETTINGS_KEY", Buffer.alloc(32, 2).toString("base64"));
    vi.stubEnv("OPENAI_API_KEY", "");
    saveAIConfig(baseConfig);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });
  it("sends real tool schemas and returns every call with its original ID", async () => {
    stub.chat.mockResolvedValue({
      usage,
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            content: null,
            tool_calls: [
              { id: "one", type: "function", function: { name: "aggregate", arguments: "{}" } },
              { id: "two", type: "function", function: { name: "aggregate", arguments: "{}" } },
            ],
          },
        },
      ],
    });
    const result = await generateToolTurn([{ role: "user", content: "compare" }], [tool]);
    expect(result.message.calls?.map((call) => call.id)).toEqual(["one", "two"]);
    expect(stub.chat.mock.calls[0][0].tools).toEqual([{ type: "function", function: tool }]);
    expect(stub.chat.mock.calls[0][0]).not.toHaveProperty("response_format");
    expect(stub.options).toMatchObject({ baseURL: baseConfig.baseUrl, maxRetries: 0 });
  });
  it("passes tool_call_id back and shares cost across actual provider requests", async () => {
    stub.chat.mockResolvedValue({
      usage,
      choices: [{ finish_reason: "stop", message: { content: "done" } }],
    });
    const budgetContext = { spent: 0 };
    await generateToolTurn([{ role: "tool", callId: "one", content: '{"value":80}' }], [tool], {
      budgetContext,
    });
    expect(stub.chat.mock.calls[0][0].messages[0]).toEqual({
      role: "tool",
      tool_call_id: "one",
      content: '{"value":80}',
    });
    expect(budgetContext.spent).toBeCloseTo(0.00014);
    expect(
      readState<{ records: unknown[] }>("cost-history.json", () => ({ records: [] })).records,
    ).toHaveLength(1);
    budgetContext.spent = 0.1;
    await expect(generateToolTurn([], [tool], { budgetContext })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(stub.chat).toHaveBeenCalledTimes(1);
  });
  it("preserves Responses output items and correlates results with call_id", async () => {
    saveAIConfig({ ...baseConfig, apiFormat: "responses" });
    const output = [
      {
        type: "function_call",
        id: "item-1",
        call_id: "call-1",
        name: "aggregate",
        arguments: "{}",
        status: "completed",
      },
    ];
    stub.responses.mockResolvedValue({
      status: "completed",
      output,
      output_text: "",
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
    });
    const first = await generateToolTurn([{ role: "user", content: "compare" }], [tool]);
    expect(first.message.calls?.[0].id).toBe("call-1");
    await generateToolTurn(
      [first.message, { role: "tool", callId: "call-1", content: "result" }],
      [tool],
    );
    expect(stub.responses.mock.calls[1][0].input).toEqual([
      ...output,
      { type: "function_call_output", call_id: "call-1", output: "result" },
    ]);
    expect(stub.responses.mock.calls[0][0].store).toBe(false);
  });
  it("rejects truncated output but still settles measured usage", async () => {
    stub.chat.mockResolvedValue({
      usage,
      choices: [{ finish_reason: "length", message: { content: "{" } }],
    });
    await expect(generateToolTurn([], [tool])).rejects.toMatchObject({ code: "AI_INVALID_OUTPUT" });
    const history = readState<{ records: { usageEstimated: boolean }[] }>(
      "cost-history.json",
      () => ({ records: [] }),
    );
    expect(history.records).toHaveLength(1);
    expect(history.records[0].usageEstimated).toBe(false);
  });
  it("settles conservative cost after a network failure and never leaks provider text", async () => {
    stub.chat.mockRejectedValue(new Error("private upstream failure"));
    await expect(generateToolTurn([], [tool])).rejects.toThrow();
    const history = readState<{ records: { usageEstimated: boolean }[] }>(
      "cost-history.json",
      () => ({ records: [] }),
    );
    expect(history.records[0].usageEstimated).toBe(true);
  });
  it("requires a real tool return roundtrip in the compatibility probe", async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({
        model: "fixture",
        message: {
          role: "assistant",
          content: "",
          calls: [{ id: "verify", name: "verify_tool", arguments: "{}" }],
        },
      });
    generate.mockImplementationOnce(async (messages: ToolMessage[]) => ({
      model: "fixture",
      message: { role: "assistant", content: messages.at(-1)!.content, calls: [] },
    }));
    await expect(probeToolCalling(undefined, generate)).resolves.toEqual({ model: "fixture" });
    const textOnly = vi
      .fn()
      .mockResolvedValue({
        model: "fixture",
        message: { role: "assistant", content: "I support tools", calls: [] },
      });
    await expect(probeToolCalling(undefined, textOnly)).rejects.toMatchObject({
      code: "AI_INVALID_OUTPUT",
    });
  });
  it("invalidates compatibility evidence when the model or credential changes", () => {
    const fingerprint = analysisConfigFingerprint();
    saveAnalysisCapability(fingerprint, true);
    expect(getAnalysisCapability().status).toBe("supported");
    saveAIConfig({ ...baseConfig, model: "changed" });
    expect(getAnalysisCapability().status).toBe("unknown");
    saveAIConfig(baseConfig);
    expect(getAnalysisCapability().status).toBe("supported");
    saveAIConfig({ ...baseConfig, apiKey: "different-key" });
    expect(getAnalysisCapability().status).toBe("unknown");
  });
});
