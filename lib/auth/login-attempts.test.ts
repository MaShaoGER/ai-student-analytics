import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postLogin } from "../../app/api/auth/login/route";
import { apiError } from "./http";
import {
  ACCOUNT_FAILURE_LIMIT,
  assertLoginAllowed,
  clearLoginFailures,
  CLIENT_FAILURE_LIMIT,
  LOGIN_WINDOW_MS,
  loginClientKey,
  recordLoginFailure,
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

function readAttemptsFile(): unknown {
  return JSON.parse(readFileSync(path.join(stateDir, "login-attempts.json"), "utf8"));
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
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1) {
      expect(() => assertLoginAllowed("victim", null)).not.toThrow();
      recordLoginFailure("victim", null);
    }

    const failure = lockedError(() => assertLoginAllowed("victim", null));
    expect(failure).toBeInstanceOf(AuthError);
    expect(failure).toMatchObject({
      status: 429,
      code: "LOGIN_RATE_LIMIT",
      message: "登录尝试过于频繁，请 15 分钟后重试。",
    });
    // Another account is unaffected by the victim's failures.
    expect(() => assertLoginAllowed("someone-else", null)).not.toThrow();
    expect(readAttemptsFile()).toMatchObject({ version: 2 });
  });

  it("clears the account failure history after a successful login", () => {
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1)
      recordLoginFailure("victim", null);
    expect(lockedError(() => assertLoginAllowed("victim", null))).not.toBeNull();

    clearLoginFailures("victim");
    expect(() => assertLoginAllowed("victim", null)).not.toThrow();
  });

  it("does not count another account's failures against this account", () => {
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1)
      recordLoginFailure("attacker", "shared-client");
    expect(lockedError(() => assertLoginAllowed("attacker", "shared-client"))).not.toBeNull();
    expect(() => assertLoginAllowed("innocent", "shared-client")).not.toThrow();
  });

  it("locks a client address after 100 failures across rotating usernames", () => {
    const client = loginClientKey(requestWithHeaders({ "x-forwarded-for": "203.0.113.5" }));
    expect(client).not.toBeNull();
    for (let index = 0; index < CLIENT_FAILURE_LIMIT; index += 1)
      recordLoginFailure(`rotating-${index % 10}`, client);

    expect(lockedError(() => assertLoginAllowed("fresh-account", client))).not.toBeNull();
    // Without a client address the client dimension is skipped.
    expect(() => assertLoginAllowed("fresh-account", null)).not.toThrow();
  });

  it("releases an account once the 15 minute window expires", () => {
    vi.useFakeTimers({ now: new Date("2026-10-18T00:00:00Z") });
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1)
      recordLoginFailure("victim", null);
    expect(lockedError(() => assertLoginAllowed("victim", null))).not.toBeNull();

    vi.setSystemTime(new Date("2026-10-18T00:00:00Z").getTime() + LOGIN_WINDOW_MS + 1);
    expect(() => assertLoginAllowed("victim", null)).not.toThrow();
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
      path.join(stateDir, "login-attempts.json"),
      JSON.stringify({
        global: Array.from({ length: 100 }, () => Date.now()),
        legacyaccount: Array.from({ length: 10 }, () => Date.now()),
      }),
    );
    expect(() => assertLoginAllowed("anyone", null)).not.toThrow();
    recordLoginFailure("anyone", null);
    expect(readAttemptsFile()).toMatchObject({ version: 2 });
  });

  it("returns 429 with the preserved message, code and Retry-After header", async () => {
    for (let index = 0; index < ACCOUNT_FAILURE_LIMIT; index += 1)
      recordLoginFailure("victim", null);
    const response = await postLogin(loginRequest("victim", "wrong-password"));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("900");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      error: "登录尝试过于频繁，请 15 分钟后重试。",
      code: "LOGIN_RATE_LIMIT",
    });
    // A blocked pre-check must not be counted as another failed attempt.
    const state = readAttemptsFile() as { accounts: Record<string, number[]> };
    expect(Object.values(state.accounts).map((timestamps) => timestamps.length)).toEqual(
      expect.arrayContaining([ACCOUNT_FAILURE_LIMIT]),
    );
  });

  it("blocks a saturated client address before credential verification", async () => {
    const client = loginClientKey(requestWithHeaders({ "x-forwarded-for": "203.0.113.5" }));
    for (let index = 0; index < CLIENT_FAILURE_LIMIT; index += 1)
      recordLoginFailure(`rotating-${index % 10}`, client);

    const blocked = await postLogin(
      loginRequest("fresh-account", "wrong-password", { "x-forwarded-for": "203.0.113.5" }),
    );
    expect(blocked.status).toBe(429);
    const noClient = await postLogin(loginRequest("fresh-account", "wrong-password"));
    expect(noClient.status).toBe(503);
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
