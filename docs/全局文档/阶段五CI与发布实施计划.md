# 阶段五 CI 与发布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变根无依赖、Web/Server 独立依赖域和现有业务 API/数据库 schema 的前提下，建立可审计的三工作流 CI、隔离 PostgreSQL E2E、严格产品版本检查、双端 Release 归档、Release Manifest 和不可覆盖的 GitHub Draft Release 流程。

**Architecture:** `.github/workflows/*.yml` 只负责编排，复杂的事件基线、Docker 生命周期、版本与 Tag 身份、归档安全、Manifest、checksum 和 GitHub Release 状态机都下沉到根目录无第三方依赖的 Node.js 24 模块。CI 分别 frozen-install `server/` 与 `web/`；Release 从同一个 annotated Tag Commit 完整重建两端，通过 final bundle workflow artifact 把发布前验证结果绑定到唯一 GitHub Release 写入。

**Tech Stack:** Node.js 24、pnpm 11.9.0、GitHub Actions、Ubuntu 24.04、Docker、PostgreSQL 16、NestJS 11、Prisma 7、Vue 3、Vite 8、JSON Schema、GitHub REST API、`node:test`、Jest 29。

---

## 执行边界

- 设计真相源是 `docs/全局文档/阶段五CI与发布设计.md`；本计划只拆解已确认设计，不得用实现便利反向弱化设计要求。
- 根目录不是 pnpm workspace；不得新增根 `pnpm-workspace.yaml`、`pnpm-lock.yaml`、`node_modules/` 或任何第三方依赖字段。
- `server/` 与 `web/` 独立 frozen install、独立 lockfile；不得引入 `file:`、`link:`、跨端 `workspace:*` 或跨目录源码 import。
- 不修改公共业务 API、DTO、`server/prisma/schema.prisma`、`server/prisma/migrations/` 或 `web/examples/*` 源码。
- `server/pnpm-lock.yaml` 只允许增加 `settings.injectWorkspacePackages: true`；不得改变 importer、package snapshot、版本或解析结果。
- `web/pnpm-lock.yaml` 只允许删除 `bumpp` 所必需的 importer/catalog/package/snapshot；不得混入其他依赖升级。
- Workflow 不读取 PR Secret，不使用 `pull_request_target`，checkout 默认 `persist-credentials: false`。
- Workflow 不创建、移动、删除或强制更新 Tag；不自动修改 Branch Protection、Tag ruleset 或 Release immutability。
- GitHub Release 外部写入只发生在 `release.yml` 的 `publish` Job；本地和单元测试使用可注入 fake，不创建真实 Draft/Release。
- 不提交 `.env`、token、数据库凭据、连接字符串、构建产物、生成目录、日志或临时归档；不 push。
- 同一 checkout 中会执行 `prisma generate` 的 Server 命令保持串行。
- 对凭据 mask、signal/cleanup、TOCTOU、no-clobber、历史基线降级等不直观边界写必要且详细的中文代码注释；不为显然语句堆砌注释。

## 需求与 Task 映射

| 设计需求 | 实施 Task | 主验证 |
| --- | --- | --- |
| `REQ-001`–`REQ-005` CI 边界、独立安装与稳定 Gate | Task 1–2、10–11、13 | 根治理、Workflow 结构测试、`actionlint` |
| `REQ-010`–`REQ-012` PostgreSQL 隔离与 migration/E2E | Task 3–4、10、12–13 | Node 单元测试、真实临时 PostgreSQL E2E |
| `REQ-013`–`REQ-016` PR/push/Release 契约基线 | Task 5、10、12–13 | fixture Git repo、带 baseline 的 contract check |
| `REQ-020`–`REQ-025` 产品版本与 annotated Tag 身份 | Task 1、6、9、12–13 | 临时 Git remote、版本/Tag 矩阵测试 |
| `REQ-030`–`REQ-036` 双端归档、smoke、Manifest 与 checksum | Task 2、7–8、12–13 | archive fixture、真实 deploy/解压/health smoke |
| `REQ-040`–`REQ-045` Draft、续传、不可覆盖与发布前复验 | Task 9、12–13 | fake GitHub REST 状态机矩阵 |
| `REQ-050`–`REQ-054` 最小权限、固定引用与脱敏 | Task 3–13 | 结构测试、日志泄漏扫描、Git diff 审计 |

## 文件职责图

```text
.github/workflows/
├── ci.yml                         # PR/main/release-call 的五个 Required Job 与 ci-gate
├── examples.yml                   # 每月和手动参考应用验证，不接入正式 Gate
└── release.yml                    # Tag 复验、双端打包、Manifest、Draft/Publish 编排

release/
└── manifest.schema.json           # release-manifest.json 的结构真相源

scripts/
├── ci-contract-baseline.mjs       # GitHub 事件到历史 OpenAPI baseline
├── ci-postgres.mjs                # 随机凭据、mask、动态端口、精确容器清理
├── ci-server-e2e.mjs              # 两次 deploy、status、E2E 的串行编排
├── release-version.mjs            # 三版本、双 OpenAPI、Tag object/main/单调性
├── release-package.mjs            # Web/Server 安全树、归档、解压与 runtime smoke
├── release-manifest.mjs           # schema 子集、hash、Manifest 与 SHA256SUMS
├── release-github.mjs             # GitHub REST Draft/asset/publish 状态机
└── ci-workflows.test.mjs          # 无依赖 Workflow 源码结构约束
```

每个实现模块都创建同名 `*.test.mjs`，并暴露最小的 runner/filesystem/clock/fetch 注入边界。单元测试不得联网、不得启动 Docker、不得写 GitHub Release。

## 固定外部引用

实施时使用下表完整 SHA/digest，并在 Workflow 行尾保留可读版本注释。值已于 2026-07-13 从官方 Release/registry 解析；实施前若决定升级，必须重新核验完整 SHA、变更说明和兼容性，不能改成浮动 major tag。

| 外部引用 | 固定值 |
| --- | --- |
| `actions/checkout` `v7.0.0` | `9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0` |
| `actions/setup-node` `v6.4.0` | `48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e` |
| `pnpm/action-setup` `v6.0.9` peeled Commit | `0ebf47130e4866e96fce0953f49152a61190b271` |
| `actions/upload-artifact` `v7.0.1` | `043fb46d1a93c77aae656e7c1c64a875d1fc6a0a` |
| `actions/download-artifact` `v8.0.1` | `3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c` |
| `postgres:16` multi-platform digest（16.14） | `sha256:be01cf82fc7dbba824acf0a82e150b4b360f3ff93c6631d7844af431e841a95c` |
| `actionlint` `v1.7.12` Linux x64 archive SHA-256 | `8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8` |
| `actionlint` `v1.7.12` macOS arm64 archive SHA-256 | `aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f` |

官方核验入口：[`actions/checkout`](https://github.com/actions/checkout/releases/tag/v7.0.0)、[`actions/setup-node`](https://github.com/actions/setup-node/releases/tag/v6.4.0)、[`pnpm/action-setup`](https://github.com/pnpm/action-setup/releases/tag/v6.0.9)、[`actions/upload-artifact`](https://github.com/actions/upload-artifact/releases/tag/v7.0.1)、[`actions/download-artifact`](https://github.com/actions/download-artifact/releases/tag/v8.0.1)、[`actionlint`](https://github.com/rhysd/actionlint/releases/tag/v1.7.12)。

## 目标提交序列

```text
docs: 添加阶段五CI与发布实施计划
chore: 统一产品版本边界
build(server): 建立现代生产部署边界
ci: 建立隔离PostgreSQL生命周期
ci(server): 建立数据库迁移与E2E编排
ci: 建立接口契约历史基线
feat: 建立发布版本与Tag校验
build: 建立双端发布归档与运行验证
feat: 建立发布清单与校验和
feat: 建立GitHub Release安全协调
ci: 添加主CI工作流
ci: 添加参考应用工作流
ci: 添加统一产品发布工作流
docs: 完成阶段五CI与发布文档
```

每次提交前统一执行：

```bash
set -euo pipefail
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
```

Expected: 暂存路径只属于当前 Task，`git diff --cached --check` 退出码为 `0`。禁止使用未审计的 `git add -A`。

### Task 0：提交阶段五实施计划

**Files:**

- Create: `docs/全局文档/阶段五CI与发布实施计划.md`
- Modify: `docs/文档索引.md`

- [x] **Step 1：校验计划结构、需求映射、占位符和索引**

Run:

```bash
set -euo pipefail
node --run test:root
git diff --check
if rg -n "T[B]D|TO[D]O|implemen[t] later|fill in detai[l]s|稍后补[充齐]" \
  docs/全局文档/阶段五CI与发布实施计划.md; then
  echo 'Implementation-plan placeholder detected' >&2
  exit 1
fi
```

Expected: 整个命令块退出码为 `0`；根测试与 Markdown 边界检查通过，未发现占位符。

- [x] **Step 2：精确暂存并提交计划**

```bash
set -euo pipefail
git add docs/全局文档/阶段五CI与发布实施计划.md docs/文档索引.md
git -c core.quotePath=false diff --cached --name-only
git diff --cached --check
git commit -m "docs: 添加阶段五CI与发布实施计划"
```

Expected: commit 成功且只包含实施计划和索引。

### Task 1：统一产品版本边界并移除 Web 基座发布入口

**Files:**

- Modify: `package.json`
- Modify: `scripts/root-governance.test.mjs`
- Modify: `web/package.json`
- Modify: `web/pnpm-workspace.yaml`
- Modify: `web/pnpm-lock.yaml`
- Modify: `web/apps/qsmds-arco/package.json`
- Modify: `web/apps/qsmds-arco/vite.config.ts`
- Modify: `web/scripts/workspace-scripts.test.mjs`
- Modify: `web/scripts/workspace-config.test.mjs`
- Create: `web/scripts/vite-system-info.test.ts`

- [x] **Step 1：先写版本镜像、bumpp 移除与 Vite 注入失败测试**

在 `root-governance.test.mjs` 断言根 manifest 是产品版本镜像但仍无依赖：

```js
assert.equal(rootManifest.version, '0.0.0')
assert.equal(Object.hasOwn(rootManifest, 'dependencies'), false)
assert.equal(Object.hasOwn(rootManifest, 'devDependencies'), false)
```

修改 Web 测试，使其不再期待 `scripts.release === 'bumpp'`，而是断言：

```js
assert.equal(appManifest.version, '0.0.0')
assert.equal(Object.hasOwn(workspaceManifest.scripts, 'release'), false)
assert.equal(Object.hasOwn(workspaceManifest.devDependencies, 'bumpp'), false)
assert.equal(workspaceYaml.includes('\n  bumpp:'), false)
assert.equal(parsedSystemInfo.pkg.version, '0.0.0')
```

`vite-system-info.test.ts` 启动隔离 child process，并把 `cwd` 显式设为 `web/apps/qsmds-arco/` 后再 import `vite.config.ts`、调用 config factory、解析 `define.__SYSTEM_INFO__`；不能直接从 Web root 调用，因为 Vite 配置还会读取 app 相对路径，也不能用源码正则冒充行为验证。测试断言 child 成功后才检查 version，并保证父测试 cwd 未变化。同时读取 `web/pnpm-lock.yaml`，断言 importer、catalog、package 与 snapshot 均没有 `bumpp`。

- [x] **Step 2：运行目标测试并确认 RED**

```bash
set -euo pipefail
node --test scripts/root-governance.test.mjs
pnpm -C web test:scripts:node
pnpm -C web test:scripts:tsx
```

Expected RED: 根/app 缺少 `version`、旧 `release`/`bumpp` 仍存在，且 Vite 尚未注入 `pkg.version`。

- [x] **Step 3：实施最小 manifest 与 Vite 变更**

精确修改：

```json
// package.json
{
  "name": "qianshu-dms",
  "version": "0.0.0"
}
```

```json
// web/apps/qsmds-arco/package.json
{
  "name": "qsmds-arco",
  "version": "0.0.0"
}
```

`web/package.json.version = 6.3.0` 保持不变；删除它的 `scripts.release` 和 `devDependencies.bumpp`，删除 workspace catalog 的 `bumpp`。Vite system info 补齐：

```ts
__SYSTEM_INFO__: JSON.stringify({
  pkg: {
    name: pkg.name,
    version: pkg.version,
    dependencies: pkg.dependencies,
    devDependencies: pkg.devDependencies,
  },
  lastBuildTime: dayjs().format('YYYY-MM-DD HH:mm:ss'),
}),
```

- [x] **Step 4：只刷新 Web lockfile 并审计依赖差异**

```bash
set -euo pipefail
audit_root="$(mktemp -d)"
trap 'rm -rf "$audit_root"' EXIT
pnpm -C web -r list --lockfile-only --json --depth Infinity > "$audit_root/before.json"
pnpm -C web install --lockfile-only --offline
pnpm -C web -r list --lockfile-only --json --depth Infinity > "$audit_root/after.json"
git diff -- web/pnpm-lock.yaml
node --input-type=module - "$audit_root/before.json" "$audit_root/after.json" <<'NODE'
import fs from 'node:fs'
const [beforePath, afterPath] = process.argv.slice(2)
const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'))
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'))
const sections = ['dependencies', 'devDependencies', 'optionalDependencies']
const beforeByPath = new Map(before.map(root => [root.path, root]))
if (before.length !== after.length) throw new Error('Workspace importer count changed')
for (const afterRoot of after) {
  const beforeRoot = beforeByPath.get(afterRoot.path)
  if (!beforeRoot) throw new Error('Workspace importer changed')
  for (const section of sections) {
    const beforeEntries = { ...(beforeRoot[section] ?? {}) }
    const afterEntries = afterRoot[section] ?? {}
    if (afterRoot.path.endsWith('/web')) delete beforeEntries.bumpp
    if (JSON.stringify(beforeEntries) !== JSON.stringify(afterEntries)) {
      throw new Error(`Unexpected direct dependency drift: ${afterRoot.path} ${section}`)
    }
  }
}
if (JSON.stringify(after).includes('bumpp')) throw new Error('bumpp remains in lock graph')
const collect = (value, output) => {
  if (!value || typeof value !== 'object') return
  if (typeof value.name === 'string' && typeof value.version === 'string') {
    output.add(`${value.name}@${value.version}`)
  }
  for (const section of sections) {
    for (const child of Object.values(value[section] ?? {})) collect(child, output)
  }
}
const beforeVersions = new Set(); const afterVersions = new Set()
for (const root of before) collect(root, beforeVersions)
for (const root of after) collect(root, afterVersions)
for (const identity of afterVersions) {
  if (!beforeVersions.has(identity)) throw new Error(`New or upgraded package: ${identity}`)
}
NODE
```

Expected: lockfile 只删除 `bumpp` 与已不再可达的专属传递节点，没有其他直接依赖删除或版本漂移；inline auditor 不写入仓库。

- [x] **Step 5：运行回归并提交**

```bash
set -euo pipefail
node --run test:root
pnpm -C web install --frozen-lockfile --offline
pnpm -C web test:scripts:node
pnpm -C web test:scripts:tsx
pnpm -C web typecheck
git diff --check
git add package.json scripts/root-governance.test.mjs \
  web/package.json web/pnpm-workspace.yaml web/pnpm-lock.yaml \
  web/apps/qsmds-arco/package.json web/apps/qsmds-arco/vite.config.ts \
  web/scripts/workspace-scripts.test.mjs web/scripts/workspace-config.test.mjs \
  web/scripts/vite-system-info.test.ts
git diff --cached --check
git commit -m "chore: 统一产品版本边界"
```

Expected: 所有命令通过；提交不包含 Server version 变化（其现值已经是 `0.0.0`）或生成产物。

### Task 2：建立 Server 现代生产部署边界

**Files:**

- Modify: `server/package.json`
- Modify: `server/pnpm-workspace.yaml`
- Modify: `server/pnpm-lock.yaml`
- Modify: `scripts/server-boundary.test.mjs`

- [x] **Step 1：先写 files 白名单与 workspace 注入失败测试**

将测试固定为：

```js
assert.deepEqual(serverManifest.files, [
  'dist/',
  'prisma/schema.prisma',
  'prisma/migrations/',
])
assert.equal(serverWorkspace.injectWorkspacePackages, true)
assert.equal(serverLock.settings.injectWorkspacePackages, true)
```

另加文本级审计：lockfile importer 与所有 dependency version 在刷新前后必须一致，只有 `settings.injectWorkspacePackages` 可新增。

- [x] **Step 2：运行边界测试并确认 RED**

```bash
node --test scripts/server-boundary.test.mjs
```

Expected RED: 缺少 `files` 与 `injectWorkspacePackages`。

- [x] **Step 3：修改 manifest/workspace 并精确刷新 Server lockfile**

```yaml
# server/pnpm-workspace.yaml
injectWorkspacePackages: true
allowBuilds:
  '@prisma/engines': true
  '@scarf/scarf': false
  prisma: true
```

```bash
set -euo pipefail
audit_root="$(mktemp -d)"
trap 'rm -rf "$audit_root"' EXIT
cp server/pnpm-lock.yaml "$audit_root/before.yaml"
pnpm -C server install --lockfile-only --offline
git diff -- server/pnpm-lock.yaml
node --input-type=module - "$audit_root/before.yaml" server/pnpm-lock.yaml <<'NODE'
import fs from 'node:fs'
const [beforePath, afterPath] = process.argv.slice(2)
const before = fs.readFileSync(beforePath, 'utf8')
const marker = '  excludeLinksFromLockfile: false\n'
if (before.split(marker).length !== 2) throw new Error('Unexpected lockfile settings shape')
const expected = before.replace(marker, `${marker}  injectWorkspacePackages: true\n`)
const after = fs.readFileSync(afterPath, 'utf8')
if (after !== expected) throw new Error('Unexpected Server lockfile drift')
NODE
```

Expected: after bytes 只比 before 多唯一 settings 行，临时副本由 trap 清理。

`server/package.json.files` 使用上一步精确数组。不得加入 `src/`、`test/`、`.env*` 或 Prisma CLI。

- [x] **Step 4：实际验证现代 deploy 结构**

```bash
set -euo pipefail
pnpm -C server install --frozen-lockfile --offline
pnpm -C server build
deploy_root="$(mktemp -d)"
trap 'rm -rf "$deploy_root"' EXIT
pnpm -C server --filter @qianshu-dms/server --prod deploy "$deploy_root/app"
test -s "$deploy_root/app/dist/main.js"
test -s "$deploy_root/app/package.json"
test -s "$deploy_root/app/pnpm-lock.yaml"
test -d "$deploy_root/app/node_modules"
test ! -e "$deploy_root/app/node_modules/prisma"
test ! -e "$deploy_root/app/node_modules/.bin/prisma"
node -e "const p=require(process.argv[1]); if(p.version!=='0.0.0') process.exit(1)" \
  "$deploy_root/app/package.json"
```

Expected: modern deploy 成功并包含 production runtime；不得加 `--legacy`。

- [x] **Step 5：回归、锁文件审计并提交**

```bash
set -euo pipefail
node --test scripts/server-boundary.test.mjs
node --run test:root
pnpm -C server check
git diff --check
git add server/package.json server/pnpm-workspace.yaml server/pnpm-lock.yaml \
  scripts/server-boundary.test.mjs
git diff --cached --check
git commit -m "build(server): 建立现代生产部署边界"
```

Expected: `server/pnpm-lock.yaml` 只有 settings metadata 变化；所有验证通过。

### Task 3：建立安全的隔离 PostgreSQL 生命周期

**Files:**

- Create: `scripts/ci-postgres.mjs`
- Create: `scripts/ci-postgres.test.mjs`

- [x] **Step 1：先写凭据顺序、容器所有权与清理失败测试**

测试使用可注入 `randomBytes`、filesystem、runner、signal source 和 output writer，至少覆盖：

```js
assert.ok(indexOfMaskPassword < indexOfDockerRun)
assert.ok(indexOfDockerPort < indexOfMaskDatabaseUrl)
assert.ok(indexOfMaskDatabaseUrl < indexOfChildCommand)
assert.deepEqual(run.argv.slice(0, 5), ['run', '--detach', '--cidfile', cidFile, '--env-file'])
assert.match(run.argv.at(-1), /^postgres:16@sha256:[a-f0-9]{64}$/u)
assert.equal(run.argv.some(value => value.includes(password)), false)
assert.deepEqual(remove.argv, ['rm', '--force', '--volumes', exactContainerId])
```

覆盖 `docker run` 失败、health 超时、子进程失败、`SIGINT`、`SIGTERM`、重复 cleanup、伪造 cidfile 和日志脱敏。任何 cleanup 都只能使用本次 cidfile 中通过 `^[a-f0-9]{64}$` 校验的精确 ID。

- [x] **Step 2：运行测试并确认 RED**

```bash
node --test scripts/ci-postgres.test.mjs
```

Expected RED: `ERR_MODULE_NOT_FOUND` 指向 `ci-postgres.mjs`。

- [x] **Step 3：实现可注入生命周期核心**

稳定导出边界是 `POSTGRES_IMAGE`、`runWithPostgres({ command, dependencies })`、`assertOwnedContainerId(value)` 与 `redactSensitiveText(value, sensitiveValues)`。两个同步 helper 直接按以下代码实现，不能用宽松 trim 或正则替换泄露原文：

```js
export const POSTGRES_IMAGE =
  'postgres:16@sha256:be01cf82fc7dbba824acf0a82e150b4b360f3ff93c6631d7844af431e841a95c'

export function assertOwnedContainerId(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error('CI PostgreSQL container ownership is invalid')
  }
  return value
}

export function redactSensitiveText(value, sensitiveValues) {
  const orderedSecrets = [...new Set(sensitiveValues
    .filter(secret => typeof secret === 'string' && secret.length > 0)
  )].sort((left, right) => right.length - left.length)
  return orderedSecrets.reduce(
    (text, secret) => text.split(secret).join('***'),
    String(value),
  )
}
```

`runWithPostgres()` 的输入 `command` 是冻结的非空 argv 数组，成功返回 child 的 `0`，失败抛出携带首个非零 `exitCode` 的固定错误；`dependencies` 必须显式包含 randomBytes、filesystem、Docker runner、child runner、clock/wait、signal source 和 mask writer，测试不允许落回生产依赖。Run `node --test --test-name-pattern='ownership|redact|input' scripts/ci-postgres.test.mjs`，Expected: 同步 helper 与 input 转绿。

- [x] **Step 4：实现 session、随机凭据与本地/GitHub mask 边界**

1. `fs.mkdtemp()` 创建 session 目录并 `chmod 0o700`；env file 使用 `mode: 0o600`。
2. `randomBytes(32).toString('base64url')` 后立即登记敏感值；仅当 `GITHUB_ACTIONS === 'true'` 时向 Runner workflow-command channel 输出 `::add-mask::`，本地执行绝不打印密码。所有异常和转发的 child/Docker 输出先经过本地 `redactSensitiveText()`。
3. env file 写固定 `POSTGRES_USER=qianshu_ci`、`POSTGRES_DB=qianshu_ci` 与随机密码。

Run `node --test --test-name-pattern='session|password|mask|env file' scripts/ci-postgres.test.mjs`，Expected: 权限和 mask-before-Docker 矩阵转绿。

- [x] **Step 5：实现 digest Docker、health 与动态端口**

4. `docker run --detach --cidfile ... --env-file ... --label ... --publish 127.0.0.1::5432/tcp --health-cmd ... <digest>`；全程 argv 数组。
5. 校验 cid，轮询 `docker inspect` health，再执行 `docker port <cid> 5432/tcp` 并只接受 `127.0.0.1:<1-65535>`。

Run `node --test --test-name-pattern='docker|health|port|cidfile' scripts/ci-postgres.test.mjs`，Expected: Docker start/timeout/port fixture 转绿。

- [x] **Step 6：实现 child 环境、输出脱敏与首个退出码**

6. 构造 loopback `DATABASE_URL`，在 GitHub Actions 立即 mask 完整 URL、本地只登记 redaction，随后才传给 child env。测试故意让 child stderr 同时包含 password 与 URL，最终输出必须只含 `***`；由于 secret 按长度降序处理，输出也不得残留 `postgresql://qianshu_ci:***@...` 形式的部分连接串。

Run `node --test --test-name-pattern='child|DATABASE_URL|exit code|stderr' scripts/ci-postgres.test.mjs`，Expected: child success/failure 与 overlapping secret 转绿。

- [x] **Step 7：实现 signal、幂等 cleanup 与 CLI**

7. 保存当前 child handle/process group ownership。收到 `SIGINT`/`SIGTERM` 时先向精确 child process group 转发同一 signal并有界等待；超时再升级终止，确认 child 已退出后才清数据库。`finally` 幂等地按 cid 清理 container/anonymous volumes，再删除 session 目录，始终保留最初失败/信号退出码；cleanup 失败只附加安全诊断。

CLI 只接受 `--` 后非空 argv，不经 shell：

```text
node scripts/ci-postgres.mjs -- node scripts/ci-server-e2e.mjs
```

Run `node --test --test-name-pattern='SIGINT|SIGTERM|cleanup|CLI' scripts/ci-postgres.test.mjs`，Expected: signal/重复清理/CLI 转绿且无残留 ownership。

- [x] **Step 8：GREEN、错误脱敏回归与提交**

```bash
set -euo pipefail
node --test scripts/ci-postgres.test.mjs
node --run test:root
git diff --check
git add scripts/ci-postgres.mjs scripts/ci-postgres.test.mjs
git diff --cached --check
git commit -m "ci: 建立隔离PostgreSQL生命周期"
```

Expected: 单元测试不要求 Docker daemon；测试输出不出现 fixture password 或 URL。

### Task 4：建立 Server migration 与 E2E 串行编排

**Files:**

- Create: `scripts/ci-server-e2e.mjs`
- Create: `scripts/ci-server-e2e.test.mjs`
- Modify: `package.json`
- Modify: `scripts/root-governance.test.mjs`
- Modify: `scripts/run-command.mjs`
- Modify: `scripts/run-command.test.mjs`

- [x] **Step 1：先写 URL 守卫、命令顺序与失败短路测试**

固定命令矩阵：

```js
const EXPECTED_COMMANDS = [
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'db:migrate:deploy']],
  ['pnpm', ['-C', 'server', 'exec', 'prisma', 'migrate', 'status']],
  ['pnpm', ['-C', 'server', 'test:e2e']],
]
```

测试合法 `127.0.0.1`/`localhost`，并拒绝：无密码、其他协议、远端 host、错误 database、URL fragment 和额外用户名。断言 child env 固定 `NODE_ENV=test`、`DOTENV_CONFIG_PATH=/dev/null`，删除 `DEBUG` 与 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`；任一命令失败后不得继续。

同时先在 `run-command.test.mjs` 添加失败测试：注入 `spawnImpl`，调用 `runCommand(..., { env: expectedEnv })`，断言收到的是同一显式 env object 且默认调用仍继承 `process.env`；此时现有实现未转发 `env`，测试应 RED。

- [x] **Step 2：运行测试并确认 RED**

```bash
node --test scripts/run-command.test.mjs scripts/ci-server-e2e.test.mjs
```

Expected RED: E2E 模块缺失，且 `runCommand` 尚未按显式 env 转发。

- [x] **Step 3：实现编排并接入根命令**

`validateCiDatabaseUrl()` 按以下最小代码实现，避免把远端/开发数据库误当 CI 数据库：

```js
export function validateCiDatabaseUrl(rawValue) {
  if (typeof rawValue !== 'string') throw new Error('CI database URL is required')
  let url
  try { url = new URL(rawValue) } catch { throw new Error('CI database URL is invalid') }
  const query = [...url.searchParams.entries()]
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.username !== 'qianshu_ci' || url.password.length === 0 ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !/^\d{1,5}$/u.test(url.port) || url.pathname !== '/qianshu_ci' ||
    url.hash !== '' || JSON.stringify(query) !== JSON.stringify([['schema', 'public']])
  ) throw new Error('CI database URL is outside the isolated boundary')
  return url.toString()
}

export async function runServerE2e({ env = process.env, run = runCommand }) {
  const databaseUrl = validateCiDatabaseUrl(env.DATABASE_URL)
  const childEnv = createSafeChildEnv(env, databaseUrl)
  for (const [command, args] of EXPECTED_COMMANDS) {
    await run(command, args, { env: childEnv })
  }
}
```

`runCommand()` 只补充显式 `env` 转发并保持原安全错误文本、stdio 与退出码语义；Docker capture、signal 和清理由 `ci-postgres.mjs` 自己负责，不能把通用 runner 扩成复杂进程框架。

根脚本入口精确为：

```json
"ci:server-e2e": "node ./scripts/ci-postgres.mjs -- node ./scripts/ci-server-e2e.mjs"
```

同时更新 `root-governance.test.mjs` 的完整 scripts truth source。

- [x] **Step 4：运行 GREEN、根回归并提交**

```bash
set -euo pipefail
node --test scripts/run-command.test.mjs scripts/ci-server-e2e.test.mjs scripts/ci-postgres.test.mjs
node --run test:root
git diff --check
git add package.json scripts/root-governance.test.mjs \
  scripts/run-command.mjs scripts/run-command.test.mjs \
  scripts/ci-server-e2e.mjs scripts/ci-server-e2e.test.mjs
git diff --cached --check
git commit -m "ci(server): 建立数据库迁移与E2E编排"
```

Expected: 单元测试通过，根脚本仍无依赖。

### Task 5：建立接口契约历史基线选择器

**Files:**

- Create: `scripts/ci-contract-baseline.mjs`
- Create: `scripts/ci-contract-baseline.test.mjs`
- Modify: `package.json`
- Modify: `scripts/root-governance.test.mjs`

- [x] **Step 1：先写 PR、push、Release 与无基线失败测试**

在真实临时 Git repo fixture 中提交不同 operationId snapshot，覆盖：

- PR 只接受 event JSON 中完整的 `pull_request.base.sha`。
- `main` push 使用 `before`；全零 SHA 明确返回 `kind: 'none'`。
- Release 在当前 Commit 可达 Tag 中选择低于当前版本的最高稳定 `vX.Y.Z`。
- 首次引入 snapshot 或首次 Release 返回无历史基线；历史 ref 存在但 `git cat-file`/`git show` 异常必须失败。
- prerelease、build metadata、短 SHA、非法 tag、不可达 tag、非 blob、symlink-like tree entry 与临时根逃逸全部拒绝。
- 输出不包含 snapshot 正文，且任何 fixture 密钥字符串不会进入错误信息。

核心预期：

```js
assert.deepEqual(await selectContractBaseline(prEvent), {
  kind: 'file',
  source: baseSha,
  path: baselinePath,
})
assert.deepEqual(await selectContractBaseline(firstPushEvent), { kind: 'none' })
assert.equal(await fs.readFile(baselinePath, 'utf8'), expectedSnapshot)
```

- [x] **Step 2：运行目标测试并确认 RED**

```bash
node --test scripts/ci-contract-baseline.test.mjs
```

Expected RED: 缺少 baseline 模块。

- [x] **Step 3：实现事件解析、Git blob 提取和 contract 委托**

稳定 SemVer helper 先在本模块实现，Task 6 再无行为变化地移到 `release-version.mjs`：

```js
export function parseStableVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.exec(value)
  if (!match) throw new Error('Stable version is invalid')
  const tuple = match.slice(1).map(Number)
  if (!tuple.every(Number.isSafeInteger)) throw new Error('Stable version is unsafe')
  return Object.freeze(tuple)
}

export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}
```

`selectContractBaseline(input, dependencies)` 只返回冻结的 `{ kind: 'none' }` 或 `{ kind: 'file', source, path }`；`runContractCheckForEvent(input, dependencies)` 成功返回 `0`，失败保留第一个有效非零 exit code。input 的允许 key 按事件分别固定，未知 key 失败，不能把完整 GitHub context 透传给 Git。

生产 CLI 从受控环境读取：

```text
GITHUB_EVENT_NAME
GITHUB_EVENT_PATH
GITHUB_SHA
RUNNER_TEMP
QIANSHU_RELEASE_TAG    # 仅由 release.yml 的 workflow_call input 设置
```

GitHub reusable workflow 保留 caller 的 `github` context。因此正式 Tag push
调用 `ci.yml` 时，`GITHUB_EVENT_NAME` 仍是 `push`；Contract CLI 必须同时校验
payload `ref` 与 `QIANSHU_RELEASE_TAG`，再归一化为内部 `release` 事件。

路径处理必须先 `realpath`/canonicalize `RUNNER_TEMP`，再由 `mkdtemp()` 创建子目录。先用 tree mode 证明历史路径是唯一普通文件，再按 blob OID 提取；只检查 `cat-file -t commit:path` 不够，因为 Git symlink 也是 blob。Git 只通过 argv 执行：

```js
await git(['ls-tree', '-z', commit, '--', 'server/openapi/openapi.json'])
// 严格解析唯一 NUL entry：mode=100644、type=blob、40 位 OID、exact path。
await git(['cat-file', 'blob', blobOid])
```

`ls-tree` 的成功空结果才表示固定路径不存在并进入 `none`；mode `120000`、tree/submodule、重复/错误 path、权限、仓库损坏或其他 Git 失败都不降级。最终以 argv 调用：

```text
node scripts/contract-check.mjs --baseline <RUNNER_TEMP child>/openapi-baseline.json
```

无基线时不传 `--baseline`。child env 固定 `DOTENV_CONFIG_PATH=/dev/null`，移除 `DEBUG`、`DATABASE_URL` 与 `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`。

- [x] **Step 4：接入根入口并执行 GREEN**

```json
"ci:contract": "node ./scripts/ci-contract-baseline.mjs"
```

```bash
set -euo pipefail
node --test scripts/ci-contract-baseline.test.mjs scripts/contract-check.test.mjs
node --run test:root
```

Expected: fixture repo 全矩阵通过；根 scripts truth source 同步且无第三方依赖。

- [x] **Step 5：提交**

```bash
git add package.json scripts/root-governance.test.mjs \
  scripts/ci-contract-baseline.mjs scripts/ci-contract-baseline.test.mjs
git diff --cached --check
git commit -m "ci: 建立接口契约历史基线"
```

### Task 6：建立产品版本、annotated Tag 与 main 可达性校验

**Files:**

- Create: `scripts/release-version.mjs`
- Create: `scripts/release-version.test.mjs`
- Modify: `scripts/ci-contract-baseline.mjs`
- Modify: `scripts/ci-contract-baseline.test.mjs`
- Modify: `package.json`
- Modify: `scripts/root-governance.test.mjs`

- [x] **Step 1：先写版本与 Git 身份矩阵失败测试**

用临时 bare `origin` + working repo 验证：

```js
assert.deepEqual(await verifyReleaseVersion(validInput), {
  version: '1.2.3',
  tag: 'v1.2.3',
  tagObjectSha,
  sourceCommit,
})
```

必须拒绝：

- `v1.2`、`1.2.3`、`v1.2.3-rc.1`、`v1.2.3+build`、前导零和超出安全整数范围。
- 根/Server/app 三版本任一不一致，或任一 OpenAPI version 不一致、双快照字节不同。
- lightweight Tag、Tag object 不指向 Commit、peeled Commit 不等于 `HEAD`/期望 source Commit。
- 本地 Tag object/peeled Commit 不等于输入的完整 SHA/当前 checkout。
- source Commit 不可从 checkout 已取得的 `refs/remotes/origin/main` 到达。
- 当前版本不严格大于可达的最高历史稳定 Tag；历史非法/不可 peel Tag 不能静默参与或污染排序。

- [x] **Step 2：运行测试并确认 RED**

```bash
node --test scripts/release-version.test.mjs
```

Expected RED: 模块缺失。

- [x] **Step 3：实现严格校验器与机器可读输出**

稳定导出及返回契约：

```js
export const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
```

- `verifyReleaseVersion(input, dependencies) -> Promise<Readonly<{ version, tag, tagObjectSha, sourceCommit }>>`。
- `readProductVersions(filesystem, repositoryRoot) -> Readonly<{ root, server, webApp, serverOpenApi, webOpenApi }>`；五个路径写死为根/Server/app 三 manifest 与双 snapshot，不读取 `web/package.json.version`。

`parseStableVersion()`/`compareVersions()` 从 `ci-contract-baseline.mjs` 移到更通用的 `release-version.mjs`，baseline 模块改为 import 并保持全部测试绿色；最终仓库只能有一套稳定 SemVer 解析与数字排序实现。

Git 顺序固定：

```text
git cat-file -t refs/tags/<tag>                 # 必须为 tag
git cat-file tag refs/tags/<tag>                # header 的 type 必须直接为 commit
git rev-parse refs/tags/<tag>                   # annotated object SHA
git rev-parse refs/tags/<tag>^{commit}          # peeled Commit
git rev-parse refs/remotes/origin/main
git merge-base --is-ancestor <sourceCommit> refs/remotes/origin/main
```

严格解析 annotated Tag object header 的唯一 `object`、`type`、`tag`、`tagger`；要求 `type commit` 且 `tag` 等于输入，拒绝 tag→tag→commit 的递归 peel。`release-version.mjs` 是只读、无网络校验器，不执行 `fetch`/`ls-remote`，避免在 `persist-credentials: false` 后隐式需要凭据。Release checkout 必须 `fetch-depth: 0` 取得 Tag 和 `refs/remotes/origin/main`；真正远端 TOCTOU 由 Task 9 的 GitHub REST 复验承担。所有 Tag/SHA 先经过严格语法校验后才组成单一 argv 元素。成功时 stdout 只输出单行 JSON；人类诊断写 stderr，不输出文件正文或环境。

CLI 参数固定为：

```text
node scripts/release-version.mjs --tag v1.2.3 --source-commit <40-hex>
```

可选 `--output <RUNNER_TEMP child>/release-version.json` 将同一成功对象以 canonical JSON + 单一末尾换行写入受控临时文件，供 Manifest Job 使用；stdout 与 output 文件内容必须相同语义。

- [x] **Step 4：接入根入口并执行 GREEN**

```json
"release:check": "node ./scripts/release-version.mjs"
```

```bash
set -euo pipefail
node --test scripts/release-version.test.mjs scripts/ci-contract-baseline.test.mjs
node --run test:root
git diff --check
```

- [x] **Step 5：提交**

```bash
git add package.json scripts/root-governance.test.mjs \
  scripts/release-version.mjs scripts/release-version.test.mjs \
  scripts/ci-contract-baseline.mjs scripts/ci-contract-baseline.test.mjs
git diff --cached --check
git commit -m "feat: 建立发布版本与Tag校验"
```

### Task 7：建立 Web/Server 安全归档与 Server 运行 smoke

**Files:**

- Create: `scripts/release-package.mjs`
- Create: `scripts/release-package.test.mjs`
- Modify: `package.json`
- Modify: `scripts/root-governance.test.mjs`

- [x] **Step 1：先写树边界、归档与 smoke 失败测试**

fixture 必须覆盖：

- Web exact top-level `qsmds-web-vX.Y.Z/`，且 `index.html` 是非空 regular file。
- Web 拒绝所有 symlink、socket/device/FIFO、`.env*`、日志、`node_modules`、`src/` 和 canonical root 逃逸。
- Server exact top-level `qsmds-server-vX.Y.Z-linux-x64/`，含非空 `dist/main.js`、`node_modules/`、dedicated `pnpm-lock.yaml`、schema、migration lock 与至少一个 migration 目录。
- Server 拒绝顶层 `node_modules/prisma`、`node_modules/.bin/prisma`、测试文件、真实 env/log；pnpm 内部 symlink 只允许解析到 deploy root 内且不得断裂。
- tar argv 固定 GNU metadata；**解压前**先逐 header 审计 archive member/type，拒绝 absolute/`..`/重复 member、越界 PAX path/linkpath 与特殊文件；安全提取后再走相同树校验。
- 同一输入连续归档两次必须字节和 SHA-256 完全一致；gzip header 的 MTIME 为 0，FLG 不含 FNAME/FCOMMENT，且没有运行目录或时间泄漏。
- smoke 先用 checkout 的 Prisma CLI 对隔离 DB 执行一次 `db:migrate:deploy`，然后从全新解压目录以 `node dist/main.js` 启动；固定 `cwd` 为解压根，进程 env 没有 `NODE_PATH`/`DEBUG`/危险 Prisma 环境，health 必须 `200` 且有 Server-generated `X-Request-Id`。
- 启动失败、health 超时、错误响应、`SIGINT`/`SIGTERM` 都终止精确进程组并清理临时目录；错误信息不得包含 `DATABASE_URL`。

- [x] **Step 2：运行测试并确认 RED**

```bash
node --test scripts/release-package.test.mjs
```

Expected RED: 缺少 package 模块。

- [x] **Step 3：先实现精确 input parser、CLI dispatch 与返回类型**

稳定导出及返回契约：

- `packageWeb(input, dependencies) -> Promise<{ archivePath, size, sha256 }>`。
- `packageServer(input, dependencies) -> Promise<{ archivePath, size, sha256 }>`。
- `smokeServerArchive(input, dependencies) -> Promise<void>`。
- `validateReleaseTree(root, policy, dependencies) -> Promise<ReadonlyArray<ValidatedEntry>>`，返回按 portable relative path 排序、已 `Object.freeze()` 的快照。
- `inspectTarGzipArchive(archivePath, policy, dependencies) -> Promise<ReadonlyArray<ArchiveEntry>>`，在任何 extract 调用前完成 header 审计。

每个 input 都必须是精确 object，未知 key 失败；production dependencies 包含 filesystem、runner、clock/wait、loopback port reserver、process-group controller 和 fetch，测试必须全量注入。

CLI：

```text
node scripts/release-package.mjs web --tag v1.2.3 --output <temp-dir>
node scripts/release-package.mjs server --tag v1.2.3 --output <temp-dir>
node scripts/release-package.mjs smoke-server --tag v1.2.3 --archive <tar.gz>
```

Run `node --test --test-name-pattern='input|CLI' scripts/release-package.test.mjs`，Expected: 只让尚未实现的 tree/package/smoke 行为继续失败，参数矩阵转绿。

- [x] **Step 4：实现 Web/Server tree policy**

`validateReleaseTree()` 使用 `lstat`，在读取 entry 后核对 parent/leaf canonical identity；Web policy 拒绝全部 symlink，Server policy 只接受不逃逸且不断裂的 pnpm symlink。portable key 同时做 Unicode NFC 与 case-fold 冲突检测。遍历前后都检查 root inode，避免校验期间被替换。

Run `node --test --test-name-pattern='tree|symlink|special' scripts/release-package.test.mjs`，Expected: tree fixture 转绿，deploy/archive/smoke 仍 RED。

- [x] **Step 5：实现 Server modern deploy 与两端 staging**

Server deploy 必须使用：

```js
await run('pnpm', [
  '-C', 'server',
  '--filter', '@qianshu-dms/server',
  '--prod', 'deploy', deployRoot,
])
```

Run `node --test --test-name-pattern='deploy|staging|Web package|Server package' scripts/release-package.test.mjs`，Expected: 两端 staging exact tree 转绿，archive/smoke 仍 RED。

- [x] **Step 6：实现确定性 GNU tar 生成**

GNU tar 参数固定为数组，并从 archive staging parent 运行：

```js
[
  '--create', '--gzip', '--file', archivePath,
  '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
  '--format=posix', '--pax-option=delete=atime,delete=ctime', topLevelName,
]
```

连续生成两份 archive，测试 raw bytes、SHA-256 与 gzip header。Run `node --test --test-name-pattern='archive|gzip|metadata' scripts/release-package.test.mjs`，Expected: 生成侧测试转绿。

- [x] **Step 7：实现解压前 tar header 审计与安全提取**

`inspectTarGzipArchive()` 使用 `node:zlib` 解压 gzip stream，按 512-byte POSIX tar header 校验 checksum、size/padding、typeflag、name/prefix 和 PAX record；只接受 regular file/directory，以及 Server policy 下解析后仍位于 deploy root 的 symlink。遇到 GNU longname、hardlink、absolute path、空 segment、`.`/`..`、重复 portable path、device/FIFO/socket 或截断尾部立即失败。随后 GNU tar 提取参数至少包含 `--extract --gzip --no-same-owner --no-same-permissions --directory <fresh-canonical-root>`；提取目标必须是本次创建且预先确认为空的新目录。

Run `node --test --test-name-pattern='preflight|PAX|traversal|extract' scripts/release-package.test.mjs`，Expected: 恶意 archive fixture 全部在 extract runner 调用前失败。

- [x] **Step 8：实现隔离 Server runtime smoke 与进程清理**

Server 子命令在非 `linux/x64` 平台必须失败，防止生成错误标识的 `linux-x64` 包。Web 可在本地生成 fixture 包，但正式 Workflow 同样运行 Ubuntu 24.04。

Smoke 端口不能默认使用 `3000`。端口 reserver 先在 `127.0.0.1:0` 取得候选端口、关闭 reservation 后立即 spawn；若 Server 因端口竞争退出，最多重新选择 3 次。每次 child env 固定 `PORT=<candidate>`、`NODE_ENV=production`、`DOTENV_CONFIG_PATH=/dev/null`，保留隔离 `DATABASE_URL`，删除 `NODE_PATH`、`DEBUG`、`PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`；`cwd` 必须是解压后的顶层 Server 目录，child 使用独立进程组。health 只请求 `http://127.0.0.1:<candidate>/api/health`，同时验证预期 body 结构和 `X-Request-Id`；成功/失败都终止精确进程组并等待退出。

Run `node --test --test-name-pattern='smoke|port|health|process' scripts/release-package.test.mjs`，Expected: 端口竞争、超时、信号和成功矩阵转绿。

- [x] **Step 9：接入根入口并执行单元 GREEN**

```json
"release:package:web": "node ./scripts/release-package.mjs web",
"release:package:server": "node ./scripts/release-package.mjs server",
"release:smoke:server": "node ./scripts/ci-postgres.mjs -- node ./scripts/release-package.mjs smoke-server"
```

```bash
set -euo pipefail
node --test scripts/release-package.test.mjs scripts/ci-postgres.test.mjs
node --run test:root
git diff --check
```

- [ ] **Step 10：在 Linux/CI 执行真实 deploy + archive + smoke**

本地 macOS 只运行 unit fixture；Ubuntu 24.04 或后续 `release.yml` package-server Job 执行：

```bash
set -euo pipefail
pnpm -C server build
release_temp="$(mktemp -d)"
trap 'rm -rf "$release_temp"' EXIT
node --run release:package:server -- --tag v0.0.0 --output "$release_temp/server-package"
node --run release:smoke:server -- \
  --tag v0.0.0 \
  --archive "$release_temp/server-package/qsmds-server-v0.0.0-linux-x64.tar.gz"
```

Expected: archive 从新目录启动并通过 `/api/health`；验证过程不访问 production DB。

- [x] **Step 11：提交**

```bash
git add package.json scripts/root-governance.test.mjs \
  scripts/release-package.mjs scripts/release-package.test.mjs
git diff --cached --check
git commit -m "build: 建立双端发布归档与运行验证"
```

### Task 8：建立 Release Manifest、schema 子集与 SHA256SUMS

**Files:**

- Create: `release/manifest.schema.json`
- Create: `scripts/release-manifest.mjs`
- Create: `scripts/release-manifest.test.mjs`
- Modify: `package.json`
- Modify: `scripts/root-governance.test.mjs`

- [x] **Step 0：为新增 Release Manifest 数据结构取得单独确认**

`release/manifest.schema.json` 是新增公共发布数据结构。开始写 schema 或生成器前，向用户单独确认本 Task 的精确字段仍以设计文档第 13.2 节为准；未确认时暂停 Task 8，不提前创建文件。

- [x] **Step 1：先写 schema mutation、hash 与重读失败测试**

测试从有效 Manifest 开始逐类 mutation，至少覆盖：

- 每个 object 的缺失 required、未知属性与错误 type。
- `schemaVersion` const、Tag/SHA/digest pattern、runtime enum、`runAttempt` 最小值。
- artifact basename 路径分隔符、重复文件名、空/特殊文件、文件替换 TOCTOU。
- OpenAPI 原始 bytes hash、Prisma schema hash、按相对路径排序的 migration file hash 清单与 canonical aggregate hash。
- migration 目录为空、非法目录名、重复时间戳/portable 规范化冲突、symlink/special file；`migrationHead` 精确定义为合法 migration 目录名按 code-point 排序后的最大值，不声称从 Prisma 目录推断不存在的分叉图。
- `SHA256SUMS` 恰好三行、两个空格分隔、固定顺序、纯 hex；生成后重读任一文件变化必须失败。
- schema 出现运行时不支持的 keyword 时，加载阶段必须失败，不能忽略。

- [x] **Step 2：运行测试并确认 RED**

```bash
node --test scripts/release-manifest.test.mjs
```

Expected RED: schema 和模块缺失。

- [x] **Step 3：创建精确 schema**

`manifest.schema.json` 使用 Draft 2020-12，根和所有嵌套 object 都设：

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schemaVersion",
    "release",
    "build",
    "runtime",
    "components",
    "contract",
    "database"
  ]
}
```

字段集合、层级和语义必须逐字对应设计文档第 13.2 节示例。运行时允许的 schema keyword 白名单固定为：

```js
new Set([
  '$schema', 'type', 'properties', 'required', 'additionalProperties',
  'const', 'enum', 'pattern', 'minimum',
])
```

当前 Manifest 没有 array 字段，因此 validator 不实现或接受 `items`/`minItems`；schema 与 validator 保持最小一致，不预留未使用语义。

- [x] **Step 4：实现 schema loader 与确定性子集 validator**

先实现：

- `validateManifestSchema(schema) -> Readonly<SchemaNode>`：未知 keyword 或不可支持组合直接抛固定错误。
- `validateValueAgainstSchema(value, schema, path = '$') -> void`：失败只输出 JSON path 与固定 constraint，不回显 value。

Run `node --test --test-name-pattern='schema|required|type|pattern|enum|additionalProperties|keyword' scripts/release-manifest.test.mjs`，Expected: schema mutation 矩阵转绿，其余 hash/bundle 测试仍 RED。

- [x] **Step 5：实现 source metadata、migration 与文件 hash**

实现按原始 bytes 的 generic SHA-256、OpenAPI/Prisma schema hash、migration portable path 排序清单与 canonical JSON + 单一换行 aggregate hash。拒绝 symlink、special file、空 migration 集合、非法/冲突目录名。

runtime metadata 实际读取 `process.versions.node`（不带 `v` 前缀）、`pnpm --version`、`process.platform/arch` 和 `ldd --version` 首行。Workflow 显式设置受控 `QIANSHU_RUNNER_IMAGE=ubuntu-24.04`，生成器要求 GitHub-hosted runner 的 `ImageOS=ubuntu24`、`RUNNER_OS=Linux`、`RUNNER_ARCH=X64`，再与实际 platform/arch/libc 交叉验证后记录；缺失或不一致都失败。`createdAt` 由注入 clock 生成 UTC ISO 字符串。

Run `node --test --test-name-pattern='hash|migration|runtime|metadata' scripts/release-manifest.test.mjs`，Expected: metadata/hash fixture 转绿。

- [x] **Step 6：实现 Manifest 与 SHA256SUMS 生成**

实现并冻结返回值：

- `createReleaseManifest(input, dependencies) -> Promise<Readonly<ReleaseManifest>>`。
- `createAndVerifyChecksums(input, dependencies) -> Promise<ReadonlyArray<ChecksumEntry>>`。

生成 CLI：

```text
node scripts/release-manifest.mjs \
  --release-metadata <RUNNER_TEMP child>/release-version.json \
  --repository SilnoGM/QIANSHU-DMS \
  --workflow release.yml \
  --run-id <digits> \
  --run-attempt <positive-int> \
  --web-archive <file> \
  --server-archive <file> \
  --output <final-bundle-dir>
```

Run `node --test --test-name-pattern='Manifest|SHA256SUMS|checksum|reread' scripts/release-manifest.test.mjs`，Expected: 生成和磁盘重读转绿。

- [x] **Step 7：实现 final bundle verify 与 verify CLI**

实现 `verifyReleaseBundle(input, dependencies) -> Promise<Readonly<VerifiedBundle>>`：从磁盘重读四文件，校验 schema、三行 checksum、固定文件集合，并交叉核对 Manifest identity 与两个归档 basename/size/digest。CLI：

```text

node scripts/release-manifest.mjs verify \
  --bundle <final-bundle-dir> \
  --release-metadata <release-version.json> \
  --repository SilnoGM/QIANSHU-DMS \
  --run-id <digits> \
  --bundle-run-attempt <positive-int>
```

Run `node --test scripts/release-manifest.test.mjs`，Expected: bundle identity/TOCTOU 与全部测试转绿。

- [x] **Step 8：接入根入口、GREEN 与提交**

```json
"release:manifest": "node ./scripts/release-manifest.mjs"
```

```bash
set -euo pipefail
node --test scripts/release-manifest.test.mjs
node --run test:root
git diff --check
git add release/manifest.schema.json package.json scripts/root-governance.test.mjs \
  scripts/release-manifest.mjs scripts/release-manifest.test.mjs
git diff --cached --check
git commit -m "feat: 建立发布清单与校验和"
```

Expected: schema mutation 全部被相应边界捕获；生成目录只在临时路径，未提交 generated Manifest。

### Task 9：建立 GitHub Draft Release 安全协调器

**Files:**

- Create: `scripts/release-github.mjs`
- Create: `scripts/release-github.test.mjs`
- Modify: `package.json`
- Modify: `scripts/root-governance.test.mjs`

- [x] **Step 1：先写无网络 GitHub REST 状态机失败测试**

使用可注入 `fetch`、clock、wait、filesystem，构造分页 REST fixture，至少覆盖：

- 无 Release：远端 Tag 第一次复验后创建 Draft，重读 author，再上传四附件。
- 已发布、foreign Draft、target Commit 不同、marker 缺失/重复/伪造、author 非 bot：失败且无 mutation。
- final bundle artifact 的 repository/run ID/generation attempt/artifact ID/digest/name/head SHA 任一不一致：失败。
- 下载后的 Manifest 必须再次通过 schema，并与 repository/Tag/source Commit/run ID/bundle generation attempt、marker、两个 archive basename/digest 和 `SHA256SUMS` 交叉一致；不能只验证 checksum 文件自身。
- 只重跑失败的 `publish`：当前 `run_attempt` 可增加，但 marker 必须仍绑定原 bundle generation attempt 与同一 artifact ID/digest。
- 完整重跑产生新 bundle ID/digest 时遇到旧 Draft：安全失败，不复用、不删除。
- 已有 asset 只有 `name + size + digest + uploader` 全匹配才复用；缺失才上传；unknown、duplicate、同名不符、uploader 不符全部失败。
- digest 为 `null` 时按注入 clock 验证 `1s/2s/4s/8s`；耗尽或不符失败并保留 Draft。
- 任一上传部分失败后不发布；再次运行只补缺失且已存在资产仍须完整验证。
- 创建 Draft 前和发布前两次读取远端 annotated Tag object；两次之间 Tag object、peeled Commit、main 可达性或版本单调性变化时失败。
- 远端稳定 Tag 列表分页完整读取并按数字 SemVer 排序；出现等于或高于当前版本的其他稳定产品 Tag 时拒绝旧版本发布。
- `401/403/404/409/422/5xx`、网络中断、分页循环/越界、恶意 JSON 的固定错误分类与脱敏。
- POST/PATCH/upload mutation 不做盲目自动重试；响应不确定时先重新读取资源状态，仍不确定则失败等待人工处理。
- 任何路径都没有 DELETE、覆盖上传或 Tag 写入请求。

期望请求序列示意：

```js
assert.deepEqual(mutations.map(request => request.method), [
  'POST',  // create draft
  'POST', 'POST', 'POST', 'POST', // upload four missing assets
  'PATCH', // publish only after second tag check and exact asset set
])
assert.equal(mutations.some(request => request.method === 'DELETE'), false)
```

- [x] **Step 2：运行测试并确认 RED**

```bash
node --test scripts/release-github.test.mjs
```

Expected RED: 模块缺失。

- [x] **Step 3：实现认证 client、错误归一化与有界分页**

稳定导出及返回契约：

- `createGitHubClient({ apiUrl, token, fetchImpl, clock, wait }) -> Readonly<GitHubClient>`，只暴露受限 `get/post/patch/upload` 方法。
- `verifyRemoteReleaseTag(client, expected) -> Promise<Readonly<RemoteTagIdentity>>`。
- `verifyWorkflowArtifact(client, expected) -> Promise<Readonly<ArtifactIdentity>>`。
- `createOwnershipMarker(identity) -> string` 与 `parseOwnershipMarker(body) -> Readonly<MarkerIdentity>`；marker 必须恰好一个。
- `coordinateDraftRelease(input, dependencies) -> Promise<Readonly<{ releaseId, state: 'published' }>>`。

CLI 唯一形式如下；参数 parser 拒绝未知、重复、缺失 flag，所有 ID/SHA/digest/路径先验证再进入协调器：

```text
node scripts/release-github.mjs \
  --repository SilnoGM/QIANSHU-DMS \
  --tag v1.2.3 \
  --source-commit <40-hex> \
  --run-id <digits> \
  --bundle-run-attempt <positive-int> \
  --current-run-attempt <positive-int> \
  --artifact-id <digits> \
  --artifact-digest sha256:<64-hex> \
  --artifact-name release-final-<run-id>-<bundle-run-attempt> \
  --bundle <fresh-final-bundle-directory>
```

在 Step 1 先为这组 argv 写 exact parse 测试；Workflow 只能使用这些 flag 名称，token 仍只通过 env。

只从 `GITHUB_API_URL`（默认 `https://api.github.com`）、`GITHUB_TOKEN` 和显式 argv 读取输入。HTTP headers 固定 `Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28` 与 Bearer token；token 永不进入 error、request dump 或 marker。

先完成只读 GET、Link pagination、最大页数/seen URL、HTTP status 分类和固定脱敏错误。Run `node --test --test-name-pattern='client|pagination|401|403|404|409|422|5xx' scripts/release-github.test.mjs`，Expected: client/pagination 矩阵转绿，mutation 状态机仍 RED。

- [x] **Step 4：实现远端 Tag、稳定版本与 workflow artifact 身份复验**

远端复验至少读取：

```text
GET /repos/{owner}/{repo}/git/ref/tags/{tag}
GET /repos/{owner}/{repo}/git/tags/{tagObjectSha}
GET /repos/{owner}/{repo}/git/matching-refs/tags/
GET /repos/{owner}/{repo}/compare/main...{sourceCommit}
GET /repos/{owner}/{repo}/actions/artifacts/{artifactId}
GET /repos/{owner}/{repo}/releases?per_page=100&page={page}
```

`GET /releases/tags/{tag}` 只保证返回 published Release，不能用于发现 Draft。协调器必须用具备写权限的 token 分页列出 Releases，再按 exact `tag_name` 找到零个或唯一一个 Draft/published Release；重复 tag 结果直接失败。Tag ref 的 object type 必须为 `tag`，tag object 的 target type 必须为 `commit`。以 `main` 为 base、source Commit 为 head 的 Compare 结果只接受 `behind` 或 `identical`，并核对 merge base；`ahead`/`diverged` 均失败。分页读取 Tag refs、Releases 与 assets 时设置最大页数与 seen URL 集合。

Run `node --test --test-name-pattern='tag|version|artifact|main' scripts/release-github.test.mjs`，Expected: 两次复用的只读 identity verifier 转绿，不产生 mutation。

- [x] **Step 5：实现唯一 marker 与 Draft ownership 判定**

marker 使用单个 HTML comment 和 canonical JSON：

```text
<!-- qianshu-release:{"schemaVersion":1,"repository":"SilnoGM/QIANSHU-DMS","tag":"v1.2.3","sourceCommit":"...","runId":"123","bundleRunAttempt":1,"artifactId":"456","artifactDigest":"sha256:..."} -->
```

创建 Draft 参数固定 `draft: true`、`prerelease: false`、`target_commitish: sourceCommit`、`generate_release_notes: true`。GitHub 对已存在 Tag 忽略 `target_commitish`，因此不能把 Release response 的该字段当作 Commit 真相源；所有权必须由 exact `tag_name`、远端 Tag ref/object peel 和 marker `sourceCommit` 共同证明。新建后通过 Releases list 重读并确认 `author.login === 'github-actions[bot]'`。

Run `node --test --test-name-pattern='marker|Draft|author|published|foreign' scripts/release-github.test.mjs`，Expected: ownership 矩阵转绿，尚未上传/发布。

- [x] **Step 6：实现 no-clobber asset reconcile 与 digest 重试**

四个唯一允许的 basename：

```js
[
  `qsmds-web-${tag}.tar.gz`,
  `qsmds-server-${tag}-linux-x64.tar.gz`,
  'release-manifest.json',
  'SHA256SUMS',
]
```

外部 mutation 前先调用 `verifyReleaseBundle()`；上传前再次从磁盘重读 size/hash。上传请求使用 Release 返回的受信 `upload_url`、经过 `encodeURIComponent()` 的固定 basename、显式 `Content-Type` 与 `Content-Length`，不得拼接任意外部 URL。上传后从 Release assets API 重读 uploader/size/digest。

Run `node --test --test-name-pattern='asset|upload|digest|uploader|clobber' scripts/release-github.test.mjs`，Expected: 缺失补传/完全复用/冲突拒绝和有界等待转绿，仍不执行最终 publish。

- [x] **Step 7：实现第二次远端复验与唯一 publish gate**

发布前重新执行 Tag/稳定版本/main 校验、精确附件集合校验，并再次调用 `verifyReleaseBundle()` 交叉验证 Manifest/schema/checksum/identity；全部相同时最后唯一 PATCH 为 `{ draft: false }`。Mutation 网络结果不确定时只重读状态，不盲目重复 POST/PATCH。

Run `node --test scripts/release-github.test.mjs`，Expected: 全部状态机测试转绿且 mutation 序列精确。

- [x] **Step 8：接入根入口、GREEN 与提交**

```json
"release:publish": "node ./scripts/release-github.mjs"
```

```bash
set -euo pipefail
node --test scripts/release-github.test.mjs
node --run test:root
git diff --check
git add package.json scripts/root-governance.test.mjs \
  scripts/release-github.mjs scripts/release-github.test.mjs
git diff --cached --check
git commit -m "feat: 建立GitHub Release安全协调"
```

Expected: 测试没有真实网络调用；所有 mutation 的调用次数与顺序可精确断言。

### Task 10：添加主 CI Workflow 与稳定 ci-gate

**Files:**

- Create: `scripts/ci-workflows.test.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `scripts/root-governance.test.mjs`

- [x] **Step 1：先写 `ci.yml` 源码结构失败测试**

由于根目录不能增加 YAML parser，测试以严格源码结构和受限 extraction 验证：

- 只触发 `main` 的 `pull_request`/`push`，并声明带可选 `release_tag` string input 的 `workflow_call`；不得有 path filter。
- 顶层 `permissions: contents: read`；没有 Secret context、`pull_request_target` 或 root pnpm install。
- Required Job 恰好包含 `root-governance`、`server-check-build`、`server-e2e`、`contract`、`web-check-build`、`ci-gate`。
- 前五个 Job 使用 `ubuntu-24.04`、固定 timeout；每个 checkout 都有 `persist-credentials: false`。
- contract 使用 `fetch-depth: 0`；其他 CI checkout 使用最小 `fetch-depth: 1`。
- 依赖 Job 顺序都是 checkout → `pnpm/action-setup` → `actions/setup-node`；前者只安装 pnpm，后者唯一负责 `cache: pnpm`。
- Server cache path 只含 `server/pnpm-lock.yaml`，Web 只含 `web/pnpm-lock.yaml`，Contract 同时包含两份。
- Server/Web 分别 `--frozen-lockfile`；root Job 不运行 install。
- 每个验证 Job 末尾都有 tracked diff 检查。
- `ci-gate` 使用 `if: always()` 且对 `failure`、`cancelled`、`skipped` 全失败。
- called workflow 并发组以 `qianshu-ci-` 开头，且不会与 `qianshu-release` 相同或取消 caller。
- 所有 `uses:` 与 PostgreSQL image 精确等于“固定外部引用”表。

- [x] **Step 2：运行测试并确认 RED**

```bash
node --test scripts/ci-workflows.test.mjs
```

Expected RED: `.github/workflows/ci.yml` 不存在。

- [x] **Step 3：实现 CI 触发、权限、并发和运行时模板**

Workflow 顶层骨架：

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_call:
    inputs:
      release_tag:
        required: false
        type: string
        default: ''

permissions:
  contents: read

concurrency:
  group: qianshu-ci-${{ inputs.release_tag != '' && github.run_id || github.event.pull_request.number || github.ref }}
  cancel-in-progress: ${{ inputs.release_tag == '' }}
```

依赖 Job 统一 setup 顺序：

```yaml
- uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
  with:
    persist-credentials: false
    fetch-depth: 1
- uses: pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9
  with:
    version: 11.9.0
    run_install: false
- uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
  with:
    node-version-file: .node-version
    cache: pnpm
    cache-dependency-path: server/pnpm-lock.yaml
```

不得同时启用两个 pnpm cache owner。

- [x] **Step 4：实现 root-governance 与 always ci-gate**

`root-governance` 不 setup pnpm、不 install，执行 `node --run test:root` 并检查根 lock/workspace/node_modules 不存在。`ci-gate` 以 `needs` 引用另外五个验证 Job，使用 `if: always()` 和 env `NEEDS_JSON: ${{ toJSON(needs) }}`；Node 程序只接受所有 `result === 'success'`，其他状态退出 1。

Run `node --test --test-name-pattern='root-governance|ci-gate' scripts/ci-workflows.test.mjs`，Expected: root/gate 结构转绿。

- [x] **Step 5：实现两个 Server Job**

命令固定：

```text
server-check-build: pnpm -C server install --frozen-lockfile; check; build; dist/main.js
server-e2e:         pnpm -C server install --frozen-lockfile; node --run ci:server-e2e
```

两个 Job 各自使用 server lock cache、timeout 和 tracked diff；E2E 不声明 GitHub `services:`。Run `node --test --test-name-pattern='server-check-build|server-e2e' scripts/ci-workflows.test.mjs`，Expected: Server jobs 转绿。

- [x] **Step 6：实现 Contract Job**

Contract Job 使用 `fetch-depth: 0`、两份 lock cache，分别 frozen install Server/Web 后运行 `node --run ci:contract`。设置：

```yaml
env:
  DOTENV_CONFIG_PATH: /dev/null
  QIANSHU_RELEASE_TAG: ${{ inputs.release_tag }}
```

不得设置 `DATABASE_URL`、`DEBUG` 或危险 Prisma 环境。Run `node --test --test-name-pattern='contract' scripts/ci-workflows.test.mjs`，Expected: PR/push/release input 与 history/cache 结构转绿。

- [x] **Step 7：实现 Web Job**

`web-check-build` 只使用 Web lock cache，依次运行 frozen install、`api:generate`、`check`、`build`，验证 `dist/index.html` 后执行 tracked diff。Run `node --test --test-name-pattern='web-check-build' scripts/ci-workflows.test.mjs`，Expected: Web Job 转绿。

- [x] **Step 8：运行结构测试、固定 actionlint 与根回归**

```bash
set -euo pipefail
node --test scripts/ci-workflows.test.mjs
tool_root="$(mktemp -d)"
trap 'rm -rf "$tool_root"' EXIT
archive="$tool_root/actionlint.tar.gz"
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64)
    asset='actionlint_1.7.12_darwin_arm64.tar.gz'
    checksum='aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f'
    ;;
  Linux/x86_64)
    asset='actionlint_1.7.12_linux_amd64.tar.gz'
    checksum='8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8'
    ;;
  *) echo 'Unsupported actionlint verification platform' >&2; exit 1 ;;
esac
curl -fsSL -o "$archive" \
  "https://github.com/rhysd/actionlint/releases/download/v1.7.12/$asset"
node -e "const fs=require('node:fs'),c=require('node:crypto'); const actual=c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'); if(actual!==process.argv[2]) process.exit(1)" \
  "$archive" "$checksum"
tar -xzf "$archive" -C "$tool_root"
"$tool_root/actionlint" .github/workflows/ci.yml
node --run test:root
```

Expected: 结构测试与 actionlint 均通过；这只证明本地语义，不声称 GitHub Actions 已运行。每个后续 Task 都必须重新创建临时目录、下载并校验 binary，不能复用本 Step 已被 trap 删除的路径或环境变量。

- [x] **Step 9：提交**

```bash
git add .github/workflows/ci.yml scripts/ci-workflows.test.mjs \
  scripts/root-governance.test.mjs
git diff --cached --check
git commit -m "ci: 添加主CI工作流"
```

### Task 11：添加隔离的参考应用 Workflow

**Files:**

- Create: `.github/workflows/examples.yml`
- Modify: `scripts/ci-workflows.test.mjs`

- [x] **Step 1：先扩展 schedule/dispatch 与非阻断失败测试**

断言 `examples.yml`：

- 只包含 `workflow_dispatch` 和 `schedule: cron: '17 2 1 * *'`。
- 不被 `ci.yml` 的 `needs`、`ci-gate` 或 `release.yml` 引用。
- 不使用 `continue-on-error`；自身失败应可见。
- 权限只读、Ubuntu 24.04、固定 timeout、精确 Action SHA、checkout 不保留凭据。
- 唯一 cache lockfile 是 `web/pnpm-lock.yaml`。
- 只运行 Web frozen install、`check:examples`、`build:examples` 与 tracked diff。

- [x] **Step 2：运行测试并确认 RED**

```bash
node --test scripts/ci-workflows.test.mjs
```

Expected RED: examples Workflow 不存在。

- [x] **Step 3：实现、lint、回归并提交**

```bash
set -euo pipefail
node --test scripts/ci-workflows.test.mjs
tool_root="$(mktemp -d)"
trap 'rm -rf "$tool_root"' EXIT
archive="$tool_root/actionlint.tar.gz"
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) asset='actionlint_1.7.12_darwin_arm64.tar.gz'; checksum='aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f' ;;
  Linux/x86_64) asset='actionlint_1.7.12_linux_amd64.tar.gz'; checksum='8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8' ;;
  *) echo 'Unsupported actionlint verification platform' >&2; exit 1 ;;
esac
curl -fsSL -o "$archive" "https://github.com/rhysd/actionlint/releases/download/v1.7.12/$asset"
node -e "const fs=require('node:fs'),c=require('node:crypto'); const actual=c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'); if(actual!==process.argv[2]) process.exit(1)" "$archive" "$checksum"
tar -xzf "$archive" -C "$tool_root"
"$tool_root/actionlint" .github/workflows/ci.yml .github/workflows/examples.yml
node --run test:root
git diff --check
git add .github/workflows/examples.yml scripts/ci-workflows.test.mjs
git diff --cached --check
git commit -m "ci: 添加参考应用工作流"
```

Expected: 本 Task 独立下载并校验 actionlint；不得假定系统全局版本或复用 Task 10 临时路径。

### Task 12：添加统一产品 Release Workflow

**Files:**

- Create: `.github/workflows/release.yml`
- Modify: `scripts/ci-workflows.test.mjs`

- [x] **Step 1：先扩展 Tag、final bundle 与最小写权限失败测试**

断言 `release.yml`：

- 只监听 `push.tags: ['v*.*.*']`；没有 `workflow_dispatch`、branch push 或自动 Tag 创建。
- 顶层 `permissions: contents: read`，固定全局 `concurrency.group: qianshu-release`、`cancel-in-progress: false`。
- Job 顺序与 `needs` 是 `verify → package-web/package-server → manifest → publish`。
- `verify` 以本地 reusable workflow 调用 `./.github/workflows/ci.yml` 并传 `release_tag`，不传 Secret。
- package jobs 从 Tag full-history checkout，重新 frozen install/build；不得复用 PR CI `dist/`。
- Server package 使用 Task 3 PostgreSQL wrapper 完成 archive runtime smoke。
- 中间 artifact 名称包含 `run_id + generation run_attempt`，保留 1 天；final bundle 恰好四文件并保留 7 天。
- 两个 package Job 都把各自 upload step 的 `artifact-id` 显式提升为 job-level output；禁止消费不存在的 step-local output。
- Manifest Job 只通过 `actions/download-artifact` 的精确 `artifact-ids` 下载两个中间 artifact，并显式 `merge-multiple: true` 到全新 inputs 目录；不按模糊 pattern 合并其他产物。
- final upload step 输出 `artifact-id`、`artifact-digest` 与生成 bundle 的 `run_attempt` 到 Job outputs。
- `publish` 只按 `needs.manifest.outputs.artifact-id` 下载 final bundle；只该 Job 拥有 `contents: write`，另有 REST 查询需要的 `actions: read`。
- publish-only rerun 把原 `bundle-run-attempt`、artifact ID/digest 传给协调器，同时把当前 `github.run_attempt` 作为独立值；不得重新 build/manifest。
- 所有 checkout `persist-credentials: false`、所有 Actions 完整 SHA、所有 **runner-backed** Job timeout、tracked diff 和固定附件名存在。`verify` 是 `jobs.<id>.uses` reusable-workflow call，不支持 `timeout-minutes`，其超时由被调 `ci.yml` 每个真实 Job 保证。

- [x] **Step 2：运行测试并确认 RED**

```bash
node --test scripts/ci-workflows.test.mjs
```

Expected RED: release Workflow 不存在。

- [x] **Step 3：实现 Tag trigger、并发与 reusable verify**

顶层和 verify：

```yaml
name: Release

on:
  push:
    tags:
      - 'v*.*.*'

permissions:
  contents: read

concurrency:
  group: qianshu-release
  cancel-in-progress: false

jobs:
  verify:
    uses: ./.github/workflows/ci.yml
    with:
      release_tag: ${{ github.ref_name }}
```

Run `node --test --test-name-pattern='Release trigger|concurrency|verify' scripts/ci-workflows.test.mjs`，Expected: trigger/权限/verify 转绿，package/manifest/publish 仍 RED。

- [x] **Step 4：实现 package-web 与 Web artifact output**

package-web 使用 full-history Tag checkout、Web cache/frozen install，并先执行：

```text
node --run release:check -- \
  --tag "$GITHUB_REF_NAME" \
  --source-commit "$GITHUB_SHA"
```

随后执行 Web build/package 与内容校验。上传示意：

```yaml
- id: upload-web
  uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
  with:
    name: release-web-${{ github.run_id }}-${{ github.run_attempt }}
    path: ${{ runner.temp }}/release-web/qsmds-web-${{ github.ref_name }}.tar.gz
    if-no-files-found: error
    retention-days: 1
    compression-level: 0
```

上传前脚本已经固定 basename、regular file、size 与内容；不能使用 `include-hidden-files: true`。

声明 `outputs.artifact-id: ${{ steps.upload-web.outputs.artifact-id }}`。Run `node --test --test-name-pattern='package-web|upload-web' scripts/ci-workflows.test.mjs`，Expected: Web package Job 转绿。

- [x] **Step 5：实现 package-server、runtime smoke 与 Server artifact output**

package-server 同样 full-history checkout，运行 `release:check`、Server frozen install/build、`release:package:server`，再通过 `release:smoke:server` 使用隔离 PostgreSQL 完成 archive health smoke；只有全部成功才执行 `upload-server`，retention/compression 与 Web 相同。

upload step output 不会自动提升为 Job output。两个 package Job 必须分别显式声明，结构测试也要锁定：

```yaml
package-web:
  outputs:
    artifact-id: ${{ steps.upload-web.outputs.artifact-id }}

package-server:
  outputs:
    artifact-id: ${{ steps.upload-server.outputs.artifact-id }}
```

两个 upload step ID 必须与映射完全一致，且成功输出只能被 `manifest` Job 消费。

Run `node --test --test-name-pattern='package-server|upload-server|smoke' scripts/ci-workflows.test.mjs`，Expected: Server package Job 转绿。

- [x] **Step 6：实现 Manifest/final bundle 身份输出**

Manifest Job 必须重新 checkout/fetch 全历史、setup Node/pnpm，并再次运行 `release:check --output "$RUNNER_TEMP/release-version.json"`。下载目标与输出目标分离：

Manifest 生成 step 显式设置 `QIANSHU_RUNNER_IMAGE=ubuntu-24.04`，并保留 GitHub Runner 自带的 `ImageOS`、`RUNNER_OS`、`RUNNER_ARCH` 供生成器交叉验证；不得在脚本中硬猜宿主镜像。

```yaml
- uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
  with:
    artifact-ids: ${{ needs.package-web.outputs.artifact-id }},${{ needs.package-server.outputs.artifact-id }}
    path: ${{ runner.temp }}/release-inputs
    merge-multiple: true
```

下载前断言 `release-inputs` 不存在，下载后断言该目录只有两个预期非空 regular archive，没有子目录/symlink/额外项；`final-bundle` 另行创建并确认初始为空。生成后的最终目录必须是：

```text
$RUNNER_TEMP/final-bundle/
├── qsmds-web-vX.Y.Z.tar.gz
├── qsmds-server-vX.Y.Z-linux-x64.tar.gz
├── release-manifest.json
└── SHA256SUMS
```

final upload：

```yaml
- id: upload-final
  uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
  with:
    name: release-final-${{ github.run_id }}-${{ github.run_attempt }}
    path: ${{ runner.temp }}/final-bundle/
    if-no-files-found: error
    retention-days: 7
    compression-level: 0
```

Job outputs 精确映射：

```yaml
outputs:
  artifact-id: ${{ steps.upload-final.outputs.artifact-id }}
  artifact-digest: ${{ steps.upload-final.outputs.artifact-digest }}
  bundle-run-attempt: ${{ github.run_attempt }}
```

- [x] **Step 7：实现 publish-only 外部写入 Job**

```yaml
publish:
  needs: manifest
  runs-on: ubuntu-24.04
  timeout-minutes: 15
  permissions:
    actions: read
    contents: write
```

Publish Job 必须先 checkout 当前 Tag Commit（`persist-credentials: false`、`fetch-depth: 1`）并用固定 SHA 的 `actions/setup-node` 读取 `.node-version`，这样 `scripts/release-github.mjs` 与 `release/manifest.schema.json` 来自同一 source Commit；该 Job 不安装根依赖或 pnpm。随后才下载 exact final artifact。

按精确 artifact ID 下载：

```yaml
- uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
  with:
    artifact-ids: ${{ needs.manifest.outputs.artifact-id }}
    path: ${{ runner.temp }}/final-bundle
```

协调器调用与 Task 9 CLI 完全一致：

```text
node --run release:publish -- \
  --repository "$GITHUB_REPOSITORY" \
  --tag "$GITHUB_REF_NAME" \
  --source-commit "$GITHUB_SHA" \
  --run-id "$GITHUB_RUN_ID" \
  --bundle-run-attempt "${{ needs.manifest.outputs.bundle-run-attempt }}" \
  --current-run-attempt "$GITHUB_RUN_ATTEMPT" \
  --artifact-id "${{ needs.manifest.outputs.artifact-id }}" \
  --artifact-digest "${{ needs.manifest.outputs.artifact-digest }}" \
  --artifact-name "release-final-${GITHUB_RUN_ID}-${{ needs.manifest.outputs.bundle-run-attempt }}" \
  --bundle "$RUNNER_TEMP/final-bundle"
```

这些 shell 变量都作为独立 argv 且先由脚本校验；`GITHUB_TOKEN` 只通过 step env 注入，不出现在 argv。

- [x] **Step 8：本地结构/actionlint/根回归**

```bash
set -euo pipefail
node --test scripts/ci-workflows.test.mjs scripts/release-github.test.mjs
tool_root="$(mktemp -d)"
trap 'rm -rf "$tool_root"' EXIT
archive="$tool_root/actionlint.tar.gz"
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) asset='actionlint_1.7.12_darwin_arm64.tar.gz'; checksum='aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f' ;;
  Linux/x86_64) asset='actionlint_1.7.12_linux_amd64.tar.gz'; checksum='8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8' ;;
  *) echo 'Unsupported actionlint verification platform' >&2; exit 1 ;;
esac
curl -fsSL -o "$archive" "https://github.com/rhysd/actionlint/releases/download/v1.7.12/$asset"
node -e "const fs=require('node:fs'),c=require('node:crypto'); const actual=c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'); if(actual!==process.argv[2]) process.exit(1)" "$archive" "$checksum"
tar -xzf "$archive" -C "$tool_root"
"$tool_root/actionlint" .github/workflows/ci.yml \
  .github/workflows/examples.yml \
  .github/workflows/release.yml
node --run test:root
git diff --check
```

Expected: 本地结构与 YAML 语义通过；不得声称远端 artifact outputs 或 publish-only rerun 已经在 GitHub 平台验证。

- [x] **Step 9：提交**

```bash
git add .github/workflows/release.yml scripts/ci-workflows.test.mjs
git diff --cached --check
git commit -m "ci: 添加统一产品发布工作流"
```

### Task 13：完成中文发布文档、治理事实与本地集成验收

**Files:**

- Create: `docs/全局文档/发布与版本管理.md`
- Modify: `README.md`
- Modify: `server/README.md`
- Modify: `server/AGENTS.md`
- Modify: `web/README.md`
- Modify: `web/AGENTS.md`
- Modify: `docs/全局文档/项目工程组织方案.md`
- Modify: `docs/全局文档/阶段五CI与发布设计.md`
- Modify: `docs/全局文档/阶段五CI与发布实施计划.md`
- Modify: `docs/后端文档/后端架构.md`
- Modify: `docs/前端文档/前端架构.md`
- Modify: `docs/文档索引.md`
- Modify: `scripts/root-governance.test.mjs`
- Modify: `web/scripts/project-guidance.test.mjs`

- [x] **Step 1：先写文档真相源与陈旧表述失败测试**

新增治理断言：

- 正式文档必须存在 `发布与版本管理.md`，索引链接精确。
- 根 README 列出 `ci:server-e2e`、`ci:contract` 与 Release 命令，但不暗示根 install。
- Server 文档不再把 workspace 配置描述为“仅有 allowBuilds”，明确 `injectWorkspacePackages` 只服务现代 production deploy。
- Web 文档明确 `6.3.0` 是上游基座版本，正式 app 使用自身产品 version，且没有 `bumpp` 入口。
- 组织方案不再保留旧五工作流、路径跳过或“未变化组件沿用旧 digest”；阶段五状态改为已实施，但平台真实验收状态必须单独表述。
- 设计文档开头从“尚未落地”更新为实现事实，并链接实施计划；不能改写已经确认的 REQ。

先运行并确认新的文档断言因文件缺失/陈旧事实而 RED。

- [x] **Step 2：编写 `发布与版本管理.md`**

中文文档必须完整覆盖：

1. 三个产品 version 镜像与 `web/package.json.version` 的基座语义。
2. 修改公共 OpenAPI version 前单独确认、执行 `contract:sync`、完整检查、提交版本准备 Commit。
3. 创建 annotated Tag 的精确命令与禁止移动/复用 Tag。
4. 三 Workflow 的触发、Required Gate、Examples 非阻断边界。
5. 两个归档、Manifest、`SHA256SUMS` 四附件的含义与下载后校验命令。
6. Server `linux-x64` 的 Ubuntu 24.04/glibc x64/Node 24 兼容范围。
7. Draft 部分失败时只重跑 `publish` 的条件；完整重跑遇旧 Draft 的人工检查/删除规则。
8. 已发布 Release 不可修改；修复使用新 Patch 版本。
9. PostgreSQL migration 只向前、发布流程不连接生产数据库、不自动部署。
10. 管理员一次性配置：`ci-gate` Required Check、`v*.*.*` Tag ruleset、Release immutability。

不得写入真实 token、连接串、仓库 Secret 值或可误执行的测试 Tag 示例。

- [x] **Step 3：同步 README、架构文档和阶段状态**

重点替换：

- `.github/workflows/` 从阶段目标变为三工作流实施事实。
- 旧“选择性组件沿用上一 digest”改为同一 Tag Commit 总是重建双端。
- 阶段五状态写成“代码与本地验证已实施；GitHub 平台验证以 Task 14 记录为准”，在未 push 前不能写“CI 已通过”。
- 更新 Server/Web 独立移植说明，确保新增发布能力不创造跨目录依赖。

只有确有陈旧事实的文档才修改；根 `AGENTS.md` 当前边界无需为了凑文件而改动。

- [x] **Step 4：运行平台无关完整验证**

```bash
set -euo pipefail
node --run test:root
env -u DATABASE_URL DOTENV_CONFIG_PATH=/dev/null pnpm -C server check
pnpm -C server build
node --run ci:server-e2e
node --run contract:check
pnpm -C web api:generate
pnpm -C web check
pnpm -C web build
pnpm -C web check:examples
pnpm -C web build:examples
test ! -e pnpm-workspace.yaml
test ! -e pnpm-lock.yaml
test ! -e node_modules
git diff --check
```

Expected: 所有命令通过；Docker E2E 后 `docker ps --filter label=com.qianshu-dms.ci --format '{{.ID}}'` 没有本次残留。若 Docker daemon 不可用，明确报告失败，不能跳过后声称完成。

- [x] **Step 5：运行固定 actionlint 与安全审计**

```bash
set -euo pipefail
tool_root="$(mktemp -d)"
trap 'rm -rf "$tool_root"' EXIT
archive="$tool_root/actionlint.tar.gz"
case "$(uname -s)/$(uname -m)" in
  Darwin/arm64) asset='actionlint_1.7.12_darwin_arm64.tar.gz'; checksum='aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f' ;;
  Linux/x86_64) asset='actionlint_1.7.12_linux_amd64.tar.gz'; checksum='8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8' ;;
  *) echo 'Unsupported actionlint verification platform' >&2; exit 1 ;;
esac
curl -fsSL -o "$archive" "https://github.com/rhysd/actionlint/releases/download/v1.7.12/$asset"
node -e "const fs=require('node:fs'),c=require('node:crypto'); const actual=c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'); if(actual!==process.argv[2]) process.exit(1)" "$archive" "$checksum"
tar -xzf "$archive" -C "$tool_root"
"$tool_root/actionlint" .github/workflows/*.yml
! rg -n 'pull_request_target|uses:\s+[^@]+@(main|master|v[0-9]+)\b' .github/workflows
! rg -n -g '!*.test.*' 'DATABASE_URL=postgre[s]|POSTGRES_PASSWOR[D]=|gh[p]_|github_pa[t]_' \
  .github scripts release docs README.md
! rg -n 'ci-server\.yml|ci-web\.yml|release:\s*bumpp|阶段五.*(待实施|尚未实施)' \
  README.md server web docs/全局文档/项目工程组织方案.md
git status --short --untracked-files=all
```

Expected: 只出现本 Task 预期文档/测试变更；设计文档中用于解释历史缺口的 `bumpp` 文本可保留，需人工确认语境，不能用无差别删除规避审计。

- [ ] **Step 6：在 Ubuntu 24.04 执行 Release 生产路径集成验证**

只在 GitHub-hosted `ubuntu-24.04` Runner、尚未创建 GitHub Release 的验证 Job 中执行；普通 Ubuntu/macOS 不伪造 GitHub runner metadata：

```bash
set -euo pipefail
test "${GITHUB_ACTIONS:-}" = true
test "${ImageOS:-}" = ubuntu24
test "${RUNNER_OS:-}" = Linux
test "${RUNNER_ARCH:-}" = X64
release_temp="$(mktemp -d)"
trap 'rm -rf "$release_temp"' EXIT
pnpm -C server install --frozen-lockfile
pnpm -C web install --frozen-lockfile
pnpm -C server build
pnpm -C web build
node --run release:package:web -- --tag v0.0.0 --output "$release_temp/web-package"
node --run release:package:server -- --tag v0.0.0 --output "$release_temp/server-package"
node --run release:smoke:server -- \
  --tag v0.0.0 \
  --archive "$release_temp/server-package/qsmds-server-v0.0.0-linux-x64.tar.gz"
source_commit="$(git rev-parse HEAD)"
node -e "const fs=require('node:fs'); fs.writeFileSync(process.argv[1], JSON.stringify({version:'0.0.0',tag:'v0.0.0',tagObjectSha:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',sourceCommit:process.argv[2]})+'\n')" \
  "$release_temp/release-version.json" "$source_commit"
QIANSHU_RUNNER_IMAGE=ubuntu-24.04 \
  node --run release:manifest -- \
  --release-metadata "$release_temp/release-version.json" \
  --repository SilnoGM/QIANSHU-DMS \
  --workflow release.yml \
  --run-id 1 \
  --run-attempt 1 \
  --web-archive "$release_temp/web-package/qsmds-web-v0.0.0.tar.gz" \
  --server-archive "$release_temp/server-package/qsmds-server-v0.0.0-linux-x64.tar.gz" \
  --output "$release_temp/final-bundle"
node scripts/release-manifest.mjs verify \
  --bundle "$release_temp/final-bundle" \
  --release-metadata "$release_temp/release-version.json" \
  --repository SilnoGM/QIANSHU-DMS \
  --run-id 1 \
  --bundle-run-attempt 1
```

这一步验证归档、Manifest schema、实际 hash 与 `SHA256SUMS` 重读，不创建/推送 `v0.0.0` Tag，不调用 GitHub Release mutation。fixture `tagObjectSha` 只用于本地数据结构测试，文档/交付不得把它描述为真实 Tag。若当前机器不是 Linux x64，只执行 unit fixture 并把真实归档验证留给 Task 14 的 Ubuntu Runner；交付说明必须明确该平台缺口。

> 2026-07-13 本地收口证据：当前平台为 Darwin/arm64，已通过 `node --run test:root`（524 tests）、Server check/build、隔离 PostgreSQL 两次 migration deploy 与 26 个 E2E、Contract、Web generate/check/build、三个参考应用 check/build、固定 checksum 的 `actionlint 1.7.12`、根目录边界与 Docker 残留检查。Task 7 Step 10 与本 Task Step 6 保持未勾选；GitHub-hosted Ubuntu 24.04 的 production archive、runtime smoke 与 Manifest runtime metadata 未伪造，继续由 Task 14 验收。安全文本审计命中的 `POSTGRES_PASSWORD` 赋值是 masked 随机值写入临时 env-file，`release: bumpp` 命中是“不提供该入口”的负面约束，均经上下文复核，不代表硬编码 secret 或残留发布入口。

- [x] **Step 7：更新计划勾选、提交文档收口并确认 clean**

仅在对应命令已有最新成功证据时勾选本计划 Task；不得提前勾选 Task 14。

```bash
git add README.md server/README.md server/AGENTS.md web/README.md web/AGENTS.md \
  docs/全局文档/项目工程组织方案.md \
  docs/全局文档/阶段五CI与发布设计.md \
  docs/全局文档/阶段五CI与发布实施计划.md \
  docs/全局文档/发布与版本管理.md \
  docs/后端文档/后端架构.md docs/前端文档/前端架构.md \
  docs/文档索引.md scripts/root-governance.test.mjs \
  web/scripts/project-guidance.test.mjs
git diff --cached --check
git commit -m "docs: 完成阶段五CI与发布文档"
git status --short
```

Expected: commit 成功，最终 `git status --short` 为空。

### Task 14：经单独授权完成 GitHub 平台验收

**External state:** Git push、Branch Protection、Tag ruleset、Release immutability、正式 annotated Tag、GitHub Release。

本 Task 不是默认本地实施的一部分，必须在用户明确授权 push 和仓库设置后执行。它不以创建“可删除测试 Tag”绕过不可变约束。

- [ ] **Step 1：推送实现分支并验证真实 PR/main CI**

1. 推送当前实现分支，创建/更新 PR。
2. 观察 `root-governance`、`server-check-build`、`server-e2e`、`contract`、`web-check-build` 与 `ci-gate` 的真实结果。
3. 验证 Actions cache、artifact、Docker cleanup 与日志脱敏；失败必须依据真实日志修复并新增回归测试。
4. 确认 `examples.yml` 可手动运行但不进入 `ci-gate`。

在没有成功 run URL 前不得声称 GitHub CI 已通过。

- [ ] **Step 2：由管理员完成一次性保护设置**

- 将稳定的 `ci-gate` 配置为 `main` Required Check。
- 建立 `v*.*.*` Tag ruleset：限制创建者、禁止更新、禁止删除。
- 启用 Release immutability。
- 复核 Actions 默认 token 权限与 Workflow 中 `publish` Job 的最小权限。

这些是 GitHub 外部状态，不通过仓库代码自动修改。

- [ ] **Step 3：另行确认首个正式产品版本准备并先合并 main**

公共 OpenAPI `info.version`、三 package version 与双 snapshot 属于公共契约/数据变更；实际修改前再次获得用户确认。版本准备必须走独立分支和 PR，在合并 `main` 前禁止创建正式 Tag：

```bash
: "${RELEASE_VERSION:?请设置已确认的稳定版本，例如 1.0.0}"
export RELEASE_VERSION
node -e "if(!/^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$/.test(process.env.RELEASE_VERSION)) process.exit(1)"
git fetch origin main --tags
git switch -c "release/v${RELEASE_VERSION}" origin/main
# 按已确认版本修改根、Server、正式 Web app 三个 version。
node --run contract:sync
node --run check
node --run build
git add package.json server/package.json web/apps/qsmds-arco/package.json \
  server/openapi/openapi.json web/openapi/openapi.json
git -c core.quotePath=false diff --cached --name-only
test -z "$(git diff --name-only)"
git diff --cached --check
git commit -m "chore: 准备版本${RELEASE_VERSION}"
release_branch="$(git branch --show-current)"
git push origin "$release_branch"
```

Expected staged paths 恰好是三个 version manifest 和两份字节一致的 OpenAPI snapshot。Web generated types 位于 ignored 目录，只用于验证且不得暂存；任何 lockfile、源码或额外文档变化都先停止审计。

等待版本准备 PR 的 Required CI 全绿并按仓库策略合并。合并完成后，从远端 `main` 的 exact Commit 创建 Tag：

```bash
git switch main
git fetch origin main --tags
git merge --ff-only origin/main
source_commit="$(git rev-parse HEAD)"
test "$source_commit" = "$(git rev-parse refs/remotes/origin/main)"
node -e "const fs=require('node:fs'); const v=process.env.RELEASE_VERSION; for(const p of ['package.json','server/package.json','web/apps/qsmds-arco/package.json']){if(JSON.parse(fs.readFileSync(p)).version!==v)process.exit(1)}"
node --run contract:check
test -z "$(git status --short)"
git tag -a "v${RELEASE_VERSION}" "$source_commit" -m "千树 DMS v${RELEASE_VERSION}"
test "$(git cat-file -t "refs/tags/v${RELEASE_VERSION}")" = tag
test "$(git rev-parse "v${RELEASE_VERSION}^{commit}")" = "$source_commit"
git push origin "v${RELEASE_VERSION}"
```

`RELEASE_VERSION`、版本准备分支 push、PR 合并结果和 Tag push 都必须由用户明确确认。禁止在 feature/release branch 未合并时打正式 Tag。

- [ ] **Step 4：验证真实 Release 与 publish-only 恢复路径**

- 正常路径确认四个 Release assets、远端 digest、Manifest、`SHA256SUMS` 和 immutable published state。
- 如果 publish 在 Draft/部分上传后失败，只重跑失败的 `publish` Job，确认复用同一 artifact ID/digest。
- 不为“测试恢复”故意破坏正式 Release；恢复路径只有在自然失败或单独受控测试仓库中验证。
- 完整重跑遇旧 Draft 时应安全失败；管理员人工核对后才可删除未发布 Draft。

Task 14 默认不产生代码提交；若用户要求保存平台验收记录，另行确认文档路径和证据后独立提交。

## 最终完成判定

阶段五“仓库实现完成”要求 Task 0–13 全部有最新验证证据并提交；“平台验收完成”还要求 Task 14。若只完成前者，交付结论必须精确写成“阶段五代码与本地验证完成，尚未进行 GitHub 平台验收”。

最终审计同时确认：

- 根目录没有 workspace、lockfile、`node_modules` 或第三方依赖。
- Server/Web lockfile 差异严格受控。
- 三份 Workflow 均通过结构测试和固定 `actionlint`。
- 没有未确认的公共 API、数据库 schema/migration 或文件删除。
- 没有 secret、真实 env、连接字符串、构建产物或日志进入 Git。
- 每个功能提交都只包含相应 Task 的绿色能力。
