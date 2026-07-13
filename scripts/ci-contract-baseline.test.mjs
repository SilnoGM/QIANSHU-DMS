import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  compareVersions,
  parseContractEventInput,
  parseStableVersion,
  runContractCheckForEvent,
  selectContractBaseline,
} from './ci-contract-baseline.mjs'
import { CommandExecutionError } from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const entrypoint = path.join(scriptsDirectory, 'ci-contract-baseline.mjs')
const snapshotPath = path.join('server', 'openapi', 'openapi.json')
const zeroSha = '0'.repeat(40)

function gitResult(repositoryRoot, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    encoding: null,
    input: options.input,
  })

  if (result.error) {
    throw result.error
  }
  return {
    exitCode: result.status,
    stderr: result.stderr ?? Buffer.alloc(0),
    stdout: result.stdout ?? Buffer.alloc(0),
  }
}

function mustGit(repositoryRoot, args, options) {
  const result = gitResult(repositoryRoot, args, options)
  assert.equal(
    result.exitCode,
    0,
    `Git fixture command failed: git ${args.join(' ')}\n${result.stderr}`,
  )
  return result.stdout.toString('utf8').trim()
}

async function createGitFixture(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir())
  const sandbox = await fs.mkdtemp(
    path.join(temporaryRoot, 'qianshu-contract-baseline-test-'),
  )
  const repositoryRoot = path.join(sandbox, 'repository')
  const runnerTemp = path.join(sandbox, 'runner-temp')
  await fs.mkdir(repositoryRoot)
  await fs.mkdir(runnerTemp)
  mustGit(repositoryRoot, ['init', '--initial-branch=main'])
  mustGit(repositoryRoot, ['config', 'user.name', 'Qianshu CI Fixture'])
  mustGit(repositoryRoot, ['config', 'user.email', 'ci-fixture@example.invalid'])
  t.after(() => fs.rm(sandbox, { force: true, recursive: true }))

  return { repositoryRoot, runnerTemp, sandbox }
}

async function replaceSnapshot(repositoryRoot, contents) {
  const target = path.join(repositoryRoot, snapshotPath)
  await fs.rm(target, { force: true, recursive: true })
  if (contents !== undefined) {
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, contents)
  }
}

async function commitSnapshot(repositoryRoot, contents, message) {
  await replaceSnapshot(repositoryRoot, contents)
  mustGit(repositoryRoot, ['add', '--all'])
  mustGit(repositoryRoot, ['commit', '--allow-empty', '-m', message])
  return mustGit(repositoryRoot, ['rev-parse', 'HEAD'])
}

function contractSnapshot(operationId, extra = '') {
  return `${JSON.stringify({
    openapi: '3.1.0',
    paths: {
      '/api/fixture': {
        get: { operationId },
      },
    },
    'x-fixture': extra,
  }, null, 2)}\n`
}

function createDependencies(fixture, overrides = {}) {
  const calls = []
  const git = async args => {
    calls.push([...args])
    return gitResult(fixture.repositoryRoot, args)
  }
  return {
    calls,
    dependencies: {
      env: {
        DATABASE_URL: 'postgresql://fixture-secret',
        DEBUG: 'unsafe-debug',
        PATH: process.env.PATH,
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes',
        QIANSHU_SAFE_VALUE: 'preserved',
      },
      fileSystem: fs,
      git,
      repositoryRoot: fixture.repositoryRoot,
      run: async () => undefined,
      ...overrides,
    },
  }
}

function pullRequestInput(fixture, baseSha, currentSha) {
  return {
    eventName: 'pull_request',
    baseSha,
    currentSha,
    runnerTemp: fixture.runnerTemp,
  }
}

function pushInput(fixture, beforeSha, currentSha) {
  return {
    eventName: 'push',
    beforeSha,
    currentSha,
    ref: 'refs/heads/main',
    runnerTemp: fixture.runnerTemp,
  }
}

function releaseInput(fixture, currentSha, releaseTag) {
  return {
    eventName: 'workflow_call',
    currentSha,
    releaseTag,
    runnerTemp: fixture.runnerTemp,
  }
}

test('稳定 SemVer helper 只接受规范版本并按数字比较', () => {
  assert.deepEqual(parseStableVersion('0.0.0'), [0, 0, 0])
  assert.deepEqual(parseStableVersion('12.3.45'), [12, 3, 45])
  assert.equal(Object.isFrozen(parseStableVersion('1.2.3')), true)
  assert.equal(compareVersions([1, 10, 0], [1, 2, 99]), 8)
  assert.equal(compareVersions([2, 0, 0], [2, 0, 0]), 0)
  assert.equal(compareVersions([0, 9, 9], [1, 0, 0]), -1)

  for (const value of [
    '',
    'v1.2.3',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2',
    '1.2.3-alpha.1',
    '1.2.3+build.1',
    '9007199254740992.0.0',
  ]) {
    assert.throws(() => parseStableVersion(value))
  }
})

test('PR 使用完整 base SHA 提取唯一历史 blob 且不回显正文', async (t) => {
  const fixture = await createGitFixture(t)
  const secret = 'fixture-secret-must-not-leak'
  const expectedSnapshot = contractSnapshot('fixture_list', secret)
  const baseSha = await commitSnapshot(
    fixture.repositoryRoot,
    expectedSnapshot,
    'base snapshot',
  )
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_search'),
    'current snapshot',
  )
  const { calls, dependencies } = createDependencies(fixture)

  const result = await selectContractBaseline(
    pullRequestInput(fixture, baseSha, currentSha),
    dependencies,
  )

  assert.equal(Object.isFrozen(result), true)
  assert.deepEqual(result, {
    kind: 'file',
    path: path.join(path.dirname(result.path), 'openapi-baseline.json'),
    source: baseSha,
  })
  const baselineRelativePath = path.relative(fixture.runnerTemp, result.path)
  assert.equal(baselineRelativePath.startsWith(`..${path.sep}`), false)
  assert.equal(path.isAbsolute(baselineRelativePath), false)
  assert.equal(await fs.readFile(result.path, 'utf8'), expectedSnapshot)
  assert.match(calls[1][2], /^[0-9a-f]{40}$/u)
  assert.deepEqual(calls, [
    ['ls-tree', '-z', baseSha, '--', 'server/openapi/openapi.json'],
    ['cat-file', 'blob', calls[0] === undefined ? '' : calls[1][2]],
  ])
  assert.equal(JSON.stringify(result).includes(secret), false)
})

test('main push 使用 before，首次引入 snapshot 与全零 SHA 返回 none', async (t) => {
  const fixture = await createGitFixture(t)
  const beforeSha = await commitSnapshot(
    fixture.repositoryRoot,
    undefined,
    'before snapshot introduction',
  )
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_create'),
    'introduce snapshot',
  )

  const firstHarness = createDependencies(fixture)
  const firstResult = await selectContractBaseline(
    pushInput(fixture, beforeSha, currentSha),
    firstHarness.dependencies,
  )
  assert.deepEqual(firstResult, { kind: 'none' })
  assert.equal(Object.isFrozen(firstResult), true)
  assert.deepEqual(firstHarness.calls, [
    ['ls-tree', '-z', beforeSha, '--', 'server/openapi/openapi.json'],
  ])

  const zeroHarness = createDependencies(fixture)
  const zeroResult = await selectContractBaseline(
    pushInput(fixture, zeroSha, currentSha),
    zeroHarness.dependencies,
  )
  assert.deepEqual(zeroResult, { kind: 'none' })
  assert.deepEqual(zeroHarness.calls, [])
})

test('Release 选择当前 Commit 可达且低于当前版本的最高稳定 Tag', async (t) => {
  const fixture = await createGitFixture(t)
  const snapshot100 = contractSnapshot('fixture_v100')
  const commit100 = await commitSnapshot(
    fixture.repositoryRoot,
    snapshot100,
    'release 1.0.0',
  )
  mustGit(fixture.repositoryRoot, ['tag', 'v1.0.0', commit100])
  const snapshot120 = contractSnapshot('fixture_v120')
  const commit120 = await commitSnapshot(
    fixture.repositoryRoot,
    snapshot120,
    'release 1.2.0',
  )
  mustGit(fixture.repositoryRoot, ['tag', 'v1.2.0', commit120])
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_v200'),
    'release 2.0.0',
  )
  mustGit(fixture.repositoryRoot, ['tag', 'v2.0.0', currentSha])

  // 不可达的更高旧版本不能参与 baseline 选择。
  mustGit(fixture.repositoryRoot, ['switch', '--orphan', 'unreachable'])
  await replaceSnapshot(fixture.repositoryRoot, contractSnapshot('unreachable'))
  mustGit(fixture.repositoryRoot, ['add', '--all'])
  mustGit(fixture.repositoryRoot, ['commit', '-m', 'unreachable release'])
  mustGit(fixture.repositoryRoot, ['tag', 'v1.9.0'])
  mustGit(fixture.repositoryRoot, ['switch', 'main'])

  const { dependencies } = createDependencies(fixture)
  const result = await selectContractBaseline(
    releaseInput(fixture, currentSha, 'v2.0.0'),
    dependencies,
  )

  assert.equal(result.source, commit120)
  assert.equal(await fs.readFile(result.path, 'utf8'), snapshot120)
})

test('首次 Release 无历史稳定版本时返回 none', async (t) => {
  const fixture = await createGitFixture(t)
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_v100'),
    'first release',
  )
  mustGit(fixture.repositoryRoot, ['tag', 'v1.0.0', currentSha])
  const { dependencies } = createDependencies(fixture)

  assert.deepEqual(
    await selectContractBaseline(
      releaseInput(fixture, currentSha, 'v1.0.0'),
      dependencies,
    ),
    { kind: 'none' },
  )
})

test('事件 input 精确拒绝未知 key、短 SHA、非 main push 与非法 release tag', async (t) => {
  const fixture = await createGitFixture(t)
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_current'),
    'current',
  )
  mustGit(fixture.repositoryRoot, ['tag', 'v1.0.0', currentSha])
  const { dependencies } = createDependencies(fixture)

  const invalidInputs = [
    { ...pullRequestInput(fixture, currentSha.slice(0, 12), currentSha) },
    { ...pullRequestInput(fixture, currentSha, currentSha), github: { token: 'secret' } },
    { ...pushInput(fixture, currentSha, currentSha), ref: 'refs/heads/feature' },
    releaseInput(fixture, currentSha.slice(0, 12), 'v1.0.0'),
    releaseInput(fixture, currentSha, '1.0.0'),
    releaseInput(fixture, currentSha, 'v1.0.0-alpha.1'),
    releaseInput(fixture, currentSha, 'v1.0.0+build.1'),
  ]

  for (const input of invalidInputs) {
    await assert.rejects(selectContractBaseline(input, dependencies))
  }
})

test('Release tag 必须解析到当前 SHA，拒绝不可达或不存在的 tag', async (t) => {
  const fixture = await createGitFixture(t)
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_current'),
    'current',
  )
  const otherSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_other'),
    'other',
  )
  mustGit(fixture.repositoryRoot, ['tag', 'v2.0.0', otherSha])
  const { dependencies } = createDependencies(fixture)

  await assert.rejects(
    selectContractBaseline(
      releaseInput(fixture, currentSha, 'v2.0.0'),
      dependencies,
    ),
  )
  await assert.rejects(
    selectContractBaseline(
      releaseInput(fixture, currentSha, 'v3.0.0'),
      dependencies,
    ),
  )
})

test('历史路径只接受 mode 100644 的普通 blob', async (t) => {
  for (const fixtureKind of ['executable', 'symlink', 'tree']) {
    await t.test(fixtureKind, async (nestedT) => {
      const fixture = await createGitFixture(nestedT)
      const target = path.join(fixture.repositoryRoot, snapshotPath)
      await fs.mkdir(path.dirname(target), { recursive: true })

      if (fixtureKind === 'tree') {
        await fs.mkdir(target)
        await fs.writeFile(path.join(target, 'nested.json'), '{}\n')
      } else if (fixtureKind === 'symlink') {
        await fs.symlink('outside-secret.json', target)
      } else {
        await fs.writeFile(target, '{}\n', { mode: 0o755 })
        await fs.chmod(target, 0o755)
      }

      mustGit(fixture.repositoryRoot, ['add', '--all'])
      mustGit(fixture.repositoryRoot, ['commit', '-m', fixtureKind])
      const baseSha = mustGit(fixture.repositoryRoot, ['rev-parse', 'HEAD'])
      const currentSha = await commitSnapshot(
        fixture.repositoryRoot,
        contractSnapshot('fixture_current'),
        'current',
      )
      const { dependencies } = createDependencies(fixture)

      await assert.rejects(
        selectContractBaseline(
          pullRequestInput(fixture, baseSha, currentSha),
          dependencies,
        ),
      )
    })
  }
})

test('历史 Git 错误绝不降级为 none 且错误信息不泄露 snapshot', async (t) => {
  const fixture = await createGitFixture(t)
  const secret = 'git-error-fixture-secret'
  const baseSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_base', secret),
    'base',
  )
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_current'),
    'current',
  )

  for (const failedCommand of ['ls-tree', 'cat-file']) {
    const git = async args => {
      const result = gitResult(fixture.repositoryRoot, args)
      if (args[0] === failedCommand) {
        return {
          exitCode: 9,
          stderr: Buffer.from(`unsafe ${secret}`),
          stdout: result.stdout,
        }
      }
      return result
    }
    const { dependencies } = createDependencies(fixture, { git })

    await assert.rejects(
      selectContractBaseline(
        pullRequestInput(fixture, baseSha, currentSha),
        dependencies,
      ),
      (error) => {
        assert.equal(error.message.includes(secret), false)
        return true
      },
    )
  }
})

test('临时目录必须保持在 canonical RUNNER_TEMP 子树内', async (t) => {
  const fixture = await createGitFixture(t)
  const outsideDirectory = path.join(fixture.sandbox, 'outside')
  await fs.mkdir(outsideDirectory)
  const baseSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_base'),
    'base',
  )
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_current'),
    'current',
  )
  const escapingFileSystem = {
    ...fs,
    async mkdtemp() {
      return outsideDirectory
    },
  }
  const { dependencies } = createDependencies(fixture, {
    fileSystem: escapingFileSystem,
  })

  await assert.rejects(
    selectContractBaseline(
      pullRequestInput(fixture, baseSha, currentSha),
      dependencies,
    ),
  )
  assert.deepEqual(await fs.readdir(outsideDirectory), [])
})

test('contract 委托按 baseline 状态构造 argv、清理临时文件并净化 child env', async (t) => {
  const fixture = await createGitFixture(t)
  const baseSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_base'),
    'base',
  )
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_current'),
    'current',
  )
  const calls = []
  const { dependencies } = createDependencies(fixture, {
    async run(command, args, options) {
      calls.push({ args, command, options })
      assert.equal(await fs.readFile(args[2], 'utf8'), contractSnapshot('fixture_base'))
    },
  })

  assert.equal(
    await runContractCheckForEvent(
      pullRequestInput(fixture, baseSha, currentSha),
      dependencies,
    ),
    0,
  )
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, process.execPath)
  assert.deepEqual(calls[0].args.slice(0, 2), [
    'scripts/contract-check.mjs',
    '--baseline',
  ])
  assert.equal(path.basename(calls[0].args[2]), 'openapi-baseline.json')
  assert.equal(calls[0].options.cwd, fixture.repositoryRoot)
  assert.equal(calls[0].options.env.DOTENV_CONFIG_PATH, '/dev/null')
  assert.equal(calls[0].options.env.QIANSHU_SAFE_VALUE, 'preserved')
  assert.equal(Object.hasOwn(calls[0].options.env, 'DATABASE_URL'), false)
  assert.equal(Object.hasOwn(calls[0].options.env, 'DEBUG'), false)
  assert.equal(
    Object.hasOwn(
      calls[0].options.env,
      'PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION',
    ),
    false,
  )
  assert.deepEqual(await fs.readdir(fixture.runnerTemp), [])
})

test('无 baseline 不传参数，child 非零退出码和首个错误原样传播', async (t) => {
  const fixture = await createGitFixture(t)
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_current'),
    'current',
  )
  const noBaselineCalls = []
  const noBaselineHarness = createDependencies(fixture, {
    async run(command, args, options) {
      noBaselineCalls.push({ args, command, options })
    },
  })
  assert.equal(
    await runContractCheckForEvent(
      pushInput(fixture, zeroSha, currentSha),
      noBaselineHarness.dependencies,
    ),
    0,
  )
  assert.deepEqual(noBaselineCalls[0].args, ['scripts/contract-check.mjs'])

  const failure = new CommandExecutionError('Command failed: node', 7)
  const failureHarness = createDependencies(fixture, {
    async run() {
      throw failure
    },
  })
  await assert.rejects(
    runContractCheckForEvent(
      pushInput(fixture, zeroSha, currentSha),
      failureHarness.dependencies,
    ),
    error => error === failure && error.exitCode === 7,
  )

  const numericFailureHarness = createDependencies(fixture, {
    async run() {
      return 9
    },
  })
  await assert.rejects(
    runContractCheckForEvent(
      pushInput(fixture, zeroSha, currentSha),
      numericFailureHarness.dependencies,
    ),
    error => error instanceof CommandExecutionError && error.exitCode === 9,
  )

  const baseSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_base'),
    'baseline cleanup',
  )
  const nextSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_next'),
    'next',
  )
  const baselineFailureHarness = createDependencies(fixture, {
    async run() {
      throw failure
    },
  })
  await assert.rejects(
    runContractCheckForEvent(
      pullRequestInput(fixture, baseSha, nextSha),
      baselineFailureHarness.dependencies,
    ),
    error => error === failure,
  )
  assert.deepEqual(await fs.readdir(fixture.runnerTemp), [])
})

test('生产事件解析只提取受控字段并限制 release tag 场景', async (t) => {
  const fixture = await createGitFixture(t)
  const currentSha = await commitSnapshot(
    fixture.repositoryRoot,
    contractSnapshot('fixture_current'),
    'current',
  )
  const eventPath = path.join(fixture.sandbox, 'event.json')
  await fs.writeFile(eventPath, JSON.stringify({
    action: 'synchronize',
    pull_request: { base: { sha: currentSha }, title: 'must not propagate' },
    secretContext: 'must not propagate',
  }))

  assert.deepEqual(
    await parseContractEventInput({
      env: {
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: currentSha,
        QIANSHU_RELEASE_TAG: '',
        RUNNER_TEMP: fixture.runnerTemp,
      },
      fileSystem: fs,
    }),
    pullRequestInput(fixture, currentSha, currentSha),
  )

  await fs.writeFile(eventPath, JSON.stringify({
    before: currentSha,
    ref: 'refs/heads/main',
    repository: { private: true },
  }))
  assert.deepEqual(
    await parseContractEventInput({
      env: {
        GITHUB_EVENT_NAME: 'push',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: currentSha,
        RUNNER_TEMP: fixture.runnerTemp,
      },
      fileSystem: fs,
    }),
    pushInput(fixture, currentSha, currentSha),
  )

  await fs.writeFile(eventPath, '{}\n')
  assert.deepEqual(
    await parseContractEventInput({
      env: {
        GITHUB_EVENT_NAME: 'workflow_call',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_SHA: currentSha,
        QIANSHU_RELEASE_TAG: 'v1.2.3',
        RUNNER_TEMP: fixture.runnerTemp,
      },
      fileSystem: fs,
    }),
    releaseInput(fixture, currentSha, 'v1.2.3'),
  )

  await assert.rejects(parseContractEventInput({
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: currentSha,
      QIANSHU_RELEASE_TAG: 'v1.0.0',
      RUNNER_TEMP: fixture.runnerTemp,
    },
    fileSystem: fs,
  }))
})

test('CLI 非法事件固定失败且不泄露 event 正文', async (t) => {
  const fixture = await createGitFixture(t)
  const secret = 'event-fixture-secret'
  const eventPath = path.join(fixture.sandbox, 'invalid-event.json')
  await fs.writeFile(eventPath, `{ invalid json ${secret}`)
  const result = spawnSync(process.execPath, [entrypoint], {
    encoding: 'utf8',
    env: {
      GITHUB_EVENT_NAME: 'pull_request',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_SHA: 'a'.repeat(40),
      PATH: process.env.PATH,
      QIANSHU_RELEASE_TAG: '',
      RUNNER_TEMP: fixture.runnerTemp,
    },
  })

  assert.equal(result.status, 1)
  assert.equal(result.stdout, '')
  assert.equal(result.stderr, 'OpenAPI contract check failed\n')
  assert.equal(result.stderr.includes(secret), false)
})
