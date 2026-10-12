import { apiError, assertSameOrigin, clearSessionCookie, noStoreJson, readSessionToken } from "@/lib/auth/http";
import { logout } from "@/lib/auth/service";

export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    logout(readSessionToken(request));
    const response = noStoreJson({ success: true });
    clearSessionCookie(response, request);
    return response;
  } catch (error) { return apiError(error); }
}
