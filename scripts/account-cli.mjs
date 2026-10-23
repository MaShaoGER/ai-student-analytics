/** Terminal input and lock protocol shared by the operational account CLIs. */
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";

export async function question(prompt) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(prompt);
  } finally {
    terminal.close();
  }
}
export async function hiddenPassword(prompt) {
  if (!process.stdin.isTTY)
    throw new Error("非交互模式请通过 ADMIN_USERNAME 和 ADMIN_PASSWORD 环境变量提供凭据。");
  process.stdin.setRawMode(true);
  return new Promise((resolveValue, reject) => {
    let value = "";
    function finish(error) {
      process.stdin.off("data", receive);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolveValue(value);
    }
    function receive(chunk) {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003" || character === "\u0004") {
          finish(new Error("操作已取消，未作任何修改。"));
          return;
        }
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === "\u007f" || character === "\b") {
          if (value.length) {
            value = Array.from(value).slice(0, -1).join("");
            process.stdout.write("\b \b");
          }
        } else if (character >= " ") {
          value += character;
          process.stdout.write("*");
        }
      }
    }
    process.stdin.on("data", receive);
    process.stdout.write(prompt);
    process.stdin.resume();
  });
}
// Keep owner format identical to lib/settings/storage.ts.
function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === "linux") {
      const boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
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
function ownerIsAlive(lockFile) {
  try {
    const owner = JSON.parse(readFileSync(lockFile, "utf8"));
    if (
      owner.version !== 2 ||
      typeof owner.identity !== "string" ||
      !Number.isSafeInteger(owner.pid) ||
      owner.pid < 1
    )
      return false;
    const currentIdentity = processIdentity(owner.pid);
    if (currentIdentity) return currentIdentity === owner.identity;
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
function recoverOldLock(lockPath) {
  try {
    const stat = statSync(lockPath);
    if (Date.now() - stat.mtimeMs <= 30_000) return;
    if (!stat.isDirectory()) {
      if (!ownerIsAlive(lockPath)) unlinkSync(lockPath);
      return;
    }
    for (const name of readdirSync(lockPath)) {
      if (!/^owner-[a-f0-9-]+\.json$/.test(name)) continue;
      const ownerFile = resolve(lockPath, name);
      if (!ownerIsAlive(ownerFile)) unlinkSync(ownerFile);
    }
    rmdirSync(lockPath);
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST", "EISDIR", "ENOTDIR"].includes(error.code)) throw error;
  }
}
export function acquireLock(lockFile) {
  const identity = processIdentity(process.pid);
  if (!identity) throw new Error("无法验证当前进程的启动身份，请检查服务器进程信息访问权限。");
  const ownerName = `owner-${randomUUID()}.json`;
  const preparedPath = `${lockFile}.prepared-${randomUUID()}`;
  mkdirSync(preparedPath, { mode: 0o700 });
  const deadline = Date.now() + 5_000;
  let acquired = false;
  try {
    writeFileSync(
      resolve(preparedPath, ownerName),
      JSON.stringify({ version: 2, pid: process.pid, identity }),
      { flag: "wx", mode: 0o600 },
    );
    while (true) {
      try {
        renameSync(preparedPath, lockFile);
        acquired = true;
        return resolve(lockFile, ownerName);
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY", "ENOTDIR", "EISDIR"].includes(error.code)) throw error;
        recoverOldLock(lockFile);
        if (Date.now() > deadline) throw new Error("账户正在更新，请稍后再运行。");
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
  } finally {
    if (!acquired) {
      const ownerFile = resolve(preparedPath, ownerName);
      if (existsSync(ownerFile)) unlinkSync(ownerFile);
      rmdirSync(preparedPath);
    }
  }
}
