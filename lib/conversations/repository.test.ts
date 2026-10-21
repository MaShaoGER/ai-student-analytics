import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertTurnActive,
  claimTurn,
  cleanupConversations,
  createConversation,
  deleteConversation,
  failTurn,
  finishTurn,
  getConversation,
  listConversations,
  snapshotResponse,
  stopTurn,
} from "./repository";
import { CONVERSATION_RETENTION_MS, ConversationError, type ChatResponseSnapshot } from "./types";
import type { ChatResponse } from "../ai/chat-types";

const T0 = new Date("2026-10-20T08:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const OWNER = "fixture-owner-a";
const OTHER = "fixture-owner-b";

let directory = "";

function response(answer = "结果", extra: Partial<ChatResponse> = {}): ChatResponse {
  return {
    kind: "answer",
    answer,
    facts: [],
    suggestions: [],
    context: null,
    artifact: null,
    planning: { source: "local", rationale: "", model: null },
    ...extra,
  };
}

function claim(conversationId: string, turnId: string, overrides = {}) {
  return claimTurn(OWNER, {
    conversationId,
    turnId,
    question: "比较各课程平均成绩",
    datasetId: "demo",
    expectedRevision: 0,
    now: T0,
    ...overrides,
  });
}

function bucketPath(owner: string) {
  return join(
    directory,
    "conversations",
    `${createHash("sha256").update(owner).digest("hex")}.json`,
  );
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "conversation-repo-"));
  process.env.APP_STATE_DIR = directory;
});
afterEach(() => {
  delete process.env.APP_STATE_DIR;
  rmSync(directory, { recursive: true, force: true });
});

describe("conversation claim, save and identity", () => {
  it("creates a conversation atomically with its first turn and bounded history", () => {
    const result = claimTurn(OWNER, {
      turnId: "11111111-1111-4111-8111-111111111111",
      question: "第一问：各课程平均成绩",
      datasetId: "demo",
      now: T0,
    });
    expect(result.claim.replayed).toBe(false);
    expect(result.history).toEqual([]);
    expect(result.context).toBeNull();
    expect(result.conversation.title).toContain("第一问");
    expect(result.conversation.revision).toBe(1);
  });

  it("returns a claim-before history that excludes the new question", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const first = claim(created.id, "22222222-2222-4222-8222-222222222222");
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId: first.claim.turnId,
      revision: first.claim.revision,
      response: response("上一轮结论", {
        context: {
          kind: "analysis",
          metric: "score",
          dimension: "course",
          filters: [],
          sort: { by: "value", direction: "desc" },
          limit: 20,
          view: "bar",
        },
      }),
      now: at(1000),
    });
    const detail = getConversation(OWNER, created.id, { now: at(2000) });
    const next = claimTurn(OWNER, {
      conversationId: created.id,
      turnId: "33333333-3333-4333-8333-333333333333",
      question: "这些课程里最低的是哪门？",
      datasetId: "demo",
      expectedRevision: detail.conversation.revision,
      now: at(3000),
    });
    expect(next.history.map((message) => message.content)).not.toContain(
      "这些课程里最低的是哪门？",
    );
    expect(next.history.at(-1)).toMatchObject({ role: "assistant", content: "上一轮结论" });
    expect(next.context).toMatchObject({ metric: "score", dimension: "course" });
  });

  it("replays the same turn id + input without duplicating messages", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turnId = "44444444-4444-4444-8444-444444444444";
    const first = claim(created.id, turnId);
    const replay = claimTurn(OWNER, {
      conversationId: created.id,
      turnId,
      question: "比较各课程平均成绩",
      datasetId: "demo",
      // A stale revision must not turn a replay into a second paid analysis.
      expectedRevision: 99,
      now: at(1000),
    });
    expect(replay.claim.replayed).toBe(true);
    expect(replay.claim.revision).toBe(first.claim.revision);
    expect(getConversation(OWNER, created.id).messages).toHaveLength(1);
  });

  it("does not resurrect history or context across an explicit reset", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const old = claim(created.id, "60606060-6060-4060-8060-606060606060");
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId: old.claim.turnId,
      revision: old.claim.revision,
      response: response("旧的课程筛选结果", {
        context: {
          kind: "analysis",
          metric: "score",
          dimension: "course",
          filters: [{ field: "course", op: "eq", value: "数学" }],
          sort: { by: "value", direction: "desc" },
          limit: 20,
          view: "bar",
        },
      }),
      now: at(1000),
    });
    const reset = claimTurn(OWNER, {
      conversationId: created.id,
      turnId: "61616161-6161-4161-8161-616161616161",
      question: "重新开始，比较各课程平均成绩",
      datasetId: "demo",
      expectedRevision: 1,
      resetContext: true,
      now: at(2000),
    });
    expect(reset.history).toEqual([]);
    expect(reset.context).toBeNull();
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId: reset.claim.turnId,
      revision: reset.claim.revision,
      response: response("重置后的结果", { context: null }),
      now: at(3000),
    });
    const next = claimTurn(OWNER, {
      conversationId: created.id,
      turnId: "62626262-6262-4262-8262-626262626262",
      question: "那最低的是哪门？",
      datasetId: "demo",
      expectedRevision: 2,
      now: at(4000),
    });
    // Only the reset turn and later may appear; the old filter/context is gone.
    expect(next.history.map((message) => message.content)).toEqual([
      "重新开始，比较各课程平均成绩",
      "重置后的结果",
    ]);
    expect(next.context).toBeNull();
  });

  it("keeps the latest explicit null context instead of an older filter", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const first = claim(created.id, "63636363-6363-4363-8363-636363636363");
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId: first.claim.turnId,
      revision: first.claim.revision,
      response: response("有筛选", {
        context: {
          kind: "analysis",
          metric: "score",
          dimension: "course",
          filters: [],
          sort: { by: "value", direction: "desc" },
          limit: 20,
          view: "bar",
        },
      }),
      now: at(1000),
    });
    const cleared = claimTurn(OWNER, {
      conversationId: created.id,
      turnId: "64646464-6464-4464-8464-646464646464",
      question: "忽略之前的筛选，直接回答",
      datasetId: "demo",
      expectedRevision: 1,
      now: at(2000),
    });
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId: cleared.claim.turnId,
      revision: cleared.claim.revision,
      response: response("已清除", { context: null }),
      now: at(3000),
    });
    const next = claimTurn(OWNER, {
      conversationId: created.id,
      turnId: "65656565-6565-4565-8565-656565656565",
      question: "再问一个",
      datasetId: "demo",
      expectedRevision: 2,
      now: at(4000),
    });
    expect(next.context).toBeNull();
  });

  it("refuses to retarget the same turn id to another conversation", () => {
    const first = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const second = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turnId = "68686868-6868-4868-8868-686868686868";
    claim(first.id, turnId);
    expect(() =>
      claimTurn(OWNER, {
        conversationId: second.id,
        turnId,
        question: "比较各课程平均成绩",
        datasetId: "demo",
        expectedRevision: 0,
        now: at(1000),
      }),
    ).toThrow(expect.objectContaining({ code: "TURN_CONFLICT" }));
    expect(getConversation(OWNER, second.id, { now: at(1000) }).messages).toEqual([]);
  });

  it("rejects the same turn id with a different question", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turnId = "55555555-5555-4555-8555-555555555555";
    claim(created.id, turnId);
    expect(() =>
      claimTurn(OWNER, {
        conversationId: created.id,
        turnId,
        question: "一个完全不同的问题",
        datasetId: "demo",
        expectedRevision: 1,
        now: at(1000),
      }),
    ).toThrow(expect.objectContaining({ code: "TURN_CONFLICT" }));
  });

  it("binds the digest to resetContext and ignores the expected revision", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turnId = "66666666-6666-4666-8666-666666666666";
    claim(created.id, turnId);
    // resetContext is part of the input identity: reusing the turn id with a
    // different reset flag is a conflict, not a silent replay.
    expect(() =>
      claimTurn(OWNER, {
        conversationId: created.id,
        turnId,
        question: "比较各课程平均成绩",
        datasetId: "demo",
        expectedRevision: 1,
        resetContext: true,
        now: at(1000),
      }),
    ).toThrow(expect.objectContaining({ code: "TURN_CONFLICT" }));
    // Finish the original turn before starting the reset one.
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId,
      revision: 1,
      response: response("第一轮"),
      now: at(1100),
    });
    const reset = claimTurn(OWNER, {
      conversationId: created.id,
      turnId: "67676767-6767-4767-8767-676767676767",
      question: "从零开始比较各课程平均成绩",
      datasetId: "demo",
      expectedRevision: 1,
      resetContext: true,
      now: at(1200),
    });
    expect(reset.claim.replayed).toBe(false);
    expect(reset.history).toEqual([]);
    expect(reset.context).toBeNull();
  });
});

describe("revisions, concurrency and late results", () => {
  it("rejects a stale expected revision and a second concurrent turn", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    claim(created.id, "77777777-7777-4777-8777-777777777777");
    expect(() =>
      claimTurn(OWNER, {
        conversationId: created.id,
        turnId: "88888888-8888-4888-8888-888888888888",
        question: "第二个窗口同时提问",
        datasetId: "demo",
        expectedRevision: 1,
        now: at(1000),
      }),
    ).toThrow(expect.objectContaining({ code: "TURN_IN_PROGRESS" }));
    // The rejected attempt must not interrupt the worker that holds the lease.
    const detail = getConversation(OWNER, created.id, { now: at(2000) });
    expect(detail.turns[0].status).toBe("running");
  });

  it("does not let a late result revive a stopped turn", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "99999999-9999-4999-8999-999999999999");
    stopTurn(OWNER, created.id, { turnId: turn.claim.turnId, now: at(1000) });
    expect(() =>
      finishTurn(OWNER, {
        conversationId: created.id,
        turnId: turn.claim.turnId,
        revision: turn.claim.revision,
        response: response("迟到结果"),
        now: at(2000),
      }),
    ).toThrow(expect.objectContaining({ code: "TURN_STOPPED" }));
    const detail = getConversation(OWNER, created.id, { now: at(2000) });
    expect(detail.messages.some((message) => message.content === "迟到结果")).toBe(false);
    expect(detail.conversation).toMatchObject({ revision: 1 });
  });

  it("does not let a late result revive a deleted conversation", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    deleteConversation(OWNER, created.id);
    expect(() =>
      finishTurn(OWNER, {
        conversationId: created.id,
        turnId: turn.claim.turnId,
        revision: turn.claim.revision,
        response: response(),
        now: at(1000),
      }),
    ).toThrow(expect.objectContaining({ code: "CONVERSATION_UNAVAILABLE" }));
    expect(listConversations(OWNER, { now: at(1000) }).conversations).toEqual([]);
  });

  it("is idempotent for a repeated successful save and rejects a different terminal outcome", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const first = finishTurn(OWNER, {
      conversationId: created.id,
      turnId: turn.claim.turnId,
      revision: turn.claim.revision,
      response: response("已保存"),
      now: at(1000),
    });
    const again = finishTurn(OWNER, {
      conversationId: created.id,
      turnId: turn.claim.turnId,
      revision: turn.claim.revision,
      response: response("另一个时间戳的同一结果"),
      now: at(2000),
    });
    expect(first.replayed).toBe(false);
    expect(again.replayed).toBe(true);
    expect(getConversation(OWNER, created.id).messages).toHaveLength(2);

    const second = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const failed = claim(second.id, "cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    failTurn(OWNER, {
      conversationId: second.id,
      turnId: failed.claim.turnId,
      revision: failed.claim.revision,
      status: "cancelled",
      now: at(1000),
    });
    expect(() =>
      finishTurn(OWNER, {
        conversationId: second.id,
        turnId: failed.claim.turnId,
        revision: failed.claim.revision,
        response: response(),
        now: at(2000),
      }),
    ).toThrow(expect.objectContaining({ code: "TURN_STOPPED" }));
  });

  it("reports an unknown turn id as an idempotent no-op stop", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const stopped = stopTurn(OWNER, created.id, {
      turnId: "99999999-9999-4999-8999-999999999998",
      now: at(1000),
    });
    expect(stopped).toMatchObject({ idle: true, turn: null });
  });

  it("reports stop as idle when the turn already ended", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId: turn.claim.turnId,
      revision: turn.claim.revision,
      response: response(),
      now: at(1000),
    });
    const stopped = stopTurn(OWNER, created.id, { turnId: turn.claim.turnId, now: at(2000) });
    expect(stopped.idle).toBe(true);
    expect(stopped.turn?.status).toBe("completed");
  });

  it("writes one terminal assistant message for failures and renews exactly once", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
    const failed = failTurn(OWNER, {
      conversationId: created.id,
      turnId: turn.claim.turnId,
      revision: turn.claim.revision,
      status: "failed",
      now: at(HOUR),
    });
    expect(failed.message).toMatchObject({ role: "assistant" });
    const detail = getConversation(OWNER, created.id, { now: at(HOUR) });
    expect(detail.conversation.expiresAt).toBe(
      new Date(at(HOUR).getTime() + CONVERSATION_RETENTION_MS).toISOString(),
    );
  });
});

describe("retention boundary and renewal sources", () => {
  it("blocks access exactly at ten days and keeps it just before", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const justBefore = new Date(T0.getTime() + CONVERSATION_RETENTION_MS - 1);
    expect(getConversation(OWNER, created.id, { now: justBefore }).conversation.id).toBe(
      created.id,
    );
    expect(() =>
      getConversation(OWNER, created.id, { now: at(CONVERSATION_RETENTION_MS) }),
    ).toThrow(expect.objectContaining({ code: "CONVERSATION_UNAVAILABLE" }));
    expect(listConversations(OWNER, { now: at(CONVERSATION_RETENTION_MS) }).conversations).toEqual(
      [],
    );
  });

  it("does not renew on reads, list, replay or view-only access", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "ffffffff-ffff-4fff-8fff-ffffffffffff");
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId: turn.claim.turnId,
      revision: turn.claim.revision,
      response: response(),
      now: at(1000),
    });
    const expiry = getConversation(OWNER, created.id, { now: at(2 * HOUR) }).conversation.expiresAt;
    getConversation(OWNER, created.id, { now: at(3 * HOUR) });
    listConversations(OWNER, { now: at(3 * HOUR) });
    claimTurn(OWNER, {
      conversationId: created.id,
      turnId: turn.claim.turnId,
      question: "比较各课程平均成绩",
      datasetId: "demo",
      expectedRevision: 99,
      now: at(4 * HOUR),
    });
    expect(getConversation(OWNER, created.id, { now: at(4 * HOUR) }).conversation.expiresAt).toBe(
      expiry,
    );
  });

  it("renews on a real new message", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const first = claim(created.id, "12121212-1212-4212-8212-121212121212");
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId: first.claim.turnId,
      revision: first.claim.revision,
      response: response(),
      now: at(1000),
    });
    claimTurn(OWNER, {
      conversationId: created.id,
      turnId: "13131313-1313-4313-8313-131313131313",
      question: "再比较一次",
      datasetId: "demo",
      expectedRevision: 1,
      now: at(DAY),
    });
    expect(getConversation(OWNER, created.id, { now: at(DAY) }).conversation.expiresAt).toBe(
      new Date(at(DAY).getTime() + CONVERSATION_RETENTION_MS).toISOString(),
    );
  });

  it("never makes an expired conversation reachable by an old id", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    expect(() =>
      claimTurn(OWNER, {
        conversationId: created.id,
        turnId: "14141414-1414-4414-8414-141414141414",
        question: "过期后继续提问",
        datasetId: "demo",
        expectedRevision: 0,
        now: at(CONVERSATION_RETENTION_MS),
      }),
    ).toThrow(expect.objectContaining({ code: "CONVERSATION_UNAVAILABLE" }));
  });

  it("removes expired bodies on cleanup and does not renew them", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const cleaned = cleanupConversations(at(CONVERSATION_RETENTION_MS));
    expect(cleaned.removed).toBe(1);
    expect(readFileSync(bucketPath(OWNER), "utf8")).not.toContain(created.id);
  });
});

describe("account isolation and permissions", () => {
  it("never exposes another account's conversation, delete or claim", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    expect(() => getConversation(OTHER, created.id, { now: T0 })).toThrow(
      expect.objectContaining({ code: "CONVERSATION_UNAVAILABLE" }),
    );
    expect(listConversations(OTHER, { now: T0 }).conversations).toEqual([]);
    deleteConversation(OTHER, created.id);
    expect(getConversation(OWNER, created.id, { now: T0 }).conversation.id).toBe(created.id);
    expect(() =>
      claimTurn(OTHER, {
        conversationId: created.id,
        turnId: "15151515-1515-4515-8515-151515151515",
        question: "越权提问",
        datasetId: "demo",
        expectedRevision: 0,
        now: T0,
      }),
    ).toThrow(expect.objectContaining({ code: "CONVERSATION_UNAVAILABLE" }));
  });

  it("filters sidebar summaries by currently authorized datasets", () => {
    createConversation(OWNER, { datasetId: "demo", now: T0 });
    createConversation(OWNER, { datasetId: "oulad", now: at(1000) });
    const page = listConversations(OWNER, {
      now: at(2000),
      datasetIds: ["demo"],
    });
    expect(page.conversations.map((item) => item.datasetId)).toEqual(["demo"]);
  });

  it("rejects switching a conversation to another dataset", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    expect(() =>
      claimTurn(OWNER, {
        conversationId: created.id,
        turnId: "16161616-1616-4616-8616-161616161616",
        question: "换数据集提问",
        datasetId: "oulad",
        expectedRevision: 0,
        now: T0,
      }),
    ).toThrow(expect.objectContaining({ code: "DATASET_MISMATCH" }));
  });
});

describe("restart, interruption and storage damage", () => {
  it("marks a dead process lease interrupted without rerunning it", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "17171717-1717-4717-8717-171717171717");
    const file = bucketPath(OWNER);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.conversations[0].turns[0].leaseOwner = JSON.stringify({
      host: "fixture-host",
      pid: 999_999,
      birth: "posix:dead",
      startedAt: T0.getTime(),
    });
    writeFileSync(file, JSON.stringify(raw));
    const cleaned = cleanupConversations(at(HOUR));
    expect(cleaned.interrupted).toBe(1);
    const detail = getConversation(OWNER, created.id, { now: at(HOUR) });
    expect(detail.turns[0].status).toBe("interrupted");
    expect(detail.messages.at(-1)?.content).toContain("中断");
    // A replay reports the terminal state; it must not start a second run.
    const replay = claimTurn(OWNER, {
      conversationId: created.id,
      turnId: turn.claim.turnId,
      question: "比较各课程平均成绩",
      datasetId: "demo",
      expectedRevision: 1,
      now: at(2 * HOUR),
    });
    expect(replay.claim.replayed).toBe(true);
    expect(replay.existing?.status).toBe("interrupted");
  });

  it("gates a stopped turn for a worker polling state", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "18181818-1818-4818-8818-181818181818");
    expect(() =>
      assertTurnActive(OWNER, turn.claim, { now: at(1000), datasetId: "demo" }),
    ).not.toThrow();
    stopTurn(OWNER, created.id, { turnId: turn.claim.turnId, now: at(2000) });
    expect(() => assertTurnActive(OWNER, turn.claim, { now: at(3000), datasetId: "demo" })).toThrow(
      expect.objectContaining({ code: "TURN_STOPPED" }),
    );
  });

  it("surfaces a damaged bucket instead of resetting it", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    writeFileSync(bucketPath(OWNER), "{not json");
    expect(() => getConversation(OWNER, created.id, { now: T0 })).toThrow(
      expect.objectContaining({ code: "CONVERSATION_STORAGE_CORRUPT" }),
    );
    expect(() => listConversations(OWNER, { now: T0 })).toThrow(
      expect.objectContaining({ code: "CONVERSATION_STORAGE_CORRUPT" }),
    );
    expect(readFileSync(bucketPath(OWNER), "utf8")).toBe("{not json");
  });

  it("paginates newest-first with an opaque cursor", () => {
    for (let index = 0; index < 3; index++)
      createConversation(OWNER, { datasetId: "demo", now: at(index * 1000) });
    const first = listConversations(OWNER, { limit: 2, now: at(HOUR) });
    expect(first.conversations).toHaveLength(2);
    expect(first.nextCursor).toBeTruthy();
    const second = listConversations(OWNER, {
      limit: 2,
      cursor: first.nextCursor,
      now: at(HOUR),
    });
    expect(second.conversations).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.conversations, ...second.conversations].map((item) => item.id);
    expect(new Set(ids).size).toBe(3);
  });
});

describe("snapshot allowlist", () => {
  it("drops raw SQL and untrusted display state while keeping facts and refs", () => {
    const snapshot = snapshotResponse(
      response("结论", {
        artifact: {
          kind: "analysis",
          plan: {
            version: 1,
            datasetId: "demo",
            metric: "score",
            aggregation: "avg",
            dimensions: ["course"],
            filters: [],
            sort: { by: "value", direction: "desc" },
            limit: 20,
            chartType: "bar",
          },
          result: {
            datasetId: "demo",
            dimension: "course",
            chartType: "bar",
            rows: [{ dimension: "数学", value: 80, sampleSize: 10 }],
            unit: "分",
            metricLabel: "平均成绩",
            period: "2025J",
            query: "SELECT * FROM secret_students",
            durationMs: 3,
            minSampleSize: 3,
            filteredOutGroupCount: null,
          },
          view: "bar",
        },
      }),
    );
    expect(snapshot.artifact?.kind).toBe("analysis");
    expect(snapshot.artifact?.kind === "analysis" ? snapshot.artifact.result.query : "x").toBe("");
    expect(JSON.stringify(snapshot)).not.toContain("secret_students");
  });

  it("strips nested fields that are not part of the aggregate contract", () => {
    const snapshot = snapshotResponse(
      response("结论", {
        artifact: {
          kind: "analysis",
          plan: {
            version: 1,
            datasetId: "demo",
            metric: "score",
            aggregation: "avg",
            dimensions: ["course"],
            filters: [],
            sort: { by: "value", direction: "desc" },
            limit: 20,
            chartType: "bar",
          },
          result: {
            datasetId: "demo",
            dimension: "course",
            chartType: "bar",
            rows: [
              {
                dimension: "数学",
                value: 80,
                sampleSize: 10,
                studentRows: [{ id: "S001", score: 80 }],
              } as never,
            ],
            unit: "分",
            metricLabel: "平均成绩",
            period: "2025J",
            query: "",
            durationMs: 3,
            minSampleSize: 3,
            filteredOutGroupCount: null,
            rawStudentRows: ["S001"],
          } as never,
          view: "bar",
        },
        resultRefs: [
          {
            version: 1,
            resultId: "r-0123456789abcdef",
            datasetId: "demo",
            datasetVersion: "v",
            metricVersion: "m",
            kind: "aggregate",
            metric: "score",
            granularity: "course",
            courses: [],
            terms: [],
            filters: [],
            extra: {},
            unit: "分",
            minSampleSize: 3,
            sampleSize: 10,
            scopeLabel: "范围",
            limitations: [],
            rawSql: "SELECT secret",
          } as never,
        ],
      }),
    );
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("studentRows");
    expect(serialized).not.toContain("rawStudentRows");
    expect(serialized).not.toContain("rawSql");
    expect(serialized).not.toContain("secret");
    expect(snapshot.artifact?.kind).toBe("analysis");
    if (snapshot.artifact?.kind === "analysis")
      expect(snapshot.artifact.result.rows[0]).toEqual({
        dimension: "数学",
        value: 80,
        sampleSize: 10,
      });
  });

  it("rejects a structurally corrupt nested artifact instead of storing it", () => {
    expect(() =>
      snapshotResponse(
        response("结论", {
          artifact: {
            kind: "relations",
            data: { datasetId: "demo", relations: [{ source: "A", commonCount: "many" }] },
            course: "",
            view: "chart",
          } as never,
        }),
      ),
    ).toThrow(expect.objectContaining({ code: "INVALID_SNAPSHOT" }));
  });

  it("surfaces a corrupt nested stored response on read", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "abababab-abab-4bab-8bab-abababababab");
    finishTurn(OWNER, {
      conversationId: created.id,
      turnId: turn.claim.turnId,
      revision: turn.claim.revision,
      response: response("有效结果"),
      now: at(1000),
    });
    const file = bucketPath(OWNER);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.conversations[0].messages[1].response.artifact = {
      kind: "analysis",
      plan: { version: 1 },
      result: { rows: "not-an-array" },
      view: "bar",
    };
    writeFileSync(file, JSON.stringify(raw));
    expect(() => getConversation(OWNER, created.id, { now: at(2000) })).toThrow(
      expect.objectContaining({ code: "CONVERSATION_STORAGE_CORRUPT" }),
    );
  });

  it("rejects an oversized snapshot explicitly", () => {
    expect(() =>
      snapshotResponse(
        response("x".repeat(59_999), {
          artifacts: Array.from(
            { length: 8 },
            () =>
              ({
                kind: "relations",
                data: { blob: "y".repeat(80_000) },
                course: "",
                view: "chart",
              }) as never,
          ),
        }),
      ),
    ).toThrow(Error);
  });
});

describe("stop and fail write terminal assistant messages", () => {
  it("records a cancelled assistant message and revision once", () => {
    const created = createConversation(OWNER, { datasetId: "demo", now: T0 });
    const turn = claim(created.id, "19191919-1919-4919-8919-191919191919");
    const stopped = stopTurn(OWNER, created.id, { turnId: turn.claim.turnId, now: at(1000) });
    expect(stopped.turn?.status).toBe("cancelled");
    expect(stopped.conversation.messageCount).toBe(2);
    const again = stopTurn(OWNER, created.id, { turnId: turn.claim.turnId, now: at(2000) });
    expect(again.idle).toBe(true);
    expect(again.conversation.messageCount).toBe(2);
  });
});
