import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createValidContractFixture } from './fixtures/openapi-contract-fixture.mjs'
import { serializeOpenApiSnapshot } from './openapi-contract.mjs'
import { CommandExecutionError } from './run-command.mjs'
import {
  contractCheck,
  parseContractCheckArguments,
} from './contract-check.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const entrypoint = path.join(scriptsDirectory, 'contract-check.mjs')
const RETIRED_SUPPLIER_OPERATION_IDS = Object.freeze([
  'suppliers_list',
  'suppliers_create',
  'suppliers_get_by_id',
  'suppliers_update',
  'suppliers_enable',
  'suppliers_disable',
])

function addGetOperation(document, pathName, operationId) {
  document.paths[pathName] = structuredClone(document.paths['/api/reports'])
  document.paths[pathName].get.operationId = operationId
}

async function createSandbox(t, prefix = 'qianshu-contract-check-test-') {
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

function snapshotBytes(document = createValidContractFixture()) {
  return Buffer.from(serializeOpenApiSnapshot(document))
}

async function createFixture(t, {
  serverBytes = snapshotBytes(),
  webBytes = serverBytes,
} = {}) {
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

  await fs.mkdir(path.dirname(serverSnapshot), { recursive: true })
  await fs.mkdir(path.dirname(webSnapshot), { recursive: true })
  await fs.mkdir(path.join(webGeneratedDirectory, 'nested'), {
    recursive: true,
  })
  await fs.mkdir(temporaryRoot)
  await fs.writeFile(serverSnapshot, serverBytes)
  await fs.writeFile(webSnapshot, webBytes)
  await fs.writeFile(
    path.join(webGeneratedDirectory, 'types.gen.ts'),
    'tracked-generation-canary\n',
  )
  await fs.writeFile(
    path.join(webGeneratedDirectory, 'nested', 'canary.txt'),
    'nested-generation-canary\n',
  )

  return {
    fixtureRepositoryRoot,
    sandbox,
    serverSnapshot,
    temporaryRoot,
    webGeneratedDirectory,
    webSnapshot,
  }
}

function createRunHarness({
  generatedBytes = snapshotBytes(),
  webOutput = 'valid',
  externalDirectory,
  failStage,
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
      await fs.writeFile(args[4], generatedBytes)
      return
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
      const externalFile = path.join(externalDirectory, 'types-external.ts')
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
      await fs.writeFile(path.join(output, 'index.ts'), 'extra\n')
    }
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
  assert.equal(path.dirname(serverTemp), path.dirname(webTypesTempDirectory))
}

async function assertTemporaryRootEmpty(temporaryRoot) {
  assert.deepEqual(await fs.readdir(temporaryRoot), [])
}

test('parseContractCheckArguments 只接受空参数或单个 baseline', () => {
  const invocationCwd = path.join(path.sep, 'tmp', 'caller')
  const absoluteBaseline = path.join(path.sep, 'fixtures', 'baseline.json')

  assert.deepEqual(parseContractCheckArguments([], invocationCwd), {
    baselinePath: undefined,
  })
  assert.deepEqual(
    parseContractCheckArguments(['--baseline', 'baseline.json'], invocationCwd),
    { baselinePath: path.join(invocationCwd, 'baseline.json') },
  )
  assert.deepEqual(
    parseContractCheckArguments(['--baseline', absoluteBaseline], invocationCwd),
    { baselinePath: absoluteBaseline },
  )

  for (const argv of [
    ['--baseline'],
    ['--baseline', ''],
    ['--baseline', 'one.json', '--baseline', 'two.json'],
    ['--unknown'],
    ['baseline.json'],
    ['--unknown', 'value'],
  ]) {
    assert.throws(() => parseContractCheckArguments(argv, invocationCwd))
  }
})

test('contractCheck 只生成临时产物并保持 tracked generated tree 不变', async (t) => {
  const fixture = await createFixture(t)
  const beforeRepository = await snapshotEntry(fixture.fixtureRepositoryRoot)
  const harness = createRunHarness()

  await contractCheck({
    argv: [],
    invocationCwd: fixture.fixtureRepositoryRoot,
    repositoryRoot: fixture.fixtureRepositoryRoot,
    temporaryRoot: fixture.temporaryRoot,
    run: harness.run,
  })

  assertGenerationCalls(harness.calls, fixture.fixtureRepositoryRoot)
  assert.deepEqual(
    await snapshotEntry(fixture.fixtureRepositoryRoot),
    beforeRepository,
  )
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

test('contractCheck 拒绝 stale Server snapshot，且不修改任何 tracked artifact', async (t) => {
  const staleDocument = createValidContractFixture()
  staleDocument.info.title = 'stale server snapshot'
  const fixture = await createFixture(t, {
    serverBytes: snapshotBytes(staleDocument),
  })
  const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
  const harness = createRunHarness()

  await assert.rejects(contractCheck({
    argv: [],
    repositoryRoot: fixture.fixtureRepositoryRoot,
    temporaryRoot: fixture.temporaryRoot,
    run: harness.run,
  }))

  assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

test('contractCheck 对相同 JSON 的不同 whitespace 仍按 raw bytes 拒绝', async (t) => {
  const document = createValidContractFixture()
  const serverBytes = snapshotBytes(document)
  const webBytes = Buffer.from(JSON.stringify(document))
  const fixture = await createFixture(t, { serverBytes, webBytes })
  const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
  const harness = createRunHarness({ generatedBytes: serverBytes })

  await assert.rejects(contractCheck({
    argv: [],
    repositoryRoot: fixture.fixtureRepositoryRoot,
    temporaryRoot: fixture.temporaryRoot,
    run: harness.run,
  }))

  assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

test('contractCheck 在 generated 等于 Server 但 Web 是另一份合法 JSON 时拒绝', async (t) => {
  const serverBytes = snapshotBytes()
  const differentWebDocument = createValidContractFixture()
  differentWebDocument.info.title = 'different but valid Web snapshot'
  const fixture = await createFixture(t, {
    serverBytes,
    webBytes: snapshotBytes(differentWebDocument),
  })
  const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
  const harness = createRunHarness({ generatedBytes: serverBytes })

  await assert.rejects(contractCheck({
    argv: [],
    repositoryRoot: fixture.fixtureRepositoryRoot,
    temporaryRoot: fixture.temporaryRoot,
    run: harness.run,
  }))

  assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

for (const mutation of ['delete', 'rename']) {
  test(`contractCheck baseline 拒绝 operationId ${mutation}`, async (t) => {
    const baseline = createValidContractFixture()
    const current = createValidContractFixture()
    if (mutation === 'delete') {
      delete current.paths['/api/reports']
    } else {
      current.paths['/api/reports'].get.operationId = 'report_fetch'
    }
    const currentBytes = snapshotBytes(current)
    const fixture = await createFixture(t, {
      serverBytes: currentBytes,
      webBytes: currentBytes,
    })
    const baselinePath = path.join(fixture.sandbox, 'baseline.json')
    await fs.writeFile(baselinePath, snapshotBytes(baseline))
    const harness = createRunHarness({ generatedBytes: currentBytes })

    await assert.rejects(
      contractCheck({
        argv: ['--baseline', path.relative(fixture.sandbox, baselinePath)],
        invocationCwd: fixture.sandbox,
        repositoryRoot: fixture.fixtureRepositoryRoot,
        temporaryRoot: fixture.temporaryRoot,
        run: harness.run,
      }),
      /report_download/u,
    )

    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

test('contractCheck baseline 允许精确六个供应商 operationId 退役', async (t) => {
  const baseline = createValidContractFixture()
  RETIRED_SUPPLIER_OPERATION_IDS.forEach((operationId, index) => {
    addGetOperation(
      baseline,
      `/api/retired-supplier-operation-${index}`,
      operationId,
    )
  })
  const currentBytes = snapshotBytes()
  const fixture = await createFixture(t, {
    serverBytes: currentBytes,
    webBytes: currentBytes,
  })
  const baselinePath = path.join(fixture.sandbox, 'baseline.json')
  await fs.writeFile(baselinePath, snapshotBytes(baseline))
  const harness = createRunHarness({ generatedBytes: currentBytes })

  await contractCheck({
    argv: ['--baseline', path.relative(fixture.sandbox, baselinePath)],
    invocationCwd: fixture.sandbox,
    repositoryRoot: fixture.fixtureRepositoryRoot,
    temporaryRoot: fixture.temporaryRoot,
    run: harness.run,
  })

  assertGenerationCalls(harness.calls, fixture.fixtureRepositoryRoot)
  await assertTemporaryRootEmpty(fixture.temporaryRoot)
})

for (const baselineMode of ['without-baseline', 'with-baseline']) {
  test(`contractCheck ${baselineMode} 拒绝当前契约重现退役 operationId`, async (t) => {
    const current = createValidContractFixture()
    current.paths['/api/reports'].get.operationId = 'suppliers_list'
    const currentBytes = snapshotBytes(current)
    const fixture = await createFixture(t, {
      serverBytes: currentBytes,
      webBytes: currentBytes,
    })
    const harness = createRunHarness({ generatedBytes: currentBytes })
    const argv = []
    if (baselineMode === 'with-baseline') {
      const baselinePath = path.join(fixture.sandbox, 'baseline.json')
      await fs.writeFile(baselinePath, currentBytes)
      argv.push('--baseline', path.relative(fixture.sandbox, baselinePath))
    }

    await assert.rejects(
      contractCheck({
        argv,
        invocationCwd: fixture.sandbox,
        repositoryRoot: fixture.fixtureRepositoryRoot,
        temporaryRoot: fixture.temporaryRoot,
        run: harness.run,
      }),
      /Retired operationId.*suppliers_list/u,
    )

    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

for (const failStage of ['server', 'web']) {
  test(`contractCheck 原样传播 ${failStage} 生成器退出码 7`, async (t) => {
    const fixture = await createFixture(t)
    const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
    const harness = createRunHarness({ failStage })

    await assert.rejects(
      contractCheck({
        argv: [],
        repositoryRoot: fixture.fixtureRepositoryRoot,
        temporaryRoot: fixture.temporaryRoot,
        run: harness.run,
      }),
      error => error === harness.commandError && error.exitCode === 7,
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
  test(`contractCheck 拒绝临时 Web 产物：${webOutput}`, async (t) => {
    const fixture = await createFixture(t)
    const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
    const harness = createRunHarness({ webOutput })

    await assert.rejects(contractCheck({
      argv: [],
      repositoryRoot: fixture.fixtureRepositoryRoot,
      temporaryRoot: fixture.temporaryRoot,
      run: harness.run,
    }))

    assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

for (const webOutput of ['directory-symlink', 'file-symlink']) {
  test(`contractCheck 拒绝临时 Web source ${webOutput} 且保持外部 tree`, async (t) => {
    const fixture = await createFixture(t)
    const externalDirectory = path.join(fixture.sandbox, 'external')
    await fs.mkdir(externalDirectory)
    await fs.writeFile(
      path.join(externalDirectory, 'types.gen.ts'),
      'external-types\n',
    )
    await fs.writeFile(
      path.join(externalDirectory, 'types-external.ts'),
      'external-file-canary\n',
    )
    await fs.writeFile(
      path.join(externalDirectory, 'canary.txt'),
      'external-canary\n',
    )
    const before = await snapshotEntry(fixture.fixtureRepositoryRoot)
    const beforeExternal = await snapshotEntry(externalDirectory)
    const harness = createRunHarness({ externalDirectory, webOutput })

    await assert.rejects(contractCheck({
      argv: [],
      repositoryRoot: fixture.fixtureRepositoryRoot,
      temporaryRoot: fixture.temporaryRoot,
      run: harness.run,
    }))

    assert.deepEqual(await snapshotEntry(fixture.fixtureRepositoryRoot), before)
    assert.deepEqual(await snapshotEntry(externalDirectory), beforeExternal)
    await assertTemporaryRootEmpty(fixture.temporaryRoot)
  })
}

test('contract-check import 不自启，直接入口保留生成器退出码 7', async (t) => {
  const sandbox = await createSandbox(t, 'qianshu-contract-check-entry-')
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
