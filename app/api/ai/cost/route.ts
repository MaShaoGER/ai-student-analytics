import { apiError, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { getPublicCostStats } from "@/lib/security/ai-cost";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return noStoreJson({ stats: getPublicCostStats() });
  } catch (error) { return apiError(error); }
}
