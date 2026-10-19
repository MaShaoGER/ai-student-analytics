import { describe, expect, it } from "vitest";
import { createChatStream, readChatStream } from "./chat-stream";
import type { ChatResponse } from "./chat-types";
const answer: ChatResponse = {
  kind: "answer",
  answer: "中文完成",
  facts: [],
  suggestions: [],
  context: null,
  artifact: null,
  planning: { source: "local", rationale: "", model: null },
};
describe("analysis stage stream", () => {
  it("delivers actual start/end steps and exactly one final result", async () => {
    const response = createChatStream(
      new AbortController().signal,
      async (_signal, onStep) => {
        onStep({ id: "one", label: "查询", status: "running", durationMs: 0 });
        onStep({ id: "one", label: "查询", status: "completed", durationMs: 3 });
        return answer;
      },
      async () => ({ error: "failed", code: "FAIL", retryable: false }),
    );
    const events: string[] = [];
    expect(await readChatStream(response, (step) => events.push(step.status))).toEqual(answer);
    expect(events).toEqual(["running", "completed"]);
  });
  it("handles arbitrary chunk boundaries including multibyte Chinese", async () => {
    const bytes = new TextEncoder().encode(
      `data: ${JSON.stringify({ type: "result", requestId: "one", response: answer })}\n\n`,
    );
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
          controller.close();
        },
      }),
    );
    expect((await readChatStream(response, () => {})).answer).toBe("中文完成");
  });
  it("preserves sanitized terminal errors and rejects premature EOF", async () => {
    const response = createChatStream(
      new AbortController().signal,
      async () => {
        throw new Error("secret");
      },
      async () => ({ error: "分析超时", code: "TIMEOUT", retryable: true }),
    );
    await expect(readChatStream(response, () => {})).rejects.toMatchObject({
      message: "分析超时",
      code: "TIMEOUT",
      retryable: true,
    });
    await expect(readChatStream(new Response(""), () => {})).rejects.toThrow("提前结束");
  });
  it("rejects a late event belonging to a different request", async () => {
    const event = {
      type: "step",
      step: { id: "one", label: "查询", status: "running", durationMs: 0 },
    };
    const body = ["first", "second"]
      .map((requestId) => `data: ${JSON.stringify({ ...event, requestId })}\n\n`)
      .join("");
    await expect(readChatStream(new Response(body), () => {})).rejects.toThrow("顺序异常");
  });
});
