import { profileDatasets } from "@/lib/analysis/duckdb";
import { apiError, noStoreJson, requireUser } from "@/lib/auth/http";
import { queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";
import { NextResponse } from "next/server";
import { authorizedDatasets } from "@/lib/datasets/service";
import { assertOperation } from "@/lib/auth/service";
import { withBusinessAccess } from "@/lib/auth/access";
import type { DatasetProfile } from "@/lib/analysis/types";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const limit = checkRateLimit(`profile:${user.id}`, rateLimitConfigs.profile);
    if (!limit.allowed)
      return NextResponse.json(
        { error: "请求过于频繁，请稍后再试。", code: "RATE_LIMIT_EXCEEDED" },
        {
          status: 429,
          headers: {
            "Cache-Control": "no-store",
            "Retry-After": String(Math.ceil(limit.resetAfter / 1000)),
          },
        },
      );
    assertOperation(user, "view");
    const datasets: DatasetProfile[] = [];
    for (const dataset of authorizedDatasets(user)) {
      if (dataset.enabled && dataset.available) {
        const profiles = await withBusinessAccess(user, dataset.id, "view", () =>
          profileDatasets({ signal: request.signal }, [dataset.id]),
        );
        datasets.push(...profiles.map((profile) => ({ ...profile, enabled: true })));
      } else {
        datasets.push({
          id: dataset.id,
          name: dataset.name,
          source: dataset.source,
          description: dataset.enabled
            ? dataset.unavailableReason!
            : "该数据集已停用，请联系管理员恢复。",
          available: dataset.available,
          enabled: dataset.enabled,
          tables: [],
          unavailableReason: dataset.enabled ? dataset.unavailableReason : "该数据集已停用。",
        });
      }
    }
    return noStoreJson({ datasets });
  } catch (error) {
    const failure = queryExecutionHttpError(error);
    if (failure)
      return NextResponse.json(
        { error: failure.error, code: failure.code },
        { status: failure.status, headers: { "Cache-Control": "no-store" } },
      );
    return apiError(error);
  }
}
