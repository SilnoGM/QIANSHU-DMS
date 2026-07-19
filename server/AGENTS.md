# 千树 DMS Server 协作规则

本文件约束 `server/` 及其全部子目录；若与仓库根 `AGENTS.md` 冲突，以更严格的安全与工程边界为准。

## 独立依赖域

- `server/` 是单一 pnpm package，独立维护 `package.json`、`pnpm-lock.yaml` 与 `node_modules/`。
- `pnpm-workspace.yaml` 承载 pnpm 11 的单 package 安全与 production deploy 配置，不得声明 `packages`，也不得形成多 package dependency graph。
- 不在 `package.json` 声明 `workspaces`，不使用 `file:`、`link:`、`portal:` 或 `workspace:*` 依赖。
- 禁止引用仓库根目录或 `web/` 的源码、生成物和依赖目录；前后端只通过 HTTP 与 OpenAPI 契约协作。
- 只能在 `server/` 内安装依赖；禁止从仓库根目录执行 `pnpm install`。
- 仓库根没有 `pnpm-workspace.yaml`，所以 Server 配置不构成根级嵌套 workspace。

## 依赖安装安全

- `server/pnpm-workspace.yaml` 的当前配置必须与已验证的安装和部署语义保持一致：

  ```yaml
  injectWorkspacePackages: true
  allowBuilds:
    '@prisma/engines': true
    # Swagger UI 的 Scarf 脚本仅用于安装分析；明确拒绝执行，保证 fresh install 可重复且不发送遥测。
    '@scarf/scarf': false
    # argon2 通过 node-gyp-build 选择已发布的 N-API 预构建二进制；密码 Hash/verify 需要其原生实现。
    argon2: true
    prisma: true
  ```

- `allowBuilds` 只允许已审查的 `prisma`、`@prisma/engines` 与 `argon2` 运行 build script；`@scarf/scarf` 被明确拒绝。
- `injectWorkspacePackages` 只服务现代 production deploy：正式 Server 归档使用 `pnpm deploy --prod`，不得使用 `--legacy`。
- 该配置不得借机新增 `packages`、扩张 Server workspace 或把 Root / Web 纳入依赖图；Root、Server 与 Web 继续保持独立依赖域。
- 新增带 build script 的依赖时，必须先审查固定版本、脚本内容和工程必要性，再精确添加包名。
- 禁止使用 `dangerouslyAllowAllBuilds`、通配 matcher、`strictDepBuilds: false` 或其他全局放开策略。
- pnpm 自动生成的占位值和临时 `minimumReleaseAgeExclude` 不得提交；依赖版本必须选择可通过既定供应链策略的版本。

## 架构边界

- 请求处理方向固定为 `Controller -> Service -> PrismaService -> PostgreSQL`。
- 当前阶段不预先引入 Repository、UseCase、Domain Entity 或其他业务尚未需要的抽象。
- Controller 负责协议边界，Service 负责业务编排，`PrismaService` 负责数据库客户端和连接池生命周期。
- Prisma Client 生成到 `src/generated/prisma/`，生成目录不得提交。

## 数据库迁移

- `prisma/schema.prisma` 与 `prisma/migrations/` 必须纳入 Git。
- migration 一旦提交并在共享环境应用即视为不可变；禁止修改、重命名或删除已有 migration。
- 开发环境使用 `pnpm db:migrate:dev` 创建 migration；测试、CI 和部署环境仅使用 `pnpm db:migrate:deploy` 应用既有 migration。
- 新增或修改数据库 schema 前，必须单独获得用户确认。

## 接口契约

- Controller、DTO 和 OpenAPI decorators 是定义真相源；`server/openapi/openapi.json` 是生成快照，不得手工修改。
- 公共 operation 必须有稳定 `operationId`、真实 `x-qianshu-contract` 元数据、明确成功 response 和适用的 `ApiError` 错误矩阵。
- response 使用 `ApiContractResponse` 声明并携带 `X-Request-Id`；`204` 禁止 body，binary 必须声明实际 media type。
- `openapi:generate` 先完成包含 `prisma generate` 的 build，再通过 preview application 离线生成；preview 本身不读取 `.env`、不连接数据库、不监听端口。需要隔离整个命令时显式设置 `DOTENV_CONFIG_PATH=/dev/null`。
- 正式运行时不开放 Swagger route 或 Swagger UI；snapshot 只从根 `contract:sync` 跨端同步，由 `contract:check` 只读验证。
- 不在 OpenAPI、错误 body、日志或测试输出中泄露密码、token、连接字符串、SQL、堆栈或底层异常。
- 新增或修改公共 API、数据结构、错误 code 或 response schema 前，必须单独获得用户确认。

## 开发与测试

- 新功能、BUG 修复和复杂改动遵循 TDD：先写失败测试，再实现最小改动，最后在测试保持通过时重构。
- 非直观的生命周期、失败传播和安全边界必须写详细中文代码注释；技术标识、变量名、命令和日志保持英文。
- `pnpm check` 包含 schema 校验、typecheck、只读 lint 与单元测试，不包含需要真实数据库的 E2E。
- E2E 必须使用隔离的真实 PostgreSQL 测试数据库，并通过进程环境注入 `DATABASE_URL`。
- `lint` 不得修改文件；只有明确执行 `pnpm lint:fix` 时才允许自动修复。

## CI、发布与部署

- 正式 Server 归档只支持 `Ubuntu 24.04` / `glibc` / `x64` / `Node 24`；Alpine / `musl`、其他 CPU 架构和其他 Node.js 大版本不得标记为已验证。
- Release 工作流可以在隔离的临时 CI PostgreSQL 中执行归档 smoke test，但不得连接生产数据库或执行生产 migration。
- 当前 GitHub Release 不包含自动部署；实际部署与 production migration 必须在下游运维流程中单独审查和执行。
- 阶段五代码与本地验证已实施，GitHub 平台验证以 Task 14 记录为准。

## 安全红线

- 不硬编码或提交密码、token、连接字符串、Cookie 与真实 `.env`。
- 日志、异常响应和测试输出不得包含 `DATABASE_URL`、数据库密码或底层敏感错误详情。
- 不提交 `node_modules/`、`dist/`、`coverage/`、`src/generated/prisma/` 或 `*.log`。
- 新增或修改公共 API、公共数据结构及数据库 schema 前，必须单独获得用户确认。
