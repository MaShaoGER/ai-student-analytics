import { withBusinessAccess } from "@/lib/auth/access";
import { NextResponse } from "next/server";
import { coursePanorama } from "@/lib/analysis/duckdb";
import {
  coursePanoramaRequestSchema,
  PanoramaSelectionError,
} from "@/lib/analysis/course-panorama";
import { queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { apiError, noStoreJson, requireUser } from "@/lib/auth/http";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const limit = checkRateLimit(`course-panorama:${user.id}`, rateLimitConfigs.analysis);
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
    const params = new URL(request.url).searchParams;
    const input = coursePanoramaRequestSchema.parse({
      datasetId: params.get("datasetId"),
      term: params.get("term") ?? undefined,
      threshold: params.get("threshold") ?? undefined,
      source: params.get("source") ?? undefined,
      target: params.get("target") ?? undefined,
    });
    return noStoreJson(
      await withBusinessAccess(user, input.datasetId, "view", () =>
        coursePanorama(input, { signal: request.signal }),
      ),
    );
  } catch (error) {
    if (error instanceof PanoramaSelectionError)
      return NextResponse.json(
        { error: error.message, code: "INVALID_COHORT" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    const failure = queryExecutionHttpError(error);
    if (failure)
      return NextResponse.json(
        { error: failure.error, code: failure.code },
        { status: failure.status, headers: { "Cache-Control": "no-store" } },
      );
    const response = apiError(error);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }
}
