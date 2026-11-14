#!/usr/bin/env node
/**
 * Readiness probe for the packaged server: one anonymous GET /api/auth/session
 * against the loopback interface on the port this process actually listens on.
 *
 * The endpoint answers { user, setupRequired }. An instance with no administrator
 * yet is healthy: initializeAdmin has not run, and setSessionCookie is irrelevant
 * because the request carries no cookie. A fresh records directory therefore stays
 * usable for `admin:init`.
 *
 * Failures: connection errors, no response within the timeout, any status other
 * than 200, a non-JSON body, and a payload without
 * { user: null, setupRequired: boolean }. Redirects are never followed, so a 3xx
 * (proxy login page, captive gateway) fails instead of reporting green.
 * Healthy responses are anonymous by definition: a user object means the probe is
 * not testing the anonymous path, so it fails rather than guessing.
 *
 * Configure with PORT (the container's listening port, default 3000).
 * Exit 0 = ready, exit 1 = not ready; Docker/Compose read the exit code only.
 */
import { request as httpRequest } from "node:http";

const HOST = "127.0.0.1";
const PATH = "/api/auth/session";
const TIMEOUT_MS = 3_000;
const MAX_BODY_BYTES = 8_192;
const PORT = Number(process.env.PORT ?? 3000);

function fail(reason) {
  console.error(`FAIL health ${PATH}: ${reason}`);
  process.exit(1);
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65_535)
  fail(`PORT is not a usable port: ${JSON.stringify(process.env.PORT)}`);

// One deadline for the whole exchange, so a body trickling below the socket idle
// timeout still fails before Docker's own 5s ceiling.
const deadline = setTimeout(() => {
  request.destroy();
  fail(`no complete response within ${TIMEOUT_MS}ms`);
}, TIMEOUT_MS);

const request = httpRequest(
  {
    host: HOST,
    port: PORT,
    path: PATH,
    method: "GET",
    headers: { accept: "application/json" },
    timeout: TIMEOUT_MS,
  },
  (response) => {
    const status = response.statusCode ?? 0;
    if (status !== 200) {
      response.resume();
      fail(`unexpected status ${status}`);
    }
    const contentType = (response.headers["content-type"] ?? "").split(";")[0].trim();
    if (contentType !== "application/json") {
      response.resume();
      fail(`unexpected content-type ${JSON.stringify(contentType)}`);
    }
    const chunks = [];
    let bytes = 0;
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) fail(`response exceeds ${MAX_BODY_BYTES} bytes`);
      chunks.push(chunk);
    });
    response.on("end", () => {
      let payload;
      try {
        payload = JSON.parse(chunks.join(""));
      } catch {
        fail("response is not JSON");
      }
      if (!payload || typeof payload !== "object" || Array.isArray(payload))
        fail("response is not a JSON object");
      if (payload.user !== null) fail("anonymous request returned a session user");
      if (typeof payload.setupRequired !== "boolean")
        fail(`setupRequired is ${typeof payload.setupRequired}, not boolean`);
      console.log(`healthy ${PATH} status=200 setupRequired=${payload.setupRequired}`);
      process.exit(0);
    });
    response.on("error", () => fail("response stream failed"));
  },
);

request.on("timeout", () => {
  request.destroy();
  fail(`no response within ${TIMEOUT_MS}ms`);
});
request.on("error", (error) => fail(`request failed: ${error.code ?? error.name}`));
request.end();
