import { apiError, requireAdmin } from "@/lib/auth/http";
import { enforceImportRateLimit } from "../route-utils";

export const runtime = "nodejs";

const TEMPLATE = [
  "id_student,code_module,code_presentation,score,completed",
  "001,课程甲,2026A,88,1",
  "002,课程甲,2026A,76,1",
  "003,课程甲,2026A,60,0",
  "004,课程甲,2026A,,0",
  "",
].join("\r\n");

export async function GET(request: Request) {
  try {
    const actor = await requireAdmin(request);
    enforceImportRateLimit("template", actor.id);
    return new Response("\uFEFF" + TEMPLATE, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="grade-template.csv"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
