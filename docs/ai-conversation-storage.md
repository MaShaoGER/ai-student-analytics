# AI 对话历史存储与清理

状态：P3 已实现（仓储、API、TTL、轮次幂等、后台清理）。远程部署与推送不在本轮范围内。

## 1. 数据位置与账号隔离

- 根目录沿用 `APP_STATE_DIR`（默认 `records/system`），历史位于 `conversations/`。
- 每个账号一个文件：`conversations/<sha256(账号 ID)>.json`。文件名不含账号 ID，也不接受路径输入。
- 每个事务复用 `lib/settings/storage.ts` 的跨进程文件锁、原子替换和 `fsync`；会话正文不进入审计日志。
- 所有者只来自服务端登录态。管理员角色不自动获得他人对话；详情、删除、续聊和停止都要同时满足 owner、当前账号状态和当前数据集授权。

## 2. 保存什么

只保存业务必要字段：

- 会话：ID、服务端 owner、标题、绑定数据集、创建/更新时间、到期时间、修订号、存储结构版本。
- 轮次：客户端 `turnId`、问题、输入摘要、状态、修订号、lease 所有者/到期时间、生成时间。
- 消息：用户问题与最终助手消息（完整、部分、失败、停止、中断）。
- 助手结果：允许字段的聚合快照，包括结论、事实、结果引用、图表/表格所需的聚合行、生成时间、结果契约版本。

不保存：系统提示词、密钥、模型内部推理、原始 SQL、学生级明细或未声明字段。快照在写入前由 Zod 结构校验并按对象删除未知键；分析结果的 `result.query` 固定为空字符串，避免历史导出或渲染读取时崩溃。`presentationPolicies` 不持久化，历史恢复时由可信结果重新派生，展示切换不会成为新事实或续期依据。

## 3. 10 天有效期

- `expiresAt = 最后一条真实消息时间 + 10 天`。
- 续期只发生在：新问题 claim、最终助手消息 `finishTurn`、终结性失败/停止/中断助手消息写入。每次只更新一次。
- 不续期：打开详情、列表、轮询状态、步骤更新、同轮次重放、图表/表格切换、删除失败、权限检查失败。
- 访问判定为 `now >= expiresAt` 即不可访问，列表、详情、删除、续聊、停止统一执行。到期后旧 ID 不会因打开或追问而复活；迟到结果也不能重建。
- 后台清理：启动时一次、运行期间每 5 分钟一次，删除已过期会话实体并中断死亡进程遗留的运行轮次。清理不读取或改写其他账号的授权状态。

### 停机和重启

- 服务停机期间没有后台计时器，不会发生物理删除。此时已到期记录仅靠访问时过滤隐藏，实体保留在磁盘。
- 下次启动先执行清理，再提供历史；因此停机跨过到期时间不会延长可访问期。
- 服务重启时，原进程的 running 轮次不会自动重跑：lease 所有者身份不再存活即标记为 `interrupted`，写入一条终止性助手消息并只续期一次。未保存的迟到结果被拒绝。
- `scripts/recovery.mjs` 的新备份默认排除 `records/system/conversations`，源历史不受影响。自定义备份也须排除或采用相同保留策略；旧备份恢复后先跑清理，不能把过期实体当作可访问历史。

## 4. 轮次幂等与并发

- `turnId` 是客户端轮次标识，输入摘要绑定 `{question, datasetId, resetContext}`，**不含**修订号。
- 相同 `turnId` + 相同摘要：返回已有轮次/结果，不新增消息、不重新调用 AI、不续期；即使客户端携带旧 `expectedRevision` 也按重放处理。
- 相同 `turnId` + 不同摘要：`409 TURN_CONFLICT`。
- 新问题必须提交与服务端一致的 `expectedRevision`；不匹配为 `409 REVISION_CONFLICT`。同一会话已有活动轮次时返回 `409 TURN_IN_PROGRESS`，且不会打断正在执行的轮次。
- `finishTurn`、`failTurn`、`stopTurn` 都用 `conversationId + turnId + revision` 比较并写入。删除、过期、被新轮次取代或状态已终结时拒绝迟到写入。
- 已成功保存的同一轮次再次保存是幂等重放；已停止/失败/中断的轮次即使收到成功结果也返回 `TURN_STOPPED`、`TURN_FAILED` 或 `TURN_INTERRUPTED`，不会“报告保存成功”。
- 耗时 AI/统计调用始终在存储锁外执行。运行中的 worker 应周期性调用只读的 `assertTurnActive`，发现停止、删除、过期或修订被取代时中止本进程任务。

## 5. API

| 方法 | 路径 | 行为 |
| --- | --- | --- |
| `GET` | `/api/conversations?limit=&cursor=` | 当前账号未过期摘要，按最后更新时间倒序游标分页；过滤无授权、已停用或不可用的数据集 |
| `POST` | `/api/conversations` | 创建当前账号会话，`{datasetId, title?}`，校验 AI 权限 |
| `GET` | `/api/conversations/:id` | 详情：`{conversation, messages, turns}`；校验 owner、TTL、当前数据集权限 |
| `DELETE` | `/api/conversations/:id` | 删除自己的会话；重复删除或不存在均幂等成功，不泄露他人记录 |
| `POST` | `/api/conversations/:id/stop` | `{turnId}`；先原子标记 `cancelled`，再中止本进程执行；未知/已终结的轮次返回 `200 idle:true`，便于重试 |

全部写接口要求同源；全部响应 `Cache-Control: no-store`。仓储接口由 `lib/conversations/repository.ts` 提供：`createConversation`、`listConversations`、`getConversation`、`deleteConversation`、`claimTurn`、`finishTurn`、`failTurn`、`stopTurn`、`assertTurnActive`、`cleanupConversations`。

`POST /api/chat` 的保存失败重试端点由主对话流程维护（`/api/conversation-save`），不在本仓储路由内；重试只重复持久化，不重新调用 AI。

## 6. 损坏与边界

- 文件无法解析、版本不符、owner 不匹配、会话结构损坏或结果结构损坏时返回显式存储错误；不会静默重置、跳过账号或清空历史。
- 单账号会话数量、轮次数、消息数、历史上下文长度、单结果大小和账号总量均有上限；超限返回明确错误，不丢弃已完成消息。
- 侧栏历史上下文最多 12 条、总字符数有限；继续追问仍走现有 AI 查询，不把 10 天历史全部送入模型。

## 7. 验证

```bash
pnpm vitest run lib/conversations app/api/conversations
pnpm exec tsc --noEmit
```

测试覆盖：账号隔离、TTL 边界与访问过滤、视图/重放不续期、真实消息续期、并发 claim、修订冲突、停止与迟到结果、删除不复活、损坏文件显式报错、重启中断、快照未知字段剥离、分页、接口鉴权/同源/删除幂等。

跨进程验证使用真实子进程加载打包后的仓储：同一修订的并发 claim 只有一个成功；后台清理与新消息续期竞争时不会删除已续期会话，也不会让已清理会话复活。终止/重启后的运行状态另由租约身份与状态测试覆盖。
