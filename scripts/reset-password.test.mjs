import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetPassword } from "./reset-password.mjs";
import { createUser, getSessionUser, initializeAdmin, login } from "../lib/auth/service";
import { readAdminAudit } from "../lib/admin/audit";

const oldPassword = "Fixture-Old-Password!";
const newPassword = "Fixture-New-Password!";
let directory;
let file;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "analytics-password-"));
  file = join(directory, "accounts.json");
  vi.stubEnv("APP_STATE_DIR", directory);
  vi.stubEnv("ADMIN_USERNAME", "");
  vi.stubEnv("ADMIN_PASSWORD", "");
  await initializeAdmin({ username: "test-admin", password: oldPassword });
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

it("resets administrator credentials, revokes only their sessions and preserves account metadata", async () => {
  await createUser({ username: "test-viewer", displayName: "Viewer", password: oldPassword });
  const admin = await login("test-admin", oldPassword);
  const viewer = await login("test-viewer", oldPassword);
  const before = JSON.parse(readFileSync(file, "utf8"));
  before.extraMetadata = { preserve: true };
  writeFileSync(file, JSON.stringify(before));
  expect(await resetPassword(" TEST-ADMIN ", newPassword, newPassword)).toMatchObject({
    revoked: 1,
  });
  expect(await getSessionUser(admin.token)).toBeNull();
  expect((await getSessionUser(viewer.token)).id).toBe(viewer.user.id);
  await expect(login("test-admin", oldPassword)).rejects.toThrow();
  expect((await login("test-admin", newPassword)).user.id).toBe(admin.user.id);
  const after = JSON.parse(readFileSync(file, "utf8"));
  expect(after.extraMetadata).toEqual(before.extraMetadata);
  expect(after.users.find((user) => user.id === viewer.user.id)).toEqual(
    before.users.find((user) => user.id === viewer.user.id),
  );
  expect(after.users.find((user) => user.id === admin.user.id)).toMatchObject({
    role: "admin",
    mustChangePassword: false,
  });
  expect(readAdminAudit(after.__adminAudit).events.at(-1)).toMatchObject({
    actorId: "server-cli",
    action: "user.password.reset",
    targetId: admin.user.id,
  });
  expect(readFileSync(file, "utf8")).not.toContain(newPassword);
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

it("does not enable disabled accounts or change permissions", async () => {
  const user = await createUser({
    username: "test-viewer",
    displayName: "Viewer",
    password: oldPassword,
    role: "readonly",
    datasetIds: [],
  });
  const state = JSON.parse(readFileSync(file, "utf8"));
  state.users.find((entry) => entry.id === user.id).disabled = true;
  writeFileSync(file, JSON.stringify(state));
  expect(await resetPassword("test-viewer", newPassword, newPassword)).toMatchObject({
    disabled: true,
  });
  await expect(login("test-viewer", newPassword)).rejects.toThrow();
  expect(
    JSON.parse(readFileSync(file, "utf8")).users.find((entry) => entry.id === user.id),
  ).toMatchObject({ disabled: true, role: "readonly", datasetIds: [] });
});

it.each([
  ["test-admin", "too-short", "too-short"],
  ["test-admin", "x".repeat(129), "x".repeat(129)],
  ["test-admin", newPassword, "different-value"],
  ["missing-user", newPassword, newPassword],
  ["../invalid", newPassword, newPassword],
])(
  "refuses invalid input without modifying accounts (%s)",
  async (username, password, confirmation) => {
    const before = readFileSync(file);
    await expect(resetPassword(username, password, confirmation)).rejects.toThrow();
    expect(readFileSync(file)).toEqual(before);
  },
);

it("does not replace a missing or damaged store", async () => {
  writeFileSync(file, "{broken");
  await expect(resetPassword("test-admin", newPassword, newPassword)).rejects.toThrow();
  expect(readFileSync(file, "utf8")).toBe("{broken");
  rmSync(file);
  await expect(resetPassword("test-admin", newPassword, newPassword)).rejects.toThrow();
  expect(() => readFileSync(file)).toThrow();
});

it("refuses noninteractive use and command line secrets", () => {
  const before = readFileSync(file);
  for (const args of [[], ["test-admin", newPassword]]) {
    const result = spawnSync(process.execPath, ["scripts/reset-password.mjs", ...args], {
      env: { ...process.env, ANALYTICS_RESET_ENV_LOADED: "1" },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(newPassword);
  }
  expect(readFileSync(file)).toEqual(before);
});
