import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseGradeFile, serializeGradeRows, validateGradeSheet } from "./grade-parser";
import type { GradeDataset } from "./grade-contract";
import {
  createGradeDraft,
  deleteGradeDraft,
  getGradeDataset,
  getGradeSnapshot,
  listGradeDatasets,
  previewGradeDraft,
  publishGradeDraft,
  setGradeDatasetEnabled,
  validateGradeDraft,
  withGradeSnapshot,
} from "./grade-store";
import { collectAdminEvents } from "../admin/logs";
const actorId = "fixture-admin-a";
const mapping = { id_student: 0, code_module: 1, code_presentation: 2, score: 3 };
const contents =
  "学号,课程,学期,成绩,不需要的个人字段\n001,课程甲,2026A,80,姓名甲\n01,课程甲,2026A,90,姓名乙\n1,课程甲,2026A,100,姓名丙\n";
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "grade-store-"));
  vi.stubEnv("APP_STATE_DIR", directory);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
async function draft(text = contents) {
  return createGradeDraft(actorId, await parseGradeFile(new TextEncoder().encode(text), "g.csv"));
}
async function first() {
  const d = await draft();
  return {
    draft: d,
    dataset: publishGradeDraft({
      actorId,
      draftId: d.id,
      sheet: 0,
      headerRow: 1,
      mapping,
      name: "教学成绩",
    }),
  };
}
describe("private grade drafts and immutable publication", () => {
  it("publishes normalized necessary fields, persists metadata and only logs aggregate counts", async () => {
    const { draft: d, dataset } = await first();
    const snapshot = getGradeSnapshot(dataset.id);
    const file = readFileSync(snapshot.path, "utf8");
    expect(file).toContain('"001"');
    expect(file).not.toContain("姓名");
    expect(existsSync(join(directory, "grade-imports", `draft-${d.id}.json`))).toBe(false);
    expect(getGradeDataset(dataset.id)?.currentVersion).toBe(dataset.currentVersion);
    expect(listGradeDatasets()).toHaveLength(1);
    const { events } = collectAdminEvents();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "dataset.publish",
          source: "grades",
          summary: expect.objectContaining({ rowCount: 3, studentCount: 3 }),
        }),
      ]),
    );
    expect(JSON.stringify(events)).not.toContain("姓名");
  });
  it("enforces draft ownership, expiry and cancellation without affecting published data", async () => {
    const d = await draft();
    expect(() => previewGradeDraft("other-admin", d.id, 0, 1)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(() => deleteGradeDraft("other-admin", d.id)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
    expect(validateGradeDraft(actorId, d.id, 0, 1, mapping).valid).toBe(true);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 3600001);
    expect(() => previewGradeDraft(actorId, d.id, 0, 1)).toThrow(
      expect.objectContaining({ status: 410 }),
    );
    vi.restoreAllMocks();
    deleteGradeDraft(actorId, d.id);
    expect(() => previewGradeDraft(actorId, d.id, 0, 1)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
  it("replays identical publication and rejects changed payload, stale versions and invalid data", async () => {
    const { draft: d, dataset } = await first();
    const request = { actorId, draftId: d.id, sheet: 0, headerRow: 1, mapping, name: "教学成绩" };
    deleteGradeDraft(actorId, d.id);
    expect(publishGradeDraft(request)).toEqual(dataset);
    expect(() => publishGradeDraft({ ...request, name: "另一份" })).toThrow(
      expect.objectContaining({ status: 409 }),
    );
    const bad = await draft(contents + "001,课程甲,2026A,10,\n");
    expect(() =>
      publishGradeDraft({
        ...request,
        draftId: bad.id,
        datasetId: dataset.id,
        baseVersion: dataset.currentVersion,
      }),
    ).toThrow(expect.objectContaining({ code: "IMPORT_VALIDATION_FAILED" }));
    expect(getGradeDataset(dataset.id)?.currentVersion).toBe(dataset.currentVersion);
    const newer = await draft(contents.replace(",80,", ",60,"));
    const next = publishGradeDraft({
      ...request,
      draftId: newer.id,
      datasetId: dataset.id,
      baseVersion: dataset.currentVersion,
    });
    const stale = await draft();
    expect(() =>
      publishGradeDraft({
        ...request,
        draftId: stale.id,
        datasetId: dataset.id,
        baseVersion: dataset.currentVersion,
      }),
    ).toThrow(expect.objectContaining({ code: "DATASET_VERSION_CONFLICT" }));
    expect(getGradeDataset(dataset.id)?.currentVersion).toBe(next.currentVersion);
  });
  it("pins one version across asynchronous work while later queries see the new version", async () => {
    const { dataset } = await first();
    const old = getGradeSnapshot(dataset.id);
    await withGradeSnapshot(dataset.id, async () => {
      const d = await draft(contents.replace(",80,", ",60,"));
      const next = publishGradeDraft({
        actorId,
        draftId: d.id,
        sheet: 0,
        headerRow: 1,
        mapping,
        name: dataset.name,
        datasetId: dataset.id,
        baseVersion: dataset.currentVersion,
      });
      await Promise.resolve();
      expect(next.currentVersion).not.toBe(dataset.currentVersion);
      expect(getGradeSnapshot(dataset.id).version).toBe(old.version);
      expect(getGradeSnapshot(dataset.id).path).toBe(old.path);
    });
    expect(getGradeSnapshot(dataset.id).version).not.toBe(old.version);
    expect(existsSync(old.path)).toBe(true);
    setGradeDatasetEnabled(dataset.id, false, actorId);
    expect(getGradeDataset(dataset.id)?.enabled).toBe(false);
    expect(withGradeSnapshot("demo", () => "builtin")).toBe("builtin");
  });
  it("bounds active drafts and reclaims expired draft files on the next upload", async () => {
    const drafts = [];
    for (let i = 0; i < 5; i++) drafts.push(await draft());
    await expect(draft()).rejects.toMatchObject({ code: "IMPORT_DRAFT_LIMIT" });
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 3600001);
    const next = await draft();
    expect(next.id).toBeTruthy();
    for (const d of drafts)
      expect(existsSync(join(directory, "grade-imports", `draft-${d.id}.json`))).toBe(false);
  });
  /** Rebuild exactly what a publication writes: the next version name, the CSV and its path. */
  async function crashBoundary(base: GradeDataset) {
    const book = await parseGradeFile(
      new TextEncoder().encode(contents.replace(",80,", ",60,")),
      "g.csv",
    );
    const draftId = createGradeDraft(actorId, book).id;
    const csv = serializeGradeRows(validateGradeSheet(book, 0, 1, mapping).rows);
    const version = `v${base.versions.length + 1}-${createHash("sha256")
      .update(csv)
      .digest("hex")
      .slice(0, 16)}`;
    const request = { actorId, draftId, sheet: 0, headerRow: 1, mapping, name: base.name };
    return {
      version,
      csv,
      file: join(directory, "grade-imports", `${base.id}-${version}.csv`),
      publish: () =>
        publishGradeDraft({ ...request, datasetId: base.id, baseVersion: base.currentVersion }),
    };
  }
  it("adopts the fsynced version file a crash left before the catalog commit", async () => {
    const { dataset } = await first();
    const crash = await crashBoundary(dataset);
    writeFileSync(crash.file, crash.csv, { mode: 0o600 });
    // The crashed writer's catalog lock survives with a dead owner marker.
    const lock = join(directory, "grade-catalog.json.lock");
    const owner = join(lock, `owner-${randomUUID()}.json`);
    mkdirSync(lock, { mode: 0o700 });
    writeFileSync(owner, JSON.stringify({ version: 2, pid: 999999, identity: "crashed" }), {
      mode: 0o600,
    });
    const aged = new Date(Date.now() - 120_000);
    utimesSync(owner, aged, aged);
    utimesSync(lock, aged, aged);

    const next = crash.publish();

    expect(next.currentVersion).toBe(crash.version);
    expect(next.versions).toHaveLength(2);
    expect(existsSync(lock)).toBe(false);
    expect(readFileSync(crash.file, "utf8")).toBe(crash.csv);
    expect(
      readdirSync(join(directory, "grade-imports")).filter((name) =>
        name.startsWith(`${dataset.id}-${crash.version}`),
      ),
    ).toEqual([`${dataset.id}-${crash.version}.csv`]);
    expect(getGradeSnapshot(dataset.id).version).toBe(crash.version);
  });
  it("refuses to reuse a version path holding different content", async () => {
    const { dataset } = await first();
    const crash = await crashBoundary(dataset);
    const foreign = crash.csv.replace('"001"', '"002"');
    writeFileSync(crash.file, foreign, { mode: 0o600 });
    expect(() => crash.publish()).toThrow(expect.objectContaining({ status: 409 }));
    expect(readFileSync(crash.file, "utf8")).toBe(foreign);
    expect(getGradeDataset(dataset.id)).toEqual(dataset);
  });
  it("refuses to reuse a symbolic link at the version path", async () => {
    const { dataset } = await first();
    const linked = await crashBoundary(dataset);
    const target = join(directory, "elsewhere.csv");
    writeFileSync(target, linked.csv, { mode: 0o600 });
    symlinkSync(target, linked.file);
    expect(() => linked.publish()).toThrow(expect.objectContaining({ status: 503 }));
    expect(readFileSync(target, "utf8")).toBe(linked.csv);
    expect(getGradeDataset(dataset.id)).toEqual(dataset);
  });
});
