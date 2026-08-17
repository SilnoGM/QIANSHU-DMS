# 千树 DMS Server

`server/` 是一个可独立复制、安装、检查、构建和运行的单一 NestJS package。它拥有自己的 `package.json`、`pnpm-lock.yaml` 与 pnpm 11 安全配置，不属于根目录或 `web/` 的多 package workspace。

## 环境要求

- Node.js `24.x`（最低满足 `^24.15.0`）
- pnpm `11.9.0`
- 运行应用、数据库迁移和 E2E 测试时需要 PostgreSQL

## 独立安装

从仓库根目录执行：

```bash
pnpm -C server install --frozen-lockfile
```

若只复制 `server/` 到其他位置，则在复制后的目录中执行：

```bash
pnpm install --frozen-lockfile
```

不要在仓库根目录执行 `pnpm install`。根目录只负责无依赖编排，不维护 lockfile 或 `node_modules/`。

## pnpm 11 单 package 安全与部署配置

pnpm 11 使用 `pnpm-workspace.yaml` 保存项目级安装和部署设置，即使当前项目只有一个 package。当前文件内容为：

```yaml
injectWorkspacePackages: true
allowBuilds:
  '@prisma/engines': true
  # Swagger UI 的 Scarf 脚本仅用于安装分析；明确拒绝执行，保证 fresh install 可重复且不发送遥测。
  '@scarf/scarf': false
  # argon2 通过 node-gyp-build 选择已发布的 N-API 预构建二进制；密码 Hash/verify 需要其原生实现。
  argon2: true
  prisma: true
  # sharp 通过已发布的 libvips 平台预构建包完成图片完整解码。
  sharp: true
```

- 文件不声明 `packages`，因此不会形成多 package dependency graph。
- 仓库根目录没有 `pnpm-workspace.yaml`，所以 Server 安全配置不会把根目录、`web/` 或其他目录纳入嵌套 workspace。
- `injectWorkspacePackages` 只服务现代 production deploy：正式 Server 归档通过 `pnpm deploy --prod` 生成自包含的 production 目录，不得使用 `--legacy`。
- 该注入开关不声明 `packages`、不扩张 Server workspace，也不改变 Root、Server 与 Web 相互独立的依赖域。
- 新增带 build script 的依赖前，必须审查包名、固定版本、脚本内容和必要性，再决定是否精确加入 `allowBuilds`。
- 禁止使用 `dangerouslyAllowAllBuilds`、通配 matcher 或其他全局放开策略。

## 环境变量

将 `.env.example` 复制为本地 `.env`，并在本地填写真实配置。严禁提交 `.env` 或在日志中输出连接字符串。

| 变量 | 用途 | 示例模板 |
| --- | --- | --- |
| `NODE_ENV` | 运行环境；production 会启用严格来源、Cookie 与 HMAC 校验 | `development` |
| `PORT` | HTTP 监听端口 | `3000` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 模板保持为空 |
| `SHADOW_DATABASE_URL` | 仅 `prisma:drift:check` 使用的独立临时 PostgreSQL 数据库 | 数据库名必须以 `qianshu_dms_shadow_` 开头 |
| `APP_ORIGIN` | Web 的精确 origin；production 必须使用 HTTPS | `http://127.0.0.1:9000` |
| `TRUST_PROXY_HOPS` | 可信反向代理跳数，只允许 `0` 到 `2` | `0` |
| `AUTH_ARGON2_CONCURRENCY` | 单实例同时执行的 Argon2 上限 | `2` |
| `AUTH_ARGON2_QUEUE_LIMIT` | 单实例等待 Argon2 的队列上限 | `32` |
| `AUTH_USERNAME_HMAC_KEY` | username 限流主体 Hash key；production 必填 | development 留空时进程随机生成 |
| `AUTH_USER_ID_HMAC_KEY` | user ID 限流与审计主体 Hash key；production 必填且不得与其他 key 相同 | development 留空时进程随机生成 |
| `AUTH_IP_HMAC_KEY` | IP 限流与审计主体 Hash key；production 必填且不得与其他 key 相同 | development 留空时进程随机生成 |
| `MEDIA_STORAGE_DRIVER` | 媒体存储驱动；首期只允许 `local` | `local` |
| `MEDIA_STORAGE_ROOT` | release、源码和系统临时目录之外的绝对持久路径 | `/var/lib/qianshu-dms/media` |
| `MEDIA_CONTENT_DELIVERY_MODE` | 私有内容交付；`application` 由 Server 流式输出，`internal_redirect` 交给 Nginx | development 使用 `application`，production 默认 `internal_redirect` |
| `MEDIA_STAGING_TTL_HOURS` | 未完成 staging 的回收期限，只允许 `1` 到 `168` | `24` |
| `MEDIA_TRASH_RETENTION_DAYS` | 软删除保留天数，只允许 `7` 到 `3650` | `7` |
| `MEDIA_FFPROBE_PATH` | 受限 MP4 探测器的绝对可执行路径 | `/usr/bin/ffprobe` |
| `MEDIA_QPDF_PATH` | 受限 PDF 结构探测器的绝对可执行路径 | `/usr/bin/qpdf` |

三个 HMAC key 在 production 必须分别使用独立的 32-byte canonical base64url 值。具体必填条件与边界以 `.env.example` 和 `src/config/env.validation.ts` 为真相源；README 不保存真实值。

Local media root 由部署侧预创建并设置运行用户权限；`internal_redirect` 模式还需配置 Nginx 读取组。
Server 会在实际启用存储时校验
realpath、symlink、可写性、同一文件系统和剩余空间。不得把示例路径改为源码、release 或系统临时目录，
也不得把实际 root 或其下文件名写入日志。

## 常用命令

```bash
pnpm -C server dev
pnpm -C server check
pnpm -C server build
pnpm -C server openapi:generate
pnpm -C server test:e2e
pnpm -C server db:migrate:dev
pnpm -C server db:migrate:deploy
pnpm -C server auth:bootstrap-admin
pnpm -C server auth:recover-admin
pnpm -C server auth:cleanup
pnpm -C server media:cleanup:expired-trash
pnpm -C server media:ops:health
pnpm -C server media:recovery:dry-run
```

- `check` 与 `build` 只验证工程和单元测试，不连接数据库；它们在未设置 `DATABASE_URL` 时也应可执行。
- `test:e2e` 面向真实 PostgreSQL，调用前必须通过当前进程环境提供测试数据库连接，且测试数据库必须与个人或生产数据库隔离。
- `prisma:drift:check` 使用 migration history 重放后的物理结构与 `DATABASE_URL` 比较。执行前必须临时提供 `SHADOW_DATABASE_URL`；Prisma 会重置该数据库，因此它不得指向业务库，且使用后应删除。wrapper 会拒绝同库目标和不符合 `qianshu_dms_shadow_` 命名边界的数据库，并原样传播 drift 退出码。
- `dev` 与 `start` 会先生成 Prisma Client，再启动 NestJS。
- `start:prod` 直接执行已经构建的 `dist/main.js`，不会生成 Prisma Client；部署流程必须先完成安装、生成与构建。
- `auth:bootstrap-admin` 只用于首次创建 `system_admin`；`auth:recover-admin` 只用于已有 `system_admin` 的离线密码恢复。两者都要求本机交互式 TTY，密码不得通过 argv、环境变量或脚本传入。
- `auth:cleanup` 由单一外部 Cron 定期调用，用于小批清理过期 Session 和限流数据；API 实例不会自行启动清理定时器。
- `media:cleanup:expired-trash`、`media:ops:health` 与 `media:recovery:dry-run` 运行已构建的 `dist`；清理命令
  仅处理已经超过保留期且再次确认零引用的 `TRASHED` 文件，任一 failed/isolated 均非零退出；health 输出
  read/write/video validator 与容量健康合同，dry run 只读校验恢复后的数据库引用、文件位置、size 和
  checksum。完整部署、监控、备份与恢复边界见
  [`媒体存储部署与恢复`](../docs/后端文档/媒体存储部署与恢复.md)。

## 接口契约

- Server Controller、DTO 和 OpenAPI decorators 是定义真相源，正式快照为 `server/openapi/openapi.json`。
- `openapi:generate` 先执行 `pnpm build`（包含 `prisma generate`），再使用 preview application 离线生成快照。preview application 本身不读取 `.env`、不连接数据库、不监听端口；若要求包括前置 Prisma 构建在内的整个命令都不加载本地环境文件，需显式设置 `DOTENV_CONFIG_PATH=/dev/null`。
- 每个 response 都携带 Server-generated `X-Request-Id`；除 Terminus health failure 的严格豁免外，应用级 JSON 错误统一为 `ApiError`。
- 正式运行时不开放 Swagger route 或 Swagger UI；OpenAPI 仅通过提交 Git 的 snapshot 交付。
- 跨端更新从仓库根使用 `node --run contract:sync`，只读验证使用 `node --run contract:check`。不要手工编辑 snapshot。

详细规则见 [`docs/后端文档/接口契约规范.md`](../docs/后端文档/接口契约规范.md)。

## 边界约束

Server 不通过 `file:`、`link:`、`portal:`、`workspace:*` 或源码路径引用根目录与 `web/`。`pnpm-workspace.yaml` 不得声明 `packages`；跨端协作只通过 HTTP 与 OpenAPI 契约完成。

## CI、发布与部署边界

- 正式 Server 归档只承诺 `Ubuntu 24.04` / `glibc` / `x64` / `Node 24` 运行时兼容范围；不将 Alpine / `musl`、其他 CPU 架构或其他 Node.js 大版本视为已验证能力。
- Release 流程仅验证、构建、归档、smoke test 和发布 GitHub Release，不会自动部署，不连接生产数据库，也不执行生产 migration。归档 smoke test 中的 `pnpm -C server db:migrate:deploy` 只作用于隔离的临时 CI PostgreSQL。
- 实际生产部署和 production migration 由部署系统或运维流程在审查后单独执行，不属于当前 GitHub Release 的自动化边界。
- 生产宿主机安全、运行依赖、备份恢复、放量和回滚必须先通过 [`生产部署与 Gate OPS 检查清单`](<../docs/全局文档/生产部署与Gate OPS检查清单.md>)；历史快照和 Release 成功不能替代实时生产证据。
- 阶段五代码与本地验证已实施，GitHub 平台验证以 Task 14 记录为准。
