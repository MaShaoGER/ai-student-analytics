# 当前架构

当前实现是路线图第 1 周到第 2 周的最小垂直切片：

```text
浏览器
  -> Next.js 页面（固定问题或自然语言）
  -> POST /api/ask
  -> 固定问题映射或 OpenAI Responses API 结构化输出
  -> Zod 校验 AnalysisPlan v1
  -> 固定 SQL 模板
  -> DuckDB 读取受控 CSV
  -> 结果行 + 指标口径 + 只读 SQL
  -> ECharts / 表格
```

## 边界

- `datasetId` 只能是 `demo` 或 `oulad`，路径由服务端常量映射，不接受客户端文件路径。
- 固定问题优先匹配 `golden-cases.ts`，不调用模型；自由问题才使用 OpenAI 生成受限字段。
- OpenAI 密钥仅由 Node.js Route Handler 从服务端环境变量读取，不使用 `NEXT_PUBLIC_` 前缀。
- `metric`、维度、聚合方式、图表类型和排序均由 Zod 白名单校验。
- SQL 由 `lib/analysis/duckdb.ts` 的固定模板产生，不接受客户端 SQL。
- 结果按分组输出，最小样本阈值为 3 名学生；首版不输出个体记录。
- DuckDB 仅在 Node.js Route Handler 中运行，`next.config.ts` 将原生包声明为 `serverExternalPackages`。

## 下一步

下一步加入数据质量字段统计、模型生成计划的评测记录和基于真实查询结果的报告生成。模型永远只生成计划或解释真实结果，不直接生成或执行任意 SQL。
