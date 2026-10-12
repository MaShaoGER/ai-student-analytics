import { z } from "zod";
import { apiError, assertSameOrigin, clearSessionCookie, noStoreJson, requireUser } from "@/lib/auth/http";
import { changePassword } from "@/lib/auth/service";

export const runtime = "nodejs";
const inputSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(12).max(128) }).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const input = inputSchema.parse(await request.json());
    await changePassword(user.id, input.currentPassword, input.newPassword);
    const response = noStoreJson({ success: true, message: "密码已更新，请重新登录。" });
    clearSessionCookie(response, request);
    return response;
  } catch (error) { return apiError(error); }
}
