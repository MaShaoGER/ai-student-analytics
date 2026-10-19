import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { getPublicCostStats } from "@/lib/security/ai-cost";
import { getAIConfig, saveAIConfig } from "@/lib/settings/ai";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return noStoreJson({ config: getAIConfig(), stats: getPublicCostStats() });
  } catch (error) {
    return apiError(error);
  }
}
export async function PUT(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin(request);
    const config = saveAIConfig(await request.json(), actor.id);
    return noStoreJson({ config, stats: getPublicCostStats() });
  } catch (error) {
    return apiError(error);
  }
}
