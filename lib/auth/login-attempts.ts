import { createHash } from "node:crypto";
import { readState, updateState } from "../settings/storage";
import { AuthError } from "./service";

/**
 * Login throttle state.
 *
 * Only failed credential checks count. Two independent dimensions are tracked:
 * one account may fail 10 times per window, and one client (proxy-aware IP) may
 * fail 100 times per window. A successful login clears the account dimension.
 * The previous single global bucket allowed unauthenticated account lockout.
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_FAILURE_LIMIT = 10;
export const CLIENT_FAILURE_LIMIT = 100;
const STATE_FILE = "login-attempts.json";

export type LoginAttemptsState = {
  version: 2;
  accounts: Record<string, number[]>;
  clients: Record<string, number[]>;
};

const initialLoginAttempts = (): LoginAttemptsState => ({
  version: 2,
  accounts: {},
  clients: {},
});

function isTimestampList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((timestamp) => typeof timestamp === "number" && Number.isFinite(timestamp))
  );
}

function isTimestampMap(value: unknown): value is Record<string, number[]> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(isTimestampList)
  );
}

/** Legacy single-bucket files are discarded instead of being trusted as lock state. */
function normalizeLoginAttempts(value: unknown): LoginAttemptsState {
  if (typeof value === "object" && value !== null) {
    const candidate = value as Partial<LoginAttemptsState>;
    if (
      candidate.version === 2 &&
      isTimestampMap(candidate.accounts) &&
      isTimestampMap(candidate.clients)
    ) {
      return candidate as LoginAttemptsState;
    }
  }
  return initialLoginAttempts();
}

function readLoginAttempts(): LoginAttemptsState {
  return normalizeLoginAttempts(readState(STATE_FILE, initialLoginAttempts));
}

function updateLoginAttempts(update: (state: LoginAttemptsState) => void): void {
  updateState(STATE_FILE, initialLoginAttempts, (state) => {
    // updateState persists the object it receives; rewrite a legacy layout in
    // place so the file is upgraded rather than silently discarded on write.
    if (normalizeLoginAttempts(state) !== state) {
      const mutable = state as unknown as Record<string, unknown>;
      for (const key of Object.keys(mutable)) delete mutable[key];
      const fresh = initialLoginAttempts();
      for (const [key, value] of Object.entries(fresh)) mutable[key] = value;
    }
    update(state);
  });
}

function accountKey(username: string): string {
  return createHash("sha256").update(username.trim().toLowerCase()).digest("hex");
}

/**
 * Client key from the last non-empty `x-forwarded-for` hop, then `x-real-ip`.
 * Hashing avoids persisting raw addresses; a missing address skips this dimension.
 */
export function loginClientKey(request: Request): string | null {
  const forwarded = request.headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const address = forwarded?.at(-1) || request.headers.get("x-real-ip")?.trim();
  return address ? createHash("sha256").update(address).digest("hex") : null;
}

function loginRateLimited(): AuthError {
  return new AuthError(429, "LOGIN_RATE_LIMIT", "登录尝试过于频繁，请 15 分钟后重试。");
}

function countWithinWindow(timestamps: number[] | undefined, cutoff: number): number {
  return (timestamps ?? []).filter((timestamp) => timestamp > cutoff).length;
}

function pruneLoginAttempts(state: LoginAttemptsState, cutoff: number): void {
  for (const dimension of [state.accounts, state.clients]) {
    for (const key of Object.keys(dimension)) {
      dimension[key] = dimension[key].filter((timestamp) => timestamp > cutoff);
      if (dimension[key].length === 0) delete dimension[key];
    }
  }
}

/** Read-only check performed before any credential verification. */
export function assertLoginAllowed(username: string, clientKey: string | null): void {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  const state = readLoginAttempts();
  if (countWithinWindow(state.accounts[accountKey(username)], cutoff) >= ACCOUNT_FAILURE_LIMIT)
    throw loginRateLimited();
  if (clientKey && countWithinWindow(state.clients[clientKey], cutoff) >= CLIENT_FAILURE_LIMIT)
    throw loginRateLimited();
}

/** Record a single invalid-credential failure after verification failed. */
export function recordLoginFailure(username: string, clientKey: string | null): void {
  const now = Date.now();
  const cutoff = now - LOGIN_WINDOW_MS;
  updateLoginAttempts((state) => {
    pruneLoginAttempts(state, cutoff);
    const account = accountKey(username);
    state.accounts[account] = [...(state.accounts[account] ?? []), now].slice(
      -ACCOUNT_FAILURE_LIMIT,
    );
    if (clientKey) {
      state.clients[clientKey] = [...(state.clients[clientKey] ?? []), now].slice(
        -CLIENT_FAILURE_LIMIT,
      );
    }
  });
}

/** A successful login clears the account's failure history. */
export function clearLoginFailures(username: string): void {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  updateLoginAttempts((state) => {
    pruneLoginAttempts(state, cutoff);
    delete state.accounts[accountKey(username)];
  });
}
