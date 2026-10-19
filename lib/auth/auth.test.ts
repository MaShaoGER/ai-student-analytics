import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changePassword,
  createUser,
  getUserById,
  getSessionUser,
  hashPassword,
  initializeAdmin,
  isSetupRequired,
  listUsers,
  login,
  logout,
  resetUserPassword,
  revokeUserSessions,
  setUserDisabled,
  updateUser,
  verifyPassword,
} from "./service";
import { assertOperation } from "./service";
import { assertSameOrigin, requireAdmin, requireUser, setSessionCookie } from "./http";

const ADMIN_PASSWORD = "Study-Admin-2026!";
const USER_PASSWORD = "Study-Viewer-2026!";
const COOKIE_NAME = "analytics_session";
let stateDir: string;

function requestFor(token?: string) {
  return new Request("http://localhost:3000/api/profile", {
    headers: token ? { cookie: `${COOKIE_NAME}=${token}` } : {},
  });
}

async function setupAdmin() {
  return initializeAdmin({
    username: "test-admin",
    displayName: "测试管理员",
    password: ADMIN_PASSWORD,
  });
}

describe("persistent account authentication", () => {
  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "analytics-auth-test-"));
    vi.stubEnv("APP_STATE_DIR", stateDir);
    vi.stubEnv("ADMIN_USERNAME", "");
    vi.stubEnv("ADMIN_PASSWORD", "");
    vi.stubEnv("APP_ORIGIN", "");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("uses salted password hashes and rejects incorrect or malformed hashes", async () => {
    const first = await hashPassword(USER_PASSWORD);
    const second = await hashPassword(USER_PASSWORD);

    expect(first).not.toBe(second);
    expect(first).not.toContain(USER_PASSWORD);
    expect(await verifyPassword(USER_PASSWORD, first)).toBe(true);
    expect(await verifyPassword("Incorrect-Password!", first)).toBe(false);
    expect(await verifyPassword(USER_PASSWORD, "invalid-hash")).toBe(false);
  });

  it("persists only password hashes and token hashes and returns a safe user view", async () => {
    expect(await isSetupRequired()).toBe(true);
    const admin = await setupAdmin();
    expect(await isSetupRequired()).toBe(false);
    const session = await login("test-admin", ADMIN_PASSWORD);

    expect(session.user.id).toBe(admin.id);
    expect(session.user.role).toBe("admin");
    expect(session.expiresAt).toBeGreaterThan(Date.now());
    expect(await getSessionUser(session.token)).toEqual(session.user);

    const serialized = readFileSync(path.join(stateDir, "accounts.json"), "utf8");
    expect(serialized).not.toContain(ADMIN_PASSWORD);
    expect(serialized).not.toContain(session.token);
    expect(serialized).toContain("passwordHash");
    expect(serialized).toContain("tokenHash");
    expect(JSON.stringify(session.user)).not.toMatch(/passwordHash|tokenHash|password/);
    expect(JSON.stringify(listUsers())).not.toMatch(/passwordHash|tokenHash|password/);
    await expect(setupAdmin()).rejects.toMatchObject({ status: 409 });
  });

  it("rejects anonymous or forged sessions and checks administrator permissions server-side", async () => {
    await setupAdmin();
    await createUser({
      username: "test-viewer",
      displayName: "测试成员",
      password: USER_PASSWORD,
      role: "user",
    });
    const userSession = await login("test-viewer", USER_PASSWORD);
    const adminSession = await login("test-admin", ADMIN_PASSWORD);

    await expect(requireUser(requestFor())).rejects.toMatchObject({ status: 401 });
    await expect(requireAdmin(requestFor())).rejects.toMatchObject({ status: 401 });
    await expect(requireUser(requestFor("forged-session-token"))).rejects.toMatchObject({
      status: 401,
    });
    expect(await requireUser(requestFor(userSession.token))).toMatchObject({ role: "user" });
    await expect(requireAdmin(requestFor(userSession.token))).rejects.toMatchObject({
      status: 403,
    });
    expect(await requireAdmin(requestFor(adminSession.token))).toMatchObject({ role: "admin" });
  });

  it("keeps invalid credentials indistinguishable", async () => {
    await setupAdmin();
    await expect(login("test-admin", "Incorrect-Password!")).rejects.toMatchObject({ status: 401 });
    await expect(login("missing-account", "Incorrect-Password!")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("defaults service-created users to ordinary role and no dataset grants", async () => {
    await setupAdmin();
    const user = await createUser({
      username: "test-viewer",
      displayName: "兼容成员",
      password: USER_PASSWORD,
    });

    expect(user).toMatchObject({
      role: "user",
      datasetIds: [],
      mustChangePassword: false,
      disabled: false,
    });
    expect(getUserById(user.id)).toMatchObject({
      role: "user",
      datasetIds: [],
      mustChangePassword: false,
    });
  });

  it("enforces the readonly operation matrix and forced-password boundary", () => {
    const readonly = { role: "readonly" as const, mustChangePassword: false };
    const user = { role: "user" as const, mustChangePassword: false };
    const forced = { role: "admin" as const, mustChangePassword: true };

    expect(() => assertOperation(readonly, "view")).not.toThrow();
    for (const operation of ["ai", "export", "manage"] as const)
      expect(() => assertOperation(readonly, operation)).toThrow(
        expect.objectContaining({ code: "FORBIDDEN" }),
      );
    for (const operation of ["view", "ai", "export"] as const)
      expect(() => assertOperation(user, operation)).not.toThrow();
    expect(() => assertOperation(user, "manage")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }),
    );
    for (const operation of ["view", "ai", "export", "manage"] as const)
      expect(() => assertOperation(forced, operation)).toThrow(
        expect.objectContaining({ code: "PASSWORD_CHANGE_REQUIRED" }),
      );
  });

  it("rejects expired sessions without relying on the browser to clear its cookie", async () => {
    await setupAdmin();
    const session = await login("test-admin", ADMIN_PASSWORD);
    vi.spyOn(Date, "now").mockReturnValue(session.expiresAt + 1);

    expect(await getSessionUser(session.token)).toBeNull();
    await expect(requireUser(requestFor(session.token))).rejects.toMatchObject({ status: 401 });
  });

  it("protects the administrator account and keeps sessions intact when a password change fails", async () => {
    const admin = await setupAdmin();
    const session = await login("test-admin", ADMIN_PASSWORD);

    expect(() => setUserDisabled(admin.id, true)).toThrow();
    await expect(
      changePassword(admin.id, "Incorrect-Password!", "Updated-Admin-2026!"),
    ).rejects.toMatchObject({ status: 400 });
    expect(await getSessionUser(session.token)).toMatchObject({ id: admin.id, role: "admin" });
  });

  it("revokes sessions on logout, password change, and account disablement", async () => {
    await setupAdmin();
    const viewer = await createUser({
      username: "test-viewer",
      displayName: "测试成员",
      password: USER_PASSWORD,
      role: "user",
    });
    const loggedOut = await login("test-viewer", USER_PASSWORD);
    logout(loggedOut.token);
    expect(await getSessionUser(loggedOut.token)).toBeNull();

    const first = await login("test-viewer", USER_PASSWORD);
    const second = await login("test-viewer", USER_PASSWORD);
    const newPassword = "Updated-Viewer-2026!";
    await changePassword(viewer.id, USER_PASSWORD, newPassword);
    expect(await getSessionUser(first.token)).toBeNull();
    expect(await getSessionUser(second.token)).toBeNull();
    await expect(login("test-viewer", USER_PASSWORD)).rejects.toMatchObject({ status: 401 });

    const enabledSession = await login("test-viewer", newPassword);
    setUserDisabled(viewer.id, true);
    expect(await getSessionUser(enabledSession.token)).toBeNull();
    await expect(login("test-viewer", newPassword)).rejects.toMatchObject({ status: 401 });
    setUserDisabled(viewer.id, false);
    expect((await login("test-viewer", newPassword)).user).toMatchObject({
      id: viewer.id,
      role: "user",
    });
  });

  it("limits forced-password sessions to session, password and logout paths", async () => {
    await setupAdmin();
    const viewer = await createUser({
      username: "test-viewer",
      displayName: "测试成员",
      password: USER_PASSWORD,
    });
    const reset = await resetUserPassword(viewer.id);
    const session = await login("test-viewer", reset.temporaryPassword);
    expect(session.user.mustChangePassword).toBe(true);

    for (const pathname of ["/api/auth/session", "/api/auth/password", "/api/auth/logout"]) {
      expect(
        await requireUser(
          new Request(`http://localhost:3000${pathname}`, {
            headers: { cookie: `${COOKIE_NAME}=${session.token}` },
          }),
        ),
      ).toMatchObject({ id: viewer.id, mustChangePassword: true });
    }
    await expect(requireUser(requestFor(session.token))).rejects.toMatchObject({
      code: "PASSWORD_CHANGE_REQUIRED",
    });
  });

  it("re-reads latest role and grant changes for an existing session", async () => {
    const admin = await setupAdmin();
    const viewer = await createUser({
      username: "test-viewer",
      displayName: "测试成员",
      password: USER_PASSWORD,
      role: "user",
      datasetIds: ["demo"],
    });
    const previous = await login("test-viewer", USER_PASSWORD);

    updateUser(
      viewer.id,
      { displayName: "已编辑名称", role: "readonly", datasetIds: ["oulad"] },
      admin,
    );
    const current = await requireUser(requestFor(previous.token));

    expect(current).toMatchObject({
      id: viewer.id,
      displayName: "已编辑名称",
      role: "readonly",
      datasetIds: ["oulad"],
      mustChangePassword: false,
    });
    expect(getUserById(viewer.id)).toEqual(current);
  });

  it("revokes sessions on reset and explicit revocation and protects administrators", async () => {
    const admin = await setupAdmin();
    const viewer = await createUser({
      username: "test-viewer",
      displayName: "测试成员",
      password: USER_PASSWORD,
    });
    const first = await login("test-viewer", USER_PASSWORD);
    const reset = await resetUserPassword(viewer.id, admin);

    expect(reset.user).toMatchObject({ id: viewer.id, mustChangePassword: true });
    expect(reset.temporaryPassword).toMatch(/^T-/);
    expect(await getSessionUser(first.token)).toBeNull();
    const resetSession = await login("test-viewer", reset.temporaryPassword);
    expect(resetSession.user.mustChangePassword).toBe(true);

    expect(() => revokeUserSessions(viewer.id, admin)).not.toThrow();
    expect(await getSessionUser(resetSession.token)).toBeNull();
    expect(() => updateUser(admin.id, { displayName: "不可修改" }, admin)).toThrow(
      expect.objectContaining({ code: "ADMIN_PROTECTED" }),
    );
    await expect(resetUserPassword(admin.id, admin)).rejects.toMatchObject({
      code: "ADMIN_PROTECTED",
    });
    expect(() => revokeUserSessions(admin.id, admin)).toThrow(
      expect.objectContaining({ code: "ADMIN_PROTECTED" }),
    );
  });

  it("fails closed on an unknown persisted role without migrating or granting data", async () => {
    const passwordHash = await hashPassword(USER_PASSWORD);
    const file = path.join(stateDir, "accounts.json");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        version: 1,
        users: [
          {
            id: "123e4567-e89b-42d3-a456-426614174001",
            username: "corrupt.user",
            displayName: "损坏账号",
            role: "superuser",
            disabled: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            passwordHash,
          },
        ],
        sessions: [],
      }),
    );
    const original = readFileSync(file, "utf8");

    expect(() => getUserById("123e4567-e89b-42d3-a456-426614174001")).toThrow(
      "accounts.json 包含不兼容的账号数据。",
    );
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("persists a v1 migration and embedded audit before reloading without re-granting", async () => {
    const passwordHash = await hashPassword(USER_PASSWORD);
    const userId = "123e4567-e89b-42d3-a456-426614174000";
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(
      path.join(stateDir, "accounts.json"),
      JSON.stringify({
        version: 1,
        users: [
          {
            id: userId,
            username: "legacy.user",
            displayName: "旧版成员",
            role: "user",
            disabled: false,
            createdAt: "2026-01-01T00:00:00.000Z",
            passwordHash,
          },
        ],
        sessions: [],
        __adminAudit: {
          version: 1,
          events: [
            {
              version: 1,
              id: "audit-existing",
              timestamp: "2026-01-01T00:00:00.000Z",
              actorId: "admin-existing",
              action: "user.create",
              targetType: "user",
              targetId: userId,
              summary: { role: "user", datasetIds: "demo,oulad" },
              result: "success",
            },
          ],
        },
      }),
    );

    expect(getUserById(userId)).toMatchObject({
      datasetIds: ["demo", "oulad"],
      mustChangePassword: false,
    });
    let persisted = JSON.parse(readFileSync(path.join(stateDir, "accounts.json"), "utf8"));
    expect(persisted.version).toBe(2);
    expect(persisted.users[0].datasetIds).toEqual(["demo", "oulad"]);
    expect(persisted.__adminAudit.events).toHaveLength(1);

    updateUser(userId, { datasetIds: [] });
    persisted = JSON.parse(readFileSync(path.join(stateDir, "accounts.json"), "utf8"));
    expect(persisted.version).toBe(2);
    expect(persisted.users[0].datasetIds).toEqual([]);
    expect(persisted.__adminAudit.events).toHaveLength(1);
    expect(getUserById(userId)?.datasetIds).toEqual([]);
  });

  it("persists audited account changes without temporary passwords", async () => {
    const admin = await setupAdmin();
    const viewer = await createUser(
      { username: "test-viewer", displayName: "测试成员", password: USER_PASSWORD },
      admin,
    );
    const actor = { id: admin.id };
    updateUser(viewer.id, { role: "readonly", datasetIds: [] }, actor);
    const reset = await resetUserPassword(viewer.id, actor);
    const serialized = readFileSync(path.join(stateDir, "accounts.json"), "utf8");
    const persisted = JSON.parse(serialized);

    expect(persisted.users.find((user: { id: string }) => user.id === viewer.id)).toMatchObject({
      role: "readonly",
      datasetIds: [],
      mustChangePassword: true,
    });
    expect(persisted.__adminAudit.events.map((event: { action: string }) => event.action)).toEqual(
      expect.arrayContaining([
        "user.admin_initialize",
        "user.create",
        "user.update",
        "user.password.reset",
      ]),
    );
    expect(serialized).not.toContain(reset.temporaryPassword);
    expect(serialized).not.toMatch(/password"|temporaryPassword/);
  });

  it("does not lose accounts created concurrently", async () => {
    await setupAdmin();
    await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createUser({
          username: `viewer-${index}`,
          displayName: `成员 ${index}`,
          password: USER_PASSWORD,
          role: "user",
        }),
      ),
    );

    expect(listUsers().users).toHaveLength(7);
    await expect(login("viewer-5", USER_PASSWORD)).resolves.toMatchObject({
      user: { username: "viewer-5" },
    });
  });

  it("blocks cross-origin mutations including requests without an Origin", () => {
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/admin/settings", {
          method: "PUT",
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/admin/settings", {
          method: "PUT",
          headers: { origin: "https://attacker.example" },
        }),
      ),
    ).toThrow();
    expect(() =>
      assertSameOrigin(
        new Request("http://localhost:3000/api/admin/settings", {
          method: "PUT",
        }),
      ),
    ).toThrow();
  });

  it("uses an HttpOnly, secure, same-site cookie on HTTPS", () => {
    const response = NextResponse.json({ ok: true });
    setSessionCookie(
      response,
      "test-session-cookie",
      Date.now() + 60_000,
      new Request("https://analytics.example/api/auth/login"),
    );
    const cookie = response.headers.get("set-cookie");

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Path=/");
  });
});
