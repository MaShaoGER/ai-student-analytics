import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postLogin } from "../../app/api/auth/login/route";
import { apiError } from "./http";
import {
  ACCOUNT_FAILURE_LIMIT,
  CLIENT_FAILURE_LIMIT,
  LOGIN_WINDOW_MS,
  RESERVATION_TTL_MS,
  loginClientKey,
  reserveLoginAttempt,
  settleLoginAttempt,
  type LoginReservation,
} from "./login-attempts";
import { AuthError, initializeAdmin } from "./service";

const ADMIN_PASSWORD = "Study-Admin-2026!";
let stateDir: string;

function loginRequest(
  username: string,
  password: string,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: { origin: "http://localhost", "content-type": "application/json", ...headers },
    body: JSON.stringify({ username, password }),
  });
}

function requestWithHeaders(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/auth/login", { headers });
}

function readAttemptsFile(): {
  version: number;
  accounts: Record<string, number[]>;
  clients: Record<string, number[]>;
  reservations: Record<string, unknown>;
} {
  return JSON.parse(readFileSync(path.join(stateDir, "login-attempts.json"), "utf8"));
}

function attemptsPath(): string {
  return path.join(stateDir, "login-attempts.json");
}

function accountKeyFor(username: string): string {
  return createHash("sha256").update(username.trim().toLowerCase()).digest("hex");
}

/** Runs one complete attempt: reserve, then settle as an invalid credential. */
function failLogin(username: string, client: string | null = null): void {
  settleLoginAttempt(reserveLoginAttempt(username, client), "failure");
}

function lockedError(check: () => void): unknown {
  try {
    check();
    return null;
  } catch (error) {
    return error;
  }
}

describe("persistent login attempt throttling", () => {
  beforeEach(() => {
    stateDir = mkdtempSync(path.join(tmpdir(), "analytics-login-attempts-"));
    vi.stubEnv("APP_STATE_DIR", stateDir);
    vi.stubEnv("APP_ORIGIN", "http://localhost");
    vi.stubEnv("ADMIN_USERNAME", "");
    vi.stubEnv("ADMIN_PASSWORD", "");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(stateDir, { recursive: true, force: true });
  });

  it("locks only the account that failed 10 times, with the original 429 contract", () => {
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1) failLogin("victim");

    const failure = lockedError(() => reserveLoginAttempt("victim", null));
    expect(failure).toBeInstanceOf(AuthError);
    expect(failure).toMatchObject({
      status: 429,
      code: "LOGIN_RATE_LIMIT",
      message: "登录尝试过于频繁，请 15 分钟后重试。",
    });
    // Another account is unaffected by the victim's failures.
    expect(() => reserveLoginAttempt("someone-else", null)).not.toThrow();
    expect(readAttemptsFile()).toMatchObject({ version: 3 });
  });

  it("clears the account failure history after a successful login", () => {
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT - 1; index += 1) failLogin("victim");
    const reservation = reserveLoginAttempt("victim", null);
    settleLoginAttempt(reservation, "success");
    expect(readAttemptsFile().accounts[accountKeyFor("victim")]).toBeUndefined();

    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1) failLogin("victim");
    expect(lockedError(() => reserveLoginAttempt("victim", null))).not.toBeNull();
  });

  it("does not count another account's failures against this account", () => {
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1) failLogin("attacker", "shared-client");
    expect(lockedError(() => reserveLoginAttempt("attacker", "shared-client"))).not.toBeNull();
    expect(() => reserveLoginAttempt("innocent", "shared-client")).not.toThrow();
  });

  it("locks a client address after 100 failures across rotating usernames", () => {
    const client = loginClientKey(requestWithHeaders({ "x-forwarded-for": "203.0.113.5" }));
    expect(client).not.toBeNull();
    // One failure per username keeps the account dimension out of the way.
    for (let index = 0; index < CLIENT_FAILURE_LIMIT; index += 1)
      failLogin(`rotating-${index}`, client);

    expect(lockedError(() => reserveLoginAttempt("fresh-account", client))).not.toBeNull();
    // Without a client address the client dimension is skipped.
    expect(() => reserveLoginAttempt("fresh-account", null)).not.toThrow();
  });

  it("releases an account once the 15 minute window expires", () => {
    vi.useFakeTimers({ now: new Date("2026-10-18T00:00:00Z") });
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1) failLogin("victim");
    expect(lockedError(() => reserveLoginAttempt("victim", null))).not.toBeNull();

    vi.setSystemTime(new Date("2026-10-18T00:00:00Z").getTime() + LOGIN_WINDOW_MS + 1);
    expect(() => reserveLoginAttempt("victim", null)).not.toThrow();
  });

  it("extracts the client key from the last forwarding hop or x-real-ip", () => {
    expect(
      loginClientKey(
        requestWithHeaders({
          "x-forwarded-for": "10.0.0.1, 203.0.113.9",
          "x-real-ip": "198.51.100.7",
        }),
      ),
    ).toBe(loginClientKey(requestWithHeaders({ "x-real-ip": "203.0.113.9" })));
    expect(
      loginClientKey(requestWithHeaders({ "x-forwarded-for": "10.0.0.1, 203.0.113.9, " })),
    ).not.toBe(loginClientKey(requestWithHeaders({ "x-forwarded-for": "10.0.0.1" })));
    expect(loginClientKey(requestWithHeaders({}))).toBeNull();
    expect(loginClientKey(requestWithHeaders({ "x-forwarded-for": " , " }))).toBeNull();
  });

  it("discards the legacy single-bucket file instead of trusting stale lock state", () => {
    writeFileSync(
      attemptsPath(),
      JSON.stringify({
        global: Array.from({ length: 100 }, () => Date.now()),
        legacyaccount: Array.from({ length: 10 }, () => Date.now()),
      }),
    );
    expect(() => reserveLoginAttempt("anyone", null)).not.toThrow();
    failLogin("anyone");
    expect(readAttemptsFile()).toMatchObject({ version: 3 });
  });

  it("upgrades version 2 state without losing recorded failures", () => {
    const account = accountKeyFor("victim");
    const timestamps = Array.from({ length: ACCOUNT_FAILURE_LIMIT }, (_, index) => Date.now() - index);
    writeFileSync(
      attemptsPath(),
      JSON.stringify({
        version: 2,
        accounts: { [account]: timestamps },
        clients: {},
      }),
    );

    expect(lockedError(() => reserveLoginAttempt("victim", null))).not.toBeNull();
    expect(() => reserveLoginAttempt("someone-else", null)).not.toThrow();
    const state = readAttemptsFile();
    expect(state.version).toBe(3);
    expect(state.accounts[account]).toHaveLength(ACCOUNT_FAILURE_LIMIT);
    expect(Object.values(state.reservations)).toHaveLength(1);
  });

  it("admits only the failure limit when attempts arrive concurrently", async () => {
    const outcomes = await Promise.all(
      Array.from({ length: ACCOUNT_FAILURE_LIMIT + 2 }, async () => {
        await Promise.resolve();
        try {
          return reserveLoginAttempt("victim", null) as LoginReservation | AuthError;
        } catch (error) {
          return error as AuthError;
        }
      }),
    );

    const granted = outcomes.filter(
      (outcome): outcome is LoginReservation => !(outcome instanceof AuthError),
    );
    const rejected = outcomes.filter((outcome): outcome is AuthError => outcome instanceof AuthError);
    expect(granted).toHaveLength(ACCOUNT_FAILURE_LIMIT);
    expect(rejected).toHaveLength(2);
    expect(rejected.map((error) => [error.status, error.code])).toEqual([
      [429, "LOGIN_RATE_LIMIT"],
      [429, "LOGIN_RATE_LIMIT"],
    ]);

    const state = readAttemptsFile();
    expect(Object.keys(state.reservations)).toHaveLength(ACCOUNT_FAILURE_LIMIT);
    // Persisted reservations must not leak the attempted username.
    expect(JSON.stringify(state)).not.toContain("victim");
  });

  it("frees the slot on success or release and never counts them as failures", () => {
    const held = Array.from({ length: ACCOUNT_FAILURE_LIMIT }, () =>
      reserveLoginAttempt("victim", null),
    );
    expect(lockedError(() => reserveLoginAttempt("victim", null))).not.toBeNull();

    settleLoginAttempt(held[0], "success");
    settleLoginAttempt(reserveLoginAttempt("victim", null), "release");

    expect(() => reserveLoginAttempt("victim", null)).not.toThrow();
    expect(readAttemptsFile().accounts[accountKeyFor("victim")]).toBeUndefined();
  });

  it("frees slots left behind by a crashed process once they expire", () => {
    vi.useFakeTimers({ now: new Date("2026-10-18T00:00:00Z") });
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1)
      reserveLoginAttempt("victim", null);
    expect(lockedError(() => reserveLoginAttempt("victim", null))).not.toBeNull();

    vi.setSystemTime(new Date("2026-10-18T00:00:00Z").getTime() + RESERVATION_TTL_MS + 1);
    expect(() => reserveLoginAttempt("victim", null)).not.toThrow();
    expect(Object.keys(readAttemptsFile().reservations)).toEqual([
      expect.any(String),
    ]);
  });

  it("returns 429 with the preserved message, code and Retry-After header", async () => {
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1) failLogin("victim");
    const response = await postLogin(loginRequest("victim", "wrong-password"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "登录尝试过于频繁，请 15 分钟后重试。",
      code: "LOGIN_RATE_LIMIT",
    });
    // A blocked pre-check must not be counted as another failed attempt.
    const state = readAttemptsFile();
    expect(Object.values(state.accounts).map((timestamps) => timestamps.length)).toEqual(
      expect.arrayContaining([ACCOUNT_FAILURE_LIMIT]),
    );
    expect(state.reservations).toEqual({});
  });

  it("blocks a saturated client address before credential verification", async () => {
    const client = loginClientKey(requestWithHeaders({ "x-forwarded-for": "203.0.113.5" }));
    for (let index = 0; index < CLIENT_FAILURE_LIMIT; index += 1)
      failLogin(`rotating-${index}`, client);

    const blocked = await postLogin(
      loginRequest("fresh-account", "wrong-password", { "x-forwarded-for": "203.0.113.5" }),
    );
    expect(blocked.status).toBe(429);
    const noClient = await postLogin(loginRequest("fresh-account", "wrong-password"));
    expect(noClient.status).toBe(503);
    // A non-credential failure must not keep its in-flight slot.
    expect(readAttemptsFile().reservations).toEqual({});
  });

  it("rejects an oversized body with 413 before reading or reserving", async () => {
    const response = await postLogin(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ username: "test-admin", password: "p".repeat(8 * 1024) }),
      }),
    );
    expect(response.status).toBe(413);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "请求内容过大，请缩小查询范围后重试。",
      code: "REQUEST_TOO_LARGE",
    });
    expect(existsSync(attemptsPath())).toBe(false);
  });

  it("keeps normal credential length rules intact", async () => {
    const tooLong = await postLogin(loginRequest("test-admin", "p".repeat(129)));
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ code: "INVALID_INPUT" });
  });

  it("releases in-flight slots when verification fails for a non-credential reason", async () => {
    // No administrator exists yet, so every attempt fails with 503; the account
    // dimension must not accumulate and the slots must be freed.
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT * 2; index += 1) {
      const response = await postLogin(loginRequest("test-admin", "wrong-password"));
      expect(response.status).toBe(503);
    }
    const state = readAttemptsFile();
    expect(state.accounts).toEqual({});
    expect(state.reservations).toEqual({});
  });

  it("clears the account history on a real successful login and only counts failures", async () => {
    await initializeAdmin({ username: "test-admin", password: ADMIN_PASSWORD });
    for (let index = 0; index < 5; index += 1) {
      expect((await postLogin(loginRequest("test-admin", "wrong-password"))).status).toBe(401);
    }
    expect((await postLogin(loginRequest("test-admin", ADMIN_PASSWORD))).status).toBe(200);

    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1) {
      const response = await postLogin(loginRequest("test-admin", "wrong-password"));
      expect(response.status).toBe(401);
    }
    expect((await postLogin(loginRequest("test-admin", "wrong-password"))).status).toBe(429);
  }, 60_000);

  it("admits a single concurrent guess when the account is one failure short", async () => {
    await initializeAdmin({ username: "test-admin", password: ADMIN_PASSWORD });
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT - 1; index += 1) failLogin("test-admin");

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => postLogin(loginRequest("test-admin", "wrong-password"))),
    );
    expect(responses.filter((response) => response.status === 401)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
    expect(readAttemptsFile().accounts[accountKeyFor("test-admin")]).toHaveLength(
      ACCOUNT_FAILURE_LIMIT,
    );
    expect(readAttemptsFile().reservations).toEqual({});
  }, 60_000);
});

describe("safe API error responses", () => {
  it("marks invalid input as uncacheable", () => {
    const response = apiError(new SyntaxError("secret private text"));
    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("logs only a safe name/code summary for unexpected errors", () => {
    const logged: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      logged.push(args);
    });
    const response = apiError(
      Object.assign(new Error("upstream sk-secret-credential"), { code: "EUPSTREAM" }),
    );
    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(logged)).not.toContain("sk-secret-credential");
    expect(logged).toEqual([["API 请求处理失败", { name: "Error", code: "EUPSTREAM" }]]);
  });
});
