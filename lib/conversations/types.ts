import { z } from "zod";
import { datasetIdSchema } from "../datasets/id";
import { chatIntentSchema, chatHistoryResultSchema } from "../ai/chat-types";
import {
  analysisStepSchema,
  chatResponseArtifactSchema,
  factRefSchema,
  knowledgeCitationSchema,
  resultRefSchema,
} from "./schema";
import type { DataSource } from "../analysis/types";
import type {
  AnalysisStep,
  ChatArtifact,
  ChatIntent,
  ChatMessage,
  ChatResponse,
  KnowledgeCitation,
} from "../ai/chat-types";
import type { FactRef, ResultRef } from "../ai/result-contract";
import type { RequestUsage } from "../security/ai-cost";

/**
 * Durable conversation history contract.
 *
 * This module is server-only: it imports the chat result types but never the
 * model/tool runtime. A stored response is an allowlisted snapshot of a result
 * that was already computed; it is not a second analysis state machine.
 */
export const CONVERSATION_STORAGE_VERSION = 1 as const;
export const CONVERSATION_RETENTION_MS = 10 * 24 * 60 * 60 * 1000;
/**
 * Long enough to cover the maximum analysis timeout (120 s) plus the client's
 * five-minute persistence-retry window. A dead process is detected by identity
 * before the lease expires, so this value is a safety net, not a wait.
 */
export const CONVERSATION_TURN_LEASE_MS = 10 * 60 * 1000;
export const CONVERSATION_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
export const CONVERSATION_HISTORY_LIMIT = 12;
export const CONVERSATION_HISTORY_MESSAGE_LIMIT = 3_000;
export const CONVERSATION_HISTORY_CHARACTER_LIMIT = 24_000;
export const CONVERSATION_RESULT_HISTORY_LIMIT = 4;
export const CONVERSATION_RESULT_LABEL_LIMIT = 200;
export const CONVERSATION_ANSWER_LIMIT = 60_000;
export const CONVERSATION_FACT_LIMIT = 40;
export const CONVERSATION_ARTIFACT_LIMIT = 8;
export const CONVERSATION_PAGE_DEFAULT = 20;
export const CONVERSATION_PAGE_MAX = 50;
export const CONVERSATION_MAX_TURNS = 40;
export const CONVERSATION_MAX_MESSAGES = CONVERSATION_MAX_TURNS * 2;
export const CONVERSATION_MAX_PER_OWNER = 50;
export const CONVERSATION_SNAPSHOT_BYTE_LIMIT = 512 * 1024;
export const CONVERSATION_BUCKET_BYTE_LIMIT = 12 * 1024 * 1024;
export const CONVERSATION_DEFAULT_TITLE = "新对话";

export const turnStatusSchema = z.enum([
  "running",
  "completed",
  "partial",
  "failed",
  "cancelled",
  "interrupted",
]);
export type TurnStatus = z.infer<typeof turnStatusSchema>;
export type TerminalTurnStatus = Exclude<TurnStatus, "running">;

export type ChatResponseSnapshot = {
  /** Result-snapshot contract version, independent from the storage layout. */
  version: 1;
  status: TerminalTurnStatus;
  generatedAt: string;
  completion?: ChatResponse["completion"];
  failureCode?: string;
  answer: string;
  kind: ChatResponse["kind"];
  facts: string[];
  suggestions: string[];
  context: ChatIntent | null;
  planning: ChatResponse["planning"];
  warning?: string;
  artifacts?: ChatArtifact[];
  artifact: ChatArtifact | null;
  citations?: KnowledgeCitation[];
  steps?: AnalysisStep[];
  presentation?: ChatResponse["presentation"];
  resultRefs?: ResultRef[];
  factRefs?: FactRef[];
  requestId?: string;
  usage?: RequestUsage;
};

/** Stored failure payload. Distinct from the thrown `ConversationError`. */
export type ConversationFailure = { code: string; message: string };

export type StoredConversationTurn = {
  id: string;
  question: string;
  inputDigest: string;
  /** A reset turn starts from no prior messages/context, even when replayed. */
  resetContext: boolean;
  status: TurnStatus;
  /** Every question consumes one revision; terminal writes keep it. */
  revision: number;
  createdAt: string;
  updatedAt: string;
  claimedAt: string;
  leaseExpiresAt: string;
  /** Opaque process identity of the worker that holds the lease. */
  leaseOwner: string;
  completedAt?: string;
  response?: ChatResponseSnapshot;
  error?: ConversationFailure;
};

export type StoredConversationMessage = {
  id: string;
  turnId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  datasetId: DataSource;
  /** Compact names of results, never used as evidence. */
  results?: ChatMessage["results"];
  /** Allowlisted aggregate snapshot; present only on assistant messages. */
  response?: ChatResponseSnapshot;
};

export type StoredConversation = {
  version: typeof CONVERSATION_STORAGE_VERSION;
  id: string;
  ownerId: string;
  title: string;
  datasetId: DataSource;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revision: number;
  messages: StoredConversationMessage[];
  turns: StoredConversationTurn[];
};

export type ConversationSummary = {
  id: string;
  title: string;
  datasetId: DataSource;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  revision: number;
  messageCount: number;
  lastTurn: {
    id: string;
    status: TurnStatus;
    updatedAt: string;
    generatedAt?: string;
  } | null;
};

export type ConversationDetail = {
  conversation: ConversationSummary;
  messages: StoredConversationMessage[];
  turns: StoredConversationTurn[];
};

export type ConversationPage = {
  conversations: ConversationSummary[];
  nextCursor: string | null;
};

export type TurnClaim = {
  conversationId: string;
  turnId: string;
  /** Revision after the atomic user-message claim; finish/fail use this value. */
  revision: number;
  inputDigest: string;
  leaseExpiresAt: string;
  /** true for a same-turn, same-input replay; no message or renewal happened. */
  replayed: boolean;
};

export type ClaimTurnResult = {
  conversation: ConversationSummary;
  /** Claim-before snapshot; never includes the question being claimed. */
  history: ChatMessage[];
  context: ChatIntent | null;
  claim: TurnClaim;
  /** Present only for an idempotent replay of an existing turn. */
  existing?: {
    status: TurnStatus;
    response?: ChatResponseSnapshot;
    error?: ConversationFailure;
  };
};

export type FinishTurnResult = {
  conversation: ConversationSummary;
  message: StoredConversationMessage;
  turn: StoredConversationTurn;
  /** true when this exact terminal save had already committed. */
  replayed: boolean;
};

export type FailTurnResult = {
  conversation: ConversationSummary;
  message: StoredConversationMessage;
  turn: StoredConversationTurn;
  replayed: boolean;
};

export type StopTurnResult = {
  conversation: ConversationSummary;
  turn: StoredConversationTurn | null;
  /** true when no running turn needed to be stopped. */
  idle: boolean;
};

export type ConversationId = string;

export type CreateConversationInput = {
  datasetId: DataSource;
  title?: string;
  now?: Date;
};

export type ListConversationsOptions = {
  cursor?: string | null;
  limit?: number;
  /** Hide conversations outside the caller's current dataset grants. */
  datasetIds?: DataSource[];
  now?: Date;
};

export type ClaimTurnInput = {
  /** Omit to atomically create a conversation for this first turn. */
  conversationId?: ConversationId;
  /** Bound to question + dataset + resetContext for idempotency. */
  turnId: string;
  question: string;
  datasetId: DataSource;
  /** Required for an existing conversation; ignored for a new conversation. */
  expectedRevision?: number;
  resetContext?: boolean;
  title?: string;
  now?: Date;
};

export type FinishTurnInput = {
  conversationId: ConversationId;
  turnId: string;
  revision: number;
  /** Raw ChatResponse; the repository strips disallowed fields before storing. */
  response: ChatResponse;
  status?: TerminalTurnStatus;
  now?: Date;
};

export type FailTurnInput = {
  conversationId: ConversationId;
  turnId: string;
  revision: number;
  status: "failed" | "cancelled" | "interrupted";
  error?: ConversationFailure;
  now?: Date;
};

export type StopTurnInput = {
  turnId: string;
  revision?: number;
  now?: Date;
};

export class ConversationError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ConversationError";
  }
}

const isoDateSchema = z.string().datetime({ offset: true });
const uuidSchema = z.string().uuid();

export const conversationFailureSchema = z.object({
  code: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(500),
});
export const conversationContextSchema = chatIntentSchema.nullable();
export const conversationHistorySchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(CONVERSATION_HISTORY_MESSAGE_LIMIT),
  results: z.array(chatHistoryResultSchema).max(CONVERSATION_RESULT_HISTORY_LIMIT).optional(),
});

export const conversationSummarySchema = z.object({
  id: uuidSchema,
  title: z.string().trim().min(1).max(120),
  datasetId: datasetIdSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  expiresAt: isoDateSchema,
  revision: z.number().int().min(0),
  messageCount: z.number().int().min(0),
  lastTurn: z
    .object({
      id: uuidSchema,
      status: turnStatusSchema,
      updatedAt: isoDateSchema,
      generatedAt: isoDateSchema.optional(),
    })
    .nullable(),
});
export type ConversationSummaryInput = z.infer<typeof conversationSummarySchema>;

export const chatResponseSnapshotSchema = z.object({
  version: z.literal(1),
  status: z.enum(["completed", "partial", "failed", "cancelled", "interrupted"]),
  generatedAt: isoDateSchema,
  completion: z.enum(["complete", "partial"]).optional(),
  failureCode: z.string().max(100).optional(),
  answer: z.string().max(CONVERSATION_ANSWER_LIMIT),
  kind: z.enum(["answer", "clarification", "result"]),
  facts: z.array(z.string().max(4_000)).max(CONVERSATION_FACT_LIMIT),
  suggestions: z.array(z.string().max(500)).max(20),
  context: conversationContextSchema,
  planning: z.object({
    source: z.enum(["golden_case", "local", "openai", "external"]),
    rationale: z.string().max(4_000),
    model: z.string().max(200).nullable(),
  }),
  warning: z.string().max(2_000).optional(),
  artifacts: z.array(chatResponseArtifactSchema).max(CONVERSATION_ARTIFACT_LIMIT).optional(),
  artifact: chatResponseArtifactSchema.nullable(),
  citations: z.array(knowledgeCitationSchema).max(20).optional(),
  steps: z.array(analysisStepSchema).max(100).optional(),
  presentation: z.enum(["text", "chart", "table"]).optional(),
  resultRefs: z.array(resultRefSchema).max(CONVERSATION_ARTIFACT_LIMIT).optional(),
  factRefs: z
    .array(factRefSchema)
    .max(CONVERSATION_FACT_LIMIT * 2)
    .optional(),
  requestId: uuidSchema.optional(),
  usage: z
    .object({
      modelCalls: z.number().int().nonnegative(),
      promptTokens: z.number().int().nonnegative(),
      completionTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      costUsd: z.number().nonnegative(),
      estimated: z.boolean(),
    })
    .optional(),
});
export type ChatResponseSnapshotInput = z.infer<typeof chatResponseSnapshotSchema>;

export const storedConversationMessageSchema = z.object({
  id: uuidSchema,
  turnId: uuidSchema,
  role: z.enum(["user", "assistant"]),
  content: z.string().max(CONVERSATION_ANSWER_LIMIT),
  createdAt: isoDateSchema,
  datasetId: datasetIdSchema,
  results: z.array(chatHistoryResultSchema).max(CONVERSATION_RESULT_HISTORY_LIMIT).optional(),
  response: chatResponseSnapshotSchema.optional(),
});

export const storedConversationTurnSchema = z.object({
  id: uuidSchema,
  question: z.string().trim().min(2).max(500),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
  resetContext: z.boolean(),
  status: turnStatusSchema,
  revision: z.number().int().positive(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  claimedAt: isoDateSchema,
  leaseExpiresAt: isoDateSchema,
  leaseOwner: z.string().min(1).max(300),
  completedAt: isoDateSchema.optional(),
  response: chatResponseSnapshotSchema.optional(),
  error: conversationFailureSchema.optional(),
});

export const conversationSchema = z.object({
  version: z.literal(CONVERSATION_STORAGE_VERSION),
  id: uuidSchema,
  ownerId: z.string().min(1).max(200),
  title: z.string().trim().min(1).max(120),
  datasetId: datasetIdSchema,
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  expiresAt: isoDateSchema,
  revision: z.number().int().nonnegative(),
  messages: z.array(storedConversationMessageSchema).max(CONVERSATION_MAX_MESSAGES),
  turns: z.array(storedConversationTurnSchema).max(CONVERSATION_MAX_TURNS),
});

export const conversationBucketSchema = z.object({
  version: z.literal(CONVERSATION_STORAGE_VERSION),
  ownerId: z.string().min(1).max(200),
  conversations: z.array(conversationSchema).max(CONVERSATION_MAX_PER_OWNER),
});
