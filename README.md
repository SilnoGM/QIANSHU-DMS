# 千树 DMS

千树 DMS 是面向业务管理场景的前后端一体化项目。项目使用一个 Git 仓库统一管理工程治理、中文文档、Web 和 Server，但根目录不是 pnpm workspace。`server/` 与 `web/` 已分别建立独立依赖域，可以单独安装、检查和构建；根命令只负责无依赖编排。

## 工程边界

- 根目录只负责 Git 治理、中文文档和统一命令门面，不安装第三方依赖。
- `server/` 是独立的 NestJS 11 CommonJS 单一 package，拥有自己的 `package.json`、`pnpm-lock.yaml` 和 pnpm 11 安全配置。
- `web/` 是独立 pnpm workspace；`apps/qsmds-arco/` 是唯一正式业务应用，三个初始基座位于 `examples/`。
- Web 与 Server 不通过 `file:`、`link:`、`workspace:*` 或跨目录源码引用建立依赖，只通过 HTTP 协作。
- 当前 Server 提供 `GET /api/health`、Cookie Session 认证、用户与密码管理、RBAC、审计查询、Server-generated `X-Request-Id`、统一 `ApiError` 和离线 OpenAPI 契约；正式快照通过根命令与 Web 同步。
- 两端可以分别构建；阶段五已经实现统一 CI 与 Release 的代码及本地验证，根命令只负责协调，不改变各自的依赖边界，也不执行自动部署。

## 环境要求

- Node.js 24，根命令要求 `^24.15.0`，可通过 `.node-version` 选择主版本。
- pnpm 11.9.0，以根 `package.json` 的 `packageManager` 字段为准。

根目录不执行 `pnpm install`，也不应生成根 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`node_modules/` 或 `.pnpm-store/`。

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
| `node --run cleanup:root` | 审查并自动删除四类精确根违规产物。 |
| `node --run dev` | 同时启动 Server 与 Web 开发进程。 |
| `node --run dev:server` | 仅启动 Server。 |
| `node --run dev:web` | 仅启动 Web。 |
| `node --run contract:sync` | 生成、验证并事务式同步 Server/Web OpenAPI 快照与 Web types。 |
| `node --run contract:check` | 在临时目录只读检查快照、契约结构与生成类型。 |
| `node --run ci:server-e2e` | 使用隔离 PostgreSQL 16 临时数据库执行 migration、Server E2E 和清理检查。 |
| `node --run ci:browser-auth-e2e` | 使用隔离 PostgreSQL、真实 Server/Web 和系统 Chrome 验证 Cookie 认证链路。 |
| `node --run ci:contract` | 使用 Git 基线执行 OpenAPI breaking-change 检查。 |
| `node --run release:check` | 校验统一产品版本、严格 SemVer Tag 与 Tag Commit。 |
| `node --run release:package:web` | 归档已构建的正式 Web 产物。 |
| `node --run release:package:server` | 归档已构建的 Server production 产物。 |
| `node --run release:smoke:server` | 在隔离 PostgreSQL 16 临时数据库上验证 Server Release 产物。 |
| `node --run release:manifest` | 生成并校验 Release Manifest 与 `SHA256SUMS`。 |
| `node --run release:publish` | 按受控 Draft 恢复规则发布 GitHub Release。 |
| `node --run test:root` | 运行根级治理与编排测试。 |
| `node --run check` | 依次运行 Root、Server、Contract、Web 和真实浏览器认证检查。 |
| `node --run check:server` | 仅运行 Server 检查。 |
| `node --run check:web` | 仅运行 Web 检查。 |
| `node --run build` | 依次构建 Server 与 Web。 |
| `node --run build:server` | 仅构建 Server。 |
| `node --run build:web` | 仅构建 Web。 |

pnpm 11 的 `verifyDepsBeforeRun` 默认行为会在执行 package script 前尝试 install，即使根 package 没有依赖，也会生成根 `pnpm-lock.yaml` 和 `node_modules/` 状态文件。因此根公开 scripts 统一通过 Node.js 22+ 提供的 `node --run <script>` 执行；只有 Server 和 Web 独立依赖域继续使用 `pnpm -C`。

`cleanup:root` 的自动删除范围严格限定为根 `pnpm-workspace.yaml`、`pnpm-lock.yaml`、`node_modules/` 和 `.pnpm-store/`。根 `dev*` 与 `check` 入口会先调用同一清理器；它不会扫描或删除 `web/`、`server/` 以及其他根文件。清理失败会返回非零状态并阻止后续启动或检查。

在 macOS 与 Linux 上，三个根 `dev*` 命令通过独立进程组管理 pnpm、Nest/Vite 和后代进程，并统一处理 `SIGHUP`、`SIGINT`、`SIGTERM` 以及外层 `node --run` 提前退出。根编排以可靠启动和完整清理为目标，不保证把终端键盘快捷操作传给 detached 子进程；需要使用 Nest/Vite 交互式快捷操作时，直接执行 `pnpm -C server dev` 或 `pnpm -C web dev`。

## 接口契约

Server Controller、DTO 和 OpenAPI decorators 是定义真相源。`server/openapi/openapi.json` 与 `web/openapi/openapi.json` 是提交 Git 的两端快照，必须保持字节一致；Web 从自身快照生成 ignored `web/apps/qsmds-arco/src/api/generated/types.gen.ts`，不跨目录读取 Server 源码。

```bash
node --run contract:sync
node --run contract:check
pnpm -C web api:generate
```

- `contract:sync` 是两端快照唯一显式写同步入口，并同时验证 Web types-only 产品。
- `contract:check` 将待比较的 snapshot 和 Web types 生成到临时目录，不修改跟踪文件；前置 Server build 仍可重建 ignored `server/dist/` 与 Prisma Client。可使用 `node --run contract:check -- --baseline server/openapi/openapi.json` 保护已有 `operationId`。
- `api:generate` 只读 Web 自身快照，generated directory 必须精确只含非空 `types.gen.ts`，不得手工修改或提交。
- 正式运行时不开放 Swagger route；完整规则见[后端接口契约规范](./docs/后端文档/接口契约规范.md)和[前端接口接入规范](./docs/前端文档/接口接入规范.md)。

## 检查与构建

两端可以分别验证：

```bash
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server check
pnpm -C web check
pnpm -C server build
pnpm -C web build
```

`server check` 包含 Prisma schema 校验、typecheck、只读 lint 与 unit tests，不连接数据库，也不运行 E2E。根 `check` 在 Server check 后运行只读 contract check、Web check 和隔离的真实浏览器认证 E2E；数据库 Server E2E 仍使用独立入口。完整根编排使用：

```bash
node --run test:root
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null node --run check
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null node --run build
```

## CI 与发布

当前仓库只有三份 GitHub Actions workflow：`.github/workflows/ci.yml` 负责 Root、Server、PostgreSQL E2E、Contract、Web 和 Browser auth E2E 六个验证 Job，`.github/workflows/examples.yml` 负责三个参考应用，`.github/workflows/release.yml` 负责严格 SemVer Annotated Tag 触发的统一产品发布。正式 Release 始终从同一个 Tag Commit 重新构建 Web 与 Server，不复用普通 CI 产物，也不允许两端选择性沿用旧版本。

根目录仍不执行 `pnpm install`；以下入口只使用 Node.js 标准库编排两个独立依赖域：

- CI 验证入口：`node --run ci:server-e2e`、`node --run ci:browser-auth-e2e`、`node --run ci:contract`。
- Release 准备与打包入口：`node --run release:check`、`node --run release:package:web`、`node --run release:package:server`、`node --run release:smoke:server`。
- Release 清单与发布入口：`node --run release:manifest`、`node --run release:publish`。

`release:package:*` 只归档已构建产物，单独执行前必须先完成对应 build：Web 使用 `node --run build:web`，Server 使用 `node --run build:server`。正式 `release.yml` 已在两个 package Job 内显式先执行 build，再调用归档入口。

`v0.1.2` 已完成 GitHub 平台验收：source Commit 为 `ec418b8a7dca9c0da51770f6559813f3c7059077`，Main CI Run `29317624359`、Examples Run `29240879781` 与 Release Run `29317866199` attempt `2` 均成功。Job ID `ci-gate` 对应的平台 Required Check context 为 `CI gate`；`v*.*.*` Tag ruleset、Actions 默认 `contents: read` 和 Release immutability 已生效。

Release workflow 只生成并发布可校验附件，不连接生产数据库、不执行 production migration，也不自动部署 Web 或 Server。版本准备、Annotated Tag、附件校验、Draft 恢复和管理员配置详见[发布与版本管理](./docs/全局文档/发布与版本管理.md)。

## 数据库 migration 与 E2E

migration 和 E2E 必须使用全新、隔离的 PostgreSQL 16 测试数据库，并仅通过当前进程环境注入 `DATABASE_URL`。不要连接个人持久数据库、共享环境或生产数据库。

先在同一个受控 shell 中通过密钥管理或临时容器流程 export 该测试库的 `DATABASE_URL`，再在启动任何 Prisma 或 Nest 命令前执行不回显原值的必填检查：

```bash
: "${DATABASE_URL:?DATABASE_URL must reference the isolated test database}"
export DOTENV_CONFIG_PATH=/dev/null
unset DEBUG
unset PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
```

`DOTENV_CONFIG_PATH=/dev/null` 只阻止 `prisma.config.ts` 中的 `dotenv/config` 回退到本地文件；Nest `ConfigModule` 仍可读取 `server/.env`，因此上述 shell guard 必须先于 `test:e2e` 执行，使已注入的临时 URL 拥有明确优先级。

同时清除 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`，避免当前 shell 继承过往会话对 Prisma 危险操作的确认状态。临时验证流程不得预授权破坏性数据库操作。

在安全临时数据库已经就绪且 migration 尚未应用时执行：

```bash
pnpm -C server db:migrate:deploy
pnpm -C server exec prisma migrate status
pnpm -C server test:e2e
```

临时数据库必须使用随机凭据、动态 loopback 端口和异常安全的清理 `trap`；命令和日志不得打印连接 URL 或密码。具体流程见 [数据库迁移规范](./docs/后端文档/数据库迁移规范.md)。

## 本地开发

首次本地使用时，先从 `server/.env.example` 创建被 Git 忽略的 `server/.env`，配置开发 PostgreSQL 的 `DATABASE_URL`。确认目标是允许写入的本地开发库后，应用已提交 migration、构建交互式管理命令并初始化首个 `system_admin`：

```bash
pnpm -C server db:migrate:deploy
pnpm -C server build
pnpm -C server auth:bootstrap-admin
```

`auth:bootstrap-admin` 只接受交互式 TTY，永久密码使用隐藏输入并二次确认，不得放入 argv、环境变量或日志。数据库已经存在 `system_admin` 时不要重复初始化；离线恢复使用同样需要先构建的 `pnpm -C server auth:recover-admin`。

完成首次初始化后，可以分别运行：

```bash
pnpm -C server dev
pnpm -C web dev
```

也可以由根入口同时启动并统一转发终止信号：

```bash
node --run dev
```

只启动一端时可使用 `node --run dev:server` 或 `node --run dev:web`；需要直接操作该端 CLI 的键盘快捷功能时，继续使用上方对应的 `pnpm -C` 命令。

真实 `.env` 均已忽略，只能从 `.env.example` 或 `.env.*.example` 创建本地副本。浏览器可见的 `VITE_` 变量也不能存放 token、密码或数据库连接。

## 安全提示

- 不硬编码密钥、token、密码或数据库连接信息。
- 不提交真实 `.env` 文件，只提交不含真实密钥的 `.env.example` 或 `.env.*.example`。
- 日志不得输出 token、密码、连接字符串、Cookie 或完整敏感请求体。
- 公共 API、数据结构、数据库 schema 或文件删除必须先获得确认。

## 项目文档

正式文档统一使用中文目录名和中文文件名，并收录在 [项目文档索引](./docs/文档索引.md) 中。主要入口：

- [项目工程组织方案](./docs/全局文档/项目工程组织方案.md)
- [开发工作流](./docs/全局文档/开发工作流.md)
- [发布与版本管理](./docs/全局文档/发布与版本管理.md)
- [生产部署与 Gate OPS 检查清单](<./docs/全局文档/生产部署与Gate OPS检查清单.md>)
- [腾讯云 1Panel 部署手册](./docs/全局文档/腾讯云1Panel部署手册.md)
- [工程归档索引](./docs/工程归档/归档索引.md)
- [前端架构](./docs/前端文档/前端架构.md)
- [后端架构](./docs/后端文档/后端架构.md)
- [数据库迁移规范](./docs/后端文档/数据库迁移规范.md)
- [后端接口契约规范](./docs/后端文档/接口契约规范.md)
- [前端接口接入规范](./docs/前端文档/接口接入规范.md)
