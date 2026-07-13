import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createValidContractFixture } from './fixtures/openapi-contract-fixture.mjs'
import {
  serializeOpenApiSnapshot,
} from './openapi-contract.mjs'
import { CommandExecutionError } from './run-command.mjs'
import { contractSync } from './contract-sync.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const entrypoint = path.join(scriptsDirectory, 'contract-sync.mjs')

async function createSandbox(t, prefix = 'qianshu-contract-sync-test-') {
  const canonicalTemporaryRoot = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(
    path.join(canonicalTemporaryRoot, prefix),
  )
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  return directory
}

async function snapshotEntry(entryPath) {
  let stats
  try {
    stats = await fs.lstat(entryPath)
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { type: 'missing' }
    }
    throw error
  }

  if (stats.isSymbolicLink()) {
    return { type: 'symlink', target: await fs.readlink(entryPath) }
  }
  if (stats.isDirectory()) {
    const children = {}
    const names = await fs.readdir(entryPath)
    names.sort((left, right) => left.localeCompare(right))
    for (const name of names) {
      children[name] = await snapshotEntry(path.join(entryPath, name))
    }
    return { type: 'directory', children }
  }
  if (stats.isFile()) {
    return {
      type: 'file',
      contents: (await fs.readFile(entryPath)).toString('base64'),
    }
  }
  return { type: 'other' }
}

async function createFixture(t, { fresh = false, targetSymlink = false } = {}) {
  const sandbox = await createSandbox(t)
  const fixtureRepositoryRoot = path.join(sandbox, 'repository')
  const temporaryRoot = path.join(sandbox, 'temporary')
  const serverSnapshot = path.join(
    fixtureRepositoryRoot,
    'server',
    'openapi',
    'openapi.json',
  )
  const webSnapshot = path.join(
    fixtureRepositoryRoot,
    'web',
    'openapi',
    'openapi.json',
  )
  const webGeneratedDirectory = path.join(
    fixtureRepositoryRoot,
    'web',
    'apps',
    'qsmds-arco',
    'src',
    'api',
    'generated',
  )
  const externalDirectory = path.join(sandbox, 'external-generated')

  await fs.mkdir(path.dirname(serverSnapshot), { recursive: true })
  await fs.mkdir(temporaryRoot)
  await fs.writeFile(serverSnapshot, '{"old":"server"}\n')
  await fs.writeFile(
    path.join(fixtureRepositoryRoot, 'repository-canary.txt'),
    'repository-canary\n',
  )

  if (!fresh) {
    await fs.mkdir(path.dirname(webSnapshot), { recursive: true })
    await fs.writeFile(webSnapshot, '{"old":"web"}\n')

    if (targetSymlink) {
      await fs.mkdir(externalDirectory, { recursive: true })
      await fs.writeFile(
        path.join(externalDirectory, 'external-canary.txt'),
        'external-canary\n',
      )
      await fs.mkdir(path.dirname(webGeneratedDirectory), { recursive: true })
      await fs.symlink(externalDirectory, webGeneratedDirectory, 'dir')
    } else {
      await fs.mkdir(path.join(webGeneratedDirectory, 'nested'), {
        recursive: true,
      })
      for (const fileName of [
        'types.gen.ts',
        'index.ts',
        'sdk.gen.ts',
        'client.gen.ts',
        'stale.txt',
      ]) {
        await fs.writeFile(
          path.join(webGeneratedDirectory, fileName),
          `old-${fileName}\n`,
        )
      }
      await fs.writeFile(
        path.join(webGeneratedDirectory, 'nested', 'canary.txt'),
        'nested-canary\n',
      )
    }
  }

  return {
    externalDirectory,
    fixtureRepositoryRoot,
    sandbox,
    serverSnapshot,
    temporaryRoot,
    webGeneratedDirectory,
    webSnapshot,
  }
}

function expectedSnapshotBytes(document = createValidContractFixture()) {
  return Buffer.from(serializeOpenApiSnapshot(document))
}

function createRunHarness({
  snapshotBytes = expectedSnapshotBytes(),
  webOutput = 'valid',
  externalDirectory,
  failStage,
  returnStage,
} = {}) {
  const calls = []
  const commandError = new CommandExecutionError(
    `${failStage ?? 'command'} failed`,
    7,
  )

  const run = async (command, args, options) => {
    calls.push([command, args, options])
    const stage = args[1]
    if (stage === failStage) {
      throw commandError
    }

    if (stage === 'server') {
      await fs.writeFile(args[4], snapshotBytes)
      return stage === returnStage ? 7 : undefined
    }

    assert.equal(stage, 'web')
    const output = args[6]
    if (webOutput === 'missing-directory') {
      return
    }
    if (webOutput === 'directory-symlink') {
      await fs.symlink(externalDirectory, output, 'dir')
      return
    }

    await fs.mkdir(output)
    if (webOutput === 'missing-file') {
      return
    }
    if (webOutput === 'file-symlink') {
      const externalFile = path.join(externalDirectory, 'external-types.ts')
      await fs.symlink(externalFile, path.join(output, 'types.gen.ts'))
      return
    }

    await fs.writeFile(
      path.join(output, 'types.gen.ts'),
      webOutput === 'empty-file'
        ? ''
        : 'export type HealthGetResponses = { 200: { status: string } }\n',
    )
    if (webOutput === 'extra-entry') {
      await fs.mkdir(path.join(output, 'nested'))
      await fs.writeFile(path.join(output, 'stale.ts'), 'stale\n')
    }
    return stage === returnStage ? 7 : undefined
  }

  return { calls, commandError, run }
}

function assertGenerationCalls(calls, fixtureRepositoryRoot) {
  assert.equal(calls.length, 2)
  const serverTemp = calls[0][1][4]
  const webTypesTempDirectory = calls[1][1][6]

  assert.deepEqual(calls, [
    [
      'pnpm',
      ['-C', 'server', 'openapi:generate', '--output', serverTemp],
      { cwd: fixtureRepositoryRoot },
    ],
    [
      'pnpm',
      [
        '-C',
        'web',
        'api:generate',
        '--input',
        serverTemp,
        '--output',
        webTypesTempDirectory,
      ],
      { cwd: fixtureRepositoryRoot },
    ],
  ])
  assert.equal(path.isAbsolute(serverTemp), true)
  assert.equal(path.isAbsolute(webTypesTempDirectory), true)
  assert.equal(path.normalize(serverTemp), serverTemp)
  assert.equal(path.normalize(webTypesTempDirectory), webTypesTempDirectory)
  assert.equal(path.dirname(serverTemp), path.dirname(webTypesTempDirectory))
}

async function assertTemporaryRootEmpty(temporaryRoot) {
  assert.deepEqual(await fs.readdir(temporaryRoot), [])
}

test('contractSync 先生成并校验临时产物，再原子发布精确三个边界', async (t) => {
  const fixture = await createFixture(t)
  const snapshotBytes = expectedSnapshotBytes()
  const harness = createRunHarness({ snapshotBytes })

  await contractSync({
    repositoryRoot: fixture.fixtureRepositoryRoot,
    temporaryRoot: fixture.temporaryRoot,
    run: harness.run,
  })

  assertGenerationCalls(harness.calls, fixture.fixtureRepositoryRoot)
  assert.deepEqual(await fs.readFile(fixture.serverSnapshot), snapshotBytes)
  assert.deepEqual(await fs.readFile(fixture.webSnapshot), snapshotBytes)
  assert.deepEqual(await fs.readdir(fixture.webGeneratedDirectory), [
    'types.gen.ts',
  ])
  const generatedStats = await fs.lstat(
    path.join(fixture.webGeneratedDirectory, 'types.gen.ts'),
  )
  assert.equal(generatedStats.isSymbolicLink(), false)
  assert.equal(generatedStats.isFile(), true)
  assert.ok(generatedStats.size > 0)
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

test('contractSync 公开产物最终校验失败时在 backup 删除前回滚三个旧目标', async (t) => {
  const fixture = await createFixture(t)
  const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
  const harness = createRunHarness()
  let backupsPresentDuringValidation = false
  const fileSystem = {
    async readFile(entryPath, ...args) {
      if (entryPath === fixture.serverSnapshot) {
        const serverEntries = await fs.readdir(path.dirname(fixture.serverSnapshot))
        const webEntries = await fs.readdir(path.dirname(fixture.webSnapshot))
        const generatedEntries = await fs.readdir(
          path.dirname(fixture.webGeneratedDirectory),
        )
        backupsPresentDuringValidation = [
          serverEntries,
          webEntries,
          generatedEntries,
        ].every(entries => entries.some(name => name.endsWith('.bak')))
        // 模拟发布窗口内的最终读回不一致，确保验证失败
        // 由事务 helper 捕获，而不是在 backup 已删除后才暴露。
        return Buffer.from('{"tampered":true}\n')
      }
      return fs.readFile(entryPath, ...args)
    },
  }

  await assert.rejects(contractSync({
    fileSystem,
    repositoryRoot: fixture.fixtureRepositoryRoot,
    temporaryRoot: fixture.temporaryRoot,
    run: harness.run,
  }), /snapshot bytes differ/iu)

  assert.equal(backupsPresentDuringValidation, true)
  assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

for (const [name, snapshotBytes] of [
  ['invalid JSON', Buffer.from('{invalid-json')],
  ['invalid OpenAPI structure', Buffer.from('{"openapi":"3.0.3","paths":{}}\n')],
]) {
  test(`contractSync 在 ${name} 时不触碰三个公开目标`, async (t) => {
    const fixture = await createFixture(t)
    const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
    const harness = createRunHarness({ snapshotBytes })

    await assert.rejects(contractSync({
      repositoryRoot: fixture.fixtureRepositoryRoot,
      temporaryRoot: fixture.temporaryRoot,
      run: harness.run,
    }))

    assert.equal(harness.calls.length, 1)
    assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

for (const failStage of ['server', 'web']) {
  test(`contractSync 原样传播 ${failStage} 生成器退出码 7`, async (t) => {
    const fixture = await createFixture(t)
    const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
    const harness = createRunHarness({ failStage })

    await assert.rejects(
      contractSync({
        repositoryRoot: fixture.fixtureRepositoryRoot,
        temporaryRoot: fixture.temporaryRoot,
        run: harness.run,
      }),
      error => error === harness.commandError && error.exitCode === 7,
    )

    assert.equal(harness.calls.length, failStage === 'server' ? 1 : 2)
    assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

for (const returnStage of ['server', 'web']) {
  test(`contractSync 不把 ${returnStage} 生成器显式返回的 7 当作成功`, async (t) => {
    const fixture = await createFixture(t)
    const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
    const harness = createRunHarness({ returnStage })

    await assert.rejects(
      contractSync({
        repositoryRoot: fixture.fixtureRepositoryRoot,
        temporaryRoot: fixture.temporaryRoot,
        run: harness.run,
      }),
      error => error instanceof CommandExecutionError && error.exitCode === 7,
    )

    assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

for (const webOutput of [
  'missing-directory',
  'missing-file',
  'empty-file',
  'extra-entry',
]) {
  test(`contractSync 拒绝 Web 临时产物：${webOutput}`, async (t) => {
    const fixture = await createFixture(t)
    const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
    const harness = createRunHarness({ webOutput })

    await assert.rejects(contractSync({
      repositoryRoot: fixture.fixtureRepositoryRoot,
      temporaryRoot: fixture.temporaryRoot,
      run: harness.run,
    }))

    assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

for (const webOutput of ['directory-symlink', 'file-symlink']) {
  test(`contractSync 拒绝 Web source ${webOutput} 且不跟随外部 canary`, async (t) => {
    const fixture = await createFixture(t)
    await fs.mkdir(fixture.externalDirectory, { recursive: true })
    await fs.writeFile(
      path.join(fixture.externalDirectory, 'external-types.ts'),
      'external-types-canary\n',
    )
    await fs.writeFile(
      path.join(fixture.externalDirectory, 'types.gen.ts'),
      'export type External = true\n',
    )
    await fs.writeFile(
      path.join(fixture.externalDirectory, 'canary.txt'),
      'external-canary\n',
    )
    const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
    const beforeExternal = await snapshotEntry(fixture.externalDirectory)
    const harness = createRunHarness({
      externalDirectory: fixture.externalDirectory,
      webOutput,
    })

    await assert.rejects(contractSync({
      repositoryRoot: fixture.fixtureRepositoryRoot,
      temporaryRoot: fixture.temporaryRoot,
      run: harness.run,
    }))

    assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
    assert.deepEqual(
      await snapshotEntry(fixture.externalDirectory),
      beforeExternal,
    )
    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

test('contractSync 在旧 generated target 为 symlink 时保持链接与外部树不变', async (t) => {
  const fixture = await createFixture(t, { targetSymlink: true })
  const beforeRepository = await snapshotEntry(fixture.fixtureRepositoryRoot)
  const beforeExternal = await snapshotEntry(fixture.externalDirectory)
  const harness = createRunHarness()

  await assert.rejects(contractSync({
    repositoryRoot: fixture.fixtureRepositoryRoot,
    temporaryRoot: fixture.temporaryRoot,
    run: harness.run,
  }))

  assert.deepEqual(
    await snapshotEntry(fixture.fixtureRepositoryRoot),
    beforeRepository,
  )
  assert.deepEqual(await snapshotEntry(fixture.externalDirectory), beforeExternal)
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

for (let failpoint = 1; failpoint <= 6; failpoint += 1) {
  test(`contractSync forward rename failpoint ${failpoint} 完整回滚`, async (t) => {
    const fixture = await createFixture(t)
    const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
    const harness = createRunHarness()
    const failure = new Error(`rename failpoint ${failpoint}`)
    let renameCalls = 0
    const fileSystem = {
      async rename(...args) {
        renameCalls += 1
        if (renameCalls === failpoint) {
          throw failure
        }
        return fs.rename(...args)
      },
    }

    await assert.rejects(
      contractSync({
        fileSystem,
        repositoryRoot: fixture.fixtureRepositoryRoot,
        temporaryRoot: fixture.temporaryRoot,
        run: harness.run,
      }),
      error => error === failure,
    )

    assert.ok(renameCalls >= failpoint)
    assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

test('contractSync 支持 fresh Web snapshot 与 generated parents 首次发布', async (t) => {
  const fixture = await createFixture(t, { fresh: true })
  const harness = createRunHarness()

  await contractSync({
    repositoryRoot: fixture.fixtureRepositoryRoot,
    temporaryRoot: fixture.temporaryRoot,
    run: harness.run,
  })

  assert.deepEqual(
    await fs.readFile(fixture.serverSnapshot),
    await fs.readFile(fixture.webSnapshot),
  )
  assert.deepEqual(await fs.readdir(fixture.webGeneratedDirectory), [
    'types.gen.ts',
  ])
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

test('contractSync fresh 发布中途失败时移除本次创建且仍为空的 parents', async (t) => {
  const fixture = await createFixture(t, { fresh: true })
  const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
  const harness = createRunHarness()
  const failure = new Error('fresh web install failed')
  let renameCalls = 0

  await assert.rejects(
    contractSync({
      fileSystem: {
        async rename(...args) {
          renameCalls += 1
          if (renameCalls === 3) {
            throw failure
          }
          return fs.rename(...args)
        },
      },
      repositoryRoot: fixture.fixtureRepositoryRoot,
      temporaryRoot: fixture.temporaryRoot,
      run: harness.run,
    }),
    error => error === failure,
  )

  assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

test('contract-sync import 不自启，直接入口保留生成器退出码 7', async (t) => {
  const sandbox = await createSandbox(t, 'qianshu-contract-sync-entry-')
  const binaryDirectory = path.join(sandbox, 'bin')
  const marker = path.join(sandbox, 'pnpm-called.txt')
  const fakePnpm = path.join(binaryDirectory, 'pnpm')
  await fs.mkdir(binaryDirectory)
  await fs.writeFile(
    fakePnpm,
    `#!/bin/sh\nprintf 'called' > "${marker}"\nexit 7\n`,
  )
  await fs.chmod(fakePnpm, 0o755)
  const env = {
    ...process.env,
    PATH: `${binaryDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
  }

  const imported = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import(${JSON.stringify(pathToFileURL(entrypoint).href)})`,
    ],
    { cwd: repositoryRoot, encoding: 'utf8', env },
  )
  assert.equal(imported.status, 0, imported.stderr)
  assert.equal((await snapshotEntry(marker)).type, 'missing')

  const direct = spawnSync(process.execPath, [entrypoint], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env,
  })
  assert.equal(direct.status, 7)
  assert.equal(await fs.readFile(marker, 'utf8'), 'called')
  assert.equal(direct.stderr.trim(), 'OpenAPI contract check failed')
})
