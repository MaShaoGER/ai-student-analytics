import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { validateGradeDraft } from "@/lib/datasets/grade-store";
import { readJsonBody } from "@/lib/security/request-body";
import { enforceImportRateLimit, validationRequestSchema } from "../route-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin(request);
    enforceImportRateLimit("validation", actor.id);
    const input = validationRequestSchema.parse(
      await readJsonBody(request, { maxBytes: 32 * 1024 }),
    );
    return noStoreJson({
      validation: validateGradeDraft(
        actor.id,
        input.draftId,
        input.sheet,
        input.headerRow,
        input.mapping,
      ),
    });
  } catch (error) {
    return apiError(error);
  }
}
