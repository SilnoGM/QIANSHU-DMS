# 千树 DMS Web 协作规则

本文件约束 `web/` 独立工作区内的开发活动。仓库根规则仍然适用；若两者冲突，以约束更严格者为准。

## 工作区定位

- `web/` 是可独立移植、安装、构建和发布的 pnpm workspace，拥有自己的 `package.json`、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml`。
- `web/` 不依赖仓库根目录或 `server/` 的依赖安装状态，不得通过跨目录源码引用、`file:`、`link:` 或跨工作区 `workspace:*` 连接 Server。
- 唯一正式业务应用是 `apps/qsmds-arco`。未明确指定目标时，正式需求默认在该应用实施，无需再次询问应用位置。
- `examples/*` 仅用于保留初始基座和参考实现，可按需只读查阅。只有用户明确点名具体参考应用并明确要求修改时，才可以写入对应目录。
- `packages/*` 只承载稳定、可复用且不含业务语义的共享能力，不放页面、业务 Store、业务 API 或领域规则。

## 当前技术栈

- Vue 3.5、TypeScript 6、Vite 8
- Arco Design Vue、Pinia、Vue Router、UnoCSS
- vue-i18n、Axios
- pnpm 11.9

版本真相源是 `package.json`、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml`，不得以参考应用文档或根目录依赖推断当前版本。

## 目录职责

```text
web/
├── apps/
│   └── qsmds-arco/         # 唯一正式业务应用
├── examples/               # 只读参考应用；仅在明确授权写入时修改
├── packages/               # 稳定共享能力，不承载业务代码
├── scripts/                # Web 工作区工程脚本
├── skills/                 # Web 项目级 Skill
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

正式应用的业务代码放在 `apps/qsmds-arco/src/`：

- API 模块：`apps/qsmds-arco/src/api/`
- 路由：`apps/qsmds-arco/src/router/`
- Pinia Store：`apps/qsmds-arco/src/store/`
- 页面：`apps/qsmds-arco/src/views/`
- 应用级文案：`apps/qsmds-arco/src/locales/`

## 依赖方向

- 允许：`apps/qsmds-arco` → `packages/*`。
- 允许：`examples/*` → `packages/*`，仅用于保持参考工程可运行。
- 禁止：`packages/*` → `apps/qsmds-arco` 或 `examples/*`。
- 禁止：`apps/qsmds-arco` → `examples/*`，也不得复制后再形成隐式同步关系。
- 禁止：`examples/*` → `apps/qsmds-arco`。
- `packages/*` 之间仅在职责清晰、无循环依赖时建立 `workspace:*` 依赖。

新增共享包遵循 YAGNI：只有已有至少两个真实调用方、抽象边界已经稳定且内容不含业务语义时才提取；未来可能复用、参考应用存在相似代码或仅为缩短单个业务文件，都不是提取理由。

## 命令约定

在 `web/` 目录执行：

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm build
```

默认 `pnpm dev`、`pnpm check` 和 `pnpm build` 只操作 `apps/qsmds-arco` 及其必要共享包。需要显式处理参考应用时使用：

```bash
pnpm check:examples
pnpm build:examples
pnpm dev:select
pnpm build:select
pnpm serve:select
```

`pnpm lint` 是只读检查；自动修复必须显式运行 `pnpm lint:fix`。不要假设 Git hook 或 `lint-staged` 会自动执行验证，提交前应主动运行与改动匹配的命令。

## 开发规范

- 使用 `<script setup lang="ts">`；组件使用 PascalCase，技术标识、路径、API、字段和错误码使用英文。
- 用户可见文案默认使用中文，并通过 i18n 维护；不得把技术标识翻译成中文变量名。
- 样式优先使用 UnoCSS，确有复杂样式时再使用 SCSS。
- 优先复用现有稳定能力，但不得为了“通用化”把正式业务代码移动到 `packages/*`。
- 非直观的工程约束、生命周期和失败传播应写详细中文注释；避免无意义注释。
- 修改 `examples/*` 前必须确认用户明确点名了具体参考应用并明确要求修改；仅要求参考或读取不构成写入授权。

## 环境变量与安全

- 只提交 `.env.*.example` 模板，不提交真实 `.env` 或 `.env.*`。
- 模板只保留变量名和非敏感示例，不得写入 token、密码、连接字符串或真实服务凭据。
- 所有 `VITE_` 变量都会进入浏览器构建产物，必须视为公开信息，禁止放置任何密钥。
- 日志不得输出 token、Cookie、密码、完整连接字符串或敏感请求体。

## 前后端契约

- Web 与 Server 只通过 HTTP 和 OpenAPI 契约协作，不共享源码或依赖安装。
- OpenAPI 客户端生成安排在阶段四实施；当前不得假设 `api:generate` 已存在，也不得手写虚假的生成步骤。
- 新增或修改公共 API、数据结构或数据库 schema 前，必须先获得用户确认。

## 反复修改检测

使用项目 `fa-*` Skill 时，如果用户针对同一功能点连续三次以上反馈仍未达到预期，应暂停猜测，重新核对需求、现有实现和验收标准；不要自动把问题归因于框架。
