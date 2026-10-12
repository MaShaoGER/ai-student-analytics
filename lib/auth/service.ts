import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type { ManagedUser, SessionUser } from "../client-types";
import { readState, updateState } from "../settings/storage";

type StoredUser = ManagedUser & { passwordHash: string };
type StoredSession = { tokenHash: string; userId: string; expiresAt: number };
type Accounts = { version: 1; users: StoredUser[]; sessions: StoredSession[] };
const initial = (): Accounts => ({ version: 1, users: [], sessions: [] });
const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class AuthError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function publicUser(user: StoredUser): SessionUser {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}
function managedUser(user: StoredUser): ManagedUser {
  return { ...publicUser(user), disabled: user.disabled, createdAt: user.createdAt };
}
function keyForToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
function validateUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(normalized)) {
    throw new AuthError(400, "INVALID_USERNAME", "账号需为 3–40 个字母、数字、点、下划线或短横线。");
  }
  return normalized;
}
function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new AuthError(400, "INVALID_PASSWORD", "密码需为 12–128 个字符。");
  }
}
function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(16);
  const hash = await derive(password, salt);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  if (password.length > 128) return false;
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  const expected = Buffer.from(parts[2], "hex");
  const actual = await derive(password, Buffer.from(parts[1], "hex"));
  return timingSafeEqual(expected, actual);
}

export async function initializeAdmin(input: { username: string; password: string; displayName?: string }): Promise<SessionUser> {
  const username = validateUsername(input.username);
  const displayName = input.displayName?.trim() || "系统管理员";
  if (displayName.length > 60) throw new AuthError(400, "INVALID_NAME", "显示名称不能超过 60 个字符。");
  const passwordHash = await hashPassword(input.password);
  return updateState("accounts.json", initial, (state) => {
    if (state.users.some((user) => user.role === "admin")) {
      throw new AuthError(409, "ALREADY_INITIALIZED", "管理员已经初始化，不能重复创建。");
    }
    if (state.users.some((user) => user.username === username)) throw new AuthError(409, "USERNAME_EXISTS", "这个账号已存在。");
    const user: StoredUser = { id: randomUUID(), username, displayName, role: "admin", disabled: false, createdAt: new Date().toISOString(), passwordHash };
    state.users.push(user);
    return publicUser(user);
  });
}

async function initializeFromEnvironment(): Promise<void> {
  if (readState("accounts.json", initial).users.some((user) => user.role === "admin")) return;
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  try { await initializeAdmin({ username, password }); }
  catch (error) {
    if (!(error instanceof AuthError && error.code === "ALREADY_INITIALIZED")) throw error;
  }
}

export async function isSetupRequired(): Promise<boolean> {
  await initializeFromEnvironment();
  return !readState("accounts.json", initial).users.some((user) => user.role === "admin");
}

export async function login(usernameInput: string, password: string): Promise<{ user: SessionUser; token: string; expiresAt: number }> {
  if (await isSetupRequired()) throw new AuthError(503, "SETUP_REQUIRED", "尚未创建管理员，请在服务器运行管理员初始化脚本。");
  const username = usernameInput.trim().toLowerCase();
  const stored = readState("accounts.json", initial).users.find((user) => user.username === username);
  // Run the same scrypt work for unknown users to reduce account enumeration.
  const encoded = stored?.passwordHash ?? `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;
  const valid = await verifyPassword(password, encoded);
  if (!stored || !valid || stored.disabled) throw new AuthError(401, "INVALID_CREDENTIALS", "账号或密码不正确，或账号已被停用。");
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_LIFETIME;
  const user = updateState("accounts.json", initial, (state) => {
    const current = state.users.find((candidate) => candidate.id === stored.id);
    if (!current || current.disabled || current.passwordHash !== encoded) throw new AuthError(401, "INVALID_CREDENTIALS", "账号或密码不正确，或账号已被停用。");
    state.sessions = state.sessions.filter((session) => session.expiresAt > Date.now());
    const existing = state.sessions.filter((session) => session.userId === current.id);
    if (existing.length >= 20) {
      const oldest = existing.sort((a, b) => a.expiresAt - b.expiresAt)[0];
      state.sessions = state.sessions.filter((session) => session !== oldest);
    }
    state.sessions.push({ tokenHash: keyForToken(token), userId: current.id, expiresAt });
    return publicUser(current);
  });
  return { user, token, expiresAt };
}

export async function getSessionUser(token: string | null | undefined): Promise<SessionUser | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const state = readState("accounts.json", initial);
  const session = state.sessions.find((candidate) => candidate.tokenHash === keyForToken(token) && candidate.expiresAt > Date.now());
  const user = session && state.users.find((candidate) => candidate.id === session.userId && !candidate.disabled);
  return user ? publicUser(user) : null;
}

export function logout(token: string | null | undefined): void {
  if (!token) return;
  updateState("accounts.json", initial, (state) => {
    state.sessions = state.sessions.filter((session) => session.tokenHash !== keyForToken(token) && session.expiresAt > Date.now());
  });
}

export function listUsers(): ManagedUser[] {
  return readState("accounts.json", initial).users.map(managedUser);
}

export async function createUser(input: { username: string; displayName: string; password: string; role: "user" }): Promise<ManagedUser> {
  const username = validateUsername(input.username);
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 60) throw new AuthError(400, "INVALID_NAME", "显示名称需为 1–60 个字符。");
  if (input.role !== "user") throw new AuthError(400, "INVALID_ROLE", "此入口仅允许创建普通用户。");
  const passwordHash = await hashPassword(input.password);
  return updateState("accounts.json", initial, (state) => {
    if (state.users.some((user) => user.username === username)) throw new AuthError(409, "USERNAME_EXISTS", "这个账号已存在。");
    const user: StoredUser = { id: randomUUID(), username, displayName, role: "user", disabled: false, createdAt: new Date().toISOString(), passwordHash };
    state.users.push(user);
    return managedUser(user);
  });
}

export function setUserDisabled(id: string, disabled: boolean): ManagedUser {
  return updateState("accounts.json", initial, (state) => {
    const user = state.users.find((candidate) => candidate.id === id);
    if (!user) throw new AuthError(404, "USER_NOT_FOUND", "找不到这个账号。");
    if (user.role === "admin") throw new AuthError(403, "ADMIN_PROTECTED", "管理员账号不能在此处停用。");
    user.disabled = disabled;
    if (disabled) state.sessions = state.sessions.filter((session) => session.userId !== id);
    return managedUser(user);
  });
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
  const original = readState("accounts.json", initial).users.find((user) => user.id === userId && !user.disabled);
  if (!original || !await verifyPassword(currentPassword, original.passwordHash)) throw new AuthError(400, "WRONG_PASSWORD", "当前密码不正确。");
  if (currentPassword === newPassword) throw new AuthError(400, "UNCHANGED_PASSWORD", "新密码需要与当前密码不同。");
  const passwordHash = await hashPassword(newPassword);
  updateState("accounts.json", initial, (state) => {
    const user = state.users.find((candidate) => candidate.id === userId && !candidate.disabled && candidate.passwordHash === original.passwordHash);
    if (!user) throw new AuthError(409, "ACCOUNT_CHANGED", "账号状态已变更，请重新登录。");
    user.passwordHash = passwordHash;
    state.sessions = state.sessions.filter((session) => session.userId !== userId);
  });
}
