# 千树 DMS

千树 DMS 是面向业务管理场景的前后端一体化项目。项目使用一个 Git 仓库统一管理工程治理、中文文档、Web 和 Server，但根目录不是 pnpm workspace。`server/` 与 `web/` 已分别建立独立依赖域，可以单独安装、检查和构建；根命令只负责无依赖编排。

## 工程边界

- 根目录只负责 Git 治理、中文文档和统一命令门面，不安装第三方依赖。
- `server/` 是独立的 NestJS 11 CommonJS 单一 package，拥有自己的 `package.json`、`pnpm-lock.yaml` 和 pnpm 11 安全配置。
- `web/` 是独立 pnpm workspace；`apps/qsmds-arco/` 是唯一正式业务应用，三个初始基座位于 `examples/`。
- Web 与 Server 不通过 `file:`、`link:`、`workspace:*` 或跨目录源码引用建立依赖，只通过 HTTP 协作。
- 当前 Server 提供数据库健康检查 `GET /api/health`；业务 API 与 OpenAPI 契约将在阶段四实施。
- 两端可以分别构建；部署流程与发布关联将在阶段五实施，根命令只负责协调，不改变各自的依赖边界。

## 环境要求

- Node.js 24，根命令要求 `^24.15.0`，可通过 `.node-version` 选择主版本。
- pnpm 11.9.0，以根 `package.json` 的 `packageManager` 字段为准。

根目录不执行 `pnpm install`，也不应生成根 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 或 `node_modules/`。

## 独立安装

从仓库根目录分别安装两个依赖域：

```bash
pnpm -C server install --frozen-lockfile
pnpm -C web install --frozen-lockfile
```

也可以使用根编排入口按 Server、Web 的顺序安装：

```bash
node --run bootstrap
```

复制 `server/` 或 `web/` 到其他位置后，应在复制目录内执行自身的 `pnpm install --frozen-lockfile`，并保留对应 `package.json`、workspace 安全配置和 lockfile。

## 根命令

| 命令 | 说明 |
| --- | --- |
| `node --run bootstrap` | 按 Server、Web 的顺序安装两个独立依赖域。 |
| `node --run dev` | 同时启动 Server 与 Web 开发进程。 |
| `node --run dev:server` | 仅启动 Server。 |
| `node --run dev:web` | 仅启动 Web。 |
| `node --run test:root` | 运行根级治理与编排测试。 |
| `node --run check` | 运行阶段内已经建立的根级、Server 和 Web 检查。 |
| `node --run check:server` | 仅运行 Server 检查。 |
| `node --run check:web` | 仅运行 Web 检查。 |
| `node --run build` | 依次构建 Server 与 Web。 |
| `node --run build:server` | 仅构建 Server。 |
| `node --run build:web` | 仅构建 Web。 |

pnpm 11 的 `verifyDepsBeforeRun` 默认行为会在执行 package script 前尝试 install，即使根 package 没有依赖，也会生成根 `pnpm-lock.yaml` 和 `node_modules/` 状态文件。因此根公开 scripts 统一通过 Node.js 22+ 提供的 `node --run <script>` 执行；只有 Server 和 Web 独立依赖域继续使用 `pnpm -C`。

## 检查与构建

两端可以分别验证：

```bash
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server check
pnpm -C web check
pnpm -C server build
pnpm -C web build
```

`server check` 包含 Prisma schema 校验、typecheck、只读 lint 与 unit tests，不连接数据库，也不运行 E2E。完整根编排使用：

```bash
node --run test:root
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null node --run check
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null node --run build
```

## 数据库 migration 与 E2E

migration 和 E2E 必须使用全新、隔离的 PostgreSQL 16 测试数据库，并仅通过当前进程环境注入 `DATABASE_URL`。不要连接个人持久数据库、共享环境或生产数据库。

先在同一个受控 shell 中通过密钥管理或临时容器流程 export 该测试库的 `DATABASE_URL`，再在启动任何 Prisma 或 Nest 命令前执行不回显原值的必填检查：

```bash
: "${DATABASE_URL:?DATABASE_URL must reference the isolated test database}"
export DOTENV_CONFIG_PATH=/dev/null
unset DEBUG
```

`DOTENV_CONFIG_PATH=/dev/null` 只阻止 `prisma.config.ts` 中的 `dotenv/config` 回退到本地文件；Nest `ConfigModule` 仍可读取 `server/.env`，因此上述 shell guard 必须先于 `test:e2e` 执行，使已注入的临时 URL 拥有明确优先级。

在安全临时数据库已经就绪且 migration 尚未应用时执行：

```bash
pnpm -C server db:migrate:deploy
pnpm -C server exec prisma migrate status
pnpm -C server test:e2e
```

临时数据库必须使用随机凭据、动态 loopback 端口和异常安全的清理 `trap`；命令和日志不得打印连接 URL 或密码。具体流程见 [数据库迁移规范](./docs/后端文档/数据库迁移规范.md)。

## 本地开发

准备本地 `server/.env` 后，可以分别运行：

```bash
pnpm -C server dev
pnpm -C web dev
```

也可以由根入口同时启动并统一转发终止信号：

```bash
node --run dev
```

真实 `.env` 均已忽略，只能从 `.env.example` 或 `.env.*.example` 创建本地副本。浏览器可见的 `VITE_` 变量也不能存放 token、密码或数据库连接。

## 安全提示

- 不硬编码密钥、token、密码或数据库连接信息。
- 不提交真实 `.env` 文件，只提交不含真实密钥的 `.env.example` 或 `.env.*.example`。
- 日志不得输出 token、密码、连接字符串、Cookie 或完整敏感请求体。
- 公共 API、数据结构、数据库 schema 或文件删除必须先获得确认。

## 项目文档

正式文档统一使用中文目录名和中文文件名，并收录在 [项目文档索引](./docs/文档索引.md) 中。主要入口：

- [项目工程组织方案](./docs/全局文档/项目工程组织方案.md)
- [前端架构](./docs/前端文档/前端架构.md)
- [后端架构](./docs/后端文档/后端架构.md)
- [数据库迁移规范](./docs/后端文档/数据库迁移规范.md)
