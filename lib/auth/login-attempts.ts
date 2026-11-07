import { createHash, randomUUID } from "node:crypto";
import { updateState } from "../settings/storage";
import { AuthError } from "./service";

/**
 * Login throttle state.
 *
 * Only failed credential checks count. Two independent dimensions are tracked:
 * one account may fail 10 times per window, and one client (proxy-aware IP) may
 * fail 100 times per window. A successful login clears the account dimension.
 * The previous single global bucket allowed unauthenticated account lockout.
 *
 * Password verification is asynchronous, so a read-only pre-check followed by a
 * later failure record would let concurrent guesses exceed the limits (TOCTOU).
 * Each attempt instead reserves an in-flight slot inside the storage
 * transaction, and settles it afterwards: a failure becomes a timestamp,
 * a success or a non-credential error simply releases the slot.
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_FAILURE_LIMIT = 10;
export const CLIENT_FAILURE_LIMIT = 100;
/**
 * In-flight slots are bounded so a crashed or killed process cannot hold them
 * forever. It only needs to exceed one password verification.
 */
export const RESERVATION_TTL_MS = 60 * 1000;
const STATE_FILE = "login-attempts.json";

export type LoginReservation = {
  id: string;
  account: string;
  client: string | null;
  expiresAt: number;
};

export type LoginAttemptsState = {
  version: 3;
  accounts: Record<string, number[]>;
  clients: Record<string, number[]>;
  reservations: Record<string, LoginReservation>;
};

export type LoginAttemptOutcome = "success" | "failure" | "release";

const initialLoginAttempts = (): LoginAttemptsState => ({
  version: 3,
  accounts: {},
  clients: {},
  reservations: {},
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

function isReservation(value: unknown): value is LoginReservation {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LoginReservation>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.account === "string" &&
    (candidate.client === null || typeof candidate.client === "string") &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt)
  );
}

function isReservationMap(value: unknown): value is Record<string, LoginReservation> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every(isReservation)
  );
}

/**
 * Accepts the current layout, and upgrades the version 2 failure counters that
 * existing installations already hold. Older single-bucket files are discarded
 * instead of being trusted as lock state.
 */
function normalizeLoginAttempts(value: unknown): LoginAttemptsState {
  if (typeof value === "object" && value !== null) {
    const candidate = value as {
      version?: unknown;
      accounts?: unknown;
      clients?: unknown;
      reservations?: unknown;
    };
    if (
      (candidate.version === 2 || candidate.version === 3) &&
      isTimestampMap(candidate.accounts) &&
      isTimestampMap(candidate.clients)
    ) {
      return {
        version: 3,
        accounts: candidate.accounts,
        clients: candidate.clients,
        // Unreadable reservations only free slots; recorded failures are kept.
        reservations: isReservationMap(candidate.reservations) ? candidate.reservations : {},
      };
    }
  }
  return initialLoginAttempts();
}

function updateLoginAttempts<R>(update: (state: LoginAttemptsState) => R): R {
  return updateState<LoginAttemptsState, R>(STATE_FILE, initialLoginAttempts, (raw) => {
    const state = normalizeLoginAttempts(raw);
    const result = update(state);
    // updateState persists the object it receives; rewrite a legacy layout in
    // place so the file is upgraded rather than silently discarded on write.
    const mutable = raw as unknown as Record<string, unknown>;
    for (const key of Object.keys(mutable)) delete mutable[key];
    Object.assign(mutable, state);
    return result;
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

function countReservations(
  reservations: Record<string, LoginReservation>,
  dimension: "account" | "client",
  key: string,
  now: number,
): number {
  let count = 0;
  for (const reservation of Object.values(reservations))
    if (reservation.expiresAt > now && reservation[dimension] === key) count += 1;
  return count;
}

function pruneLoginAttempts(state: LoginAttemptsState, cutoff: number): void {
  for (const dimension of [state.accounts, state.clients]) {
    for (const key of Object.keys(dimension)) {
      dimension[key] = dimension[key].filter((timestamp) => timestamp > cutoff);
      if (dimension[key].length === 0) delete dimension[key];
    }
  }
}

/** Drops slots whose owner can no longer settle them (crash, kill, lost response). */
function pruneReservations(state: LoginAttemptsState, now: number): void {
  for (const [id, reservation] of Object.entries(state.reservations))
    if (reservation.expiresAt <= now) delete state.reservations[id];
}

/**
 * Atomically claims an in-flight slot for one credential check.
 *
 * Completed failures plus slots still being verified may not reach the limits,
 * so concurrent guesses cannot overshoot them. The reservation identifier is
 * random: the persisted state holds no username or address, only their hashes.
 */
export function reserveLoginAttempt(
  username: string,
  clientKey: string | null,
): LoginReservation {
  const now = Date.now();
  const cutoff = now - LOGIN_WINDOW_MS;
  const account = accountKey(username);
  return updateLoginAttempts((state) => {
    pruneLoginAttempts(state, cutoff);
    pruneReservations(state, now);
    if (
      countWithinWindow(state.accounts[account], cutoff) +
        countReservations(state.reservations, "account", account, now) >=
      ACCOUNT_FAILURE_LIMIT
    )
      throw loginRateLimited();
    if (
      clientKey &&
      countWithinWindow(state.clients[clientKey], cutoff) +
        countReservations(state.reservations, "client", clientKey, now) >=
      CLIENT_FAILURE_LIMIT
    )
      throw loginRateLimited();
    const reservation: LoginReservation = {
      id: randomUUID(),
      account,
      client: clientKey,
      expiresAt: now + RESERVATION_TTL_MS,
    };
    state.reservations[reservation.id] = reservation;
    return reservation;
  });
}

/**
 * Releases a reserved slot once verification finished.
 *
 * `failure` counts one invalid-credential rejection in both dimensions,
 * `success` also clears the account's failure history, and `release` (any other
 * error) frees the slot without counting, so successful and failed-by-other-
 * means attempts never accumulate as failures.
 */
export function settleLoginAttempt(
  reservation: LoginReservation,
  outcome: LoginAttemptOutcome,
): void {
  const now = Date.now();
  const cutoff = now - LOGIN_WINDOW_MS;
  updateLoginAttempts((state) => {
    delete state.reservations[reservation.id];
    pruneLoginAttempts(state, cutoff);
    pruneReservations(state, now);
    if (outcome === "release") return;
    if (outcome === "success") {
      delete state.accounts[reservation.account];
      return;
    }
    state.accounts[reservation.account] = [
      ...(state.accounts[reservation.account] ?? []),
      now,
    ].slice(-ACCOUNT_FAILURE_LIMIT);
    if (reservation.client)
      state.clients[reservation.client] = [...(state.clients[reservation.client] ?? []), now].slice(
        -CLIENT_FAILURE_LIMIT,
      );
  });
}
