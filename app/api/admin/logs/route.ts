import { apiError, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { AdminLogQueryError, parseAdminLogQuery, queryAdminLogs } from "@/lib/admin/logs";
import { AuthError } from "@/lib/auth/service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return noStoreJson(queryAdminLogs(parseAdminLogQuery(new URL(request.url).searchParams)));
  } catch (error) {
    return apiError(
      error instanceof AdminLogQueryError ? new AuthError(400, error.code, error.message) : error,
    );
  }
}
