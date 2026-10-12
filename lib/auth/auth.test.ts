import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  changePassword,
  createUser,
  getSessionUser,
  hashPassword,
  initializeAdmin,
  isSetupRequired,
  listUsers,
  login,
  logout,
  setUserDisabled,
  verifyPassword,
} from "./service";
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
  return initializeAdmin({ username: "test-admin", displayName: "测试管理员", password: ADMIN_PASSWORD });
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
    await createUser({ username: "test-viewer", displayName: "测试成员", password: USER_PASSWORD, role: "user" });
    const userSession = await login("test-viewer", USER_PASSWORD);
    const adminSession = await login("test-admin", ADMIN_PASSWORD);

    await expect(requireUser(requestFor())).rejects.toMatchObject({ status: 401 });
    await expect(requireAdmin(requestFor())).rejects.toMatchObject({ status: 401 });
    await expect(requireUser(requestFor("forged-session-token"))).rejects.toMatchObject({ status: 401 });
    expect(await requireUser(requestFor(userSession.token))).toMatchObject({ role: "user" });
    await expect(requireAdmin(requestFor(userSession.token))).rejects.toMatchObject({ status: 403 });
    expect(await requireAdmin(requestFor(adminSession.token))).toMatchObject({ role: "admin" });
  });

  it("keeps invalid credentials indistinguishable", async () => {
    await setupAdmin();
    await expect(login("test-admin", "Incorrect-Password!")).rejects.toMatchObject({ status: 401 });
    await expect(login("missing-account", "Incorrect-Password!")).rejects.toMatchObject({ status: 401 });
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
    await expect(changePassword(admin.id, "Incorrect-Password!", "Updated-Admin-2026!")).rejects.toMatchObject({ status: 400 });
    expect(await getSessionUser(session.token)).toMatchObject({ id: admin.id, role: "admin" });
  });

  it("revokes sessions on logout, password change, and account disablement", async () => {
    await setupAdmin();
    const viewer = await createUser({ username: "test-viewer", displayName: "测试成员", password: USER_PASSWORD, role: "user" });
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
    expect((await login("test-viewer", newPassword)).user).toMatchObject({ id: viewer.id, role: "user" });
  });

  it("does not lose accounts created concurrently", async () => {
    await setupAdmin();
    await Promise.all(Array.from({ length: 6 }, (_, index) => createUser({
      username: `viewer-${index}`,
      displayName: `成员 ${index}`,
      password: USER_PASSWORD,
      role: "user",
    })));

    expect(listUsers()).toHaveLength(7);
    await expect(login("viewer-5", USER_PASSWORD)).resolves.toMatchObject({ user: { username: "viewer-5" } });
  });

  it("blocks cross-origin mutations including requests without an Origin", () => {
    expect(() => assertSameOrigin(new Request("http://localhost:3000/api/admin/settings", {
      method: "PUT", headers: { origin: "http://localhost:3000" },
    }))).not.toThrow();
    expect(() => assertSameOrigin(new Request("http://localhost:3000/api/admin/settings", {
      method: "PUT", headers: { origin: "https://attacker.example" },
    }))).toThrow();
    expect(() => assertSameOrigin(new Request("http://localhost:3000/api/admin/settings", {
      method: "PUT",
    }))).toThrow();
  });

  it("uses an HttpOnly, secure, same-site cookie on HTTPS", () => {
    const response = NextResponse.json({ ok: true });
    setSessionCookie(response, "test-session-cookie", Date.now() + 60_000, new Request("https://analytics.example/api/auth/login"));
    const cookie = response.headers.get("set-cookie");

    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toContain("Path=/");
  });
});
