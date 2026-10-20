import { beforeAll, describe, expect, it } from "vitest";
import { zipSync, strToU8 } from "fflate";
const integration = process.env.API_INTEGRATION === "1" ? describe : describe.skip;
const base = process.env.API_BASE_URL || "http://localhost:3100";
let admin = "";
async function api(route: string, body?: unknown, cookie = admin, method = body ? "POST" : "GET") {
  return fetch(base + route, {
    method,
    headers: { origin: base, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function signIn(username: string, password: string) {
  const response = await api("/api/auth/login", { username, password }, "");
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
async function upload(text: string, cookie = admin) {
  return fetch(base + "/api/admin/imports", {
    method: "POST",
    headers: {
      origin: base,
      cookie,
      "content-type": "text/csv",
      "x-file-name": encodeURIComponent("成绩测试.csv"),
    },
    body: text,
  });
}
integration("grade import to authorized analysis over HTTP", () => {
  beforeAll(async () => {
    admin = await signIn(process.env.API_TEST_USERNAME!, process.env.API_TEST_PASSWORD!);
  }, 30000);
  it("publishes mapped grades, preserves identifiers/privacy and versions, grants access and blocks missing capabilities", async () => {
    const unauthorized = await upload("学生编号,课程,学期,成绩\n001,课程,学期,80", "");
    expect(unauthorized.status).toBe(401);
    const contents =
      "学生编号,课程,学期,成绩\n001,课程甲,2026A,0\n01,课程甲,2026A,60\n1,课程甲,2026A,90\n002,课程甲,2026A,缺考\n003,课程乙,2026A,80\n004,课程乙,2026A,90\n";
    const uploaded = await upload(contents);
    expect(uploaded.status).toBeLessThan(300);
    const { draft } = await uploaded.json();
    const selection = {
      draftId: draft.id,
      sheet: 0,
      headerRow: 1,
      mapping: { id_student: 0, code_module: 1, code_presentation: 2, score: 3 },
    };
    const checked = await api("/api/admin/imports/validation", selection);
    expect(checked.status).toBe(200);
    const { validation } = await checked.json();
    expect(validation).toMatchObject({
      valid: true,
      rowCount: 6,
      studentCount: 6,
      missingScores: 1,
      hasCompletion: false,
    });
    const publication = { ...selection, name: "HTTP导入成绩" };
    const response = await api("/api/admin/imports/publications", publication);
    expect(response.status).toBeLessThan(300);
    const { dataset } = await response.json();
    const retry = await api("/api/admin/imports/publications", publication);
    expect((await retry.json()).dataset.id).toBe(dataset.id);
    const plan = {
      version: 1,
      datasetId: dataset.id,
      metric: "score",
      aggregation: "avg",
      dimensions: ["course"],
      filters: [],
      sort: { by: "value", direction: "desc" },
      limit: 20,
      chartType: "bar",
    };
    const resultResponse = await api("/api/analysis", plan);
    expect(resultResponse.status).toBe(200);
    const { result } = await resultResponse.json();
    expect(result).toMatchObject({
      datasetId: dataset.id,
      datasetVersion: dataset.currentVersion,
      rows: [{ dimension: "课程甲", value: 50, sampleSize: 3 }],
      filteredOutGroupCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain('"id_student":');
    for (const [metric, aggregation] of [
      ["activity", "sum"],
      ["completion_rate", "rate"],
    ]) {
      const unavailable = await api("/api/analysis", { ...plan, metric, aggregation });
      expect(unavailable.status).toBe(422);
      expect((await unavailable.json()).code).toBe("UNSUPPORTED_METRIC");
    }
    const chatResponse = await api("/api/chat", {
      datasetId: dataset.id,
      question: "比较各课程平均成绩。",
      history: [],
    });
    expect(chatResponse.status).toBe(200);
    const chat = await chatResponse.json();
    expect(chat.artifact.result).toMatchObject({
      datasetVersion: dataset.currentVersion,
      rows: [{ dimension: "课程甲", value: 50, sampleSize: 3 }],
    });
    expect(
      chat.resultRefs.every(
        (ref: { datasetVersion: string }) => ref.datasetVersion === dataset.currentVersion,
      ),
    ).toBe(true);
    const distribution = await api(`/api/score-distribution?datasetId=${dataset.id}`);
    expect(distribution.status).toBe(200);
    expect(JSON.stringify(await distribution.json())).not.toContain('"id_student":');
    const profile = await (await api("/api/profile")).json();
    expect(profile.datasets.find((d: { id: string }) => d.id === dataset.id)).toMatchObject({
      datasetVersion: dataset.currentVersion,
      metrics: ["score"],
    });
    const secret = "Import-Fixture-Password-2026!";
    const username = `grade.verify.${Math.random().toString(36).slice(2, 9)}`;
    const created = await api("/api/admin/users", {
      username,
      displayName: "成绩权限验收",
      password: secret,
      role: "user",
      datasetIds: [],
    });
    expect(created.status).toBe(201);
    const { user } = await created.json();
    let cookie = await signIn(username, secret);
    const changed = await api(
      "/api/auth/password",
      { currentPassword: secret, newPassword: secret + "Changed" },
      cookie,
    );
    expect(changed.status).toBe(200);
    cookie = await signIn(username, secret + "Changed");
    expect((await api("/api/analysis", plan, cookie)).status).toBe(403);
    expect(
      (await api("/api/admin/users", { id: user.id, datasetIds: [dataset.id] }, admin, "PATCH"))
        .status,
    ).toBe(200);
    expect((await api("/api/analysis", plan, cookie)).status).toBe(200);
    expect((await upload(contents, cookie)).status).toBe(403);
    const newer = await (await upload(contents.replace(",90", ",60"))).json();
    const newerSelection = { ...selection, draftId: newer.draft.id };
    const versionResponse = await api("/api/admin/imports/publications", {
      ...newerSelection,
      name: dataset.name,
      datasetId: dataset.id,
      baseVersion: dataset.currentVersion,
    });
    expect(versionResponse.status).toBeLessThan(300);
    const versioned = (await versionResponse.json()).dataset;
    expect(versioned.currentVersion).not.toBe(dataset.currentVersion);
    const updated = (await (await api("/api/analysis", plan, cookie)).json()).result;
    expect(updated.datasetVersion).toBe(versioned.currentVersion);
    expect(result.datasetVersion).toBe(dataset.currentVersion);
    const stale = await (await upload(contents)).json();
    expect(
      (
        await api("/api/admin/imports/publications", {
          ...selection,
          draftId: stale.draft.id,
          name: dataset.name,
          datasetId: dataset.id,
          baseVersion: dataset.currentVersion,
        })
      ).status,
    ).toBe(409);
    expect(
      (await api("/api/admin/datasets", { id: dataset.id, enabled: false }, admin, "PATCH")).status,
    ).toBe(200);
    expect((await api("/api/analysis", plan, cookie)).status).toBe(403);
  }, 60000);
  it("rejects duplicate records and wrong origin without publishing", async () => {
    const text = "学号,课程,学期,成绩\n001,课程甲,2026A,80\n001,课程甲,2026A,90\n";
    const { draft } = await (await upload(text)).json();
    const body = {
      draftId: draft.id,
      sheet: 0,
      headerRow: 1,
      mapping: { id_student: 0, code_module: 1, code_presentation: 2, score: 3 },
      name: "拒绝重复记录",
    };
    const { name: _name, ...selection } = body;
    const validation = await (await api("/api/admin/imports/validation", selection)).json();
    expect(validation.validation.valid).toBe(false);
    expect((await api("/api/admin/imports/publications", body)).status).toBeGreaterThanOrEqual(400);
    const response = await fetch(base + "/api/admin/imports", {
      method: "POST",
      headers: {
        origin: "https://example.invalid",
        cookie: admin,
        "x-file-name": "grades.csv",
        "content-type": "text/csv",
      },
      body: text,
    });
    expect(response.status).toBe(403);
  });
});

function excelFixture(formula = false): Uint8Array {
  const textCell = (ref: string, text: string) =>
    `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const header =
    '<row r="1">' +
    ["学号", "课程", "学期", "成绩"]
      .map((text, i) => textCell(String.fromCharCode(65 + i) + "1", text))
      .join("") +
    "</row>";
  const rows = ["001", "01", "1"]
    .map((id, i) => {
      const r = i + 2;
      return `<row r="${r}">${textCell("A" + r, id)}${textCell("B" + r, "课程甲")}${textCell("C" + r, "2026A")}<c r="D${r}">${formula && i === 0 ? "<f>1+2</f>" : ""}<v>${[0, 60, 90][i]}</v></c></row>`;
    })
    .join("");
  return zipSync({
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
        header +
        rows +
        "</sheetData></worksheet>",
    ),
  });
}
integration("Excel file import over HTTP", () => {
  beforeAll(async () => {
    admin = await signIn(process.env.API_TEST_USERNAME!, process.env.API_TEST_PASSWORD!);
  });
  it("publishes a binary XLSX and rejects formula cells before creating a draft", async () => {
    const uploadExcel = (formula = false) =>
      fetch(base + "/api/admin/imports", {
        method: "POST",
        headers: {
          origin: base,
          cookie: admin,
          "x-file-name": encodeURIComponent("教务成绩.xlsx"),
          "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        body: new Blob([excelFixture(formula).slice().buffer as ArrayBuffer]),
      });
    const response = await uploadExcel();
    expect(response.status).toBe(200);
    const { draft } = await response.json();
    const preview = await (
      await api("/api/admin/imports/preview", { draftId: draft.id, sheet: 0, headerRow: 1 })
    ).json();
    const publication = await api("/api/admin/imports/publications", {
      draftId: draft.id,
      sheet: 0,
      headerRow: 1,
      mapping: preview.selection.suggestedMapping,
      name: "Excel成绩验收",
    });
    expect(publication.status).toBe(200);
    const { dataset } = await publication.json();
    const result = await (
      await api("/api/analysis", {
        version: 1,
        datasetId: dataset.id,
        metric: "score",
        aggregation: "avg",
        dimensions: ["course"],
        filters: [],
        chartType: "bar",
      })
    ).json();
    expect(result.result.rows).toEqual([{ dimension: "课程甲", value: 50, sampleSize: 3 }]);
    expect((await uploadExcel(true)).status).toBe(400);
  });
});
