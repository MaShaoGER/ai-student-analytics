import { withBusinessAccess } from "@/lib/auth/access";
import { NextResponse } from "next/server";
import { z } from "zod";
import { conceptExplorerData } from "@/lib/analysis/concept-query";
import { dataSourceSchema } from "@/lib/analysis/types";
import { queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { apiError, noStoreJson, requireUser } from "@/lib/auth/http";
import { checkRateLimit, rateLimitConfigs } from "@/lib/security/rate-limit";
import { AuthError } from "@/lib/auth/service";

export const runtime = "nodejs";

const schema = z.object({
  datasetId: dataSourceSchema,
  term: z.string().trim().min(1).max(80).optional(),
  course: z.string().trim().min(1).max(120).optional(),
});
const allowedParams: Record<string, true> = { datasetId: true, term: true, course: true };

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const limit = checkRateLimit(`concept-explorer:${user.id}`, rateLimitConfigs.analysis);
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
    // Repeated keys would make the server pick one silently; unknown keys are
    // usually a typo that would otherwise be ignored.
    for (const key of new Set(params.keys())) {
      if (!Object.hasOwn(allowedParams, key))
        throw new AuthError(400, "INVALID_QUERY", "包含未知的查询参数。");
      if (params.getAll(key).length > 1)
        throw new AuthError(400, "INVALID_QUERY", "查询参数不能重复。");
    }
    const input = schema.parse({
      datasetId: params.get("datasetId") ?? undefined,
      term: params.get("term") ?? undefined,
      course: params.get("course") ?? undefined,
    });
    return noStoreJson(
      await withBusinessAccess(user, input.datasetId, "view", () =>
        conceptExplorerData(
          input.datasetId,
          { term: input.term, course: input.course },
          { signal: request.signal },
        ),
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