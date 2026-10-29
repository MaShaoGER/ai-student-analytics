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
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { acquireLock, hiddenPassword, question } from "./account-cli.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
