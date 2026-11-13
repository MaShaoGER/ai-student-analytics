# 本地冒烟测试记录（2026-11-11，Windows 11）

本记录来自一次只读冒烟测试：未改动代码、配置或数据文件，仓库中仅新增本文档。测试目标是确认当前 `main` 能安装依赖、通过类型检查，并尽量在本地跑完自动化测试；同时记录本机无法执行的部分，以及本次提交触发的 CI 结果。

## 被测版本

| 项目 | 值 |
| --- | --- |
| 仓库 | [MaShaoGER/ai-student-analytics](https://github.com/MaShaoGER/ai-student-analytics) |
| 提交 | `c63a7f0`（`main`） |
| 部署目标 | Linux 容器（`Dockerfile` 基于 `node:22-bookworm-slim`） |

## 测试环境

| 项目 | 值 |
| --- | --- |
| 操作系统 | Windows 11 家庭中文版 10.0.26200（AMD64） |
| Node.js | v24.16.0 |
| pnpm | 11.19.0 |
| Git | 2.55.0.windows.5 |
| 时区 | Asia/Shanghai |

仓库 `package.json` 要求 Node.js >= 22；`docs/workspace-guide.md` 记录的历史验收宿主为 macOS arm64，并明确“不声称已在 Node 22、Windows 或 Linux 实机验收”。本次是对 Windows 与本仓库 CI（Ubuntu）的一次补充核对。

## 本地执行的检查

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 通过（22.1s） | 按锁文件安装，无 peer/版本告警 |
| `pnpm typecheck`（`tsc --noEmit`） | 通过（exit 0） | 类型检查无错误 |
| `pnpm test`（`vitest run`） | 600 通过 / 227 失败 / 75 跳过（916 项，79 个文件） | 13.6s；失败原因见下节 |
| `node --test scripts/recovery.test.mjs` | 11 通过 / 5 失败 | 失败项依赖符号链接、`chmod` 权限语义和 POSIX 可执行脚本 |

Vitest 文件级结果：51 个文件通过、22 个文件失败、6 个文件跳过。跳过的 75 项是仓库既有的开关型用例（集成测试、AI 评测等，需显式环境变量才启用），与本次环境无关。

## 本地失败归因

本机的失败分为两类：一类是 Windows 与 POSIX 语义差异，另一类与 CI 上完全相同的“缺少 OULAD 原始数据”。直接原因计数如下（由 Vitest 输出的 `→` 行汇总，同一测试只计一次）：

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| `EPERM: operation not permitted, fsync` | 177 | `lib/settings/storage.ts:167` 对目录句柄调用 `fsyncSync`；Windows 不允许对目录执行 fsync。所有账号、会话、设置、导入草稿写入都会因此失败 |
| 缺少 OULAD 原始数据 | 24 | `oulad_raw/*.csv` 被 `.gitignore` 排除，克隆后不存在；`lib/datasets/service.ts` 判定 `oulad` 数据集不可用，路由返回 503 `DATA_SOURCE_UNAVAILABLE`，测试则期望 200/422/504 等 |
| 路径分隔符断言 | 11 | 断言期望 SQL/数据源字符串包含 `./data/sample/`，Windows 实际解析为反斜杠路径 |
| 子进程/可执行脚本夹具 | 8 | 测试通过 `node -e` 或 shebang 脚本启动辅助进程（并发锁、`admin-init` 等），Windows 不能直接执行无扩展名的 POSIX 脚本 |
| 其他 Windows 语义差异 | 7 | 符号链接/`chmod` 权限、`ps` 缺失、锁文件 `rename` 等 |

按测试文件的失败分布（共 22 个文件失败，其中 2 个为加载失败）：

| 测试文件 | 失败/总数 |
| --- | --- |
| `lib/settings/settings.test.ts` | 52/59 |
| `lib/conversations/repository.test.ts` | 30/34 |
| `app/api/analysis-routes.test.ts` | 24/34 |
| `lib/auth/login-attempts.test.ts` | 14/20 |
| `lib/auth/auth.test.ts` | 13/18 |
| `lib/ai/zhipu.test.ts` | 12/23 |
| `lib/ai/conversation-session.test.ts` | 11/11 |
| `lib/analysis/demo-data.test.ts` | 10/14 |
| `app/api/conversations/route.test.ts` | 9/9 |
| `lib/datasets/grade-store.test.ts` | 8/8 |
| `lib/security/ai-cost.test.ts` | 8/8 |
| `app/api/admin/users/route.test.ts` | 8/8 |
| `lib/auth/access.test.ts` | 8/8 |
| `lib/ai/tool-provider.test.ts` | 7/7 |
| `lib/ai/planner.test.ts` | 5/30 |
| `app/api/admin/analysis-settings/route.test.ts` | 4/4 |
| `lib/ai/knowledge.test.ts` | 1/4 |
| `lib/admin/admin.test.ts` | 1/11 |
| `lib/analysis/duckdb.test.ts` | 1/11 |
| `lib/ai/unified.test.ts` | 1/59 |
| `scripts/reset-password.test.mjs` | 加载失败 |
| `lib/conversations/process-concurrency.test.ts` | 加载失败 |

`node --test scripts/recovery.test.mjs` 的 5 项失败分别是：符号链接拒绝（2 项，Windows 创建符号链接需额外权限）、权限漂移校验（1 项，`chmod` 在 Windows 上语义不同）、rollback 的三项契约测试（fake `docker` 是可执行 shebang 脚本，Windows 无法直接运行）。

> 复现说明：第一次运行 `pnpm test` 时另有 8 项因 Windows 没有 POSIX `ps` 而失败（`lib/settings/storage.ts` 用 `ps -o lstart=` 生成进程身份）。为把“缺少 `ps`”和“目录 fsync”两类原因分开，该轮在 PATH 前临时加入了一个只读 `ps.exe` 包装（未进入仓库）；上表是加入包装后的结果。

## 本次提交触发的 CI 结果

提交本文档后，仓库工作流在主分支上运行：[CI run 42958548153](https://github.com/MaShaoGER/ai-student-analytics/actions/runs/42958548153)。

| 步骤 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | **失败：27 项** |
| `node --test scripts/recovery.test.mjs`、`pnpm build`、`pnpm audit` | 因上一步失败而跳过 |

这 27 项失败与本次文档提交无关，也与 Windows 环境无关：

- 失败集合与上一个主分支提交 `c63a7f0` 的 CI（[run 42549469807](https://github.com/MaShaoGER/ai-student-analytics/actions/runs/42549469807)）**完全一致**，逐条比对无差异；再往前的 `95b573b`、`402e09a`、`b17ef02` 等运行同样为 failure。
- 原因是仓库不包含 `oulad_raw/*.csv`（被 `.gitignore` 排除）。`lib/datasets/service.ts` 的 `available("oulad")` 因此返回 false，任何使用 `oulad` 数据集的接口在断言执行前就返回 503 `DATA_SOURCE_UNAVAILABLE`，而测试期望 200、422、504 等业务状态。
- 受影响的 27 项集中在 `app/api/analysis-routes.test.ts`（24 项）、`lib/ai/unified.test.ts`（1 项）、`app/api/conversations/route.test.ts`（2 项），全部以 `oulad` 作为数据集。

也就是说，本仓库的 CI 在本次提交前已经连续失败；本机 Windows 运行中的 24 项 503 与 CI 是同一原因，与上表的目录 fsync 问题相互独立。

## 结论

- 依赖安装与 TypeScript 类型检查在 Windows 与 CI 上均通过。
- 与平台无关的测试在 Windows 上通过 600 项（51 个文件），覆盖核心分析、DuckDB 查询、安全校验、导出与 AI 契约。
- Windows 本地无法完成全量验证：状态存储依赖 POSIX 目录 `fsync` 与 POSIX 进程/脚本语义，失败集中在这两类边界，未发现可归因于业务逻辑的独立断言失败。
- CI（Ubuntu + Node 22）同样无法全绿，但原因是测试依赖仓库未分发的 OULAD CSV；这是提交前就存在的失败，需要维护者补齐测试数据或调整测试隔离后才能作为发布门槛。
- 若需要在 Windows 本地开发，建议在 WSL2 或容器中运行 `pnpm test`；若要复现 CI 全量结果，需先把 OULAD 的五个 CSV 放入 `oulad_raw/`。

## 复现命令

```bash
git clone https://github.com/MaShaoGER/ai-student-analytics
cd ai-student-analytics
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
node --test scripts/recovery.test.mjs
```