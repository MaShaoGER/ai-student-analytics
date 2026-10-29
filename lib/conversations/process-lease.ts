import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

/**
 * Process-birth identity for conversation turn leases.
 *
 * `lib/settings/storage.ts` keeps its equivalent private to that module's lock
 * implementation, so this small copy exists to detect a dead turn owner across
 * workers and restarts without changing that file. It is identity only.
 */
export type LeaseOwner = { host: string; pid: number; birth: string | null; startedAt: number };

function processBirth(pid: number): string | null {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const start = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/)[19];
      return start && /^\d+$/.test(start) ? `linux:${start}` : null;
    }
    const start = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
    }).trim();
    return start ? `${process.platform}:${start}` : null;
  } catch {
    return null;
  }
}

const own: LeaseOwner = {
  host: hostname(),
  pid: process.pid,
  birth: processBirth(process.pid),
  startedAt: Date.now() - Math.round(process.uptime() * 1000),
};

/** Opaque, bounded lease owner written into a running turn. */
export function currentLeaseOwner(): string {
  return JSON.stringify(own);
}

/** A lease owner from another host cannot be proven dead; expiry stays authoritative. */
export function leaseOwnerIsAlive(value: string, now = Date.now()): boolean {
  let owner: Partial<LeaseOwner>;
  try {
    owner = JSON.parse(value) as Partial<LeaseOwner>;
  } catch {
    return false;
  }
  if (
    typeof owner.host !== "string" ||
    !Number.isSafeInteger(owner.pid) ||
    owner.pid! < 1 ||
    typeof owner.startedAt !== "number"
  )
    return false;
  if (owner.host !== own.host) return true;
  try {
    process.kill(owner.pid!, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EPERM") return true;
    return false;
  }
  // The recording process is alive, but a reused PID from a previous boot must
  // still be rejected: identity is the birth stamp, never the PID alone.
  if (owner.pid === own.pid) return owner.birth !== null && owner.birth === own.birth;
  // Same host and PID is alive: compare birth to rule out PID reuse.
  if (!owner.birth) return now - owner.startedAt < 24 * 60 * 60 * 1000;
  return processBirth(owner.pid!) === owner.birth;
}
