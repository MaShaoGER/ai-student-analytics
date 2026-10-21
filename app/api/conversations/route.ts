import { z } from "zod";
import { assertBusinessAccess, withBusinessAccess } from "@/lib/auth/access";
import { assertSameOrigin, requireUser } from "@/lib/auth/http";
import { authorizedDatasets } from "@/lib/datasets/service";
import { conversationApiError, conversationJson } from "@/lib/conversations/http";
import { createConversation, listConversations } from "@/lib/conversations/repository";
import { CONVERSATION_PAGE_DEFAULT, CONVERSATION_PAGE_MAX } from "@/lib/conversations/types";
import type { DataSource } from "@/lib/analysis/types";
import { datasetIdSchema } from "@/lib/datasets/id";
import { readJsonBody } from "@/lib/security/request-body";

export const runtime = "nodejs";

const createSchema = z
  .object({ datasetId: datasetIdSchema, title: z.string().trim().min(1).max(60).optional() })
  .strict();
const querySchema = z
  .object({
    cursor: z.string().min(1).max(500).optional(),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(CONVERSATION_PAGE_MAX)
      .default(CONVERSATION_PAGE_DEFAULT),
  })
  .strict();

function queryObject(params: URLSearchParams): Record<string, string> {
  const value: Record<string, string> = {};
  for (const key of params.keys()) {
    if (!["cursor", "limit"].includes(key))
      throw new z.ZodError([
        { code: "custom", message: "包含未知的查询参数。", path: [key], input: params.get(key) },
      ]);
    value[key] = params.get(key)!;
  }
  return value;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const input = querySchema.parse(queryObject(new URL(request.url).searchParams));
    // Sidebar titles are metadata: revoked, disabled or unavailable datasets
    // must disappear rather than reveal stored questions through their titles.
    const datasetIds = authorizedDatasets(user)
      .filter((dataset) => dataset.enabled && dataset.available)
      .map((dataset) => dataset.id);
    return conversationJson(
      listConversations(user.id, {
        cursor: input.cursor,
        limit: input.limit,
        datasetIds,
      }),
    );
  } catch (error) {
    return conversationApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const input = createSchema.parse(await readJsonBody(request, { maxBytes: 8 * 1024 }));
    assertBusinessAccess(user, input.datasetId, "ai");
    const conversation = withBusinessAccess(user, input.datasetId as DataSource, "ai", () =>
      createConversation(user.id, input),
    );
    return conversationJson({ conversation }, 201);
  } catch (error) {
    return conversationApiError(error);
  }
}
