export type DemoAction =
  "compare" | "term" | "clarify" | "clarify-result" | "activity" | "partial" | "error";

export type DemoSceneId = "comparison" | "clarification" | "relation";

export type DemoChoice = {
  label: string;
  action: DemoAction;
};

export type DemoChart = {
  id: string;
  title: string;
  description: string;
  unit: string;
  rows: {
    label: string;
    before: number;
    after: number;
  }[];
  beforeLabel: string;
  afterLabel: string;
};

export type DemoAnswer = {
  id: DemoAction;
  eyebrow: string;
  title: string;
  paragraphs: string[];
  paragraphFactIds?: string[];
  metrics: {
    label: string;
    value: string;
    note: string;
    factId?: string;
  }[];
  charts: DemoChart[];
  facts: {
    id: string;
    label: string;
    value: string;
    detail: string;
  }[];
  suggestions: DemoChoice[];
  scope: string;
  caveat: string;
  completion: "complete" | "partial";
};

export type DemoScene = {
  id: DemoSceneId;
  name: string;
  description: string;
  prompt: string;
  scope: string;
  action: DemoAction;
};

const comparisonChart: DemoChart = {
  id: "web-frontend-term-comparison",
  title: "Web 前端开发平均分",
  description: "固定演示数据中的同口径学期均分比较。",
  unit: "分",
  beforeLabel: "2024J",
  afterLabel: "2025J",
  rows: [
    {
      label: "Web 前端开发",
      before: 72.72,
      after: 69.65,
    },
  ],
};

const comparisonMetrics: DemoAnswer["metrics"] = [
  {
    label: "2024J 平均分",
    value: "72.72 分",
    note: "199 个有效样本",
    factId: "before-mean",
  },
  {
    label: "2025J 平均分",
    value: "69.65 分",
    note: "200 个有效样本",
    factId: "after-mean",
  },
  {
    label: "较 2024J 变化",
    value: "-3.07 分",
    note: "72.72 分 → 69.65 分",
    factId: "score-change",
  },
];

const comparisonFacts: DemoAnswer["facts"] = [
  {
    id: "before-mean",
    label: "2024J 均分",
    value: "72.72 分",
    detail: "199 个有效样本",
  },
  {
    id: "after-mean",
    label: "2025J 均分",
    value: "69.65 分",
    detail: "200 个有效样本",
  },
  {
    id: "score-change",
    label: "均分变化",
    value: "-3.07 分",
    detail: "69.65 - 72.72；两个学期均为固定演示口径",
  },
];

export const DEMO_SCENES: DemoScene[] = [
  {
    id: "comparison",
    name: "课程前后对比",
    description: "比较学期表现，查看图表与数字依据。",
    prompt: "比较 Web 前端开发 2024J 和 2025J 的平均成绩",
    scope: "Web 前端开发 · 2024J—2025J",
    action: "compare",
  },
  {
    id: "clarification",
    name: "先澄清再分析",
    description: "补充一个条件，让问题变得更清楚。",
    prompt: "帮我看看成绩变化",
    scope: "等待确定课程与学期",
    action: "clarify",
  },
  {
    id: "relation",
    name: "活动关联探索",
    description: "从一张图继续探索，留意不同的观察窗口。",
    prompt: "学习活动与成绩之间有什么关联？",
    scope: "Web 前端开发 · 成绩与学习活动",
    action: "activity",
  },
];

export const DEMO_ANSWERS: Record<Exclude<DemoAction, "clarify" | "error">, DemoAnswer> = {
  compare: {
    id: "compare",
    eyebrow: "固定数据 · 学期对比",
    title: "Web 前端开发均分下降 3.07 分",
    paragraphs: [
      "Web 前端开发的平均分从 2024J 的 72.72 分，降到 2025J 的 69.65 分，下降 3.07 分。",
      "两期分别包含 199 和 200 个有效样本。人数接近，但不一定是同一批学生；这组差异值得继续观察，还不足以说明变化原因。",
    ],
    paragraphFactIds: ["score-change"],
    metrics: comparisonMetrics,
    charts: [comparisonChart],
    facts: comparisonFacts,
    suggestions: [
      {
        label: "只看 2025J",
        action: "term",
      },
      {
        label: "查看学习活动关联",
        action: "activity",
      },
      {
        label: "查看部分完成状态",
        action: "partial",
      },
    ],
    scope: "Web 前端开发 · 2024J—2025J",
    caveat: "结果来自预设演示数据，不代表当前统计查询；均分变化只描述数值差异，不解释原因。",
    completion: "complete",
  },
  term: {
    id: "term",
    eyebrow: "固定数据 · 单学期",
    title: "2025J：Web 前端开发均分 69.65 分",
    paragraphs: [
      "沿用刚才的课程范围，只看 2025J：Web 前端开发平均分为 69.65 分，参与统计的有效样本为 200 个。",
      "这里聚焦一个学期。你也可以回到两期比较，或者继续查看学习活动。",
    ],
    paragraphFactIds: ["term-mean"],
    metrics: [
      {
        label: "当前学期",
        value: "2025J",
        note: "Web 前端开发",
        factId: "term",
      },
      {
        label: "2025J 平均分",
        value: "69.65 分",
        note: "仅展示当前学期",
        factId: "term-mean",
      },
      {
        label: "有效样本",
        value: "200",
        note: "2025J 固定演示值",
        factId: "term-sample",
      },
    ],
    charts: [],
    facts: [
      {
        id: "term",
        label: "当前学期",
        value: "2025J",
        detail: "单学期演示视图",
      },
      {
        id: "term-mean",
        label: "学期均分",
        value: "69.65 分",
        detail: "与完整课程比较中的 2025J 数值一致",
      },
      {
        id: "term-sample",
        label: "有效样本",
        value: "200",
        detail: "固定演示样本量",
      },
    ],
    suggestions: [
      {
        label: "比较两个学期",
        action: "compare",
      },
      {
        label: "查看学习活动关联",
        action: "activity",
      },
      {
        label: "查看部分完成状态",
        action: "partial",
      },
    ],
    scope: "Web 前端开发 · 仅 2025J",
    caveat: "当前结果仅包含一个学期，不据此判断跨学期趋势。所有数值均为预设演示。",
    completion: "complete",
  },
  "clarify-result": {
    id: "clarify-result",
    eyebrow: "固定数据 · 澄清后的结果",
    title: "已按完整课程范围比较两个学期",
    paragraphs: [
      "范围确定了：比较 Web 前端开发在 2024J 与 2025J 的成绩。两期均分从 72.72 分变为 69.65 分，下降 3.07 分。",
      "两个学期分别有 199 和 200 个有效样本。可以展开下方图表和统计依据，进一步核对这组差异。",
    ],
    paragraphFactIds: ["score-change"],
    metrics: comparisonMetrics,
    charts: [comparisonChart],
    facts: comparisonFacts,
    suggestions: [
      {
        label: "只看 2025J",
        action: "term",
      },
      {
        label: "查看学习活动关联",
        action: "activity",
      },
      {
        label: "查看部分完成状态",
        action: "partial",
      },
    ],
    scope: "Web 前端开发 · 2024J—2025J",
    caveat: "该结果只回应本次澄清后的演示范围，不代表当前统计查询，也不解释均分变化的原因。",
    completion: "complete",
  },
  activity: {
    id: "activity",
    eyebrow: "固定数据 · 关联探索",
    title: "学习活动也在变化，先核对观察窗口。",
    paragraphs: [
      "2025J 的测验参与率从期中前的 81.2% 变为期末前的 76.4%，下降 4.8 个百分点；讨论参与率从 46.8% 变为 43.1%。",
      "活动数据比较的是同一学期内的两个时点，成绩数据比较的是两个学期。观察窗口不同，可以并排查看，但不能据此把均分下降归因于学习活动。",
    ],
    paragraphFactIds: ["activity-quiz", "causal-boundary"],
    metrics: [
      {
        label: "均分变化",
        value: "-3.07 分",
        note: "2024J → 2025J 固定参照",
        factId: "score-reference",
      },
      {
        label: "测验参与变化",
        value: "-4.8 个百分点",
        note: "81.2% → 76.4%；2025J 演示时点",
        factId: "activity-quiz",
      },
      {
        label: "讨论参与变化",
        value: "-3.7 个百分点",
        note: "46.8% → 43.1%；2025J 演示时点",
        factId: "activity-discussion",
      },
    ],
    charts: [
      comparisonChart,
      {
        id: "activity-participation",
        title: "Web 前端开发学习活动参与率",
        description: "2025J 期中前与期末前两个演示时点的参与率；仅展示关联探索，不代表因果。",
        unit: "%",
        beforeLabel: "期中前",
        afterLabel: "期末前",
        rows: [
          {
            label: "测验参与",
            before: 81.2,
            after: 76.4,
          },
          {
            label: "讨论参与",
            before: 46.8,
            after: 43.1,
          },
        ],
      },
    ],
    facts: [
      {
        id: "activity-quiz",
        label: "测验参与率变化",
        value: "81.2% → 76.4%",
        detail: "2025J 期中前与期末前比较，下降 4.8 个百分点；为预设演示值",
      },
      {
        id: "activity-discussion",
        label: "讨论参与率变化",
        value: "46.8% → 43.1%",
        detail: "2025J 期中前与期末前比较，下降 3.7 个百分点；为预设演示值",
      },
      {
        id: "activity-window",
        label: "活动观察窗口",
        value: "期中前 → 期末前",
        detail: "2025J 固定演示时点，非当前活动日志",
      },
      {
        id: "score-reference",
        label: "成绩固定参照",
        value: "72.72 → 69.65 分",
        detail: "2024J → 2025J；均分下降 3.07 分，有效样本 199 → 200",
      },
      {
        id: "causal-boundary",
        label: "解释边界",
        value: "仅作关联探索",
        detail: "不据此认定活动导致成绩变化",
      },
    ],
    suggestions: [
      {
        label: "比较课程",
        action: "compare",
      },
      {
        label: "只看 2025J",
        action: "term",
      },
      {
        label: "查看部分完成状态",
        action: "partial",
      },
    ],
    scope: "Web 前端开发 · 成绩与学习活动",
    caveat: "两张图使用不同观察窗口，不代表个体配对或统计相关性检验结果，不能推出因果关系。",
    completion: "complete",
  },
  partial: {
    id: "partial",
    eyebrow: "固定数据 · 部分完成",
    title: "比较结果已保留，活动关联暂未完成。",
    paragraphs: [
      "课程比较已经完成：Web 前端开发的平均分从 72.72 分降到 69.65 分，下降 3.07 分。两期有效样本分别为 199 和 200。",
      "活动关联这部分暂未完成。你可以先核对已经得到的比较结果，再单独继续活动探索。",
    ],
    paragraphFactIds: ["score-change", "activity-status"],
    metrics: comparisonMetrics,
    charts: [comparisonChart],
    facts: [
      ...comparisonFacts,
      {
        id: "comparison-status",
        label: "课程比较",
        value: "已完成",
        detail: "2024J 199 个样本；2025J 200 个样本",
      },
      {
        id: "mean-change",
        label: "已确认结果",
        value: "72.72 → 69.65 分",
        detail: "均分下降 3.07 分",
      },
      {
        id: "activity-status",
        label: "活动关联",
        value: "未完成",
        detail: "当前演示未形成关联结论",
      },
    ],
    suggestions: [
      {
        label: "查看学习活动关联探索",
        action: "activity",
      },
      {
        label: "只看 2025J",
        action: "term",
      },
      {
        label: "重新查看完整比较",
        action: "compare",
      },
    ],
    scope: "Web 前端开发 · 成绩比较已完成",
    caveat: "部分完成状态只保留已经完成的均分比较；活动关联缺失不代表没有关系，也不提供因果判断。",
    completion: "partial",
  },
};

export const DEMO_STEPS: { id: string; label: string; durationMs: number }[] = [
  {
    id: "understand",
    label: "理解演示问题",
    durationMs: 400,
  },
  {
    id: "scope",
    label: "确认固定范围",
    durationMs: 500,
  },
  {
    id: "metrics",
    label: "载入固定指标",
    durationMs: 650,
  },
  {
    id: "visual",
    label: "整理演示图表",
    durationMs: 650,
  },
  {
    id: "finish",
    label: "生成演示结果",
    durationMs: 350,
  },
];

export const CLARIFICATION_CHOICES: DemoChoice[] = [
  {
    label: "完整比较 2024J 与 2025J",
    action: "clarify-result",
  },
  {
    label: "仅查看 2025J",
    action: "term",
  },
];

const DEMO_QUESTIONS: Record<DemoAction, string> = {
  compare: "比较 Web 前端开发 2024J 和 2025J 的平均成绩",
  term: "只看 Web 前端开发 2025J 的成绩",
  clarify: "帮我看看成绩变化",
  "clarify-result": "完整比较 Web 前端开发 2024J 与 2025J",
  activity: "学习活动与成绩之间有什么关联？",
  partial: "比较课程，并补充学习活动关联",
  error: "进入固定演示错误状态",
};

export function questionFor(action: DemoAction): string {
  return DEMO_QUESTIONS[action];
}
