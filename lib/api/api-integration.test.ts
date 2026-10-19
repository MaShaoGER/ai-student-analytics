/** Real HTTP regression tests. scripts/test-api.sh provides isolated accounts/state. */
import { beforeAll, describe, expect, it } from "vitest";
import { createPlan } from "../analysis/plan";
import { loadAnalysisRecords } from "../records";

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:3100";
const integration = process.env.API_INTEGRATION === "1" ? describe : describe.skip;
const username = process.env.API_TEST_USERNAME;
const password = process.env.API_TEST_PASSWORD;
let adminCookie = "";
let userCookie = "";
let ordinaryUserId = "";

async function request(path: string, options: RequestInit = {}, cookie = adminCookie) {
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "content-type": "application/json",
      origin: BASE_URL,
      ...(cookie ? { cookie } : {}),
      ...options.headers,
    },
  });
}
async function login(account: string, secret: string): Promise<string> {
  const response = await request(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ username: account, password: secret }) },
    "",
  );
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  return cookie!;
}
async function createAccount(account: string): Promise<{ cookie: string; id: string }> {
  const secret = "Fixture-Password-2026!";
  const response = await request("/api/admin/users", {
    method: "POST",
    body: JSON.stringify({
      username: account,
      displayName: "接口测试用户",
      password: secret,
      role: "user",
    }),
  });
  expect(response.status).toBe(201);
  const payload = await response.json();
  return { cookie: await login(account, secret), id: payload.user.id };
}

integration("authenticated application HTTP API", () => {
  beforeAll(async () => {
    if (!username || !password)
      throw new Error("Use scripts/test-api.sh to provide an isolated administrator.");
    adminCookie = await login(username, password);
    const user = await createAccount(`reader.${Date.now()}`);
    userCookie = user.cookie;
    ordinaryUserId = user.id;
  }, 30_000);

  it("rejects unauthenticated data and admin requests", async () => {
    for (const path of [
      "/api/profile",
      "/api/course-panorama?datasetId=demo",
      "/api/ai/status",
      "/api/ai/cost",
      "/api/admin/users",
      "/api/admin/ai-config",
    ]) {
      expect((await request(path, {}, "")).status).toBe(401);
    }
    expect((await request("/api/analysis", { method: "POST", body: "{}" }, "")).status).toBe(401);
    expect((await request("/api/ask", { method: "POST", body: "{}" }, "")).status).toBe(401);
    expect((await request("/api/chat", { method: "POST", body: "{}" }, "")).status).toBe(401);
  });

  it("runs a native conversational result and a scoped followup without an AI connection", async () => {
    const first = await request(
      "/api/chat",
      {
        method: "POST",
        body: JSON.stringify({ question: "哪门课程平均成绩最高？", datasetId: "demo" }),
      },
      userCookie,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store");
    const result = await first.json();
    expect(result.kind).toBe("result");
    expect(result.planning.source).toBe("golden_case");
    expect(result.artifact.result.rows[0]).toMatchObject({ dimension: "AAA", value: 79.67 });
    const followup = await request(
      "/api/chat",
      {
        method: "POST",
        body: JSON.stringify({
          question: "改成表格",
          datasetId: "demo",
          context: result.context,
          history: [
            { role: "user", content: "哪门课程平均成绩最高？" },
            { role: "assistant", content: result.answer },
          ],
        }),
      },
      userCookie,
    );
    expect(followup.status).toBe(200);
    const table = await followup.json();
    expect(table.artifact.view).toBe("table");
    expect(table.artifact.result.rows).toEqual(result.artifact.result.rows);
    expect(table.context.metric).toBe("score");
    expect(table.planning.source).toBe("local");
  });

  it("preserves distribution scope when changing score bin width through conversation", async () => {
    const response = await request(
      "/api/chat",
      {
        method: "POST",
        body: JSON.stringify({
          question: "按10分一档",
          datasetId: "demo",
          context: {
            kind: "distribution",
            course: "AAA",
            term: "2024J",
            binWidth: 5,
            view: "heatmap",
          },
        }),
      },
      userCookie,
    );
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.artifact).toMatchObject({
      kind: "distribution",
      course: "AAA",
      term: "2024J",
      binWidth: 10,
    });
    expect(
      result.artifact.data.groups.every(
        (group: { course: string; term: string }) =>
          group.course === "AAA" && group.term === "2024J",
      ),
    ).toBe(true);
    expect(result.facts.join(" ")).toContain("按 10 分一档");
  });

  it("restricts analysis-settings controls to admins and exposes only public status", async () => {
    expect((await request("/api/admin/analysis-settings", {}, userCookie)).status).toBe(403);
    const response = await request("/api/admin/analysis-settings");
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.capability.status).toBe("unknown");
    expect(payload.knowledge.count).toBe(8);
    expect(JSON.stringify(payload)).not.toContain("fingerprint");
    const saved = await request("/api/admin/analysis-settings", {
      method: "PUT",
      body: JSON.stringify({ enabled: true, maxToolCalls: 4, timeoutSeconds: 45 }),
    });
    expect((await saved.json()).settings.maxToolCalls).toBe(4);
    const rebuilt = await request("/api/admin/analysis-settings", {
      method: "POST",
      body: JSON.stringify({ action: "rebuild" }),
    });
    expect((await rebuilt.json()).knowledge.builtAt).toBeTruthy();
  });

  it("returns a terminal AI_NOT_CONFIGURED error when the unified chat has no configured model", async () => {
    const response = await request(
      "/api/chat",
      {
        method: "POST",
        headers: { accept: "text/event-stream" },
        body: JSON.stringify({
          question: "比较两个学期的成绩",
          datasetId: "demo",
        }),
      },
      userCookie,
    );
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain('"type":"error"');
    expect(body).toContain("AI_NOT_CONFIGURED");
  });

  it("returns a public session DTO without credentials", async () => {
    const response = await request("/api/auth/session");
    const payload = await response.json();
    expect(payload.user.role).toBe("admin");
    expect(Object.keys(payload.user).sort()).toEqual(["displayName", "id", "role", "username"]);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects incorrect passwords", async () => {
    const response = await request(
      "/api/auth/login",
      { method: "POST", body: JSON.stringify({ username, password: "incorrect-password" }) },
      "",
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects ordinary users reading or modifying administration", async () => {
    for (const path of ["/api/admin/users", "/api/admin/ai-config", "/api/ai/cost"])
      expect((await request(path, {}, userCookie)).status).toBe(403);
    expect(
      (await request("/api/admin/ai-config", { method: "PUT", body: "{}" }, userCookie)).status,
    ).toBe(403);
    expect((await request("/api/admin/ai-test", { method: "POST" }, userCookie)).status).toBe(403);
  });

  it("rejects cross-origin and missing-origin mutations", async () => {
    expect(
      (
        await request("/api/admin/ai-config", {
          method: "PUT",
          headers: { origin: "https://untrusted.example" },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const response = await fetch(`${BASE_URL}/api/auth/logout`, {
      method: "POST",
      headers: { cookie: adminCookie },
    });
    expect(response.status).toBe(403);
  });

  it("provides dataset profiles to ordinary users", async () => {
    const response = await request("/api/profile", {}, userCookie);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(
      payload.datasets.find((item: { id: string; available: boolean }) => item.id === "demo")
        .available,
    ).toBe(true);
  });

  it("calculates the unchanged reference result", async () => {
    const plan = createPlan({
      datasetId: "demo",
      metric: "score",
      dimension: "course",
      chartType: "bar",
    });
    const response = await request(
      "/api/analysis",
      { method: "POST", body: JSON.stringify(plan) },
      userCookie,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.result.rows).toEqual([
      { dimension: "AAA", value: 79.67, sampleSize: 3 },
      { dimension: "CCC", value: 70.67, sampleSize: 3 },
      { dimension: "BBB", value: 67.67, sampleSize: 3 },
    ]);
  });

  it("provides uncached, aggregate-only course panorama data to ordinary users", async () => {
    const response = await request("/api/course-panorama?datasetId=demo", {}, userCookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload.selection).toBeNull();
    expect(payload.minSampleSize).toBe(3);
    expect(payload.columns.length).toBeGreaterThan(0);
    for (const column of payload.columns) {
      expect(column.baseline.count).toBeGreaterThanOrEqual(3);
      expect(column.baseline.bins).toHaveLength(20);
      expect(column.baseline.bins.reduce((sum: number, count: number) => sum + count, 0)).toBe(
        column.baseline.count,
      );
    }
    expect(JSON.stringify(payload)).not.toContain("id_student");
  });

  it("rejects invalid and unavailable panorama cohorts over HTTP", async () => {
    for (const parameters of [
      "threshold=0",
      "source=A",
      "source=A&target=A",
      "source=missing&target=other",
    ]) {
      const response = await request(
        `/api/course-panorama?datasetId=demo&${parameters}`,
        {},
        userCookie,
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("returns 400 for an invalid analysis and 422 for an empty result", async () => {
    const plan = createPlan({
      datasetId: "demo",
      metric: "score",
      dimension: "course",
      chartType: "bar",
    });
    expect(
      (
        await request("/api/analysis", {
          method: "POST",
          body: JSON.stringify({ ...plan, metric: "invalid" }),
        })
      ).status,
    ).toBe(400);
    const response = await request("/api/analysis", {
      method: "POST",
      body: JSON.stringify({
        ...plan,
        filters: [{ field: "course", op: "eq", value: "NONEXISTENT" }],
      }),
    });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "NO_DATA",
      result: {
        rows: [],
        filteredOutGroupCount: 0,
        period: expect.stringContaining("无匹配记录"),
      },
    });
  });

  it("runs verified questions without a model connection", async () => {
    const response = await request(
      "/api/ask",
      {
        method: "POST",
        body: JSON.stringify({ question: "哪门课程平均成绩最高？", datasetId: "demo" }),
      },
      userCookie,
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.planning.source).toBe("golden_case");
    expect(payload.result.rows[0].value).toBe(79.67);
  });

  it("rejects invalid questions", async () => {
    const response = await request("/api/ask", {
      method: "POST",
      body: JSON.stringify({ question: "a", datasetId: "demo" }),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_QUESTION");
  });

  it("persists empty and invalid requests with accurate context and authenticated ownership", () => {
    const records = loadAnalysisRecords();
    const empty = records.find((record) => record.errorCode === "NO_DATA");
    expect(empty).toMatchObject({
      datasetId: "demo",
      metricId: "score",
      requestSource: "analysis",
    });
    expect(empty?.userId).toBeTruthy();
    expect(empty?.result.rowCount).toBe(0);
    const invalid = records.find((record) => record.errorCode === "INVALID_PLAN");
    expect(invalid).toMatchObject({ datasetId: "demo", metricId: null, plan: null });
    const invalidQuestion = records.find((record) => record.errorCode === "INVALID_QUESTION");
    expect(invalidQuestion).toMatchObject({
      datasetId: "demo",
      metricId: null,
      requestSource: "ask",
    });
    expect(invalidQuestion?.userId).toBeTruthy();
    expect(JSON.stringify(records)).not.toContain(password);
  });

  it("saves AI settings with only a public key status", async () => {
    const initialResponse = await request("/api/admin/ai-config");
    const initial = await initialResponse.json();
    const config = {
      ...initial.config,
      enabled: false,
      model: "fixture-model",
      apiKey: "fixture-key-never-used",
      pricing: { inputPerMillion: 1, outputPerMillion: 2 },
    };
    const response = await request("/api/admin/ai-config", {
      method: "PUT",
      body: JSON.stringify(config),
    });
    expect(response.status).toBe(200);
    const saved = await response.json();
    expect(saved.config.keyConfigured).toBe(true);
    expect(saved.config.model).toBe("fixture-model");
    expect(JSON.stringify(saved)).not.toContain("fixture-key-never-used");
    const reloaded = await (await request("/api/admin/ai-config")).json();
    expect(reloaded.config).toEqual(saved.config);
    const status = await (await request("/api/ai/status", {}, userCookie)).json();
    expect(Object.keys(status).sort()).toEqual(["configured", "enabled", "model"]);
    expect(status.configured).toBe(true);
    expect(status.enabled).toBe(false);
    expect(status.model).toBe("fixture-model");

    const crossOrigin = await request("/api/admin/ai-config", {
      method: "PUT",
      body: JSON.stringify({ ...saved.config, baseUrl: "https://other.example/v1" }),
    });
    expect(crossOrigin.status).toBe(400);
    expect((await crossOrigin.json()).code).toBe("AI_KEY_REENTRY_REQUIRED");
    expect((await (await request("/api/admin/ai-config")).json()).config).toEqual(saved.config);
  });

  it("does not call the provider while AI is disabled", async () => {
    const response = await request("/api/ask", {
      method: "POST",
      body: JSON.stringify({ question: "这是需要自由分析的问题", datasetId: "demo" }),
    });
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("AI_NOT_CONFIGURED");
    expect((await request("/api/admin/ai-test", { method: "POST" })).status).toBe(503);
    const payload = await (await request("/api/ai/cost")).json();
    expect(payload.stats.estimated).toBe(true);
    expect(payload.stats.totalCalls).toBe(0);
  });

  it("protects the administrator from being disabled", async () => {
    const session = await (await request("/api/auth/session")).json();
    const response = await request("/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: session.user.id, disabled: true }),
    });
    expect(response.status).toBe(403);
  });

  it("revokes existing sessions when an account is disabled", async () => {
    const response = await request("/api/admin/users", {
      method: "PATCH",
      body: JSON.stringify({ id: ordinaryUserId, disabled: true }),
    });
    expect(response.status).toBe(200);
    expect((await request("/api/profile", {}, userCookie)).status).toBe(401);
    expect(
      (
        await request("/api/admin/users", {
          method: "PATCH",
          body: JSON.stringify({ id: ordinaryUserId, disabled: false }),
        })
      ).status,
    ).toBe(200);
    expect((await request("/api/profile", {}, userCookie)).status).toBe(401);
  });

  it("invalidates a session on logout", async () => {
    const account = await createAccount(`logout.${Date.now()}`);
    expect((await request("/api/auth/logout", { method: "POST" }, account.cookie)).status).toBe(
      200,
    );
    expect((await request("/api/profile", {}, account.cookie)).status).toBe(401);
  });

  it("invalidates all sessions after changing a password", async () => {
    const accountName = `password.${Date.now()}`;
    const account = await createAccount(accountName);
    const next = "Changed-Fixture-2026!";
    const response = await request(
      "/api/auth/password",
      {
        method: "POST",
        body: JSON.stringify({ currentPassword: "Fixture-Password-2026!", newPassword: next }),
      },
      account.cookie,
    );
    expect(response.status).toBe(200);
    expect((await request("/api/profile", {}, account.cookie)).status).toBe(401);
    expect((await request("/api/profile", {}, await login(accountName, next))).status).toBe(200);
  });

  it("limits analysis by authenticated account even with spoofed forwarding headers", async () => {
    const account = await createAccount(`ratelimit.${Date.now()}`);
    const plan = createPlan({
      datasetId: "demo",
      metric: "score",
      dimension: "course",
      chartType: "bar",
    });
    const responses = await Promise.all(
      Array.from({ length: 35 }, (_, i) =>
        request(
          "/api/analysis",
          {
            method: "POST",
            headers: { "x-forwarded-for": `spoof-${i}` },
            body: JSON.stringify(plan),
          },
          account.cookie,
        ),
      ),
    );
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
    const limited = responses.find((response) => response.status === 429)!;
    expect(limited.headers.get("retry-after")).toBeTruthy();
    // Reading many charts must not exhaust this account's separate ask allowance.
    expect(
      (
        await request(
          "/api/ask",
          {
            method: "POST",
            body: JSON.stringify({ question: "哪门课程平均成绩最高？", datasetId: "demo" }),
          },
          account.cookie,
        )
      ).status,
    ).toBe(200);
  }, 30_000);

  it("uses a separate stricter allowance for questions", async () => {
    const account = await createAccount(`asklimit.${Date.now()}`);
    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        request(
          "/api/ask",
          {
            method: "POST",
            body: JSON.stringify({ question: "哪门课程平均成绩最高？", datasetId: "demo" }),
          },
          account.cookie,
        ),
      ),
    );
    expect(responses.filter((response) => response.status === 429)).toHaveLength(5);
  }, 30_000);
});
