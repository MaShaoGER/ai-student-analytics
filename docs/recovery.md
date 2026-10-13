# 记录备份、恢复与版本回退

`scripts/recovery.mjs` 备份整个 `records`，包含分析 JSONL、`system` 中的账号、会话、AI 密文配置、用量、登录限额及嵌套目录。`scripts/rollback-image.mjs` 将明确指定的 Compose 服务切回本地已有镜像，继续使用当前记录卷。

工具只依赖 Node.js 20.9+。Docker 模式还需要本机 Docker CLI、守护进程及本地已有、能执行 Node 的 Linux 镜像。可用当前应用镜像作为 helper；不会联网拉镜像。运行 `node scripts/recovery.mjs --help` 或 `node scripts/rollback-image.mjs --help` 查看完整参数。

## 备份边界

备份是受保护的运维产物，包含账号哈希、会话令牌和 AI 密文。将输出放在仓库外的私有目录，父目录限制为 `700`。脚本独占创建备份目录（`700`），清单文件为 `600`；不会覆盖已有备份。目录中保留原文件权限，由外层私有目录阻止其他用户访问。

完整性清单记录每个目录、文件路径、权限、文件字节数和 SHA-256，`manifest.sha256` 校验清单本身。验证同时拒绝遗漏或多余文件、符号链接、设备文件、重复路径和路径穿越。哈希可发现意外损坏；备份可信来源和访问权限仍由运维者保证。不能将来自未知人的清单当作签名。脚本复制前后比较源和快照清单，失败保留输出供检查；`.incomplete` 标记存在时禁止恢复。

`APP_SETTINGS_KEY` 不在 `records` 内，需要在原部署的私有运行配置或秘密管理器中独立保存。工具只将原 32 字节密钥的 SHA-256 指纹写入清单；不会将密钥或解密后的 API 密钥输出到日志。当 `system/ai-config.json` 含有密文时，备份会实际验证该密文能由提供的密钥认证解密；恢复要求同一密钥。可通过继承的 `APP_SETTINGS_KEY` 或 `--key-file /private/settings-key` 提供，密钥文件必须位于记录及备份目录之外。文件内容只是一行 base64 密钥，不能把整个 `.env` 交给 `--key-file`。已有服务器可在私有控制脚本中原地读取 `runtime.env`，仅把此字段传入子进程环境，避免另传一份密钥。不要开启 shell 跟踪或打印环境变量。

本版支持 `records/system` 布局。若 `APP_STATE_DIR` 或 `ANALYSIS_RECORDS_DIR` 指向其他目录，须先统一持久化布局或单独保护那部分状态。文件内容和权限均恢复，目标文件由 helper 用户拥有；当前 Dockerfile 的运行用户为 root，helper 沿用镜像默认用户。若未来改为非 root，须先在隔离卷验证所有权及读写权限再接入。

## Docker 完整备份

先从 `docker inspect` 和 Compose 配置确认项目、服务、源卷与镜像。不要打印完整 inspect/config 输出，它们可能包含运行时密钥。

源卷通常带 `com.docker.compose.project` 标签。已有测试环境的未标记卷必须额外提供 `--source-container` 与 `--source-service`；脚本验证该容器的 Compose 项目、服务标签、`/app/records` 挂载和状态目录，并核对提供的设置密钥与容器配置一致。参数示例只使用项目的运维标识，不含凭据：

```bash
node scripts/recovery.mjs backup \
  --project chuanzhi-test \
  --volume chuanzhi-test_records \
  --source-container chuanzhi-test-app-1 \
  --source-service app \
  --output /private/backups/records-NEW_STAMP \
  --helper-image chuanzhi-student-analytics-test:CURRENT_TAG

node scripts/recovery.mjs verify --backup /private/backups/records-NEW_STAMP
```

执行前停止或暂停所有使用源卷的写入容器，确认没有其他宿主机进程直接写该卷。脚本在复制前后均检查卷消费者，发现运行且未暂停的容器立即拒绝。脚本不会自行暂停、停止或恢复线上服务。运维控制脚本应使用 `try/finally` 恢复自己暂停的容器，暂停窗口内只做备份，不运行构建或 smoke。并行发布、启动容器及挂载操作必须暂停，避免操作期间目标状态变化。

helper 的源挂载只读，禁网、根文件系统只读、禁新增权限、去除 Linux capabilities；只将私有备份目录作为可写输出挂载。使用经过审查的本地镜像；本地目录或脚本路径含逗号时 Docker bind mount 参数会拒绝。

## 只恢复到全新隔离卷

恢复不会覆盖或清空源卷，也不会覆盖已存在的目标卷。新目标必须与源卷名称不同，`--confirm-target` 必须精确重复目标名称。脚本验证备份与设置密钥，确认不存在目标且未被容器挂载，创建带项目和恢复身份标签的新卷，再复制并验证完整清单。若发生失败，目标卷保留供检查；修复后使用另一个全新名称重试。

```bash
node scripts/recovery.mjs restore \
  --project chuanzhi-test \
  --backup /private/backups/records-NEW_STAMP \
  --target-volume chuanzhi-test_records-drill-NEW_STAMP \
  --confirm-target chuanzhi-test_records-drill-NEW_STAMP \
  --helper-image chuanzhi-student-analytics-test:CURRENT_TAG
```

恢复后先用项目的现有镜像启动独立候选容器：使用新卷，保持原 `APP_SETTINGS_KEY`，将 `APP_STATE_DIR` 设为 `/app/records/system`，仅发布 loopback 隔离端口或通过 `docker exec` 验收。先比较分析记录和账号文件 SHA-256，再验证管理员仍可登录、旧记录与用户归属、配置解密以及服务重启后的数据一致性。登录和 HTTP smoke 会更新会话或审计记录，哈希比对应在这些写入前完成；演练新增数据留在隔离卷。人工审查并修改生产卷绑定后才可切换生产；工具本身不修改生产挂载。

不要对线上 Compose 执行 `down -v`、删除原卷或执行 Docker 全局 prune。清理演练资源时只删除已核对身份的独立容器与恢复卷；保留原卷、私有备份及原密钥。

## 只回退本项目一个服务的镜像

版本回退保留当前 `records`，包括发布后新增的记录。先运行默认预演，指定准确的当前镜像、先前镜像、项目、服务、卷与新 override 路径；若 Compose 使用 `.env`，通过 `--env-file` 指定原私有文件：

```bash
node scripts/rollback-image.mjs \
  --project chuanzhi-test \
  --compose-file /private/deploy/compose.yml \
  --env-file /private/deploy/runtime.env \
  --service app \
  --expected-image chuanzhi-student-analytics-test:CURRENT_TAG \
  --image chuanzhi-student-analytics-test:PREVIOUS_TAG \
  --records-volume chuanzhi-test_records \
  --override-file /private/deploy/rollback-NEW_STAMP.json
```

加 `--apply` 才执行。工具要求恰好一个匹配项目与服务的当前容器；当前镜像标签和 ID、目标卷、Compose 配置、`APP_SETTINGS_KEY`、状态目录和 `APP_ORIGIN` 都须匹配。先前镜像必须已在本机并属于同一镜像仓库，不能等于当前镜像 ID。它独占创建只含该服务镜像 ID 的 override，以 `up -d --no-deps --no-build --pull never --wait SERVICE` 重建该服务，再核对镜像、卷、运行状态和关键环境；不操作其他项目或依赖服务，不删除镜像、数据卷或网络。应用自身的 Compose 健康检查决定 `--wait` 的就绪强度，回退后仍须运行带认证 smoke。

保留 override 文件；后续 Compose 命令须使用原文件与 `--file /private/deploy/rollback-NEW_STAMP.json`，否则仅使用原 Compose 文件会再次切回其中的镜像。执行失败时保留当前状态和 override，检查这一服务的健康和日志，再明确选择已验证镜像。旧镜像是否兼容新增状态格式仍须先用隔离 records 副本验证；当前工具不做自动数据库迁移。网关配置若另有变更，应按该配置自己的备份和审查流程恢复。

## 可重复的本地隔离演练

```bash
node --test scripts/recovery.test.mjs
```

测试使用临时目录中的虚构分析、账号、会话、用量及实际 AES-GCM 密文，执行完整备份、验证和恢复；验证缺失或错误密钥、内容与权限损坏、穿越、符号链接、已有目标、项目不匹配及未完成备份都会被拒绝，原数据保留。另以隔离 Docker CLI fixture 检查回退预演无写入、只重建指定服务以及拒绝卷或密钥变更。这些 CLI fixture 不能替代真实 Docker 卷或真实服务回退验收。

离线目录模式供 fixture 使用，不能将仍运行的开发服务目录当作 fixture：

```bash
node scripts/recovery.mjs fixture-backup \
  --project chuanzhi-recovery-drill \
  --source-dir /private/drill/source \
  --confirm-offline /private/drill/source \
  --output /private/drill/backup-new
node scripts/recovery.mjs fixture-restore \
  --project chuanzhi-recovery-drill \
  --backup /private/drill/backup-new \
  --target-dir /private/drill/restored-new \
  --confirm-target /private/drill/restored-new
```

文件目录必须真实存在且不为符号链接；备份输出和恢复目标必须尚不存在，父目录已存在。两次执行分别使用新的输出与恢复名称。脚本不清理上一次演练结果。


## 2026-10-13 实际验收

`node --test scripts/recovery.test.mjs` 的 15 条 CLI 回归通过。在 VPS 使用当前应用镜像作为受限 helper，从暂停写入的 `chuanzhi-test_records` 生成完整备份，再恢复到工具新建的隔离卷；备份、恢复与启动后的全部 3 个持久化文件 SHA-256 一致，原管理员登录成功。源卷与已存在目标卷的恢复请求被拒绝，Docker 卷集合未改变。

恢复实例使用独立 Compose 项目、原设置密钥、768 MiB 内存上限、`network_mode: none`，不发布端口。恢复后的新版通过 70 项完整 smoke；`rollback-image.mjs` 的预演无写入，实际回退旧镜像后 49 项检查通过；切回新版后再次通过 70 项检查。两次镜像切换前后完整持久化文件哈希一致。演练容器与恢复卷已清理，原生产卷和备份保留。

私有完整备份分别位于 VPS 根目录的 `backups/recovery-20261013`（发布前）和 `backups/released-20261013`（发布后 59 条记录）；清单、脚本和回退证据位于 `acceptance/20261013`，这些目录不进入公开仓库。生产重启后全 records 与运行配置哈希一致，其他 8 个业务容器 ID 与运行状态未变。

线上尚无真实 AI 密钥；实际 AES-GCM 密文与错误密钥拒绝由独立 CLI fixture 验证。备用主机恢复和真实 AI 连接仍需后续验收。
