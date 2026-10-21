#!/usr/bin/env node
/** Records snapshots excluding expiring conversation bodies; never overwrite a restore destination. */
import {
  chmodSync, copyFileSync, constants, existsSync, lstatSync, mkdirSync,
  readFileSync, readdirSync, realpathSync, unlinkSync, writeFileSync,
} from "node:fs";
import { createDecipheriv, createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(import.meta.url);
const schema = "chuanzhi-records-backup/v1";
const help = `Usage (Node 20.9+, no npm dependencies):
  node scripts/recovery.mjs backup --project PROJECT --volume SOURCE --output NEW_DIR [--source-container CONTAINER --source-service SERVICE] [--key-file FILE] [--helper-image IMAGE]
  node scripts/recovery.mjs restore --project PROJECT --target-volume NEW_VOLUME --confirm-target NEW_VOLUME --backup DIR [--key-file FILE] [--helper-image IMAGE]
  node scripts/recovery.mjs verify --backup DIR
  node scripts/recovery.mjs fixture-backup --project PROJECT --source-dir DIR --confirm-offline ABSOLUTE_DIR --output NEW_DIR [--key-file FILE]
  node scripts/recovery.mjs fixture-restore --project PROJECT --target-dir NEW_DIR --confirm-target ABSOLUTE_NEW_DIR --backup DIR [--key-file FILE]

Docker backup requires a Compose project volume label or an explicitly identified
source container/service with that project label and a /app/records volume mount.
Every container using that volume must be stopped or paused by the operator.
Docker restore creates a NEW labelled volume; existing/attached volumes are refused.
Fixture mode is only for offline test data, and restore requires a nonexistent path.
The original 32-byte base64 APP_SETTINGS_KEY is required when AI settings contain
encryptedApiKey. Supply a private key file or APP_SETTINGS_KEY; only its SHA-256
fingerprint enters the manifest. Expiring AI conversation bodies are excluded.
Backups still contain account/login-session state: keep private.
Default helper: node:22-bookworm-slim, already present locally; never pulled.
Failed outputs/volumes are retained for inspection. No original data is deleted.
See docs/recovery.md for release rollback and an isolated drill.`;

class RecoveryError extends Error {}
function fail(message) { throw new RecoveryError(message); }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function required(args, name) {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) fail(`Missing --${name}.`);
  return value;
}
function options(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!/^--[a-z-]+$/.test(argv[i] ?? "") || !argv[i + 1] || argv[i + 1].startsWith("--")) fail("Expected --option VALUE pairs; see --help.");
    const key = argv[i].slice(2);
    if (Object.hasOwn(args, key)) fail(`Duplicate --${key}.`);
    args[key] = argv[i + 1];
  }
  return args;
}
function allowed(args, names) {
  for (const key of Object.keys(args)) if (!names.includes(key)) fail(`Unknown --${key}.`);
}
function projectName(value) {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(value)) fail("Invalid project name.");
  return value;
}
function volumeName(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)) fail("Invalid volume name.");
  return value;
}
function secureDirectory(directory) {
  mkdirSync(directory, { mode: 0o700 }); // EEXIST intentionally fails.
  chmodSync(directory, 0o700);
}
function plainDirectory(directory) {
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) fail("Expected a real directory, not a link.");
  return realpathSync(directory);
}
function newPath(directory) {
  const absolute = path.resolve(directory);
  return path.join(realpathSync(path.dirname(absolute)), path.basename(absolute));
}
function safePath(relative) {
  if (relative === ".") return relative;
  if (typeof relative !== "string" || !relative || relative.includes("\\") || relative.split("/").some((part) => !part || part === "." || part === ".." || /[\x00-\x1f\x7f]/.test(part)) || path.isAbsolute(relative)) fail("Unsafe manifest path.");
  return relative;
}
function inventory(root, { excludeConversations = false } = {}) {
  const entries = [];
  function visit(relative) {
    safePath(relative);
    if (excludeConversations && relative === "system/conversations") return;
    const file = path.join(root, relative);
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) fail("Records must contain only regular files and directories (no links/devices).");
    const entry = { path: relative, type: stat.isDirectory() ? "directory" : "file", mode: stat.mode & 0o777 };
    if (entry.type === "file") { entry.size = stat.size; entry.sha256 = digest(readFileSync(file)); }
    entries.push(entry);
    if (entry.type === "directory") for (const name of readdirSync(file).sort()) visit(relative === "." ? name : `${relative}/${name}`);
  }
  visit(".");
  return entries;
}
function copyEntries(source, target, entries) {
  for (const entry of entries) {
    if (entry.path === ".") continue;
    const destination = path.join(target, safePath(entry.path));
    if (entry.type === "directory") mkdirSync(destination, { mode: 0o700 });
    else copyFileSync(path.join(source, entry.path), destination, constants.COPYFILE_EXCL);
  }
  // Directory permissions last, so a read-only directory does not block its children.
  for (const entry of [...entries].reverse()) chmodSync(path.join(target, entry.path), entry.mode);
}
function settingsKey(args) {
  let encoded;
  try { encoded = args["key-file"] ? readFileSync(args["key-file"], "utf8").trim() : process.env.APP_SETTINGS_KEY?.trim(); }
  catch { fail("Cannot read private settings-key file."); }
  if (!encoded) return null;
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded) || Buffer.from(encoded, "base64").length !== 32) fail("APP_SETTINGS_KEY must be 32 bytes encoded as base64.");
  return Buffer.from(encoded, "base64");
}
function keyFingerprint(args) { const key = settingsKey(args); return key ? digest(key) : null; }
function needsKey(root) {
  const file = path.join(root, "system", "ai-config.json");
  if (!existsSync(file)) return false;
  let config;
  try { config = JSON.parse(readFileSync(file, "utf8")); } catch { fail("AI settings JSON is damaged; backup aborted."); }
  return Boolean(config.encryptedApiKey);
}
function validateEncryptedKey(root, args) {
  if (!needsKey(root)) return;
  const key = settingsKey(args);
  if (!key) fail("Encrypted AI settings require the original APP_SETTINGS_KEY or --key-file.");
  try {
    const encrypted = JSON.parse(readFileSync(path.join(root, "system", "ai-config.json"), "utf8")).encryptedApiKey;
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encrypted.iv, "base64"));
    decipher.setAAD(Buffer.from("student-analytics:ai-key:v1"));
    decipher.setAuthTag(Buffer.from(encrypted.tag, "base64"));
    // Authenticate the saved ciphertext without exposing the decrypted API key.
    decipher.update(Buffer.from(encrypted.ciphertext, "base64"));
    decipher.final();
  } catch { fail("APP_SETTINGS_KEY cannot decrypt the saved AI settings; backup/restore refused."); }
}
function snapshot(source, output, metadata, args, outputExists = false) {
  source = plainDirectory(source);
  output = newPath(output);
  if (output === source || output.startsWith(source + path.sep)) fail("Backup destination must be outside records.");
  if (args["key-file"]) {
    const keyFile = realpathSync(args["key-file"]);
    if (keyFile === source || keyFile.startsWith(source + path.sep)) fail("Private settings-key files must be stored outside records and backups.");
  }
  const key = keyFingerprint(args);
  validateEncryptedKey(source, args);
  const before = inventory(source, { excludeConversations: true });
  if (!outputExists) secureDirectory(output);
  writeFileSync(path.join(output, ".incomplete"), "Snapshot in progress\n", { mode: 0o600, flag: "wx" });
  const records = path.join(output, "records");
  secureDirectory(records);
  copyEntries(source, records, before);
  if (JSON.stringify(before) !== JSON.stringify(inventory(source, { excludeConversations: true })) || JSON.stringify(before) !== JSON.stringify(inventory(records))) fail("Records changed during backup; leave service quiescent and use a new output directory.");
  const manifest = { schema, createdAt: new Date().toISOString(), ...metadata, excludedPaths: ["system/conversations"], settingsKeySha256: key, entries: before };
  const serialized = JSON.stringify(manifest, null, 2) + "\n";
  writeFileSync(path.join(output, "manifest.json"), serialized, { mode: 0o600, flag: "wx" });
  writeFileSync(path.join(output, "manifest.sha256"), digest(serialized) + "\n", { mode: 0o600, flag: "wx" });
  unlinkSync(path.join(output, ".incomplete"));
  return verify(output);
}
function verify(backup) {
  backup = plainDirectory(path.resolve(backup));
  if (existsSync(path.join(backup, ".incomplete"))) fail("Incomplete backup; restore refused.");
  if (readdirSync(backup).sort().join(",") !== "manifest.json,manifest.sha256,records") fail("Unexpected backup entries.");
  for (const name of ["manifest.json", "manifest.sha256"]) if (!lstatSync(path.join(backup, name)).isFile() || lstatSync(path.join(backup, name)).isSymbolicLink()) fail("Manifest must be a regular file.");
  const serialized = readFileSync(path.join(backup, "manifest.json"));
  const checksum = readFileSync(path.join(backup, "manifest.sha256"), "utf8").trim();
  if (!/^[a-f0-9]{64}$/.test(checksum) || digest(serialized) !== checksum) fail("Manifest checksum mismatch.");
  let manifest;
  try { manifest = JSON.parse(serialized); } catch { fail("Invalid manifest JSON."); }
  if (manifest.schema !== schema || !Array.isArray(manifest.entries) || !manifest.entries.length || manifest.entries[0]?.path !== "." || manifest.entries[0]?.type !== "directory") fail("Unsupported or invalid backup manifest.");
  projectName(manifest.project);
  if (manifest.settingsKeySha256 !== null && !/^[a-f0-9]{64}$/.test(manifest.settingsKeySha256 ?? "")) fail("Invalid settings-key fingerprint.");
  const seen = new Set();
  for (const entry of manifest.entries) {
    safePath(entry.path);
    if (seen.has(entry.path) || !["file", "directory"].includes(entry.type) || !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777) fail("Invalid manifest entry.");
    seen.add(entry.path);
    if (entry.type === "file" && (!Number.isSafeInteger(entry.size) || entry.size < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? ""))) fail("Invalid file manifest entry.");
  }
  const records = plainDirectory(path.join(backup, "records"));
  if (JSON.stringify(inventory(records)) !== JSON.stringify(manifest.entries)) fail("Records content, paths, size or permissions differ from the manifest.");
  if (needsKey(records) && !manifest.settingsKeySha256) fail("Encrypted AI settings have no key association.");
  return manifest;
}
function verifyKey(manifest, args) {
  if (!manifest.settingsKeySha256) return;
  const supplied = keyFingerprint(args);
  if (!supplied || !timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(manifest.settingsKeySha256, "hex"))) fail("Original APP_SETTINGS_KEY is missing or differs from the backup; restore refused.");
}
function restore(backup, target, project, args, targetExists = false) {
  const manifest = verify(backup);
  if (manifest.project !== project) fail("Backup belongs to a different project.");
  verifyKey(manifest, args);
  validateEncryptedKey(path.join(backup, "records"), args);
  if (!targetExists) secureDirectory(target);
  else if (readdirSync(target).length) fail("Restore target is not empty.");
  copyEntries(path.join(backup, "records"), target, manifest.entries);
  if (JSON.stringify(inventory(target)) !== JSON.stringify(manifest.entries)) fail("Restored records failed verification; target retained for inspection.");
  return manifest;
}
function docker(args, json = false) {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail(`Docker command failed (${args[0]}). No credentials or raw inspect output printed.`);
  return json ? JSON.parse(result.stdout) : result.stdout.trim();
}
function volumeConsumers(volume, allowPaused = false) {
  const ids = docker(["ps", "-aq", "--filter", `volume=${volume}`]).split(/\s+/).filter(Boolean);
  if (!ids.length) return;
  const containers = docker(["inspect", ...ids], true);
  if (containers.some((container) => !allowPaused || (container.State.Running && !container.State.Paused))) fail("Volume is attached to a container that is not quiescent; restore requires no attached containers.");
}
function helper(args, volume, backup, worker, project, sourceVolume) {
  const image = args["helper-image"] || "node:22-bookworm-slim";
  const imageId = docker(["image", "inspect", image, "--format", "{{.Id}}"]);
  const command = ["run", "--rm", "--pull", "never", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--label", `io.chuanzhi.recovery.project=${project}`,
    "--mount", `type=volume,src=${volume},dst=/records${worker === "snapshot" ? ",readonly" : ""}`,
    "--mount", `type=bind,src=${backup},dst=/backup${worker === "restore" ? ",readonly" : ""}`,
    "--mount", `type=bind,src=${script},dst=/recovery.mjs,readonly`];
  const workerArgs = ["node", "/recovery.mjs", `worker-${worker}`, "--project", project];
  if (sourceVolume) workerArgs.push("--source-volume", sourceVolume);
  if (args["key-file"]) {
    const key = path.resolve(args["key-file"]);
    if (key.includes(",")) fail("Docker bind paths cannot contain commas.");
    command.push("--mount", `type=bind,src=${key},dst=/settings-key,readonly`);
    workerArgs.push("--key-file", "/settings-key");
  } else if (process.env.APP_SETTINGS_KEY) command.push("--env", "APP_SETTINGS_KEY");
  // An immutable image ID prevents a tag changing between preflight and execution.
  docker([...command, imageId, ...workerArgs]);
}
function summary(manifest) {
  console.log(JSON.stringify({ ok: true, project: manifest.project, files: manifest.entries.filter((entry) => entry.type === "file").length, entries: manifest.entries.length, settingsKeyLinked: Boolean(manifest.settingsKeySha256) }));
}

try {
  const [command, ...argv] = process.argv.slice(2);
  if (!command || command === "--help" || command === "help") { console.log(help); process.exit(0); }
  const args = options(argv);
  const common = ["project", "key-file"];
  let manifest;
  if (command === "verify") {
    allowed(args, ["backup"]);
    manifest = verify(required(args, "backup"));
  } else if (command === "fixture-backup") {
    allowed(args, [...common, "source-dir", "confirm-offline", "output"]);
    const requestedSource = path.resolve(required(args, "source-dir"));
    if (required(args, "confirm-offline") !== requestedSource) fail("--confirm-offline must exactly match the absolute offline source directory.");
    const source = plainDirectory(requestedSource);
    manifest = snapshot(source, required(args, "output"), { project: projectName(required(args, "project")), source: { type: "fixture" } }, args);
  } else if (command === "fixture-restore") {
    allowed(args, [...common, "target-dir", "confirm-target", "backup"]);
    const requestedTarget = path.resolve(required(args, "target-dir"));
    if (required(args, "confirm-target") !== requestedTarget) fail("--confirm-target must exactly match the absolute target directory.");
    const target = newPath(requestedTarget);
    manifest = restore(required(args, "backup"), target, projectName(required(args, "project")), args);
  } else if (command === "backup" || command === "restore") {
    allowed(args, [...common, "helper-image", ...(command === "backup" ? ["volume", "output", "source-container", "source-service"] : ["target-volume", "confirm-target", "backup"])]);
    const project = projectName(required(args, "project"));
    docker(["info", "--format", "{{.ServerVersion}}"]);
    if (command === "backup") {
      const volume = volumeName(required(args, "volume"));
      const info = docker(["volume", "inspect", volume], true)[0];
      if (args["key-file"] && info.Mountpoint && realpathSync(args["key-file"]).startsWith(info.Mountpoint + path.sep)) fail("Private settings-key file is inside the source records volume; backup refused.");
      if (args["source-container"] || args["source-service"]) {
        const source = docker(["inspect", required(args, "source-container")], true)[0];
        if (source.Config?.Labels?.["com.docker.compose.project"] !== project || source.Config?.Labels?.["com.docker.compose.service"] !== required(args, "source-service") || !source.Mounts?.some((mount) => mount.Type === "volume" && mount.Name === volume && mount.Destination === "/app/records")) fail("Source container does not identify this project's records volume/service.");
        const env = Object.fromEntries((source.Config.Env || []).map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]));
        if (env.APP_STATE_DIR !== "/app/records/system" || (env.ANALYSIS_RECORDS_DIR && env.ANALYSIS_RECORDS_DIR !== "/app/records")) fail("Source container stores state outside the supported records layout.");
        if (env.APP_SETTINGS_KEY && keyFingerprint(args) !== digest(Buffer.from(env.APP_SETTINGS_KEY.trim(), "base64"))) fail("Supplied APP_SETTINGS_KEY differs from the identified source container.");
      } else if (info.Labels?.["com.docker.compose.project"] !== project) fail("Source volume lacks the expected Compose project label; identify its project container/service explicitly.");
      volumeConsumers(volume, true);
      const output = path.resolve(required(args, "output"));
      if (output.includes(",") || script.includes(",")) fail("Docker bind paths cannot contain commas.");
      secureDirectory(output);
      helper(args, volume, output, "snapshot", project, volume);
      writeFileSync(path.join(output, ".incomplete"), "Checking source quiescence\n", { mode: 0o600, flag: "wx" });
      volumeConsumers(volume, true);
      unlinkSync(path.join(output, ".incomplete"));
      manifest = verify(output);
    } else {
      const target = volumeName(required(args, "target-volume"));
      if (required(args, "confirm-target") !== target) fail("--confirm-target must exactly match the new volume name.");
      const backup = path.resolve(required(args, "backup"));
      if (backup.includes(",") || script.includes(",")) fail("Docker bind paths cannot contain commas.");
      manifest = verify(backup);
      if (manifest.project !== project) fail("Backup belongs to a different project.");
      verifyKey(manifest, args);
      if (target === manifest.source?.volume) fail("Cannot restore to the source volume.");
      if (docker(["volume", "ls", "--format", "{{.Name}}"] ).split("\n").includes(target)) fail("Target volume already exists; choose a new volume name.");
      volumeConsumers(target);
      const identity = randomUUID();
      docker(["volume", "create", "--label", `com.docker.compose.project=${project}`, "--label", "io.chuanzhi.recovery=restore", "--label", `io.chuanzhi.recovery.id=${identity}`, target]);
      const created = docker(["volume", "inspect", target], true)[0];
      if (created.Labels?.["io.chuanzhi.recovery.id"] !== identity) fail("Target volume identity changed; restore refused.");
      volumeConsumers(target);
      helper(args, target, backup, "restore", project);
      volumeConsumers(target);
    }
  } else if (command === "worker-snapshot" || command === "worker-restore") {
    // Internal helper modes are constrained to fixed container mount paths.
    if (!existsSync("/.dockerenv") || !existsSync("/recovery.mjs")) fail("Worker modes require the isolated Docker helper.");
    allowed(args, [...common, "source-volume"]);
    const project = projectName(required(args, "project"));
    manifest = command === "worker-snapshot"
      ? snapshot("/records", "/backup", { project, source: { type: "docker-volume", volume: volumeName(required(args, "source-volume")) } }, args, true)
      : restore("/backup", "/records", project, args, true);
  } else fail("Unknown command; see --help.");
  summary(manifest);
} catch (error) {
  // Filesystem/Docker errors may embed operational details; never print raw error objects.
  const known = error instanceof RecoveryError;
  console.error(`Recovery failed: ${known ? error.message : "filesystem operation failed; check paths, permissions and whether the destination already exists."}`);
  process.exitCode = 1;
}
