#!/usr/bin/env node
/**
 * Prepare the standalone output for a complete release.
 *
 * Runs as `postbuild` after `next build` (output: "standalone") and performs
 * the steps file tracing does not cover:
 *
 * 1. Assets: copy `${DIST_DIR}/static` into the standalone tree at the same
 *    relative dist path (the standalone server.js reads static assets from
 *    its own dist directory, which is not always `.next`) and copy the
 *    runtime public assets (skipping the design-only public/previews/ subtree
 *    and the unreferenced legacy public/learning-folio.jpg; source files are
 *    never deleted). This runs on every platform, including Windows.
 * 2. License: ship the complete upstream Rare UI license with standalone
 *    releases (including the Docker image). Client bundling can strip source
 *    comments, so the license file is copied verbatim.
 * 3. DuckDB native library: `next build` traces `duckdb.node` into the
 *    standalone tree, but the addon resolves its shared library through
 *    `@loader_path`, which tracing does not follow. Copy
 *    `libduckdb.dylib` (macOS) / `libduckdb.so` (Linux) next to it, or the
 *    container/host fails with "library not loaded" on every DuckDB call.
 *    Windows bundles the library inside duckdb.node, so it needs no copy.
 *
 * Usage: node scripts/prepare-standalone-native.mjs [distDir]
 * distDir defaults to NEXT_DIST_DIR, then `.next` (same resolution as next.config.ts).
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

const DIST_DIR = process.argv[2] || process.env.NEXT_DIST_DIR || ".next";
const DIST_REL = relative(process.cwd(), resolve(process.cwd(), DIST_DIR));
const STANDALONE_DIR = resolve(process.cwd(), DIST_DIR, "standalone");
const PROJECT_PNPM_DIR = resolve(process.cwd(), "node_modules", ".pnpm");

const PUBLIC_DESIGN_EXCLUDES = new Set(["previews", "learning-folio.jpg"]);

function log(message) {
  console.log(`[prepare-standalone-native] ${message}`);
}

function fail(message) {
  console.error(`[prepare-standalone-native] ERROR: ${message}`);
  process.exit(1);
}

if (isAbsolute(DIST_REL) || DIST_REL.startsWith("..") || resolve(DIST_REL) === process.cwd()) {
  fail(`distDir ${DIST_DIR} must resolve to a directory inside the project.`);
}

if (!existsSync(STANDALONE_DIR)) {
  fail(`No standalone output at ${STANDALONE_DIR}; run "pnpm build" first.`);
}
if (realpathSync(STANDALONE_DIR) !== STANDALONE_DIR || !existsSync(join(STANDALONE_DIR, "server.js"))) {
  fail("Standalone output must be a generated build directory, not a symbolic link.");
}

// Next applies outputFileTracingExcludes to page entries, but not every
// instrumentation dependency. Enforce the same serialized policy on its
// generated copies; never delete the original project or runtime files.
const buildRoot = resolve(process.cwd(), DIST_REL);
const traceExcludes = JSON.parse(
  readFileSync(join(buildRoot, "required-server-files.json"), "utf8"),
).config.outputFileTracingExcludes["/*"];
if (!Array.isArray(traceExcludes)) fail("Missing release file exclusion policy.");
const excluded = createRequire(import.meta.url)("next/dist/compiled/picomatch")(
  traceExcludes, { dot: true },
);
const instrumentationTrace = join(buildRoot, "server", "instrumentation.js.nft.json");
if (existsSync(instrumentationTrace)) {
  const trace = JSON.parse(readFileSync(instrumentationTrace, "utf8"));
  let removed = 0;
  for (const file of trace.files) {
    const projectPath = relative(process.cwd(), resolve(dirname(instrumentationTrace), file));
    if (!projectPath || isAbsolute(projectPath) || projectPath.startsWith("..") || !excluded(projectPath.replaceAll("\\", "/"))) continue;
    const copy = resolve(STANDALONE_DIR, projectPath);
    if (existsSync(copy)) {
      const ownedPath = relative(realpathSync(STANDALONE_DIR), realpathSync(copy));
      if (!ownedPath || isAbsolute(ownedPath) || ownedPath.startsWith("..")) fail("Trace escaped the standalone directory.");
      unlinkSync(copy);
      removed++;
    }
  }
  log(`Removed ${removed} excluded instrumentation file(s) from the release copy.`);
}

// 1. Assets: static files must live inside the standalone tree at the same
// relative dist path the isolated server.js reads from; public assets are
// served from ./public next to server.js.
const STATIC_SOURCE = resolve(process.cwd(), DIST_REL, "static");
const STATIC_TARGET = join(STANDALONE_DIR, DIST_REL, "static");
if (!existsSync(STATIC_SOURCE)) {
  fail(`Missing build output ${STATIC_SOURCE}; cannot assemble standalone static assets.`);
}
cpSync(STATIC_SOURCE, STATIC_TARGET, { recursive: true });
log(`Copied ${STATIC_SOURCE} -> ${STATIC_TARGET}`);

const PUBLIC_SOURCE = resolve(process.cwd(), "public");
if (existsSync(PUBLIC_SOURCE)) {
  const PUBLIC_TARGET = join(STANDALONE_DIR, "public");
  for (const entry of readdirSync(PUBLIC_SOURCE)) {
    if (PUBLIC_DESIGN_EXCLUDES.has(entry)) continue;
    cpSync(join(PUBLIC_SOURCE, entry), join(PUBLIC_TARGET, entry), { recursive: true });
  }
  log(`Copied public assets (minus design-only entries) -> ${PUBLIC_TARGET}`);
} else {
  log("No public/ directory; skipping public assets.");
}

const PLATFORM_LIBRARY = {
  darwin: "libduckdb.dylib",
  linux: "libduckdb.so",
};

function platformAddonDirs(pnpmDir) {
  if (!existsSync(pnpmDir)) return [];
  const pattern = new RegExp(`^@duckdb\\+node-bindings-${process.platform}-[^@]+@[^/]+$`);
  const dirs = [];
  for (const entry of readdirSync(pnpmDir)) {
    if (!pattern.test(entry)) continue;
    // ".pnpm/@duckdb+node-bindings-darwin-arm64@1.5.5-r.5/node_modules/@duckdb/node-bindings-darwin-arm64"
    const scopeDir = join(pnpmDir, entry, "node_modules", "@duckdb");
    if (!existsSync(scopeDir)) continue;
    for (const pkg of readdirSync(scopeDir)) {
      const addonDir = join(scopeDir, pkg);
      if (
        pkg.startsWith(`node-bindings-${process.platform}-`) &&
        existsSync(join(addonDir, "duckdb.node"))
      ) {
        dirs.push(addonDir);
      }
    }
  }
  return dirs;
}

function sameFile(a, b) {
  try {
    return statSync(a).size === statSync(b).size;
  } catch {
    return false;
  }
}

// 2. License: ship the complete upstream license with every standalone
// release (including the Docker image), on every platform.
{
  const licenseDir = join(STANDALONE_DIR, "licenses");
  mkdirSync(licenseDir, { recursive: true });
  copyFileSync(
    resolve(process.cwd(), "licenses", "rare-ui-LICENSE.txt"),
    join(licenseDir, "rare-ui-LICENSE.txt"),
  );
  log(`Copied licenses/rare-ui-LICENSE.txt -> ${licenseDir}`);
}

// 3. DuckDB native library. Windows bundles it inside duckdb.node.
if (process.platform === "win32") {
  log("Windows bundles the library inside duckdb.node; nothing to copy. Done.");
  process.exit(0);
}

const libraryName = PLATFORM_LIBRARY[process.platform];
if (!libraryName) {
  log(`Unsupported platform "${process.platform}"; nothing to copy. Done.`);
  process.exit(0);
}

// Only copy for addons that actually landed in the standalone tree.
const targets = platformAddonDirs(join(STANDALONE_DIR, "node_modules", ".pnpm"));
if (targets.length === 0) {
  fail(`No ${process.platform} duckdb.node found under ${STANDALONE_DIR}; the standalone output would fail at runtime.`);
}

const sources = platformAddonDirs(PROJECT_PNPM_DIR);
let copied = 0;
let upToDate = 0;

for (const target of targets) {
  const packageName = target.split("/").at(-1);
  const source = sources.find((dir) => dir.endsWith(packageName));
  if (!source) {
    fail(`Cannot find ${packageName} in node_modules/.pnpm; reinstall dependencies.`);
  }
  const sourceLibrary = join(source, libraryName);
  if (!existsSync(sourceLibrary)) {
    fail(`Missing ${libraryName} inside ${source}.`);
  }
  const targetLibrary = join(target, libraryName);
  if (sameFile(sourceLibrary, targetLibrary)) {
    upToDate += 1;
    log(`Already present: ${targetLibrary}`);
    continue;
  }
  copyFileSync(sourceLibrary, targetLibrary);
  copied += 1;
  log(`Copied ${sourceLibrary} -> ${targetLibrary}`);
}

log(`Done (${copied} copied, ${upToDate} already present, ${targets.length} addon dir(s)).`);
