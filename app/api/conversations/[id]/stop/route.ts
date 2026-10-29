import { z } from "zod";
import { assertBusinessAccess } from "@/lib/auth/access";
import { assertSameOrigin, requireUser } from "@/lib/auth/http";
import { cancelLocalTurn } from "@/lib/conversations/cancellation";
import { conversationApiError, conversationJson } from "@/lib/conversations/http";
import { getConversation, stopTurn } from "@/lib/conversations/repository";
import { readJsonBody } from "@/lib/security/request-body";

export const runtime = "nodejs";

const stopSchema = z.object({ turnId: z.string().uuid() }).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const { id } = await params;
    const input = stopSchema.parse(await readJsonBody(request, { maxBytes: 4 * 1024 }));
    const detail = getConversation(user.id, id);
    assertBusinessAccess(user, detail.conversation.datasetId, "ai");
    // Durable cancellation first: a late result cannot be committed afterwards,
    // even if this worker never observes the in-process abort.
    const result = stopTurn(user.id, id, { turnId: input.turnId });
    // Then release the local model/tool call; another worker learns via the state gate.
    cancelLocalTurn(user.id, id, input.turnId);
    return conversationJson({
      turnId: result.turn?.id ?? input.turnId,
      status: result.turn?.status ?? "cancelled",
      idle: result.idle,
      conversation: result.conversation,
    });
  } catch (error) {
    return conversationApiError(error);
  }
}
