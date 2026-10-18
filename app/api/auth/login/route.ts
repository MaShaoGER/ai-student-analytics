import { z } from "zod";
import { apiError, assertSameOrigin, noStoreJson, setSessionCookie } from "@/lib/auth/http";
import {
  assertLoginAllowed,
  clearLoginFailures,
  loginClientKey,
  recordLoginFailure,
} from "@/lib/auth/login-attempts";
import { AuthError, login } from "@/lib/auth/service";

export const runtime = "nodejs";
const inputSchema = z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(128) }).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(await request.json());
    const clientKey = loginClientKey(request);
    // Throttle before password verification; only failed checks are counted below.
    assertLoginAllowed(input.username, clientKey);
    const session = await login(input.username, input.password).catch((error: unknown) => {
      if (error instanceof AuthError && error.code === "INVALID_CREDENTIALS") recordLoginFailure(input.username, clientKey);
      throw error;
    });
    clearLoginFailures(input.username);
    const response = noStoreJson({ user: session.user });
    setSessionCookie(response, session.token, session.expiresAt, request);
    return response;
  } catch (error) { return apiError(error); }
}
