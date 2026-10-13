# 候选版本 smoke 验收

`scripts/smoke-release.mjs` 面向**独立候选实例**，使用已有测试管理员和普通用户登录，执行固定问题和可控的失败请求。它会新建、注销自己的会话，并追加分析审计；不创建、停用账号，不改密码、AI 设置或已有记录。请先复制 records 卷，再启动与线上隔离的候选实例；不要把线上实例作为默认验收目标。连续多次执行可能触发账号/API 的速率限制，届时等待对应窗口重置再运行。

需要 Node.js 20.9+，脚本仅用内置模块。服务的 `APP_ORIGIN` 应与验收 `origin` 一致；通过候选容器内部 HTTP 访问时，`base` 可以为 `http://127.0.0.1:3000`，`origin` 仍为服务配置的 HTTPS 公开来源。远程访问必须使用 HTTPS，脚本仅接受回环地址的 HTTP。所有请求固定目标来源，不跟随重定向。

将凭据通过安全启动器注入进程环境，然后执行：

```bash
node scripts/smoke-release.mjs
```

| 环境变量                                     | 用途                                                                          |
| -------------------------------------------- | ----------------------------------------------------------------------------- |
| `SMOKE_BASE_URL`                             | 必填，候选实例根 URL，不含账号、查询参数或片段                                |
| `SMOKE_ORIGIN`                               | 服务端配置的准确来源；默认使用 base 的来源                                    |
| `SMOKE_USERNAME`、`SMOKE_PASSWORD`           | 必填，已有测试管理员的登录凭据                                                |
| `SMOKE_USER_USERNAME`、`SMOKE_USER_PASSWORD` | 已有普通测试用户；成对提供才执行普通权限和跨用户归属验收                      |
| `SMOKE_BASIC_AUTH`                           | 可选，网关 Basic Auth；接受原始 `username:password` 或完整 `Basic ...` 值     |
| `SMOKE_CA_CERT_FILE`                         | 可选，自签名测试证书/CA 的 PEM 文件，加入系统根证书验证链                     |
| `SMOKE_RECORDS_FILE`                         | 候选实际写入的 `analysis.jsonl` 路径；也接受 `ANALYSIS_RECORDS_FILE` 别名     |
| `SMOKE_BASELINE_RECORDS_FILE`                | 可选，发布前只读 records 文件；要求候选保留其全部字节前缀                     |
| `SMOKE_REQUIRE_SECURE_COOKIE`                | 默认为要求 Secure；仅本地 HTTP 开发验收可设 `0`，HTTPS origin 始终要求 Secure |

也支持旧发布控制器的 stdin JSON，字段会覆盖对应环境变量：

```text
{ username, password, base, origin, basicAuth?, userUsername?, userPassword?, recordsFile?, baselineRecordsFile?, caCertFile? }
```

这是字段说明，不是实际 JSON。由可信控制器序列化后通过 stdin 传递；不要把密码写进 shell 命令、仓库或日志。脚本不打印凭据、Cookie、响应正文或原始异常。输入 JSON 上限 16 KiB，单请求超时 40 秒，响应上限 4 MiB。

证书验证始终开启。还可在**启动 Node 前**通过 `NODE_EXTRA_CA_CERTS` 加载测试证书；不要设置 `NODE_TLS_REJECT_UNAUTHORIZED=0`，脚本会拒绝这种配置。普通用户需在候选副本中预先准备，脚本不会调用账号管理的成功写操作。

覆盖首页和静态资源、初始化状态、匿名/普通用户权限、Origin/跨站保护、登录与注销、公开 DTO、demo 数据量、10 个金标准的完整计划/元数据/行值/排序/样本数、直接分析、`INVALID_PLAN`、`NO_DATA`、`INVALID_QUESTION`、畸形 JSON，以及关闭或未配置 AI 时的 `AI_NOT_CONFIGURED`。AI 已可调用时跳过自由问题，不触发真实模型消费；验证总调用数未增加。

提供 records 文件时，验收前后核对全部旧字节、JSONL 可读性和新审计数量，逐条核对接口、阶段、错误码、验证后的计划、结果摘要及登录用户 ID；拒绝新记录中的凭据/问题泄露。候选需独占测试流量，否则无法把新增记录一一对应到本次请求。旧记录可缺少 userId，也可保留旧版 `{}` 计划，脚本确认它们原样保存且没有重新分配归属。它不替代 `lib/records/records.test.ts` 对应用 loader 的 `{}` → `null` 兼容验证，也不验证未公开的记录读取接口。

完整验收应同时提供普通用户和含旧记录的实际 records 文件。缺少普通用户、records 或旧记录时显示 `SKIP`；汇总为 `PASS_WITH_SKIPS`，不能作为该项完整验收证据。任何检查失败退出码为 1，通过（包括明确跳过）为 0。`TIMEOUT`、`CANCELLED`、内存/结果/字段上限及真实模型故障需要受控故障注入，由路由和查询执行测试覆盖；本脚本不通过耗尽候选资源制造这些错误。

本脚本不执行 VPS 操作、上线、重启、回滚、恢复或浏览器导出验收。
