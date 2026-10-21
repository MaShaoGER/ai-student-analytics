import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const recovery = fileURLToPath(new URL("./recovery.mjs", import.meta.url));
const rollback = fileURLToPath(new URL("./rollback-image.mjs", import.meta.url));
const project = "chuanzhi-recovery-drill";
function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), "chuanzhi-recovery-drill-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  const backup = path.join(root, "backup");
  const target = path.join(root, "restored");
  mkdirSync(path.join(source, "system"), { recursive: true, mode: 0o700 });
  mkdirSync(path.join(source, "archive", "empty"), { recursive: true });
  writeFileSync(path.join(source, "analysis.jsonl"), '{"id":"old-record","userId":null}\n{"id":"owned-record","userId":"user-1"}\n');
  for (const [name, data] of Object.entries({ "accounts.json": { version: 2, users: [{ id: "admin-1", role: "admin", datasetIds: [], mustChangePassword: false, passwordHash: "fixture-hash" }, { id: "reader-1", role: "readonly", datasetIds: ["demo"], mustChangePassword: true, passwordHash: "fixture-reader-hash" }], sessions: [], __adminAudit: { version: 1, events: [{ id: "fixture-event", action: "user.create", actorId: "admin-1" }] } }, "datasets.json": { version: 1, datasets: [{ id: "demo", enabled: true }, { id: "oulad", enabled: false }] }, "sessions.json": { sessions: [{ id: "fixture-session" }] }, "cost-history.json": { records: [{ cost: 0.12 }] }, "login-rate-limits.json": { attempts: [] } })) writeFileSync(path.join(source, "system", name), JSON.stringify(data), { mode: 0o600 });
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("student-analytics:ai-key:v1"));
  const plaintext = "fixture-only-private-ai-key";
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  writeFileSync(path.join(source, "system", "ai-config.json"), JSON.stringify({ enabled: true, model: "fixture-model", encryptedApiKey: { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") } }), { mode: 0o600 });
  const encodedKey = key.toString("base64");
  const run = (command, args = [], env = {}) => spawnSync(process.execPath, [recovery, command, ...args], { encoding: "utf8", env: { ...process.env, APP_SETTINGS_KEY: encodedKey, ...env } });
  const save = () => run("fixture-backup", ["--project", project, "--source-dir", source, "--confirm-offline", source, "--output", backup]);
  const restore = (args = [], env = {}) => run("fixture-restore", ["--project", project, "--backup", backup, "--target-dir", target, "--confirm-target", target, ...args], env);
  return { root, source, backup, target, run, save, restore, encodedKey, plaintext };
}
function succeeds(result) { assert.equal(result.status, 0, result.stderr); }
function refuses(result) { assert.equal(result.status, 1, result.stdout + result.stderr); }
function rewriteManifest(backup, mutate) {
  const file = path.join(backup, "manifest.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  mutate(manifest);
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(file, serialized);
  writeFileSync(path.join(backup, "manifest.sha256"), createHash("sha256").update(serialized).digest("hex") + "\n");
}

test("complete records snapshot/restore preserves accounts, sessions, ciphertext, nested directories and hashes", (t) => {
  const f = fixture(t);
  const saved = f.save();
  succeeds(saved);
  succeeds(f.run("verify", ["--backup", f.backup], { APP_SETTINGS_KEY: "" }));
  const restored = f.restore();
  succeeds(restored);
  const manifest = JSON.parse(readFileSync(path.join(f.backup, "manifest.json"), "utf8"));
  assert.equal(manifest.entries.filter((entry) => entry.type === "file").length, 7);
  for (const entry of manifest.entries.filter((item) => item.type === "file")) assert.deepEqual(readFileSync(path.join(f.target, entry.path)), readFileSync(path.join(f.source, entry.path)));
  assert.ok(existsSync(path.join(f.target, "archive", "empty")));
  for (const secret of [f.encodedKey, f.plaintext]) {
    assert.ok(!readFileSync(path.join(f.backup, "manifest.json"), "utf8").includes(secret));
    assert.ok(!(saved.stdout + saved.stderr + restored.stdout + restored.stderr).includes(secret));
  }
});
test("existing restore directory is refused without changing its contents", (t) => {
  const f = fixture(t); succeeds(f.save());
  mkdirSync(f.target); writeFileSync(path.join(f.target, "original"), "keep me");
  refuses(f.restore()); assert.equal(readFileSync(path.join(f.target, "original"), "utf8"), "keep me");
});
test("project mismatch is refused before creating a restore target", (t) => {
  const f = fixture(t); succeeds(f.save());
  const result = f.run("fixture-restore", ["--project", "another-project", "--backup", f.backup, "--target-dir", f.target, "--confirm-target", f.target]);
  refuses(result); assert.ok(!existsSync(f.target));
});
test("missing or changed settings key refuses restore before target creation", (t) => {
  const f = fixture(t); succeeds(f.save());
  for (const key of ["", randomBytes(32).toString("base64")]) { refuses(f.restore([], { APP_SETTINGS_KEY: key })); assert.ok(!existsSync(f.target)); }
});
test("backup authenticates saved AI ciphertext using the original key", (t) => {
  const f = fixture(t);
  for (const key of ["", randomBytes(32).toString("base64")]) {
    refuses(f.run("fixture-backup", ["--project", project, "--source-dir", f.source, "--confirm-offline", f.source, "--output", f.backup], { APP_SETTINGS_KEY: key }));
    assert.ok(!existsSync(f.backup));
  }
});
test("tampered records and extra files refuse verify/restore", (t) => {
  const f = fixture(t); succeeds(f.save());
  writeFileSync(path.join(f.backup, "records", "analysis.jsonl"), "tampered\n");
  refuses(f.run("verify", ["--backup", f.backup])); refuses(f.restore()); assert.ok(!existsSync(f.target));
});
test("symbolic links are refused in source and restored backup", (t) => {
  const f = fixture(t);
  symlinkSync(path.join(f.source, "analysis.jsonl"), path.join(f.source, "link"));
  refuses(f.save()); assert.ok(!existsSync(f.backup));
});
test("manifest traversal is refused even with a matching manifest checksum", (t) => {
  const f = fixture(t); succeeds(f.save());
  rewriteManifest(f.backup, (manifest) => { manifest.entries[1].path = "../outside"; });
  refuses(f.restore()); assert.ok(!existsSync(f.target)); assert.ok(!existsSync(path.join(f.root, "outside")));
});
test("incomplete backup is refused", (t) => {
  const f = fixture(t); succeeds(f.save());
  writeFileSync(path.join(f.backup, ".incomplete"), "failed");
  refuses(f.restore()); assert.ok(!existsSync(f.target));
});
test("backup under source is refused and requires explicit offline confirmation", (t) => {
  const f = fixture(t);
  refuses(f.run("fixture-backup", ["--project", project, "--source-dir", f.source, "--confirm-offline", f.source, "--output", path.join(f.source, "backup")]));
  refuses(f.run("fixture-backup", ["--project", project, "--source-dir", f.source, "--confirm-offline", "wrong", "--output", f.backup]));
  assert.ok(!existsSync(f.backup));
});
test("permission drift and unchecked restore destination are refused", (t) => {
  const f = fixture(t); succeeds(f.save());
  refuses(f.run("fixture-restore", ["--project", project, "--backup", f.backup, "--target-dir", f.target, "--confirm-target", "wrong"]));
  chmodSync(path.join(f.backup, "records", "system", "accounts.json"), 0o644);
  refuses(f.restore()); assert.ok(!existsSync(f.target));
});
test("CLI rejects misspelled/duplicate options and worker mode on the host", (t) => {
  const f = fixture(t);
  refuses(f.run("verify", ["--bakcup", f.backup]));
  refuses(f.run("verify", ["--backup", f.backup, "--backup", f.backup]));
  refuses(f.run("worker-restore", ["--project", project]));
});

function fakeDocker(t, mutate = () => {}) {
  const root = mkdtempSync(path.join(tmpdir(), "chuanzhi-rollback-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const image = "chuanzhi:current";
  const state = { currentId: "sha256:current", previousId: "sha256:previous", image,
    config: { name: project, services: { app: { image, environment: { APP_SETTINGS_KEY: "fixture-secret-do-not-print", APP_STATE_DIR: "/app/records/system", APP_ORIGIN: "http://fixture.local" }, volumes: [{ type: "volume", source: "records", target: "/app/records" }] } }, volumes: { records: { name: "fixture_records" } } },
    container: { Id: "current-container", Image: "sha256:current", State: { Running: true }, Config: { Image: image, Labels: { "com.docker.compose.project": project, "com.docker.compose.service": "app" }, Env: ["APP_SETTINGS_KEY=fixture-secret-do-not-print", "APP_STATE_DIR=/app/records/system", "APP_ORIGIN=http://fixture.local"] }, Mounts: [{ Type: "volume", Name: "fixture_records", Destination: "/app/records", RW: true }] }, applied: false };
  mutate(state);
  const stateFile = path.join(root, "state.json");
  const log = path.join(root, "commands.jsonl");
  writeFileSync(stateFile, JSON.stringify(state));
  const binary = path.join(root, "docker");
  writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);const p=process.env.DRILL_STATE;const s=JSON.parse(fs.readFileSync(p));fs.appendFileSync(process.env.DRILL_LOG,JSON.stringify(a)+'\\n');let out='';if(a[0]==='compose'&&a.includes('config'))out=JSON.stringify(s.config);else if(a[0]==='ps')out='current-container';else if(a[0]==='image')out=a.includes('chuanzhi:previous')?s.previousId:s.currentId;else if(a[0]==='inspect'){const c=structuredClone(s.container);if(s.applied){c.Image=s.previousId;c.Config.Image=s.previousId;}out=JSON.stringify([c]);}else if(a[0]==='compose'&&a.includes('up')){s.applied=true;fs.writeFileSync(p,JSON.stringify(s));}else if(a[0]==='compose'&&a.includes('ps'))out='restored-container';else process.exit(2);process.stdout.write(out);\n`, { mode: 0o700 });
  const override = path.join(root, "rollback.json");
  const args = [rollback, "--project", project, "--compose-file", path.join(root, "compose.yml"), "--service", "app", "--expected-image", image, "--image", "chuanzhi:previous", "--records-volume", "fixture_records", "--override-file", override];
  const run = (apply = false) => spawnSync(process.execPath, [...args, ...(apply ? ["--apply"] : [])], { encoding: "utf8", env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, DRILL_STATE: stateFile, DRILL_LOG: log } });
  return { run, override, commands: () => readFileSync(log, "utf8").trim().split("\n").map(JSON.parse) };
}
test("rollback dry run does not mutate Compose or containers and does not print runtime secrets", (t) => {
  const f = fakeDocker(t); const result = f.run(); succeeds(result);
  assert.ok(!existsSync(f.override)); assert.ok(!f.commands().some((args) => args.includes("up")));
  assert.ok(!(result.stdout + result.stderr).includes("fixture-secret-do-not-print"));
});
test("rollback apply pins previous image and targets only the named service without dependencies/build/pull", (t) => {
  const f = fakeDocker(t); succeeds(f.run(true));
  assert.deepEqual(JSON.parse(readFileSync(f.override, "utf8")), { services: { app: { image: "sha256:previous" } } });
  const up = f.commands().filter((args) => args.includes("up"));
  assert.equal(up.length, 1); assert.equal(up[0].at(-1), "app");
  for (const option of ["--no-deps", "--no-build", "--pull", "--wait"]) assert.ok(up[0].includes(option));
  assert.ok(!f.commands().flat().some((value) => ["down", "rm", "prune", "build"].includes(value)));
});
test("rollback refuses a different records volume or runtime encryption key before mutation", (t) => {
  for (const mutate of [(state) => { state.container.Mounts[0].Name = "other_records"; }, (state) => { state.config.services.app.environment.APP_SETTINGS_KEY = "wrong-key"; }]) {
    const f = fakeDocker(t, mutate); refuses(f.run(true)); assert.ok(!existsSync(f.override)); assert.ok(!f.commands().some((args) => args.includes("up")));
  }
});

test("backups omit expiring AI conversation bodies while retaining source history and accounts", (t) => {
  const f = fixture(t);
  mkdirSync(path.join(f.source, "system", "conversations"));
  writeFileSync(path.join(f.source, "system", "conversations", "fixture.json"), "private conversation");
  succeeds(f.save());
  const manifest = JSON.parse(readFileSync(path.join(f.backup, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.excludedPaths, ["system/conversations"]);
  assert.ok(!manifest.entries.some((entry) => entry.path.startsWith("system/conversations")));
  assert.ok(!existsSync(path.join(f.backup, "records", "system", "conversations")));
  assert.equal(readFileSync(path.join(f.source, "system", "conversations", "fixture.json"), "utf8"), "private conversation");
  succeeds(f.restore());
  assert.ok(existsSync(path.join(f.target, "system", "accounts.json")));
  assert.ok(!existsSync(path.join(f.target, "system", "conversations")));
});
