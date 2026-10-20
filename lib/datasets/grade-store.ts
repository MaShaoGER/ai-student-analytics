import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { AuthError } from "../auth/service";
import { appendAdminEvent } from "../admin/audit";
import { getStateDirectory, readState, updateState } from "../settings/storage";
import { isGradeDataset } from "./id";
import { previewGradeSheet, serializeGradeRows, validateGradeSheet } from "./grade-parser";
import {
  GRADE_LIMITS,
  type GradeDataset,
  type GradeDraft,
  type GradeMapping,
  type GradeWorkbook,
} from "./grade-contract";
type DraftEntry = {
  id: string;
  ownerId: string;
  expiresAt: string;
  bytes: number;
  receipt?: { hash: string; dataset: GradeDataset };
};
type Catalog = { version: 1; datasets: GradeDataset[]; drafts: DraftEntry[] };
export type GradeSnapshot = GradeDataset & {
  path: string;
  version: string;
  hasCompletion: boolean;
};
const FILE = "grade-catalog.json";
const initial = (): Catalog => ({ version: 1, datasets: [], drafts: [] });
const pinned = new AsyncLocalStorage<GradeSnapshot>();
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
function error(status: number, code: string, message: string): never {
  throw new AuthError(status, code, message);
}
function root(): string {
  const directory = path.join(getStateDirectory(), "grade-imports");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const info = lstatSync(directory);
  if (info.isSymbolicLink() || !info.isDirectory())
    error(503, "IMPORT_STORAGE_UNAVAILABLE", "成绩存储不可用，请联系管理员。");
  return directory;
}
function draftPath(id: string): string {
  if (!uuid.test(id)) error(400, "INVALID_IMPORT_DRAFT", "暂存编号不正确。");
  return path.join(root(), `draft-${id}.json`);
}
function versionPath(id: string, version: string): string {
  if (!isGradeDataset(id) || !/^v\d+-[a-f0-9]{16}$/.test(version))
    error(503, "IMPORT_STORAGE_UNAVAILABLE", "成绩版本信息无效。");
  return path.join(root(), `${id}-${version}.csv`);
}
function readCatalog(): Catalog {
  const state = readState(FILE, initial);
  if (state.version !== 1 || !Array.isArray(state.datasets) || !Array.isArray(state.drafts))
    error(503, "IMPORT_STORAGE_UNAVAILABLE", "成绩目录不可用，请联系管理员。");
  return state;
}
function writePrivate(file: string, contents: string): void {
  const fd = openSync(file, "wx", 0o600);
  try {
    writeFileSync(fd, contents, "utf8");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function readPrivate(file: string, maxBytes: number): string {
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
    error(503, "IMPORT_STORAGE_UNAVAILABLE", "成绩文件不可用，请联系管理员。");
  return readFileSync(file, "utf8");
}
function removeOwnedDraft(entry: DraftEntry): void {
  const file = draftPath(entry.id);
  if (!existsSync(file)) return;
  const stat = lstatSync(file);
  if (stat.isFile() && !stat.isSymbolicLink()) unlinkSync(file);
}
function cleanup(state: Catalog): void {
  state.drafts = state.drafts.filter((entry) => {
    if (Date.parse(entry.expiresAt) > Date.now()) return true;
    removeOwnedDraft(entry);
    return false;
  });
}
function draftEntry(state: Catalog, actorId: string, id: string): DraftEntry {
  const entry = state.drafts.find((d) => d.id === id);
  if (!entry || entry.ownerId !== actorId)
    error(404, "IMPORT_DRAFT_NOT_FOUND", "找不到当前账号的导入暂存。");
  if (Date.parse(entry.expiresAt) <= Date.now())
    error(410, "IMPORT_DRAFT_EXPIRED", "导入暂存已过期，请重新上传。");
  return entry;
}
function readWorkbook(entry: DraftEntry): GradeWorkbook {
  if (entry.receipt) error(409, "IMPORT_ALREADY_PUBLISHED", "该暂存已经发布，请上传新文件。");
  try {
    return JSON.parse(readPrivate(draftPath(entry.id), 16 * 1024 * 1024)) as GradeWorkbook;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    error(503, "IMPORT_STORAGE_UNAVAILABLE", "导入暂存不可用，请重新上传。");
  }
}
export function createGradeDraft(ownerId: string, workbook: GradeWorkbook): GradeDraft {
  const contents = JSON.stringify(workbook),
    bytes = Buffer.byteLength(contents);
  if (bytes > 16 * 1024 * 1024) error(413, "IMPORT_TOO_LARGE", "解析后的文件过大，请拆分导入。");
  const id = randomUUID(),
    expiresAt = new Date(Date.now() + GRADE_LIMITS.draftTtlMs).toISOString();
  const file = draftPath(id);
  try {
    return updateState(FILE, initial, (state) => {
      cleanup(state);
      const active = state.drafts.filter((d) => !d.receipt);
      if (
        active.filter((d) => d.ownerId === ownerId).length >= 5 ||
        active.length >= 20 ||
        active.reduce((n, d) => n + d.bytes, 0) + bytes > 64 * 1024 * 1024
      )
        error(429, "IMPORT_DRAFT_LIMIT", "暂存数量或容量已达上限，请先取消已有导入或稍后重试。");
      writePrivate(file, contents);
      state.drafts.push({ id, ownerId, expiresAt, bytes });
      return {
        id,
        expiresAt,
        sheets: workbook.sheets.map((sheet) => ({
          name: sheet.name,
          rowCount: Math.max(0, sheet.rows.length - 1),
        })),
      };
    });
  } catch (e) {
    // A durability error after rename has an unknown outcome; preserve committed data.
    let committed = true;
    try {
      committed = readCatalog().drafts.some((d) => d.id === id);
    } catch {}
    if (!committed && existsSync(file)) unlinkSync(file);
    throw e;
  }
}
export function previewGradeDraft(actorId: string, id: string, sheet: number, headerRow: number) {
  return previewGradeSheet(readWorkbook(draftEntry(readCatalog(), actorId, id)), sheet, headerRow);
}
export function validateGradeDraft(
  actorId: string,
  id: string,
  sheet: number,
  headerRow: number,
  mapping: GradeMapping,
) {
  return validateGradeSheet(
    readWorkbook(draftEntry(readCatalog(), actorId, id)),
    sheet,
    headerRow,
    mapping,
  ).summary;
}
export function deleteGradeDraft(actorId: string, id: string): void {
  updateState(FILE, initial, (state) => {
    const entry = state.drafts.find((d) => d.id === id);
    if (!entry) return;
    if (entry.ownerId !== actorId)
      error(404, "IMPORT_DRAFT_NOT_FOUND", "找不到当前账号的导入暂存。");
    // Keep a published receipt for safe retries; its workbook is already removed.
    if (entry.receipt) return;
    removeOwnedDraft(entry);
    state.drafts = state.drafts.filter((d) => d.id !== id);
  });
}
export function listGradeDatasets(): GradeDataset[] {
  return readCatalog().datasets;
}
export function getGradeDataset(id: string): GradeDataset | undefined {
  return readCatalog().datasets.find((d) => d.id === id);
}
export function getGradeSnapshot(id: string): GradeSnapshot {
  const captured = pinned.getStore();
  if (captured?.id === id) return captured;
  const dataset = getGradeDataset(id);
  if (!dataset) error(404, "DATASET_NOT_FOUND", "找不到已登记的成绩数据集。");
  const metadata = dataset.versions.find((v) => v.version === dataset.currentVersion);
  if (!metadata) error(503, "DATA_SOURCE_UNAVAILABLE", "成绩版本不可用，请联系管理员。");
  const file = versionPath(dataset.id, dataset.currentVersion);
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error();
  } catch {
    error(503, "DATA_SOURCE_UNAVAILABLE", "成绩版本文件不可用，请联系管理员。");
  }
  return {
    ...dataset,
    path: file,
    version: dataset.currentVersion,
    hasCompletion: metadata.hasCompletion,
  };
}
export function withGradeSnapshot<T>(id: string, run: () => T): T {
  if (!isGradeDataset(id)) return run();
  const captured = pinned.getStore();
  return captured?.id === id ? run() : pinned.run(getGradeSnapshot(id), run);
}
export function setGradeDatasetEnabled(
  id: string,
  enabled: boolean,
  actorId: string,
): GradeDataset {
  return updateState(FILE, initial, (state) => {
    const dataset = state.datasets.find((d) => d.id === id);
    if (!dataset) error(404, "DATASET_NOT_FOUND", "找不到已登记的成绩数据集。");
    const before = dataset.enabled;
    dataset.enabled = enabled;
    appendAdminEvent(state, {
      actorId,
      action: "dataset.status",
      targetType: "dataset",
      targetId: id,
      summary: { beforeEnabled: before, enabled },
    });
    return dataset;
  });
}
export function publishGradeDraft(input: {
  actorId: string;
  draftId: string;
  sheet: number;
  headerRow: number;
  mapping: GradeMapping;
  name: string;
  datasetId?: `grades_${string}`;
  baseVersion?: string;
}): GradeDataset {
  const name = input.name.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(name))
    error(400, "INVALID_DATASET_NAME", "数据集名称须为1–80个字符，不能包含控制字符。");
  const ordered = Object.fromEntries(
    Object.entries(input.mapping).sort(([a], [b]) => a.localeCompare(b)),
  );
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        sheet: input.sheet,
        headerRow: input.headerRow,
        mapping: ordered,
        name,
        datasetId: input.datasetId ?? null,
        baseVersion: input.baseVersion ?? null,
      }),
    )
    .digest("hex");
  let created: string | undefined;
  try {
    const result = updateState(FILE, initial, (state) => {
      const entry = draftEntry(state, input.actorId, input.draftId);
      if (entry.receipt) {
        if (entry.receipt.hash !== hash)
          error(409, "IMPORT_PUBLICATION_CONFLICT", "该暂存已按其他参数发布，请上传新文件。");
        return entry.receipt.dataset;
      }
      const { summary, rows } = validateGradeSheet(
        readWorkbook(entry),
        input.sheet,
        input.headerRow,
        input.mapping,
      );
      if (!summary.valid)
        error(422, "IMPORT_VALIDATION_FAILED", "数据校验未通过，请修正所有错误后重新上传。");
      const existing = input.datasetId
        ? state.datasets.find((d) => d.id === input.datasetId)
        : undefined;
      if (input.datasetId && !existing)
        error(404, "DATASET_NOT_FOUND", "找不到要更新的成绩数据集。");
      if (existing && input.baseVersion !== existing.currentVersion)
        error(409, "DATASET_VERSION_CONFLICT", "该数据集已有新版本，请刷新目录后重新校验。");
      if (!existing && input.baseVersion)
        error(400, "INVALID_BASE_VERSION", "新建数据集无需参照版本。");
      if (!existing && state.datasets.length >= 50)
        error(409, "DATASET_LIMIT", "成绩数据集数量已达50个，请联系管理员整理。");
      if (existing && existing.versions.length >= 20)
        error(409, "DATASET_VERSION_LIMIT", "该数据集版本已达20个，请联系管理员归档。");
      const csv = serializeGradeRows(rows),
        csvBytes = Buffer.byteLength(csv);
      let storedBytes = 0;
      for (const d of state.datasets)
        for (const v of d.versions) {
          const file = versionPath(d.id, v.version);
          if (existsSync(file)) storedBytes += lstatSync(file).size;
        }
      if (storedBytes + csvBytes > 512 * 1024 * 1024)
        error(409, "IMPORT_STORAGE_LIMIT", "成绩存储容量已达上限，请联系管理员归档。");
      const id = existing?.id ?? `grades_${randomUUID()}`;
      const version = `v${(existing?.versions.length ?? 0) + 1}-${createHash("sha256").update(csv).digest("hex").slice(0, 16)}`;
      const metadata = {
        version,
        createdAt: new Date().toISOString(),
        rowCount: summary.rowCount,
        studentCount: summary.studentCount,
        courseCount: summary.courseCount,
        termCount: summary.termCount,
        missingScores: summary.missingScores,
        hasCompletion: summary.hasCompletion,
      };
      const dataset: GradeDataset = {
        id,
        name,
        owner: existing?.owner ?? input.actorId,
        enabled: existing?.enabled ?? true,
        currentVersion: version,
        versions: [...(existing?.versions ?? []), metadata],
      };
      const file = versionPath(id, version);
      writePrivate(file, csv);
      created = file;
      if (existing) state.datasets[state.datasets.indexOf(existing)] = dataset;
      else state.datasets.push(dataset);
      entry.receipt = { hash, dataset };
      entry.expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      entry.bytes = 0;
      appendAdminEvent(state, {
        actorId: input.actorId,
        action: "dataset.publish",
        targetType: "dataset",
        targetId: id,
        summary: {
          rowCount: summary.rowCount,
          studentCount: summary.studentCount,
          courseCount: summary.courseCount,
          termCount: summary.termCount,
          missingScores: summary.missingScores,
          versionNumber: dataset.versions.length,
        },
      });
      return dataset;
    });
    // The atomic catalog now owns the version; a crash before cleanup only retains a private draft.
    try {
      removeOwnedDraft({ id: input.draftId, ownerId: input.actorId, expiresAt: "", bytes: 0 });
    } catch {
      /* cleanup retries on expiration */
    }
    return result;
  } catch (e) {
    let committed = true;
    if (created) {
      try {
        committed = readCatalog().datasets.some((d) =>
          d.versions.some((v) => versionPath(d.id, v.version) === created),
        );
      } catch {}
      if (!committed && existsSync(created)) unlinkSync(created);
    }
    throw e;
  }
}
