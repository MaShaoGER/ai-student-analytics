import type { EChartsOption, SeriesOption } from "echarts";
import {
  numeric,
  studioQuantile,
  type StudioChartType,
  type StudioFields,
  type StudioTable,
} from "./chart-studio";

export type StudioColors = {
  text: string;
  muted: string;
  grid: string;
  surface: string;
  palette: string[];
};
export type StudioDetail = { label: string; detail: string };
export type BuiltStudioChart = {
  option: EChartsOption;
  details: StudioDetail[];
  summary: string;
  omitted: number;
};
const fmt = (value: number) => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });
const title = (value: unknown) => String(value ?? "").trim();
const sortLabels = (labels: string[]) =>
  labels.sort((a, b) => {
    const x = numeric(a),
      y = numeric(b);
    return x !== null && y !== null ? x - y : a.localeCompare(b, "zh-CN", { numeric: true });
  });

export function buildStudioChart(
  type: StudioChartType,
  table: StudioTable,
  fields: StudioFields,
  colors: StudioColors,
  options: {
    compact?: boolean;
    densityMode?: "density" | "scatter";
    aggregate?: "sum" | "mean";
  } = {},
): BuiltStudioChart {
  const details: StudioDetail[] = [];
  let omitted = 0;
  const option: EChartsOption = {
    animation: false,
    color: colors.palette,
    textStyle: { color: colors.text },
    tooltip: {
      trigger: "item",
      confine: true,
      renderMode: "richText",
      backgroundColor: colors.surface,
      borderColor: colors.grid,
      textStyle: { color: colors.text, fontSize: 12 },
      formatter: (params: unknown) => {
        const item = params as { name?: string; data?: { detail?: string } };
        return item.data?.detail ?? item.name ?? "";
      },
    },
    toolbox: {
      right: 4,
      top: 0,
      iconStyle: { borderColor: colors.muted },
      feature: {
        restore: { title: "还原视图" },
        saveAsImage: { title: "保存图表", pixelRatio: 2, backgroundColor: colors.surface },
      },
    },
    grid: { left: options.compact ? 48 : 64, right: 28, top: 48, bottom: 80, containLabel: true },
  };
  const axis = (name: string) => ({
    type: "value" as const,
    name,
    nameLocation: "middle" as const,
    nameGap: 36,
    nameTextStyle: { color: colors.muted },
    axisLabel: { color: colors.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: colors.grid } },
  });
  const category = (data: string[]) => ({
    type: "category" as const,
    data,
    axisLine: { lineStyle: { color: colors.grid } },
    axisLabel: {
      color: colors.text,
      fontSize: 12,
      width: options.compact ? 68 : 120,
      overflow: "truncate" as const,
    },
    axisTick: { show: false },
  });
  const required =
    type === "sankey"
      ? ["stage1", "stage2"]
      : type === "boxplot"
        ? ["category"]
        : type === "dumbbell"
          ? ["category", "before", "after"]
          : type === "heatmap"
            ? ["x", "y", "value"]
            : ["x", "y"];
  if (required.some((key) => !fields[key] || !table.columns.includes(fields[key])))
    throw new Error("请选择对应的数据字段，图表会自动更新。");

  if (type === "sankey") {
    const stages = [fields.stage1, fields.stage2, fields.stage3].filter(Boolean);
    if (new Set(stages).size !== stages.length) throw new Error("每一层请选择不同的分类字段。");
    const nodes = new Map<string, { name: string; depth: number; detail: string }>();
    const links = new Map<
      string,
      { source: string; target: string; value: number; detail: string }
    >();
    let total = 0;
    for (const row of table.rows) {
      const labels = stages.map((key) => title(row[key]));
      const weight = fields.weight ? numeric(row[fields.weight]) : 1;
      if (labels.some((label) => !label) || weight === null || weight <= 0) {
        omitted++;
        continue;
      }
      total += weight;
      labels.forEach((label, i) => {
        const id = `${i}::${label}`;
        nodes.set(id, { name: id, depth: i, detail: `${stages[i]}\n${label}` });
        if (!i) return;
        const source = `${i - 1}::${labels[i - 1]}`,
          key = JSON.stringify([source, id]);
        const link = links.get(key) ?? { source, target: id, value: 0, detail: "" };
        link.value += weight;
        link.detail = `${labels[i - 1]} → ${label}\n${fields.weight || "记录数"}：${fmt(link.value)}`;
        links.set(key, link);
      });
    }
    if (nodes.size > 80) throw new Error("分类超过 80 个，请先合并类别或筛选数据。");
    option.series = [
      {
        type: "sankey",
        left: options.compact ? 24 : 96,
        right: options.compact ? 24 : 96,
        top: 48,
        bottom: 20,
        orient: options.compact ? "vertical" : "horizontal",
        nodeWidth: 14,
        nodeGap: options.compact ? 18 : 24,
        draggable: true,
        layoutIterations: 32,
        label: {
          color: colors.text,
          fontSize: 12,
          position: options.compact ? "top" : "inside",
          formatter: (params: { name: string }) => {
            const label = params.name.split("::").slice(1).join("::");
            return options.compact ? (label.match(/.{1,5}/gu) ?? [label]).join("\n") : label;
          },
          textBorderColor: colors.surface,
          textBorderWidth: options.compact ? 0 : 3,
        },
        data: [...nodes.values()],
        links: [...links.values()],
        lineStyle: { color: "gradient", opacity: 0.36, curveness: 0.5 },
        emphasis: { focus: "adjacency" },
      },
    ];
    details.push(
      ...[...links.values()]
        .sort((a, b) => b.value - a.value)
        .map((link) => ({
          label: `${link.source.split("::").slice(1).join("::")} → ${link.target.split("::").slice(1).join("::")}`,
          detail: link.detail,
        })),
    );
    return {
      option,
      details,
      omitted,
      summary: `${nodes.size} 个分类节点 · ${links.size} 条连接 · ${fields.weight || "记录数"}合计 ${fmt(total)}`,
    };
  }

  if (type === "boxplot") {
    const summary = ["最小值", "下四分位数", "中位数", "上四分位数", "最大值"].every((key) =>
      table.columns.includes(key),
    );
    const groups = new Map<string, number[]>();
    const boxes: { name: string; value: number[]; detail: string }[] = [];
    const outliers: { value: number[]; detail: string }[] = [];
    if (summary) {
      for (const row of table.rows) {
        const name = title(row[fields.category]),
          values = ["最小值", "下四分位数", "中位数", "上四分位数", "最大值"].map((key) =>
            numeric(row[key]),
          );
        if (!name || values.some((value) => value === null)) {
          omitted++;
          continue;
        }
        const v = values as number[];
        if (v.some((value, i) => i > 0 && value < v[i - 1]))
          throw new Error("五数概要需要满足：最小值 ≤ 下四分位数 ≤ 中位数 ≤ 上四分位数 ≤ 最大值。");
        boxes.push({
          name,
          value: v,
          detail: `${name}\n最小值 ${fmt(v[0])}\n下四分位数 ${fmt(v[1])}\n中位数 ${fmt(v[2])}\n上四分位数 ${fmt(v[3])}\n最大值 ${fmt(v[4])}${row["样本数"] != null ? `\n样本数 ${row["样本数"]}` : ""}`,
        });
      }
    } else {
      if (!fields.value) throw new Error("请选择原始数值字段；也支持包含五数概要的表格。");
      for (const row of table.rows) {
        const name = title(row[fields.category]),
          value = numeric(row[fields.value]);
        if (!name || value === null) {
          omitted++;
          continue;
        }
        const values = groups.get(name) ?? [];
        values.push(value);
        groups.set(name, values);
      }
      for (const [name, values] of groups) {
        values.sort((a, b) => a - b);
        const q1 = studioQuantile(values, 0.25),
          median = studioQuantile(values, 0.5),
          q3 = studioQuantile(values, 0.75),
          iqr = q3 - q1;
        const inside = values.filter((value) => value >= q1 - 1.5 * iqr && value <= q3 + 1.5 * iqr);
        const low = inside[0],
          high = inside[inside.length - 1];
        const detail = `${name}\n样本数 ${values.length}\n下须 ${fmt(low)}\n下四分位数 ${fmt(q1)}\n中位数 ${fmt(median)}\n上四分位数 ${fmt(q3)}\n上须 ${fmt(high)}`;
        const index = boxes.length;
        for (const value of values)
          if (value < low || value > high)
            outliers.push({
              value: [index, value],
              detail: `${name}\n离群值：${fmt(value)}（不代表数据错误）`,
            });
        boxes.push({ name, value: [low, q1, median, q3, high], detail });
      }
    }
    if (boxes.length > 60) throw new Error("箱线图最多展示 60 个分组，请先筛选数据。");
    option.xAxis = category(boxes.map((box) => box.name));
    option.yAxis = axis(summary ? "数值" : fields.value);
    option.series = [
      {
        type: "boxplot",
        data: boxes,
        itemStyle: { color: colors.palette[0], opacity: 0.8, borderColor: colors.palette[0] },
      },
      {
        type: "scatter",
        data: outliers.slice(0, 1000),
        symbolSize: 6,
        itemStyle: { color: colors.palette[1] },
      },
    ];
    option.dataZoom = [
      { type: "inside", xAxisIndex: 0 },
      {
        type: "slider",
        xAxisIndex: 0,
        height: 16,
        bottom: 12,
        start: 0,
        end: Math.min(100, 1000 / Math.max(1, boxes.length)),
      },
    ];
    details.push(...boxes.map((box) => ({ label: box.name, detail: box.detail })));
    return {
      option,
      details,
      omitted,
      summary: `${boxes.length} 个分组 · ${summary ? "五数概要，须线使用输入的上下界" : "按 1.5 倍四分位距绘制须线，点表示离群值"}`,
    };
  }

  if (type === "heatmap") {
    const cells = new Map<string, { x: string; y: string; sum: number; n: number }>();
    for (const row of table.rows) {
      const x = title(row[fields.x]),
        y = title(row[fields.y]),
        value = numeric(row[fields.value]);
      if (!x || !y || value === null) {
        omitted++;
        continue;
      }
      const key = JSON.stringify([x, y]),
        cell = cells.get(key) ?? { x, y, sum: 0, n: 0 };
      cell.sum += value;
      cell.n++;
      cells.set(key, cell);
    }
    const xs = sortLabels([...new Set([...cells.values()].map((cell) => cell.x))]);
    const ys = sortLabels([...new Set([...cells.values()].map((cell) => cell.y))]);
    if (xs.length > 100 || ys.length > 60)
      throw new Error("热力图支持最多 100 列、60 行，请先汇总数据。");
    const points = [...cells.values()].map((cell) => {
      const value = options.aggregate === "sum" ? cell.sum : cell.sum / cell.n;
      const detail = `${fields.x}：${cell.x}\n${fields.y}：${cell.y}\n${fields.value}：${fmt(value)}`;
      details.push({ label: `${cell.y} / ${cell.x}`, detail });
      return { value: [xs.indexOf(cell.x), ys.indexOf(cell.y), value], detail };
    });
    const values = points.map((point) => point.value[2]);
    const min = Math.min(0, ...values),
      max = Math.max(1, ...values);
    option.xAxis = { ...category(xs), name: fields.x, nameTextStyle: { color: colors.muted } };
    option.yAxis = { ...category(ys), inverse: true };
    option.visualMap = {
      min,
      max,
      calculable: true,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      itemWidth: 10,
      itemHeight: options.compact ? 100 : 180,
      textStyle: { color: colors.muted },
      inRange: { color: [colors.surface, colors.palette[0]] },
    };
    option.series = [
      {
        type: "heatmap",
        data: points,
        emphasis: { itemStyle: { borderColor: colors.text, borderWidth: 1 } },
      },
    ];
    details.sort((a, b) => a.label.localeCompare(b.label, "zh-CN", { numeric: true }));
    return {
      option,
      details,
      omitted,
      summary: `${ys.length} 行 × ${xs.length} 列 · ${points.length} 个有效组合 · 重复坐标${options.aggregate === "sum" ? "累加" : "取均值"}，缺失组合留空`,
    };
  }

  if (type === "density") {
    const points: { value: number[]; detail: string }[] = [];
    for (const row of table.rows) {
      const x = numeric(row[fields.x]),
        y = numeric(row[fields.y]),
        n = fields.weight ? numeric(row[fields.weight]) : 1;
      if (x === null || y === null || n === null || n <= 0) {
        omitted++;
        continue;
      }
      points.push({
        value: [x, y, n],
        detail: `${fields.x}：${fmt(x)}\n${fields.y}：${fmt(y)}\n频数：${fmt(n)}`,
      });
    }
    const total = points.reduce((sum, point) => sum + point.value[2], 0);
    if (options.densityMode === "scatter") {
      const max = Math.max(1, ...points.map((point) => point.value[2]));
      option.xAxis = axis(fields.x);
      option.yAxis = axis(fields.y);
      option.series = [
        {
          type: "scatter",
          data: points,
          symbolSize: (value: unknown) => 6 + Math.sqrt((value as number[])[2] / max) * 24,
          itemStyle: { color: colors.palette[0], opacity: 0.65 },
          emphasis: { focus: "self" },
        },
      ];
      option.dataZoom = [
        { type: "inside", xAxisIndex: 0 },
        { type: "inside", yAxisIndex: 0 },
      ];
      details.push(
        ...points
          .slice(0, 300)
          .map((point) => ({
            label: `${fmt(point.value[0])} / ${fmt(point.value[1])}`,
            detail: point.detail,
          })),
      );
    } else {
      const count = options.compact ? 10 : 16;
      const xs = points.map((point) => point.value[0]),
        ys = points.map((point) => point.value[1]);
      const minX = Math.min(...xs),
        maxX = Math.max(...xs),
        minY = Math.min(...ys),
        maxY = Math.max(...ys);
      const stepX = (maxX - minX || 1) / count,
        stepY = (maxY - minY || 1) / count;
      const cells = new Map<string, { x: number; y: number; n: number }>();
      for (const point of points) {
        const x = Math.min(count - 1, Math.floor((point.value[0] - minX) / stepX));
        const y = Math.min(count - 1, Math.floor((point.value[1] - minY) / stepY));
        const key = `${x}/${y}`,
          cell = cells.get(key) ?? { x, y, n: 0 };
        cell.n += point.value[2];
        cells.set(key, cell);
      }
      const data = [...cells.values()].map((cell) => {
        const detail = `${fields.x}：${fmt(minX + cell.x * stepX)}–${fmt(minX + (cell.x + 1) * stepX)}\n${fields.y}：${fmt(minY + cell.y * stepY)}–${fmt(minY + (cell.y + 1) * stepY)}\n频数：${fmt(cell.n)}`;
        details.push({ label: `分箱 ${cell.x + 1} / ${cell.y + 1}`, detail });
        return { value: [cell.x, cell.y, cell.n], detail };
      });
      option.xAxis = {
        ...category(Array.from({ length: count }, (_, i) => fmt(minX + (i + 0.5) * stepX))),
        name: fields.x,
        nameLocation: "middle",
        nameGap: 30,
        axisLabel: { color: colors.muted, interval: Math.ceil(count / 4) - 1 },
      };
      option.yAxis = {
        ...category(Array.from({ length: count }, (_, i) => fmt(minY + (i + 0.5) * stepY))),
        name: fields.y,
        axisLabel: { color: colors.muted, interval: Math.ceil(count / 4) - 1 },
      };
      option.visualMap = {
        min: 0,
        max: Math.max(1, ...data.map((point) => point.value[2])),
        orient: "horizontal",
        calculable: true,
        left: "center",
        bottom: 0,
        itemWidth: 10,
        itemHeight: 160,
        inRange: { color: [colors.surface, colors.palette[0]] },
        textStyle: { color: colors.muted },
      };
      option.series = [{ type: "heatmap", data }];
    }
    return {
      option,
      details,
      omitted,
      summary: `${points.length} 条有效输入 · 频数合计 ${fmt(total)} · ${options.densityMode === "scatter" ? "点面积随频数变化，可滚轮缩放" : "颜色表示分箱内频数，空白表示没有有效记录"}`,
    };
  }

  const groups = new Map<string, { before: number; after: number; count: number }>();
  for (const row of table.rows) {
    const name = title(row[fields.category]),
      before = numeric(row[fields.before]),
      after = numeric(row[fields.after]);
    if (!name || before === null || after === null) {
      omitted++;
      continue;
    }
    const group = groups.get(name) ?? { before: 0, after: 0, count: 0 };
    group.before += before;
    group.after += after;
    group.count++;
    groups.set(name, group);
  }
  if (groups.size > 60) throw new Error("对比图最多显示 60 个分组，请先筛选数据。");
  const rows = [...groups].map(([name, values]) => ({
    name,
    before: values.before / values.count,
    after: values.after / values.count,
  }));
  rows.sort((a, b) => b.after - b.before - (a.after - a.before));
  const connectors: SeriesOption[] = rows.map((row) => ({
    type: "line",
    silent: true,
    symbol: "none",
    data: [
      [row.before, row.name],
      [row.after, row.name],
    ],
    lineStyle: { color: colors.muted, width: 3, opacity: 0.35 },
    tooltip: { show: false },
  }));
  const makeData = (which: "before" | "after") =>
    rows.map((row) => {
      const diff = row.after - row.before;
      const detail = `${row.name}\n${fields.before}：${fmt(row.before)}\n${fields.after}：${fmt(row.after)}\n差值：${diff > 0 ? "+" : ""}${fmt(diff)}`;
      if (which === "before") details.push({ label: row.name, detail });
      return { value: [row[which], row.name], detail };
    });
  option.xAxis = axis("数值");
  option.yAxis = { ...category(rows.map((row) => row.name)), inverse: true };
  option.legend = {
    top: 0,
    left: 0,
    data: [fields.before, fields.after],
    textStyle: { color: colors.text },
  };
  option.series = [
    ...connectors,
    {
      name: fields.before,
      type: "scatter",
      symbolSize: 12,
      data: makeData("before"),
      itemStyle: { color: colors.palette[0] },
    },
    {
      name: fields.after,
      type: "scatter",
      symbol: "diamond",
      symbolSize: 14,
      data: makeData("after"),
      itemStyle: { color: colors.palette[2] },
    },
  ];
  return {
    option,
    details,
    omitted,
    summary: `${rows.length} 个分组 · 按后期减前期的差值排序 · 同名分组的输入各自取均值`,
  };
}
