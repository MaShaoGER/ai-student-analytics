#!/usr/bin/env node
/** Server-terminal recovery only; never accepts a password in argv or env. */
import { randomBytes, randomUUID, scrypt } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { acquireLock, hiddenPassword, question } from "./account-cli.mjs";

function readAccounts(file) {
  let state;
  try {
    state = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error("账号文件不存在或无法读取，请检查 APP_STATE_DIR；未作任何修改。");
  }
  if (
    !state ||
    ![undefined, 1, 2].includes(state.version) ||
    !Array.isArray(state.users) ||
    !Array.isArray(state.sessions) ||
    state.users.some(
      (user) =>
        !user ||
        typeof user.id !== "string" ||
        typeof user.username !== "string" ||
        typeof user.passwordHash !== "string",
    ) ||
    state.sessions.some((session) => !session || typeof session.userId !== "string")
  )
    throw new Error("账号文件结构无效，未作任何修改。");
  return state;
}

function findUser(state, username) {
  const matches = state.users.filter((user) => user.username === username);
  if (matches.length !== 1) throw new Error("找不到唯一对应的账号，未作任何修改。");
  return matches[0];
}

export async function resetPassword(usernameInput, password, confirmation) {
  const username = usernameInput.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) throw new Error("账号格式不正确。");
  if (typeof password !== "string" || password.length < 12 || password.length > 128)
    throw new Error("密码需为 12–128 个字符。");
  if (password !== confirmation) throw new Error("两次密码不一致，未作任何修改。");
  const directory = resolve(process.env.APP_STATE_DIR?.trim() || "records/system");
  const file = resolve(directory, "accounts.json");
  const original = findUser(readAccounts(file), username);
  const salt = randomBytes(16);
  const key = await new Promise((done, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, value) => (error ? reject(error) : done(value)),
    ),
  );
  const lockPath = `${file}.lock`;
  const lock = acquireLock(lockPath);
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    // Re-read under the same cross-process lock used by the running app.
    const state = readAccounts(file);
    const user = findUser(state, username);
    if (user.id !== original.id || user.passwordHash !== original.passwordHash)
      throw new Error("账号已被其他操作修改，请重新执行。");
    user.passwordHash = `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
    user.mustChangePassword = false;
    const revoked = state.sessions.filter((session) => session.userId === user.id).length;
    state.sessions = state.sessions.filter((session) => session.userId !== user.id);
    if (state.__adminAudit === undefined) state.__adminAudit = { version: 1, events: [] };
    const audit = state.__adminAudit;
    if (!audit || audit.version !== 1 || !Array.isArray(audit.events))
      throw new Error("账号审计结构不兼容，未作任何修改。");
    audit.events.push({
      version: 1,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      actorId: "server-cli",
      action: "user.password.reset",
      targetType: "user",
      targetId: user.id,
      summary: { mustChangePassword: false },
      result: "success",
    });
    audit.events = audit.events.slice(-5000);
    const descriptor = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(descriptor, JSON.stringify(state, null, 2));
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
    renameSync(temporary, file);
    const parent = openSync(directory, "r");
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
    return { username, revoked, disabled: user.disabled === true };
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    try {
      unlinkSync(lock);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    try {
      rmdirSync(lockPath);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
    }
  }
}

async function main() {
  if (process.argv.length > 2) throw new Error("不接受命令行参数，请按提示输入账号和密码。");
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "请在交互终端执行：docker compose exec student-analytics node scripts/reset-password.mjs",
    );
  console.log("修改已有应用账号的密码（含管理员）；该账号的全部登录会话将失效。");
  const username = await question("登录账号：");
  const password = await hiddenPassword("新密码（12–128 个字符）：");
  const confirmation = await hiddenPassword("再次输入新密码：");
  const result = await resetPassword(username, password, confirmation);
  console.log(`密码已更新：${result.username}；已撤销 ${result.revoked} 个会话。无需重启服务。`);
  if (result.disabled) console.log("该账号仍处于停用状态，请由管理员另行启用。");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Local use follows Next's .env.local; Docker inherits its existing runtime env.
  if (existsSync(".env.local") && process.env.ANALYTICS_RESET_ENV_LOADED !== "1") {
    const child = spawnSync(
      process.execPath,
      ["--env-file=.env.local", fileURLToPath(import.meta.url), ...process.argv.slice(2)],
      { env: { ...process.env, ANALYTICS_RESET_ENV_LOADED: "1" }, stdio: "inherit" },
    );
    process.exitCode = child.status ?? 1;
  } else
    main().catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
