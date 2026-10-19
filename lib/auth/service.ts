import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import type {
  AdminUserListFilter,
  DatasetId,
  ManagedUser,
  SessionUser,
  UserRole,
} from "../client-types";
import { readState, updateState } from "../settings/storage";
import { appendAdminEvent } from "../admin/audit";

type StoredUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
  datasetIds: DatasetId[];
  mustChangePassword: boolean;
  disabled: boolean;
  createdAt: string;
  passwordHash: string;
};
type StoredSession = { tokenHash: string; userId: string; expiresAt: number };
type LegacyUser = Omit<StoredUser, "datasetIds" | "mustChangePassword"> & {
  datasetIds?: DatasetId[];
  mustChangePassword?: boolean;
};
type LegacyAccounts = {
  version?: 1 | 2;
  users?: LegacyUser[];
  sessions?: StoredSession[];
  __adminAudit?: unknown;
  [key: string]: unknown;
};
type Accounts = {
  version: 2;
  users: StoredUser[];
  sessions: StoredSession[];
  __adminAudit?: unknown;
  [key: string]: unknown;
};

export type Operation = "view" | "ai" | "export" | "manage";
export type AuthActor = Pick<SessionUser, "id"> &
  Partial<Pick<SessionUser, "username" | "displayName" | "role">>;
export type CreateUserInput = {
  username: string;
  displayName: string;
  password: string;
  role?: "user" | "readonly";
  datasetIds?: DatasetId[];
};
export type UpdateUserInput = {
  displayName?: string;
  role?: "user" | "readonly";
  disabled?: boolean;
  datasetIds?: DatasetId[];
};
type AccountMutationResult<T> = { ok: true; value: T } | { ok: false; error: AuthError };

const BUILTIN_DATASETS: readonly DatasetId[] = ["demo", "oulad"];
const initial = (): Accounts => ({ version: 2, users: [], sessions: [] });
const SESSION_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

function normalizeState(raw: LegacyAccounts): Accounts {
  if (raw.version !== undefined && raw.version !== 1 && raw.version !== 2) {
    throw new Error("accounts.json 的版本不受支持。");
  }
  if (!Array.isArray(raw.users) || !Array.isArray(raw.sessions)) {
    throw new Error("accounts.json 的账号或会话结构无效。");
  }
  // Assignment happens only while moving v1 to v2. Keeping the version at 2
  // makes a later revocation durable instead of re-granting it on every read.
  const legacy = raw.version !== 2;
  return {
    ...raw,
    version: 2,
    users: raw.users.map((user): StoredUser => {
      // A corrupt role must stop startup rather than quietly becoming a
      // different role and possibly receiving migration grants.
      if (user.role !== "admin" && user.role !== "user" && user.role !== "readonly") {
        throw new Error("accounts.json 包含不兼容的账号数据。");
      }
      const datasetIds = normalizeDatasetIds(user.datasetIds, legacy ? [...BUILTIN_DATASETS] : []);
      return {
        ...user,
        role: user.role,
        datasetIds,
        mustChangePassword: user.mustChangePassword === true,
      };
    }),
    sessions: raw.sessions,
  };
}

function readAccounts(): Accounts {
  const raw = readState<LegacyAccounts>("accounts.json", initial);
  const normalized = normalizeState(raw);
  if (raw.version !== 2) {
    // Persist the one-time grants before exposing a legacy account to access
    // checks. A later revoked grant is therefore never re-added on a read.
    return mutateAccounts((state) => state);
  }
  return normalized;
}

function mutateAccounts<T>(update: (state: Accounts) => T): T {
  return updateState<LegacyAccounts, T>("accounts.json", initial, (raw) => {
    // updateState persists the object it handed us. Normalize into that same
    // object before mutating so account changes, migrations, and the embedded
    // admin audit bucket all reach disk together.
    Object.assign(raw, normalizeState(raw));
    return update(raw as Accounts);
  });
}

function rejectedMutation<T>(
  state: Accounts,
  actor: AuthActor | undefined,
  action: string,
  targetId: string,
  error: AuthError,
): AccountMutationResult<T> {
  if (actor) {
    appendAdminEvent(state, {
      actorId: actor.id,
      action,
      targetType: "user",
      targetId,
      summary: {},
      result: "failure",
      errorCode: error.code,
    });
  }
  return { ok: false, error };
}

function completedMutation<T>(result: AccountMutationResult<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function normalizeDatasetIds(value: unknown, fallback: DatasetId[] = []): DatasetId[] {
  if (value === undefined) return [...fallback];
  if (!Array.isArray(value)) throw new AuthError(400, "INVALID_DATASETS", "数据集授权格式不正确。");
  const unique = new Set<DatasetId>();
  for (const item of value) {
    if (item !== "demo" && item !== "oulad")
      throw new AuthError(400, "INVALID_DATASETS", "数据集授权包含未知数据集。");
    unique.add(item);
  }
  return [...unique];
}

function publicUser(user: StoredUser): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    datasetIds: [...user.datasetIds],
    mustChangePassword: user.mustChangePassword,
  };
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
    throw new AuthError(
      400,
      "INVALID_USERNAME",
      "账号需为 3–40 个字母、数字、点、下划线或短横线。",
    );
  }
  return normalized;
}

function validateDisplayName(displayName: string): string {
  const normalized = displayName.trim();
  if (!normalized || normalized.length > 60)
    throw new AuthError(400, "INVALID_NAME", "显示名称需为 1–60 个字符。");
  return normalized;
}

function validateRole(role: unknown): "user" | "readonly" {
  if (role !== "user" && role !== "readonly")
    throw new AuthError(400, "INVALID_ROLE", "角色只能是普通用户或只读用户。");
  return role;
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 128) {
    throw new AuthError(400, "INVALID_PASSWORD", "密码需为 12–128 个字符。");
  }
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, SCRYPT_OPTIONS, (error, key) =>
      error ? reject(error) : resolve(key),
    );
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
  if (
    parts.length !== 3 ||
    parts[0] !== "scrypt" ||
    !/^[a-f0-9]{32}$/.test(parts[1]) ||
    !/^[a-f0-9]{128}$/.test(parts[2])
  )
    return false;
  const expected = Buffer.from(parts[2], "hex");
  const actual = await derive(password, Buffer.from(parts[1], "hex"));
  return timingSafeEqual(expected, actual);
}

export function assertOperation(
  user: Pick<SessionUser, "role" | "mustChangePassword">,
  operation: Operation,
): void {
  if (user.mustChangePassword === true) {
    throw new AuthError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改临时密码，再继续使用系统。");
  }
  if (operation === "view") return;
  if (user.role === "admin") return;
  if (user.role === "user" && (operation === "ai" || operation === "export")) return;
  throw new AuthError(
    403,
    "FORBIDDEN",
    operation === "manage" ? "只有管理员可以执行管理操作。" : "当前角色没有执行此操作的权限。",
  );
}

export async function initializeAdmin(input: {
  username: string;
  password: string;
  displayName?: string;
}): Promise<SessionUser> {
  const username = validateUsername(input.username);
  const displayName = input.displayName?.trim() || "系统管理员";
  validateDisplayName(displayName);
  const passwordHash = await hashPassword(input.password);
  return mutateAccounts((state) => {
    if (state.users.some((user) => user.role === "admin")) {
      throw new AuthError(409, "ALREADY_INITIALIZED", "管理员已经初始化，不能重复创建。");
    }
    if (state.users.some((user) => user.username === username))
      throw new AuthError(409, "USERNAME_EXISTS", "这个账号已存在。");
    const user: StoredUser = {
      id: randomUUID(),
      username,
      displayName,
      role: "admin",
      datasetIds: [...BUILTIN_DATASETS],
      mustChangePassword: false,
      disabled: false,
      createdAt: new Date().toISOString(),
      passwordHash,
    };
    state.users.push(user);
    appendAdminEvent(state, {
      actorId: user.id,
      action: "user.admin_initialize",
      targetType: "user",
      targetId: user.id,
      summary: { role: "admin" },
    });
    return publicUser(user);
  });
}

async function initializeFromEnvironment(): Promise<void> {
  if (readAccounts().users.some((user) => user.role === "admin")) return;
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return;
  try {
    await initializeAdmin({ username, password });
  } catch (error) {
    if (!(error instanceof AuthError && error.code === "ALREADY_INITIALIZED")) throw error;
  }
}

export async function isSetupRequired(): Promise<boolean> {
  await initializeFromEnvironment();
  return !readAccounts().users.some((user) => user.role === "admin");
}

export async function login(
  usernameInput: string,
  password: string,
): Promise<{ user: SessionUser; token: string; expiresAt: number }> {
  if (await isSetupRequired())
    throw new AuthError(503, "SETUP_REQUIRED", "尚未创建管理员，请在服务器运行管理员初始化脚本。");
  const username = usernameInput.trim().toLowerCase();
  const stored = readAccounts().users.find((user) => user.username === username);
  // Run the same scrypt work for unknown users to reduce account enumeration.
  const encoded = stored?.passwordHash ?? `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;
  const valid = await verifyPassword(password, encoded);
  if (!stored || !valid || stored.disabled)
    throw new AuthError(401, "INVALID_CREDENTIALS", "账号或密码不正确，或账号已被停用。");
  const token = randomBytes(32).toString("hex");
  const expiresAt = Date.now() + SESSION_LIFETIME;
  const user = mutateAccounts((state) => {
    const current = state.users.find((candidate) => candidate.id === stored.id);
    if (!current || current.disabled || current.passwordHash !== encoded)
      throw new AuthError(401, "INVALID_CREDENTIALS", "账号或密码不正确，或账号已被停用。");
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

export async function getSessionUser(
  token: string | null | undefined,
): Promise<SessionUser | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const state = readAccounts();
  const session = state.sessions.find(
    (candidate) => candidate.tokenHash === keyForToken(token) && candidate.expiresAt > Date.now(),
  );
  const user =
    session &&
    state.users.find((candidate) => candidate.id === session.userId && !candidate.disabled);
  return user ? publicUser(user) : null;
}

/** Resolve a user's current public identity and permission fields without a session. */
export function getUserById(id: string): SessionUser | null {
  const user = readAccounts().users.find((candidate) => candidate.id === id && !candidate.disabled);
  return user ? publicUser(user) : null;
}

export function logout(token: string | null | undefined): void {
  if (!token) return;
  mutateAccounts((state) => {
    state.sessions = state.sessions.filter(
      (session) => session.tokenHash !== keyForToken(token) && session.expiresAt > Date.now(),
    );
  });
}

export function listUsers(filter: AdminUserListFilter = {}): {
  users: ManagedUser[];
  total: number;
  page: number;
  pageSize: number;
} {
  const page = filter.page ?? 1;
  const pageSize = filter.pageSize ?? 20;
  const query = filter.q?.trim().toLocaleLowerCase("zh-CN") ?? "";
  const matches = readAccounts()
    .users.filter((user) => !filter.role || user.role === filter.role)
    .filter((user) => filter.disabled === undefined || user.disabled === filter.disabled)
    .filter(
      (user) =>
        !query ||
        user.username.toLocaleLowerCase("zh-CN").includes(query) ||
        user.displayName.toLocaleLowerCase("zh-CN").includes(query),
    )
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  return {
    users: matches.slice((page - 1) * pageSize, page * pageSize).map(managedUser),
    total: matches.length,
    page,
    pageSize,
  };
}

export async function createUser(input: CreateUserInput, actor?: AuthActor): Promise<ManagedUser> {
  const username = validateUsername(input.username);
  const displayName = validateDisplayName(input.displayName);
  const role = validateRole(input.role ?? "user");
  const datasetIds = normalizeDatasetIds(input.datasetIds, []);
  const passwordHash = await hashPassword(input.password);
  return mutateAccounts((state) => {
    if (state.users.some((user) => user.username === username))
      throw new AuthError(409, "USERNAME_EXISTS", "这个账号已存在。");
    const user: StoredUser = {
      id: randomUUID(),
      username,
      displayName,
      role,
      datasetIds,
      mustChangePassword: false,
      disabled: false,
      createdAt: new Date().toISOString(),
      passwordHash,
    };
    state.users.push(user);
    if (actor) {
      appendAdminEvent(state, {
        actorId: actor.id,
        action: "user.create",
        targetType: "user",
        targetId: user.id,
        summary: { role: user.role, datasetIds: user.datasetIds.join(",") },
      });
    }
    return managedUser(user);
  });
}

export function setUserDisabled(id: string, disabled: boolean, actor?: AuthActor): ManagedUser {
  return completedMutation(
    mutateAccounts<AccountMutationResult<ManagedUser>>((state) => {
      const user = state.users.find((candidate) => candidate.id === id);
      if (!user) {
        return rejectedMutation(
          state,
          actor,
          "user.disabled",
          id,
          new AuthError(404, "USER_NOT_FOUND", "找不到这个账号。"),
        );
      }
      if (user.role === "admin") {
        return rejectedMutation(
          state,
          actor,
          "user.disabled",
          id,
          new AuthError(403, "ADMIN_PROTECTED", "管理员账号不能在此处停用。"),
        );
      }
      const previous = user.disabled;
      user.disabled = disabled;
      if (disabled) state.sessions = state.sessions.filter((session) => session.userId !== id);
      if (actor) {
        appendAdminEvent(state, {
          actorId: actor.id,
          action: "user.disabled",
          targetType: "user",
          targetId: user.id,
          summary: { beforeDisabled: previous, disabled },
        });
      }
      return { ok: true, value: managedUser(user) };
    }),
  );
}

export function updateUser(id: string, input: UpdateUserInput, actor?: AuthActor): ManagedUser {
  const hasDisplayName = input.displayName !== undefined;
  const hasRole = input.role !== undefined;
  const hasDisabled = input.disabled !== undefined;
  const hasDatasets = input.datasetIds !== undefined;
  if (!hasDisplayName && !hasRole && !hasDisabled && !hasDatasets)
    throw new AuthError(400, "INVALID_INPUT", "没有可更新的账号字段。");
  const displayName = hasDisplayName ? validateDisplayName(input.displayName!) : undefined;
  const role = hasRole ? validateRole(input.role) : undefined;
  const datasetIds = hasDatasets ? normalizeDatasetIds(input.datasetIds) : undefined;
  return completedMutation(
    mutateAccounts<AccountMutationResult<ManagedUser>>((state) => {
      const user = state.users.find((candidate) => candidate.id === id);
      if (!user) {
        return rejectedMutation(
          state,
          actor,
          "user.update",
          id,
          new AuthError(404, "USER_NOT_FOUND", "找不到这个账号。"),
        );
      }
      if (user.role === "admin") {
        return rejectedMutation(
          state,
          actor,
          "user.update",
          id,
          new AuthError(403, "ADMIN_PROTECTED", "管理员账号不能在此处修改。"),
        );
      }
      const previous = {
        role: user.role,
        disabled: user.disabled,
        datasetIds: user.datasetIds.join(","),
      };
      if (displayName !== undefined) user.displayName = displayName;
      if (role !== undefined) user.role = role;
      if (datasetIds !== undefined) user.datasetIds = datasetIds;
      if (hasDisabled) {
        user.disabled = input.disabled!;
        if (user.disabled)
          state.sessions = state.sessions.filter((session) => session.userId !== id);
      }
      if (actor) {
        const action =
          hasDisabled && !hasDisplayName && !hasRole && !hasDatasets
            ? "user.disabled"
            : "user.update";
        appendAdminEvent(state, {
          actorId: actor.id,
          action,
          targetType: "user",
          targetId: user.id,
          summary:
            action === "user.disabled"
              ? { beforeDisabled: previous.disabled, disabled: user.disabled }
              : {
                  nameChanged: displayName !== undefined,
                  beforeRole: previous.role,
                  role: user.role,
                  beforeDisabled: previous.disabled,
                  disabled: user.disabled,
                  beforeDatasetIds: previous.datasetIds,
                  datasetIds: user.datasetIds.join(","),
                },
        });
      }
      return { ok: true, value: managedUser(user) };
    }),
  );
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const original = readAccounts().users.find((user) => user.id === userId && !user.disabled);
  if (!original || !(await verifyPassword(currentPassword, original.passwordHash)))
    throw new AuthError(400, "WRONG_PASSWORD", "当前密码不正确。");
  if (currentPassword === newPassword)
    throw new AuthError(400, "UNCHANGED_PASSWORD", "新密码需要与当前密码不同。");
  const passwordHash = await hashPassword(newPassword);
  mutateAccounts((state) => {
    const user = state.users.find(
      (candidate) =>
        candidate.id === userId &&
        !candidate.disabled &&
        candidate.passwordHash === original.passwordHash,
    );
    if (!user) throw new AuthError(409, "ACCOUNT_CHANGED", "账号状态已变更，请重新登录。");
    user.passwordHash = passwordHash;
    user.mustChangePassword = false;
    state.sessions = state.sessions.filter((session) => session.userId !== userId);
  });
}

function temporaryPassword(): string {
  return `T-${randomBytes(18).toString("base64url")}`;
}

export async function resetUserPassword(
  id: string,
  actor?: AuthActor,
): Promise<{ user: ManagedUser; temporaryPassword: string }> {
  const password = temporaryPassword();
  const passwordHash = await hashPassword(password);
  const user = completedMutation(
    mutateAccounts<AccountMutationResult<ManagedUser>>((state) => {
      const current = state.users.find((candidate) => candidate.id === id);
      if (!current) {
        return rejectedMutation(
          state,
          actor,
          "user.password.reset",
          id,
          new AuthError(404, "USER_NOT_FOUND", "找不到这个账号。"),
        );
      }
      if (current.role === "admin") {
        return rejectedMutation(
          state,
          actor,
          "user.password.reset",
          id,
          new AuthError(403, "ADMIN_PROTECTED", "管理员账号不能在此处重置密码。"),
        );
      }
      current.passwordHash = passwordHash;
      current.mustChangePassword = true;
      state.sessions = state.sessions.filter((session) => session.userId !== id);
      if (actor) {
        appendAdminEvent(state, {
          actorId: actor.id,
          action: "user.password.reset",
          targetType: "user",
          targetId: current.id,
          summary: { mustChangePassword: true },
        });
      }
      return { ok: true, value: managedUser(current) };
    }),
  );
  return { user, temporaryPassword: password };
}

export function revokeUserSessions(id: string, actor?: AuthActor): ManagedUser {
  return completedMutation(
    mutateAccounts<AccountMutationResult<ManagedUser>>((state) => {
      const user = state.users.find((candidate) => candidate.id === id);
      if (!user) {
        return rejectedMutation(
          state,
          actor,
          "user.sessions.revoke",
          id,
          new AuthError(404, "USER_NOT_FOUND", "找不到这个账号。"),
        );
      }
      if (user.role === "admin") {
        return rejectedMutation(
          state,
          actor,
          "user.sessions.revoke",
          id,
          new AuthError(403, "ADMIN_PROTECTED", "管理员账号不能在此处撤销会话。"),
        );
      }
      state.sessions = state.sessions.filter((session) => session.userId !== id);
      if (actor) {
        appendAdminEvent(state, {
          actorId: actor.id,
          action: "user.sessions.revoke",
          targetType: "user",
          targetId: user.id,
        });
      }
      return { ok: true, value: managedUser(user) };
    }),
  );
}
