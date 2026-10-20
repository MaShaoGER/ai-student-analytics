import { apiError, assertSameOrigin, noStoreJson, requireAdmin } from "@/lib/auth/http";
import { AuthError } from "@/lib/auth/service";
import { GRADE_LIMITS } from "@/lib/datasets/grade-contract";
import { parseGradeFile } from "@/lib/datasets/grade-parser";
import { createGradeDraft, deleteGradeDraft } from "@/lib/datasets/grade-store";
import { REQUEST_TOO_LARGE_CODE, readJsonBody } from "@/lib/security/request-body";
import { deleteRequestSchema, enforceImportRateLimit } from "./route-utils";

export const runtime = "nodejs";

const CSV_TYPES = new Set(["text/csv", "application/csv"]);
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function invalidFile(message: string): never {
  throw new AuthError(400, "INVALID_IMPORT_FILE", message);
}

function decodedFilename(request: Request): string {
  const encoded = request.headers.get("x-file-name");
  if (!encoded || encoded.length > 1024) invalidFile("缺少有效的文件名。");
  let filename: string;
  try {
    filename = decodeURIComponent(encoded!);
  } catch {
    invalidFile("文件名编码格式不正确。");
  }
  if (
    !filename ||
    filename.length > 255 ||
    /[\u0000-\u001f\u007f/\\]/.test(filename) ||
    filename === "." ||
    filename === ".." ||
    !/\.(?:csv|xlsx)$/i.test(filename)
  )
    invalidFile("文件名不安全或文件类型不受支持。");
  return filename;
}

function mediaType(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

function declaredLength(request: Request): number | undefined {
  const value = request.headers.get("content-length");
  if (value === null) return undefined;
  if (!/^\d+$/.test(value)) invalidFile("文件长度无效。");
  const length = Number(value);
  if (!Number.isSafeInteger(length)) invalidFile("文件长度无效。");
  return length;
}

async function readUpload(request: Request): Promise<Uint8Array> {
  const length = declaredLength(request);
  if (length !== undefined && length > GRADE_LIMITS.maxBytes) {
    await request.body?.cancel().catch(() => undefined);
    throw new AuthError(413, REQUEST_TOO_LARGE_CODE, "文件不能超过 5 MiB。");
  }
  if (!request.body) invalidFile("请选择非空文件。");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > GRADE_LIMITS.maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AuthError(413, REQUEST_TOO_LARGE_CODE, "文件不能超过 5 MiB。");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (received === 0) invalidFile("请选择非空文件。");
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin(request);
    enforceImportRateLimit("upload", actor.id);
    const filename = decodedFilename(request);
    const type = mediaType(request);
    if (/\.csv$/i.test(filename)) {
      if (!CSV_TYPES.has(type)) invalidFile("CSV 文件的 Content-Type 必须为 text/csv。");
    } else if (type !== XLSX_TYPE) {
      invalidFile("XLSX 文件的 Content-Type 必须为标准 XLSX 类型。");
    }
    const bytes = await readUpload(request);
    const workbook = await parseGradeFile(bytes, filename);
    return noStoreJson({ draft: createGradeDraft(actor.id, workbook) });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireAdmin(request);
    enforceImportRateLimit("delete", actor.id);
    const { draftId } = deleteRequestSchema.parse(
      await readJsonBody(request, { maxBytes: 4 * 1024 }),
    );
    deleteGradeDraft(actor.id, draftId);
    return noStoreJson({ success: true });
  } catch (error) {
    return apiError(error);
  }
}
