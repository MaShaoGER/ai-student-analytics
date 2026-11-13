type ResponseTurn = {
  id: string;
  role: string;
  response?: unknown;
  restored?: boolean;
};

export function responseIdToAnimate(
  messages: readonly ResponseTurn[],
  baselineId: string | null,
): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role !== "assistant") continue;
    return message.response && !message.restored && message.id !== baselineId
      ? message.id
      : null;
  }
  return null;
}
