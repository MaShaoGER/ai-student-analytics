# 部署指南

## 本地开发环境

### 环境要求
- Node.js 20.9+
- pnpm 11+
- DuckDB（通过 npm 自动安装，需要编译原生模块）

### 安装与运行

```bash
# 安装依赖
pnpm install

# 首次创建管理员
pnpm admin:init

# 开发服务（包含热重载）
pnpm dev

# 类型检查与测试
pnpm typecheck
pnpm test

# 生产构建
pnpm build
```

开发服务将在 `http://localhost:3000` 启动，使用初始化的管理员账号登录。

### 本地 CSV 文件
- 模拟校园数据：`data/sample/` 目录
- OULAD 数据：`oulad_raw/` 目录（如果存在，会在数据集选择器中显示）

CSV 文件已被 `.gitignore` 排除，不会提交到仓库。

### 配置 AI 功能
复制 `.env.example` 为 `.env.local`，填写：
```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

重启开发服务后可使用这些服务端环境变量初始化 AI 配置；未知模型还须设置输入/输出估算单价。也可设置 `APP_SETTINGS_KEY` 后在管理员页面保存模型、密钥、单价与预算，立即生效。固定问题不需要 API 密钥。完整配置说明见 [工作台使用指南](./workspace-guide.md)。

## Docker Compose 部署

### 环境要求
- Docker
- Docker Compose

### macOS 上的容器运行时

Docker Desktop 之外，也可以用 colima（轻量虚拟机，`brew install colima docker docker-compose`）。装完有两个坑必须处理，否则 `docker compose` 用不了：

1. Homebrew 的 docker CLI 默认不加载 compose 插件，需要写 `~/.docker/config.json`：
   ```json
   { "cliPluginsExtraDirs": ["/opt/homebrew/lib/docker/cli-plugins"] }
   ```
2. `colima start` 会打印 "Current context is now colima"，但 context 实际仍是 `default`，CLI 于是去连不存在的 `/var/run/docker.sock`。手动切一次：
   ```bash
   docker context use colima
   ```

colima 虚拟机的架构跟随宿主机：Apple Silicon 上是 aarch64，容器里装的是 DuckDB 的 `linux-arm64` 变体。Dockerfile 已按容器实际架构匹配，不写死 x64。

### 启动服务

```bash
# 构建镜像并启动服务
docker compose up --build

# 后台运行
docker compose up -d --build

# 查看日志
docker compose logs -f student-analytics

# 停止服务
docker compose down
```

本机服务将在 `http://localhost:3000` 启动。首次部署需运行 `docker compose exec student-analytics node scripts/admin-init.mjs` 创建管理员，再从浏览器登录。远程生产访问需配置 HTTPS 和对应的 `APP_ORIGIN`。

### 配置
编辑 `docker-compose.yml` 中的环境变量或根据 `.env.example` 创建 `.env` 文件。至少设置与实际访问地址一致的 `APP_ORIGIN`，前端保存 AI 密钥还需要持久保存 `APP_SETTINGS_KEY`。以下是可选的服务端 AI 初始化参数：
```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### 数据持久化
- `oulad_raw/` 以只读卷挂载
- `records/` 卷保存分析记录，以及 `records/system` 下的账号、会话、AI 设置和用量
- `data/sample/` 包含在镜像中

## 验证部署

### 本地快速验证
```bash
# 1. 类型检查
pnpm typecheck

# 2. 运行测试
pnpm test

# 3. 生产构建
pnpm build

# 4. HTTP 集成测试（会自行启动/停止隔离服务）
./scripts/test-api.sh

# 5. 初始化账号后启动开发服务
pnpm admin:init  # 仅首次运行；已有管理员时跳过
pnpm dev
```

在浏览器打开 `http://localhost:3000`，登录并选择模拟校园数据后运行：
- "哪门课程平均成绩最高？" → 应返回柱状图
- "各学期学习活跃次数如何？" → 应返回折线图
- 运行后检查分析记录是否保存到 `records/analysis.jsonl`

### Docker 验证
```bash
# 构建镜像
docker compose build

# 启动并查看日志
docker compose up

# 在另一个终端验证基础就绪状态（管理员初始化后 setupRequired 应为 false）
curl -fsS http://localhost:3000/api/auth/session | jq '{setupRequired}'
```

数据 API 需要应用登录，写接口还会校验本站 Origin。先在浏览器登录，在同一页面的开发者工具控制台执行；浏览器会自动携带会话和 Origin：

```js
const profile = await fetch("/api/profile").then((response) => response.json());
console.table(profile.datasets.map(({ id, available }) => ({ id, available })));

const response = await fetch("/api/analysis", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    version: 1,
    datasetId: "demo",
    metric: "score",
    aggregation: "avg",
    dimensions: ["course"],
    filters: [],
    sort: { by: "value", direction: "desc" },
    limit: 20,
    chartType: "bar",
  }),
});
console.table((await response.json()).result?.rows);
```

## 生产部署注意事项

### 安全
- 不提交 `.env.local` 和 API 密钥到版本控制
- `.dockerignore` 排除 `.env` 和 `.env.*`（保留 `.env.example`），实际密钥通过运行时环境变量传入
- 使用只读卷挂载数据文件
- API 已配置登录账号速率限制（analysis 30/min、ask 20/min）；登录另有持久化账号及全局限额
- 查询已有超时逻辑（analysis 10s、profile 30s）；内存硬限制、实际取消行为与超时 HTTP 分类仍待专项验证

### 性能
- 使用 `NODE_ENV=production`（Docker Compose 已设置）
- DuckDB 在内存中执行，大数据集查询可能耗时；analysis 超时 10 秒，profile 超时 30 秒
- 分析记录追加写入 JSONL，长期可能需要分片或归档

### 数据管理
- 分析记录保存在 `records/` 卷中，建议定期备份
- 原始 CSV 文件应从受保护的位置挂载
- 不处理真实个人信息，仅保存聚合结果

### 监控
- 查看容器日志：`docker compose logs student-analytics`
- 响应时间：检查 `result.durationMs`
- 错误记录：检查 `records/analysis.jsonl` 中的 errorCode 字段

## 故障排除

### 本地 npm 模块编译失败
症状：`pnpm install` 时 `@duckdb/node-api` 编译出错

解决方案：
- 确认本机有 C++ 编译工具（macOS: `xcode-select --install`）
- 删除 `node_modules` 和 `pnpm-lock.yaml`，重新安装
- 检查 Node.js 版本是否为 20.9+

### Docker 构建失败
症状：`docker compose build` 时 DuckDB 原生模块编译失败

解决方案：
- 确认 Docker 守护进程正在运行
- 尝试 `docker compose build --no-cache`
- 检查 Dockerfile 中的 `serverExternalPackages` 配置

### 数据集不可用
症状：数据集选择器中 OULAD 显示为 "not_found"

解决方案：
- 本地开发：将 CSV 文件放入 `oulad_raw/` 目录
- Docker：确认 `oulad_raw` 卷是否正确挂载
- 检查文件权限（Docker 中需要 read 权限）

## 版本信息

- Node.js 22 (LTS)
- Next.js 16.3+
- DuckDB Node API 1.5+
- pnpm 11+

## 云端测试验收（2026-10-11）

已在 Debian 13 / x86_64、2 核、约 4 GB 内存的服务器完成模拟数据测试部署。测试使用独立 Compose 项目：应用容器不发布主机端口，HTTPS 网关发布 3443 端口，并通过 HTTP Basic Auth 保护页面和 API。临时证书为自签名证书，浏览器首次访问会提示未受信任；正式演示仍需配置可信证书。

构建使用独立 BuildKit 容器，上限为 1 核、1 GB 内存，构建结束后已停止。应用运行上限为 0.75 核、768 MB，网关上限为 0.25 核、96 MB。分析记录使用独立命名卷；应用就绪状态通过 `/api/ai/status` 健康检查确认。

验收结果：

- Linux x64 镜像实际构建成功，DuckDB 原生共享库检查通过。
- 15 项云端 smoke 检查通过，包含 10 个固定问题的计划、数值、排序、样本数，以及无效计划、无数据、非法问题和 AI 未配置响应。
- 从公网验证未认证请求返回 401，正确认证后首页、CSS 和 JavaScript 返回 200，固定问题返回正确统计结果。
- 应用重启前后 12 条分析记录的数量与文件 SHA-256 一致。
- 原有业务容器在部署和验收后仍处于运行状态。

实际 Compose、网关、证书和认证文件存放在服务器的独立部署目录，本机保留专用登录信息。认证文件需允许网关工作进程读取；本次 Nginx 用户 GID 为 101，文件设为 `root:101` 和 `640`。

此次仅上传模拟数据，AI 环境变量为空。真实模型调用、完整 OULAD 数据、长期运行、并发性能、备份恢复和回滚仍待单独验收。

## 下一步

- [x] 配置 API 速率限制和成本上限（第5周）
- [~] VPS 已有回滚脚本并通过语法检查；仓库脚本、实际回滚与恢复演练待完成（第7周）
- [x] 模拟数据云端测试环境与访问账号初始化（2026-10-11）
- [ ] 正式在线演示环境、域名和可信 HTTPS 证书（第7周）
- [~] 公开会话端点已用于基础就绪检查；独立健康端点、监控与告警待完成（第7周）

## 工作台登录与 AI 配置升级

本地代码已加入应用内登录和管理员设置，并于 2026-10-12 更新上述 VPS 测试部署。

部署新版前，将 `APP_ORIGIN` 配为实际访问的 HTTPS 地址，并持久保存 `APP_SETTINGS_KEY`（32 字节 base64）。账号、会话、配置与用量使用既有 `records` 卷。首次部署后运行：

```bash
docker compose exec student-analytics node scripts/admin-init.mjs
```

从页面登录后，管理员可以创建普通用户并配置 AI。升级现有网关时需协调既有 Basic Auth 与应用登录。密钥生成、首次使用和迁移说明见 [工作台使用指南](./workspace-guide.md)。

### VPS 工作台升级验收（2026-10-12）

- 访问入口：`https://64.81.112.189:3443/`。使用应用内账号登录，已移除网关的重复 Basic Auth；账号与密码保存在本机专用部署凭据目录，不进入仓库。
- 镜像：`chuanzhi-student-analytics-test:workspace-20261012T115926`；构建源码位于服务器 `/opt/chuanzhi-student-analytics-test/releases/20261012T115926/source`，包含工作台改版。
- `APP_ORIGIN` 使用实际 HTTPS 地址；`APP_STATE_DIR=/app/records/system`；首次生成的 `APP_SETTINGS_KEY` 已持久保存，管理员通过初始化脚本创建。继续复用 `chuanzhi-test_records` 卷。
- 容器健康检查改用公开 `/api/auth/session`，同时验证管理员已初始化。旧 `/api/ai/status` 现在需要应用登录，不能继续作为匿名探针。
- VPS 上的默认 Turbopack 构建遇到 1 GB 内存上限，因此本次采用 `--build-arg NEXT_BUILD_ARGS=--webpack`。构建容器限制为 1 核、1.5 GB 内存、含 swap 总上限 3 GB，成功构建后已停止；应用和网关运行上限沿用 768 MB / 96 MB。
- 修复状态存储和管理员初始化脚本在锁释放时的竞争：旧持有者不会删除新持有者的锁；新增 10 项确定性交错回归。
- 验证：121 项单元测试、18 项本地认证 HTTP 回归、类型检查与 Linux x64 生产构建通过；临时实例与公网分别通过 49 项 smoke 检查，包含登录、权限、静态资源、10 个固定问题的计划/数值/排序/样本数及错误响应。
- 重启应用后，账号文件与分析记录的 SHA-256 均保持一致；部署前的 12 条记录全部保留。临时验证容器已移除，原有业务容器保持同一容器 ID 且运行。

本次仍使用模拟数据，未上传完整 OULAD CSV，未配置真实 AI 密钥；固定问题和手动分析可使用。HTTPS 沿用自签名测试证书，浏览器会提示证书未受信任，正式演示需使用可信证书。

部署前已备份 Compose、Nginx 和分析记录，并保留旧镜像。服务器 `/opt/chuanzhi-student-analytics-test/deploy/rollback-20261012T115926.sh` 可回退应用版本：恢复备份目录中的 `compose.yml` 与 `nginx.conf`，执行 Compose `up -d --wait` 后重启网关；保留当前 records 卷，不覆盖新增记录。此脚本通过语法检查，本次未执行实际回退。
