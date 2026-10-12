import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { hostname } from "node:os";

type LockOwner = { version: 2; pid: number; identity: string };

/** Kernel process birth identity survives PID reuse and container restarts. */
function processIdentity(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === "linux") {
      const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      // comm (field 2) may contain spaces and parentheses; starttime is field 22.
      const start = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/)[19];
      if (!boot || !/^\d+$/.test(start)) return null;
      return `linux:${hostname()}:${boot}:${start}`;
    }
    const start = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    }).trim();
    return start ? `${process.platform}:${hostname()}:${start}` : null;
  } catch {
    return null;
  }
}
const ownProcessIdentity = processIdentity(process.pid);

export function getStateDirectory(): string {
  // Accounts and secrets are runtime state, supplied by the persistent volume.
  return resolve(/* turbopackIgnore: true */ process.env.APP_STATE_DIR?.trim() || "records/system");
}

export function readState<T>(name: string, initial: () => T): T {
  const file = resolve(getStateDirectory(), name);
  try {
    return JSON.parse(readFileSync(/* turbopackIgnore: true */ file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return initial();
    // A damaged state file must never silently reset users, secrets, or budgets.
    throw new Error(`系统存储无法读取（${name}），请联系管理员检查服务端文件。`);
  }
}

function ownerIsAlive(ownerFile: string): boolean {
  try {
    const owner = JSON.parse(
      readFileSync(/* turbopackIgnore: true */ ownerFile, "utf8"),
    ) as Partial<LockOwner>;
    // Pre-upgrade locks cannot belong to this version, whose owners all use v2.
    if (
      owner.version !== 2 ||
      typeof owner.identity !== "string" ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid! < 1
    )
      return false;
    const currentIdentity = processIdentity(owner.pid!);
    if (currentIdentity) return currentIdentity === owner.identity;
    // Inaccessible process information alone must not revoke a live lock.
    process.kill(owner.pid!, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function recoverOldLock(lockPath: string): void {
  try {
    const stat = statSync(lockPath);
    // Allow a recent crashed lock time to settle before recovering it.
    if (Date.now() - stat.mtimeMs <= 30_000) return;
    if (!stat.isDirectory()) {
      // Upgrade old file locks. unlink cannot remove a newly acquired directory.
      if (!ownerIsAlive(lockPath)) unlinkSync(lockPath);
      return;
    }
    for (const name of readdirSync(/* turbopackIgnore: true */ lockPath)) {
      if (!/^owner-[a-f0-9-]+\.json$/.test(name)) continue;
      const ownerFile = resolve(lockPath, name);
      if (!ownerIsAlive(ownerFile)) unlinkSync(ownerFile);
    }
    // Unique marker names prevent concurrent reclaimers from deleting a new
    // owner's marker. rmdir is atomic and refuses a nonempty/newly owned lock.
    rmdirSync(lockPath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!["ENOENT", "ENOTEMPTY", "EEXIST", "EISDIR", "ENOTDIR"].includes(code ?? "")) throw error;
  }
}

/** Short synchronous transactions also coordinate separate Node workers. */
export function updateState<T, R>(name: string, initial: () => T, update: (state: T) => R): R {
  if (!ownProcessIdentity)
    throw new Error("无法验证当前进程的启动身份，系统存储暂停写入。请检查服务器进程信息访问权限。");
  const file = resolve(getStateDirectory(), name);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const lockPath = `${file}.lock`;
  const ownerName = `owner-${randomUUID()}.json`;
  const preparedPath = `${lockPath}.prepared-${randomUUID()}`;
  mkdirSync(preparedPath, { mode: 0o700 });
  const deadline = Date.now() + 5_000;
  let acquired = false;
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(
      resolve(preparedPath, ownerName),
      JSON.stringify({
        version: 2,
        pid: process.pid,
        identity: ownProcessIdentity,
      } satisfies LockOwner),
      { flag: "wx", mode: 0o600 },
    );
    while (true) {
      try {
        // Publish a complete, nonempty lock atomically. A stale reclaimer's
        // rmdir cannot remove a new owner between directory and marker creation.
        renameSync(preparedPath, lockPath);
        acquired = true;
        break;
      } catch (error) {
        if (
          !["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
        recoverOldLock(lockPath);
        if (Date.now() > deadline) throw new Error("系统设置正在更新，请稍后重试。");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    const state = readState(name, initial);
    const result = update(state);
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify(state, null, 2));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, file);
    const directory = openSync(dirname(file), "r");
    try {
      fsyncSync(directory);
    } finally {
      closeSync(directory);
    }
    return result;
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    const ownedDirectory = acquired ? lockPath : preparedPath;
    const ownerFile = resolve(ownedDirectory, ownerName);
    try {
      unlinkSync(ownerFile);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try {
      // Once our marker is gone, another writer may replace the empty directory
      // with its own complete lock. Never delete that writer's marker.
      rmdirSync(ownedDirectory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && !(acquired && ["ENOTEMPTY", "EEXIST"].includes(code ?? ""))) throw error;
    }
  }
}
