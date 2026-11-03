# 学析台项目预览（2026-11-03）

静态 HTML，用来传达正式项目改完风格后的样子。直接用浏览器打开 `index.html`。

视觉基准是 [学习过程图表页面](../learning-process-study/index.html)，规则来自 [AI 实施说明](../ai-implementation-brief-2026-11-03.md)。旧的 `../preview-2026-11-03-deprecated/` 已作废。

| 页面 | 对应正式功能 |
| --- | --- |
| `index.html` | 数据浏览首页：18 门课均分排序，点课程进入 |
| `course.html?c=课程` | 课程：左侧统一指标表，右侧柱形 / 点位 / 雷达只换画法 |
| `metric.html?c=课程&m=指标&r=关系` | 指标：左侧关联列表，右侧当前关系的画法 |
| `overview.html` | 探索全览：前后为主题、左右为画法，远处模糊 |
| `ai.html` | AI 对话：可移除的浏览参考，不自动提问 |

## 数据

`data.js` 由 `data/sample/student_outcomes.csv` 和 `attendance_weekly.csv` 的 2025J 记录聚合生成，口径对照 `lib/analysis/duckdb.ts` 的 `conceptExplorerSource` 和 `lib/analysis/concept-query.ts`。少于 3 人的出勤段隐藏，没有学生的段单独标出，不含学生 ID。全览里的探索历史是固定的示例路线。

## 不包含

不连接后端、权限、URL 历史恢复和真实 AI；AI 页面只演示空状态和输入框。深色主题、窄屏细节未做专门设计。
