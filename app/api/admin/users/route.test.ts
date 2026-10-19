import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GET, PATCH, POST } from "./route";
import { cookieName } from "@/lib/auth/http";
import {
  createUser,
  initializeAdmin,
  login,
  resetUserPassword,
  updateUser,
} from "@/lib/auth/service";

const ADMIN_PASSWORD = "Fixture-Admin-Password!";
const USER_PASSWORD = "Fixture-User-Password!";
const ORIGIN = "http://localhost:3000";

let directory = "";
let adminCookie = "";
let adminId = "";

function request(
  method: "GET" | "POST" | "PATCH",
  path = "/api/admin/users",
  body?: string,
  options: { cookie?: string; origin?: string | null; contentLength?: number } = {},
) {
  const headers: Record<string, string> = {
    cookie: options.cookie ?? adminCookie,
    "content-type": "application/json",
  };
  if (options.origin !== null) headers.origin = options.origin ?? ORIGIN;
  if (options.contentLength !== undefined)
    headers["content-length"] = String(options.contentLength);
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body }),
  });
}

async function responseBody<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

async function create(
  username: string,
  role: "user" | "readonly" = "user",
  datasetIds: ("demo" | "oulad")[] = [],
) {
  const response = await POST(
    request(
      "POST",
      "/api/admin/users",
      JSON.stringify({
        username,
        displayName: `成员 ${username}`,
        password: USER_PASSWORD,
        role,
        datasetIds,
      }),
    ),
  );
  expect(response.status).toBe(201);
  return (
    await responseBody<{ user: { id: string; role: string; datasetIds: string[] } }>(response)
  ).user;
}

function auditEvents() {
  return JSON.parse(readFileSync(join(directory, "accounts.json"), "utf8")).__adminAudit
    .events as Array<{
    action: string;
    targetId: string;
    result: string;
    summary: Record<string, unknown>;
    errorCode?: string;
  }>;
}

describe("administrator account route", () => {
  beforeEach(async () => {
    vi.resetAllMocks();
    directory = mkdtempSync(join(tmpdir(), "admin-users-route-"));
    vi.stubEnv("APP_STATE_DIR", directory);
    vi.stubEnv("APP_ORIGIN", ORIGIN);
    vi.stubEnv("ADMIN_USERNAME", "");
    vi.stubEnv("ADMIN_PASSWORD", "");
    const admin = await initializeAdmin({
      username: "fixture-admin",
      password: ADMIN_PASSWORD,
      displayName: "Fixture Admin",
    });
    adminId = admin.id;
    const session = await login("fixture-admin", ADMIN_PASSWORD);
    adminCookie = `${cookieName}=${session.token}`;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    rmSync(directory, { recursive: true, force: true });
  });

  it("requires an administrator for reading and does not leak credentials in the list", async () => {
    const viewer = await createUser({
      username: "fixture-viewer",
      displayName: "Fixture Viewer",
      password: USER_PASSWORD,
      role: "user",
      datasetIds: ["demo"],
    });
    const viewerSession = await login("fixture-viewer", USER_PASSWORD);

    expect((await GET(request("GET", "/api/admin/users", undefined, { cookie: "" }))).status).toBe(
      401,
    );
    expect(
      (
        await GET(
          request("GET", "/api/admin/users", undefined, {
            cookie: `${cookieName}=${viewerSession.token}`,
          }),
        )
      ).status,
    ).toBe(403);

    const response = await GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const serialized = await response.text();
    expect(serialized).not.toContain("passwordHash");
    expect(serialized).not.toContain("tokenHash");
    expect(serialized).not.toContain(USER_PASSWORD);
    expect(serialized).not.toContain(adminCookie.split("=")[1]);
    expect(JSON.parse(serialized)).toMatchObject({
      users: expect.arrayContaining([
        expect.objectContaining({ id: viewer.id, datasetIds: ["demo"], role: "user" }),
      ]),
      page: 1,
      pageSize: 20,
    });
  });

  it("bounds search filters and paging, and rejects duplicate or unknown query keys", async () => {
    await create("alpha-u", "user", ["demo"]);
    await create("alpha-r", "readonly", ["oulad"]);
    const disabled = await create("disabled-a", "user", ["demo"]);
    updateUser(disabled.id, { disabled: true });

    const search = await responseBody<{
      users: Array<{ username: string; role: string; disabled: boolean }>;
      total: number;
      page: number;
      pageSize: number;
    }>(
      await GET(
        request("GET", "/api/admin/users?q=alpha&role=readonly&disabled=false&page=1&pageSize=1"),
      ),
    );
    expect(search).toMatchObject({ total: 1, page: 1, pageSize: 1 });
    expect(search.users).toHaveLength(1);
    expect(search.users[0]).toMatchObject({
      username: "alpha-r",
      role: "readonly",
      disabled: false,
    });

    const disabledPage = await responseBody<{ users: Array<{ username: string }>; total: number }>(
      await GET(request("GET", "/api/admin/users?disabled=true&page=1&pageSize=2")),
    );
    expect(disabledPage.total).toBe(1);
    expect(disabledPage.users.map((user) => user.username)).toContain("disabled-a");

    for (const query of ["?page=1&page=2", "?unknown=value"]) {
      const response = await GET(request("GET", `/api/admin/users${query}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_QUERY" });
    }

    for (const query of ["?page=0", "?pageSize=101"]) {
      const response = await GET(request("GET", `/api/admin/users${query}`));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it("creates and edits accounts with explicit role and grant contracts", async () => {
    expect(
      (
        await POST(
          request(
            "POST",
            "/api/admin/users",
            JSON.stringify({
              username: "implicit-role",
              displayName: "Implicit",
              password: USER_PASSWORD,
            }),
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request(
            "POST",
            "/api/admin/users",
            JSON.stringify({
              username: "implicit-grants",
              displayName: "Implicit",
              password: USER_PASSWORD,
              role: "user",
            }),
          ),
        )
      ).status,
    ).toBe(400);

    const created = await create("explicit-user", "user", ["oulad"]);
    const patched = await PATCH(
      request(
        "PATCH",
        "/api/admin/users",
        JSON.stringify({
          id: created.id,
          displayName: "已编辑成员",
          role: "readonly",
          disabled: true,
          datasetIds: ["demo"],
        }),
      ),
    );
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({
      user: {
        id: created.id,
        displayName: "已编辑成员",
        role: "readonly",
        disabled: true,
        datasetIds: ["demo"],
      },
    });

    const events = auditEvents();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "user.create",
          targetId: created.id,
          summary: { role: "user", datasetIds: "oulad" },
        }),
        expect.objectContaining({
          action: "user.update",
          targetId: created.id,
          summary: expect.objectContaining({
            beforeRole: "user",
            role: "readonly",
            beforeDisabled: false,
            disabled: true,
            beforeDatasetIds: "oulad",
            datasetIds: "demo",
          }),
        }),
      ]),
    );
  });

  it("uses the narrow disabled audit event when only disabled changes", async () => {
    const viewer = await create("toggle-user", "user", ["demo"]);
    const response = await PATCH(
      request("PATCH", "/api/admin/users", JSON.stringify({ id: viewer.id, disabled: true })),
    );
    expect(response.status).toBe(200);

    const event = auditEvents().find(
      (candidate) => candidate.action === "user.disabled" && candidate.targetId === viewer.id,
    );
    expect(event).toMatchObject({
      result: "success",
      summary: { beforeDisabled: false, disabled: true },
    });
    expect(Object.keys(event!.summary).sort()).toEqual(["beforeDisabled", "disabled"]);
  });

  it("resets a password once, revokes old sessions, and omits the temporary password from audit", async () => {
    const viewer = await create("reset-user", "user", ["demo"]);
    const oldSession = await login("reset-user", USER_PASSWORD);
    const response = await POST(
      request(
        "POST",
        "/api/admin/users",
        JSON.stringify({ action: "reset-password", id: viewer.id }),
      ),
    );
    expect(response.status).toBe(200);
    const reset = await responseBody<{
      temporaryPassword: string;
      user: { mustChangePassword: boolean };
    }>(response);
    expect(reset.temporaryPassword).toMatch(/^T-/);
    expect(reset.user.mustChangePassword).toBe(true);

    const stale = await GET(
      request("GET", "/api/admin/users", undefined, {
        cookie: `${cookieName}=${oldSession.token}`,
      }),
    );
    expect(stale.status).toBe(401);

    const events = auditEvents();
    expect(events).toContainEqual(
      expect.objectContaining({
        action: "user.password.reset",
        targetId: viewer.id,
        summary: { mustChangePassword: true },
      }),
    );
    expect(JSON.stringify(events)).not.toContain(reset.temporaryPassword);
  });

  it("revokes sessions explicitly and records fixed failures for rejected mutations", async () => {
    const viewer = await create("revoke-user", "user", ["demo"]);
    const session = await login("revoke-user", USER_PASSWORD);
    const revoke = await POST(
      request(
        "POST",
        "/api/admin/users",
        JSON.stringify({ action: "revoke-sessions", id: viewer.id }),
      ),
    );
    expect(revoke.status).toBe(200);
    expect(
      (
        await GET(
          request("GET", "/api/admin/users", undefined, {
            cookie: `${cookieName}=${session.token}`,
          }),
        )
      ).status,
    ).toBe(401);

    const missingId = "123e4567-e89b-42d3-a456-426614174999";
    const missing = await PATCH(
      request("PATCH", "/api/admin/users", JSON.stringify({ id: missingId, disabled: true })),
    );
    expect(missing.status).toBe(404);
    const protectedResponse = await POST(
      request(
        "POST",
        "/api/admin/users",
        JSON.stringify({ action: "reset-password", id: adminId }),
      ),
    );
    expect(protectedResponse.status).toBe(403);

    const events = auditEvents();
    expect(events).toContainEqual(
      expect.objectContaining({
        action: "user.update",
        targetId: missingId,
        result: "failure",
        errorCode: "USER_NOT_FOUND",
        summary: {},
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        action: "user.password.reset",
        targetId: adminId,
        result: "failure",
        errorCode: "ADMIN_PROTECTED",
        summary: {},
      }),
    );
  });

  it("requires same-origin writes and returns 413 for oversized POST and PATCH bodies", async () => {
    expect(
      (
        await POST(
          request(
            "POST",
            "/api/admin/users",
            JSON.stringify({
              username: "cross-origin",
              displayName: "Cross origin",
              password: USER_PASSWORD,
              role: "user",
              datasetIds: [],
            }),
            { origin: "https://attacker.example" },
          ),
        )
      ).status,
    ).toBe(403);

    for (const method of ["POST", "PATCH"] as const) {
      const response = await (method === "POST" ? POST : PATCH)(
        request(method, "/api/admin/users", JSON.stringify({ padding: "x".repeat(20_000) }), {
          contentLength: 20_000,
        }),
      );
      expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({
        code: "REQUEST_TOO_LARGE",
        error: "请求内容过大，请缩小查询范围后重试。",
      });
    }
  });

  it("supports the public reset service without leaking credentials into account state", async () => {
    const viewer = await createUser({
      username: "service-reset-user",
      displayName: "Service Reset",
      password: USER_PASSWORD,
      datasetIds: ["demo"],
    });
    const reset = await resetUserPassword(viewer.id);
    const serialized = readFileSync(join(directory, "accounts.json"), "utf8");
    expect(serialized).not.toContain(reset.temporaryPassword);
    expect(serialized).not.toContain('"temporaryPassword"');
  });
});
