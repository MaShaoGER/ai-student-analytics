/**
 * Process-local cancellation registry.
 *
 * The durable stop is a compare-and-set in the repository; this registry lets
 * the worker that is actually streaming a turn abort its model/tool work as
 * soon as the stop request is committed in the same process. A stop handled by
 * another worker is observed by the authenticated state checks performed
 * between analysis steps, and the late result is rejected by revision/state.
 */
type Entry = {
  ownerId: string;
  conversationId: string;
  turnId: string;
  abort: (reason?: string) => void;
};

const state = globalThis as typeof globalThis & {
  __conversationTurnCancellations?: Map<string, Entry>;
};
const registry = (state.__conversationTurnCancellations ??= new Map());

const keyFor = (ownerId: string, conversationId: string, turnId: string) =>
  `${ownerId}\u0000${conversationId}\u0000${turnId}`;

export function registerTurnCancellation(
  ownerId: string,
  conversationId: string,
  turnId: string,
  abort: (reason?: string) => void,
): () => void {
  const key = keyFor(ownerId, conversationId, turnId);
  const entry: Entry = { ownerId, conversationId, turnId, abort };
  registry.set(key, entry);
  return () => {
    // Never delete a newer controller registered for the same turn.
    if (registry.get(key) === entry) registry.delete(key);
  };
}

export function cancelLocalTurn(
  ownerId: string,
  conversationId: string,
  turnId: string,
  reason = "TURN_STOPPED",
): boolean {
  const key = keyFor(ownerId, conversationId, turnId);
  const entry = registry.get(key);
  if (!entry) return false;
  registry.delete(key);
  try {
    entry.abort(reason);
  } catch {
    // Aborting is best-effort; the committed cancel state remains authoritative.
  }
  return true;
}

export function cancelLocalTurnsForConversation(ownerId: string, conversationId: string): number {
  let cancelled = 0;
  for (const [key, entry] of registry) {
    if (entry.ownerId !== ownerId || entry.conversationId !== conversationId) continue;
    registry.delete(key);
    try {
      entry.abort("CONVERSATION_DELETED");
      cancelled += 1;
    } catch {
      cancelled += 1;
    }
  }
  return cancelled;
}

export function localTurnRegistrationCount(): number {
  return registry.size;
}
