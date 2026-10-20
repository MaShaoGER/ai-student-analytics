import readXlsxFile from "read-excel-file/universal";
import { unzipSync } from "fflate";
import { AuthError } from "../auth/service";
import {
  GRADE_FIELDS,
  GRADE_LIMITS as L,
  type GradeField,
  type GradeMapping,
  type GradeRow,
  type GradeSheetPreview,
  type GradeValidation,
  type GradeWorkbook,
} from "./grade-contract";
function fail(message: string): never {
  throw new AuthError(400, "INVALID_IMPORT_FILE", message);
}
const decoder = () => new TextDecoder("utf-8", { fatal: true });
function checkWorkbook(book: GradeWorkbook): GradeWorkbook {
  if (!book.sheets.length || book.sheets.length > L.maxSheets) fail("文件必须包含1至10个工作表。");
  let rows = 0;
  for (const sheet of book.sheets) {
    rows += sheet.rows.length;
    if (sheet.name.length > 200) fail("工作表名称过长。");
    for (const row of sheet.rows) {
      if (row.length > L.maxColumns) fail("文件最多支持50列。");
      if (row.some((cell) => cell.length > L.maxCellLength))
        fail("单元格内容超过200字符，请先整理文件。");
    }
  }
  if (rows > L.maxRows + L.maxSheets) fail("文件总行数超过50,000条数据行的限制。");
  return book;
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    if (cell.length > L.maxCellLength) fail("单元格内容超过200字符。");
    row.push(cell);
    cell = "";
    closed = false;
    if (row.length > L.maxColumns) fail("文件最多支持50列。");
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > L.maxRows + 1) fail("文件超过50,000条数据行。");
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += ch;
    } else if (ch === '"') {
      if (cell || closed) fail("CSV 引号格式不正确。");
      quoted = true;
    } else if (ch === ",") pushCell();
    else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else {
      if (closed) fail("CSV 引号后只能出现分隔符或换行。");
      cell += ch;
    }
    if (cell.length > L.maxCellLength) fail("单元格内容超过200字符。");
  }
  if (quoted) fail("CSV 包含未闭合的引号。");
  if (cell || row.length || closed) pushRow();
  return rows;
}
function columnNumber(letters: string): number {
  let n = 0;
  for (const c of letters) n = n * 26 + c.charCodeAt(0) - 64;
  return n;
}
/** Inspect central directory before allocating any uncompressed XML or dense sheet. */
function unpackChecked(bytes: Uint8Array): Record<string, Uint8Array> {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--)
    if (v.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) fail("Excel 文件损坏或不是标准 XLSX。");
  const entries = v.getUint16(end + 10, true),
    offset = v.getUint32(end + 16, true);
  if (
    entries > 200 ||
    v.getUint16(end + 4, true) !== 0 ||
    v.getUint16(end + 6, true) !== 0 ||
    entries === 0
  )
    fail("Excel 压缩结构超出限制。");
  let pos = offset,
    total = 0;
  for (let i = 0; i < entries; i++) {
    if (pos + 46 > bytes.length || v.getUint32(pos, true) !== 0x02014b50)
      fail("Excel 压缩目录损坏。");
    const flags = v.getUint16(pos + 8, true),
      size = v.getUint32(pos + 24, true),
      compressed = v.getUint32(pos + 20, true);
    const nameLength = v.getUint16(pos + 28, true),
      extra = v.getUint16(pos + 30, true),
      comment = v.getUint16(pos + 32, true);
    if (pos + 46 + nameLength + extra + comment > bytes.length) fail("Excel 压缩目录损坏。");
    const name = decoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    total += size;
    if (
      flags & 1 ||
      size > 12 * 1024 * 1024 ||
      total > 24 * 1024 * 1024 ||
      size > Math.max(1024 * 1024, compressed * 300) ||
      /[\\]|(?:^|\/)\.\.(?:\/|$)/.test(name)
    )
      fail("Excel 展开体积或压缩结构超出限制。");
    if (/vbaProject|externalLinks|embeddings|\.bin$/i.test(name))
      fail("不支持含宏、嵌入对象或外部数据链接的工作簿。");
    pos += 46 + nameLength + extra + comment;
  }
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    fail("Excel 文件无法解压。");
  }
  let actualTotal = 0,
    cells = 0;
  for (const [name, data] of Object.entries(files!)) {
    actualTotal += data.length;
    if (actualTotal > 24 * 1024 * 1024) fail("Excel 展开体积超过限制。");
    if (!/\.(xml|rels)$/.test(name)) continue;
    const xml = decoder().decode(data);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) fail("Excel 包含不支持的 XML 声明。");
    if (/TargetMode\s*=\s*["']External["']/i.test(xml)) fail("不支持外部链接。");
    if (
      name === "xl/workbook.xml" &&
      (xml.match(/<(?:\w+:)?sheet(?:\s|>)/g) || []).length > L.maxSheets
    )
      fail("Excel 最多支持10个工作表。");
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(name)) continue;
    for (const row of xml.matchAll(/<(?:\w+:)?row\b([^>]+)>/g)) {
      const number = row[1].match(/\br\s*=\s*["'](\d+)["']/)?.[1];
      if (
        number &&
        (!Number.isSafeInteger(Number(number)) ||
          Number(number) < 1 ||
          Number(number) > L.maxRows + 1)
      )
        fail("Excel 工作表行列超出限制。");
    }
    if (/<(?:\w+:)?(?:f|mergeCell)(?:\s|>|\/)/.test(xml))
      fail("请先将公式转换为数值并取消合并单元格，再导入。");
    for (const match of xml.matchAll(/\br\s*=\s*["']([A-Z]+)(\d+)["']/g)) {
      if (columnNumber(match[1]) > L.maxColumns || Number(match[2]) > L.maxRows + 1)
        fail("Excel 工作表行列超出限制。");
    }
    cells += (xml.match(/<(?:\w+:)?c(?:\s|>)/g) || []).length;
    if (cells > 300000) fail("Excel 有效单元格总量超过限制，请拆分文件。");
  }
  return files!;
}
export async function parseGradeFile(bytes: Uint8Array, filename: string): Promise<GradeWorkbook> {
  if (bytes.length === 0 || bytes.length > L.maxBytes) fail("请选择5 MiB以内的非空文件。");
  if (/\.csv$/i.test(filename)) {
    let text: string;
    try {
      text = decoder().decode(bytes);
    } catch {
      fail("CSV 必须为 UTF-8 编码，请在表格软件中另存为 UTF-8 CSV。");
    }
    if (text!.includes("\u0000")) fail("CSV 包含无效字符。");
    return checkWorkbook({
      sheets: [{ name: "CSV", rows: parseCsv(text!.replace(/^\uFEFF/, "")) }],
    });
  }
  if (!/\.xlsx$/i.test(filename)) fail("仅支持 .xlsx 和 UTF-8 .csv 文件。");
  const files = unpackChecked(bytes);
  try {
    const sheets = await readXlsxFile(bytes.slice().buffer as ArrayBuffer, {
      trim: false,
      parseNumber: (value: string) => value,
    });
    // Numeric identifiers with explicit zero-padding formats retain their displayed zeros.
    const styles = files["xl/styles.xml"] ? decoder().decode(files["xl/styles.xml"]) : "";
    const formats = new Map<string, number>();
    for (const m of styles.matchAll(/<numFmt\b([^>]+)\/?\s*>/g)) {
      const id = m[1].match(/numFmtId="(\d+)"/)?.[1],
        format = m[1].match(/formatCode="([^"]+)"/)?.[1];
      if (id && format && /^0{2,20}$/.test(format)) formats.set(id, format.length);
    }
    const xfs = styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] ?? "";
    const pads = [...xfs.matchAll(/<xf\b([^>]*?)(?:\/>|>)/g)].map((m) =>
      formats.get(m[1].match(/numFmtId="(\d+)"/)?.[1] ?? ""),
    );
    const sheetXml = Object.entries(files).filter(([name]) =>
      /^xl\/worksheets\/[^/]+\.xml$/.test(name),
    );
    // Standard workbooks use workbook relationship order. Resolve file through its relationship id.
    const workbook = decoder().decode(files["xl/workbook.xml"]);
    const rels = decoder().decode(files["xl/_rels/workbook.xml.rels"]);
    const targets = new Map(
      [...rels.matchAll(/<Relationship\b([^>]+)>/g)].map((m) => [
        m[1].match(/\bId="([^"]+)"/)?.[1],
        m[1].match(/\bTarget="([^"]+)"/)?.[1],
      ]),
    );
    const sheetIds = [...workbook.matchAll(/<sheet\b([^>]+)>/g)].map(
      (m) => m[1].match(/\br:id="([^"]+)"/)?.[1],
    );
    const result: GradeWorkbook = {
      sheets: sheets.map((s) => ({
        name: s.sheet,
        rows: s.data.map((row) =>
          row.map((cell) =>
            cell == null ? "" : cell instanceof Date ? cell.toISOString() : String(cell),
          ),
        ),
      })),
    };
    for (let index = 0; index < result.sheets.length; index++) {
      const target = targets.get(sheetIds[index]);
      const file = target
        ? target.startsWith("/")
          ? target.slice(1)
          : "xl/" + target.replace(/^\.\//, "")
        : sheetXml[index]?.[0];
      const xml = file && files[file] ? decoder().decode(files[file]) : "";
      for (const m of xml.matchAll(/<c\b([^>]+)>([\s\S]*?)<\/c>/g)) {
        if (/\bt="(?:s|inlineStr|str|b|e)"/.test(m[1])) continue;
        const ref = m[1].match(/\br="([A-Z]+)(\d+)"/),
          style = Number(m[1].match(/\bs="(\d+)"/)?.[1] ?? 0),
          n = m[2].match(/<v>(\d+)<\/v>/)?.[1];
        if (ref && n && pads[style]) {
          const row = result.sheets[index].rows[Number(ref[2]) - 1];
          if (row) row[columnNumber(ref[1]) - 1] = n.padStart(pads[style]!, "0");
        }
      }
    }
    return checkWorkbook(result);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    fail("Excel 内容无法读取，请使用标准成绩模板或另存为 UTF-8 CSV。");
  }
}
const aliases: Record<GradeField, string[]> = {
  id_student: ["id_student", "学号", "学生编号", "学生id", "学生ID"],
  code_module: ["code_module", "课程", "课程代码", "课程名称", "科目"],
  code_presentation: ["code_presentation", "学期", "开课期", "学期 / 场次"],
  score: ["score", "成绩", "分数", "期末分数", "期末成绩"],
  completed: ["completed", "完成状态", "课程完成状态", "完成标记", "是否完成"],
};
export function previewGradeSheet(
  book: GradeWorkbook,
  sheet: number,
  headerRow: number,
): GradeSheetPreview {
  if (
    !Number.isInteger(sheet) ||
    !book.sheets[sheet] ||
    !Number.isInteger(headerRow) ||
    headerRow < 1 ||
    headerRow > book.sheets[sheet].rows.length
  )
    fail("请选择有效的工作表与表头行。");
  const rows = book.sheets[sheet].rows,
    headers = rows[headerRow - 1];
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = Array.from(
    { length: width },
    (_, i) => headers[i]?.trim() || `未命名列 ${i + 1}`,
  );
  const mapping: GradeMapping = {};
  for (const field of GRADE_FIELDS) {
    const hits = normalized
      .map((h, i) => (aliases[field].some((a) => a.toLowerCase() === h.toLowerCase()) ? i : -1))
      .filter((i) => i >= 0);
    if (hits.length === 1) mapping[field] = hits[0];
  }
  return {
    sheet,
    headerRow,
    headers: normalized,
    preview: rows.slice(headerRow, headerRow + 10),
    suggestedMapping: mapping,
  };
}
export function validateGradeSheet(
  book: GradeWorkbook,
  sheet: number,
  headerRow: number,
  mapping: GradeMapping,
): { summary: GradeValidation; rows: GradeRow[] } {
  const preview = previewGradeSheet(book, sheet, headerRow),
    mapped = Object.entries(mapping);
  if (
    GRADE_FIELDS.slice(0, 4).some((f) => mapping[f] === undefined) ||
    mapped.some(
      ([key, value]) =>
        !GRADE_FIELDS.includes(key as GradeField) ||
        !Number.isInteger(value) ||
        value! < 0 ||
        value! >= preview.headers.length,
    ) ||
    new Set(mapped.map(([, v]) => v)).size !== mapped.length
  )
    fail("请为必需字段选择不同且有效的列。");
  const summary: GradeValidation = {
    valid: false,
    rowCount: 0,
    studentCount: 0,
    courseCount: 0,
    termCount: 0,
    missingScores: 0,
    hasCompletion: mapping.completed !== undefined,
    errorCount: 0,
    issues: [],
    preview: [],
  };
  const rows: GradeRow[] = [],
    ids = new Set<string>(),
    courses = new Set<string>(),
    terms = new Set<string>(),
    keys = new Set<string>();
  const issue = (row: number, field: string, code: string, message: string) => {
    summary.errorCount++;
    if (summary.issues.length < L.maxIssues) summary.issues.push({ row, field, code, message });
  };
  const source = book.sheets[sheet].rows;
  for (let i = headerRow; i < source.length; i++) {
    const raw = source[i];
    if (raw.every((cell) => !cell.trim())) continue;
    summary.rowCount++;
    const get = (field: GradeField) =>
      mapping[field] === undefined ? "" : (raw[mapping[field]!] ?? "").trim();
    const row: GradeRow = {
      id_student: get("id_student"),
      code_module: get("code_module"),
      code_presentation: get("code_presentation"),
      score: null,
      completed: null,
    };
    for (const field of ["id_student", "code_module", "code_presentation"] as const) {
      const value = row[field],
        max = field === "code_module" ? 100 : field === "code_presentation" ? 80 : 200;
      if (!value || value.length > max || /[\u0000-\u001f\u007f]/.test(value))
        issue(i + 1, field, "INVALID_LABEL", `该字段必填，且不可包含控制字符或超过${max}字符。`);
    }
    ids.add(row.id_student);
    courses.add(row.code_module);
    terms.add(row.code_presentation);
    const key = JSON.stringify([row.id_student, row.code_module, row.code_presentation]);
    if (keys.has(key))
      issue(
        i + 1,
        "id_student",
        "DUPLICATE_RECORD",
        "同一学生、课程和学期的记录重复，请先确定补考或重修口径。",
      );
    keys.add(key);
    const score = get("score");
    if (["", "缺考", "未录入"].includes(score)) summary.missingScores++;
    else if (!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(score) || Number(score) > 100)
      issue(
        i + 1,
        "score",
        "INVALID_SCORE",
        "成绩须为0–100的数字，最多两位小数；缺考或未录入请留空。",
      );
    else row.score = Number(score);
    if (mapping.completed !== undefined) {
      const value = get("completed");
      if (["1", "已完成", "完成", "true", "TRUE"].includes(value)) row.completed = 1;
      else if (["0", "未完成", "false", "FALSE"].includes(value)) row.completed = 0;
      else
        issue(
          i + 1,
          "completed",
          "INVALID_COMPLETION",
          "映射完成状态后，每行都须明确填写0/1、已完成或未完成。",
        );
    }
    rows.push(row);
  }
  if (!summary.rowCount) issue(headerRow, "score", "EMPTY_DATA", "表头后没有可导入的数据。");
  else if (rows.every((row) => row.score === null))
    issue(headerRow, "score", "NO_VALID_SCORE", "没有任何有效成绩，不能发布成绩数据集。");
  summary.studentCount = ids.size;
  summary.courseCount = courses.size;
  summary.termCount = terms.size;
  summary.valid = summary.errorCount === 0;
  summary.preview = rows.slice(0, 10);
  return { summary, rows };
}
export function serializeGradeRows(rows: GradeRow[]): string {
  const cell = (value: string | number | null) =>
    value === null ? "" : `"${String(value).replaceAll('"', '""')}"`;
  return (
    GRADE_FIELDS.join(",") +
    "\n" +
    rows.map((row) => GRADE_FIELDS.map((field) => cell(row[field])).join(",")).join("\n") +
    "\n"
  );
}
