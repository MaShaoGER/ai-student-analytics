import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DELETE, GET as GET_DETAIL } from "./[id]/route";
import { POST as STOP } from "./[id]/stop/route";
import { GET, POST } from "./route";
import { cookieName } from "@/lib/auth/http";
import { createUser, initializeAdmin, login } from "@/lib/auth/service";
import { claimTurn } from "@/lib/conversations/repository";

const ORIGIN = "http://localhost:3000";
const ADMIN_PASSWORD = "Fixture-Admin-Password!";
const USER_PASSWORD = "Fixture-User-Password!";

let directory = "";
let adminCookie = "";
let ownerCookie = "";
let otherCookie = "";
let readonlyCookie = "";

function request(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  options: { cookie?: string; origin?: string | null } = {},
) {
  const headers: Record<string, string> = { cookie: options.cookie ?? ownerCookie };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function createConversation(datasetId: "demo" | "oulad" = "demo") {
  const response = await POST(request("POST", "/api/conversations", { datasetId }));
  return { response, body: await response.json() };
}

async function cookieFor(username: string) {
  const session = await login(username, USER_PASSWORD);
  return `${cookieName}=${session.token}`;
}

beforeEach(async () => {
  vi.resetAllMocks();
  directory = mkdtempSync(join(tmpdir(), "conversation-route-"));
  vi.stubEnv("APP_STATE_DIR", directory);
  vi.stubEnv("APP_ORIGIN", ORIGIN);
  await initializeAdmin({
    username: "fixture-admin",
    password: ADMIN_PASSWORD,
    displayName: "Fixture Admin",
  });
  for (const [username, role, datasetIds] of [
    ["fixture-owner", "user", ["demo", "oulad"]],
    ["fixture-other", "user", ["demo", "oulad"]],
    ["fixture-readonly", "readonly", ["demo"]],
  ] as const)
    await createUser({
      username,
      displayName: username,
      password: USER_PASSWORD,
      role,
      datasetIds: [...datasetIds],
    });
  ownerCookie = await cookieFor("fixture-owner");
  otherCookie = await cookieFor("fixture-other");
  readonlyCookie = await cookieFor("fixture-readonly");
});

afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("conversation history routes", () => {
  it("creates and lists only the signed-in account's history", async () => {
    const created = await createConversation();
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("cache-control")).toBe("no-store");
    expect(created.body.conversation).toMatchObject({ datasetId: "demo", revision: 0 });

    const ownerList = await GET(request("GET", "/api/conversations?limit=10"));
    expect((await ownerList.json()).conversations).toHaveLength(1);

    const otherList = await GET(
      request("GET", "/api/conversations?limit=10", undefined, { cookie: otherCookie }),
    );
    expect((await otherList.json()).conversations).toEqual([]);
  });

  it("requires authentication, same origin and a dataset grant", async () => {
    expect(
      (await POST(request("POST", "/api/conversations", { datasetId: "demo" }, { cookie: "" })))
        .status,
    ).toBe(401);
    expect(
      (
        await POST(
          request(
            "POST",
            "/api/conversations",
            { datasetId: "demo" },
            { origin: "https://evil.example" },
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await POST(
          request("POST", "/api/conversations", { datasetId: "oulad" }, { cookie: readonlyCookie }),
        )
      ).status,
    ).toBe(403);
  });

  it("rejects unknown query parameters and oversized pages", async () => {
    expect((await GET(request("GET", "/api/conversations?ownerId=someone"))).status).toBe(400);
    expect((await GET(request("GET", "/api/conversations?limit=999"))).status).toBe(400);
  });

  it("returns a page with an opaque cursor", async () => {
    await createConversation();
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createConversation();
    const first = await (await GET(request("GET", "/api/conversations?limit=1"))).json();
    expect(first.conversations).toHaveLength(1);
    expect(first.nextCursor).toBeTruthy();
    const second = await (
      await GET(request("GET", `/api/conversations?limit=1&cursor=${first.nextCursor}`))
    ).json();
    expect(second.conversations).toHaveLength(1);
    expect(second.conversations[0].id).not.toBe(first.conversations[0].id);
  });

  it("does not leak details across accounts and hides unauthorized dataset titles", async () => {
    const { body } = await createConversation();
    const id = body.conversation.id;
    expect(
      (
        await GET_DETAIL(
          request("GET", `/api/conversations/${id}`, undefined, { cookie: otherCookie }),
          params(id),
        )
      ).status,
    ).toBe(410);
    expect(
      (await GET_DETAIL(request("GET", `/api/conversations/not-a-uuid`), params("not-a-uuid")))
        .status,
    ).toBe(400);

    // readonly owns no oulad grant: a demo history is visible, an oulad one is not.
    const oulad = await createConversation("oulad");
    const list = await (
      await GET(request("GET", "/api/conversations", undefined, { cookie: readonlyCookie }))
    ).json();
    expect(list.conversations.map((item: { id: string }) => item.id)).not.toContain(
      oulad.body.conversation.id,
    );
  });

  it("deletes idempotently and blocks access to another account's records", async () => {
    const { body } = await createConversation();
    const id = body.conversation.id;
    const foreignDelete = await DELETE(
      request("DELETE", `/api/conversations/${id}`, undefined, { cookie: otherCookie }),
      params(id),
    );
    expect(foreignDelete.status).toBe(200);
    expect((await GET_DETAIL(request("GET", `/api/conversations/${id}`), params(id))).status).toBe(
      200,
    );

    const first = await DELETE(request("DELETE", `/api/conversations/${id}`), params(id));
    expect(first.status).toBe(200);
    const second = await DELETE(request("DELETE", `/api/conversations/${id}`), params(id));
    expect(second.status).toBe(200);
    expect((await GET_DETAIL(request("GET", `/api/conversations/${id}`), params(id))).status).toBe(
      410,
    );
  });

  it("stops the durable turn and refuses a cross-origin stop", async () => {
    const { body } = await createConversation();
    const id = body.conversation.id;
    const ownerId = (
      JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8")).users as {
        id: string;
        username: string;
      }[]
    ).find((user) => user.username === "fixture-owner")!.id;
    const claimed = claimTurn(ownerId, {
      conversationId: id,
      turnId: "20202020-2020-4020-8020-202020202020",
      question: "比较各课程平均成绩",
      datasetId: "demo",
      expectedRevision: 0,
    });
    const crossOrigin = await STOP(
      request(
        "POST",
        `/api/conversations/${id}/stop`,
        { turnId: claimed.claim.turnId },
        { origin: "https://evil.example" },
      ),
      params(id),
    );
    expect(crossOrigin.status).toBe(403);
    const stopped = await STOP(
      request("POST", `/api/conversations/${id}/stop`, { turnId: claimed.claim.turnId }),
      params(id),
    );
    expect(stopped.status).toBe(200);
    expect(await stopped.json()).toMatchObject({
      turnId: claimed.claim.turnId,
      status: "cancelled",
      idle: false,
    });
    const detail = await (
      await GET_DETAIL(request("GET", `/api/conversations/${id}`), params(id))
    ).json();
    expect(detail.turns[0].status).toBe("cancelled");
    expect(detail.messages.at(-1).role).toBe("assistant");

    // A retry after the turn was already removed is a safe no-op, not a 404.
    const missing = await STOP(
      request("POST", `/api/conversations/${id}/stop`, {
        turnId: "21212121-2121-4121-8121-212121212121",
      }),
      params(id),
    );
    expect(missing.status).toBe(200);
    expect(await missing.json()).toMatchObject({ idle: true });
  });

  it("serves detail only after the current dataset grant is verified", async () => {
    const { body } = await createConversation("oulad");
    const id = body.conversation.id;
    const blocked = await GET_DETAIL(
      request("GET", `/api/conversations/${id}`, undefined, { cookie: readonlyCookie }),
      params(id),
    );
    expect(blocked.status).toBe(410);
  });
});
