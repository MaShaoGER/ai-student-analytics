import { DuckDBConnection } from "@duckdb/node-api";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { API_QUERY_LIMITS } from "../security/query-limits";

describe("profile dataset field limits", () => {
  let fixtureRoot: string;
  let sampleDir: string;
  let profileDatasets: typeof import("./duckdb").profileDatasets;

  beforeAll(async () => {
    fixtureRoot = await mkdtemp(path.join(tmpdir(), "student-profile-fields-"));
    sampleDir = path.join(fixtureRoot, "data", "sample");
    await mkdir(sampleDir, { recursive: true });
    await writeFile(path.join(sampleDir, "learning_activity.csv"), "value\n1\n");
    const cwd = vi.spyOn(process, "cwd").mockReturnValue(fixtureRoot);
    try {
      profileDatasets = (await import("./duckdb")).profileDatasets;
    } finally {
      cwd.mockRestore();
    }
  });

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true });
  });

  async function writeOutcomes(fieldCount: number) {
    const fields = Array.from({ length: fieldCount }, (_, index) => `field_${index}`);
    await writeFile(
      path.join(sampleDir, "student_outcomes.csv"),
      [fields.join(","), fields.map(() => "1").join(","), fields.map(() => "?").join(",")].join(
        "\n",
      ) + "\n",
    );
  }

  it("accepts the exact field bound without counting the internal row-count column", async () => {
    await writeOutcomes(API_QUERY_LIMITS.profile.maxFieldCount);
    const profiles = await profileDatasets();
    const outcomes = profiles[0].tables.find((table) => table.name === "student_outcomes");
    expect(outcomes?.rows).toBe(2);
    expect(outcomes?.fields).toHaveLength(API_QUERY_LIMITS.profile.maxFieldCount);
    expect(outcomes?.fields?.every((field) => field.missing === 1)).toBe(true);
  });

  it("rejects a wide table before generating missing-value aggregation SQL", async () => {
    await writeOutcomes(API_QUERY_LIMITS.profile.maxFieldCount + 1);
    const nativeQueries = vi.spyOn(DuckDBConnection.prototype, "runAndRead");
    await expect(profileDatasets()).rejects.toMatchObject({
      name: "QueryExecutionError",
      code: "TOO_MANY_FIELDS",
    });
    const outcomeQueries = nativeQueries.mock.calls
      .map(([query]) => query)
      .filter((query) => query.includes("student_outcomes.csv"));
    expect(outcomeQueries).toHaveLength(1);
    expect(outcomeQueries[0]).toMatch(/^DESCRIBE/);
  });
});
