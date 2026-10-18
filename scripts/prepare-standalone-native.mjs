#!/usr/bin/env node
/**
 * Copy the DuckDB shared library next to `duckdb.node` in the standalone output.
 *
 * `next build` traces `duckdb.node` into `.next/standalone`, but the addon
 * resolves its shared library through `@loader_path`; Next does not follow that
 * runtime dependency, so `libduckdb.dylib` (macOS) / `libduckdb.so` (Linux) is
 * missing and every DuckDB call fails with "library not loaded". The Dockerfile
 * performs the equivalent copy for Linux inside the image build; this script
 * keeps local `pnpm build` output runnable on macOS (and on Linux without Docker).
 *
 * Usage: node scripts/prepare-standalone-native.mjs [distDir]
 * distDir defaults to NEXT_DIST_DIR, then `.next` (same resolution as next.config.ts).
 */
import { copyFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const DIST_DIR = process.argv[2] || process.env.NEXT_DIST_DIR || ".next";
const STANDALONE_DIR = resolve(process.cwd(), DIST_DIR, "standalone");
const PROJECT_PNPM_DIR = resolve(process.cwd(), "node_modules", ".pnpm");

const PLATFORM_LIBRARY = {
  darwin: "libduckdb.dylib",
  linux: "libduckdb.so",
};

function log(message) {
  console.log(`[prepare-standalone-native] ${message}`);
}

function fail(message) {
  console.error(`[prepare-standalone-native] ERROR: ${message}`);
  process.exitCode = 1;
}

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

if (process.platform === "win32") {
  log("Windows bundles the library inside duckdb.node; nothing to copy. Skipping.");
  process.exit(0);
}

const libraryName = PLATFORM_LIBRARY[process.platform];
if (!libraryName) {
  log(`Unsupported platform "${process.platform}"; nothing to copy. Skipping.`);
  process.exit(0);
}

if (!existsSync(STANDALONE_DIR)) {
  log(`No standalone output at ${STANDALONE_DIR}; run "pnpm build" first. Skipping.`);
  process.exit(0);
}

// Only copy for addons that actually landed in the standalone tree.
const targets = platformAddonDirs(join(STANDALONE_DIR, "node_modules", ".pnpm"));
if (targets.length === 0) {
  log(`No ${process.platform} duckdb.node found under ${STANDALONE_DIR}; nothing to copy.`);
  process.exit(0);
}

const sources = platformAddonDirs(PROJECT_PNPM_DIR);
let copied = 0;
let upToDate = 0;

for (const target of targets) {
  const packageName = target.split("/").at(-1);
  const source = sources.find((dir) => dir.endsWith(packageName));
  if (!source) {
    fail(`Cannot find ${packageName} in node_modules/.pnpm; reinstall dependencies.`);
    continue;
  }
  const sourceLibrary = join(source, libraryName);
  if (!existsSync(sourceLibrary)) {
    fail(`Missing ${libraryName} inside ${source}.`);
    continue;
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

if (process.exitCode) {
  console.error("[prepare-standalone-native] Standalone output would fail at runtime.");
  process.exit(process.exitCode);
}

log(`Done (${copied} copied, ${upToDate} already present, ${targets.length} addon dir(s)).`);
