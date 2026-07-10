# 阶段二 Web 边界整理实施计划

> **供智能代理执行：** REQUIRED SUB-SKILL: Use `subagent-driven-development` or `executing-plans` to implement this plan task-by-task. Executable changes follow TDD; edits to project `SKILL.md` files also follow `writing-skills` RED/GREEN verification.

**目标：** 将现有 Web 基座安全纳入根 Git，把唯一业务应用与三套参考应用分区，并建立只读默认检查、显式参考应用命令和可独立复制安装构建的 Web workspace。

**架构：** `web/` 继续拥有独立 `package.json`、`pnpm-workspace.yaml` 和 `pnpm-lock.yaml`。默认命令只面向 `apps/qsmds-arco` 与 `packages/*`；`examples/*` 仍是 workspace 成员，但只能通过显式选择、检查和构建命令访问。根目录不吸收 Web 依赖，OpenAPI 生成延后到阶段四。

**技术栈：** pnpm 11.9、Node.js 24、Vue 3.5、TypeScript 6、Vite 8、Arco Design Vue、ESLint 10、Stylelint 17、`node:test`、`tsx --test`。

---

## 已验证基线

- Web workspace 当前识别根 package、4 个 app 和 9 个内部 package，共 14 个项目。
- 四个 app 使用精确 package filter 执行 `vue-tsc -b`，4/4 通过。
- `qsmds-arco` 生产构建通过；现有依赖产生 pure annotation 和大 chunk warning，但退出码为 `0`，该 warning 不属于本阶段回归。
- 当前 `pnpm -C web --filter './apps/*'` 会输出 `No projects matched` 但返回 `0`，因此阶段二脚本不得依赖该路径 filter；业务与参考命令使用稳定 package name。
- 12 个真实 `.env.*` 只存在本地且已被根 `.gitignore` 忽略；变量名未发现密钥类命名，但 `web/.gitignore` 尚不具备独立保护。
- `api:generate` 所需的 OpenAPI 快照和 `openapi-typescript` 尚不存在，必须留到阶段四。

## 目标提交序列

```text
docs: 添加阶段二 Web 边界整理计划
chore(web): 安全纳入前端基座
refactor(web): 隔离业务应用与参考应用
chore(web): 调整默认开发和验证脚本
chore(web): 修正工程检查配置
docs(web): 明确应用边界和协作规则
docs: 记录阶段二验证完成
```

每次提交都必须使用本 Task 的精确路径执行 `git add`，随后运行 `git -c core.quotePath=false diff --cached --name-only` 和 `git diff --cached --check`。只有暂存清单与当前 Task 一致时才能提交；不得用 `git add -A` 代替范围审计。

### Task 0：提交阶段二实施计划

**Files:**

- Create: `docs/全局文档/阶段二Web边界整理实施计划.md`
- Modify: `docs/文档索引.md`

- [ ] **Step 1：验证计划结构与索引**

检查 Markdown 围栏成对、JSON 代码块可解析、相对链接存在，并运行 `git diff --check` 与根级回归测试。

- [ ] **Step 2：精确暂存、审计并提交**

```bash
git add docs/全局文档/阶段二Web边界整理实施计划.md docs/文档索引.md
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "docs: 添加阶段二 Web 边界整理计划"
```

### Task 1：安全纳入 Web 基座

**Files:**

- Modify: `web/.gitignore`
- Create: `web/scripts/web-safety.test.mjs`
- Create: 4 个 app 各自的 `.env.development.example`
- Create: 4 个 app 各自的 `.env.production.example`
- Create: 4 个 app 各自的 `.env.test.example`
- Track: 当前未跟踪的 `web/` 源码、workspace 配置、lockfile、项目 Skills 和公共 packages

- [ ] **Step 1：先写安全失败测试**

先创建 `web-safety.test.mjs`，测试使用 Node 内置模块完成：

- 发现 `apps/*` 与 `examples/*` 中所有带 `package.json` 的 app。
- 每个 app 必须有三种 `.env.*.example`。
- development 模板键集合必须精确匹配 development 清单，production 与 test 必须精确匹配各自清单。
- Node 测试中的凭据型键名使用不区分大小写规则 `secret|token|password|passwd|api[_-]?key|private[_-]?key|credential|dsn`；URL 用户信息使用 JavaScript RegExp `/:\/\/[^/\s@]+:[^/\s@]+@/`；明显密钥值至少覆盖 PEM private key、`sk-` 加 16 个以上字符和 `AKIA` 加 16 个大写字母或数字。测试必须包含 `https://user:pass@example.com` 作为必失败 fixture；任一命中都必须使测试失败。Step 5 的 staged 扫描由 `rg` 执行，使用的是独立的 POSIX 字符类写法，不得混用两种 regex dialect。
- 在临时 Git 目录中加载 `web/.gitignore`，真实 `.env.*` 必须 ignored，example 必须放行。
- 根 `git ls-files` 不得包含非 `.example` 的 `.env` 文件。

Run:

```bash
node --test web/scripts/web-safety.test.mjs
```

Expected RED: 因 Web 自身尚未忽略 `.env.*` 且 12 个模板尚不存在而失败；失败原因必须与预期一致。

- [ ] **Step 2：建立 Web 自身的环境文件保护**

`web/.gitignore` 必须增加以下规则并保持放行顺序：

```gitignore
.env
.env.*
!.env.example
!.env.*.example
coverage
*.log
```

该规则必须在把 `web/` 作为独立 Git 根时仍然有效，不能只依赖外层 `.gitignore`。

- [ ] **Step 3：创建 12 个公开配置模板**

模板覆盖以下精确项目：

```text
apps/qsmds-arco
apps/core
apps/core-arco-design-vue
apps/example
```

development 模板使用下列公共键和值：

```dotenv
VITE_APP_SETTING=true
VITE_APP_TITLE=<APP_TITLE>
VITE_APP_API_BASEURL=/api
VITE_APP_STORAGE_PREFIX=<APP_STORAGE_PREFIX>
VITE_APP_DEBUG_TOOL=
VITE_ENABLE_PROXY=false
VITE_ENABLE_VUE_DEVTOOLS=true
VITE_ENABLE_TURBO_CONSOLE=false
VITE_LAUNCH_EDITOR=
```

production 模板使用：

```dotenv
VITE_APP_SETTING=false
VITE_APP_TITLE=<APP_TITLE>
VITE_APP_API_BASEURL=/api
VITE_APP_STORAGE_PREFIX=<APP_STORAGE_PREFIX>
VITE_APP_DEBUG_TOOL=
VITE_APP_DISABLE_DEVTOOL=true
VITE_BUILD_FAKE=false
VITE_BUILD_SOURCEMAP=false
VITE_BUILD_COMPRESS=gzip,brotli
VITE_BUILD_ARCHIVE=false
```

test 模板保留测试环境的 fake data、source map 和开发工具语义：

```dotenv
VITE_APP_SETTING=false
VITE_APP_TITLE=<APP_TITLE>
VITE_APP_API_BASEURL=/api
VITE_APP_STORAGE_PREFIX=<APP_STORAGE_PREFIX>
VITE_APP_DEBUG_TOOL=
VITE_APP_DISABLE_DEVTOOL=false
VITE_BUILD_FAKE=true
VITE_BUILD_SOURCEMAP=true
VITE_BUILD_COMPRESS=
VITE_BUILD_ARCHIVE=false
```

每个 app 的两个占位符必须按下表替换，不得保留尖括号占位值：

| app | `APP_TITLE` | `APP_STORAGE_PREFIX` |
| --- | --- | --- |
| `apps/qsmds-arco` | `千树 DMS` | `qianshu-dms` |
| `apps/core` | `Fantastic Admin Core Reference` | `fantastic-admin-core-reference` |
| `apps/core-arco-design-vue` | `Fantastic Admin Arco Reference` | `fantastic-admin-arco-reference` |
| `apps/example` | `Fantastic Admin Example Reference` | `fantastic-admin-example-reference` |

所有 `VITE_` 变量都属于浏览器可见配置，模板和真实文件中均禁止密钥、token、密码、DSN 或 URL 内嵌凭据。不得复制现有 `.env.*` 的值到提交中。

- [ ] **Step 4：运行 GREEN**

```bash
node --test web/scripts/web-safety.test.mjs
```

Expected: PASS，临时目录由测试 cleanup 清理。

- [ ] **Step 5：显式暂存并审计 Web 基线**

禁止直接使用未检查的 `git add -A`。暂存 `web/` 后必须验证：

```bash
git add web
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git diff --cached --no-ext-diff --text --unified=0 | rg -n -- '(?i)(-----BEGIN [A-Z ]*PRIVATE KEY-----|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16}|(secret|token|password|passwd|api[_-]?key|private[_-]?key|credential|dsn)[[:space:]]*[:=][[:space:]]*[^[:space:]]{8,}|://[^/[:space:]@]+:[^/[:space:]@]+@)'
```

暂存内容不得包含 `node_modules`、`dist*`、coverage、`.DS_Store`、真实 `.env.*`、日志或根外路径。密钥扫描退出码 `1` 表示无命中；若有命中，必须逐条人工判定并记录为安全示例或移除真实敏感内容，不能通过放宽模式跳过。

- [ ] **Step 6：提交**

```bash
git commit -m "chore(web): 安全纳入前端基座"
```

### Task 2：隔离业务应用与参考应用

本 Task 涉及三个旧目录从 `apps/` 消失。用户已在本阶段总体执行边界中明确确认这三项移动；实现时只执行已确认的路径迁移，不扩大到其他删除操作。

**Files:**

- Create: `web/scripts/workspace-boundaries.test.mjs`
- Move: `web/apps/core` → `web/examples/core`
- Move: `web/apps/core-arco-design-vue` → `web/examples/core-arco-design-vue`
- Move: `web/apps/example` → `web/examples/example`
- Modify: `web/pnpm-workspace.yaml`
- Regenerate: `web/pnpm-lock.yaml`
- Modify: `web/fantastic-admin.code-workspace`

- [ ] **Step 1：先写边界失败测试**

测试必须断言最终结构：

```text
apps/qsmds-arco
examples/core
examples/core-arco-design-vue
examples/example
packages/*
```

并断言：

- `apps/` 下只有 `qsmds-arco`。
- workspace patterns 精确为 `apps/*`、`examples/*`、`packages/*`，不含 `docs`。
- lockfile importer 使用三个 `examples/*` 路径，不再使用三个旧 `apps/*` 路径。
- 4 个 app package name 唯一。
- app 依赖只使用 registry、catalog 或指向 `packages/*` 的 `workspace:*`，不存在跨 app、根目录或 Server 源码依赖。
- code workspace 只引用真实存在的 1 个业务 app、3 个 examples 和 9 个 packages。

Run:

```bash
node --test web/scripts/workspace-boundaries.test.mjs
```

Expected RED: 因 `examples/*` 尚不存在、workspace 和 importer 仍是旧结构而失败。

- [ ] **Step 2：建立可追踪 rename**

Task 1 已建立 Web Git 基线后，执行以下精确命令：

```bash
mkdir -p web/examples
git mv web/apps/core web/examples/core
git mv web/apps/core-arco-design-vue web/examples/core-arco-design-vue
git mv web/apps/example web/examples/example
for path in \
  web/examples/core/.env.development \
  web/examples/core/node_modules \
  web/examples/core-arco-design-vue/.env.development \
  web/examples/core-arco-design-vue/node_modules \
  web/examples/example/.env.development \
  web/examples/example/node_modules; do
  git check-ignore -q -- "$path" || exit 1
done
```

`git mv` 会把三个 app 当前 ignored 的本地 `node_modules` 一并物理移动。该生成目录不属于源码，本阶段不额外删除；必须证明它与真实 `.env.*` 仍保持 ignored，且没有进入 staged 或 commit。`dist*`、coverage 和日志同样只能作为 ignored 本地状态存在。

- [ ] **Step 3：更新 workspace、lockfile 和编辑器工作区**

`pnpm-workspace.yaml` 最终为：

```yaml
packages:
  - apps/*
  - examples/*
  - packages/*
```

移动后由 pnpm 更新 lockfile，不手改 importer：

```bash
pnpm -C web install --lockfile-only --ignore-scripts
```

此处必须使用 `--ignore-scripts`，因为嵌套 Web 的旧 `postinstall` 会在 Task 3 才移除；阶段二不允许安装过程改写外层 Git hooks。

`fantastic-admin.code-workspace` 必须成为有效 JSON，只列真实路径；i18n paths 同时包含 `apps/*` 和 `examples/*`。

- [ ] **Step 4：运行 GREEN 和 workspace 验证**

```bash
node --test web/scripts/workspace-boundaries.test.mjs
pnpm -C web list -r --depth=-1 --parseable
```

Expected: 根 package + 1 business app + 3 examples + 9 packages，共 14 个项目。

- [ ] **Step 5：提交**

```bash
git add web/apps web/examples web/scripts/workspace-boundaries.test.mjs web/pnpm-workspace.yaml web/pnpm-lock.yaml web/fantastic-admin.code-workspace
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "refactor(web): 隔离业务应用与参考应用"
```

### Task 3：调整默认脚本与 CLI

**Files:**

- Create: `web/scripts/workspace-scripts.test.mjs`
- Create: `web/scripts/cli.test.ts`
- Create: `web/scripts/ensure-pnpm.mjs`
- Create: `web/scripts/ensure-pnpm.test.mjs`
- Modify: `web/scripts/cli.ts`
- Modify: `web/package.json`
- Modify: `web/apps/qsmds-arco/package.json`
- Regenerate: `web/pnpm-lock.yaml`

- [ ] **Step 1：先写脚本失败测试**

`workspace-scripts.test.mjs` 断言：

- `dev/build/serve` 只过滤 `qsmds-arco`。
- 交互入口命名为 `dev:select/build:select/serve:select`。
- `typecheck` 使用业务 app 的 `typecheck`。
- `lint` 和 `check` 不含 `--fix`；修复只存在于 `lint:fix` 分支。
- `check:examples/build:examples` 使用三个稳定 package name，不使用已证实无法匹配的路径 filter；`check:examples` 按已确认方案直接复用三个 app 现有的 `lint`（即 `vue-tsc -b`），本阶段不迁移参考应用 manifest。
- 根 scripts test 同时运行 `.test.mjs` 与 `.test.ts`。
- 不存在 `api:generate`，该步骤明确留到阶段四。
- `preinstall` 只调用仓库内 Node 脚本，不使用 `npx`；不存在嵌套 `postinstall` Git hook。

`cli.test.ts` 导入纯函数，断言扫描结果包含一个 `business` 和三个 `example`，选择标签明确区分两类，help 使用 `*:select` 命令。当前 CLI 未导出纯函数且会在 import 时执行 main，测试必须先失败。

`ensure-pnpm.test.mjs` 先因实现缺失失败，随后验证 pnpm user agent 通过，npm/yarn/空值失败，错误输出不包含完整 user agent 或环境信息。

Run RED:

```bash
node --test web/scripts/workspace-scripts.test.mjs web/scripts/ensure-pnpm.test.mjs
pnpm -C web exec tsx --test scripts/cli.test.ts
```

Expected RED: package scripts 与目标不符，pnpm 守卫模块不存在，CLI 缺少导出与 direct-entry guard。`cli.test.ts` 必须先通过源码前置断言阻止导入旧 CLI，不能因交互 prompt、挂起或无关语法错误形成伪 RED。

- [ ] **Step 2：实现确定性 package scripts**

Web scripts 使用稳定 package name；核心结构为：

```json
{
  "dev": "pnpm --filter qsmds-arco run dev",
  "build": "pnpm --filter qsmds-arco run build",
  "serve": "pnpm --filter qsmds-arco run serve",
  "dev:select": "tsx scripts/cli.ts --mode=dev",
  "build:select": "tsx scripts/cli.ts --mode=build",
  "serve:select": "tsx scripts/cli.ts --mode=serve",
  "typecheck": "pnpm --filter qsmds-arco run typecheck",
  "lint": "run-s lint:eslint lint:stylelint",
  "lint:eslint": "eslint apps/qsmds-arco packages",
  "lint:stylelint": "stylelint \"{apps/qsmds-arco,packages}/**/*.{css,scss,vue}\"",
  "lint:fix": "run-s lint:eslint:fix lint:stylelint:fix",
  "lint:eslint:fix": "eslint apps/qsmds-arco packages --fix",
  "lint:stylelint:fix": "stylelint \"{apps/qsmds-arco,packages}/**/*.{css,scss,vue}\" --fix",
  "test:scripts": "run-s test:scripts:node test:scripts:tsx",
  "test:scripts:node": "node --test scripts/*.test.mjs",
  "test:scripts:tsx": "tsx --test scripts/cli.test.ts",
  "check": "run-s test:scripts typecheck lint",
  "check:examples": "pnpm --filter @fantastic-admin/core --filter @fantastic-admin/core-arco-design-vue --filter @fantastic-admin/example -r run lint",
  "build:examples": "pnpm --filter @fantastic-admin/core --filter @fantastic-admin/core-arco-design-vue --filter @fantastic-admin/example -r run build",
  "preinstall": "node ./scripts/ensure-pnpm.mjs"
}
```

保留现有设置生成、维护和发布命令。移除 `postinstall`、`simple-git-hooks` 配置和直接依赖，避免独立 Web 安装隐式改写外层 Git hooks。`apps/qsmds-arco` 增加 `typecheck: vue-tsc -b`。

- [ ] **Step 3：重构可测试 CLI 与本地 pnpm 守卫**

CLI 必须导出纯函数并使用 direct-entry guard：

```ts
type WorkspaceKind = 'business' | 'example'

interface WorkspaceEntry {
  kind: WorkspaceKind
  name: string
  packageJsonPath: string
}

export function getWorkspaceEntries(workspaceRoot = rootDir): WorkspaceEntry[]
export function getApps(scriptMatcher, workspaceRoot = rootDir): AppInfo[]
export function getAppChoices(apps: AppInfo[]): AppChoice[]
export function printHelp(): void
```

扫描 `apps/*` 为 business、`examples/*` 为 example，按 kind 和 name 稳定排序；删除 docs package 假设。默认 package scripts 不再调用 CLI。

`ensure-pnpm.mjs` 只读取 `npm_config_user_agent` 判断调用方，非 pnpm 时输出固定英文技术错误并返回非零，不回显环境变量。

- [ ] **Step 4：运行 GREEN 并安全更新 lockfile**

Run:

```bash
node --test web/scripts/*.test.mjs
pnpm -C web exec tsx --test scripts/cli.test.ts
pnpm -C web install --lockfile-only --ignore-scripts
```

Expected: 全部测试通过，lockfile 只包含预期 importer 和依赖变化。

- [ ] **Step 5：提交**

```bash
git add web/scripts/workspace-scripts.test.mjs web/scripts/cli.test.ts web/scripts/ensure-pnpm.mjs web/scripts/ensure-pnpm.test.mjs web/scripts/cli.ts web/package.json web/apps/qsmds-arco/package.json web/pnpm-lock.yaml
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "chore(web): 调整默认开发和验证脚本"
```

### Task 4：修正工程配置与协作规则

**Files:**

- Create: `web/scripts/workspace-config.test.mjs`
- Create: `web/scripts/project-guidance.test.mjs`
- Modify: `web/eslint.config.js`
- Modify: `web/stylelint.config.js`
- Modify: `web/AGENTS.md`
- Create: `web/README.md`
- Modify: `web/skills/fa-i18n-manager/SKILL.md`
- Modify: `web/skills/fa-route-generator/SKILL.md`
- Modify: `web/skills/fa-page-optimizer/SKILL.md`
- Modify: `web/skills/fa-form-builder/SKILL.md`
- Modify: `web/skills/fa-store-generator/SKILL.md`
- Modify: `web/skills/fa-slot-creator/SKILL.md`
- Modify: `web/skills/fa-framework-settings/SKILL.md`
- Create: `docs/前端文档/前端架构.md`
- Create: `docs/前端文档/应用边界规范.md`
- Modify: `docs/文档索引.md`

- [ ] **Step 1：先写工程配置失败测试**

`workspace-config.test.mjs` 读取最终配置并断言：ESLint/Stylelint 能覆盖 `apps/qsmds-arco`、`examples/*` 和实际 packages；配置不再引用不存在的 `docs`；忽略项同时覆盖业务与参考应用的生成目录。先运行并确认 RED 与现有 stale 路径一致。

- [ ] **Step 2：修正配置、运行 GREEN 并提交**

```bash
node --test web/scripts/workspace-config.test.mjs
git add web/scripts/workspace-config.test.mjs web/eslint.config.js web/stylelint.config.js
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "chore(web): 修正工程检查配置"
```

提交只能包含配置测试、ESLint 和 Stylelint 文件。

- [ ] **Step 3：先写协作规则失败测试并运行 Skill RED 场景**

`project-guidance.test.mjs` 断言：

- `web/AGENTS.md` 与 `web/README.md` 明确唯一业务应用、examples 只读原则、依赖方向、独立命令和 env 安全。
- 两份中文前端文档存在且被 `docs/文档索引.md` 链接。
- 7 个项目 Skill 都把默认业务路径固定为 `apps/qsmds-arco`，并要求只有用户明确指定时才操作 `examples/*`。

先运行测试确认 RED。随后给只读审查代理一个“为正式业务应用新增路由、Store、表单或页面”的压力场景，并要求它仅依据当前 Skill 决定写入路径；记录其选择旧 `apps/core`、泛化 `apps/<app>` 或把 reference 当业务 app 的失败证据。

- [ ] **Step 4：修正文档与 Skills**

- `web/AGENTS.md` 写明 `qsmds-arco` 唯一业务定位、examples 原则只读、依赖方向、默认命令、环境安全与中文可见文案。
- `web/README.md` 用中文说明 Web 可独立复制、安装、开发、检查和构建。
- code-facing Skill 默认业务路径改为 `apps/qsmds-arco`；只有用户明确要求参考项目时才允许操作 `examples/*`。
- 创建两份有实际内容的中文前端文档并更新唯一索引，不创建空文档。

- [ ] **Step 5：运行协作规则 GREEN 和 Skill GREEN 场景**

使用与 Step 3 相同的代理场景重新读取修改后的 Skill；目标必须稳定选择 `apps/qsmds-arco`，并拒绝把普通业务变更写进 `examples/*`。

```bash
node --test web/scripts/project-guidance.test.mjs
```

- [ ] **Step 6：提交**

```bash
git add web/scripts/project-guidance.test.mjs web/AGENTS.md web/README.md web/skills/fa-i18n-manager/SKILL.md web/skills/fa-route-generator/SKILL.md web/skills/fa-page-optimizer/SKILL.md web/skills/fa-form-builder/SKILL.md web/skills/fa-store-generator/SKILL.md web/skills/fa-slot-creator/SKILL.md web/skills/fa-framework-settings/SKILL.md docs/前端文档/前端架构.md docs/前端文档/应用边界规范.md docs/文档索引.md
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "docs(web): 明确应用边界和协作规则"
```

### Task 5：阶段二集成与独立移植验证

**Files:**

- Modify: `docs/全局文档/阶段二Web边界整理实施计划.md`（仅完成状态）

- [ ] **Step 1：安装与静态检查**

```bash
pnpm -C web install --frozen-lockfile
pnpm -C web test:scripts
pnpm -C web check
pnpm -C web build
pnpm -C web --filter qsmds-arco run build:test
pnpm -C web check:examples
pnpm -C web build:examples
```

检查命令执行前后必须比较 tracked diff，证明 `check` 不修改源码或配置。构建允许更新 ignored `dist*`。

- [ ] **Step 2：验证四个应用可直接启动**

依次在 PTY 中运行以下有界 smoke test：

```bash
pnpm -C web dev -- --host 127.0.0.1 --port 43110 --strictPort
pnpm -C web --filter @fantastic-admin/core run dev -- --host 127.0.0.1 --port 43111 --strictPort
pnpm -C web --filter @fantastic-admin/core-arco-design-vue run dev -- --host 127.0.0.1 --port 43112 --strictPort
pnpm -C web --filter @fantastic-admin/example run dev -- --host 127.0.0.1 --port 43113 --strictPort
```

每条命令必须观察到 Vite ready，对对应 `http://127.0.0.1:<port>/` 的请求返回成功响应后立即发送 `SIGINT` 并等待进程退出；任何端口占用、启动错误或无法终止都按失败处理，不保留后台进程。

- [ ] **Step 3：验证根门面与 workspace 边界**

```bash
node --run test:root
node --run check:web
node --run build:web
pnpm -C web list -r --depth=-1 --parseable
```

根目录仍不得出现 workspace、lockfile 或 node_modules。

- [ ] **Step 4：验证 Web 独立复制**

从当前 Git commit 的 `web/` tree 创建临时副本，不复制根文件、Server、本地 node_modules 或真实 `.env.*`。必须在仓库外执行以下流程：

```bash
tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/qianshu-web.XXXXXX")"
trap 'rm -rf -- "$tmp_dir"' EXIT
git archive --format=tar HEAD:web | tar -xf - -C "$tmp_dir"
test ! -e "$tmp_dir/node_modules"
test -z "$(find "$tmp_dir" -type l -print -quit)"
test -z "$(find "$tmp_dir" -type f \( -name '.env' -o -name '.env.*' \) ! -name '*.example' -print -quit)"
test -z "$(find "$tmp_dir" -type d \( -name 'node_modules' -o -name 'dist*' -o -name 'coverage' \) -print -quit)"
pnpm -C "$tmp_dir" install --offline --frozen-lockfile
pnpm -C "$tmp_dir" check
pnpm -C "$tmp_dir" build
pnpm -C "$tmp_dir" --filter qsmds-arco run build:test
pnpm -C "$tmp_dir" check:examples
pnpm -C "$tmp_dir" build:examples
```

随后在副本目录中依次执行以下四项有界启动 smoke test：

```bash
pnpm -C "$tmp_dir" dev -- --host 127.0.0.1 --port 43120 --strictPort
pnpm -C "$tmp_dir" --filter @fantastic-admin/core run dev -- --host 127.0.0.1 --port 43121 --strictPort
pnpm -C "$tmp_dir" --filter @fantastic-admin/core-arco-design-vue run dev -- --host 127.0.0.1 --port 43122 --strictPort
pnpm -C "$tmp_dir" --filter @fantastic-admin/example run dev -- --host 127.0.0.1 --port 43123 --strictPort
```

分别确认 `http://127.0.0.1:43120/` 至 `43123/` 成功响应并用 `SIGINT` 等待退出，证明 `dev` 和三个参考应用的直接运行不依赖外层根目录；任何命令都不得改回 `-C web`。临时目录必须在验证后由 trap 安全清理；若 offline store 缺包，应如实报告并改用已获授权的正常安装，不得用外层相对路径或 symlink 伪造独立性。

- [ ] **Step 5：最终安全和 Git 检查**

- 只存在根唯一 `.git`。
- 两端没有 `file:`、`link:` 或跨目录源码依赖。
- Git 未追踪真实 `.env.*`、dist、coverage、node_modules、日志或 `.DS_Store`。
- `web/` 自身包含 package、workspace、lockfile、README、AGENTS 和 env examples。
- `git diff --check`、文档 JSON/fence/link 检查和双重审查通过。

- [ ] **Step 6：记录并提交阶段完成状态**

```bash
git add docs/全局文档/阶段二Web边界整理实施计划.md
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "docs: 记录阶段二验证完成"
```
