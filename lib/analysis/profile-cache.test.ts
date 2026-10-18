import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("dataset profile cache", () => {
  let fixtureRoot: string;
  let sampleDir: string;
  let signatureDir: string;
  let module: typeof import("./duckdb");

  beforeAll(async () => {
    fixtureRoot = mkdtempSync(path.join(tmpdir(), "analytics-profile-cache-"));
    sampleDir = path.join(fixtureRoot, "data", "fixtures", "golden");
    signatureDir = path.join(fixtureRoot, "signature");
    mkdirSync(sampleDir, { recursive: true });
    mkdirSync(signatureDir, { recursive: true });
    writeFileSync(path.join(sampleDir, "learning_activity.csv"), "activity_count\n1\n");
    writeFileSync(path.join(sampleDir, "student_outcomes.csv"), "score\n1\n");
    // OULAD paths must stay inside the fixture root so the real oulad_raw/ is never read.
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);
    try {
      module = await import("./duckdb");
    } finally {
      cwd.mockRestore();
    }
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(fixtureRoot, { recursive: true, force: true });
  });

  it("keeps the snapshot TTL at or below 30 seconds", () => {
    expect(module.PROFILE_CACHE_TTL_MS).toBeLessThanOrEqual(30_000);
    expect(module.PROFILE_CACHE_TTL_MS).toBeGreaterThan(0);
  });

  it("signs every CSV path plus its mtime and size", () => {
    const first = path.join(signatureDir, "first.csv");
    const second = path.join(signatureDir, "second.csv");
    const copy = path.join(signatureDir, "copy.csv");
    const missing = path.join(signatureDir, "missing.csv");
    writeFileSync(first, "value\n1\n");
    writeFileSync(second, "value\n2\n");

    const initial = module.profileCacheSignature([first, second]);
    expect(module.profileCacheSignature([first, second])).toBe(initial);

    // Size changes are visible without waiting for mtime granularity.
    writeFileSync(second, "value\n2\n3\n");
    const sizeChanged = module.profileCacheSignature([first, second]);
    expect(sizeChanged).not.toBe(initial);

    // Mtime changes invalidate even when the size is unchanged.
    writeFileSync(second, "value\n2\n3\n");
    const mtimeBaseline = module.profileCacheSignature([first, second]);
    utimesSync(second, new Date(2020, 0, 1), new Date(2020, 0, 1));
    expect(module.profileCacheSignature([first, second])).not.toBe(mtimeBaseline);

    // The path itself is part of the signature, even for identical content/mtime.
    writeFileSync(copy, "value\n1\n");
    utimesSync(first, new Date(2021, 0, 1), new Date(2021, 0, 1));
    utimesSync(copy, new Date(2021, 0, 1), new Date(2021, 0, 1));
    expect(module.profileCacheSignature([first])).not.toBe(module.profileCacheSignature([copy]));

    // A missing file has a stable marker that differs from an existing one.
    const missingSignature = module.profileCacheSignature([missing]);
    expect(missingSignature).toBe(module.profileCacheSignature([missing]));
    expect(missingSignature).not.toBe(module.profileCacheSignature([first]));
  });

  it("serves an entry only for the same signature while it is unexpired", () => {
    const entry: import("./duckdb").ProfileCacheEntry = {
      signature: "signature-a",
      expiresAt: 1_000,
      profiles: [],
    };
    expect(module.readProfileCache(entry, "signature-a", 999)).toBe(entry.profiles);
    expect(module.readProfileCache(entry, "signature-b", 999)).toBeNull();
    expect(module.readProfileCache(entry, "signature-a", 1_000)).toBeNull();
    expect(module.readProfileCache(null, "signature-a", 0)).toBeNull();
  });

  it("recomputes when a CSV changes and keeps cancellation observable", async () => {
    const first = await module.profileDatasets();
    const rows = (profiles: typeof first) =>
      profiles[0].tables.find((table) => table.name === "student_outcomes")?.rows;
    expect(rows(first)).toBe(1);
    expect(await module.profileDatasets()).toBe(first);

    const controller = new AbortController();
    controller.abort();
    await expect(module.profileDatasets({ signal: controller.signal })).rejects.toMatchObject({
      code: "CANCELLED",
    });

    writeFileSync(path.join(sampleDir, "student_outcomes.csv"), "score\n1\n2\n");
    const next = await module.profileDatasets();
    expect(next).not.toBe(first);
    expect(rows(next)).toBe(2);
  });
});
