import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, assertSameOrigin, clearSessionCookie, noStoreJson, requireUser } from "@/lib/auth/http";
import { changePassword } from "@/lib/auth/service";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
const inputSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) }).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const limit = checkRateLimit(`password:${user.id}`, rateLimitConfigs.strict);
    if (!limit.allowed)
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试。", code: "RATE_LIMIT_EXCEEDED" },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(Math.ceil(limit.resetAfter / 1000)),
          },
        },
      );
    const input = inputSchema.parse(await request.json());
    await changePassword(user.id, input.currentPassword, input.newPassword);
    const response = noStoreJson({ success: true, message: "密码已更新，请重新登录。" });
    clearSessionCookie(response, request);
    return response;
  } catch (error) { return apiError(error); }
}
