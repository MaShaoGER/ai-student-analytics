import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** 真实模式：缺失变量时依次尝试 AI_EVAL_ENV_FILE、records/.env、.env.local（不覆盖已有变量）。 */
export function loadEnvFile(): string | null {
  const candidates = [process.env.AI_EVAL_ENV_FILE, "records/.env", ".env.local"]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  for (const candidate of candidates) {
    const file = resolve(process.cwd(), candidate);
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (line.length === 0 || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator < 1) continue;
      const key = line.slice(0, separator).trim();
      let value = line.slice(separator + 1).trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      )
        value = value.slice(1, -1);
      if (process.env[key] === undefined) process.env[key] = value;
    }
    return candidate;
  }
  return null;
}
