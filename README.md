# MIEnchating New API

本项目基于 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 进行二次开发，保留上游的网关、用户、计费、渠道和模型管理能力，并独立维护本项目的功能、部署配置和生产镜像。

- 项目仓库：[MIEnchating/new-api](https://github.com/MIEnchating/new-api)
- 生产镜像：`mienvirtuoso/new-api:latest`
- 技术栈：Go、React、Bun、Rsbuild
- 默认后端端口：`3000`
- 生产基础服务：PostgreSQL、Redis、Nginx Proxy Manager

本项目的生产环境只运行当前仓库构建的二开版本，不使用上游 `calciumion/new-api` 镜像。

## 本项目功能

除上游能力外，本项目重点维护以下功能：

- 渠道路由、同渠道重试、渠道冷却和路由亲和性。
- API Key 多分组路由、分组冷却、分组亲和性和按分组启停。
- 渠道执行计划、实时执行轨迹和管理员日志诊断。
- 普通用户与管理员日志字段隔离，上游请求 ID 链路记录。
- 分组缓存监控、缓存显示顺序和官方服务状态监控。
- 用户账单历史、管理员充值统计和多种额度变更类型。
- CC Switch 模型与用量查询配置导入。
- 多域名 OAuth、共享会话 Cookie 和固定 `SESSION_SECRET`。
- 自定义错误返回、渠道管理权限和操作审计。

## 本地开发

调试阶段使用宿主机 Go 后端和 Bun/Rsbuild 前端，不启动 New API 应用容器：

```text
Go backend:  http://127.0.0.1:3000
Bun frontend: http://154.36.172.108:3002
```

前端开发服务器会把 `/api`、`/mj` 和 `/pg` 代理到 Go 后端。修改 `web/default/src` 后会自动热更新；只有修改 Go 代码才需要重启后端。

```bash
scripts/dev-local.sh start
scripts/dev-local.sh status
scripts/dev-local.sh restart
scripts/dev-local.sh stop
```

日志位于：

```text
dev-logs/backend-console.log
dev-logs/frontend-console.log
```

开发脚本读取项目根目录 `.env`。当前开发数据库和 Redis 通过宿主机端口连接 `/root/newapi` 编排中的服务：

```text
PostgreSQL: 127.0.0.1:5432
Redis:      127.0.0.1:6379
```

## 开发依赖

- Go 1.25 或更高版本
- Bun
- 可访问的 PostgreSQL 和 Redis

常用检查命令：

```bash
go test ./...
bun test --cwd web/default
bun run --cwd web/default typecheck
bun run --cwd web/default build
```

## 生产架构

仓库中的 `docker-compose.yml` 是生产部署入口，只管理 New API 应用容器。`docker-compose.current.yml` 为服务器现有命令保留，配置与生产入口一致。

PostgreSQL、Redis 和 Nginx Proxy Manager 作为外部基础服务运行，并通过 Docker 网络 `nginx` 互通。

| 服务 | 容器名或网络别名 | 端口 | 说明 |
| --- | --- | --- | --- |
| New API | `new-api` | `3000` | 本项目二开镜像 |
| PostgreSQL | `postgres` | `5432` | 主数据库 |
| Redis | `redis` | `6379` | 缓存与同步 |
| Nginx Proxy Manager | `nginx-proxy-manager` | `80/81/443` | HTTPS 与反向代理 |

部署前确认：

```bash
docker network inspect nginx
docker ps --filter name=postgres --filter name=redis
```

网络尚未创建时执行：

```bash
docker network create nginx
```

PostgreSQL 和 Redis 容器必须加入 `nginx` 网络，并分别提供 `postgres`、`redis` 网络别名。

## 环境变量

从 `.env.example` 创建本地 `.env`，并填写真实配置。不要提交 `.env`：

生产 Compose 要求 `POSTGRES_USER`、`POSTGRES_PASSWORD`、`POSTGRES_DB`、`REDIS_CONN_STRING` 和 `SESSION_SECRET` 均已设置；缺少任意一项时，Compose 会在启动前直接失败，不会回退到 SQLite 或无 Redis 模式。

```dotenv
POSTGRES_USER=your_postgres_user
POSTGRES_PASSWORD=replace_with_a_strong_password
POSTGRES_DB=new-api
REDIS_CONN_STRING=redis://:replace_with_a_strong_password@redis:6379/0

TZ=Asia/Shanghai
ERROR_LOG_ENABLED=true
BATCH_UPDATE_ENABLED=true

# 必须使用固定的高强度随机值，容器重建时不能变化
SESSION_SECRET=replace_with_a_long_random_secret

# 多域名 HTTPS 登录
SESSION_COOKIE_SECURE=true
SESSION_COOKIE_TRUSTED_URL=https://yunmian.tech,https://www.yunmian.tech
SESSION_COOKIE_DOMAIN=yunmian.tech
```

`SESSION_COOKIE_DOMAIN` 填写根域名，不填写通配符，例如使用 `yunmian.tech`，不要使用 `*.yunmian.tech`。

系统设置中的服务器地址、可信站点地址负责 OAuth 和支付返回来源；`SESSION_COOKIE_*` 控制浏览器 Cookie。多域名登录时两部分都要正确配置。

修改 Compose 环境变量后，单纯执行 `restart` 不会更新容器环境，必须重建应用容器：

```bash
docker compose up -d --force-recreate --no-build new-api
```

首次切换共享域 Cookie 后，应清除根域和子域下旧的同名 `session` Cookie，避免 host-only Cookie 与共享 Cookie 同时发送。

## 数据目录

生产编排沿用服务器上的持久化目录：

```text
/root/newapi/data
/root/newapi/logs
```

首次部署时创建：

```bash
mkdir -p /root/newapi/data /root/newapi/logs
```

PostgreSQL 数据由外部 PostgreSQL 容器自己的 volume 管理，重建 New API 应用容器不会删除数据库。

## 部署

使用已发布镜像：

```bash
docker compose pull new-api
docker compose up -d --no-build
```

从当前源码构建：

```bash
docker compose build --pull new-api
docker compose up -d --no-build
```

Dockerfile 会依次使用 Bun 构建 default 和 classic 前端，再由 Go 编译后端并嵌入静态资源。

## Nginx 反向代理

Nginx Proxy Manager 的代理目标：

```text
Forward Hostname / IP: new-api
Forward Port: 3000
Scheme: http
```

应用端口仅绑定到宿主机回环地址，公网访问应通过 Nginx Proxy Manager 转发到 `new-api:3000`，不要直接暴露服务器的 `3000` 端口。

公网环境由 Nginx Proxy Manager 终止 HTTPS，不要直接暴露 PostgreSQL 和 Redis 端口。

## 验证与运维

```bash
docker compose ps
curl http://127.0.0.1:3000/api/status
docker compose logs -f new-api
```

预期结果：

- 应用镜像为 `mienvirtuoso/new-api:latest`。
- 容器健康状态正常。
- `/api/status` 返回 HTTP `200` 且 `success` 为 `true`。
- 启动日志显示 PostgreSQL 和 Redis 已启用。

常用操作：

```bash
docker compose restart new-api
docker compose down
```

`docker compose down` 只移除本项目应用容器和编排资源，不删除外部 PostgreSQL、Redis 及其数据。

## 升级

使用发布镜像升级：

```bash
git pull
docker compose pull new-api
docker compose up -d --force-recreate --no-build
docker compose ps
```

从源码升级时，将 `pull new-api` 替换为 `build --pull new-api`。升级前应备份 PostgreSQL 和 `/root/newapi` 持久化目录。

## 安全建议

- 将 `.env` 权限设置为 `600`。
- 使用强数据库密码、Redis 密码和固定随机 `SESSION_SECRET`。
- PostgreSQL 和 Redis 只通过内部 Docker 网络访问。
- 公网入口只使用 HTTPS。
- 定期备份数据库、`/root/newapi/data` 和 `/root/newapi/logs`。
- 多域名登录必须同时配置可信来源、Secure Cookie 和共享根域。

## 上游与许可证

本项目基于 [QuantumNous/new-api](https://github.com/QuantumNous/new-api) 开发。上游文档可在 [New API 官方文档](https://docs.newapi.pro/) 查阅。

本项目遵循 [GNU Affero General Public License v3.0](./LICENSE)，并保留上游项目要求的来源链接和署名。使用、修改和部署本项目时，请同时遵守许可证、上游服务条款及所在地法律法规。
