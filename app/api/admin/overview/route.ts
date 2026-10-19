import { apiError, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { getAdminOverview, overviewWindowSchema } from "@/lib/admin/overview";
import { AuthError } from "@/lib/auth/service";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some((key) => key !== "window") || params.getAll("window").length > 1)
      throw new AuthError(400, "INVALID_QUERY", "概览时间窗参数不合法。");
    return noStoreJson(getAdminOverview(overviewWindowSchema.parse(params.get("window") ?? "7d")));
  } catch (error) {
    return apiError(error);
  }
}
