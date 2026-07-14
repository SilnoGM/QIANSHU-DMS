# 服务器发布打包故障诊断与 CI 复现实施计划

> [!IMPORTANT]
> 本文档是已归档的服务器发布打包故障历史诊断与修复记录，不作为当前执行依据。
> 当前有效规范请参阅[发布与版本管理](../../全局文档/发布与版本管理.md)和[项目工程组织方案](../../全局文档/项目工程组织方案.md)；归档背景与证据见[归档说明](./归档说明.md)。

> **For agentic workers:** REQUIRED SUB-SKILL: Use `subagent-driven-development`（推荐）或 `executing-plans` 按任务执行本计划。所有步骤使用 checkbox 跟踪，生产代码修改必须遵循 RED → GREEN。

**Goal:** 为 Server release packaging 增加不泄密的稳定阶段错误码，并在普通 PR/main CI 的 Ubuntu 24.04 x64 环境中真实复现失败链路。

**Architecture:** packaging 阶段分类仍收敛在 `release-package.mjs`。最终代码审查补充将 `CommandExecutionError` 的可信身份、构造快照和窄退出码 accessor 收敛到共享 `run-command.mjs`，并将 `release-package.mjs`、`openapi-contract.mjs` 与 `release-version.mjs` 的生产信任点统一迁移到该 accessor。现有 `server-check-build` Job 复用 frozen install 和 build，在 `$RUNNER_TEMP` 中运行真实 packaging，但不上传、不发布，也不运行 PostgreSQL smoke。

**Tech Stack:** Node.js 24、`node:test`、pnpm 11、GitHub Actions、GNU tar、现有 Release packaging CLI。

---

## 文件边界

- Modify: `scripts/release-package.mjs` — 定义固定阶段错误、包装 packaging 边界、输出安全诊断。
- Modify: `scripts/release-package.test.mjs` — 覆盖阶段分类、退出码、脱敏和 cleanup 首错。
- Supplemental Modify: `scripts/run-command.mjs`、`scripts/run-command.test.mjs` — 使用模块私有 `WeakMap` 固化可信 identity、message 与 `1..255` 退出码，并覆盖 prototype/getter 伪造。
- Supplemental Modify: `scripts/openapi-contract.mjs`、`scripts/openapi-contract.test.mjs` — 将 reporter 迁移到可信 accessor，并覆盖真实 `Error` 替换 prototype 的回归路径。
- Supplemental Modify: `scripts/release-version.mjs` — 将私有 reporter 迁移到可信 accessor；保持 reporter 私有，并由 accessor 单测、现有 CLI 测试与代码审查共同验证。
- Verify without modification: `scripts/release-version.test.mjs` — 继续验证完整版本检查与 CLI 安全失败行为。
- Modify: `scripts/ci-workflows.test.mjs` — 固定普通 CI 的真实 packaging step 结构与禁止项。
- Modify: `.github/workflows/ci.yml` — 在现有 Server Job 中执行真实 packaging。
- Do not modify: `.github/workflows/release.yml`、`package.json`、产品版本、OpenAPI、数据库 schema 和 migration。

本计划在首次 Draft PR CI 返回后结束诊断阶段。若 CI 失败，必须先依据白名单 code 编写根因专属失败测试和补充计划；若 CI 通过，必须记录“当前无法稳定复现”，不得猜测修改 prune、tar、archive limit 或依赖内容。

### Task 1：建立阶段错误契约的失败测试

**Files:**

- Modify: `scripts/release-package.test.mjs`
- Test: `scripts/release-package.test.mjs`

- [ ] **Step 1：为目标公开测试契约增加 import**

在现有 `release-package.mjs` import 中加入计划中的三个命名导出；当前实现没有这些导出，因此测试必须先失败：

```js
import {
  RELEASE_PACKAGE_FAILURE_CODES,
  ReleasePackageStageError,
  applyReleasePackageFailure,
  inspectTarGzipArchive,
  packageServer,
  packageWeb,
  parseReleasePackageArguments,
  runReleasePackageCli,
  smokeServerArchive,
  validateReleaseTree,
} from './release-package.mjs'
```

- [ ] **Step 2：增加固定 code、cause 和退出码测试**

在 packaging tests 前加入：

```js
test('ReleasePackageStageError 只接受白名单 code 并保留安全退出码', () => {
  const commandCause = new CommandExecutionError('Command failed: pnpm', 7)
  const failure = new ReleasePackageStageError(
    RELEASE_PACKAGE_FAILURE_CODES.serverDeploy,
    commandCause,
  )

  assert.equal(failure.name, 'ReleasePackageStageError')
  assert.equal(failure.code, 'RELEASE_PACKAGE_SERVER_DEPLOY_FAILED')
  assert.equal(failure.cause, commandCause)
  assert.equal(failure.exitCode, 7)
  assert.throws(() => new ReleasePackageStageError('FORGED_CODE', new Error()))
})
```

同时从 `run-command.mjs` import `CommandExecutionError` 与
`getTrustedCommandExitCode`。

- [ ] **Step 3：增加真实 `packageServer()` deploy wiring 失败测试**

使用现有 `createServerTree()` 和 `createDependencies()` 构造合法 fixture，让 `run()` 只在 `pnpm` 阶段抛出固定 canary：

```js
test('packageServer 将 pnpm deploy 首错分类且保留退出码', async (t) => {
  const fixture = await createSandbox(t)
  const output = await fs.mkdtemp(path.join(fixture.outputRoot, 'deploy-failure-'))
  const commandCause = new CommandExecutionError('Command failed: pnpm', 9)
  const harness = createDependencies(fixture, {
    async run(command) {
      assert.equal(command, 'pnpm')
      throw commandCause
    },
  })

  await assert.rejects(
    packageServer({ outputDirectory: output, tag }, harness.dependencies),
    error => (
      error instanceof ReleasePackageStageError
      && error.code === RELEASE_PACKAGE_FAILURE_CODES.serverDeploy
      && error.cause === commandCause
      && error.exitCode === 9
    ),
  )
})
```

- [ ] **Step 4：增加全部 packaging 边界的阶段分类矩阵**

在 `createPackagingRunner()` 后加入只覆盖测试文件系统的 helper：

```js
function fileSystemWith(overrides) {
  return new Proxy(fs, {
    get(target, property) {
      return overrides[property] ?? target[property]
    },
  })
}

async function createServerPackagingFixture(t) {
  const fixture = await createSandbox(t)
  const deploySource = path.join(fixture.sandbox, 'deploy-source')
  await createServerTree(deploySource)
  const output = await fs.mkdtemp(path.join(fixture.outputRoot, 'server-stage-'))
  const calls = []
  const baseRun = createPackagingRunner({ calls, serverDeploySource: deploySource })
  return { baseRun, calls, deploySource, fixture, output }
}
```

使用 fresh fixture 逐项注入下列唯一错误，并统一断言 `ReleasePackageStageError`、code 和 cause 身份：

```js
test('packageServer 对每个 packaging 边界返回固定阶段 code', async (t) => {
  const cases = [
    {
      code: RELEASE_PACKAGE_FAILURE_CODES.outputPrepare,
      label: 'output prepare',
      overrides(context, cause) {
        return {
          fileSystem: fileSystemWith({
            async lstat(target) {
              if (target === context.output) throw cause
              return fs.lstat(target)
            },
          }),
          run: context.baseRun,
        }
      },
    },
    {
      code: RELEASE_PACKAGE_FAILURE_CODES.stageCreate,
      label: 'stage create',
      overrides(context, cause) {
        return {
          fileSystem: fileSystemWith({ async mkdtemp() { throw cause } }),
          run: context.baseRun,
        }
      },
    },
    {
      code: RELEASE_PACKAGE_FAILURE_CODES.serverPrune,
      label: 'server prune',
      overrides(context, cause) {
        return {
          fileSystem: fileSystemWith({
            async rm(target, options) {
              if (target.endsWith('/node_modules/prisma')) throw cause
              return fs.rm(target, options)
            },
          }),
          run: context.baseRun,
        }
      },
    },
    {
      code: RELEASE_PACKAGE_FAILURE_CODES.stageValidate,
      label: 'stage validate',
      overrides(context, cause) {
        return {
          fileSystem: fileSystemWith({
            async realpath(target) {
              if (path.basename(target).startsWith('qsmds-server-')) throw cause
              return fs.realpath(target)
            },
          }),
          run: context.baseRun,
        }
      },
    },
    {
      code: RELEASE_PACKAGE_FAILURE_CODES.archiveCreate,
      label: 'archive create',
      overrides(context, cause) {
        return {
          async run(command, args, options) {
            if (command === 'tar') throw cause
            return context.baseRun(command, args, options)
          },
        }
      },
    },
    {
      code: RELEASE_PACKAGE_FAILURE_CODES.archiveInspect,
      label: 'archive inspect',
      overrides(context, cause) {
        let archiveReads = 0
        return {
          fileSystem: fileSystemWith({
            async readFile(target, options) {
              if (target.endsWith('.tar.gz') && archiveReads++ === 0) throw cause
              return fs.readFile(target, options)
            },
          }),
          run: context.baseRun,
        }
      },
    },
    {
      code: RELEASE_PACKAGE_FAILURE_CODES.archiveDigest,
      label: 'archive digest',
      overrides(context, cause) {
        let archiveReads = 0
        return {
          fileSystem: fileSystemWith({
            async readFile(target, options) {
              if (target.endsWith('.tar.gz') && archiveReads++ === 1) throw cause
              return fs.readFile(target, options)
            },
          }),
          run: context.baseRun,
        }
      },
    },
    {
      code: RELEASE_PACKAGE_FAILURE_CODES.stageCleanup,
      label: 'stage cleanup',
      overrides(context, cause) {
        return {
          fileSystem: fileSystemWith({
            async rm(target, options) {
              if (path.basename(target).startsWith('qianshu-release-stage-')) {
                throw cause
              }
              return fs.rm(target, options)
            },
          }),
          run: context.baseRun,
        }
      },
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.label, async (t) => {
      const context = await createServerPackagingFixture(t)
      const cause = new Error(`stage-canary-${fixtureCase.label}`)
      const harness = createDependencies(
        context.fixture,
        fixtureCase.overrides(context, cause),
      )
      await assert.rejects(
        packageServer(
          { outputDirectory: context.output, tag },
          harness.dependencies,
        ),
        error => (
          error instanceof ReleasePackageStageError
          && error.code === fixtureCase.code
          && error.cause === cause
        ),
      )
    })
  }
})
```

`serverDeploy` 使用 Step 3 的 `CommandExecutionError` 用例单独覆盖，以验证非零退出码。

- [ ] **Step 5：增加 cleanup 首错和 archive 删除测试**

使用同一个 `fileSystemWith()` failpoint：

```js
test('packageServer cleanup 不覆盖主错误且唯一 cleanup 错误删除 archive', async (t) => {
  const primaryContext = await createServerPackagingFixture(t)
  const primaryCause = new Error('archive-create-primary-canary')
  const cleanupCause = new Error('stage-cleanup-secondary-canary')
  const cleanupFileSystem = fileSystemWith({
    async rm(target, options) {
      if (path.basename(target).startsWith('qianshu-release-stage-')) {
        throw cleanupCause
      }
      return fs.rm(target, options)
    },
  })
  const primaryHarness = createDependencies(primaryContext.fixture, {
    fileSystem: cleanupFileSystem,
    async run(command, args, options) {
      if (command === 'tar') throw primaryCause
      return primaryContext.baseRun(command, args, options)
    },
  })
  await assert.rejects(
    packageServer(
      { outputDirectory: primaryContext.output, tag },
      primaryHarness.dependencies,
    ),
    error => (
      error.code === RELEASE_PACKAGE_FAILURE_CODES.archiveCreate
      && error.cause === primaryCause
    ),
  )

  const cleanupContext = await createServerPackagingFixture(t)
  const cleanupHarness = createDependencies(cleanupContext.fixture, {
    fileSystem: cleanupFileSystem,
    run: cleanupContext.baseRun,
  })
  await assert.rejects(
    packageServer(
      { outputDirectory: cleanupContext.output, tag },
      cleanupHarness.dependencies,
    ),
    error => (
      error.code === RELEASE_PACKAGE_FAILURE_CODES.stageCleanup
      && error.cause === cleanupCause
    ),
  )
  await assert.rejects(
    fs.lstat(path.join(
      cleanupContext.output,
      'qsmds-server-v1.2.3-linux-x64.tar.gz',
    )),
    { code: 'ENOENT' },
  )
})
```

- [ ] **Step 6：增加 reporter 脱敏和伪造 code 测试**

```js
test('release package reporter 只输出内部白名单 code', () => {
  const secret = 'postgresql://user:password@host/database?token=secret'
  const stderr = []
  const processRef = { exitCode: 0 }
  const consoleRef = { error: value => stderr.push(value) }
  const failure = new ReleasePackageStageError(
    RELEASE_PACKAGE_FAILURE_CODES.archiveInspect,
    new Error(secret),
  )

  applyReleasePackageFailure(failure, processRef, consoleRef)
  assert.equal(processRef.exitCode, 1)
  assert.deepEqual(stderr, [
    'Release package failed [code=RELEASE_PACKAGE_ARCHIVE_INSPECT_FAILED]',
  ])
  assert.equal(stderr.join('').includes(secret), false)

  stderr.length = 0
  applyReleasePackageFailure(
    { code: 'RELEASE_PACKAGE_SERVER_DEPLOY_FAILED', message: secret },
    processRef,
    consoleRef,
  )
  assert.deepEqual(stderr, [
    'Release package failed [code=RELEASE_PACKAGE_UNKNOWN_FAILED]',
  ])
  assert.equal(stderr.join('').includes(secret), false)
})
```

- [ ] **Step 7：更新真实子进程 CLI 的安全预期**

现有非法参数测试继续使用 secret canary，但预期改为：

```js
assert.equal(
  cliFailure.stderr,
  'Release package failed [code=RELEASE_PACKAGE_UNKNOWN_FAILED]\n',
)
assert.equal(cliFailure.stderr.includes(secret), false)
```

- [ ] **Step 8：运行测试并确认 RED 原因正确**

Run:

```bash
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  node --test scripts/release-package.test.mjs
```

Expected: FAIL，错误必须是缺少 `RELEASE_PACKAGE_FAILURE_CODES`、`ReleasePackageStageError` 或 `applyReleasePackageFailure` 导出；不得是 fixture、语法或环境错误。

- [ ] **Step 9：提交 RED 测试**

```bash
git add scripts/release-package.test.mjs
git diff --cached --check
git commit -m "test: 定义发布打包阶段错误契约"
```

### Task 2：最小实现白名单阶段诊断

**Files:**

- Modify: `scripts/release-package.mjs`
- Test: `scripts/release-package.test.mjs`

- [ ] **Step 1：定义冻结 code、专用错误和 stage wrapper**

在文件常量区加入：

```js
export const RELEASE_PACKAGE_FAILURE_CODES = Object.freeze({
  archiveCreate: 'RELEASE_PACKAGE_ARCHIVE_CREATE_FAILED',
  archiveDigest: 'RELEASE_PACKAGE_ARCHIVE_DIGEST_FAILED',
  archiveInspect: 'RELEASE_PACKAGE_ARCHIVE_INSPECT_FAILED',
  outputPrepare: 'RELEASE_PACKAGE_OUTPUT_PREPARE_FAILED',
  serverDeploy: 'RELEASE_PACKAGE_SERVER_DEPLOY_FAILED',
  serverPrune: 'RELEASE_PACKAGE_SERVER_PRUNE_FAILED',
  stageCleanup: 'RELEASE_PACKAGE_STAGE_CLEANUP_FAILED',
  stageCreate: 'RELEASE_PACKAGE_STAGE_CREATE_FAILED',
  stageValidate: 'RELEASE_PACKAGE_STAGE_VALIDATE_FAILED',
  unknown: 'RELEASE_PACKAGE_UNKNOWN_FAILED',
})

const releasePackageFailureCodeSet = new Set(
  Object.values(RELEASE_PACKAGE_FAILURE_CODES),
)

const releasePackageStageErrorSet = new WeakSet()
const classifiedReleasePackageStageErrorSet = new WeakSet()

function commandExecutionExitCode(error) {
  return getTrustedCommandExitCode(error) ?? 1
}

export class ReleasePackageStageError extends Error {
  constructor(code, cause) {
    if (!releasePackageFailureCodeSet.has(code)) {
      throw new TypeError('Release package failure code is unsupported')
    }
    super('Release package stage failed', { cause })
    this.name = 'ReleasePackageStageError'
    Object.defineProperties(this, {
      code: { enumerable: true, value: code },
      exitCode: {
        enumerable: true,
        value: commandExecutionExitCode(cause),
      },
    })
    releasePackageStageErrorSet.add(this)
  }
}

function createReleasePackageStageError(code, cause) {
  const error = new ReleasePackageStageError(code, cause)
  classifiedReleasePackageStageErrorSet.add(error)
  return error
}

async function withReleasePackageStage(code, operation) {
  try {
    return await operation()
  } catch (cause) {
    if (classifiedReleasePackageStageErrorSet.has(cause)) {
      throw cause
    }
    throw createReleasePackageStageError(code, cause)
  }
}
```

`CommandExecutionError` 的可信身份不能依赖公开 prototype、`Error` internal
brand 或 `.exitCode` 属性。`scripts/run-command.mjs` 使用模块私有 `WeakMap`
保存构造时的 `{ exitCode, message }` 快照，将有效失败码限制为整数
`1..255`，并通过 `getTrustedCommandExitCode()` 只暴露可信退出码；公开
`exitCode` 同时定义为不可写、不可配置。消费者对 `undefined` 统一回退为
`1`。

- [ ] **Step 2：包装 Server packaging 的每个已确认边界**

使用 `withReleasePackageStage()` 包装以下调用，保持原顺序和 argv 不变：

```js
const output = await withReleasePackageStage(
  RELEASE_PACKAGE_FAILURE_CODES.outputPrepare,
  () => prepareOutputDirectory(normalizedInput.outputDirectory, normalizedDependencies),
)

stageParent = await withReleasePackageStage(
  RELEASE_PACKAGE_FAILURE_CODES.stageCreate,
  () => mkdtemp(path.join(outputDirectory, 'qianshu-release-stage-')),
)

await withReleasePackageStage(
  RELEASE_PACKAGE_FAILURE_CODES.serverDeploy,
  () => runStep(
    normalizedDependencies.run,
    'pnpm',
    [
      '-C',
      'server',
      '--filter',
      '@qianshu-dms/server',
      '--prod',
      'deploy',
      stageRoot,
    ],
    { cwd: normalizedDependencies.repositoryRoot },
  ),
)

await withReleasePackageStage(
  RELEASE_PACKAGE_FAILURE_CODES.serverPrune,
  () => pruneServerDevelopmentArtifacts(stageRoot, normalizedDependencies),
)

await withReleasePackageStage(
  RELEASE_PACKAGE_FAILURE_CODES.stageValidate,
  () => validateReleaseTree(stageRoot, policy, normalizedDependencies),
)

await withReleasePackageStage(
  RELEASE_PACKAGE_FAILURE_CODES.archiveCreate,
  () => runStep(
    normalizedDependencies.run,
    'tar',
    tarArguments(archivePath, policy.topLevelName),
    { cwd: stageParent },
  ),
)
```

Web staging copy 若抛出未分类错误，由 outer catch 归一为 `unknown`；本任务不扩大 Web 行为。

- [ ] **Step 3：拆分 archive inspect 与 digest 诊断边界**

保持 `finalizeArchive()` 返回结构不变：

```js
async function finalizeArchive(archivePath, policy, dependencies) {
  await withReleasePackageStage(
    RELEASE_PACKAGE_FAILURE_CODES.archiveInspect,
    () => inspectTarGzipArchive(archivePath, policy, dependencies),
  )
  return withReleasePackageStage(
    RELEASE_PACKAGE_FAILURE_CODES.archiveDigest,
    async () => {
      const readFile = resolveFileSystemMethod(dependencies.fileSystem, 'readFile')
      const lstat = resolveFileSystemMethod(dependencies.fileSystem, 'lstat')
      const stats = await lstat(archivePath)
      const bytes = Buffer.from(await readFile(archivePath))
      return Object.freeze({
        archivePath,
        size: stats.size,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    },
  )
}
```

- [ ] **Step 4：保持 outer catch 与 cleanup 首错语义**

outer catch 只将未分类错误归一为 `unknown`：

```js
} catch (error) {
  primaryError = classifiedReleasePackageStageErrorSet.has(error)
    ? error
    : createReleasePackageStageError(
        RELEASE_PACKAGE_FAILURE_CODES.unknown,
        error,
      )
  throw primaryError
}
```

只有主流程成功而 staging cleanup 失败时才创建 cleanup stage error：

```js
if (primaryError === undefined && cleanupError !== undefined) {
  throw createReleasePackageStageError(
    RELEASE_PACKAGE_FAILURE_CODES.stageCleanup,
    cleanupError,
  )
}
```

- [ ] **Step 5：实现只信任专用错误实例的 reporter**

替换现有私有 reporter，并保留 direct-entry 调用：

```js
export function applyReleasePackageFailure(
  error,
  processRef = process,
  consoleRef = console,
) {
  const failure = releasePackageStageErrorSet.has(error) ? error : undefined
  processRef.exitCode = failure?.exitCode
    ?? (getTrustedCommandExitCode(error) ?? 1)
  const code = failure?.code ?? RELEASE_PACKAGE_FAILURE_CODES.unknown
  consoleRef.error(`Release package failed [code=${code}]`)
}
```

回归测试必须使用真实 `Error` 再替换 prototype，不能只用
`Object.create(CommandExecutionError.prototype)`；后者没有 `Error` internal
brand，无法覆盖本次 reviewer 发现的绕过路径。至少验证正数、`256` 与
throwing getter 都不会被读取或传播：

```js
const forgedError = Object.assign(new Error('secret'), { exitCode: 256 })
Object.setPrototypeOf(forgedError, CommandExecutionError.prototype)

let getterReads = 0
const throwingGetterError = new Error('secret')
Object.defineProperty(throwingGetterError, 'exitCode', {
  get() {
    getterReads += 1
    throw new Error('exitCode getter must not run')
  },
})
Object.setPrototypeOf(throwingGetterError, CommandExecutionError.prototype)

assert.equal(getTrustedCommandExitCode(forgedError), undefined)
assert.equal(getTrustedCommandExitCode(throwingGetterError), undefined)
assert.equal(getterReads, 0)
```

- [ ] **Step 6：运行局部测试并确认 GREEN**

Run:

```bash
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  node --test scripts/release-package.test.mjs scripts/run-command.test.mjs
```

Expected: PASS，`release-package` 与 `run-command` 测试均无失败。

- [ ] **Step 7：再次运行局部测试并提交 GREEN 实现**

```bash
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  node --test scripts/release-package.test.mjs scripts/run-command.test.mjs
git add scripts/release-package.mjs scripts/release-package.test.mjs
git diff --cached --check
git commit -m "fix: 增强发布打包失败诊断"
```

Expected: tests PASS；Commit 只包含两个 release package 文件。

### Task 3：建立普通 CI 必须真实打包的失败测试

**Files:**

- Modify: `scripts/ci-workflows.test.mjs`
- Test: `scripts/ci-workflows.test.mjs`

- [ ] **Step 1：扩展 `server-check-build` 精确 step 断言**

在现有测试中加入：

```js
const packageStep = findNamedStep(job, 'Package Server release archive')
assert.equal(packageStep, [
  '      - name: Package Server release archive',
  "        if: inputs.release_tag == ''",
  '        run: |',
  '          package_tag="v$(node -p \'require("./package.json").version\')"',
  '          output="$RUNNER_TEMP/release-server-ci"',
  '          node --run release:package:server -- \\',
  '            --tag "$package_tag" \\',
  '            --output "$output"',
  '          archive="$output/qsmds-server-${package_tag}-linux-x64.tar.gz"',
  '          test -f "$archive"',
  '          test ! -L "$archive"',
  '          test -s "$archive"',
].join('\n'))
```

顺序断言必须包含 entrypoint → package → tracked diff，并加入禁止项：

```js
assert.equal(job.includes('actions/upload-artifact'), false)
assert.equal(job.includes('release:smoke:server'), false)
assert.equal(job.includes('DATABASE_URL'), false)
```

- [ ] **Step 2：运行 Workflow source test 并确认 RED**

Run:

```bash
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  node --test --test-name-pattern='server-check-build' \
  scripts/ci-workflows.test.mjs
```

Expected: FAIL with `命名 Step 必须恰好出现一次：Package Server release archive`。

- [ ] **Step 3：提交 RED Workflow 测试**

```bash
git add scripts/ci-workflows.test.mjs
git diff --cached --check
git commit -m "test: 要求CI验证服务器发布包"
```

### Task 4：在现有 Server Job 前移真实 packaging

**Files:**

- Modify: `.github/workflows/ci.yml`
- Test: `scripts/ci-workflows.test.mjs`

- [ ] **Step 1：加入精确的真实 packaging step**

在 `Verify Server entrypoint` 后加入：

```yaml
      - name: Package Server release archive
        if: inputs.release_tag == ''
        run: |
          package_tag="v$(node -p 'require("./package.json").version')"
          output="$RUNNER_TEMP/release-server-ci"
          node --run release:package:server -- \
            --tag "$package_tag" \
            --output "$output"
          archive="$output/qsmds-server-${package_tag}-linux-x64.tar.gz"
          test -f "$archive"
          test ! -L "$archive"
          test -s "$archive"
```

不得增加 upload、secret、PostgreSQL、write permission、Job 或 timeout 修改。

- [ ] **Step 2：运行 source test 并确认 GREEN**

```bash
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  node --test scripts/ci-workflows.test.mjs
```

Expected: PASS。

- [ ] **Step 3：运行 actionlint**

使用仓库阶段五文档固定的 `actionlint 1.7.12` archive 和 checksum：

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
curl -fsSL -o "$archive" \
  "https://github.com/rhysd/actionlint/releases/download/v1.7.12/$asset"
node -e "const fs=require('node:fs'),c=require('node:crypto'); const actual=c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'); if(actual!==process.argv[2]) process.exit(1)" \
  "$archive" "$checksum"
tar -xzf "$archive" -C "$tool_root"
"$tool_root/actionlint" .github/workflows/ci.yml
```

Expected: checksum 和 `actionlint` 均通过；临时目录由 trap 删除。

- [ ] **Step 4：提交 GREEN Workflow**

```bash
git add .github/workflows/ci.yml
git diff --cached --check
git commit -m "ci: 前移服务器发布包验证"
```

### Task 5：本地完整验证与 Draft PR

**Files:**

- Verify only；无计划内源码修改。

- [ ] **Step 1：运行局部与完整 Root 验证**

```bash
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  node --test scripts/release-package.test.mjs scripts/ci-workflows.test.mjs
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  node --run test:root
```

Expected: 全部 PASS，零失败。

- [ ] **Step 2：安装 Web 锁定依赖并运行完整 check/build**

```bash
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  pnpm -C web install --frozen-lockfile
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  node --run check
PATH=/Users/liguangda/.nvm/versions/node/v24.16.0/bin:$PATH \
  node --run build
```

Expected: Root、Server、Contract、Web 的完整 check 和双端 build 全部通过；Server 仍为 `14` suites / `118` tests。

- [ ] **Step 3：检查提交与工作树边界**

```bash
git diff --check origin/main...HEAD
git status --short
git log --oneline --decorate origin/main..HEAD
```

Expected: 工作树为空；提交只覆盖设计文档、计划文档、release package 两文件和 CI 两文件。

- [ ] **Step 4：验证 GitHub CLI 身份并推送分支**

```bash
gh auth status
git push -u origin fix/release-server-packaging
```

Expected: `gh` 对 `github.com` 已认证；branch push 成功且未推送任何 Tag。

- [ ] **Step 5：创建 Draft PR**

```bash
gh pr create \
  --draft \
  --base main \
  --head fix/release-server-packaging \
  --title "fix: 修复服务器发布打包失败" \
  --body "为发布打包增加安全阶段诊断，并把真实 Server packaging 前移到普通 Ubuntu 24.04 x64 CI。此 PR 不修改版本、Tag、Release、公共 API 或数据库。"
```

Expected: Draft PR 创建成功。

### Task 6：读取真实 Ubuntu x64 证据并决定下一阶段

**Files:**

- Read-only GitHub Actions inspection；在取得根因前不修改文件。

- [ ] **Step 1：检查 Draft PR Actions**

```bash
pr_url="$(gh pr view --json url --jq .url)"
python "/Users/liguangda/.codex/plugins/cache/openai-curated-remote/github/0.1.8-2841cf9749ae/skills/gh-fix-ci/scripts/inspect_pr_checks.py" \
  --repo . \
  --pr "$pr_url" \
  --json
```

- [ ] **Step 2：按结果执行固定决策**

若 `Package Server release archive` 失败：

1. 保存 Run URL、Job ID、step 时间和唯一白名单 code。
2. 证明失败发生在哪个 stage；不要根据阶段名称直接猜改。
3. 为该 stage 编写根因专属补充计划，先加入可复现失败测试，再实施最小修复。

若该 step 成功：

1. 记录 Ubuntu 24.04 x64 真实 packaging 已通过。
2. 将原 Release 失败标记为当前不可稳定复现。
3. 保留永久 CI 回归门禁与安全诊断，不修改未被证实有错的 packaging 逻辑。

Expected: 本阶段输出可审计证据；任何根因代码修改都必须等待新的、具体 RED 测试。
