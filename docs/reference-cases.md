# 开源案例学习记录

本记录用于说明路线图中的设计决策来源。案例只提供借鉴，不作为本项目的运行时依赖。仓库状态和许可证信息按 2026-09-23 查询，正式复用代码前需要再次确认。

## 教育场景案例

| 项目 | 观察到的做法 | 本项目吸收的内容 | 不吸收的内容 |
| --- | --- | --- | --- |
| [Learning Trace Platform](https://github.com/davidzhu233-art/Learning-Trace-Platform-Demo) | CSV 测验回答数据、教师/学生双门户、热力图、风险提示和 LLM 反馈 | 结果必须转成教学行动提示；首期结果页需要解释“发现了什么” | 个体风险和学生画像不进入首期；仓库未声明许可证，不复制代码 |
| [Open edX Engagement Analytics](https://github.com/wraithfel/openedx-engagement-monitoring-dashboard) | MinIO 原始日志、Python ETL、ClickHouse 事实表/维表/数据集市、FastAPI 和 React | 事实表先聚合、再提供稳定指标接口；为后续数据规模增长保留逻辑边界 | 比赛截止日前不引入 ClickHouse、MinIO 和多服务部署；仓库未声明许可证 |
| [Moodle Learning Analytics](https://github.com/rwthanalytics/moodle-local_learning_analytics) | 独立日志插件、课程报告、能力/权限控制、隐私说明 | 最小样本阈值、群体结果、数据访问边界和报告模块化 | 不在首期复制 Moodle 插件体系；代码为 GPL-3.0，复用必须满足其许可证 |
| [紫金学院智能管理系统](https://github.com/HanJun27/-LLM-AI-agent-Management-System-) | 自然语言意图识别、多轮会话、学生/班级统计、ECharts | 用 AI 做意图识别和参数提取，保留结构化工具边界 | 不开放增删改工具，不让模型绕过计划校验；代码为 MIT |
| [Open University Analytics](https://github.com/gogoladzetedo/Open_University_Analytics) | 使用 OULAD 的课程、学生、VLE 活跃和成绩数据进行可视化与预测 | 校验 OULAD 连接键、粒度和指标基准 | 不把研究型预测直接承诺为产品能力；仓库未声明许可证 |

## 通用分析架构案例

| 项目 | 观察到的做法 | 本项目吸收的内容 |
| --- | --- | --- |
| [Open Education Analytics](https://github.com/OpenEducationAnalytics/OpenEducationAnalytics) | 教育数据集成框架、可复用数据管道、转换脚本和数据资产目录 | 以数据集画像、逻辑事实/维表和可复现数据版本组织数据；代码主要为 MIT，文档/素材为 CC BY-4.0 |
| [WrenAI](https://github.com/Canner/WrenAI) | 语义层、指标定义、示例和上下文以可审查文件维护，生成受治理 SQL、图表和答案 | `metric-definitions.yml` 增加别名、粒度、时间语义、阈值、版本和示例；AI 只输出受限计划。其仓库按路径采用 Apache-2.0、CC BY-4.0 等多许可证 |
| [Metabase](https://github.com/metabase/metabase) | 保存问题、筛选器、仪表盘、权限和结果探索 | 结果页突出筛选条件、指标口径、数据来源和可展开查询；不直接复制其混合许可证代码 |

## 对本项目的最终影响

1. 以“可复现群体分析”作为产品主线，不把聊天或预测作为主功能。
2. 以指标语义层作为 AI 的上下文来源，模型不直接生成或执行任意 SQL。
3. 以 DuckDB 固定查询模板完成提交版本，逻辑事实表和数据集市为后续扩展保留接口。
4. 每次分析记录数据集版本、指标版本、计划、结果摘要和错误码，但不保存原始个人行。
5. 评测同时覆盖正常问题和拒答/澄清/空结果等边界问题，避免只验证“看起来能回答”。
