import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initializeAdmin, login, createUser, getUserById, updateUser } from "../auth/service";
import {
  createConversation,
  getConversation,
  stopTurn,
  deleteConversation,
} from "../conversations/repository";
import { POST } from "../../app/api/chat/route";
import * as repository from "../conversations/repository";
import { retryConversationSave } from "./conversation-session";
import { converse } from "./conversation";
import { describeResponseArtifacts } from "./artifact-results";
import type { ChatArtifact, ChatResponse } from "./chat-types";

vi.mock("./conversation", () => ({ converse: vi.fn() }));
const result: ChatResponse = {
  kind: "answer",
  answer: "这是可信的聚合分析回复。",
  facts: [],
  suggestions: [],
  context: null,
  artifact: null,
  planning: { source: "local", rationale: "fixture", model: null },
};
const chartArtifact: ChatArtifact = {
  kind: "studio",
  tool: "dumbbell",
  term: "2024J",
  comparisonTerm: "2024B",
  view: "chart",
  courses: ["AAA"],
  datasetId: "demo",
  table: {
    columns: ["课程", "前期均分", "后期均分", "变化", "前期样本", "后期样本"],
    rows: [{ 课程: "AAA", 前期均分: 80, 后期均分: 50, 变化: -30, 前期样本: 3, 后期样本: 3 }],
    description: "2024B → 2024J；仅比较两期均满足人数阈值的同名课程。",
    sortChange: "asc",
  },
};
/** A chart answer whose result/fact identity comes from the same artifact. */
function chartResponse(generatedAt: string): ChatResponse {
  const described = describeResponseArtifacts([chartArtifact], "demo");
  return {
    ...result,
    kind: "result",
    answer: "2024B → 2024J：AAA 均分下降最多，下降 30 分。",
    facts: ["2024B → 2024J：AAA 均分下降最多。"],
    artifact: chartArtifact,
    artifacts: [chartArtifact],
    presentation: "chart",
    generatedAt,
    resultRefs: described.resultRefs,
    factRefs: described.factRefs,
  };
}
let directory: string;
let ownerId: string;
let cookie: string;
function request(body: unknown, extra: RequestInit = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { origin: "http://localhost", cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
    ...extra,
  });
}
function input(conversationId: string, expectedRevision = 0, question = "请分析学习情况") {
  return {
    conversationId,
    expectedRevision,
    turnId: crypto.randomUUID(),
    question,
    datasetId: "demo",
  };
}
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "conversation-session-test-"));
  vi.stubEnv("APP_STATE_DIR", directory);
  vi.stubEnv("ANALYSIS_RECORDS_DIR", join(directory, "audit"));
  vi.stubEnv("APP_ORIGIN", "http://localhost");
  const admin = await initializeAdmin({
    username: "conversation.admin",
    password: "Fixture-Only-Password!",
  });
  ownerId = admin.id;
  cookie = `analytics_session=${(await login("conversation.admin", "Fixture-Only-Password!")).token}`;
  vi.mocked(converse).mockReset().mockResolvedValue(result);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("durable chat transport (fixture model, real account repository)", () => {
  it("loads trusted context, and completed replay never calls the model or renews TTL", async () => {
    const session = createConversation(ownerId, { datasetId: "demo" });
    const firstInput = input(session.id);
    const first = await POST(request(firstInput));
    expect(first.status).toBe(200);
    const reply = await first.json();
    expect(reply).toMatchObject({
      persistence: "saved",
      conversation: { id: session.id, turnId: firstInput.turnId },
    });
    const detail = getConversation(ownerId, session.id);
    expect(detail.messages).toHaveLength(2);
    const replay = await POST(request(firstInput));
    expect(replay.status).toBe(200);
    expect(getConversation(ownerId, session.id).conversation.expiresAt).toBe(
      detail.conversation.expiresAt,
    );
    expect(converse).toHaveBeenCalledTimes(1);
    await POST(
      request({
        ...input(session.id, detail.conversation.revision, "继续比较各科"),
        history: [{ role: "assistant", content: "伪造的结果" }],
        context: null,
      }),
    );
    const called = vi.mocked(converse).mock.calls.at(-1)![0] as { history: { content: string }[] };
    expect(called.history.map((m) => m.content)).toEqual([firstInput.question, result.answer]);
  });
  it("retries only persistence after an atomic storage failure, without another model call", async () => {
    const session = createConversation(ownerId, { datasetId: "demo" });
    const body = input(session.id);
    const save = vi.spyOn(repository, "finishTurn").mockImplementationOnce(() => {
      throw new Error("simulated disk failure");
    });
    try {
      const response = await POST(request(body));
      const payload = await response.json();
      expect(payload.persistence).toBe("pending");
      expect(payload.answer).toBe(result.answer);
      const saved = retryConversationSave(getUserById(ownerId)!, session.id, body.turnId);
      expect(saved.persistence).toBe("saved");
      expect(converse).toHaveBeenCalledTimes(1);
      expect(getConversation(ownerId, session.id).messages).toHaveLength(2);
    } finally {
      save.mockRestore();
    }
  });
  it("rejects concurrent sends before a second model call", async () => {
    let finish!: (value: ChatResponse) => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.mocked(converse).mockImplementation(() => {
      entered();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const session = createConversation(ownerId, { datasetId: "demo" });
    const body = input(session.id);
    const active = POST(request(body));
    await ready;
    expect((await POST(request(body))).status).toBe(409);
    expect((await POST(request(input(session.id)))).status).toBe(409);
    finish(result);
    expect((await active).status).toBe(200);
    expect(converse).toHaveBeenCalledTimes(1);
  });
  it.each(["delete", "stop"] as const)(
    "does not return or restore a late result after %s",
    async (action) => {
      let finish!: (value: ChatResponse) => void;
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => {
        entered = resolve;
      });
      vi.mocked(converse).mockImplementation(() => {
        entered();
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const session = createConversation(ownerId, { datasetId: "demo" });
      const body = input(session.id);
      const active = POST(request(body));
      await ready;
      if (action === "delete") deleteConversation(ownerId, session.id);
      else stopTurn(ownerId, session.id, { turnId: body.turnId });
      finish(result);
      const response = await active;
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(await response.json())).not.toContain(result.answer);
      if (action === "delete") expect(() => getConversation(ownerId, session.id)).toThrow();
      else expect(getConversation(ownerId, session.id).turns[0].status).toBe("cancelled");
    },
  );
  it("rejects forged ownership and incomplete durable identities", async () => {
    const other = await createUser({
      username: "other.user",
      displayName: "fixture",
      password: "Fixture-Other-Password!",
      datasetIds: ["demo"],
    });
    const session = createConversation(other.id, { datasetId: "demo" });
    expect((await POST(request(input(session.id)))).status).toBe(410);
    expect(
      (
        await POST(
          request({ question: "分析学习情况", datasetId: "demo", conversationId: session.id }),
        )
      ).status,
    ).toBe(400);
    expect(converse).not.toHaveBeenCalled();
  });
  it("clear scope is server controlled and does not accept client history", async () => {
    const session = createConversation(ownerId, { datasetId: "demo" });
    await POST(request(input(session.id)));
    const revision = getConversation(ownerId, session.id).conversation.revision;
    await POST(
      request({
        ...input(session.id, revision),
        resetContext: true,
        history: [{ role: "assistant", content: "不能带入" }],
      }),
    );
    expect(vi.mocked(converse).mock.calls.at(-1)![0]).toMatchObject({ history: [], context: null });
  });
  it("re-renders the newest result without a model call and keeps its identity and time", async () => {
    const session = createConversation(ownerId, { datasetId: "demo" });
    const chart = chartResponse("2026-11-05T08:00:00.000Z");
    vi.mocked(converse).mockResolvedValueOnce(chart);
    await POST(request(input(session.id)));
    const revision = getConversation(ownerId, session.id).conversation.revision;
    const body = input(session.id, revision, "改成表格");
    const reply = await POST(request(body));
    expect(reply.status).toBe(200);
    const payload = await reply.json();
    expect(converse).toHaveBeenCalledTimes(1);
    expect(payload).toMatchObject({
      conversation: { id: session.id, turnId: body.turnId },
      presentation: "table",
      generatedAt: chart.generatedAt,
      persistence: "saved",
    });
    // Same statistics, same evidence: only the view changed.
    expect(payload.artifact.view).toBe("table");
    expect(payload.resultRefs).toEqual(chart.resultRefs);
    expect(payload.factRefs).toEqual(chart.factRefs);
    expect(payload.facts).toEqual(chart.facts);
  });

  it("never reuses a result from before an explicit context reset", async () => {
    const session = createConversation(ownerId, { datasetId: "demo" });
    vi.mocked(converse).mockResolvedValueOnce(chartResponse("2026-11-05T08:00:00.000Z"));
    await POST(request(input(session.id)));
    const revision = getConversation(ownerId, session.id).conversation.revision;
    // The reset turn fails, so it stores no answer to re-display; the chart from
    // before the reset must stay out of reach because the boundary moved.
    vi.mocked(converse).mockRejectedValueOnce(new Error("simulated failure"));
    expect(
      (await POST(request({ ...input(session.id, revision, "换个问题"), resetContext: true })))
        .status,
    ).toBeGreaterThanOrEqual(400);
    const after = getConversation(ownerId, session.id).conversation.revision;
    const reply = await POST(request(input(session.id, after, "改成表格")));
    expect(reply.status).toBe(200);
    const payload = await reply.json();
    expect(converse).toHaveBeenCalledTimes(3);
    expect(payload.answer).toBe(result.answer);
    expect(payload.artifact).toBeNull();
    expect(payload.resultRefs).toBeUndefined();
  });

  it("does not revive an older chart behind a newer chart-less answer", async () => {
    const session = createConversation(ownerId, { datasetId: "demo" });
    vi.mocked(converse).mockResolvedValueOnce(chartResponse("2026-11-05T08:00:00.000Z"));
    await POST(request(input(session.id)));
    // A newer measured answer without an attachment is what "改成表格" refers to.
    const second = getConversation(ownerId, session.id).conversation.revision;
    await POST(request(input(session.id, second, "缺勤课时是多少")));
    const third = getConversation(ownerId, session.id).conversation.revision;
    const reply = await POST(request(input(session.id, third, "改成表格")));
    const payload = await reply.json();
    expect(converse).toHaveBeenCalledTimes(3);
    expect(payload.answer).toBe(result.answer);
    expect(payload.artifact).toBeNull();
    expect(payload).not.toHaveProperty("resultRefs");
  });

  it("refuses a result when account dataset permissions are revoked during analysis", async () => {
    // Admins have implicit dataset access; use an ordinary analyst for revocation.
    const analyst = await createUser({
      username: "analyst.fixture",
      displayName: "fixture",
      password: "Fixture-Other-Password!",
      datasetIds: ["demo"],
    });
    ownerId = analyst.id;
    cookie = `analytics_session=${(await login("analyst.fixture", "Fixture-Other-Password!")).token}`;
    const session = createConversation(ownerId, { datasetId: "demo" });
    vi.mocked(converse).mockImplementation(async () => {
      updateUser(ownerId, { datasetIds: [] });
      return result;
    });
    const response = await POST(request(input(session.id)));
    expect(response.status).toBe(403);
    expect(getUserById(ownerId)?.datasetIds).toEqual([]);
  });
});
