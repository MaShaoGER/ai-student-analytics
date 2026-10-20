import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import {
  parseGradeFile,
  previewGradeSheet,
  serializeGradeRows,
  validateGradeSheet,
} from "./grade-parser";
import type { GradeMapping } from "./grade-contract";
const mapping: GradeMapping = { id_student: 0, code_module: 1, code_presentation: 2, score: 3 };
const csv = (value: string) => parseGradeFile(new TextEncoder().encode(value), "成绩.csv");
function xlsx(sheet: string, styles = "") {
  const entries: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    ),
    "xl/workbook.xml": strToU8(
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="成绩" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ),
    "xl/worksheets/sheet1.xml": strToU8(
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' +
        sheet +
        "</sheetData></worksheet>",
    ),
  };
  if (styles) entries["xl/styles.xml"] = strToU8(styles);
  return zipSync(entries);
}
describe("bounded grade parsing and validation", () => {
  it("reads BOM, escaped quotes and quoted commas without losing identifiers", async () => {
    const book = await csv(
      '\uFEFF学号,课程,学期,成绩,备注\r\n001,"课程,甲",2026A,0,"包含""引号""\n两行"\r\n01,"课程,甲",2026A,100,\r\n1,"课程,甲",2026A,缺考,',
    );
    expect(previewGradeSheet(book, 0, 1).suggestedMapping).toEqual(mapping);
    const { summary, rows } = validateGradeSheet(book, 0, 1, mapping);
    expect(summary).toMatchObject({
      valid: true,
      studentCount: 3,
      rowCount: 3,
      missingScores: 1,
      hasCompletion: false,
    });
    expect(rows.map((r) => r.id_student)).toEqual(["001", "01", "1"]);
    expect(rows.map((r) => r.score)).toEqual([0, 100, null]);
    const roundtrip = await csv(serializeGradeRows(rows));
    expect(validateGradeSheet(roundtrip, 0, 1, mapping).rows).toEqual(rows);
  });
  it("retains physical row numbers after selecting later header", async () => {
    const book = await csv(
      "说明\n学号,课程,学期,成绩\n001,课程甲,2026A,80\n001,课程甲,2026A,90\n002,课程甲,2026A,101\n",
    );
    const { summary } = validateGradeSheet(book, 0, 2, mapping);
    expect(summary.valid).toBe(false);
    expect(summary.issues.map((i) => [i.row, i.code])).toEqual([
      [4, "DUPLICATE_RECORD"],
      [5, "INVALID_SCORE"],
    ]);
  });
  it("rejects malformed, invalid encoding, overlong cells and invalid completion", async () => {
    await expect(csv('学号,课程\n"001,课程')).rejects.toMatchObject({
      code: "INVALID_IMPORT_FILE",
    });
    await expect(csv("a\n" + "x".repeat(201))).rejects.toMatchObject({
      code: "INVALID_IMPORT_FILE",
    });
    await expect(parseGradeFile(new Uint8Array([0xff, 0xfe, 0xff]), "g.csv")).rejects.toMatchObject(
      { code: "INVALID_IMPORT_FILE" },
    );
    await expect(
      parseGradeFile(new Uint8Array(5 * 1024 * 1024 + 1), "g.csv"),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT_FILE" });
    const book = await csv("学号,课程,学期,成绩,完成状态\n001,课程甲,2026A,80,\n");
    expect(validateGradeSheet(book, 0, 1, { ...mapping, completed: 4 }).summary.valid).toBe(false);
    expect(() => validateGradeSheet(book, 0, 1, { ...mapping, score: 0 })).toThrow();
  });
  it("reads XLSX text and formatted numeric identifiers with leading zeros", async () => {
    const row =
      '<row r="1"><c r="A1" t="inlineStr"><is><t>学号</t></is></c><c r="B1" t="inlineStr"><is><t>课程</t></is></c><c r="C1" t="inlineStr"><is><t>学期</t></is></c><c r="D1" t="inlineStr"><is><t>成绩</t></is></c></row><row r="2"><c r="A2" s="1"><v>1</v></c><c r="B2" t="inlineStr"><is><t>课程甲</t></is></c><c r="C2" t="inlineStr"><is><t>2026A</t></is></c><c r="D2"><v>89.25</v></c></row>';
    const styles =
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="000"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>';
    const book = await parseGradeFile(xlsx(row, styles), "grade.xlsx");
    expect(book.sheets[0].name).toBe("成绩");
    expect(validateGradeSheet(book, 0, 1, mapping).rows).toEqual([
      {
        id_student: "001",
        code_module: "课程甲",
        code_presentation: "2026A",
        score: 89.25,
        completed: null,
      },
    ]);
  });
  it("rejects formulas, sparse giant sheets and excessive ZIP expansion before spreadsheet parsing", async () => {
    await expect(
      parseGradeFile(xlsx('<row r="1"><c r="A1"><f>1+2</f><v>3</v></c></row>'), "g.xlsx"),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT_FILE" });
    await expect(
      parseGradeFile(xlsx('<row r="999999"><c r="A999999"><v>1</v></c></row>'), "g.xlsx"),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT_FILE" });
    await expect(
      parseGradeFile(xlsx('<row r="999999"><c r="A1"><v>1</v></c></row>'), "g.xlsx"),
    ).rejects.toMatchObject({ code: "INVALID_IMPORT_FILE" });
    const bomb = zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(13 * 1024 * 1024) });
    await expect(parseGradeFile(bomb, "g.xlsx")).rejects.toMatchObject({
      code: "INVALID_IMPORT_FILE",
    });
  });
});
