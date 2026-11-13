# 当前架构

维护说明更新于 2026-11-13。当前项目沿用 Next.js + DuckDB，包含数据浏览、受控 AI 工具、账号历史、三角色权限、成绩导入和导出。使用方式见[工作台指南](workspace-guide.md)，专题契约见[文档导航](README.md)。根目录开发路线图属于历史规划，不作为当前架构的完整说明。

```text
浏览器
  -> 服务端会话登录与角色校验
  -> Next.js 双入口工作台（数据浏览 / AI 对话；报告、账号、管理为从属工具）
  -> GET /api/concept-explorer（课程／指标关系聚合），或 POST /api/chat（账号可信历史）
  -> POST /api/ask 保留为旧单轮分析入口；无会话标识的 /api/chat 不创建账号历史
  -> /api/ask：固定问题映射或 OpenAI Responses API 结构化输出
  -> /api/chat：AI 工具循环决定直接回答 / 统计查询 / 知识检索 / 图表（数字由 DuckDB 计算）
  -> Zod 校验 AnalysisPlan v1（/api/chat 另校验工具参数白名单、目录标签与 ChatIntent）
  -> 固定 SQL 模板
  -> DuckDB 读取受控 CSV
  -> 结果行 + 统计周期 + 只读 SQL
  -> ECharts 图表模板 / 表格替代视图 / CSV 与可打印 HTML 报告
  -> 分析审计摘要与独立的账号对话历史持久化（用途、内容与保留期限不同）
```

### 模块入口

| 路径 | 主要职责 |
| --- | --- |
| `components/workspace.tsx` | 双主入口、从属层及 URL／返回关系、账号与 AI 会话客户端编排；不承载独立面板的渲染实现 |
| `lib/navigation.ts`、`next.config.ts` | 公开页面路径与工作台状态的唯一转换边界；精确 rewrite 复用工作台，未知路径不兜底 |
| `components/workspace-data-source-details.tsx` | 数据表、字段及数据质量说明 |
| `components/workspace-account-panel.tsx` | 账号展示、外观偏好与修改密码表单 |
| `components/workspace-report-center.tsx` | 本次会话分析结果的报告选择、预览及导出 |
| `components/workspace-request.ts` | 工作台及账号表单共用的请求错误文案转换；不发请求、不持有会话状态 |
| `components/ai-conversation.tsx` | 对话阅读、附件展开、输入与历史入口；会话状态由工作台编排 |
| `components/conversation-result.tsx` | 对话附件按既有展示策略渲染；成绩分布搜索及图／表展示 |
| `components/data-explorer.tsx`、`lib/exploration/concepts.ts` | 课程／指标／关系中心、同数据画法、URL、双轴全览与阅读恢复 |
| `components/data-explorer-chart-data.ts` | 将概念聚合数据转换为图表项，包含小样本与缺失展示；不查询数据、不写历史 |
| `lib/analysis/` | 受限计划、统计查询、图表结构与结果展示策略 |
| `lib/analysis/concept-explorer.ts`、`concept-query.ts` | 概念浏览类型契约、真实目录与课内聚合，复用DuckDB来源和访问边界 |
| `lib/ai/`、`lib/conversations/` | 受控工具、模型调用、可信对话上下文及账号历史 |
| `lib/auth/`、`lib/admin/`、`lib/security/` | 身份、权限、管理、预算与安全边界 |
| `lib/datasets/`、`lib/exports/` | 数据目录、成绩版本、报告和 CSV 导出 |
| `proxy.ts` | 只匹配设计预览路径；开发环境放行并禁止索引，非开发环境返回 404，不参与业务鉴权 |
| `scripts/prepare-standalone-native.mjs` | 统一准备 standalone 静态／公开资源、许可与 DuckDB 原生库；Docker 复用相同发行树 |

概念浏览按课程→指标→关系循环，选择跨学科关系才显式扩大范围；换画法不换课程、分母或数据。旧自动交集菜单已退出默认界面，受控统计工具仍可复用原群体查询能力。目录、课内成绩、出勤分组、周记录与作业聚合在服务端返回，缺失／小样本不补零、不输出学生ID，详见[连续探索](workspace-guide.md#连续探索)。正式AI历史仍按账号隔离，展示切换不调用模型、不创建对话；浏览参考可移除且保留草稿。会话主体契约见[会话说明](ai-conversation-experience.md#接口与代码边界)与[存储说明](ai-conversation-storage.md)。

公开 URL 使用 `/explore`、`/explore/course`、`/explore/metric`、`/chat`、`/reports`、`/settings`、`/admin`。`workspaceParams` 同时解析公开路径和旧收藏参数，保留冲突供调用方拒绝；`workspaceHref` 与 `conceptHref` 只写新地址。`source=sample` 在概念地址边界解析为内部稳定 ID，API、授权与持久化契约不变。默认画法按当前关系的 `conceptDrawings` 决定，不能统一当成柱形；地址规范化包含 pathname 和查询参数，使用替换而不是新增历史。

### 客户端职责边界

- `workspace.tsx` 保留登录范围、数据请求、会话生命周期及跨入口导航。账号、报告和数据说明面板直接接收其所需的已有数据与回调，不反向导入工作台，也不另建一套状态。
- 图表数据适配器属于 UI 层，使用 `concept-chart` 的类型，不移入服务端统计模块。真实统计口径仍由 `lib/analysis/` 负责。
- 对话结果渲染与对话输入、滚动分离，继续复用既有 `ConversationArtifact`、展示策略和图表组件。重型工具结果保留原动态加载方式。
- 组件直接导入职责模块，不设集中转发文件或兼容重导出；CSS、API、URL、存储契约和设计预览路径不随拆分改变。

### 正式入口与独立分析接口

- 正式页面不链接固定演示，`app/preview/` 和 `public/previews/` 仅是开发资料；生产拒绝访问这两类路径。`docs/design/` 和旧视觉素材原样保留，不因版本收口删除。
- `/api/concept-explorer` 和 `/api/chat` 服务正式浏览／对话；`/api/analysis`、`/api/ask`、`/api/chart-studio`、`/api/course-relations`、`/api/course-panorama`、`/api/score-distribution` 保留为受认证、数据授权及资源限制保护的独立分析接口。当前页面未直接调用不代表固定演示或空实现，本轮不以“没有按钮”为由删除 API 契约。
- 推荐问题同时按当前数据源与模型可用性筛选，不向没有出勤字段的 OULAD 或导入成绩推荐缺勤关系。导出文件名使用数据源展示名称并清洗非法文件字符，内部数据集 ID、权限和存储关系不变。
- 普通页面追踪使用发行排除表；运行期成绩版本与历史桶在文件访问点明确排除构建追踪，避免 instrumentation 将私有文件打包。组装脚本复用构建配置中的排除表清理 instrumentation 遗留的非运行文件，只处理独立产物副本。API 显式携带已登记的校园 CSV 和摘要，设计、测试、原始压缩数据及私有状态不随应用树分发。

## 边界

- `datasetId` 接受 `demo`、`oulad` 和合法的 `grades_<UUID>`，由受控目录和已发布成绩版本解析，不接受客户端文件路径；每次业务查询检查账号授权、启停和文件可用性。参见[后台权限](admin-management.md)与[成绩发布](grade-data-import.md)。
- `/api/chat` 只有一个入口（`converse`），请求不再有 `mode`；是否流式只由 `Accept` 决定。正常运行时由 AI 在受控工具中选择；仅当模型不可用（关闭/未配置/未通过工具调用检测）时才回退到已验证预设与本地图表，并以 `planning.source` 如实标记。`/api/ask` 仍是独立旧入口：固定问题优先匹配 `golden-cases.ts`，自由问题才使用 OpenAI 生成受限字段。
- OpenAI 设置从服务端持久化配置读取，首次可由环境变量初始化；前端管理员保存后立即生效。密钥使用服务端 `APP_SETTINGS_KEY` 加密，不使用 `NEXT_PUBLIC_` 前缀，也不回传浏览器。
- 数据与分析接口要求登录，账号和 AI 管理接口要求管理员。写接口校验本站 Origin；会话使用 HttpOnly Cookie，密码使用带盐 scrypt 哈希。
- 账号、会话、配置与费用保存在 `APP_STATE_DIR`，使用原子写入与跨进程锁。管理员只在终端或首次部署环境初始化，没有公开注册入口。详见 [工作台与账号管理](./workspace-guide.md)。
- `metric`、维度、聚合方式、图表类型和排序均由 Zod 白名单校验。
- 基础 `AnalysisPlan` 的图表类型为柱状图、折线图和表格；分布、关系、全景及工坊等通过各自受控结构提供，不将基础计划枚举误当作全部产品能力。详见[图表能力](ai-chart-capabilities.md)及对应数据类型。
- 大语言模型只推荐白名单图表类型，颜色、布局、坐标轴和交互由前端模板决定；所有图表都必须有单位、样本数、空状态和表格替代视图。
- SQL 由 `lib/analysis/duckdb.ts` 的固定模板产生，不接受客户端 SQL。
- 结果按分组输出，最小样本阈值为 3 名学生；首版不输出个体记录。
- DuckDB 仅在 Node.js Route Handler 中运行，`next.config.ts` 将原生包声明为 `serverExternalPackages`。
- 每次查询使用独立的受限内存实例，设置 DuckDB `memory_limit` 并关闭临时落盘。超时和取消调用原生 `interrupt()`，等待执行结束后关闭连接；转换为 JavaScript 对象前检查结果行数和字段数。此限制针对 DuckDB 管理内存，进程总内存仍需部署层限制。
- CSV 和报告由已有可信聚合结果生成；CSV 防公式注入，报告转义动态内容并使用无脚本预览。报告中心列表不持久化，服务器历史报告与分享未开放；账号 AI 历史独立持久化，不能与报告中心混淆。
- 提交版本不依赖 PostgreSQL、对象存储、ClickHouse 或通用 Text-to-SQL；Docker Compose 是唯一需要验收的部署方式。
- 指标口径参照 `docs/metric-definitions.yml` 与各图表契约。标准分析结果可携带数据集版本，AI 历史快照也包含契约与版本信息；声明版本不是内容指纹，不代表旧结果自动随新数据更新。导入成绩在单次请求内固定版本。
- 页面手动分析、固定问题和自然语言计划共用默认排序：学期折线按维度升序，其他展示按数值降序；查询尊重显式排序，并在排序后限制返回行数。
- 筛选值按操作符校验：`eq` 使用非空字符串，`in` 使用非空字符串数组；值只作为 SQL 字面值，不允许变成 SQL 语句。

## 早期阶段记录（历史，不作为当前待办）

以下保留原 P0/P1 实施快照及当时的测试数量。后台、导入、会话与数据浏览后续演进见上方专题入口；“下一步”不是当前自动执行清单。

### 已实现（第3周）
- ✅ 10 条正常 golden cases + 10 条边界场景（B01-B10）函数级回归
- ✅ 数据集概览：行数、字段类型、缺失值统计
- ✅ P0 结果页：图表、表格、空状态、错误消息
- ✅ 固定问题快速路由，AI 澄清能力

### 新增（第4周）
- ✅ 分析记录持久化：每个分析保存到 `records/analysis.jsonl`
  - `id`、`timestamp`、`datasetId`、`metricId`、版本信息
  - 结果摘要：行数、统计周期、执行耗时
  - 错误记录：错误码和错误消息
  - 不保存原始个人行，只保存聚合结果和元数据
- ✅ 错误边界细化：
  - 空结果返回 422 + 提示（包含最小样本阈值）
  - 新增 `minSampleSize` 和 `filteredOutGroupCount` 到结果中
  - 两个分析接口记录成功、空结果和已认证请求的失败，保留真实数据源/指标及已验证计划；未知字段为空，记录包含用户、来源和阶段，不保存原始提问或上游异常详情
- ✅ 边界场景补充：B11 验证无数据情况
- ✅ 记录查询 API：`loadAnalysisRecords()`、`findRecordById()`

### 下一步（P1）
- 持久化分析历史和报告查询界面（当前结果导出与本次会话报告已实现）
- 部署层进程资源限制、并发与 P95 测量
- 独立 KPI 分析类型与历史变化量、分组柱状图、面积图（概览统计卡片已实现）
- 异常检测和主动洞察
- 可复用部署、备份恢复与回滚脚本，以及正式环境验收

早期认证、权限、响应码、限流与失败审计曾以 19 条 HTTP 回归验收。后续隔离 HTTP 与数据浏览 v3 的验证记录见[工作台指南](workspace-guide.md#验证)，执行方式见 `scripts/test-api.sh`。历史进度见[项目进度记录](../PROGRESS.md)，不将不同日期的测试数量混作当前结果。
