import { apiError, noStoreJson, readSessionToken } from "@/lib/auth/http";
import { getSessionUser, isSetupRequired } from "@/lib/auth/service";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const setupRequired = await isSetupRequired();
    const user = await getSessionUser(readSessionToken(request));
    return noStoreJson({ user, setupRequired });
  } catch (error) { return apiError(error); }
}
