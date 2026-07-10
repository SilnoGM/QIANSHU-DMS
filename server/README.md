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

## pnpm 11 单 package 安全配置

pnpm 11 使用 `pnpm-workspace.yaml` 保存项目级安装安全设置，即使当前项目只有一个 package。这里的文件只精确允许 Prisma 已审查的 `prisma` 与 `@prisma/engines` 运行安装脚本：

```yaml
allowBuilds:
  '@prisma/engines': true
  prisma: true
```

- 文件不声明 `packages`，因此不会形成多 package dependency graph。
- 仓库根目录没有 `pnpm-workspace.yaml`，所以 Server 安全配置不会把根目录、`web/` 或其他目录纳入嵌套 workspace。
- 新增带 build script 的依赖前，必须审查包名、固定版本、脚本内容和必要性，再决定是否精确加入 `allowBuilds`。
- 禁止使用 `dangerouslyAllowAllBuilds`、通配 matcher 或其他全局放开策略。

## 环境变量

将 `.env.example` 复制为本地 `.env`，并在本地填写真实配置。严禁提交 `.env` 或在日志中输出连接字符串。

| 变量 | 用途 | 示例模板 |
| --- | --- | --- |
| `NODE_ENV` | 运行环境 | `development` |
| `PORT` | HTTP 监听端口 | `3000` |
| `DATABASE_URL` | PostgreSQL 连接字符串 | 模板保持为空 |

## 常用命令

```bash
pnpm -C server dev
pnpm -C server check
pnpm -C server build
pnpm -C server test:e2e
pnpm -C server db:migrate:dev
pnpm -C server db:migrate:deploy
```

- `check` 与 `build` 只验证工程和单元测试，不连接数据库；它们在未设置 `DATABASE_URL` 时也应可执行。
- `test:e2e` 面向真实 PostgreSQL，调用前必须通过当前进程环境提供测试数据库连接，且测试数据库必须与个人或生产数据库隔离。
- `dev` 与 `start` 会先生成 Prisma Client，再启动 NestJS。
- `start:prod` 直接执行已经构建的 `dist/main.js`，不会生成 Prisma Client；部署流程必须先完成安装、生成与构建。

## 边界约束

Server 不通过 `file:`、`link:`、`portal:`、`workspace:*` 或源码路径引用根目录与 `web/`。`pnpm-workspace.yaml` 不得声明 `packages`；跨端协作只通过 HTTP 与 OpenAPI 契约完成。
