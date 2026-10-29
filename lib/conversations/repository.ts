import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { AnalysisResult, DataSource } from "../analysis/types";
import type { ChatArtifact, ChatMessage, ChatResponse } from "../ai/chat-types";
import { RESULT_KINDS } from "../ai/result-contract";
import { getStateDirectory, readState, updateState } from "../settings/storage";
import { assertCurrentAccess } from "../auth/access";
import { currentLeaseOwner, leaseOwnerIsAlive } from "./process-lease";
import {
  CONVERSATION_ANSWER_LIMIT,
  CONVERSATION_ARTIFACT_LIMIT,
  CONVERSATION_BUCKET_BYTE_LIMIT,
  CONVERSATION_DEFAULT_TITLE,
  CONVERSATION_HISTORY_CHARACTER_LIMIT,
  CONVERSATION_HISTORY_LIMIT,
  CONVERSATION_HISTORY_MESSAGE_LIMIT,
  CONVERSATION_MAX_MESSAGES,
  CONVERSATION_MAX_PER_OWNER,
  CONVERSATION_MAX_TURNS,
  CONVERSATION_PAGE_DEFAULT,
  CONVERSATION_PAGE_MAX,
  CONVERSATION_RESULT_HISTORY_LIMIT,
  CONVERSATION_RESULT_LABEL_LIMIT,
  CONVERSATION_RETENTION_MS,
  CONVERSATION_SNAPSHOT_BYTE_LIMIT,
  CONVERSATION_STORAGE_VERSION,
  CONVERSATION_TURN_LEASE_MS,
  ConversationError,
  chatResponseSnapshotSchema,
  conversationBucketSchema,
  type ChatResponseSnapshot,
  type ClaimTurnInput,
  type ClaimTurnResult,
  type ConversationDetail,
  type ConversationPage,
  type ConversationSummary,
  type CreateConversationInput,
  type FailTurnInput,
  type FailTurnResult,
  type FinishTurnInput,
  type FinishTurnResult,
  type ListConversationsOptions,
  type StopTurnInput,
  type StopTurnResult,
  type StoredConversation,
  type StoredConversationMessage,
  type StoredConversationTurn,
  type TerminalTurnStatus,
  type TurnClaim,
} from "./types";

/**
 * Account-scoped conversation repository.
 *
 * Layout: one JSON bucket per account under `<APP_STATE_DIR>/conversations/`.
 * Each bucket transaction reuses `updateState`, so cross-worker claims, stops,
 * deletes and TTL cleanup share one atomic compare-and-swap. AI/statistics work
 * must happen outside these short transactions.
 */
type Bucket = {
  version: 1;
  ownerId: string;
  conversations: StoredConversation[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertUuid(value: string, field: string): string {
  if (!UUID.test(value)) throw new ConversationError(400, "INVALID_INPUT", `${field} 格式不正确。`);
  return value.toLowerCase();
}

function bucketFile(ownerId: string): string {
  // Hashing the owner keeps account ids out of file names and prevents traversal.
  const digest = createHash("sha256").update(ownerId).digest("hex");
  return `conversations/${digest}.json`;
}

function emptyBucket(ownerId: string): Bucket {
  return { version: CONVERSATION_STORAGE_VERSION, ownerId, conversations: [] };
}

function corrupt(): ConversationError {
  return new ConversationError(
    500,
    "CONVERSATION_STORAGE_CORRUPT",
    "历史对话存储无法读取，请联系管理员检查服务端数据文件。",
  );
}

function readBucket(ownerId: string): Bucket {
  let raw: unknown;
  try {
    raw = readState<unknown>(bucketFile(ownerId), () => emptyBucket(ownerId));
  } catch {
    throw corrupt();
  }
  const parsed = conversationBucketSchema.safeParse(raw);
  if (!parsed.success || parsed.data.ownerId !== ownerId) throw corrupt();
  assertBucketOwnership(parsed.data);
  return parsed.data;
}

function assertBucketOwnership(bucket: Bucket): void {
  const ids = new Set<string>();
  for (const conversation of bucket.conversations) {
    if (conversation.ownerId !== bucket.ownerId || ids.has(conversation.id)) throw corrupt();
    ids.add(conversation.id);
  }
}

/**
 * Validate inside the lock as well: another worker may have written a damaged
 * bucket after the initial read. Returning a fresh copy keeps mutations local
 * to the transaction.
 */
function mutateBucket<T>(ownerId: string, update: (bucket: Bucket) => T): T {
  try {
    return updateState<Bucket, T>(
      bucketFile(ownerId),
      () => emptyBucket(ownerId),
      (raw) => {
        const parsed = conversationBucketSchema.safeParse(raw);
        if (!parsed.success || parsed.data.ownerId !== ownerId) throw corrupt();
        assertBucketOwnership(parsed.data);
        // Replace the whole object so undeclared top-level keys from an older or
        // damaged file are dropped instead of being written back silently.
        for (const key of Object.keys(raw)) delete (raw as Record<string, unknown>)[key];
        Object.assign(raw, parsed.data);
        const result = update(raw);
        // Bound physical growth before publication; never silently drop messages.
        if (Buffer.byteLength(JSON.stringify(raw), "utf8") > CONVERSATION_BUCKET_BYTE_LIMIT)
          throw new ConversationError(
            413,
            "CONVERSATION_STORAGE_LIMIT",
            "该账号的历史对话总量已达上限，请删除不再需要的会话。",
          );
        return result;
      },
    );
  } catch (error) {
    // A syntactically damaged file fails inside readState with a generic error;
    // surface the same explicit storage error instead of resetting anything.
    if (error instanceof ConversationError) throw error;
    if (error instanceof Error && error.message.startsWith("系统存储无法读取")) throw corrupt();
    throw error;
  }
}

function trimText(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function normalizeTitle(value: string): string {
  return trimText(value.trim().replace(/\s+/g, " "), 60) || CONVERSATION_DEFAULT_TITLE;
}

function titleFromQuestion(question: string): string {
  return normalizeTitle(question);
}

function nowIso(now: Date): string {
  return now.toISOString();
}

function expiryFrom(now: Date): string {
  return new Date(now.getTime() + CONVERSATION_RETENTION_MS).toISOString();
}

function isExpired(conversation: StoredConversation, now: Date): boolean {
  return now.getTime() >= Date.parse(conversation.expiresAt);
}

function effectiveStatus(
  turn: StoredConversationTurn,
  now: Date,
): StoredConversationTurn["status"] {
  if (turn.status !== "running") return turn.status;
  if (now.getTime() >= Date.parse(turn.leaseExpiresAt)) return "interrupted";
  if (!leaseOwnerIsAlive(turn.leaseOwner, now.getTime())) return "interrupted";
  return "running";
}

function summary(conversation: StoredConversation, now: Date): ConversationSummary {
  const last = conversation.turns.at(-1);
  return {
    id: conversation.id,
    title: conversation.title,
    datasetId: conversation.datasetId,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    expiresAt: conversation.expiresAt,
    revision: conversation.revision,
    messageCount: conversation.messages.length,
    lastTurn: last
      ? {
          id: last.id,
          status: effectiveStatus(last, now),
          updatedAt: last.updatedAt,
          ...(last.response?.generatedAt ? { generatedAt: last.response.generatedAt } : {}),
        }
      : null,
  };
}

function detail(conversation: StoredConversation, now: Date): ConversationDetail {
  const clone = JSON.parse(JSON.stringify(conversation)) as StoredConversation;
  for (const turn of clone.turns) turn.status = effectiveStatus(turn, now);
  return {
    conversation: summary(clone, now),
    messages: clone.messages,
    turns: clone.turns,
  };
}

function findConversation(bucket: Bucket, id: string, now: Date): StoredConversation {
  const conversation = bucket.conversations.find((item) => item.id === id);
  // An expired or foreign id is indistinguishable from a missing one.
  if (!conversation || conversation.ownerId !== bucket.ownerId || isExpired(conversation, now))
    throw new ConversationError(
      410,
      "CONVERSATION_UNAVAILABLE",
      "这轮对话已过期或不存在，请新建对话。",
    );
  return conversation;
}

function inputDigest(
  input: Pick<ClaimTurnInput, "question" | "datasetId" | "resetContext">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        question: input.question,
        datasetId: input.datasetId,
        resetContext: input.resetContext === true,
      }),
    )
    .digest("hex");
}

function compactResults(response: ChatResponseSnapshot | undefined): ChatMessage["results"] {
  if (!response) return undefined;
  const refs = response.resultRefs ?? [];
  const seen = new Set<string>();
  const results: NonNullable<ChatMessage["results"]> = [];
  for (const ref of refs.slice(-CONVERSATION_RESULT_HISTORY_LIMIT)) {
    if (!ref || typeof ref.resultId !== "string" || seen.has(ref.resultId)) continue;
    if (!RESULT_KINDS.includes(ref.kind)) continue;
    seen.add(ref.resultId);
    results.push({
      resultId: ref.resultId,
      kind: ref.kind,
      label: trimText(
        String(ref.scopeLabel ?? ref.metric ?? "分析结果"),
        CONVERSATION_RESULT_LABEL_LIMIT,
      ),
    });
  }
  return results.length ? results : undefined;
}

/**
 * Revision of the most recent explicit "new context" turn before `before`.
 * History/context must never reach past it, otherwise clearing the context
 * would silently resurrect the filters it was meant to discard.
 */
function resetBoundary(conversation: StoredConversation, beforeRevision: number): number {
  let boundary = 0;
  for (const turn of conversation.turns)
    if (turn.resetContext && turn.revision < beforeRevision)
      boundary = Math.max(boundary, turn.revision);
  return boundary;
}

function historyFrom(conversation: StoredConversation, beforeRevision: number): ChatMessage[] {
  const revisions = new Map(conversation.turns.map((turn) => [turn.id, turn.revision]));
  // The reset turn itself is the new starting point, so its own Q&A belongs to
  // the following history; everything older does not.
  const from = resetBoundary(conversation, beforeRevision) || 1;
  const selected = conversation.messages
    .filter((message) => {
      const revision = revisions.get(message.turnId) ?? 0;
      return revision >= from && revision < beforeRevision;
    })
    .slice(-CONVERSATION_HISTORY_LIMIT);
  const history: ChatMessage[] = [];
  let characters = 0;
  // Keep the most recent turns that fit both the count and character budgets.
  for (const message of [...selected].reverse()) {
    const content = trimText(message.content, CONVERSATION_HISTORY_MESSAGE_LIMIT);
    if (characters + content.length > CONVERSATION_HISTORY_CHARACTER_LIMIT) continue;
    characters += content.length;
    history.unshift({
      role: message.role,
      content,
      ...(message.role === "assistant" && message.results?.length
        ? { results: message.results }
        : {}),
    });
  }
  return history;
}

function contextFrom(
  conversation: StoredConversation,
  beforeRevision: number,
): ChatResponse["context"] {
  const revisions = new Map(conversation.turns.map((turn) => [turn.id, turn.revision]));
  const from = resetBoundary(conversation, beforeRevision) || 1;
  // The newest assistant response wins even when its context is null: an
  // explicit clear is meaningful, while a failed/skipped turn has no response
  // and falls back to the previous still-valid context.
  const previous = [...conversation.messages]
    .reverse()
    .find(
      (message) =>
        message.role === "assistant" &&
        Boolean(message.response) &&
        (revisions.get(message.turnId) ?? 0) >= from &&
        (revisions.get(message.turnId) ?? 0) < beforeRevision,
    );
  return previous?.response?.context ?? null;
}

function statusMessage(status: "failed" | "cancelled" | "interrupted"): string {
  return status === "cancelled"
    ? "已停止本轮回复。已完成的图表和数字依据仍可查看，可继续提问。"
    : status === "interrupted"
      ? "服务重启或中断导致本轮分析未完成。系统不会自动重新运行，可重新提问。"
      : "本轮分析未完成，没有生成可信结果。请稍后重新提问。";
}

function markInterrupted(
  conversation: StoredConversation,
  turn: StoredConversationTurn,
  now: Date,
  reason: "expired" | "dead" = "dead",
): boolean {
  if (turn.status !== "running") return false;
  // A lease held by a live process is not interrupted by a reader or by a
  // concurrent claim attempt. Only expiry/death may finalize it.
  if (effectiveStatus(turn, now) === "running") return false;
  const at = nowIso(now);
  turn.status = "interrupted";
  turn.updatedAt = at;
  turn.completedAt = at;
  turn.error = {
    code: reason === "expired" ? "TURN_LEASE_EXPIRED" : "TURN_INTERRUPTED",
    message:
      reason === "expired"
        ? "分析租约已过期，本轮状态标记为中断。"
        : "运行进程已停止，本轮状态标记为中断。",
  };
  conversation.messages.push({
    id: randomUUID(),
    turnId: turn.id,
    role: "assistant",
    content: statusMessage("interrupted"),
    createdAt: at,
    datasetId: conversation.datasetId,
  });
  conversation.updatedAt = at;
  // A terminal assistant message is a real message update: renew exactly once.
  conversation.expiresAt = expiryFrom(now);
  return true;
}

function trimConversation(conversation: StoredConversation): void {
  if (conversation.turns.length <= CONVERSATION_MAX_TURNS) return;
  const keep = new Set(conversation.turns.slice(-CONVERSATION_MAX_TURNS).map((turn) => turn.id));
  conversation.turns = conversation.turns.filter((turn) => keep.has(turn.id));
  conversation.messages = conversation.messages.filter((message) => keep.has(message.turnId));
  if (conversation.messages.length > CONVERSATION_MAX_MESSAGES)
    conversation.messages = conversation.messages.slice(-CONVERSATION_MAX_MESSAGES);
}

/** Explicit, shallow allowlist for a trusted computed response. */
export function snapshotResponse(
  response: ChatResponse,
  status?: TerminalTurnStatus,
  now: Date = new Date(),
): ChatResponseSnapshot {
  const generatedAt =
    typeof response.generatedAt === "string" && Number.isFinite(Date.parse(response.generatedAt))
      ? response.generatedAt
      : now.toISOString();
  const resolvedStatus: TerminalTurnStatus =
    status ?? (response.failureCode || response.completion === "partial" ? "partial" : "completed");
  const artifact = sanitizeArtifact(response.artifact);
  const artifacts = Array.isArray(response.artifacts)
    ? response.artifacts
        .slice(0, CONVERSATION_ARTIFACT_LIMIT)
        .map(sanitizeArtifact)
        .filter((item): item is ChatArtifact => item !== null)
    : undefined;
  const snapshot: ChatResponseSnapshot = {
    version: 1,
    status: resolvedStatus,
    generatedAt,
    ...(response.completion ? { completion: response.completion } : {}),
    ...(response.failureCode ? { failureCode: response.failureCode.slice(0, 100) } : {}),
    answer: trimText(String(response.answer ?? ""), CONVERSATION_ANSWER_LIMIT),
    kind: response.kind,
    facts: (response.facts ?? []).slice(0, 40).map((fact) => trimText(String(fact), 4_000)),
    suggestions: (response.suggestions ?? [])
      .slice(0, 20)
      .map((item) => trimText(String(item), 500)),
    context: response.context ?? null,
    planning: {
      source: response.planning.source,
      rationale: trimText(String(response.planning.rationale ?? ""), 4_000),
      model: response.planning.model ?? null,
    },
    ...(response.warning ? { warning: trimText(response.warning, 2_000) } : {}),
    ...(artifacts?.length ? { artifacts } : {}),
    artifact,
    ...(response.citations?.length
      ? {
          citations: response.citations.slice(0, 20).map((citation) => ({
            id: citation.id,
            title: trimText(citation.title, 500),
            version: trimText(citation.version, 100),
            source: trimText(citation.source, 500),
            scope: citation.scope,
            excerpt: trimText(citation.excerpt, 2_000),
          })),
        }
      : {}),
    ...(response.steps?.length
      ? {
          steps: response.steps.slice(0, 100).map((step) => ({
            id: step.id,
            label: step.label,
            // A persisted step can never resume: a step left running belongs to
            // an unfinished execution and is shown as cancelled, not "live".
            status: step.status === "running" ? ("cancelled" as const) : step.status,
            durationMs: step.durationMs,
            ...(step.summary ? { summary: step.summary } : {}),
          })),
        }
      : {}),
    ...(response.presentation ? { presentation: response.presentation } : {}),
    ...(response.resultRefs?.length
      ? { resultRefs: response.resultRefs.slice(0, CONVERSATION_ARTIFACT_LIMIT) }
      : {}),
    ...(response.factRefs?.length ? { factRefs: response.factRefs.slice(0, 80) } : {}),
    ...(response.requestId ? { requestId: response.requestId } : {}),
    ...(response.usage ? { usage: response.usage } : {}),
  };
  const parsed = chatResponseSnapshotSchema.safeParse(snapshot);
  if (!parsed.success)
    throw new ConversationError(400, "INVALID_SNAPSHOT", "分析结果格式不完整，无法写入历史。");
  const bytes = Buffer.byteLength(JSON.stringify(parsed.data), "utf8");
  if (bytes > CONVERSATION_SNAPSHOT_BYTE_LIMIT)
    throw new ConversationError(
      413,
      "CONVERSATION_RESULT_TOO_LARGE",
      "分析结果超出单条历史消息上限，请缩小统计范围后重试。",
    );
  return parsed.data;
}

function sanitizeArtifact(artifact: ChatArtifact | null | undefined): ChatArtifact | null {
  if (!artifact) return null;
  if (artifact.kind === "analysis") {
    // Raw SQL can contain paths and data identifiers. Keep the required string
    // field empty rather than deleting it: history exports and result views
    // still read `result.query` and must not crash on a restored snapshot.
    const result: AnalysisResult = { ...artifact.result, query: "" };
    return {
      kind: "analysis",
      plan: artifact.plan,
      result,
      view: artifact.view,
    };
  }
  if (artifact.kind === "studio")
    return {
      kind: "studio",
      tool: artifact.tool,
      table: artifact.table,
      ...(artifact.densityMode ? { densityMode: artifact.densityMode } : {}),
      term: artifact.term,
      ...(artifact.comparisonTerm ? { comparisonTerm: artifact.comparisonTerm } : {}),
      view: artifact.view,
      ...(artifact.courses ? { courses: artifact.courses } : {}),
      ...(artifact.datasetId ? { datasetId: artifact.datasetId } : {}),
      ...(artifact.datasetVersion ? { datasetVersion: artifact.datasetVersion } : {}),
      ...(artifact.datasetName ? { datasetName: artifact.datasetName } : {}),
    };
  if (artifact.kind === "relations")
    return { kind: "relations", data: artifact.data, course: artifact.course, view: artifact.view };
  if (artifact.kind === "panorama")
    return { kind: "panorama", data: artifact.data, view: artifact.view };
  return {
    kind: "distribution",
    data: artifact.data,
    course: artifact.course,
    term: artifact.term,
    binWidth: artifact.binWidth,
    view: artifact.view,
  };
}

export function createConversation(
  ownerId: string,
  input: CreateConversationInput,
): ConversationSummary {
  const now = input.now ?? new Date();
  return mutateBucket(ownerId, (bucket) => {
    const live = bucket.conversations.filter((conversation) => !isExpired(conversation, now));
    bucket.conversations = live;
    if (live.length >= CONVERSATION_MAX_PER_OWNER)
      throw new ConversationError(
        409,
        "CONVERSATION_LIMIT",
        "历史对话数量已达上限，请先删除不再需要的会话。",
      );
    const conversation: StoredConversation = {
      version: CONVERSATION_STORAGE_VERSION,
      id: randomUUID(),
      ownerId,
      title: normalizeTitle(input.title ?? CONVERSATION_DEFAULT_TITLE),
      datasetId: input.datasetId,
      createdAt: nowIso(now),
      updatedAt: nowIso(now),
      expiresAt: expiryFrom(now),
      revision: 0,
      messages: [],
      turns: [],
    };
    bucket.conversations.push(conversation);
    return summary(conversation, now);
  });
}

function encodeCursor(conversation: StoredConversation): string {
  return Buffer.from(
    JSON.stringify({ u: conversation.updatedAt, i: conversation.id }),
    "utf8",
  ).toString("base64url");
}

function decodeCursor(cursor: string): { u: string; i: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ConversationError(400, "INVALID_CURSOR", "历史对话分页位置无效，请重新加载。");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as { u?: unknown }).u !== "string" ||
    typeof (parsed as { i?: unknown }).i !== "string" ||
    !Number.isFinite(Date.parse((parsed as { u: string }).u))
  )
    throw new ConversationError(400, "INVALID_CURSOR", "历史对话分页位置无效，请重新加载。");
  return parsed as { u: string; i: string };
}

export function listConversations(
  ownerId: string,
  options: ListConversationsOptions = {},
): ConversationPage {
  const now = options.now ?? new Date();
  const limit = options.limit ?? CONVERSATION_PAGE_DEFAULT;
  if (!Number.isInteger(limit) || limit < 1 || limit > CONVERSATION_PAGE_MAX)
    throw new ConversationError(400, "INVALID_INPUT", `每页数量需为 1–${CONVERSATION_PAGE_MAX}。`);
  const bucket = readBucket(ownerId);
  const allowed = options.datasetIds ? new Set(options.datasetIds) : null;
  let items = bucket.conversations
    .filter((conversation) => !isExpired(conversation, now))
    .filter((conversation) => !allowed || allowed.has(conversation.datasetId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  if (options.cursor) {
    const cursor = decodeCursor(options.cursor);
    items = items.filter(
      (item) => item.updatedAt < cursor.u || (item.updatedAt === cursor.u && item.id < cursor.i),
    );
  }
  const page = items.slice(0, limit);
  return {
    conversations: page.map((conversation) => summary(conversation, now)),
    nextCursor: items.length > limit ? encodeCursor(page[page.length - 1]) : null,
  };
}

export function getConversation(
  ownerId: string,
  conversationId: string,
  options: { now?: Date } = {},
): ConversationDetail {
  const id = assertUuid(conversationId, "会话 ID");
  const now = options.now ?? new Date();
  const bucket = readBucket(ownerId);
  return detail(findConversation(bucket, id, now), now);
}

export function deleteConversation(
  ownerId: string,
  conversationId: string,
  options: { now?: Date } = {},
): { deleted: true } {
  // Repeated deletion is idempotent and cannot distinguish a foreign id.
  let id: string;
  try {
    id = assertUuid(conversationId, "会话 ID");
  } catch {
    return { deleted: true };
  }
  mutateBucket(ownerId, (bucket) => {
    bucket.conversations = bucket.conversations.filter((item) => item.id !== id);
  });
  return { deleted: true };
}

/**
 * Read-only liveness gate for a worker that is executing a claimed turn.
 *
 * Called periodically between analysis steps (and before writing a result).
 * It never takes the bucket write lock and never renews the conversation, so
 * polling cannot extend retention or resurrect a stopped/deleted turn.
 */
export function assertTurnActive(
  ownerId: string,
  claim: Pick<TurnClaim, "conversationId" | "turnId" | "revision">,
  options: { now?: Date; datasetId?: DataSource } = {},
): { conversation: ConversationSummary; turn: StoredConversationTurn } {
  const now = options.now ?? new Date();
  const bucket = readBucket(ownerId);
  const conversation = findConversation(bucket, assertUuid(claim.conversationId, "会话 ID"), now);
  const turn = conversation.turns.find((item) => item.id === assertUuid(claim.turnId, "轮次 ID"));
  if (!turn)
    throw new ConversationError(404, "TURN_NOT_FOUND", "这一轮分析已被清理，结果不会写回。");
  if (turn.revision !== claim.revision)
    throw new ConversationError(
      409,
      "REVISION_CONFLICT",
      "这一轮分析已被新的轮次取代，迟到的结果不会写回。",
      { revision: conversation.revision },
    );
  if (options.datasetId && options.datasetId !== conversation.datasetId)
    throw new ConversationError(403, "DATASET_FORBIDDEN", "当前请求的数据集与这段对话不一致。");
  // Re-read the durable account and grants: a history record never by itself
  // keeps AI access alive. Trusted CLI calls have no HTTP access scope (no-op).
  assertCurrentAccess(conversation.datasetId, "ai");
  const status = effectiveStatus(turn, now);
  if (status === "cancelled")
    throw new ConversationError(409, "TURN_STOPPED", "这一轮分析已停止，不会再写回结果。");
  if (status === "interrupted")
    throw new ConversationError(409, "TURN_INTERRUPTED", "这一轮分析已中断，不会再写回结果。");
  if (status !== "running")
    throw new ConversationError(409, "TURN_FINISHED", "这一轮分析已经结束。");
  return { conversation: summary(conversation, now), turn };
}

function assertLeaseAcceptable(turn: StoredConversationTurn, now: Date): void {
  if (turn.status !== "running") return;
  if (now.getTime() >= Date.parse(turn.leaseExpiresAt))
    throw new ConversationError(
      409,
      "TURN_LEASE_EXPIRED",
      "本轮分析租约已过期，迟到的结果不能写回历史。",
    );
}

export function claimTurn(ownerId: string, input: ClaimTurnInput): ClaimTurnResult {
  const now = input.now ?? new Date();
  const turnId = assertUuid(input.turnId, "轮次 ID");
  const question = input.question.trim();
  if (question.length < 2 || question.length > 500)
    throw new ConversationError(400, "INVALID_QUESTION", "问题需为 2–500 个字符。");
  const digest = inputDigest({
    question,
    datasetId: input.datasetId,
    resetContext: input.resetContext,
  });

  return mutateBucket(ownerId, (bucket) => {
    bucket.conversations = bucket.conversations.filter(
      (conversation) => !isExpired(conversation, now),
    );
    // A client turn id belongs to exactly one conversation in this account.
    // Reusing it to target a different conversation is a retry/cross-window
    // mix-up, never a second execution.
    const turnOwner = bucket.conversations.find((candidate) =>
      candidate.turns.some((turn) => turn.id === turnId),
    );
    if (turnOwner && turnOwner.id !== input.conversationId?.toLowerCase())
      throw new ConversationError(
        409,
        "TURN_CONFLICT",
        "这个轮次 ID 已属于另一段对话，请刷新后再发送。",
        { conversationId: turnOwner.id },
      );
    let conversation: StoredConversation;
    if (input.conversationId) {
      conversation = findConversation(bucket, assertUuid(input.conversationId, "会话 ID"), now);
      if (input.expectedRevision === undefined)
        throw new ConversationError(
          400,
          "EXPECTED_REVISION_REQUIRED",
          "继续对话需要提交当前会话修订号。",
        );
    } else {
      if (input.expectedRevision !== undefined && input.expectedRevision !== 0)
        throw new ConversationError(400, "INVALID_INPUT", "新建对话的修订号应为 0。");
      if (bucket.conversations.length >= CONVERSATION_MAX_PER_OWNER)
        throw new ConversationError(
          409,
          "CONVERSATION_LIMIT",
          "历史对话数量已达上限，请先删除不再需要的会话。",
        );
      conversation = {
        version: CONVERSATION_STORAGE_VERSION,
        id: randomUUID(),
        ownerId,
        title: normalizeTitle(input.title ?? titleFromQuestion(question)),
        datasetId: input.datasetId,
        createdAt: nowIso(now),
        updatedAt: nowIso(now),
        expiresAt: expiryFrom(now),
        revision: 0,
        messages: [],
        turns: [],
      };
      bucket.conversations.push(conversation);
    }
    if (conversation.datasetId !== input.datasetId)
      throw new ConversationError(
        409,
        "DATASET_MISMATCH",
        "会话绑定的是另一个数据集，请新建对话后再提问。",
      );

    const existing = conversation.turns.find((turn) => turn.id === turnId);
    if (existing) {
      if (existing.inputDigest !== digest)
        throw new ConversationError(
          409,
          "TURN_CONFLICT",
          "这个轮次 ID 已用于另一个问题，请刷新后重试。",
        );
      // A replay is a read of this turn: it never renews, and it never rewrites
      // a state that cleanup/the state gate will finalize on its own.
      const before = existing.revision;
      return {
        conversation: summary(conversation, now),
        history: existing.resetContext ? [] : historyFrom(conversation, before),
        context: existing.resetContext ? null : contextFrom(conversation, before),
        claim: {
          conversationId: conversation.id,
          turnId: existing.id,
          revision: existing.revision,
          inputDigest: existing.inputDigest,
          leaseExpiresAt: existing.leaseExpiresAt,
          replayed: true,
        },
        existing: {
          status: effectiveStatus(existing, now),
          ...(existing.response ? { response: existing.response } : {}),
          ...(existing.error ? { error: existing.error } : {}),
        },
      };
    }

    const active = conversation.turns.find(
      (turn) => turn.status === "running" && effectiveStatus(turn, now) === "running",
    );
    if (active) {
      // Rejecting a second window is not a stop: the running worker keeps its
      // lease and will save its own result. This is checked before the revision
      // so a concurrent sender gets an actionable "wait or stop" state.
      throw new ConversationError(
        409,
        "TURN_IN_PROGRESS",
        "这个会话还有一轮分析在进行，请等待或先停止。",
        { turnId: active.id },
      );
    }

    if (input.expectedRevision !== undefined && input.expectedRevision !== conversation.revision)
      throw new ConversationError(
        409,
        "REVISION_CONFLICT",
        "会话已在另一个窗口更新，请刷新历史后再发送。",
        { revision: conversation.revision },
      );
    // Finalize any dead/expired running turns before starting a new one.
    for (const turn of conversation.turns) markInterrupted(conversation, turn, now);

    if (conversation.turns.length >= CONVERSATION_MAX_TURNS)
      throw new ConversationError(409, "CONVERSATION_FULL", "这段对话已很长，请新建对话继续提问。");

    const revision = conversation.revision + 1;
    const at = nowIso(now);
    const turn: StoredConversationTurn = {
      id: turnId,
      question,
      inputDigest: digest,
      resetContext: input.resetContext === true,
      status: "running",
      revision,
      createdAt: at,
      updatedAt: at,
      claimedAt: at,
      leaseExpiresAt: new Date(now.getTime() + CONVERSATION_TURN_LEASE_MS).toISOString(),
      leaseOwner: currentLeaseOwner(),
    };
    conversation.revision = revision;
    conversation.turns.push(turn);
    conversation.messages.push({
      id: randomUUID(),
      turnId,
      role: "user",
      content: question,
      createdAt: at,
      datasetId: conversation.datasetId,
    });
    conversation.updatedAt = at;
    conversation.expiresAt = expiryFrom(now);
    if (conversation.turns.length === 1)
      conversation.title = normalizeTitle(input.title ?? titleFromQuestion(question));
    trimConversation(conversation);

    return {
      conversation: summary(conversation, now),
      history: turn.resetContext ? [] : historyFrom(conversation, revision),
      context: turn.resetContext ? null : contextFrom(conversation, revision),
      claim: {
        conversationId: conversation.id,
        turnId,
        revision,
        inputDigest: digest,
        leaseExpiresAt: turn.leaseExpiresAt,
        replayed: false,
      },
    };
  });
}

function terminalTurn(
  conversation: StoredConversation,
  turnId: string,
  revision: number,
): StoredConversationTurn {
  const turn = conversation.turns.find((item) => item.id === turnId);
  if (!turn) throw new ConversationError(404, "TURN_NOT_FOUND", "找不到这一轮分析，可能已被清理。");
  if (turn.revision !== revision)
    throw new ConversationError(409, "REVISION_CONFLICT", "这一轮分析已更新或已被新的轮次取代。", {
      revision: conversation.revision,
    });
  return turn;
}

export function finishTurn(ownerId: string, input: FinishTurnInput): FinishTurnResult {
  const now = input.now ?? new Date();
  const turnId = assertUuid(input.turnId, "轮次 ID");
  const response = snapshotResponse(input.response, input.status, now);
  return mutateBucket(ownerId, (bucket) => {
    const conversation = findConversation(bucket, assertUuid(input.conversationId, "会话 ID"), now);
    const turn = terminalTurn(conversation, turnId, input.revision);
    if (turn.status !== "running") {
      const message = conversation.messages.find(
        (item) => item.turnId === turn.id && item.role === "assistant",
      );
      // Only the exact already-committed success is a valid idempotent retry.
      // A cancelled/failed/interrupted turn must never report a late success,
      // even though its revision still matches.
      // A retry may legitimately omit/recompute `generatedAt`; what matters is
      // that the committed terminal state is still a successful result. The
      // stored snapshot is returned and is never overwritten by the late call.
      if (message && turn.response && (turn.status === "completed" || turn.status === "partial"))
        return { conversation: summary(conversation, now), message, turn, replayed: true };
      if (turn.status === "cancelled" || turn.status === "interrupted")
        throw new ConversationError(
          409,
          turn.status === "cancelled" ? "TURN_STOPPED" : "TURN_INTERRUPTED",
          "这一轮分析已停止或中断，迟到的结果不会被写入历史。",
        );
      if (turn.status === "failed")
        throw new ConversationError(
          409,
          "TURN_FAILED",
          "这一轮分析已失败，迟到的结果不会被写入历史。",
        );
      throw new ConversationError(
        409,
        "TURN_ALREADY_FINISHED",
        "这一轮分析已经以另一个结果结束，不能再覆盖。",
      );
    }
    assertLeaseAcceptable(turn, now);
    const at = nowIso(now);
    const message: StoredConversationMessage = {
      id: randomUUID(),
      turnId: turn.id,
      role: "assistant",
      content: trimText(response.answer, CONVERSATION_ANSWER_LIMIT),
      createdAt: at,
      datasetId: conversation.datasetId,
      ...(compactResults(response) ? { results: compactResults(response) } : {}),
      response,
    };
    turn.status = response.status;
    turn.response = response;
    turn.updatedAt = at;
    turn.completedAt = at;
    conversation.messages.push(message);
    conversation.updatedAt = at;
    conversation.expiresAt = expiryFrom(now);
    trimConversation(conversation);
    return { conversation: summary(conversation, now), message, turn, replayed: false };
  });
}

export function failTurn(ownerId: string, input: FailTurnInput): FailTurnResult {
  const now = input.now ?? new Date();
  const turnId = assertUuid(input.turnId, "轮次 ID");
  return mutateBucket(ownerId, (bucket) => {
    const conversation = findConversation(bucket, assertUuid(input.conversationId, "会话 ID"), now);
    const turn = terminalTurn(conversation, turnId, input.revision);
    const message = conversation.messages.find(
      (item) => item.turnId === turn.id && item.role === "assistant",
    );
    if (turn.status !== "running") {
      if (turn.status === input.status && message && !turn.response)
        return { conversation: summary(conversation, now), message, turn, replayed: true };
      throw new ConversationError(
        409,
        "TURN_ALREADY_FINISHED",
        "这一轮分析已经结束，不能再用迟到的状态覆盖。",
      );
    }
    const at = nowIso(now);
    const error = input.error ?? {
      code: input.status === "cancelled" ? "TURN_STOPPED" : "TURN_FAILED",
      message: statusMessage(input.status),
    };
    const assistant: StoredConversationMessage = {
      id: randomUUID(),
      turnId: turn.id,
      role: "assistant",
      content: trimText(statusMessage(input.status), CONVERSATION_ANSWER_LIMIT),
      createdAt: at,
      datasetId: conversation.datasetId,
    };
    turn.status = input.status;
    turn.error = { code: trimText(error.code, 100), message: trimText(error.message, 500) };
    turn.updatedAt = at;
    turn.completedAt = at;
    conversation.messages.push(assistant);
    conversation.updatedAt = at;
    // A terminal failure/save message is a real update and renews once.
    conversation.expiresAt = expiryFrom(now);
    return {
      conversation: summary(conversation, now),
      message: assistant,
      turn,
      replayed: false,
    };
  });
}

export function stopTurn(
  ownerId: string,
  conversationId: string,
  input: StopTurnInput,
): StopTurnResult {
  const now = input.now ?? new Date();
  const turnId = assertUuid(input.turnId, "轮次 ID");
  return mutateBucket(ownerId, (bucket) => {
    const conversation = findConversation(bucket, assertUuid(conversationId, "会话 ID"), now);
    const turn = conversation.turns.find((item) => item.id === turnId);
    // Stop is a safety control: retries, a lost response, or a turn already
    // removed by cleanup must succeed as "nothing left to stop", never 404.
    if (!turn) return { conversation: summary(conversation, now), turn: null, idle: true };
    if (input.revision !== undefined && input.revision !== turn.revision)
      throw new ConversationError(409, "REVISION_CONFLICT", "轮次修订号不匹配，请刷新后再停止。");
    if (turn.status !== "running")
      return { conversation: summary(conversation, now), turn, idle: true };

    const at = nowIso(now);
    turn.status = "cancelled";
    turn.updatedAt = at;
    turn.completedAt = at;
    turn.error = { code: "TURN_STOPPED", message: statusMessage("cancelled") };
    conversation.messages.push({
      id: randomUUID(),
      turnId: turn.id,
      role: "assistant",
      content: statusMessage("cancelled"),
      createdAt: at,
      datasetId: conversation.datasetId,
    });
    conversation.updatedAt = at;
    conversation.expiresAt = expiryFrom(now);
    return { conversation: summary(conversation, now), turn, idle: false };
  });
}

/**
 * Background retention pass. Never runs inside a request's AI execution and
 * never revives a conversation: expired ids are removed, dead running turns
 * become interrupted with one terminal assistant message.
 */
export function cleanupConversations(now: Date = new Date()): {
  scanned: number;
  removed: number;
  interrupted: number;
} {
  const directory = resolve(getStateDirectory(), "conversations");
  if (!existsSync(directory)) return { scanned: 0, removed: 0, interrupted: 0 };
  const files = readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
  let scanned = 0;
  let removed = 0;
  let interrupted = 0;
  for (const file of files) {
    let bucket: Bucket;
    try {
      bucket = readBucketByFile(file);
    } catch {
      // A damaged bucket is surfaced on access; cleanup must not delete it or
      // reset it to empty, which would silently destroy account history.
      continue;
    }
    scanned += 1;
    const remaining = bucket.conversations.filter((conversation) => !isExpired(conversation, now));
    removed += bucket.conversations.length - remaining.length;
    let changed = bucket.conversations.length !== remaining.length;
    for (const conversation of remaining) {
      for (const turn of conversation.turns) {
        if (markInterrupted(conversation, turn, now)) {
          interrupted += 1;
          changed = true;
        }
      }
    }
    if (!changed) continue;
    mutateBucket(bucket.ownerId, (current) => {
      current.conversations = current.conversations.filter(
        (conversation) => !isExpired(conversation, now),
      );
      for (const conversation of current.conversations)
        for (const turn of conversation.turns) markInterrupted(conversation, turn, now);
    });
  }
  return { scanned, removed, interrupted };
}

function readBucketByFile(file: string): Bucket {
  const raw = readState<unknown>(`conversations/${file}`, () => emptyBucket(""));
  const parsed = conversationBucketSchema.safeParse(raw);
  if (!parsed.success || !parsed.data.ownerId) throw corrupt();
  assertBucketOwnership(parsed.data);
  return parsed.data;
}
