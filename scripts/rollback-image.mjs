#!/usr/bin/env node
/** Change one explicitly identified Compose service; keep records and runtime keys. */
import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const help = `Usage (dry run unless --apply is supplied):
  node scripts/rollback-image.mjs --project PROJECT --compose-file FILE --service SERVICE --expected-image CURRENT --image PREVIOUS --records-volume VOLUME --override-file NEW_FILE [--env-file FILE] [--apply]

Only one Compose service with matching container/project/service labels is eligible.
Both images must already exist locally and belong to the same repository.
The current /app/records named volume and APP_SETTINGS_KEY/APP_STATE_DIR/APP_ORIGIN
must match the resolved Compose configuration. The records volume is never restored.
The override contains only the previous immutable image ID, not credentials.
Apply uses up -d --no-deps --no-build --pull never --wait for the named service.
Other services, images, volumes and networks are never removed or rebuilt.
See docs/recovery.md. Keep the override and use it in subsequent Compose operations.`;
class RollbackError extends Error {}
function fail(message) { throw new RollbackError(message); }
function docker(argv, json = false) {
  const result = spawnSync("docker", argv, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) fail(`Docker ${argv[0]} failed; raw output suppressed to protect runtime credentials.`);
  return json ? JSON.parse(result.stdout) : result.stdout.trim();
}
function required(args, key) { if (!args[key]) fail(`Missing --${key}.`); return args[key]; }
function repository(image) { return image.split("@")[0].replace(/:[^/:]+$/, ""); }
function environment(container) {
  return Object.fromEntries((container.Config.Env || []).map((entry) => [entry.slice(0, entry.indexOf("=")), entry.slice(entry.indexOf("=") + 1)]));
}

try {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes("--help")) { console.log(help); process.exit(0); }
  const args = {};
  let apply = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") { if (apply) fail("Duplicate --apply."); apply = true; continue; }
    if (!/^--[a-z-]+$/.test(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith("--")) fail("Expected --option VALUE; see --help.");
    const key = argv[i].slice(2);
    if (Object.hasOwn(args, key)) fail(`Duplicate --${key}.`);
    args[key] = argv[++i];
  }
  for (const key of Object.keys(args)) if (!["project", "compose-file", "service", "expected-image", "image", "records-volume", "override-file", "env-file"].includes(key)) fail(`Unknown --${key}.`);
  const project = required(args, "project");
  const service = required(args, "service");
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(project) || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(service)) fail("Invalid project/service name.");
  const currentImage = required(args, "expected-image");
  const previousImage = required(args, "image");
  if (currentImage === previousImage || repository(currentImage) !== repository(previousImage)) fail("Rollback requires a different image in the same repository.");
  const records = required(args, "records-volume");
  const override = path.resolve(required(args, "override-file"));
  if (existsSync(override)) fail("Override file already exists; choose a new file.");
  const compose = ["compose", "--project-name", project, "--file", path.resolve(required(args, "compose-file"))];
  if (args["env-file"]) compose.push("--env-file", path.resolve(args["env-file"]));
  const config = docker([...compose, "config", "--format", "json"], true);
  const configured = config.services?.[service];
  if (!configured || configured.image !== currentImage || config.name !== project) fail("Compose project/service/current image differs from the explicit expected state.");
  const ids = docker(["ps", "-aq", "--filter", `label=com.docker.compose.project=${project}`, "--filter", `label=com.docker.compose.service=${service}`]).split(/\s+/).filter(Boolean);
  if (ids.length !== 1) fail("Expected exactly one current container for this project/service.");
  const container = docker(["inspect", ids[0]], true)[0];
  if (container.Config.Image !== currentImage || container.Config.Labels?.["com.docker.compose.oneoff"] === "True") fail("Current container image/service differs from the explicit expected state.");
  const mounted = container.Mounts?.find((mount) => mount.Destination === "/app/records");
  const configuredMount = configured.volumes?.find((mount) => mount.target === "/app/records");
  if (mounted?.Type !== "volume" || mounted.Name !== records || configuredMount?.type !== "volume" || config.volumes?.[configuredMount.source]?.name !== records || mounted.RW !== true || configuredMount.read_only) fail("Compose/current container records volume differs from the explicit expected state.");
  const env = environment(container);
  for (const key of ["APP_SETTINGS_KEY", "APP_STATE_DIR", "APP_ORIGIN", "ANALYSIS_RECORDS_DIR"]) if ((env[key] || "") !== (configured.environment?.[key] || "")) fail(`Runtime ${key} would change; rollback refused.`);
  if (env.APP_STATE_DIR !== "/app/records/system" || (env.ANALYSIS_RECORDS_DIR && env.ANALYSIS_RECORDS_DIR !== "/app/records")) fail("Current container stores state outside the records volume.");
  const previousId = docker(["image", "inspect", previousImage, "--format", "{{.Id}}"]);
  const currentId = docker(["image", "inspect", currentImage, "--format", "{{.Id}}"]);
  if (container.Image !== currentId || previousId === currentId) fail("Image tag identities do not match the expected current/different previous images.");
  const plan = { project, service, currentImage, previousImage, previousImageId: previousId, recordsVolume: records, overrideFile: override, apply };
  if (apply) {
    // Exclusive creation prevents silently replacing an operator's existing override.
    writeFileSync(override, JSON.stringify({ services: { [service]: { image: previousId } } }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
    docker([...compose, "--file", override, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait", "--wait-timeout", "120", service]);
    const updated = docker([...compose, "--file", override, "ps", "-q", service]);
    const restored = docker(["inspect", updated], true)[0];
    if (restored.Image !== previousId || !restored.State.Running || !restored.Mounts?.some((mount) => mount.Destination === "/app/records" && mount.Name === records && mount.Type === "volume")) fail("Post-rollback verification failed; preserve the override and inspect the named service.");
    for (const key of ["APP_SETTINGS_KEY", "APP_STATE_DIR", "APP_ORIGIN", "ANALYSIS_RECORDS_DIR"]) if ((environment(restored)[key] || "") !== (env[key] || "")) fail(`Post-rollback ${key} changed; inspect the named service.`);
  }
  console.log(JSON.stringify({ ok: true, ...plan }));
} catch (error) {
  console.error(`Rollback failed: ${error instanceof RollbackError ? error.message : "filesystem/JSON operation failed; inspect the named service and configuration privately."}`);
  process.exitCode = 1;
}
