import { isGradeDataset } from "./id";
import { listGradeDatasets, getGradeSnapshot, setGradeDatasetEnabled } from "./grade-store";
import type { GradeVersion } from "./grade-contract";
import { statSync, accessSync, constants } from "node:fs";
import path from "node:path";
import type { DataSource } from "../analysis/types";
import type { SessionUser } from "../client-types";
import { AuthError } from "../auth/service";
import { readState, updateState } from "../settings/storage";
import { appendAdminEvent } from "../admin/audit";

export const DATASET_IDS: DataSource[] = ["demo", "oulad"];
type CatalogState = { version: 1; datasets: { id: DataSource; enabled: boolean }[] };
const initial = (): CatalogState => ({
  version: 1,
  datasets: DATASET_IDS.map((id) => ({ id, enabled: true })),
});
export type ManagedDataset = {
  id: DataSource;
  name: string;
  owner: string;
  currentVersion?: string;
  versions?: GradeVersion[];
  enabled: boolean;
  available: boolean;
  version: string;
  source: string;
  capabilities: string[];
  unavailableReason?: string;
};

/** Controlled source mapping; no client-supplied path and no file contents in the catalog. */
function available(id: DataSource): boolean {
  const demoRoot = path.resolve(
    /* turbopackIgnore: true */ process.env.DEMO_DATA_DIR || "data/sample",
  );
  const files =
    id === "demo"
      ? ["learning_activity.csv", "student_outcomes.csv"].map((file) =>
          path.join(/* turbopackIgnore: true */ demoRoot, file),
        )
      : [
          "assessments.csv",
          "courses.csv",
          "studentAssessment.csv",
          "studentInfo.csv",
          "studentVle.csv",
        ].map((file) => path.resolve("oulad_raw", file));
  return files.every((file) => {
    try {
      accessSync(/* turbopackIgnore: true */ file, constants.R_OK);
      return statSync(/* turbopackIgnore: true */ file).isFile();
    } catch {
      return false;
    }
  });
}

function catalogState(): CatalogState {
  const state = readState("datasets.json", initial);
  if (
    state.version !== 1 ||
    !Array.isArray(state.datasets) ||
    DATASET_IDS.some(
      (id) => !state.datasets.some((item) => item.id === id && typeof item.enabled === "boolean"),
    )
  )
    throw new Error("数据集目录存储不兼容，请检查服务端状态。");
  return state;
}

export function listManagedDatasets(): ManagedDataset[] {
  const state = catalogState();
  const builtins = DATASET_IDS.map((id) => {
    const ready = available(id);
    return {
      id,
      name: id === "demo" ? "模拟校园数据" : "OULAD 本地数据",
      owner: "system",
      enabled: state.datasets.find((item) => item.id === id)!.enabled,
      available: ready,
      version: "1.0（声明版本）",
      source: id === "demo" ? "本地虚构演示数据" : "本地 OULAD CSV",
      capabilities: [
        "数据画像",
        "聚合指标",
        "成绩分布",
        "课程关系",
        "课程全景",
        "图表工坊",
        ...(id === "demo" ? ["缺勤统计（依赖可选出勤表）"] : []),
      ],
      ...(!ready
        ? { unavailableReason: "必需源文件缺失或不可读，请管理员检查服务器数据文件。" }
        : {}),
    };
  });
  const imported: ManagedDataset[] = listGradeDatasets().map((dataset) => {
    let available = true;
    try {
      getGradeSnapshot(dataset.id);
    } catch {
      available = false;
    }
    const version = dataset.versions.find((v) => v.version === dataset.currentVersion);
    return {
      ...dataset,
      available,
      version: dataset.currentVersion,
      source: "管理员导入的教学成绩",
      capabilities: [
        "成绩均分",
        "成绩分布",
        "课程关联",
        "课程全景",
        "成绩箱线图",
        "学期比较",
        ...(version?.hasCompletion ? ["课程完成率"] : []),
      ],
      ...(!available
        ? { unavailableReason: "成绩版本文件缺失或不可读，请管理员检查持久化存储。" }
        : {}),
    };
  });
  return [...builtins, ...imported];
}

export function authorizedDatasets(user: SessionUser): ManagedDataset[] {
  return listManagedDatasets().filter(
    (dataset) => user.role === "admin" || user.datasetIds?.includes(dataset.id),
  );
}

export function assertDatasetAccess(user: SessionUser, datasetId: DataSource): void {
  // Check grants BEFORE exposing catalog status, file presence or labels.
  if (user.role !== "admin" && !user.datasetIds?.includes(datasetId))
    throw new AuthError(403, "DATASET_FORBIDDEN", "当前账号未获该数据集授权，请联系管理员。");
  const dataset = listManagedDatasets().find((item) => item.id === datasetId);
  if (!dataset) throw new AuthError(400, "INVALID_DATASET", "请选择已登记的数据集。");
  if (!dataset.enabled)
    throw new AuthError(403, "DATASET_DISABLED", "该数据集已停用，请联系管理员恢复。");
  if (!dataset.available)
    throw new AuthError(503, "DATA_SOURCE_UNAVAILABLE", dataset.unavailableReason!);
}

export function setDatasetEnabled(
  id: DataSource,
  enabled: boolean,
  actorId: string,
): ManagedDataset {
  if (isGradeDataset(id)) {
    setGradeDatasetEnabled(id, enabled, actorId);
    return listManagedDatasets().find((dataset) => dataset.id === id)!;
  }
  catalogState();
  updateState("datasets.json", initial, (state) => {
    const dataset = state.datasets.find((item) => item.id === id);
    if (!dataset) throw new AuthError(404, "DATASET_NOT_FOUND", "找不到该数据集。");
    const before = dataset.enabled;
    dataset.enabled = enabled;
    appendAdminEvent(state, {
      actorId,
      action: "dataset.status",
      targetType: "dataset",
      targetId: id,
      summary: { beforeEnabled: before, enabled },
    });
  });
  return listManagedDatasets().find((item) => item.id === id)!;
}
