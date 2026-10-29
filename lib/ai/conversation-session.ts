/** Durable transport adapter; model/tool execution always remains in converse(). */
import type { SessionUser } from "../client-types";
import { assertBusinessAccess } from "../auth/access";
import { getUserById } from "../auth/service";
import {
  claimTurn,
  failTurn,
  finishTurn,
  getConversation,
  snapshotResponse,
} from "../conversations/repository";
import {
  ConversationError,
  type ChatResponseSnapshot,
  type ClaimTurnResult,
} from "../conversations/types";
import type { ChatInput, ChatResponse } from "./chat-types";
import { applyResponsePresentation } from "../analysis/presentation-policy";

// Process-local retry buffer, never a second durable history. A restart loses
// unsaved answers and the UI explicitly reports that fact. No second AI call.
type PendingSave = {
  ownerId: string;
  claim: ClaimTurnResult["claim"];
  response: ChatResponseSnapshot;
  expires: number;
};
const state = globalThis as typeof globalThis & {
  __conversationPendingSaves?: Map<string, PendingSave>;
};
const pending = (state.__conversationPendingSaves ??= new Map());
const keyFor = (ownerId: string, conversationId: string, turnId: string) =>
  `${ownerId}:${conversationId}:${turnId}`;
function prune() {
  for (const [key, value] of pending) if (value.expires <= Date.now()) pending.delete(key);
  while (pending.size >= 20) pending.delete(pending.keys().next().value!);
}
function currentUser(user: SessionUser, datasetId: ChatInput["datasetId"]) {
  const current = getUserById(user.id);
  if (!current) throw new ConversationError(401, "UNAUTHENTICATED", "登录已失效，请重新登录。");
  assertBusinessAccess(current, datasetId, "ai");
}
export function beginConversationTurn(user: SessionUser, input: ChatInput) {
  if (!input.conversationId || !input.turnId) return null;
  currentUser(user, input.datasetId);
  return claimTurn(user.id, {
    conversationId: input.conversationId,
    turnId: input.turnId,
    question: input.question,
    datasetId: input.datasetId,
    expectedRevision: input.expectedRevision,
    resetContext: input.resetContext,
  });
}
export function replayConversationTurn(user: SessionUser, turn: ClaimTurnResult): ChatResponse {
  const detail = getConversation(user.id, turn.claim.conversationId);
  const stored = detail.turns.find((item) => item.id === turn.claim.turnId)!;
  if (stored.status === "running")
    throw new ConversationError(
      409,
      "TURN_IN_PROGRESS",
      "这轮分析仍在进行，请稍后刷新历史。不会重复启动分析。",
    );
  if (!stored.response)
    throw new ConversationError(
      409,
      stored.error?.code ?? "TURN_FINISHED",
      stored.error?.message ?? "这轮分析已经结束。请刷新历史后发起新的提问。",
    );
  return {
    ...stored.response,
    generatedAt: stored.response.generatedAt,
    conversation: {
      id: detail.conversation.id,
      revision: detail.conversation.revision,
      turnId: stored.id,
    },
    persistence: "saved",
  };
}
export function presentationFromHistory(
  user: SessionUser,
  turn: ClaimTurnResult,
  question: string,
): ChatResponse | null {
  if (!turn.history.length && !turn.context) return null;
  if (
    !/^(?:改成|换成|切换到?|用)?(?:表格|数值表|图表|图形|原图|柱状图|条形图|折线图|饼图|环形图|热力图)(?:展示|显示)?[。！!？?\s]*$/.test(
      question,
    )
  )
    return null;
  const detail = getConversation(user.id, turn.claim.conversationId);
  const last = [...detail.messages]
    .reverse()
    .find((item) => item.role === "assistant" && item.response?.artifact)?.response;
  if (!last) return null;
  const adjusted = applyResponsePresentation(last, question);
  return {
    ...adjusted,
    answer: "已沿用上一份统计结果调整展示。生成时间与事实引用保留，数据没有重新查询。",
    steps: [],
    planning: { source: "local", model: null, rationale: "仅切换已有可信结果的展示，无模型调用。" },
    usage: undefined,
    requestId: undefined,
    // Retain the original result time, rather than claim a fresh computation.
    generatedAt: last.generatedAt,
    presentation: /表格|数值表/.test(question) ? "table" : "chart",
  };
}
export function persistConversationResponse(
  user: SessionUser,
  turn: ClaimTurnResult,
  response: ChatResponse,
): ChatResponse {
  currentUser(user, turn.conversation.datasetId);
  const generatedAt = response.generatedAt ?? new Date().toISOString();
  const snapshot = snapshotResponse({ ...response, generatedAt });
  const metadata = {
    id: turn.claim.conversationId,
    revision: turn.claim.revision,
    turnId: turn.claim.turnId,
  };
  try {
    const saved = finishTurn(user.id, {
      conversationId: metadata.id,
      turnId: metadata.turnId,
      revision: turn.claim.revision,
      response: snapshot,
    });
    if (!["completed", "partial"].includes(saved.turn.status))
      throw new ConversationError(409, "TURN_STOPPED", "这轮分析已停止，迟到结果不会恢复。");
    pending.delete(keyFor(user.id, metadata.id, metadata.turnId));
    return {
      ...response,
      generatedAt,
      conversation: { ...metadata, revision: saved.conversation.revision },
      persistence: "saved",
    };
  } catch (error) {
    if (error instanceof ConversationError && error.status < 500) throw error; // deleted/expired/stopped cannot be revived
    prune();
    pending.set(keyFor(user.id, metadata.id, metadata.turnId), {
      ownerId: user.id,
      claim: turn.claim,
      response: snapshot,
      expires: Date.now() + 5 * 60_000,
    });
    return {
      ...response,
      generatedAt,
      conversation: metadata,
      persistence: "pending",
      warning: [
        response.warning,
        "分析已完成，但历史保存失败。请点击重试保存；不会重新分析。未保存结果在服务重启后无法恢复。",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
}
export function retryConversationSave(
  user: SessionUser,
  conversationId: string,
  turnId: string,
): ChatResponse {
  const detail = getConversation(user.id, conversationId);
  currentUser(user, detail.conversation.datasetId);
  prune();
  const value = pending.get(keyFor(user.id, conversationId, turnId));
  if (!value) {
    const stored = detail.turns.find((turn) => turn.id === turnId);
    if (stored?.response && stored.status !== "running")
      return {
        ...stored.response,
        persistence: "saved",
        conversation: { id: conversationId, turnId, revision: detail.conversation.revision },
      };
    throw new ConversationError(
      410,
      "SAVE_UNAVAILABLE",
      "未保存结果已不可恢复（服务可能已重启或等待超过 5 分钟）。当前文字仍可复制，请刷新历史查看保存状态。",
    );
  }
  const saved = finishTurn(user.id, {
    conversationId,
    turnId,
    revision: value.claim.revision,
    response: value.response,
  });
  if (!["completed", "partial"].includes(saved.turn.status))
    throw new ConversationError(409, "TURN_STOPPED", "这轮分析已停止，不能保存迟到结果。");
  pending.delete(keyFor(user.id, conversationId, turnId));
  return {
    ...value.response,
    persistence: "saved",
    conversation: { id: conversationId, turnId, revision: saved.conversation.revision },
  };
}
export function failConversationTurn(
  user: SessionUser,
  turn: ClaimTurnResult | null,
  code: string,
  cancelled: boolean,
) {
  if (!turn || turn.claim.replayed) return;
  failTurn(user.id, {
    conversationId: turn.claim.conversationId,
    turnId: turn.claim.turnId,
    revision: turn.claim.revision,
    status: cancelled ? "cancelled" : "failed",
    error: {
      code,
      message: cancelled ? "已停止回复，已完成的历史仍可查看。" : "这轮分析未完成，请重新提问。",
    },
  });
}
