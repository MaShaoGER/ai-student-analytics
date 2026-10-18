import { z } from "zod";
import type { ChatIntent } from "./chat-types";

export const toolSchema = z.enum([
  "sankey",
  "boxplot",
  "rhythm",
  "density",
  "dumbbell",
  "chord",
  "panorama",
]);
export type ChatTool = z.infer<typeof toolSchema>;
export const CHART_TOOLS: {
  tool: ChatTool;
  label: string;
  pattern: RegExp;
  description: string;
}[] = [
  {
    tool: "panorama",
    label: "学科全景",
    pattern: /全景|全科总览/,
    description: "同一学期的学科分布、均分、及格率与薄弱共现。",
  },
  {
    tool: "chord",
    label: "学科关联弦图",
    pattern: /弦图|薄弱共现|共同薄弱|学科关联/,
    description: "同一学期两科同时低于阈值的人数及共同选课样本占比，默认阈值60分。",
  },
  {
    tool: "boxplot",
    label: "成绩箱线图",
    pattern: /箱线|箱须|盒须/,
    description: "各课程有效成绩的五数概要，须线表示最小与最大值。",
  },
  {
    tool: "sankey",
    label: "学习路径桑基图",
    pattern: /桑基|桑吉/,
    description: "演示数据的出勤档位→作业完成档位→成绩档位人数；OULAD没有相应校园字段。",
  },
  {
    tool: "dumbbell",
    label: "学期对比哑铃图",
    pattern: /哑铃/,
    description: "两学期各课程均分及差值；不同选课群体，不能据此判断个人进步。",
  },
  {
    tool: "density",
    label: "散点密度图",
    pattern: /密度图|散点图|出勤.*成绩.*(?:关系|关联)|成绩.*出勤.*(?:关系|关联)/,
    description:
      "演示数据支持出勤率、缺勤课时、旷课课时或活动量与成绩的分档频数；缺勤=请假缺席+旷课，旷课不含批准请假；OULAD仅有活动量。无个体标识。",
  },
  {
    tool: "rhythm",
    label: "学习节奏热力图",
    pattern: /学习节奏|(?:每周|周次|活跃|活动).*热力|热力.*(?:每周|周次|活跃|活动)/,
    description: "各课程每周有记录学生的人均学习活动次数。",
  },
];
export function requestedTool(question: string): ChatTool | undefined {
  if (/是什么|什么是|怎么理解|有什么区别|的区别|如何阅读|原理|介绍|不要画|别画/.test(question))
    return undefined;
  return CHART_TOOLS.find((item) => item.pattern.test(question))?.tool;
}
export function mentionedLabels(question: string, labels: string[]) {
  let remaining = question;
  return [...labels]
    .sort((a, b) => b.length - a.length)
    .filter((label) => {
      if (!remaining.includes(label)) return false;
      remaining = remaining.replaceAll(label, " ");
      return true;
    });
}
export function contextScope(context: ChatIntent | null, field: "course" | "term"): string[] {
  if (!context) return [];
  if (context.kind === "analysis") {
    const filter = context.filters.find((item) => item.field === field);
    return !filter ? [] : filter.op === "eq" ? [filter.value] : filter.value;
  }
  if (context.kind === "tool")
    return field === "course" ? context.courses : context.term ? [context.term] : [];
  return context[field] ? [context[field]] : [];
}
export function clearsScope(question: string, field: "course" | "term") {
  const label = field === "course" ? "(?:课程|课|学科|科目)" : "(?:学期|开课期|年份)";
  return (
    (field === "term"
      ? /(?:每个|各个|每一|各)学期/.test(question)
      : /(?:各门|每门)课|各科/.test(question)) ||
    new RegExp(
      `(?:全部|所有|不限|不限定|不限制)${label}|(?:取消|清除|去掉)(?:对)?${label}(?:筛选|限制)?|${label}(?:范围|筛选)?(?:不限|不限制)|${label}(?:范围|筛选)?(?:为|设为|改为|：|:)(?:全部|所有|不限)`,
    ).test(question) ||
    /(?:取消|清除|去掉)所有筛选/.test(question) ||
    (field === "term" && /按学期比较|比较各学期|跨学期汇总|历年/.test(question))
  );
}

export function toolLabel(tool: ChatTool) {
  return CHART_TOOLS.find((item) => item.tool === tool)!.label;
}
