import type { AnalysisStep, ChatResponse, ChatStreamEvent } from "./chat-types";

export type ChatFailure = { error: string; code: string; retryable: boolean };
/** POST stream: preflight errors remain HTTP errors; execution failures are terminal SSE events. */
export function createChatStream(
  signal: AbortSignal,
  run: (signal: AbortSignal, onStep: (step: AnalysisStep) => void) => Promise<ChatResponse>,
  failure: (error: unknown) => Promise<ChatFailure>,
): Response {
  const requestId = crypto.randomUUID();
  const abort = new AbortController();
  const cancel = () => abort.abort();
  signal.addEventListener("abort", cancel, { once: true });
  if (signal.aborted) cancel();
  let closed = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: ChatStreamEvent) => {
        if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const response = await run(abort.signal, (step) => send({ type: "step", requestId, step }));
        if (!abort.signal.aborted) send({ type: "result", requestId, response });
      } catch (error) {
        const safe = await failure(error);
        send({ type: "error", requestId, ...safe });
      } finally {
        signal.removeEventListener("abort", cancel);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
      abort.abort();
      signal.removeEventListener("abort", cancel);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/** Incremental UTF-8 decoding handles split frames; EOF without one terminal event is a failure. */
export async function readChatStream(
  response: Response,
  onStep: (step: AnalysisStep) => void,
): Promise<ChatResponse> {
  if (!response.body) throw new Error("未收到分析响应，请重试。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let requestId: string | null = null;
  let result: ChatResponse | undefined;
  let terminal = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length > 2_000_000) throw new Error("分析响应超过限制，请缩小范围。");
      let boundary: number;
      while ((boundary = pending.indexOf("\n\n")) >= 0) {
        const frame = pending.slice(0, boundary);
        pending = pending.slice(boundary + 2);
        if (!frame.startsWith("data: ")) continue;
        const event = JSON.parse(frame.slice(6)) as ChatStreamEvent;
        requestId ??= event.requestId;
        if (event.requestId !== requestId || terminal)
          throw new Error("分析响应顺序异常，请重试。");
        if (event.type === "step") onStep(event.step);
        else if (event.type === "result") {
          result = event.response;
          terminal = true;
        } else if (event.type === "error") {
          terminal = true;
          throw Object.assign(new Error(event.error), {
            code: event.code,
            retryable: event.retryable,
          });
        } else throw new Error("分析响应格式异常，请重试。");
      }
      if (done) break;
    }
    if (!terminal || !result || pending.trim()) throw new Error("分析连接提前结束，请重试。");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
