import type { DataSource } from "./types";

export type StudioChartType = "sankey" | "boxplot" | "heatmap" | "density" | "dumbbell";
export type StudioRelationshipMetric = "activity" | "attendance" | "absence" | "unexcused";
export type StudioRow = Record<string, string | number | null>;
export type StudioTable = {
  columns: string[];
  rows: StudioRow[];
  description: string;
  sortChange?: "asc" | "desc";
};
export type StudioProjectData = {
  datasetId: DataSource;
  terms: string[];
  courses: string[];
  term: string | null;
  course: string;
  tables: Partial<Record<StudioChartType, StudioTable>>;
};
export type StudioFields = Record<string, string>;
export const STUDIO_CHARTS: { value: StudioChartType; label: string; description: string }[] = [
  { value: "sankey", label: "桑基图", description: "用连接带宽度比较不同分类路径的数量。" },
  { value: "boxplot", label: "箱线图", description: "比较各组中位数、分布区间与离散程度。" },
  {
    value: "heatmap",
    label: "学习节奏热力图",
    description: "用颜色观察不同学科在各周的学习节奏。",
  },
  { value: "density", label: "散点密度图", description: "观察两个数值指标的分布与聚集区域。" },
  {
    value: "dumbbell",
    label: "学期对比哑铃图",
    description: "连接两组数值，直接比较差异方向与幅度。",
  },
];
export const STUDIO_FIELD_ROLES: Record<
  StudioChartType,
  { key: string; label: string; optional?: boolean }[]
> = {
  sankey: [
    { key: "stage1", label: "第一层分类" },
    { key: "stage2", label: "第二层分类" },
    { key: "stage3", label: "第三层分类", optional: true },
    { key: "weight", label: "数量", optional: true },
  ],
  boxplot: [
    { key: "category", label: "分组" },
    { key: "value", label: "原始数值", optional: true },
  ],
  heatmap: [
    { key: "x", label: "横轴" },
    { key: "y", label: "纵轴" },
    { key: "value", label: "颜色数值" },
  ],
  density: [
    { key: "x", label: "横轴数值" },
    { key: "y", label: "纵轴数值" },
    { key: "weight", label: "频数", optional: true },
  ],
  dumbbell: [
    { key: "category", label: "分组" },
    { key: "before", label: "前期数值" },
    { key: "after", label: "后期数值" },
  ],
};

export function numeric(value: unknown): number | null {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** A bounded CSV/TSV reader, including quoted separators, line breaks and doubled quotes. */
export function parseStudioInput(text: string): StudioTable {
  if (text.length > 1_000_000) throw new Error("请使用 1 MB 以内的数据，最多 20,000 行。");
  const source = text.replace(/^\uFEFF/u, "").trim();
  if (!source) throw new Error("粘贴数据或选择文件后，图表会自动生成。");
  if (source.startsWith("[") || source.startsWith("{")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error('JSON 尚未完整，请输入对象数组，例如 [{"课程":"数学","成绩":80}]。');
    }
    const values = Array.isArray(parsed) ? parsed : (parsed as { rows?: unknown })?.rows;
    if (!Array.isArray(values) || !values.length)
      throw new Error("JSON 需要是非空对象数组，或包含 rows 数组的对象。");
    if (values.length > 20_000) throw new Error("最多支持 20,000 行，请先汇总数据。");
    const columns = new Set<string>();
    const rows = values.map((row: unknown) => {
      if (!row || typeof row !== "object" || Array.isArray(row))
        throw new Error("JSON 中每一行都需要是一个对象。");
      const entries = Object.entries(row).map(([key, value]) => {
        columns.add(key);
        if (value !== null && typeof value !== "string" && typeof value !== "number")
          throw new Error("字段值请使用文本、数字或 null，不支持嵌套对象。");
        return [key, value] as const;
      });
      return Object.fromEntries(entries) as StudioRow;
    });
    if (columns.size < 2 || columns.size > 30 || [...columns].some((key) => !key.trim()))
      throw new Error("请使用不超过 30 个非空字段名。");
    return { columns: [...columns], rows, description: "自定义 JSON 数据 · 当前浏览器内处理" };
  }
  const firstLine = source.split(/\r?\n/u)[0];
  const delimiter = firstLine.includes("\t") ? "\t" : firstLine.includes(",") ? "," : ";";
  const records: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const pushRow = () => {
    row.push(cell.trim());
    cell = "";
    if (row.some((value) => value !== "")) records.push(row);
    row = [];
    if (records.length > 20_001) throw new Error("最多支持 20,000 行，请先汇总数据。");
  };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '"') {
      if (quoted && source[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || !cell.trim()) quoted = !quoted;
      else cell += c;
    } else if (c === delimiter && !quoted) {
      row.push(cell.trim());
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      pushRow();
      if (c === "\r" && source[i + 1] === "\n") i++;
    } else cell += c;
  }
  if (quoted) throw new Error("引号尚未闭合，请补全数据。");
  pushRow();
  const columns = records.shift() ?? [];
  if (
    columns.length < 2 ||
    columns.length > 30 ||
    columns.some((key) => !key) ||
    new Set(columns).size !== columns.length
  )
    throw new Error("第一行需要 2–30 个不重复的字段名。");
  if (!records.length) throw new Error("字段名下方还需要至少一行数据。");
  if (records.some((record) => record.length !== columns.length))
    throw new Error("有数据行的列数与第一行不一致，请检查分隔符或引号。");
  return {
    columns,
    rows: records.map((record) =>
      Object.fromEntries(columns.map((key, i) => [key, record[i] || null])),
    ),
    description: "自定义表格数据 · 当前浏览器内处理",
  };
}

export function studioCsv(table: StudioTable) {
  const quote = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    table.columns.map(quote).join(","),
    ...table.rows.map((row) => table.columns.map((key) => quote(row[key])).join(",")),
  ].join("\n");
}

export function defaultStudioFields(type: StudioChartType, table: StudioTable): StudioFields {
  const c = table.columns;
  const match = (pattern: RegExp, fallback = "") => c.find((key) => pattern.test(key)) ?? fallback;
  const numberColumns = c.filter((key) => table.rows.some((row) => numeric(row[key]) !== null));
  const weight = match(/^(数量|人数|人次|频数|count|weight|frequency)$/iu);
  if (type === "sankey") {
    const stages = c.filter((key) => key !== weight);
    return { stage1: stages[0] ?? "", stage2: stages[1] ?? "", stage3: stages[2] ?? "", weight };
  }
  if (type === "boxplot")
    return { category: c[0] ?? "", value: match(/^(成绩|数值|score|value)$/iu, numberColumns[0]) };
  if (type === "heatmap")
    return {
      x: c[0] ?? "",
      y: c[1] ?? "",
      value: match(
        /人均|活动量|数值|value/iu,
        numberColumns.find((key) => key !== c[0] && key !== c[1]),
      ),
    };
  if (type === "density") return { x: numberColumns[0] ?? "", y: numberColumns[1] ?? "", weight };
  return {
    category: c[0] ?? "",
    before: match(/前期|before/iu, numberColumns[0]),
    after: match(/后期|after/iu, numberColumns[1]),
  };
}

export function studioQuantile(sorted: number[], p: number) {
  const i = (sorted.length - 1) * p;
  return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
}
