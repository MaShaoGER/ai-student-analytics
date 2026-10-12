import { profileDatasets } from "@/lib/analysis/duckdb";
import { apiError, noStoreJson, requireUser } from "@/lib/auth/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    return noStoreJson({ datasets: await profileDatasets() });
  } catch (error) { return apiError(error); }
}
