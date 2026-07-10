# 千树 DMS Server 协作规则

本文件约束 `server/` 及其全部子目录；若与仓库根 `AGENTS.md` 冲突，以更严格的安全与工程边界为准。

## 独立依赖域

- `server/` 是单一 pnpm package，独立维护 `package.json`、`pnpm-lock.yaml` 与 `node_modules/`。
- `pnpm-workspace.yaml` 仅承载 pnpm 11 的单 package 安全配置，不得声明 `packages`，也不得形成多 package dependency graph。
- 不在 `package.json` 声明 `workspaces`，不使用 `file:`、`link:`、`portal:` 或 `workspace:*` 依赖。
- 禁止引用仓库根目录或 `web/` 的源码、生成物和依赖目录；前后端只通过 HTTP 与 OpenAPI 契约协作。
- 只能在 `server/` 内安装依赖；禁止从仓库根目录执行 `pnpm install`。
- 仓库根没有 `pnpm-workspace.yaml`，所以 Server 配置不构成根级嵌套 workspace。

## 依赖安装安全

- `allowBuilds` 只允许已审查的 `prisma` 与 `@prisma/engines` 运行 build script。
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

## 开发与测试

- 新功能、BUG 修复和复杂改动遵循 TDD：先写失败测试，再实现最小改动，最后在测试保持通过时重构。
- 非直观的生命周期、失败传播和安全边界必须写详细中文代码注释；技术标识、变量名、命令和日志保持英文。
- `pnpm check` 包含 schema 校验、typecheck、只读 lint 与单元测试，不包含需要真实数据库的 E2E。
- E2E 必须使用隔离的真实 PostgreSQL 测试数据库，并通过进程环境注入 `DATABASE_URL`。
- `lint` 不得修改文件；只有明确执行 `pnpm lint:fix` 时才允许自动修复。

## 安全红线

- 不硬编码或提交密码、token、连接字符串、Cookie 与真实 `.env`。
- 日志、异常响应和测试输出不得包含 `DATABASE_URL`、数据库密码或底层敏感错误详情。
- 不提交 `node_modules/`、`dist/`、`coverage/`、`src/generated/prisma/` 或 `*.log`。
- 新增或修改公共 API、公共数据结构及数据库 schema 前，必须单独获得用户确认。
