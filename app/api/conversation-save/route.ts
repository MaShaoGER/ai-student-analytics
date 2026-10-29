import { z } from "zod";
import { requireUser, assertSameOrigin, apiError, noStoreJson } from "@/lib/auth/http";
import { readJsonBody } from "@/lib/security/request-body";
import { retryConversationSave } from "@/lib/ai/conversation-session";
import { ConversationError } from "@/lib/conversations/types";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const input = z
      .object({ conversationId: z.string().uuid(), turnId: z.string().uuid() })
      .strict()
      .parse(await readJsonBody(request, { maxBytes: 2000 }));
    return noStoreJson(retryConversationSave(user, input.conversationId, input.turnId));
  } catch (error) {
    if (error instanceof ConversationError)
      return Response.json(
        { error: error.message, code: error.code, retryable: false },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    return apiError(error);
  }
}
