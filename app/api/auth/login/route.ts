import { z } from "zod";
import { apiError, assertSameOrigin, noStoreJson, setSessionCookie } from "@/lib/auth/http";
import {
  loginClientKey,
  reserveLoginAttempt,
  settleLoginAttempt,
} from "@/lib/auth/login-attempts";
import { AuthError, login } from "@/lib/auth/service";
import { readJsonBody } from "@/lib/security/request-body";

export const runtime = "nodejs";
/** Credentials are tiny; anything larger is rejected before it is buffered. */
const LOGIN_BODY_LIMIT_BYTES = 4 * 1024;
const inputSchema = z.object({ username: z.string().trim().min(1).max(40), password: z.string().min(1).max(128) }).strict();
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = inputSchema.parse(
      await readJsonBody(request, { maxBytes: LOGIN_BODY_LIMIT_BYTES }),
    );
    const clientKey = loginClientKey(request);
    // The throttle slot is claimed atomically before verification, so parallel
    // guesses for one account cannot all pass the check (429 is thrown here
    // without counting a failure).
    const reservation = reserveLoginAttempt(input.username, clientKey);
    const session = await login(input.username, input.password).catch((error: unknown) => {
      // Only a rejected credential counts; any other failure frees the slot.
      settleLoginAttempt(
        reservation,
        error instanceof AuthError && error.code === "INVALID_CREDENTIALS" ? "failure" : "release",
      );
      throw error;
    });
    // A completed successful login clears the account's failure history.
    settleLoginAttempt(reservation, "success");
    const response = noStoreJson({ user: session.user });
    setSessionCookie(response, session.token, session.expiresAt, request);
    return response;
  } catch (error) { return apiError(error); }
}
