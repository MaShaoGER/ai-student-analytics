import { NextResponse } from "next/server";
import { z } from "zod";
import type { SessionUser } from "../client-types";
import { AuthError, getSessionUser } from "./service";

export const cookieName = "analytics_session";

export function readSessionToken(request: Request): string | undefined {
  return request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
}

export async function requireUser(request: Request): Promise<SessionUser> {
  const user = await getSessionUser(readSessionToken(request));
  if (!user) throw new AuthError(401, "UNAUTHENTICATED", "请先登录，再查看数据。");
  return user;
}

export async function requireAdmin(request: Request): Promise<SessionUser> {
  const user = await requireUser(request);
  if (user.role !== "admin") throw new AuthError(403, "FORBIDDEN", "只有管理员可以修改系统设置。");
  return user;
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.APP_ORIGIN?.trim() || request.url).origin;
  let received: string;
  try { received = origin ? new URL(origin).origin : ""; } catch { received = ""; }
  if (!origin || received !== expected || origin !== received) {
    throw new AuthError(403, "INVALID_ORIGIN", "请求来源不受信任，请从本站页面重试。");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new AuthError(403, "INVALID_ORIGIN", "请求来源不受信任，请从本站页面重试。");
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: number, request: Request): void {
  response.cookies.set(cookieName, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production" || new URL(process.env.APP_ORIGIN?.trim() || request.url).protocol === "https:",
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(response: NextResponse, request: Request): void {
  setSessionCookie(response, "", 0, request);
}

export function apiError(error: unknown): NextResponse {
  if (error instanceof AuthError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store", ...(error.status === 429 ? { "Retry-After": "900" } : {}) } });
  if (error instanceof z.ZodError || error instanceof SyntaxError) return NextResponse.json({ error: "提交内容不完整或格式不正确，请检查后重试。", code: "INVALID_INPUT" }, { status: 400, headers: { "Cache-Control": "no-store" } });
  // Do not log messages: upstream API errors can contain credentials or user text.
  console.error("API 请求处理失败", safeErrorDetails(error));
  return NextResponse.json({ error: "系统暂时无法完成操作，请联系管理员检查服务端配置。", code: "SYSTEM_ERROR" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}

function safeErrorDetails(error: unknown): { name: string; code?: string } {
  if (!(error instanceof Error)) return { name: typeof error };
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? { name: error.name, code } : { name: error.name };
}

export function noStoreJson(value: unknown): NextResponse {
  return NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
}
