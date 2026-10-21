import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createConversation, getConversation } from "./repository";
import { CONVERSATION_RETENTION_MS } from "./types";

const execute = promisify(execFile);
const T0 = new Date("2026-10-20T08:00:00.000Z");
let directory = "";
let bundle = "";
let bundleDirectory = "";

function bucketPath(owner: string) {
  return join(
    directory,
    "conversations",
    `${createHash("sha256").update(owner).digest("hex")}.json`,
  );
}

beforeAll(async () => {
  // Bundle the real repository (including its zod/auth imports) for child
  // processes. This exercises the actual cross-process file lock, not a mock.
  const root = process.cwd();
  // Resolve the installed esbuild binary without pinning a store version.
  const store = join(root, "node_modules/.pnpm");
  const packageDirectory = readdirSync(store).find((name) => /^esbuild@\d/.test(name));
  if (!packageDirectory) throw new Error("esbuild is required to bundle this test");
  const esbuild = join(store, packageDirectory, "node_modules/esbuild/bin/esbuild");
  bundleDirectory = mkdtempSync(join(tmpdir(), "conversation-bundle-"));
  bundle = join(bundleDirectory, "repository.cjs");
  await execute(
    esbuild,
    [
      "lib/conversations/repository.ts",
      "--bundle",
      "--platform=node",
      "--format=cjs",
      `--outfile=${bundle}`,
    ],
    { cwd: root, timeout: 30_000 },
  );
}, 40_000);

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "conversation-process-"));
  process.env.APP_STATE_DIR = directory;
});

afterEach(() => {
  delete process.env.APP_STATE_DIR;
  rmSync(directory, { recursive: true, force: true });
});

afterAll(() => {
  if (bundleDirectory) rmSync(bundleDirectory, { recursive: true, force: true });
});

async function runChild(code: string) {
  return execute(process.execPath, ["-e", code], {
    timeout: 20_000,
    env: { ...process.env, APP_STATE_DIR: directory },
  });
}

describe("cross-process conversation transactions", () => {
  it("allows exactly one concurrent claim per revision", async () => {
    const owner = "multi-process-owner";
    const created = createConversation(owner, { datasetId: "demo", now: T0 });
    const ids = [
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
    ];
    const child = (turnId: string) => `
      const repo = require(${JSON.stringify(bundle)});
      try {
        const result = repo.claimTurn(${JSON.stringify(owner)}, {
          conversationId: ${JSON.stringify(created.id)},
          turnId: ${JSON.stringify(turnId)},
          question: "并发窗口提问",
          datasetId: "demo",
          expectedRevision: 0,
          now: new Date(${JSON.stringify(T0.toISOString())}),
        });
        console.log(JSON.stringify({ ok: true, revision: result.claim.revision }));
        // Keep this worker alive while siblings race: a real worker holds its
        // lease for the whole analysis, so a second claim must wait, not
        // observe a dead owner and start a new revision.
        setTimeout(() => process.exit(0), 1500);
      } catch (error) {
        console.log(JSON.stringify({ ok: false, code: error.code }));
      }
    `;
    const results = await Promise.all(ids.map((id) => runChild(child(id))));
    const parsed = results.map(({ stdout }) => JSON.parse(stdout.trim()));
    expect(parsed.filter((item) => item.ok)).toHaveLength(1);
    expect(parsed.filter((item) => !item.ok).map((item) => item.code)).toEqual([
      "TURN_IN_PROGRESS",
      "TURN_IN_PROGRESS",
    ]);
    const detail = getConversation(owner, created.id, { now: new Date(T0.getTime() + 1000) });
    expect(detail.turns).toHaveLength(1);
    expect(detail.messages).toHaveLength(1);
    expect(detail.conversation.revision).toBe(1);
  });

  it("keeps cleanup and a racing renewal consistent", async () => {
    const owner = "cleanup-race-owner";
    const created = createConversation(owner, { datasetId: "demo", now: T0 });
    // Expire almost immediately so cleanup and a real new message race.
    const file = bucketPath(owner);
    const raw = JSON.parse(readFileSync(file, "utf8"));
    raw.conversations[0].expiresAt = new Date(Date.now() + 400).toISOString();
    writeFileSync(file, JSON.stringify(raw));
    const now = new Date(Date.now() + 650).toISOString();
    const cleanup = runChild(`
      const repo = require(${JSON.stringify(bundle)});
      console.log(JSON.stringify(repo.cleanupConversations(new Date(${JSON.stringify(now)}))));
    `);
    const renewal = runChild(`
      const repo = require(${JSON.stringify(bundle)});
      try {
        repo.claimTurn(${JSON.stringify(owner)}, {
          conversationId: ${JSON.stringify(created.id)},
          turnId: "44444444-4444-4444-8444-444444444444",
          question: "到期边界的新问题",
          datasetId: "demo",
          expectedRevision: 0,
          now: new Date(${JSON.stringify(now)}),
        });
        console.log(JSON.stringify({ ok: true }));
      } catch (error) {
        console.log(JSON.stringify({ ok: false, code: error.code }));
      }
    `);
    const [clean, renewed] = await Promise.all([cleanup, renewal]);
    expect(JSON.parse(clean.stdout.trim())).toMatchObject({ removed: expect.any(Number) });
    const claim = JSON.parse(renewed.stdout.trim());
    const visible = (() => {
      try {
        return getConversation(owner, created.id, { now: new Date(now) });
      } catch {
        return null;
      }
    })();
    if (claim.ok) {
      // A renewal that won must not have been physically removed afterwards.
      expect(visible).not.toBeNull();
      expect(visible!.conversation.expiresAt).toBe(
        new Date(Date.parse(now) + CONVERSATION_RETENTION_MS).toISOString(),
      );
      expect(visible!.messages.filter((message) => message.role === "user")).toHaveLength(1);
    } else {
      // Cleanup that won invalidates the old id; it must not be resurrected.
      expect(claim.code).toBe("CONVERSATION_UNAVAILABLE");
      expect(visible).toBeNull();
    }
  });
});
