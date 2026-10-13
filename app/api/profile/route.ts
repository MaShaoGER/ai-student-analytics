import { profileDatasets } from "@/lib/analysis/duckdb";
import { apiError, noStoreJson, requireUser } from "@/lib/auth/http";
import { queryExecutionHttpError } from "@/lib/analysis/http-errors";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireUser(request);
    return noStoreJson({ datasets: await profileDatasets({ signal: request.signal }) });
  } catch (error) {
    const failure = queryExecutionHttpError(error);
    if (failure) return NextResponse.json({ error: failure.error, code: failure.code }, { status: failure.status, headers: { "Cache-Control": "no-store" } });
    return apiError(error);
  }
}
