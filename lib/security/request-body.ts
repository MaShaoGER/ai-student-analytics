/**
 * Bounded JSON body reader for API routes.
 *
 * Next's `request.json()` buffers the whole body before any size check, so a
 * single unauthenticated request could exhaust memory. This reader rejects a
 * declared oversized `content-length` before reading and aborts chunked
 * bodies as soon as the byte budget is exceeded.
 */
export const REQUEST_TOO_LARGE_MESSAGE = "请求内容过大，请缩小查询范围后重试。";
export const REQUEST_TOO_LARGE_CODE = "REQUEST_TOO_LARGE";

export class RequestBodyTooLargeError extends Error {
  readonly code = REQUEST_TOO_LARGE_CODE;
  constructor() {
    super(REQUEST_TOO_LARGE_MESSAGE);
    this.name = "RequestBodyTooLargeError";
  }
}

export type ReadJsonBodyOptions = {
  maxBytes: number;
};

export async function readJsonBody(
  request: Request,
  options: ReadJsonBodyOptions,
): Promise<unknown> {
  if (!Number.isFinite(options.maxBytes) || options.maxBytes <= 0)
    throw new RangeError("请求体上限必须是大于 0 的有限数值。");
  const maxBytes = Math.floor(options.maxBytes);

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (Number.isFinite(length) && length > maxBytes) {
      await request.body?.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError();
    }
  }

  if (!request.body) return JSON.parse(await request.text()) as unknown;

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text) as unknown;
}
