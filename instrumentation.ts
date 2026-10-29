/**
 * Retention maintenance. The durable repository rejects expired conversations
 * on access; this pass removes their stored bodies and finalizes turns whose
 * process died. It runs once at startup (before serving history) and every
 * five minutes while the server is running.
 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

const state = globalThis as typeof globalThis & {
  __conversationCleanupTimer?: ReturnType<typeof setInterval>;
};

export async function register() {
  // Edge runtime has no filesystem-backed history.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (state.__conversationCleanupTimer) return;
  const { cleanupConversations } = await import("./lib/conversations/repository");
  try {
    cleanupConversations();
  } catch (error) {
    // Do not block startup on a damaged bucket; requests surface that error.
    console.error("对话历史启动清理失败", {
      name: error instanceof Error ? error.name : typeof error,
    });
  }
  const timer = setInterval(() => {
    try {
      cleanupConversations();
    } catch (error) {
      console.error("对话历史定期清理失败", {
        name: error instanceof Error ? error.name : typeof error,
      });
    }
  }, CLEANUP_INTERVAL_MS);
  // Never keep a CLI/build process alive just for cleanup.
  timer.unref?.();
  state.__conversationCleanupTimer = timer;
}
