import { withGradeSnapshot } from "../datasets/grade-store";
import { AsyncLocalStorage } from "node:async_hooks";
import type { DataSource } from "../analysis/types";
import type { SessionUser } from "../client-types";
import { AuthError, assertOperation, getUserById } from "./service";
import { assertDatasetAccess } from "../datasets/service";

type Operation = "view" | "ai" | "export";
type AccessScope = { userId: string; datasetId: DataSource; operation: Operation };
const scopes = new AsyncLocalStorage<AccessScope>();

export function assertBusinessAccess(
  user: SessionUser,
  datasetId: DataSource,
  operation: Operation = "view",
) {
  assertOperation(user, operation);
  assertDatasetAccess(user, datasetId);
}

/** Each HTTP execution establishes a server-owned identity; history cannot grant access. */
export function withBusinessAccess<T>(
  user: SessionUser,
  datasetId: DataSource,
  operation: Operation,
  run: () => T,
): T {
  assertBusinessAccess(user, datasetId, operation);
  return scopes.run({ userId: user.id, datasetId, operation }, () =>
    withGradeSnapshot(datasetId, run),
  );
}

/** Re-read durable account/grants/status before each real query/model/tool and after awaits. */
export function assertCurrentAccess(datasetId?: DataSource, operation?: Operation): void {
  const scope = scopes.getStore();
  // Trusted CLI/evaluation calls have no HTTP identity. Public routes MUST create a scope.
  if (!scope) return;
  const user = getUserById(scope.userId);
  if (!user) throw new AuthError(401, "UNAUTHENTICATED", "账号状态已变更，请重新登录。");
  if (datasetId && datasetId !== scope.datasetId)
    throw new AuthError(403, "DATASET_FORBIDDEN", "不能在一次请求中越过已授权的数据范围。");
  assertBusinessAccess(user, datasetId ?? scope.datasetId, operation ?? scope.operation);
}
