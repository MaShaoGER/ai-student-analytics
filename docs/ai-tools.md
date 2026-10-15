# 分析工具契约

## `run_analysis`

输入为 `AnalysisPlan v1`：

```ts
{
  version: 1,
  datasetId: "demo" | "oulad",
  metric: "score" | "activity" | "completion_rate",
  aggregation: "avg" | "sum" | "rate",
  dimensions: ["course" | "term"],
  filters: [],
  sort: { by: "value" | "dimension", direction: "asc" | "desc" },
  limit: number,
  chartType: "line" | "bar" | "table"
}
```

输出包含：

- `rows`: `dimension`、`value`、`sampleSize`；
- `metricLabel`、`unit`；
- `query`: 规范化后的只读 SQL，供溯源展示；
- `durationMs`: DuckDB 执行耗时。

非法字段、未知数据源、超出返回行数上限和不存在的数据文件都会返回 400。模型输出也必须先通过同一份 Zod schema。

## `plan_question`

输入：2–500 个字符的自然语言问题和服务端允许的数据集 ID。

1. 与 10 个 golden cases 精确匹配时，直接返回已验证计划；
2. 其他问题使用管理员配置的 Responses 或 Chat Completions API 判断是否可分析，并生成 `metric`、`dimension`、`chartType` 和简短理由；智谱 `glm-4.7-flash` 的 Chat 调用使用 JSON Object 输出与 `thinking: { type: "disabled" }`，百炼 `qwen3.7-flash` / `qwen3.8-flash` 使用 JSON Object 输出与 `enable_thinking: false`，返回内容仍须通过服务端 Zod 校验；
3. 口径含糊或超出 MVP 能力时返回 `CLARIFICATION_REQUIRED`，不运行查询；
4. 服务端补全聚合方式、排序、限制和数据集 ID，再通过完整 `AnalysisPlan` schema；
5. 最终交给 `run_analysis`，模型不会接收文件路径，也不能提交 SQL。

未在管理员配置或服务端环境中设置密钥和模型、或 AI 已停用时，自由问题返回 `AI_NOT_CONFIGURED`，固定问题不受影响。配置与真实调用验收见 [智谱试用指南](zhipu-glm.md) 和 [百炼接入指南](bailian-qwen.md)。
