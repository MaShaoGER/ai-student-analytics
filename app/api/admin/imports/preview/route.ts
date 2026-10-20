import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { previewGradeDraft } from "@/lib/datasets/grade-store";
import { readJsonBody } from "@/lib/security/request-body";
import { enforceImportRateLimit, selectionSchema } from "../route-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin(request);
    enforceImportRateLimit("preview", actor.id);
    const input = selectionSchema.parse(await readJsonBody(request, { maxBytes: 16 * 1024 }));
    return noStoreJson({
      selection: previewGradeDraft(actor.id, input.draftId, input.sheet, input.headerRow),
    });
  } catch (error) {
    return apiError(error);
  }
}
