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

- 渠道路由、同渠道重试、渠道冷却和渠道亲和性。
- API Key 多分组路由、分组冷却、分组亲和性和按分组启停。
- 渠道执行计划、实时执行轨迹和管理员日志诊断。
- 普通用户与管理员日志字段隔离，上游请求 ID 链路记录。
- 分组缓存监控、缓存显示顺序和官方服务状态监控。
- 用户账单历史、管理员订单历史、充值统计和开票标记。
- CC Switch 模型与用量查询配置导入。
- 多域名 OAuth、共享会话 Cookie 和固定 `SESSION_SECRET`。
- 自定义错误返回、渠道管理权限和操作审计。

## 上游项目

以下链接用于保留上游项目来源与参考信息；本项目的生产部署仍使用本仓库构建的二开镜像。

<p align="center">
  <a href="https://raw.githubusercontent.com/Calcium-Ion/new-api/main/LICENSE">
    <img src="https://img.shields.io/github/license/Calcium-Ion/new-api?color=brightgreen" alt="license">
  </a><!--
  --><a href="https://github.com/Calcium-Ion/new-api/releases/latest">
    <img src="https://img.shields.io/github/v/release/Calcium-Ion/new-api?color=brightgreen&include_prereleases" alt="release">
  </a><!--
  --><a href="https://hub.docker.com/r/CalciumIon/new-api">
    <img src="https://img.shields.io/badge/docker-dockerHub-blue" alt="docker">
  </a>
  <a href="https://atomgit.com/QuantumNous/new-api" target="_blank">
    <img alt="AtomGit G-Star" src="https://atomgit.com/QuantumNous/new-api/star/badge.svg"/>
  </a>
</p>

<p align="center">
  <a href="https://trendshift.io/repositories/20180" target="_blank">
    <img src="https://trendshift.io/api/badge/repositories/20180" alt="QuantumNous%2Fnew-api | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/>
  </a>
  <br>
  <a href="https://hellogithub.com/repository/QuantumNous/new-api" target="_blank">
    <img src="https://api.hellogithub.com/v1/widgets/recommend.svg?rid=539ac4217e69431684ad4a0bab768811&claim_uid=tbFPfKIDHpc4TzR" alt="Featured｜HelloGitHub" style="width: 250px; height: 54px;" width="250" height="54" />
  </a><!--
  -->
  <a href="https://atomgit.com/QuantumNous/new-api" target="_blank">
    <img alt="AtomGit G-Star" src="https://atomgit.com/QuantumNous/new-api/star/new_badge.svg" width="250" height="55" />
  </a>
</p>

## 本地开发

调试阶段使用宿主机 Go 后端和 Bun/Rsbuild 前端，不启动 New API 应用容器：

```text
Go backend:  http://127.0.0.1:3000
Bun frontend: http://127.0.0.1:3002
```

前端开发服务器会把 `/api`、`/mj` 和 `/pg` 代理到 Go 后端。修改 `web/src` 后会自动热更新；只有修改 Go 代码才需要重启后端。

```bash
scripts/dev-local.sh start
scripts/dev-local.sh status
scripts/dev-local.sh restart-backend
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

以下为上游项目功能与通用部署参考；本项目生产环境仍以后文的二开架构、镜像和 Compose 配置为准。

---

## 📚 Documentation

<div align="center">

### 📖 [Official Documentation](https://docs.newapi.pro/en/docs) | [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/QuantumNous/new-api)

</div>

**Quick Navigation:**

| Category | Link |
|------|------|
| 🚀 Deployment Guide | [Installation Documentation](https://docs.newapi.pro/en/docs/installation) |
| ⚙️ Environment Configuration | [Environment Variables](https://docs.newapi.pro/en/docs/installation/config-maintenance/environment-variables) |
| 📡 API Documentation | [API Documentation](https://docs.newapi.pro/en/docs/api) |
| ❓ FAQ | [FAQ](https://docs.newapi.pro/en/docs/support/faq) |
| 💬 Community Interaction | [Communication Channels](https://docs.newapi.pro/en/docs/support/community-interaction) |

---

## ✨ Key Features

> For detailed features, please refer to [Features Introduction](https://docs.newapi.pro/en/docs/guide/wiki/basic-concepts/features-introduction)

### 🎨 Core Functions

| Feature | Description |
|------|------|
| 🎨 New UI | Modern user interface design |
| 🌍 Multi-language | Supports Simplified Chinese, Traditional Chinese, English, French, Japanese |
| 🔄 Data Compatibility | Fully compatible with the original One API database |
| 📈 Data Dashboard | Visual console and statistical analysis |
| 🔒 Permission Management | Token grouping, model restrictions, user management |

### 💰 Authorized Usage Accounting and Billing

- ✅ Internal top-up and quota allocation for lawful authorized scenarios (EPay, Stripe)
- ✅ Organization-level per-request, usage-based, and cache-hit cost accounting
- ✅ Cache billing statistics for OpenAI, Azure, DeepSeek, Claude, Qwen, and supported models
- ✅ Flexible billing policies for internal management or authorized enterprise customers

### 🔐 Authorization and Security

- 😈 Discord authorization login
- 🤖 LinuxDO authorization login
- 📱 Telegram authorization login
- 🔑 OIDC unified authentication
- 🔍 Key quota query usage (with [new-api-key-tool](https://github.com/Calcium-Ion/new-api-key-tool))

### 🚀 Advanced Features

**API Format Support:**
- ⚡ [OpenAI Responses](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/create-response)
- ⚡ [OpenAI Realtime API](https://docs.newapi.pro/en/docs/api/ai-model/realtime/create-realtime-session) (including Azure)
- ⚡ [Claude Messages](https://docs.newapi.pro/en/docs/api/ai-model/chat/create-message)
- ⚡ [Google Gemini](https://doc.newapi.pro/en/api/google-gemini-chat)
- 🔄 [Rerank Models](https://docs.newapi.pro/en/docs/api/ai-model/rerank/create-rerank) (Cohere, Jina)

**Intelligent Routing:**
- ⚖️ Channel weighted random
- 🔄 Automatic retry on failure
- 🚦 User-level model rate limiting

**Format Conversion:**
- 🔄 **OpenAI Compatible ⇄ Claude Messages**
- 🔄 **OpenAI Compatible → Google Gemini**
- 🔄 **Google Gemini → OpenAI Compatible** - Text only, function calling not supported yet
- 🚧 **OpenAI Compatible ⇄ OpenAI Responses** - In development
- 🔄 **Thinking-to-content functionality**

**Reasoning Effort Support:**

<details>
<summary>View detailed configuration</summary>

**OpenAI series models:**
- `o3-mini-high` - High reasoning effort
- `o3-mini-medium` - Medium reasoning effort
- `o3-mini-low` - Low reasoning effort
- `gpt-5-high` - High reasoning effort
- `gpt-5-medium` - Medium reasoning effort
- `gpt-5-low` - Low reasoning effort

**Claude thinking models:**
- `claude-3-7-sonnet-20250219-thinking` - Enable thinking mode

**Google Gemini series models:**
- `gemini-2.5-flash-thinking` - Enable thinking mode
- `gemini-2.5-flash-nothinking` - Disable thinking mode
- `gemini-2.5-pro-thinking` - Enable thinking mode
- `gemini-2.5-pro-thinking-128` - Enable thinking mode with thinking budget of 128 tokens
- You can also append `-low`, `-medium`, or `-high` to any Gemini model name to request the corresponding reasoning effort (no extra thinking-budget suffix needed).

</details>

---

## 🤖 Model Support

> For details, please refer to [API Documentation - Gateway Interface](https://docs.newapi.pro/en/docs/api)

| Model Type | Description | Documentation |
|---------|------|------|
| 🤖 OpenAI-Compatible | OpenAI compatible models | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createchatcompletion) |
| 🤖 OpenAI Responses | OpenAI Responses format | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createresponse) |
| 🎨 Midjourney-Proxy | [Midjourney-Proxy(Plus)](https://github.com/novicezk/midjourney-proxy) | [Documentation](https://doc.newapi.pro/api/midjourney-proxy-image) |
| 🎵 Suno-API | [Suno API](https://github.com/Suno-API/Suno-API) | [Documentation](https://doc.newapi.pro/api/suno-music) |
| 🔄 Rerank | Cohere, Jina | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/rerank/creatererank) |
| 💬 Claude | Messages format | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/createmessage) |
| 🌐 Gemini | Google Gemini format | [Documentation](https://docs.newapi.pro/en/docs/api/ai-model/chat/gemini/geminirelayv1beta) |
| 🔧 Dify | ChatFlow mode | - |
| 🎯 Custom upstream | Supports configuring legally authorized upstream endpoints | - |

### 📡 Supported Interfaces

<details>
<summary>View complete interface list</summary>

- [Chat Interface (Chat Completions)](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createchatcompletion)
- [Response Interface (Responses)](https://docs.newapi.pro/en/docs/api/ai-model/chat/openai/createresponse)
- [Image Interface (Image)](https://docs.newapi.pro/en/docs/api/ai-model/images/openai/post-v1-images-generations)
- [Audio Interface (Audio)](https://docs.newapi.pro/en/docs/api/ai-model/audio/openai/create-transcription)
- [Video Interface (Video)](https://docs.newapi.pro/en/docs/api/ai-model/videos/sora/createvideo)
- [Embedding Interface (Embeddings)](https://docs.newapi.pro/en/docs/api/ai-model/embeddings/createembedding)
- [Rerank Interface (Rerank)](https://docs.newapi.pro/en/docs/api/ai-model/rerank/creatererank)
- [Realtime Conversation (Realtime)](https://docs.newapi.pro/en/docs/api/ai-model/realtime/createrealtimesession)
- [Claude Chat](https://docs.newapi.pro/en/docs/api/ai-model/chat/createmessage)
- [Google Gemini Chat](https://docs.newapi.pro/en/docs/api/ai-model/chat/gemini/geminirelayv1beta)

</details>

---

## 🚢 Deployment

> [!TIP]
> **Latest Docker image:** `calciumion/new-api:latest`

### 📋 Deployment Requirements

| Component | Requirement |
|------|------|
| **Local database** | SQLite (Docker must mount `/data` directory)|
| **Remote database** | MySQL ≥ 5.7.8 or PostgreSQL ≥ 9.6 |
| **Container engine** | Docker / Docker Compose |
| **System architecture** | 64-bit only (amd64 / arm64); 32-bit systems are not supported |

### ⚙️ Environment Variable Configuration

<details>
<summary>Common environment variable configuration</summary>

| Variable Name | Description | Default Value |
|--------|------|--------|
| `SESSION_SECRET` | Authentication signing secret; must be identical on every node | - |
| `SESSION_COOKIE_SECURE` | `false`/unset disables the refresh/logout OriginGuard for local HTTP dev proxies; `true` enables the Secure cookie and strict Origin checks | `false` |
| `SESSION_COOKIE_TRUSTED_URL` | Required with Secure mode: comma-separated exact HTTPS Origins allowed to call refresh/logout; not a relay CORS allowlist | - |
| `TRUSTED_PROXIES` | Unset/blank trusts loopback, RFC 1918 and IPv6 ULA with a startup warning; `none` trusts no proxies; an explicit proxy IP/CIDR list replaces the defaults | `127.0.0.0/8, ::1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, fc00::/7` |
| `USER_SESSION_ACTIVE_LIMIT` | Maximum active login Sessions per user | `50` |
| `USER_SESSION_ISSUANCE_LIMIT` | Maximum Sessions created per user within the issuance window, including revoked Sessions | `100` |
| `USER_SESSION_ISSUANCE_WINDOW_SECONDS` | Per-user Session issuance window; clamped to the revoked retention period when configured higher | `86400` |
| `USER_SESSION_REVOKED_RETENTION_DAYS` | Days to retain revoked Session rows for audit and issuance accounting | `7` |
| `USER_SESSION_HOURLY_ALERT_THRESHOLD` | Global Sessions created per hour that triggers an alert only; it never blocks login | `5000` |
| `CRYPTO_SECRET` | HMAC secret for cache keys; nodes sharing Redis must use the same effective value | Defaults to `SESSION_SECRET` |
| `SQL_DSN` | Database connection string | - |
| `REDIS_CONN_STRING` | Redis connection string | - |
| `RELAY_IDLE_CONN_TIMEOUT` | Idle keep-alive timeout for relay HTTP clients, seconds. Defaults to Go standard library behavior; set `0` to disable | `90` |
| `RELAY_RESPONSE_HEADER_TIMEOUT` | How long the relay waits for upstream **response headers**, seconds; set `0` to disable. Only bounds the header wait -- streaming after the headers arrive is unaffected. Note that non-streaming upstreams usually send headers only once generation finishes, so leave headroom | `1800` |
| `STREAMING_TIMEOUT` | Streaming timeout (seconds) | `300` |
| `STREAM_SCANNER_MAX_BUFFER_MB` | Max per-line buffer (MB) for the stream scanner; increase when upstream sends huge image/base64 payloads | `64` |
| `MAX_REQUEST_BODY_MB` | Max request body size (MB, counted **after decompression**; prevents huge requests/zip bombs from exhausting memory). Exceeding it returns `413` | `32` |
| `AZURE_DEFAULT_API_VERSION` | Azure API version | `2025-04-01-preview` |
| `ERROR_LOG_ENABLED` | Error log switch | `false` |
| `PYROSCOPE_URL` | Pyroscope server address | - |
| `PYROSCOPE_APP_NAME` | Pyroscope application name | `new-api` |
| `PYROSCOPE_BASIC_AUTH_USER` | Pyroscope basic auth user | - |
| `PYROSCOPE_BASIC_AUTH_PASSWORD` | Pyroscope basic auth password | - |
| `PYROSCOPE_MUTEX_RATE` | Pyroscope mutex sampling rate | `5` |
| `PYROSCOPE_BLOCK_RATE` | Pyroscope block sampling rate | `5` |
| `HOSTNAME` | Hostname tag for Pyroscope | `new-api` |

📖 **Complete configuration:** [Environment Variables Documentation](https://docs.newapi.pro/en/docs/installation/config-maintenance/environment-variables)

</details>

### 🔧 Deployment Methods

<details>
<summary><strong>Method 1: Docker Compose (Recommended)</strong></summary>

```bash
# Clone the project
git clone https://github.com/QuantumNous/new-api.git
cd new-api

# Edit configuration
nano docker-compose.yml

# Start service
docker-compose up -d
```

</details>

<details>
<summary><strong>Method 2: Docker Commands</strong></summary>

**Using SQLite:**
```bash
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  calciumion/new-api:latest
```

**Using MySQL:**
```bash
docker run --name new-api -d --restart always \
  -p 3000:3000 \
  -e SQL_DSN="root:123456@tcp(localhost:3306)/oneapi" \
  -e TZ=Asia/Shanghai \
  -v ./data:/data \
  calciumion/new-api:latest
```

> **💡 Path explanation:**
> - `./data:/data` - Relative path, data saved in the data folder of the current directory
> - You can also use absolute path, e.g.: `/your/custom/path:/data`

</details>

<details>
<summary><strong>Method 3: BaoTa Panel</strong></summary>

1. Install BaoTa Panel (≥ 9.2.0 version)
2. Search for **New-API** in the application store
3. One-click installation

📖 [Tutorial with images](./docs/BT.md)

</details>

### ⚠️ Multi-machine Deployment Considerations

> [!WARNING]
> - All nodes must use the same primary database and the same `SESSION_SECRET`; otherwise Access Tokens, refresh sessions, and temporary authentication flows cannot be verified consistently.
> - Nodes connected to the same Redis must also use the same `CRYPTO_SECRET`, or their cache-key digests will differ and shared entries cannot be reused consistently.

The database is authoritative for login Sessions and for the per-user active/issuance limits. Redis Session entries are short-lived caches whose TTL follows `SYNC_FREQUENCY` (60 seconds by default) and never exceeds the Session's remaining lifetime.

| Redis topology | Session propagation | Rate limiting |
| --- | --- | --- |
| Shared Redis | Revocations and version publications normally propagate immediately | Redis limits are shared across nodes |
| Independent Redis per node | Nodes converge from the database within the effective `SYNC_FREQUENCY`; a newly rotated token may receive a temporary 401 on a node with stale cache | Each node has its own allowance, so aggregate capacity can reach roughly the configured limit multiplied by the node count |
| No Redis | Every Session validation reads the database | In-memory limits are independent per node |

A shorter `SYNC_FREQUENCY` reduces the independent-Redis staleness window but causes one additional primary-key Session lookup per active SID, per node, per TTL. These guarantees make Session authentication bounded-stale across the supported topologies; rate limits and other Redis-backed control-plane caches remain topology-dependent.

See [User authentication and login sessions](./docs/authentication.md) for the token, Origin-check and PAT contracts.

### 🔄 Channel Retry and Cache

**Retry configuration:** `Settings → Operation Settings → General Settings → Failure Retry Count`

**Cache configuration:**
- `REDIS_CONN_STRING`: Redis cache (recommended)
- `MEMORY_CACHE_ENABLED`: Memory cache

---

## 🔗 Related Projects

### Upstream Projects

| Project | Description |
|------|------|
| [One API](https://github.com/songquanpeng/one-api) | Original project base |
| [Midjourney-Proxy](https://github.com/novicezk/midjourney-proxy) | Midjourney interface support |

### Supporting Tools

| Project | Description |
|------|------|
| [new-api-key-tool](https://github.com/Calcium-Ion/new-api-key-tool) | Key quota query tool |
| [new-api-horizon](https://github.com/Calcium-Ion/new-api-horizon) | New API high-performance optimized version |

---

## 💬 Help Support

### 📖 Documentation Resources

| Resource | Link |
|------|------|
| 📘 FAQ | [FAQ](https://docs.newapi.pro/en/docs/support/faq) |
| 💬 Community Interaction | [Communication Channels](https://docs.newapi.pro/en/docs/support/community-interaction) |
| 🐛 Issue Feedback | [Issue Feedback](https://docs.newapi.pro/en/docs/support/feedback-issues) |
| 📚 Complete Documentation | [Official Documentation](https://docs.newapi.pro/en/docs) |

### 🤝 Contribution Guide

Welcome all forms of contribution!

- 🐛 Report Bugs
- 💡 Propose New Features
- 📝 Improve Documentation
- 🔧 Submit Code

---

## 📜 License

This project is licensed under the [GNU Affero General Public License v3.0 (AGPLv3)](./LICENSE).

Additional terms under AGPLv3 Section 7 apply. Modified versions must preserve
the author attribution notice `Frontend design and development by New API
contributors.` in the appropriate legal notices and in any prominent about,
legal, footer, or attribution location presented by the user interface.

Modified versions that present a user interface must also preserve a visible
link to the original project: <https://github.com/QuantumNous/new-api>.

This is an open-source project developed based on [One API](https://github.com/songquanpeng/one-api) (MIT License).

If your organization's policies do not permit the use of AGPLv3-licensed software, or if you wish to avoid the open-source obligations of AGPLv3, please contact us at: [support@quantumnous.com](mailto:support@quantumnous.com)

---

## 🌟 Star History

<div align="center">

[![Star History Chart](https://api.star-history.com/svg?repos=Calcium-Ion/new-api&type=Date)](https://star-history.com/#Calcium-Ion/new-api&Date)

</div>

---

<div align="center">

### 💖 Thank you for using New API

If this project is helpful to you, welcome to give us a ⭐️ Star！

**[Official Documentation](https://docs.newapi.pro/en/docs)** • **[Issue Feedback](https://github.com/Calcium-Ion/new-api/issues)** • **[Latest Release](https://github.com/Calcium-Ion/new-api/releases)**

<sub>Built with ❤️ by QuantumNous</sub>

</div>

---

## 本项目生产部署

以下命令仅适用于本项目二开部署，使用本仓库的 Compose 配置和 `mienvirtuoso/new-api` 镜像。

常用检查命令：

```bash
go test ./...
bun test --cwd web
bun run --cwd web typecheck
bun run --cwd web build
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
USER_AUTH_CACHE_TTL_SECONDS=3
```

`SESSION_COOKIE_DOMAIN` 填写根域名，不填写通配符，例如使用 `yunmian.tech`，不要使用 `*.yunmian.tech`。

系统设置中的服务器地址、可信站点地址负责 OAuth 和支付返回来源；`SESSION_COOKIE_*` 控制浏览器 Cookie。多域名登录时两部分都要正确配置。

`USER_AUTH_CACHE_TTL_SECONDS` 默认是 3 秒。项目内的禁用、角色和分组变更会主动刷新或失效缓存，并通过 Redis Pub/Sub 通知其他实例；直接在数据库外部修改用户记录，或 Redis 暂时不可用时，最长会等待该 TTL。设置为 `0` 可恢复为每次请求查询数据库。

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
