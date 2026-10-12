#!/usr/bin/env node
/** Local/server terminal only. This script never exposes an HTTP setup endpoint. */
import { randomBytes, randomUUID, scrypt } from "node:crypto";
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
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hostname } from "node:os";

// Match Next's local environment source, without reading or printing its secrets.
if (existsSync(".env.local") && process.env.ANALYTICS_INIT_ENV_LOADED !== "1") {
  const child = spawnSync(
    process.execPath,
    ["--env-file=.env.local", fileURLToPath(import.meta.url)],
    {
      env: { ...process.env, ANALYTICS_INIT_ENV_LOADED: "1" },
      stdio: "inherit",
    },
  );
  if (child.error) {
    console.error("无法启动管理员初始化，请检查 Node.js 环境。");
    process.exit(1);
  }
  process.exit(child.status ?? 1);
}

const directory = resolve(process.env.APP_STATE_DIR?.trim() || "records/system");
const file = resolve(directory, "accounts.json");
const initial = () => ({ version: 1, users: [], sessions: [] });
function readAccounts() {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return initial();
    throw new Error("账户存储无法读取，请检查文件，不会自动覆盖。");
  }
}
function hasAdmin(state) {
  return state.users.some((user) => user.role === "admin");
}

async function question(prompt) {
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await terminal.question(prompt);
  } finally {
    terminal.close();
  }
}
async function hiddenPassword(prompt) {
  if (!process.stdin.isTTY)
    throw new Error("非交互模式请通过 ADMIN_USERNAME 和 ADMIN_PASSWORD 环境变量提供凭据。");
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
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
        if (character === "\u0003") {
          finish(new Error("初始化已取消。"));
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
function acquireLock(lockFile) {
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

async function main() {
  if (hasAdmin(readAccounts()))
    throw new Error("管理员已存在，未作任何修改。请通过前端修改本人密码。");
  const providedUsername = process.env.ADMIN_USERNAME?.trim();
  const providedPassword = process.env.ADMIN_PASSWORD;
  if ((!providedUsername || !providedPassword) && !process.stdin.isTTY)
    throw new Error("请在终端交互执行，或同时提供 ADMIN_USERNAME 与 ADMIN_PASSWORD 环境变量。");
  const username = (providedUsername || (await question("管理员账号（3–40 个字母、数字或 ._-）：")))
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error("账号格式不正确。");
  const password =
    providedPassword || (await hiddenPassword("管理员密码（12–128 个字符，输入不会显示）："));
  if (password.length < 12 || password.length > 128) throw new Error("密码需为 12–128 个字符。");
  if (!providedPassword && password !== (await hiddenPassword("再次输入密码：")))
    throw new Error("两次密码不一致，未作任何修改。");
  const salt = randomBytes(16);
  const hash = await new Promise((resolveKey, reject) =>
    scrypt(password, salt, 64, { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolveKey(key),
    ),
  );
  const user = {
    id: randomUUID(),
    username,
    displayName: "系统管理员",
    role: "admin",
    disabled: false,
    createdAt: new Date().toISOString(),
    passwordHash: `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`,
  };
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lockFile = `${file}.lock`;
  const lock = acquireLock(lockFile);
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    const state = readAccounts();
    if (hasAdmin(state)) throw new Error("管理员已存在，未作任何修改。");
    if (state.users.some((existing) => existing.username === username))
      throw new Error("这个账号已存在。");
    state.users.push(user);
    const output = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(output, JSON.stringify(state, null, 2));
      fsyncSync(output);
    } finally {
      closeSync(output);
    }
    renameSync(temporary, file);
    const parent = openSync(directory, "r");
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    try {
      unlinkSync(lock);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      // Another writer can publish its lock after our unique marker is removed.
      rmdirSync(lockFile);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    }
  }
  console.log(`管理员已创建：${username}。现在可以从前端登录；密码未写入明文存储。`);
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
