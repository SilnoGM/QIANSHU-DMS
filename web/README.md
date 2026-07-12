# 千树 DMS Web

`web/` 是千树 DMS 的独立前端工作区。它可以从主仓库单独移植，并使用自身的 pnpm workspace 与 `pnpm-lock.yaml` 完成安装、检查、构建和发布；运行这些流程不要求仓库根目录或 `server/` 已安装依赖。

## 运行要求

- Node.js：`^22.22.2 || ^24.15.0 || >=26.0.0`
- pnpm：`11.9.0`

版本约束以本目录的 `package.json` 为准。只使用 pnpm，不使用 npm 或 Yarn 重建 lockfile。

## 快速开始

```bash
cd web
pnpm install --frozen-lockfile
pnpm dev
```

默认命令只面向唯一正式业务应用 `apps/qsmds-arco`：

```bash
pnpm dev       # 启动正式业务应用
pnpm check     # 运行工程脚本测试、类型检查和 lint
pnpm build     # 构建正式业务应用
```

参考应用必须显式操作：

```bash
pnpm check:examples
pnpm build:examples
pnpm dev:select
pnpm build:select
pnpm serve:select
```

其中 `*:select` 用于交互式选择应用；普通业务开发不需要先选择应用。

## 工作区结构

```text
web/
├── apps/
│   └── qsmds-arco/         # 唯一正式业务应用
├── examples/
│   ├── core/               # 初始基座参考
│   ├── core-arco-design-vue/
│   └── example/            # 示例参考
├── packages/               # 稳定共享能力
├── openapi/
│   └── openapi.json        # Web 自包含契约快照
├── scripts/                # 工作区脚本与测试
├── skills/                 # 项目级 Skill
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

- `apps/qsmds-arco` 是所有正式业务需求的默认落点。
- `examples/*` 可按需只读查阅。只有用户明确点名具体参考应用并明确要求修改时，才写入对应目录；仅要求参考或读取不构成写入授权。
- `packages/*` 只存放稳定、无业务语义的共享能力，不承载页面、业务 API、业务 Store 或领域规则。

依赖方向允许 `apps/qsmds-arco` → `packages/*`；禁止 `packages/*` 反向依赖应用，也禁止正式业务应用依赖 `examples/*`。新增共享抽象遵循 YAGNI：至少存在两个真实调用方且边界已经稳定后再提取，参考应用的相似实现不计作业务复用需求。

## 技术栈

- Vue 3.5、TypeScript 6、Vite 8
- Arco Design Vue、Pinia、Vue Router、UnoCSS
- vue-i18n、Axios
- pnpm 11.9

用户可见文案默认使用中文；代码、变量、路径、命令、API、字段、错误码和日志等技术资产使用英文。

## 环境变量

各应用提交 `.env.*.example` 作为变量清单，真实 `.env` 和 `.env.*` 已被忽略。创建本地环境文件时只复制所需模板，并在本机填入值，不要提交该文件。

```bash
cp apps/qsmds-arco/.env.development.example apps/qsmds-arco/.env.development
```

以 `VITE_` 开头的变量会被打包到浏览器代码中，任何访问者都可能读取，因此只能放公开配置，禁止放 token、密码、数据库连接或其他密钥。

## 独立移植

移植时应完整保留 `web/` 下的源码、`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`、配置、脚本和环境变量模板。不要携带 `node_modules/`、`dist/`、真实 `.env` 或日志。

在移植后的 `web/` 根目录执行以下命令即可验证边界：

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm check:examples
pnpm build:examples
```

Web 不读取仓库根目录或 Server 的 `node_modules/`，也不通过 `file:`、`link:` 或跨目录源码引用获取 Server 能力。前后端通过 HTTP 与 OpenAPI 契约协作；`web/openapi/openapi.json` 随 Web 一起移植。

`api:generate` 只读 Web snapshot，并重建 ignored `apps/qsmds-arco/src/api/generated/`。该目录必须精确只有非空 `types.gen.ts`，不得手工修改或提交。正式 app 的 `lint`、`typecheck`、`build`、`build:test` 与 Web `test:api` 都通过 lifecycle 先生成。

在主仓库中，跨端 snapshot 只通过根 `contract:sync` 更新，由 `contract:check` 只读检查：

```bash
node --run contract:sync
node --run contract:check
pnpm -C web api:generate
```

详细规则见[接口接入规范](../docs/前端文档/接口接入规范.md)。

## 提交前检查

根据改动范围主动执行 `pnpm check` 和必要构建。不要依赖 Git hook 或 `lint-staged` 自动兜底；需要修改格式或 lint 问题时显式执行 `pnpm lint:fix`，并检查修复产生的 diff。
