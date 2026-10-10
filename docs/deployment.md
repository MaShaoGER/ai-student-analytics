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

# 开发服务（包含热重载）
pnpm dev

# 类型检查与测试
pnpm typecheck
pnpm test

# 生产构建
pnpm build
```

开发服务将在 `http://localhost:3000` 启动。

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

重启开发服务后，自由问题将使用 OpenAI 生成分析计划。固定问题不需要 API 密钥。

## Docker Compose 部署

### 环境要求
- Docker
- Docker Compose

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

服务将在 `http://localhost:3000` 启动。

### 配置
编辑 `docker-compose.yml` 中的环境变量或创建 `.env` 文件：
```bash
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
```

### 数据持久化
- `oulad_raw/` 以只读卷挂载
- `records/` 目录用于保存分析记录（Docker 命名卷）
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

# 4. 启动本地服务
pnpm dev

# 5. HTTP 集成测试（会自行启动/停止服务）
./scripts/test-api.sh
```

在浏览器打开 `http://localhost:3000`，选择模拟校园数据后运行：
- "哪门课程平均成绩最高？" → 应返回柱状图
- "各学期学习活跃次数如何？" → 应返回折线图
- 运行后检查分析记录是否保存到 `records/analysis.jsonl`

### Docker 验证
```bash
# 构建镜像
docker compose build

# 启动并查看日志
docker compose up

# 在另一个终端验证
curl -s http://localhost:3000/api/profile | jq '.datasets[] | .id, .available'

# 提交分析请求
curl -s -X POST http://localhost:3000/api/analysis \
  -H "content-type: application/json" \
  -d '{
    "version": 1,
    "datasetId": "demo",
    "metric": "score",
    "aggregation": "avg",
    "dimensions": ["course"],
    "filters": [],
    "sort": {"by": "value", "direction": "desc"},
    "limit": 20,
    "chartType": "bar"
  }' | jq '.result.rows'
```

## 生产部署注意事项

### 安全
- 不提交 `.env.local` 和 API 密钥到版本控制
- 使用只读卷挂载数据文件
- API 已配置 per-IP 速率限制（analysis 30/min、ask 20/min）与查询超时（analysis 10s、profile 30s）

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

## 下一步

- [x] 配置 API 速率限制和成本上限（第5周）
- [ ] 完整的部署回滚脚本（第7周）
- [ ] 在线演示环境和账号初始化（第7周）
- [ ] 健康检查端点和监控（第7周）
