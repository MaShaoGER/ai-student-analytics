import { NextResponse } from "next/server";
import { z } from "zod";
import { AuthError } from "../auth/service";
import { RequestBodyTooLargeError } from "../security/request-body";
import { ConversationError } from "./types";

/** Private, uncached JSON for account-scoped history. */
export function conversationJson(value: unknown, status = 200): NextResponse {
  return NextResponse.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function conversationApiError(error: unknown): NextResponse {
  if (error instanceof ConversationError)
    return conversationJson(
      { error: error.message, code: error.code, ...(error.details ?? {}) },
      error.status,
    );
  if (error instanceof AuthError)
    return conversationJson({ error: error.message, code: error.code }, error.status);
  if (error instanceof RequestBodyTooLargeError)
    return conversationJson({ error: error.message, code: error.code }, 413);
  if (error instanceof z.ZodError || error instanceof SyntaxError)
    return conversationJson(
      { error: "提交内容不完整或格式不正确，请检查后重试。", code: "INVALID_INPUT" },
      400,
    );
  // Never log message text, conversation content or result rows.
  console.error("对话历史接口处理失败", {
    name: error instanceof Error ? error.name : typeof error,
  });
  return conversationJson(
    { error: "系统暂时无法完成历史操作，请联系管理员检查服务端配置。", code: "SYSTEM_ERROR" },
    500,
  );
}
