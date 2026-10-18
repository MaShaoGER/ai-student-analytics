import { profileDatasets } from "@/lib/analysis/duckdb";
import { apiError, noStoreJson, requireUser } from "@/lib/auth/http";
import { queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";
import { NextResponse } from "next/server";

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
    return noStoreJson({ datasets: await profileDatasets({ signal: request.signal }) });
  } catch (error) {
    const failure = queryExecutionHttpError(error);
    if (failure) return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
    return apiError(error);
  }
}
