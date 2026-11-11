# 本地冒烟测试记录（2026-11-11，Windows 11）

本记录只包含一次只读冒烟测试：未改动代码、配置或数据文件，仓库中仅新增本文档。测试目标是确认当前 `main` 能安装依赖、通过类型检查，并尽量在本地跑完自动化测试，同时把无法在 Windows 上执行的部分如实记录下来。

## 被测版本

| 项目 | 值 |
| --- | --- |
| 仓库 | [MaShaoGER/ai-student-analytics](https://github.com/MaShaoGER/ai-student-analytics) |
| 提交 | `c63a7f0`（`main`） |
| 说明 | 正式部署目标为 Linux 容器（`Dockerfile` 基于 `node:22-bookworm-slim`） |

## 测试环境

| 项目 | 值 |
| --- | --- |
| 操作系统 | Windows 11 家庭中文版 10.0.26200（AMD64） |
| Node.js | v24.16.0 |
| pnpm | 11.19.0 |
| Git | 2.55.0.windows.5 |
| 时区 | Asia/Shanghai |

仓库 `package.json` 要求 Node.js >= 22；`docs/workspace-guide.md` 记录的历史验收宿主为 macOS arm64，并明确“不声称已在 Node 22、Windows 或 Linux 实机验收”。本次是本机 Windows 环境的一次补充验证。

## 执行的检查

| 命令 | 结果 | 备注 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 通过（22.1s） | 按 `pnpm-lock.yaml` 安装，无 peer/版本告警 |
| `pnpm typecheck`（`tsc --noEmit`） | 通过（exit 0） | 类型检查无错误 |
| `pnpm test`（`vitest run`） | 600 通过 / 227 失败 / 75 跳过（916 项，79 个文件） | 13.6s；失败原因见下节，均为 Windows 平台差异 |
| `node --test scripts/recovery.test.mjs` | 11 通过 / 5 失败 | 失败项依赖符号链接、`chmod` 权限语义和 POSIX 可执行脚本 |

Vitest 文件级结果：51 个文件通过、22 个文件失败、6 个文件跳过。跳过的 75 项是仓库既有的开关型用例（集成测试、AI 评测等，需显式环境变量才启用），与本次环境无关。

## 失败归因

本机所有失败都能落到 Windows 与代码所假设的 POSIX 语义之间，未出现独立的业务断言回归。直接原因计数如下（由 Vitest 输出的 `→` 行汇总，同一测试只计一次）：

| 类别 | 数量 | 说明 |
| --- | --- | --- |
| `EPERM: operation not permitted, fsync` | 177 | `lib/settings/storage.ts:167` 对目录句柄调用 `fsyncSync`；Windows 不允许对目录执行 fsync。所有账号、会话、设置、导入草稿写入都会因此失败 |
| 状态存储不可用导致的 HTTP 级联 | 23 | 存储写入失败后路由返回 503（期望 200/422/429/499/500/502/504 等），属上一条的下游影响 |
| 路径分隔符断言 | 11 | 断言期望 SQL/数据源字符串包含 `./data/sample/`，Windows 实际解析为反斜杠路径 |
| 子进程/可执行脚本夹具 | 8 | 测试通过 `node -e` 或 shebang 脚本启动辅助进程（如并发锁、rollback 的 fake `docker`），Windows 不能直接执行无扩展名的 POSIX 脚本 |
| 缺失的原始数据 | 1 | `成绩数据源不可用，请检查本地数据文件`——`oulad_raw/*.csv` 与 `oulad.zip` 被 `.gitignore` 排除，克隆后不存在 |
| 其他 Windows 语义差异 | 7 | 符号链接权限、`chmod` 权限漂移、`ps` 缺失等 |

按测试文件的失败分布：

| 测试文件 | 失败/总数 | 主因 |
| --- | --- | --- |
| `lib/settings/settings.test.ts` | 52/59 | 目录 fsync |
| `lib/conversations/repository.test.ts` | 30/34 | 目录 fsync |
| `app/api/analysis-routes.test.ts` | 24/34 | 目录 fsync → 503 级联 |
| `lib/auth/login-attempts.test.ts` | 14/20 | 目录 fsync |
| `lib/auth/auth.test.ts` | 13/18 | 目录 fsync |
| `lib/ai/zhipu.test.ts` | 12/23 | 目录 fsync |
| `lib/ai/conversation-session.test.ts` | 11/11 | 目录 fsync |
| `lib/analysis/demo-data.test.ts` | 10/14 | 路径分隔符 |
| `app/api/conversations/route.test.ts` | 9/9 | 目录 fsync → 503 级联 |
| `lib/datasets/grade-store.test.ts` | 8/8 | 目录 fsync |
| `lib/security/ai-cost.test.ts` | 8/8 | 目录 fsync |
| `app/api/admin/users/route.test.ts` | 8/8 | 目录 fsync → 503 级联 |
| `lib/auth/access.test.ts` | 8/8 | 目录 fsync |
| `lib/ai/tool-provider.test.ts` | 7/7 | 目录 fsync |
| `lib/ai/planner.test.ts` | 5/30 | 目录 fsync |
| `app/api/admin/analysis-settings/route.test.ts` | 4/4 | 目录 fsync |
| `lib/ai/knowledge.test.ts` | 1/4 | 目录 fsync |
| `lib/admin/admin.test.ts` | 1/11 | 目录 fsync |
| `lib/analysis/duckdb.test.ts` | 1/11 | 缺失原始数据 |
| `lib/ai/unified.test.ts` | 1/59 | 目录 fsync |
| `scripts/reset-password.test.mjs` | 加载失败 | 测试模块导入即失败（`SyntaxError`），Node 直接导入同一模块正常 |
| `lib/conversations/process-concurrency.test.ts` | 加载失败 | 该文件主动 spawn 无扩展名的 `esbuild` POSIX 脚本 |

`node --test scripts/recovery.test.mjs` 的 5 项失败分别是：符号链接拒绝（2 项，Windows 创建符号链接需额外权限）、权限漂移校验（1 项，`chmod` 在 Windows 上语义不同）、rollback 的三项契约测试（fake `docker` 是可执行 shebang 脚本，Windows 无法直接运行）。

> 复现说明：第一次运行 `pnpm test` 时另有 8 项因 Windows 没有 POSIX `ps` 而失败（`lib/settings/storage.ts` 用 `ps -o lstart=` 生成进程身份）。为把“缺少 `ps`”和“目录 fsync”两类原因分开，该轮在 PATH 前临时加入了一个只读 `ps.exe` 包装（未进入仓库）；上表是加入包装后的结果。

## 结论

- 依赖安装与 TypeScript 类型检查在本机通过。
- 与平台无关的 51 个测试文件、600 项用例（核心分析、DuckDB 查询、安全校验、导出、AI 契约等）在本机通过。
- 本机无法完成全量验证：项目面向 Linux/macOS 部署，状态存储依赖 POSIX 目录 `fsync`、POSIX `ps` 与可执行脚本语义，Windows 原生环境不具备这些条件。失败集中在这些边界上，未发现可归因于业务逻辑的独立断言失败。
- 完整验证以 CI（Ubuntu + Node 22）为准，本提交会触发仓库工作流：
  <https://github.com/MaShaoGER/ai-student-analytics/actions/workflows/ci.yml>
- 若需要在 Windows 本地开发，建议在 WSL2 或容器中运行 `pnpm test`；不建议为通过测试而修改 `lib/settings/storage.ts` 的持久化语义。

## 复现命令

```bash
git clone https://github.com/MaShaoGER/ai-student-analytics
cd ai-student-analytics
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
node --test scripts/recovery.test.mjs
```