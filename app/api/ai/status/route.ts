import { getAIStatus } from "@/lib/ai/planner";
import { apiError, noStoreJson, requireUser } from "@/lib/auth/http";
import { getAIConfig } from "@/lib/settings/ai";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireUser(request);
    const status = getAIStatus();
    const config = getAIConfig();
    const pricingConfigured =
      config.pricing.inputPerMillion !== null && config.pricing.outputPerMillion !== null;
    return noStoreJson({
      configured: status.configured && pricingConfigured,
      enabled: status.enabled,
    });
  } catch (error) {
    return apiError(error);
  }
}
