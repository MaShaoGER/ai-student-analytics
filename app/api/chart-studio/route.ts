import { withBusinessAccess } from "@/lib/auth/access";
import { NextResponse } from "next/server";
import { z } from "zod";
import { chartStudioData } from "@/lib/analysis/duckdb";
import { dataSourceSchema } from "@/lib/analysis/types";
import { queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { apiError, noStoreJson, requireUser } from "@/lib/auth/http";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
const schema = z.object({
  datasetId: dataSourceSchema,
  term: z.string().trim().min(1).max(80).optional(),
  course: z.string().trim().max(120).default(""),
});
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const limit = checkRateLimit(`chart-studio:${user.id}`, rateLimitConfigs.analysis);
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
    const input = schema.parse({
      datasetId: params.get("datasetId"),
      term: params.get("term") ?? undefined,
      course: params.get("course") ?? "",
    });
    return noStoreJson(
      await withBusinessAccess(user, input.datasetId, "view", () =>
        chartStudioData(input.datasetId, input.term, input.course, { signal: request.signal }),
      ),
    );
  } catch (error) {
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
