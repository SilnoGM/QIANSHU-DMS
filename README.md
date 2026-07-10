# 千树 DMS

千树 DMS 是面向业务管理场景的前后端一体化项目。本仓库采用组合式仓库组织方式：使用一个 Git 仓库统一管理工程治理、项目文档、Web 和 Server，但不把根目录建设为 pnpm workspace。

## 工程边界

- 根目录只负责 Git 治理、中文文档和统一命令门面，不安装第三方依赖。
- `server/` 将作为独立的 NestJS 应用，在初始化完成后拥有自己的 `package.json` 和 `pnpm-lock.yaml`。
- `web/` 已是独立的 pnpm workspace，拥有自己的 workspace 配置和 `pnpm-lock.yaml`。
- Web 与 Server 不通过 `file:`、`link:` 或跨目录源码引用建立依赖，只通过 HTTP 和 OpenAPI 契约协作。
- 两端应能够分别安装、检查、构建和发布；根命令只负责协调，不改变各自的依赖边界。

## 环境要求

- Node.js 24，根命令要求 `^24.15.0`，可通过 `.node-version` 选择主版本。
- pnpm 11.9.0，以根 `package.json` 的 `packageManager` 字段为准。

根目录不执行 `pnpm install`，也不应生成根 `pnpm-lock.yaml`、`pnpm-workspace.yaml` 或 `node_modules/`。

## 根命令

| 命令 | 说明 |
| --- | --- |
| `pnpm bootstrap` | 按 Server、Web 的顺序安装两个独立依赖域。 |
| `pnpm dev` | 同时启动 Server 与 Web 开发进程。 |
| `pnpm dev:server` | 仅启动 Server。 |
| `pnpm dev:web` | 仅启动 Web。 |
| `pnpm run test:root` | 运行根级治理与编排测试。 |
| `pnpm check` | 运行阶段内已经建立的根级、Server 和 Web 检查。 |
| `pnpm run check:server` | 仅运行 Server 检查。 |
| `pnpm run check:web` | 仅运行 Web 检查。 |
| `pnpm build` | 依次构建 Server 与 Web。 |

当前处于根级工程治理阶段，`server/` 尚未初始化。除 `pnpm run test:root` 外，其余根命令依赖后续任务中的编排脚本或尚未建立的 Server/Web 命令，因此暂不以真实全链路成功作为本阶段验收条件。

## 安全提示

- 不硬编码密钥、token、密码或数据库连接信息。
- 不提交真实 `.env` 文件，只提交不含真实密钥的 `.env.example` 或 `.env.*.example`。
- 日志不得输出 token、密码、连接字符串、Cookie 或完整敏感请求体。
- 公共 API、数据结构、数据库 schema 或文件删除必须先获得确认。

## 项目文档

正式文档统一使用中文目录名和中文文件名，并收录在 [项目文档索引](./docs/文档索引.md) 中。
