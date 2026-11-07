export const NETWORK_ERROR_MESSAGE = "网络连接失败，请检查网络后重试。";

/** Keep fetch noise out of Chinese notices: cancellation stays silent, server
 *  messages pass through, and network failures get one actionable sentence. */
export function requestMessage(error: unknown, fallback: string): string {
  if (error instanceof DOMException && error.name === "AbortError") return "";
  if (error instanceof TypeError) return NETWORK_ERROR_MESSAGE;
  return error instanceof Error && error.message ? error.message : fallback;
}
