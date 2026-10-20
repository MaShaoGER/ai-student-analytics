import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { publishGradeDraft } from "@/lib/datasets/grade-store";
import { readJsonBody } from "@/lib/security/request-body";
import { enforceImportRateLimit, publicationRequestSchema } from "../route-utils";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin(request);
    enforceImportRateLimit("publication", actor.id);
    const input = publicationRequestSchema.parse(
      await readJsonBody(request, { maxBytes: 32 * 1024 }),
    );
    const dataset = publishGradeDraft({
      actorId: actor.id,
      draftId: input.draftId,
      sheet: input.sheet,
      headerRow: input.headerRow,
      mapping: input.mapping,
      name: input.name,
      datasetId: input.datasetId,
      baseVersion: input.baseVersion,
    });
    return noStoreJson({ dataset });
  } catch (error) {
    return apiError(error);
  }
}
