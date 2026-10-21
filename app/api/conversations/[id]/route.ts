import { assertBusinessAccess } from "@/lib/auth/access";
import { assertSameOrigin, requireUser } from "@/lib/auth/http";
import { cancelLocalTurnsForConversation } from "@/lib/conversations/cancellation";
import { conversationApiError, conversationJson } from "@/lib/conversations/http";
import { deleteConversation, getConversation } from "@/lib/conversations/repository";
import { ConversationError } from "@/lib/conversations/types";

export const runtime = "nodejs";

function conversationId(value: string): string {
  return value;
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(request);
    const { id } = await params;
    const detail = getConversation(user.id, conversationId(id));
    // Current grants are checked before any stored text is returned.
    assertBusinessAccess(user, detail.conversation.datasetId, "view");
    return conversationJson(detail);
  } catch (error) {
    return conversationApiError(error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser(request);
    const { id } = await params;
    // Check ownership through the repository before deriving a dataset scope.
    try {
      const detail = getConversation(user.id, conversationId(id));
      assertBusinessAccess(user, detail.conversation.datasetId, "view");
    } catch (error) {
      // Deleting an already deleted or expired conversation is idempotent and
      // must not reveal whether another account owns that id.
      if (!(error instanceof ConversationError && (error.status === 404 || error.status === 410)))
        throw error;
    }
    deleteConversation(user.id, conversationId(id));
    // A local worker must not keep streaming a conversation the user deleted.
    cancelLocalTurnsForConversation(user.id, conversationId(id));
    return conversationJson({ conversationId: id, deleted: true });
  } catch (error) {
    return conversationApiError(error);
  }
}
