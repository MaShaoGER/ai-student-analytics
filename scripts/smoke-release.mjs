#!/usr/bin/env node
import { isDeepStrictEqual } from "node:util";
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { rootCertificates } from "node:tls";

// Usage: supply one JSON object on stdin. Never pass passwords as CLI arguments.
// { username, password, base, origin, basicAuth?, userUsername?, userPassword?, recordsFile?, caCertFile? }
// Environment variables and the candidate-only usage are documented in docs/smoke-release.md.
// basicAuth accepts a raw "username:password" string or a full "Basic ..." value.
// The application session cookie is held in memory and is never printed.
const MAX_INPUT_BYTES = 16_384;
const REQUEST_TIMEOUT_MS = 40_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const COOKIE_NAME = "analytics_session";
const inputParts = [];
let inputBytes = 0;
if (!process.stdin.isTTY)
  for await (const chunk of process.stdin) {
    inputBytes += chunk.length;
    if (inputBytes > MAX_INPUT_BYTES) {
      console.error("FAIL input: JSON input exceeds size limit");
      process.exit(1);
    }
    inputParts.push(chunk);
  }

let input;
try {
  const stdin = Buffer.concat(inputParts).toString("utf8").trim();
  const parsed = !stdin ? {} : JSON.parse(stdin);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
  input = {
    username: process.env.SMOKE_USERNAME,
    password: process.env.SMOKE_PASSWORD,
    base: process.env.SMOKE_BASE_URL,
    origin: process.env.SMOKE_ORIGIN,
    basicAuth: process.env.SMOKE_BASIC_AUTH,
    userUsername: process.env.SMOKE_USER_USERNAME,
    userPassword: process.env.SMOKE_USER_PASSWORD,
    recordsFile: process.env.SMOKE_RECORDS_FILE || process.env.ANALYSIS_RECORDS_FILE,
    baselineRecordsFile: process.env.SMOKE_BASELINE_RECORDS_FILE,
    caCertFile: process.env.SMOKE_CA_CERT_FILE,
    ...parsed,
  };
} catch {
  console.error("FAIL input: invalid JSON");
  process.exit(1);
}
let base;
let origin;
let gatewayAuthorization;
let ca;
try {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error();
  if (
    typeof input.username !== "string" ||
    !input.username ||
    typeof input.password !== "string" ||
    !input.password
  )
    throw new Error();
  base = new URL(input.base);
  origin = new URL(input.origin || base.origin).origin;
  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    (input.origin && input.origin !== origin)
  )
    throw new Error();
  if (!["http:", "https:"].includes(new URL(origin).protocol)) throw new Error();
  // HTTP is permitted only for a loopback candidate. All remote credentials require TLS.
  if (base.protocol === "http:" && !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname))
    throw new Error();
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new Error();
  if (Boolean(input.userUsername) !== Boolean(input.userPassword)) throw new Error();
  if (
    input.userUsername &&
    (typeof input.userUsername !== "string" || typeof input.userPassword !== "string")
  )
    throw new Error();
  if (input.caCertFile) {
    const certificate = readFileSync(input.caCertFile, "utf8");
    if (!certificate.includes("-----BEGIN CERTIFICATE-----")) throw new Error();
    ca = [...rootCertificates, certificate];
  }
  if (input.basicAuth !== undefined) {
    if (typeof input.basicAuth !== "string" || !input.basicAuth || /[\r\n]/u.test(input.basicAuth))
      throw new Error();
    gatewayAuthorization = /^Basic /iu.test(input.basicAuth)
      ? input.basicAuth
      : `Basic ${Buffer.from(input.basicAuth, "utf8").toString("base64")}`;
  }
} catch {
  console.error(
    "FAIL input: invalid credentials, URL, test-user pair or trusted CA configuration; see docs/smoke-release.md",
  );
  process.exit(1);
}

class SmokeFailure extends Error {}
let passed = 0;
let skipped = 0;
let failure = false;
let cookie = "";
let userCookie = "";
let loggedInUser;
let ordinaryUser;
let recordsBefore;
const expectedAudits = [];
const assert = (condition, label) => {
  if (!condition) throw new SmokeFailure(label);
};
const pass = (label) => {
  passed += 1;
  console.log(`PASS ${label}`);
};
const check = async (label, action) => {
  try {
    await action();
    pass(label);
  } catch (error) {
    if (error instanceof SmokeFailure) throw error;
    throw new SmokeFailure(`${label}: request or response parsing failed`);
  }
};

async function request(
  path,
  {
    method = "GET",
    body,
    rawBody,
    authenticated = false,
    sessionCookie,
    requestOrigin = origin,
    fetchSite = "same-origin",
  } = {},
) {
  const target = new URL(path, base);
  assert(target.origin === base.origin, "request destination must remain on the configured base");
  const headers = { "Sec-Fetch-Site": fetchSite };
  if (requestOrigin !== null) headers.Origin = requestOrigin;
  if (gatewayAuthorization) headers.Authorization = gatewayAuthorization;
  if (authenticated) headers.Cookie = cookie;
  if (sessionCookie !== undefined) headers.Cookie = sessionCookie;
  if (body !== undefined || rawBody !== undefined) headers["Content-Type"] = "application/json";
  // Native HTTPS supports an explicit additional test CA without disabling verification.
  // Redirects are returned as responses and never follow credentials to another host.
  const { response, text } = await new Promise((resolve, reject) => {
    const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
    const outgoing = transport(
      target,
      {
        method,
        headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
      },
      (incoming) => {
        const chunks = [];
        let bytes = 0;
        incoming.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES)
            incoming.destroy(new Error("Response exceeds size limit"));
          else chunks.push(chunk);
        });
        incoming.on("error", reject);
        incoming.on("end", () => {
          const responseHeaders = new Headers();
          for (let i = 0; i < incoming.rawHeaders.length; i += 2)
            responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
          resolve({
            response: { status: incoming.statusCode, headers: responseHeaders },
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(
      rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
    );
  });
  let json;
  if (response.headers.get("content-type")?.includes("application/json")) {
    try {
      json = JSON.parse(text);
    } catch {
      throw new SmokeFailure(`${method} ${path}: malformed JSON response`);
    }
  }
  return { response, text, json };
}
const expectStatus = (reply, expected, label) =>
  assert(
    reply.response.status === expected,
    `${label}: expected HTTP ${expected}, received ${reply.response.status}`,
  );
const expectNoStore = (reply, label) =>
  assert(
    reply.response.headers.get("cache-control")?.includes("no-store"),
    `${label}: response must be no-store`,
  );
const exactKeys = (object, keys, label) =>
  assert(
    object &&
      typeof object === "object" &&
      !Array.isArray(object) &&
      isDeepStrictEqual(Object.keys(object).sort(), [...keys].sort()),
    `${label}: unexpected public DTO fields`,
  );
function userDTO(user, managed = false) {
  exactKeys(
    user,
    ["id", "username", "displayName", "role", ...(managed ? ["disabled", "createdAt"] : [])],
    "user",
  );
  assert(
    typeof user.id === "string" && /^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(user.id),
    "user: invalid id",
  );
  assert(
    typeof user.username === "string" && typeof user.displayName === "string",
    "user: invalid public identity fields",
  );
  assert(["admin", "user"].includes(user.role), "user: invalid role");
  if (managed)
    assert(
      typeof user.disabled === "boolean" && Number.isFinite(Date.parse(user.createdAt)),
      "user: invalid management fields",
    );
}
function noSecrets(value) {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(
      !/^(?:apiKey|encryptedApiKey|password|passwordHash|token|tokenHash|sessionToken|secret|authorization|cookie)$/iu.test(
        key,
      ),
      "public response contains a secret field",
    );
    noSecrets(child);
  }
}
function configDTO(config) {
  const currentFormat = !legacyDemo || Object.hasOwn(config, "apiFormat");
  exactKeys(
    config,
    [
      "enabled",
      "model",
      "keyConfigured",
      "budgets",
      "pricing",
      ...(currentFormat ? ["apiFormat", "baseUrl"] : []),
    ],
    "AI config",
  );
  if (currentFormat) {
    assert(
      ["responses", "chat_completions"].includes(config.apiFormat) &&
        typeof config.baseUrl === "string",
      "AI config: invalid API format or base URL",
    );
  }
  assert(
    typeof config.enabled === "boolean" &&
      typeof config.keyConfigured === "boolean" &&
      typeof config.model === "string",
    "AI config: invalid public fields",
  );
  exactKeys(config.budgets, ["perRequest", "perHour", "perDay", "perMonth"], "AI budgets");
  exactKeys(config.pricing, ["inputPerMillion", "outputPerMillion"], "AI pricing");
  assert(
    Object.values(config.budgets).every((value) => Number.isFinite(value) && value >= 0),
    "AI budgets: invalid amount",
  );
  assert(
    Object.values(config.pricing).every(
      (value) => value === null || (Number.isFinite(value) && value >= 0),
    ),
    "AI pricing: invalid amount",
  );
  noSecrets(config);
}

// The legacy baseline remains available for deployed images using the tiny fixture.
const legacyRows = {
  score_course: [
    ["AAA", 79.67, 3],
    ["CCC", 70.67, 3],
    ["BBB", 67.67, 3],
  ],
  score_term: [
    ["2024B", 70.67, 3],
    ["2024J", 73.67, 6],
  ],
  activity_course: [
    ["AAA", 186, 3],
    ["CCC", 178, 3],
    ["BBB", 145, 3],
  ],
  activity_term: [
    ["2024B", 178, 3],
    ["2024J", 331, 6],
  ],
  completion_rate_course: [
    ["AAA", 100, 3],
    ["BBB", 66.67, 3],
    ["CCC", 66.67, 3],
  ],
  completion_rate_term: [
    ["2024B", 66.67, 3],
    ["2024J", 83.33, 6],
  ],
};
const legacyDemo = process.env.SMOKE_DEMO_DATASET === "legacy";
if (
  process.env.SMOKE_DEMO_DATASET &&
  !["expanded", "legacy"].includes(process.env.SMOKE_DEMO_DATASET)
) {
  console.error("FAIL input: SMOKE_DEMO_DATASET must be expanded or legacy");
  process.exit(1);
}
const demoReference = legacyDemo
  ? null
  : JSON.parse(readFileSync(new URL("../data/sample/summary.json", import.meta.url), "utf8"));
const rows = demoReference?.expectedRows ?? legacyRows;
const demoCounts = demoReference?.tables ?? { learning_activity: 27, student_outcomes: 9 };
const demoDictionary = legacyDemo
  ? null
  : JSON.parse(
      readFileSync(new URL("../data/schema/data-dictionary.json", import.meta.url), "utf8"),
    );
const goldenCases = [
  ["score-course-top", "哪门课程平均成绩最高？", "score", "course", "bar"],
  ["score-course-compare", "比较各课程平均成绩。", "score", "course", "bar"],
  ["score-term", "各学期平均成绩如何？", "score", "term", "line"],
  ["activity-course-top", "哪门课程学习活跃次数最多？", "activity", "course", "bar"],
  ["activity-course-compare", "比较各课程学习活跃次数。", "activity", "course", "bar"],
  ["activity-term", "各学期学习活跃次数如何？", "activity", "term", "line"],
  ["completion-course-top", "哪门课程完成率最高？", "completion_rate", "course", "bar"],
  ["completion-course-compare", "比较各课程完成率。", "completion_rate", "course", "bar"],
  ["completion-term", "各学期完成率如何？", "completion_rate", "term", "line"],
  ["score-course-table", "用表格查看课程平均成绩和样本数。", "score", "course", "table"],
];
function plan(metric, dimension, chartType) {
  return {
    version: 1,
    datasetId: "demo",
    metric,
    aggregation: metric === "activity" ? "sum" : metric === "completion_rate" ? "rate" : "avg",
    dimensions: [dimension],
    filters: [],
    sort:
      dimension === "term" && chartType === "line"
        ? { by: "dimension", direction: "asc" }
        : { by: "value", direction: "desc" },
    limit: 20,
    chartType,
  };
}
function analysisDTO(json, expectedPlan) {
  assert(
    isDeepStrictEqual(json.plan, expectedPlan),
    "analysis: returned plan differs from the golden plan",
  );
  const result = json.result;
  exactKeys(
    result,
    [
      "datasetId",
      "dimension",
      "dimensions",
      "chartType",
      "rows",
      "unit",
      "metricLabel",
      "period",
      "query",
      "durationMs",
      "minSampleSize",
      "filteredOutGroupCount",
    ],
    "analysis result",
  );
  assert(
    result &&
      result.datasetId === "demo" &&
      result.dimension === expectedPlan.dimensions[0] &&
      result.chartType === expectedPlan.chartType,
    "analysis: invalid result metadata",
  );
  assert(
    result.minSampleSize === 3 && result.filteredOutGroupCount === 0,
    "analysis: invalid sample threshold metadata",
  );
  assert(
    isDeepStrictEqual(result.dimensions, expectedPlan.dimensions),
    "analysis: invalid result dimensions",
  );
  assert(
    Number.isFinite(result.durationMs) &&
      result.durationMs >= 0 &&
      typeof result.query === "string" &&
      result.query.length > 30 &&
      /SELECT /iu.test(result.query) &&
      /HAVING /iu.test(result.query) &&
      /LIMIT 20/iu.test(result.query),
    "analysis: invalid execution metadata",
  );
  assert(
    result.unit === { score: "分", activity: "次", completion_rate: "%" }[expectedPlan.metric],
    "analysis: invalid metric unit",
  );
  assert(
    result.metricLabel ===
      { score: "平均成绩", activity: "活跃次数", completion_rate: "完成率" }[expectedPlan.metric],
    "analysis: invalid metric label",
  );
  assert(
    expectedPlan.metric === "activity"
      ? result.period === "模拟数据全部周活动记录" ||
          (legacyDemo && result.period === "模拟数据全部记录（课程第 1–3 周）")
      : result.period === "模拟数据全部开课期记录",
    "analysis: invalid period",
  );
  const expectedRows = rows[`${expectedPlan.metric}_${expectedPlan.dimensions[0]}`];
  assert(
    Array.isArray(result.rows) && result.rows.length === expectedRows.length,
    "analysis: wrong number of result rows",
  );
  expectedRows.forEach(([dimension, value, sampleSize], index) => {
    const actual = result.rows[index];
    exactKeys(actual, ["dimension", "value", "sampleSize"], "analysis row");
    assert(
      actual.dimension === dimension,
      `analysis: wrong dimension or row order at row ${index + 1}`,
    );
    assert(
      Number.isFinite(actual.value) && Math.abs(actual.value - value) <= 0.0100001,
      `analysis: incorrect value at row ${index + 1}`,
    );
    assert(
      actual.sampleSize === sampleSize,
      `analysis: incorrect sample count at row ${index + 1}`,
    );
  });
}

function expectError(reply, status, code, label) {
  expectStatus(reply, status, label);
  assert(
    reply.json?.code === code &&
      typeof reply.json.error === "string" &&
      reply.json.error.length > 0,
    `${label}: incorrect error code or missing public message`,
  );
  noSecrets(reply.json);
}

function rememberAudit({
  source,
  stage,
  code = null,
  datasetId = "demo",
  metricId = null,
  plan: verifiedPlan = null,
  user = loggedInUser,
  reply,
}) {
  const result = reply?.json?.result;
  expectedAudits.push({
    userId: user.id,
    requestSource: source,
    stage,
    errorCode: code,
    datasetId,
    metricId,
    plan: verifiedPlan,
    rowCount: result?.rows.length ?? 0,
    period: result?.period,
    durationMs: result?.durationMs,
  });
}

function parseRecords(bytes) {
  return bytes
    .toString("utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => {
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        throw new SmokeFailure("records: malformed JSONL");
      }
      assert(
        record &&
          typeof record === "object" &&
          !Array.isArray(record) &&
          typeof record.id === "string" &&
          Number.isFinite(Date.parse(record.timestamp)),
        "records: invalid stored record",
      );
      return record;
    });
}

function readRecords(file, allowMissing = false) {
  try {
    return readFileSync(file);
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return Buffer.alloc(0);
    throw new SmokeFailure("records: file is unavailable");
  }
}

async function verifyRecords() {
  if (!input.recordsFile) {
    skipped += 1;
    console.log(
      "SKIP persisted audit, ownership and legacy preservation: no SMOKE_RECORDS_FILE supplied",
    );
    return;
  }
  await check(
    "persisted audit: both interfaces, stages, errors and authenticated ownership",
    async () => {
      const after = readRecords(input.recordsFile);
      assert(
        after.subarray(0, recordsBefore.length).equals(recordsBefore),
        "records: prior bytes were changed or removed",
      );
      const newBytes = after.subarray(recordsBefore.length);
      const audits = parseRecords(newBytes);
      assert(
        audits.length === expectedAudits.length,
        "records: unexpected audit count; use an isolated instance and its actual mounted file",
      );
      audits.forEach((record, index) => {
        const expected = expectedAudits[index];
        exactKeys(
          record,
          [
            "id",
            "timestamp",
            "datasetId",
            "datasetVersion",
            "metricId",
            "metricVersion",
            "plan",
            "userId",
            "requestSource",
            "stage",
            "result",
            "errorCode",
            "errorMessage",
          ],
          "audit",
        );
        for (const field of [
          "userId",
          "requestSource",
          "stage",
          "errorCode",
          "datasetId",
          "metricId",
          "plan",
        ]) {
          assert(
            isDeepStrictEqual(record[field], expected[field]),
            `records: incorrect ${field} at new audit ${index + 1}`,
          );
        }
        assert(
          record.datasetVersion === "1.0" && record.metricVersion === "1.0",
          "records: incorrect version metadata",
        );
        exactKeys(record.result, ["rowCount", "period", "durationMs"], "audit result");
        assert(
          record.result.rowCount === expected.rowCount &&
            Number.isFinite(record.result.durationMs) &&
            record.result.durationMs >= 0,
          "records: incorrect result summary",
        );
        if (expected.period !== undefined)
          assert(
            record.result.period === expected.period &&
              record.result.durationMs === expected.durationMs,
            "records: success summary differs from the response",
          );
        assert(typeof record.result.period === "string", "records: period missing");
        assert(
          expected.errorCode
            ? typeof record.errorMessage === "string" && record.errorMessage.length > 0
            : record.errorMessage === null,
          "records: invalid audit error message",
        );
        noSecrets(record);
      });
      const serialized = newBytes.toString("utf8");
      for (const value of [
        input.password,
        input.userPassword,
        input.basicAuth,
        cookie,
        userCookie,
        ...goldenCases.map(([, question]) => question),
      ]) {
        if (value)
          assert(
            !serialized.includes(value),
            "records: a credential or untrusted question was persisted",
          );
      }
      parseRecords(after);
    },
  );
  const oldRecords = parseRecords(recordsBefore);
  const legacy = oldRecords.filter(
    (record) =>
      !Object.hasOwn(record, "userId") || (record.plan && Object.keys(record.plan).length === 0),
  );
  if (legacy.length) {
    await check(
      "legacy JSONL remains readable and byte-identical without ownership reassignment",
      async () => {
        const after = readRecords(input.recordsFile);
        assert(
          after.subarray(0, recordsBefore.length).equals(recordsBefore),
          "records: legacy records changed",
        );
        assert(
          isDeepStrictEqual(parseRecords(after).slice(0, oldRecords.length), oldRecords),
          "records: legacy fields were rewritten",
        );
      },
    );
  } else {
    skipped += 1;
    console.log("SKIP legacy preservation: the candidate records file contains no legacy fixture");
  }
}

const protectedRoutes = [
  ["GET", "/api/profile"],
  ["POST", "/api/analysis"],
  ["POST", "/api/ask"],
  ["GET", "/api/ai/status"],
  ["GET", "/api/ai/cost"],
  ["POST", "/api/auth/password"],
  ["GET", "/api/admin/users"],
  ["POST", "/api/admin/users"],
  ["PATCH", "/api/admin/users"],
  ["GET", "/api/admin/ai-config"],
  ["PUT", "/api/admin/ai-config"],
  ["POST", "/api/admin/ai-test"],
];
const mutatingRoutes = [
  ["POST", "/api/auth/login"],
  ["POST", "/api/auth/logout"],
  ...protectedRoutes.filter(([method]) => method !== "GET"),
];

async function main() {
  if (input.recordsFile) {
    recordsBefore = readRecords(input.recordsFile, true);
    assert(
      !recordsBefore.length || recordsBefore.at(-1) === 10,
      "records: existing JSONL must end with a newline",
    );
    parseRecords(recordsBefore);
    if (input.baselineRecordsFile) {
      const baseline = readRecords(input.baselineRecordsFile);
      assert(
        recordsBefore.subarray(0, baseline.length).equals(baseline),
        "records: candidate does not preserve the supplied baseline",
      );
      pass("candidate records preserve the supplied baseline byte-for-byte");
    }
  } else assert(!input.baselineRecordsFile, "records: a baseline also requires SMOKE_RECORDS_FILE");
  let html;
  await check("homepage HTML", async () => {
    const reply = await request("/");
    expectStatus(reply, 200, "homepage");
    assert(
      reply.response.headers.get("content-type")?.includes("text/html"),
      "homepage: invalid MIME type",
    );
    assert(
      reply.text.includes("学析台") && /<html[\s>]/iu.test(reply.text),
      "homepage: expected application content missing",
    );
    html = reply.text;
  });
  for (const [extension, mime] of [
    ["css", /text\/css/iu],
    ["js", /(?:javascript|ecmascript)/iu],
  ]) {
    await check(`static ${extension.toUpperCase()}`, async () => {
      const paths = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/giu)]
        .map((match) => match[1].replaceAll("&amp;", "&"))
        .filter(
          (path) =>
            path.startsWith("/_next/static/") &&
            new URL(path, base).pathname.endsWith(`.${extension}`),
        );
      assert(paths.length > 0, `homepage: no ${extension} asset found`);
      const reply = await request(paths[0]);
      expectStatus(reply, 200, `static ${extension}`);
      assert(
        mime.test(reply.response.headers.get("content-type") || "") && reply.text.length > 100,
        `static ${extension}: invalid or empty asset`,
      );
    });
  }
  await check("anonymous session and initialized admin", async () => {
    const reply = await request("/api/auth/session");
    expectStatus(reply, 200, "anonymous session");
    expectNoStore(reply, "anonymous session");
    exactKeys(reply.json, ["user", "setupRequired"], "session");
    assert(
      reply.json.user === null && reply.json.setupRequired === false,
      "session: expected anonymous session with setupRequired=false",
    );
  });
  for (const [method, path] of protectedRoutes) {
    await check(`anonymous ${method} ${path} returns 401`, async () => {
      const reply = await request(path, { method, ...(method === "GET" ? {} : { body: {} }) });
      expectStatus(reply, 401, "anonymous protected request");
      assert(reply.json?.code === "UNAUTHENTICATED", "anonymous request: expected UNAUTHENTICATED");
    });
  }
  await check("login, secure session cookie and public user DTO", async () => {
    const reply = await request("/api/auth/login", {
      method: "POST",
      body: { username: input.username, password: input.password },
    });
    expectStatus(reply, 200, "login");
    expectNoStore(reply, "login");
    const cookieHeaders =
      typeof reply.response.headers.getSetCookie === "function"
        ? reply.response.headers.getSetCookie()
        : [reply.response.headers.get("set-cookie") || ""];
    const sessionCookie = cookieHeaders.find((value) => value.startsWith(`${COOKIE_NAME}=`));
    assert(sessionCookie, "login: session cookie missing");
    cookie = sessionCookie.split(";")[0];
    assert(
      new RegExp(`^${COOKIE_NAME}=[a-f0-9]{64}$`, "u").test(cookie),
      "login: invalid session token format",
    );
    const secureExpected =
      new URL(origin).protocol === "https:" || process.env.SMOKE_REQUIRE_SECURE_COOKIE !== "0";
    for (const attribute of [
      ...(secureExpected ? [/;\s*Secure(?:;|$)/iu] : []),
      /;\s*HttpOnly(?:;|$)/iu,
      /;\s*SameSite=Lax(?:;|$)/iu,
      /;\s*Path=\/(?:;|$)/iu,
      /;\s*Expires=/iu,
    ]) {
      assert(attribute.test(sessionCookie), "login: required cookie security attribute missing");
    }
    exactKeys(reply.json, ["user"], "login");
    userDTO(reply.json.user);
    assert(reply.json.user.role === "admin", "login: smoke credentials must belong to an admin");
    noSecrets(reply.json);
    loggedInUser = reply.json.user;
  });
  await check("authenticated session public DTO", async () => {
    const reply = await request("/api/auth/session", { authenticated: true });
    expectStatus(reply, 200, "authenticated session");
    expectNoStore(reply, "authenticated session");
    exactKeys(reply.json, ["user", "setupRequired"], "session");
    userDTO(reply.json.user);
    assert(
      reply.json.setupRequired === false && isDeepStrictEqual(reply.json.user, loggedInUser),
      "session: current user does not match login",
    );
  });
  await check(
    `demo dataset profile: ${demoCounts.learning_activity} activity rows and ${demoCounts.student_outcomes} outcome rows`,
    async () => {
      const reply = await request("/api/profile", { authenticated: true });
      expectStatus(reply, 200, "profile");
      expectNoStore(reply, "profile");
      assert(Array.isArray(reply.json?.datasets), "profile: datasets missing");
      const demo = reply.json.datasets.find((dataset) => dataset.id === "demo");
      assert(
        demo?.available === true &&
          Array.isArray(demo.tables) &&
          demo.tables.length === Object.keys(demoCounts).length,
        "profile: demo unavailable or invalid tables",
      );
      for (const [name, count] of Object.entries(demoCounts)) {
        const fieldDefinitions = demoDictionary?.tables[name]?.fields;
        const fieldCount = fieldDefinitions ? Object.keys(fieldDefinitions).length : 5;
        const table = demo.tables.find((candidate) => candidate.name === name);
        assert(
          table?.status === "ready" && table.rows === count,
          `profile: invalid ${name} count or status`,
        );
        assert(
          Array.isArray(table.fields) &&
            table.fields.length === fieldCount &&
            table.fields.every(
              (field) =>
                typeof field.name === "string" &&
                typeof field.type === "string" &&
                Number.isInteger(field.missing) &&
                field.missing >= 0 &&
                field.missing <= count &&
                (fieldDefinitions?.[field.name]?.nullable || field.missing === 0),
            ),
          `profile: invalid ${name} field metadata`,
        );
      }
    },
  );
  let aiConfig;
  let callsBefore;
  await check("admin users: public DTOs without credentials", async () => {
    const reply = await request("/api/admin/users", { authenticated: true });
    expectStatus(reply, 200, "admin users");
    expectNoStore(reply, "admin users");
    exactKeys(reply.json, ["users"], "admin users");
    assert(
      Array.isArray(reply.json.users) && reply.json.users.length > 0,
      "admin users: empty list",
    );
    reply.json.users.forEach((user) => userDTO(user, true));
    assert(
      reply.json.users.some((user) => user.id === loggedInUser.id),
      "admin users: current admin missing",
    );
    noSecrets(reply.json);
  });
  await check("admin AI config and cost stats: readable without secrets", async () => {
    const reply = await request("/api/admin/ai-config", { authenticated: true });
    expectStatus(reply, 200, "AI config");
    expectNoStore(reply, "AI config");
    exactKeys(reply.json, ["config", "stats"], "AI config response");
    configDTO(reply.json.config);
    assert(
      Number.isInteger(reply.json.stats?.totalCalls) && reply.json.stats.totalCalls >= 0,
      "AI stats: invalid totalCalls",
    );
    noSecrets(reply.json);
    aiConfig = reply.json.config;
    callsBefore = reply.json.stats.totalCalls;
  });
  await check("AI status matches public configuration", async () => {
    const reply = await request("/api/ai/status", { authenticated: true });
    expectStatus(reply, 200, "AI status");
    expectNoStore(reply, "AI status");
    exactKeys(reply.json, ["configured", "enabled"], "AI status");
    const configured = Boolean(
      aiConfig.keyConfigured &&
      aiConfig.model &&
      aiConfig.pricing.inputPerMillion !== null &&
      aiConfig.pricing.outputPerMillion !== null,
    );
    assert(
      reply.json.configured === configured && reply.json.enabled === aiConfig.enabled,
      "AI status: does not match configuration",
    );
  });
  for (const [id, question, metric, dimension, chartType] of goldenCases) {
    await check(`golden ${id}: plan, values, order and sample counts`, async () => {
      const reply = await request("/api/ask", {
        method: "POST",
        authenticated: true,
        body: { datasetId: "demo", question },
      });
      expectStatus(reply, 200, `golden ${id}`);
      assert(
        reply.json?.question === question &&
          reply.json.planning?.source === "golden_case" &&
          reply.json.planning.matchedCaseId === id &&
          reply.json.planning.model === null,
        "golden: planning metadata incorrect",
      );
      exactKeys(reply.json, ["question", "planning", "plan", "result"], "golden response");
      exactKeys(
        reply.json.planning,
        ["source", "rationale", "matchedCaseId", "model"],
        "golden planning",
      );
      assert(
        reply.json.planning.rationale === "命中已验证的 MVP 固定问题，使用对应的金标准分析计划。",
        "golden: rationale differs from the verified planner",
      );
      analysisDTO(reply.json, plan(metric, dimension, chartType));
      rememberAudit({
        source: "ask",
        stage: "execution",
        metricId: metric,
        plan: reply.json.plan,
        reply,
      });
    });
  }
  await check("direct analysis executes the validated plan", async () => {
    const expectedPlan = plan("score", "course", "bar");
    const reply = await request("/api/analysis", {
      method: "POST",
      authenticated: true,
      body: expectedPlan,
    });
    expectStatus(reply, 200, "direct analysis");
    analysisDTO(reply.json, expectedPlan);
    rememberAudit({
      source: "analysis",
      stage: "execution",
      metricId: "score",
      plan: expectedPlan,
      reply,
    });
  });
  await check("invalid analysis plan returns 400", async () => {
    const reply = await request("/api/analysis", {
      method: "POST",
      authenticated: true,
      body: { ...plan("score", "course", "bar"), aggregation: "sum" },
    });
    expectError(reply, 400, "INVALID_PLAN", "invalid analysis plan");
    rememberAudit({
      source: "analysis",
      stage: "validation",
      metricId: "score",
      code: "INVALID_PLAN",
    });
  });
  await check("empty analysis returns 422 NO_DATA", async () => {
    const expectedPlan = {
      ...plan("score", "course", "bar"),
      filters: [{ field: "course", op: "eq", value: "__smoke_missing_course__" }],
    };
    const reply = await request("/api/analysis", {
      method: "POST",
      authenticated: true,
      body: expectedPlan,
    });
    expectError(reply, 422, "NO_DATA", "empty analysis");
    rememberAudit({
      source: "analysis",
      stage: "execution",
      metricId: "score",
      plan: expectedPlan,
      code: "NO_DATA",
    });
  });
  await check("invalid question returns 400 INVALID_QUESTION", async () => {
    const reply = await request("/api/ask", {
      method: "POST",
      authenticated: true,
      body: { datasetId: "demo", question: "" },
    });
    expectError(reply, 400, "INVALID_QUESTION", "invalid question");
    rememberAudit({ source: "ask", stage: "validation", code: "INVALID_QUESTION" });
  });
  for (const [path, code, source] of [
    ["/api/analysis", "INVALID_PLAN", "analysis"],
    ["/api/ask", "INVALID_QUESTION", "ask"],
  ]) {
    await check(`malformed JSON ${path} returns 400 ${code}`, async () => {
      const reply = await request(path, { method: "POST", authenticated: true, rawBody: "{" });
      expectError(reply, 400, code, "malformed JSON");
      rememberAudit({ source, stage: "validation", datasetId: null, code });
    });
  }
  if (!aiConfig.enabled || !aiConfig.keyConfigured || !aiConfig.model) {
    await check("unconfigured or disabled AI returns 503 AI_NOT_CONFIGURED", async () => {
      const reply = await request("/api/ask", {
        method: "POST",
        authenticated: true,
        body: { datasetId: "demo", question: "请分析模拟数据里各课程的平均成绩并补充解释。" },
      });
      expectError(reply, 503, "AI_NOT_CONFIGURED", "unconfigured AI");
      rememberAudit({ source: "ask", stage: "planning", code: "AI_NOT_CONFIGURED" });
    });
  } else {
    skipped += 1;
    console.log("SKIP non-golden AI request: configuration could cause a real provider call");
  }
  if (input.userUsername) {
    await check("ordinary test-user login and distinct public identity", async () => {
      const reply = await request("/api/auth/login", {
        method: "POST",
        body: { username: input.userUsername, password: input.userPassword },
      });
      expectStatus(reply, 200, "ordinary login");
      const sessionCookie = reply.response.headers
        .getSetCookie()
        .find((value) => value.startsWith(`${COOKIE_NAME}=`));
      assert(sessionCookie, "ordinary login: session cookie missing");
      userCookie = sessionCookie.split(";")[0];
      userDTO(reply.json?.user);
      assert(
        reply.json.user.role === "user" && reply.json.user.id !== loggedInUser.id,
        "ordinary login: expected a separate ordinary account",
      );
      noSecrets(reply.json);
      ordinaryUser = reply.json.user;
    });
    for (const [method, path] of [
      ...protectedRoutes.filter(([, path]) => path.startsWith("/api/admin/")),
      ["GET", "/api/ai/cost"],
    ]) {
      await check(`ordinary ${method} ${path} returns 403 FORBIDDEN`, async () => {
        const reply = await request(path, {
          method,
          sessionCookie: userCookie,
          ...(method === "GET" ? {} : { body: {} }),
        });
        expectError(reply, 403, "FORBIDDEN", "ordinary admin access");
      });
    }
    for (const path of ["/api/profile", "/api/ai/status", "/api/auth/session"]) {
      await check(`ordinary GET ${path} allowed`, async () => {
        const reply = await request(path, { sessionCookie: userCookie });
        expectStatus(reply, 200, "ordinary read");
        expectNoStore(reply, "ordinary read");
        noSecrets(reply.json);
        if (path === "/api/auth/session")
          assert(
            isDeepStrictEqual(reply.json?.user, ordinaryUser),
            "ordinary session: wrong owner",
          );
      });
    }
    for (const [path, source, body] of [
      ["/api/analysis", "analysis", plan("score", "course", "bar")],
      ["/api/ask", "ask", { datasetId: "demo", question: goldenCases[0][1] }],
    ]) {
      await check(`ordinary ${source} success belongs to its authenticated user`, async () => {
        const reply = await request(path, { method: "POST", sessionCookie: userCookie, body });
        expectStatus(reply, 200, "ordinary analysis");
        analysisDTO(reply.json, plan("score", "course", "bar"));
        rememberAudit({
          source,
          stage: "execution",
          metricId: "score",
          plan: reply.json.plan,
          user: ordinaryUser,
          reply,
        });
      });
    }
    for (const [path, source, code] of [
      ["/api/analysis", "analysis", "INVALID_PLAN"],
      ["/api/ask", "ask", "INVALID_QUESTION"],
    ]) {
      await check(`ordinary ${source} failure belongs to its authenticated user`, async () => {
        const reply = await request(path, {
          method: "POST",
          sessionCookie: userCookie,
          body: { datasetId: "demo" },
        });
        expectError(reply, 400, code, "ordinary invalid request");
        rememberAudit({ source, stage: "validation", code, user: ordinaryUser });
      });
    }
  } else {
    skipped += 1;
    console.log(
      "SKIP ordinary permissions and cross-user audit ownership: supply SMOKE_USER_USERNAME and SMOKE_USER_PASSWORD",
    );
  }
  for (const [method, path] of mutatingRoutes) {
    await check(`cross-origin ${method} ${path} returns 403`, async () => {
      const reply = await request(path, {
        method,
        authenticated: true,
        requestOrigin: "https://invalid-origin.example",
        fetchSite: "cross-site",
        body: {},
      });
      expectStatus(reply, 403, "cross-origin request");
      assert(
        reply.json?.code === "INVALID_ORIGIN",
        "cross-origin request: expected INVALID_ORIGIN",
      );
    });
  }
  await check("same Origin with cross-site metadata returns 403", async () => {
    const reply = await request("/api/analysis", {
      method: "POST",
      authenticated: true,
      fetchSite: "cross-site",
      body: {},
    });
    expectStatus(reply, 403, "cross-site request");
    assert(reply.json?.code === "INVALID_ORIGIN", "cross-site request: expected INVALID_ORIGIN");
  });
  await check("missing Origin mutation returns 403 INVALID_ORIGIN", async () => {
    const reply = await request("/api/analysis", {
      method: "POST",
      authenticated: true,
      requestOrigin: null,
      body: {},
    });
    expectError(reply, 403, "INVALID_ORIGIN", "missing Origin");
  });
  await check("admin AI cost endpoint and unchanged provider call count", async () => {
    const reply = await request("/api/ai/cost", { authenticated: true });
    expectStatus(reply, 200, "AI cost");
    expectNoStore(reply, "AI cost");
    exactKeys(reply.json, ["stats"], "AI cost");
    noSecrets(reply.json);
    assert(
      reply.json.stats?.totalCalls === callsBefore,
      "AI cost: provider call count changed during smoke checks",
    );
  });
  await verifyRecords();
}

try {
  await main();
} catch (error) {
  failure = true;
  console.error(
    `FAIL ${error instanceof SmokeFailure ? error.message : "unexpected smoke execution error"}`,
  );
} finally {
  if (userCookie) {
    try {
      await check("ordinary logout revokes the test session", async () => {
        const reply = await request("/api/auth/logout", {
          method: "POST",
          sessionCookie: userCookie,
          body: {},
        });
        expectStatus(reply, 200, "ordinary logout");
        const session = await request("/api/auth/session", { sessionCookie: userCookie });
        expectStatus(session, 200, "ordinary revoked session");
        assert(session.json?.user === null, "ordinary logout: session remains valid");
      });
    } catch (error) {
      failure = true;
      console.error(
        `FAIL ${error instanceof SmokeFailure ? error.message : "ordinary logout validation failed"}`,
      );
    }
  }
  if (cookie) {
    try {
      await check("logout clears cookie and revokes the previous session", async () => {
        const reply = await request("/api/auth/logout", {
          method: "POST",
          authenticated: true,
          body: {},
        });
        expectStatus(reply, 200, "logout");
        assert(reply.json?.success === true, "logout: success missing");
        const cleared = reply.response.headers.get("set-cookie") || "";
        assert(
          cleared.startsWith(`${COOKIE_NAME}=;`) &&
            /;\s*Expires=Thu, 01 Jan 1970 00:00:00 GMT/iu.test(cleared),
          "logout: expired cookie missing",
        );
        // Deliberately replay the original cookie to prove server-side revocation.
        const session = await request("/api/auth/session", { authenticated: true });
        expectStatus(session, 200, "revoked session");
        assert(
          session.json?.user === null && session.json.setupRequired === false,
          "logout: old session remains valid",
        );
        const profile = await request("/api/profile", { authenticated: true });
        expectStatus(profile, 401, "revoked profile access");
        assert(
          profile.json?.code === "UNAUTHENTICATED",
          "logout: revoked cookie still authorizes protected requests",
        );
      });
    } catch (error) {
      failure = true;
      console.error(
        `FAIL ${error instanceof SmokeFailure ? error.message : "logout validation failed"}`,
      );
    }
  }
  cookie = "";
  userCookie = "";
  input.password = "";
  input.userPassword = "";
  input.basicAuth = undefined;
  gatewayAuthorization = undefined;
  console.log(
    `SUMMARY passed=${passed} skipped=${skipped} result=${failure ? "FAIL" : skipped ? "PASS_WITH_SKIPS" : "PASS"}`,
  );
  process.exitCode = failure ? 1 : 0;
}
