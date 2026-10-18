import { describe, expect, it } from "vitest";
import { readJsonBody, REQUEST_TOO_LARGE_CODE, RequestBodyTooLargeError } from "./request-body";

const URL = "http://localhost/api/test";

function jsonRequest(body: string, headers: Record<string, string> = {}): Request {
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

function streamRequest(stream: ReadableStream<Uint8Array>): Request {
  return new Request(URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: stream,
    duplex: "half",
  } as RequestInit);
}

describe("bounded JSON body reader", () => {
  it("parses valid JSON exactly like request.json()", async () => {
    await expect(
      readJsonBody(jsonRequest('{"question":"你好"}'), { maxBytes: 1024 }),
    ).resolves.toEqual({
      question: "你好",
    });
  });

  it("accepts a body exactly at the byte limit", async () => {
    const value = "x".repeat(60);
    const body = JSON.stringify(value);
    await expect(readJsonBody(jsonRequest(body), { maxBytes: body.length })).resolves.toBe(value);
    await expect(
      readJsonBody(jsonRequest(body), { maxBytes: body.length - 1 }),
    ).rejects.toMatchObject({
      code: REQUEST_TOO_LARGE_CODE,
    });
  });

  it("rejects an oversized declared content-length before reading the body", async () => {
    const request = jsonRequest('{"ok":true}', { "content-length": "1001" });
    await expect(readJsonBody(request, { maxBytes: 1000 })).rejects.toBeInstanceOf(
      RequestBodyTooLargeError,
    );
  });

  it("cancels an oversized streamed body", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(200)));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readJsonBody(streamRequest(stream), { maxBytes: 100 })).rejects.toMatchObject({
      code: REQUEST_TOO_LARGE_CODE,
    });
    expect(cancelled).toBe(true);
  });

  it("decodes multi-byte characters split across chunks", async () => {
    const bytes = new TextEncoder().encode('{"text":"中文"}');
    const split = bytes.indexOf(0xe4) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, split));
        controller.enqueue(bytes.slice(split));
        controller.close();
      },
    });
    await expect(readJsonBody(streamRequest(stream), { maxBytes: 1024 })).resolves.toEqual({
      text: "中文",
    });
  });

  it("still surfaces malformed JSON as a SyntaxError for route classification", async () => {
    await expect(readJsonBody(jsonRequest("{"), { maxBytes: 1024 })).rejects.toBeInstanceOf(
      SyntaxError,
    );
  });

  it("rejects an invalid limit instead of silently buffering", async () => {
    await expect(readJsonBody(jsonRequest("{}"), { maxBytes: 0 })).rejects.toBeInstanceOf(
      RangeError,
    );
  });
});
