# 当前架构

当前实现是路线图第 1 周到第 2 周的最小垂直切片，最终提交方案见 [开发路线图](../AI学生数据分析系统开发路线图.md) 和 [开源案例学习记录](./reference-cases.md)：

```text
浏览器
  -> Next.js 页面（固定问题或自然语言）
  -> POST /api/ask
  -> 固定问题映射或 OpenAI Responses API 结构化输出
  -> Zod 校验 AnalysisPlan v1
  -> 固定 SQL 模板
  -> DuckDB 读取受控 CSV
  -> 结果行 + 指标版本 + 数据集版本 + 只读 SQL
  -> ECharts 图表模板 / 表格替代视图
  -> 不含原始个人行的分析记录
```

## 边界

- `datasetId` 只能是 `demo` 或 `oulad`，路径由服务端常量映射，不接受客户端文件路径。
- 固定问题优先匹配 `golden-cases.ts`，不调用模型；自由问题才使用 OpenAI 生成受限字段。
- OpenAI 密钥仅由 Node.js Route Handler 从服务端环境变量读取，不使用 `NEXT_PUBLIC_` 前缀。
- `metric`、维度、聚合方式、图表类型和排序均由 Zod 白名单校验。
- 图表类型只选择受控模板：P0 为柱状图、折线图和表格；P1/P2 的 KPI 卡、分组柱状图、面积图、热力图等必须先扩展结果 schema，再开放到计划中。
- 大语言模型只推荐白名单图表类型，颜色、布局、坐标轴和交互由前端模板决定；所有图表都必须有单位、样本数、空状态和表格替代视图。
- SQL 由 `lib/analysis/duckdb.ts` 的固定模板产生，不接受客户端 SQL。
- 结果按分组输出，最小样本阈值为 3 名学生；首版不输出个体记录。
- DuckDB 仅在 Node.js Route Handler 中运行，`next.config.ts` 将原生包声明为 `serverExternalPackages`。
- 提交版本不依赖 PostgreSQL、对象存储、ClickHouse 或通用 Text-to-SQL；Docker Compose 是唯一需要验收的部署方式。
- 指标定义以 `docs/metric-definitions.yml` 为准，分析结果必须携带指标版本和数据集版本。

## 下一步

数据集概览已经提供可用 CSV 的行数、字段类型和缺失值统计。下一步加入 20 条回归用例（10 条正常问题、10 条边界问题）、P0 图表模板验收、分析记录和基于真实查询结果的报告生成；模型永远只生成计划或解释真实结果，不直接生成或执行任意 SQL。
