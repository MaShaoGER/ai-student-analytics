import { z } from "zod";
import { apiError, assertSameOrigin, limitLogin, noStoreJson, setSessionCookie } from "@/lib/auth/http";
import { login } from "@/lib/auth/service";

export const runtime = "nodejs";
const inputSchema = z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(128) }).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await request.json());
    limitLogin(input.username);
    const session = await login(input.username, input.password);
    const response = noStoreJson({ user: session.user });
    setSessionCookie(response, session.token, session.expiresAt, request);
    return response;
  } catch (error) { return apiError(error); }
}
