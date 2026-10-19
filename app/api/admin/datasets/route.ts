import { z } from "zod";
import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { dataSourceSchema } from "@/lib/analysis/types";
import { listManagedDatasets, setDatasetEnabled } from "@/lib/datasets/service";
import { readJsonBody } from "@/lib/security/request-body";

export const runtime = "nodejs";
const schema = z.object({ id: dataSourceSchema, enabled: z.boolean() }).strict();
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return noStoreJson({ datasets: listManagedDatasets() });
  } catch (error) {
    return apiError(error);
  }
}
export async function PATCH(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin(request);
    const input = schema.parse(await readJsonBody(request, { maxBytes: 4096 }));
    return noStoreJson({ dataset: setDatasetEnabled(input.id, input.enabled, actor.id) });
  } catch (error) {
    return apiError(error);
  }
}
