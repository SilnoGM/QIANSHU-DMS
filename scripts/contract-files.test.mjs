import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  assertDirectoryContainsOnlyNonEmptyFile,
  replaceArtifactsWithRollback,
  resolveContractPaths,
  withTemporaryDirectory,
} from './contract-files.mjs'

const FILE_SYSTEM_METHODS = [
  'cp',
  'lstat',
  'mkdir',
  'mkdtemp',
  'readdir',
  'rename',
  'rm',
  'rmdir',
  'writeFile',
]

const MUTATION_METHODS = new Set([
  'cp',
  'mkdir',
  'mkdtemp',
  'rename',
  'rm',
  'rmdir',
  'writeFile',
])

function createInjectedFileSystem(overrides = {}) {
  return Object.fromEntries(FILE_SYSTEM_METHODS.map((method) => [
    method,
    overrides[method] ?? ((...args) => fs[method](...args)),
  ]))
}

function createMutationCountingFileSystem(overrides = {}) {
  const mutations = []
  const fileSystem = createInjectedFileSystem(Object.fromEntries(
    FILE_SYSTEM_METHODS.map((method) => [
      method,
      async (...args) => {
        if (MUTATION_METHODS.has(method)) {
          mutations.push({ method, args })
        }

        if (overrides[method]) {
          return overrides[method](...args)
        }
        return fs[method](...args)
      },
    ]),
  ))

  return { fileSystem, mutations }
}

async function createSandbox(t) {
  // macOS 的 /var 是指向 /private/var 的系统 symlink。事务测试先取得临时根的
  // canonical path，避免把系统级入口 symlink 与 fixture 中刻意构造的 symlink 混淆。
  const canonicalTemporaryRoot = await fs.realpath(os.tmpdir())
  const directory = await fs.mkdtemp(
    path.join(canonicalTemporaryRoot, 'qianshu-contract-files-test-'),
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
    return {
      type: 'symlink',
      target: await fs.readlink(entryPath),
    }
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

async function assertPathMissing(entryPath) {
  await assert.rejects(fs.lstat(entryPath), error => error?.code === 'ENOENT')
}

async function assertNoTransactionDebris(directory) {
  const visit = async (currentPath) => {
    const stats = await fs.lstat(currentPath)
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      return
    }

    const entries = await fs.readdir(currentPath, { withFileTypes: true })
    for (const entry of entries) {
      assert.doesNotMatch(entry.name, /\.(?:tmp|bak)$/u)
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        await visit(path.join(currentPath, entry.name))
      }
    }
  }

  await visit(directory)
}

function sequenceUuid(prefix = 'uuid') {
  let index = 0
  return () => `${prefix}-${++index}`
}

async function createTransactionFixture(t) {
  const root = await createSandbox(t)
  const publishedDirectory = path.join(root, 'published')
  const existingFile = path.join(publishedDirectory, 'contract.json')
  const existingDirectory = path.join(publishedDirectory, 'generated')
  const absentFile = path.join(publishedDirectory, 'first-sync.json')
  const sourceDirectory = path.join(root, 'generated-source')

  await fs.mkdir(path.join(existingDirectory, 'nested'), { recursive: true })
  await fs.writeFile(existingFile, 'old-contract\n')
  await fs.writeFile(path.join(existingDirectory, 'stale.ts'), 'old-stale\n')
  await fs.writeFile(
    path.join(existingDirectory, 'nested', 'old-canary.txt'),
    'old-canary\n',
  )

  await fs.mkdir(path.join(sourceDirectory, 'nested'), { recursive: true })
  await fs.mkdir(path.join(sourceDirectory, 'assets'), { recursive: true })
  await fs.writeFile(
    path.join(sourceDirectory, 'types.gen.ts'),
    'export interface Health {}\n',
  )
  await fs.writeFile(
    path.join(sourceDirectory, 'nested', 'source-canary.txt'),
    'source-canary\n',
  )
  await fs.writeFile(
    path.join(sourceDirectory, 'assets', 'metadata.txt'),
    'metadata\n',
  )

  return {
    absentFile,
    artifacts: [
      {
        kind: 'file',
        path: existingFile,
        contents: Buffer.from('new-contract\n'),
      },
      {
        kind: 'file',
        path: absentFile,
        contents: 'first-sync\n',
      },
      {
        kind: 'directory',
        path: existingDirectory,
        sourcePath: sourceDirectory,
      },
    ],
    existingDirectory,
    existingFile,
    publishedDirectory,
    root,
    sourceDirectory,
  }
}

function transactionSiblingPath(target, identifier, suffix) {
  return path.join(
    path.dirname(target),
    `.${path.basename(target)}.${identifier}.${suffix}`,
  )
}

function expectedForwardRenameSteps(fixture, uuidPrefix) {
  const existingFileIdentifier = `${uuidPrefix}-1`
  const absentFileIdentifier = `${uuidPrefix}-2`
  const existingDirectoryIdentifier = `${uuidPrefix}-3`

  return [
    {
      label: 'existing file backup',
      source: fixture.existingFile,
      destination: transactionSiblingPath(
        fixture.existingFile,
        existingFileIdentifier,
        'bak',
      ),
    },
    {
      label: 'existing file install',
      source: transactionSiblingPath(
        fixture.existingFile,
        existingFileIdentifier,
        'tmp',
      ),
      destination: fixture.existingFile,
    },
    {
      label: 'absent file install',
      source: transactionSiblingPath(
        fixture.absentFile,
        absentFileIdentifier,
        'tmp',
      ),
      destination: fixture.absentFile,
    },
    {
      label: 'existing directory backup after absent file install',
      source: fixture.existingDirectory,
      destination: transactionSiblingPath(
        fixture.existingDirectory,
        existingDirectoryIdentifier,
        'bak',
      ),
    },
    {
      label: 'existing directory install after absent file install',
      source: transactionSiblingPath(
        fixture.existingDirectory,
        existingDirectoryIdentifier,
        'tmp',
      ),
      destination: fixture.existingDirectory,
    },
  ]
}

test('resolveContractPaths 返回基于传入仓库根目录的三个绝对发布边界', () => {
  const repositoryRoot = path.join('fixtures', 'repository')
  const absoluteRoot = path.resolve(repositoryRoot)

  assert.deepEqual(resolveContractPaths(repositoryRoot), {
    serverSnapshot: path.join(absoluteRoot, 'server', 'openapi', 'openapi.json'),
    webSnapshot: path.join(absoluteRoot, 'web', 'openapi', 'openapi.json'),
    webGeneratedDirectory: path.join(
      absoluteRoot,
      'web',
      'apps',
      'qsmds-arco',
      'src',
      'api',
      'generated',
    ),
  })
})

test('withTemporaryDirectory 保留 callback 返回值并在成功后递归清理', async (t) => {
  const temporaryRoot = await createSandbox(t)
  const calls = []
  const fileSystem = createInjectedFileSystem({
    mkdtemp: async (...args) => {
      calls.push(['mkdtemp', ...args])
      return fs.mkdtemp(...args)
    },
    rm: async (...args) => {
      calls.push(['rm', ...args])
      return fs.rm(...args)
    },
  })
  const expected = { status: 'generated' }
  let callbackDirectory

  const actual = await withTemporaryDirectory(async (directory) => {
    callbackDirectory = directory
    await fs.mkdir(path.join(directory, 'nested'))
    await fs.writeFile(path.join(directory, 'nested', 'canary.txt'), 'canary\n')
    return expected
  }, {
    temporaryRoot,
    prefix: 'custom-prefix-',
    fileSystem,
  })

  assert.equal(actual, expected)
  assert.equal(path.dirname(callbackDirectory), temporaryRoot)
  assert.match(path.basename(callbackDirectory), /^custom-prefix-/u)
  await assertPathMissing(callbackDirectory)
  assert.deepEqual(calls, [
    ['mkdtemp', path.join(temporaryRoot, 'custom-prefix-')],
    ['rm', callbackDirectory, { recursive: true, force: true }],
  ])
})

test('withTemporaryDirectory callback 单失败时保留同一错误和 exitCode 并完成清理', async (t) => {
  const temporaryRoot = await createSandbox(t)
  const callbackError = Object.assign(new Error('command failed'), {
    exitCode: 7,
  })
  let callbackDirectory

  await assert.rejects(
    withTemporaryDirectory(async (directory) => {
      callbackDirectory = directory
      await fs.mkdir(path.join(directory, 'nested'))
      await fs.writeFile(
        path.join(directory, 'nested', 'canary.txt'),
        'canary\n',
      )
      throw callbackError
    }, { temporaryRoot }),
    (error) => {
      assert.equal(error, callbackError)
      assert.equal(error.exitCode, 7)
      return true
    },
  )

  await assertPathMissing(callbackDirectory)
})

test('withTemporaryDirectory 双失败时保留 callback 原错误并显式附加 cleanup error', async (t) => {
  const temporaryRoot = await createSandbox(t)
  const callbackError = new Error('callback failed')
  const cleanupError = new Error('cleanup failed')
  let callbackDirectory
  const fileSystem = createInjectedFileSystem({
    rm: async (...args) => {
      await fs.rm(...args)
      throw cleanupError
    },
  })

  await assert.rejects(
    withTemporaryDirectory(async (directory) => {
      callbackDirectory = directory
      await fs.writeFile(path.join(directory, 'canary.txt'), 'canary\n')
      throw callbackError
    }, { temporaryRoot, fileSystem }),
    (error) => {
      assert.equal(error, callbackError)
      assert.equal(error.cleanupError, cleanupError)
      assert.equal(
        Object.prototype.propertyIsEnumerable.call(error, 'cleanupError'),
        false,
      )
      return true
    },
  )

  await assertPathMissing(callbackDirectory)
})

test('withTemporaryDirectory 无法附加 cleanup error 时使用安全 AggregateError', async (t) => {
  const temporaryRoot = await createSandbox(t)
  const callbackError = Object.freeze(new Error('callback detail'))
  const cleanupError = new Error('cleanup detail')
  let callbackDirectory
  const fileSystem = createInjectedFileSystem({
    rm: async (...args) => {
      await fs.rm(...args)
      throw cleanupError
    },
  })

  await assert.rejects(
    withTemporaryDirectory(async (directory) => {
      callbackDirectory = directory
      throw callbackError
    }, { temporaryRoot, fileSystem }),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.deepEqual(error.errors, [callbackError, cleanupError])
      assert.equal(error.cause, callbackError)
      assert.doesNotMatch(error.message, /callback detail|cleanup detail/u)
      return true
    },
  )

  await assertPathMissing(callbackDirectory)
})

test('目录校验接受精确唯一的非空 regular file，并使用注入 filesystem', async (t) => {
  const root = await createSandbox(t)
  const directory = path.join(root, 'generated')
  const calls = []
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'types.gen.ts'), 'export type Id = string\n')
  const fileSystem = createInjectedFileSystem({
    lstat: async (...args) => {
      calls.push(['lstat', ...args])
      return fs.lstat(...args)
    },
    readdir: async (...args) => {
      calls.push(['readdir', ...args])
      return fs.readdir(...args)
    },
  })

  await assertDirectoryContainsOnlyNonEmptyFile(
    directory,
    'types.gen.ts',
    { fileSystem },
  )

  assert.deepEqual(calls, [
    ['lstat', directory],
    ['readdir', directory, { withFileTypes: true }],
    ['lstat', path.join(directory, 'types.gen.ts')],
  ])
})

test('目录校验拒绝缺失目录', async (t) => {
  const root = await createSandbox(t)

  await assert.rejects(
    assertDirectoryContainsOnlyNonEmptyFile(
      path.join(root, 'missing'),
      'types.gen.ts',
    ),
  )
})

test('目录校验拒绝 directory symlink，并保持外部 canary 原样', async (t) => {
  const root = await createSandbox(t)
  const externalDirectory = path.join(root, 'external-directory')
  const link = path.join(root, 'generated-link')
  await fs.mkdir(externalDirectory)
  await fs.writeFile(path.join(externalDirectory, 'types.gen.ts'), 'external\n')
  await fs.writeFile(path.join(externalDirectory, 'canary.txt'), 'canary\n')
  await fs.symlink(externalDirectory, link, 'dir')
  const before = await snapshotEntry(root)

  await assert.rejects(
    assertDirectoryContainsOnlyNonEmptyFile(link, 'types.gen.ts'),
  )

  assert.deepEqual(await snapshotEntry(root), before)
})

test('目录校验拒绝缺失目标文件', async (t) => {
  const root = await createSandbox(t)
  const directory = path.join(root, 'generated')
  await fs.mkdir(directory)

  await assert.rejects(
    assertDirectoryContainsOnlyNonEmptyFile(directory, 'types.gen.ts'),
  )
})

test('目录校验拒绝空文件', async (t) => {
  const root = await createSandbox(t)
  const directory = path.join(root, 'generated')
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'types.gen.ts'), '')

  await assert.rejects(
    assertDirectoryContainsOnlyNonEmptyFile(directory, 'types.gen.ts'),
  )
})

test('目录校验拒绝任意额外 entry', async (t) => {
  const root = await createSandbox(t)
  const directory = path.join(root, 'generated')
  await fs.mkdir(directory)
  await fs.writeFile(path.join(directory, 'types.gen.ts'), 'valid\n')
  await fs.mkdir(path.join(directory, 'unexpected-entry'))

  await assert.rejects(
    assertDirectoryContainsOnlyNonEmptyFile(directory, 'types.gen.ts'),
  )
})

test('目录校验拒绝目标文件 symlink，并保持外部 canary 原样', async (t) => {
  const root = await createSandbox(t)
  const directory = path.join(root, 'generated')
  const externalFile = path.join(root, 'external-types.ts')
  await fs.mkdir(directory)
  await fs.writeFile(externalFile, 'external-canary\n')
  await fs.symlink(externalFile, path.join(directory, 'types.gen.ts'))
  const before = await snapshotEntry(root)

  await assert.rejects(
    assertDirectoryContainsOnlyNonEmptyFile(directory, 'types.gen.ts'),
  )

  assert.deepEqual(await snapshotEntry(root), before)
})

test('目录校验拒绝以目标文件命名的子目录', async (t) => {
  const root = await createSandbox(t)
  const directory = path.join(root, 'generated')
  await fs.mkdir(path.join(directory, 'types.gen.ts'), { recursive: true })
  await fs.writeFile(path.join(directory, 'types.gen.ts', 'canary.txt'), 'canary\n')

  await assert.rejects(
    assertDirectoryContainsOnlyNonEmptyFile(directory, 'types.gen.ts'),
  )
})

test('事务 preflight 在 mutation 前拒绝危险或不完整 artifact 集合', async (t) => {
  const cases = [
    {
      name: 'empty artifact list',
      createArtifacts: () => [],
    },
    {
      name: 'unsupported artifact kind',
      createArtifacts: root => [{ kind: 'socket', path: path.join(root, 'target') }],
    },
    {
      name: 'file without contents',
      createArtifacts: root => [{ kind: 'file', path: path.join(root, 'target') }],
    },
    {
      name: 'duplicate target',
      createArtifacts: (root) => {
        const target = path.join(root, 'target')
        return [
          { kind: 'file', path: target, contents: 'one' },
          { kind: 'file', path: target, contents: 'two' },
        ]
      },
    },
    {
      name: 'ancestor-overlap targets',
      createArtifacts: root => [
        { kind: 'file', path: path.join(root, 'target'), contents: 'one' },
        {
          kind: 'file',
          path: path.join(root, 'target', 'nested'),
          contents: 'two',
        },
      ],
    },
    {
      name: 'relative target',
      createArtifacts: () => [
        { kind: 'file', path: 'relative/target', contents: 'one' },
      ],
    },
    {
      name: 'non-normalized target',
      createArtifacts: root => [
        {
          kind: 'file',
          path: `${root}/nested/../target`,
          contents: 'one',
        },
      ],
    },
    {
      name: 'filesystem root target',
      createArtifacts: () => [
        { kind: 'file', path: path.parse(path.resolve('/')).root, contents: 'one' },
      ],
    },
    {
      name: 'missing directory source',
      createArtifacts: root => [
        {
          kind: 'directory',
          path: path.join(root, 'target'),
          sourcePath: path.join(root, 'missing-source'),
        },
      ],
    },
    {
      name: 'relative directory source',
      createArtifacts: root => [
        {
          kind: 'directory',
          path: path.join(root, 'target'),
          sourcePath: 'relative/source',
        },
      ],
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (subtest) => {
      const root = await createSandbox(subtest)
      await fs.writeFile(path.join(root, 'canary.txt'), 'canary\n')
      const before = await snapshotEntry(root)
      const { fileSystem, mutations } = createMutationCountingFileSystem()

      await assert.rejects(
        replaceArtifactsWithRollback(fixtureCase.createArtifacts(root), {
          fileSystem,
          randomUUIDImpl: sequenceUuid('preflight'),
        }),
      )

      assert.equal(mutations.length, 0)
      assert.deepEqual(await snapshotEntry(root), before)
    })
  }
})

test('事务 preflight 以 portable key 零 mutation 拒绝 case-only duplicate target', async (t) => {
  const root = await createSandbox(t)
  await fs.writeFile(path.join(root, 'canary.txt'), 'canary\n')
  const before = await snapshotEntry(root)
  const { fileSystem, mutations } = createMutationCountingFileSystem()

  await assert.rejects(
    replaceArtifactsWithRollback([
      {
        kind: 'file',
        path: path.join(root, 'Contract.json'),
        contents: 'one\n',
      },
      {
        kind: 'file',
        path: path.join(root, 'contract.json'),
        contents: 'two\n',
      },
    ], { fileSystem, randomUUIDImpl: sequenceUuid('portable-case') }),
  )

  assert.equal(mutations.length, 0)
  assert.deepEqual(await snapshotEntry(root), before)
})

test('事务 preflight 以 portable key 零 mutation 拒绝 NFC/NFD ancestor overlap', async (t) => {
  const root = await createSandbox(t)
  await fs.writeFile(path.join(root, 'canary.txt'), 'canary\n')
  const before = await snapshotEntry(root)
  const { fileSystem, mutations } = createMutationCountingFileSystem()
  const composedTarget = path.join(root, 'Caf\u00e9')
  const decomposedTarget = path.join(root, 'Cafe\u0301', 'nested.json')

  await assert.rejects(
    replaceArtifactsWithRollback([
      { kind: 'file', path: composedTarget, contents: 'one\n' },
      { kind: 'file', path: decomposedTarget, contents: 'two\n' },
    ], { fileSystem, randomUUIDImpl: sequenceUuid('portable-unicode') }),
  )

  assert.equal(mutations.length, 0)
  assert.deepEqual(await snapshotEntry(root), before)
})

test('事务 symlink preflight 零 mutation，并保持 link、外部 canary 与 target tree 不变', async (t) => {
  const cases = [
    {
      name: 'directory source itself is a symlink',
      async setup(root) {
        const external = path.join(root, 'external-source')
        const sourceLink = path.join(root, 'source-link')
        await fs.mkdir(path.join(external, 'nested'), { recursive: true })
        await fs.writeFile(path.join(external, 'nested', 'canary.txt'), 'canary\n')
        await fs.symlink(external, sourceLink, 'dir')
        return [{
          kind: 'directory',
          path: path.join(root, 'target'),
          sourcePath: sourceLink,
        }]
      },
    },
    {
      name: 'target itself is a symlink',
      async setup(root) {
        const external = path.join(root, 'external-target.txt')
        const targetLink = path.join(root, 'target-link.txt')
        await fs.writeFile(external, 'external-canary\n')
        await fs.symlink(external, targetLink)
        return [{ kind: 'file', path: targetLink, contents: 'replacement\n' }]
      },
    },
    {
      name: 'an existing target parent component is a symlink',
      async setup(root) {
        const external = path.join(root, 'external-parent')
        const parentLink = path.join(root, 'parent-link')
        await fs.mkdir(path.join(external, 'nested'), { recursive: true })
        await fs.writeFile(path.join(external, 'nested', 'canary.txt'), 'canary\n')
        await fs.symlink(external, parentLink, 'dir')
        return [{
          kind: 'file',
          path: path.join(parentLink, 'nested', 'target.txt'),
          contents: 'replacement\n',
        }]
      },
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.name, async (subtest) => {
      const root = await createSandbox(subtest)
      const artifacts = await fixtureCase.setup(root)
      const before = await snapshotEntry(root)
      const { fileSystem, mutations } = createMutationCountingFileSystem()

      await assert.rejects(
        replaceArtifactsWithRollback(artifacts, {
          fileSystem,
          randomUUIDImpl: sequenceUuid('symlink'),
        }),
      )

      assert.equal(mutations.length, 0)
      assert.deepEqual(await snapshotEntry(root), before)
    })
  }
})

test('事务先完成全部 sibling staging，再成功替换混合 targets', async (t) => {
  const fixture = await createTransactionFixture(t)
  const sourceBefore = await snapshotEntry(fixture.sourceDirectory)
  const events = []
  const fileSystem = createInjectedFileSystem({
    cp: async (source, destination, options) => {
      events.push({ method: 'cp', source, destination, options })
      return fs.cp(source, destination, options)
    },
    rename: async (source, destination) => {
      events.push({ method: 'rename', source, destination })
      return fs.rename(source, destination)
    },
    writeFile: async (file, contents, options) => {
      events.push({ method: 'writeFile', file, options })
      return fs.writeFile(file, contents, options)
    },
  })

  await replaceArtifactsWithRollback(fixture.artifacts, {
    fileSystem,
    randomUUIDImpl: sequenceUuid('success'),
  })

  assert.equal(await fs.readFile(fixture.existingFile, 'utf8'), 'new-contract\n')
  assert.equal(await fs.readFile(fixture.absentFile, 'utf8'), 'first-sync\n')
  assert.deepEqual(
    await snapshotEntry(fixture.existingDirectory),
    sourceBefore,
  )
  assert.deepEqual(await snapshotEntry(fixture.sourceDirectory), sourceBefore)

  const firstRenameIndex = events.findIndex(event => event.method === 'rename')
  assert.notEqual(firstRenameIndex, -1)
  assert.equal(
    events.slice(0, firstRenameIndex).filter(event => (
      event.method === 'writeFile' || event.method === 'cp'
    )).length,
    3,
  )

  const writeEvents = events.filter(event => event.method === 'writeFile')
  assert.equal(writeEvents.length, 2)
  assert.deepEqual(writeEvents.map(event => event.options), [
    { flag: 'wx' },
    { flag: 'wx' },
  ])
  assert.equal(path.dirname(writeEvents[0].file), path.dirname(fixture.existingFile))
  assert.equal(path.dirname(writeEvents[1].file), path.dirname(fixture.absentFile))

  const [copyEvent] = events.filter(event => event.method === 'cp')
  assert.equal(copyEvent.source, fixture.sourceDirectory)
  assert.equal(
    path.dirname(copyEvent.destination),
    path.dirname(fixture.existingDirectory),
  )
  assert.deepEqual(copyEvent.options, {
    recursive: true,
    errorOnExist: true,
    force: false,
  })

  for (const event of events.filter(event => event.method === 'rename')) {
    assert.equal(path.dirname(event.source), path.dirname(event.destination))
  }
  await assertNoTransactionDebris(fixture.root)
})

test('directory cp 失败时不修改 target，并清理此前及部分复制的 temp', async (t) => {
  const fixture = await createTransactionFixture(t)
  const before = await snapshotEntry(fixture.root)
  const copyError = new Error('copy failed')
  let renameCalls = 0
  const fileSystem = createInjectedFileSystem({
    cp: async (_source, destination) => {
      await fs.mkdir(destination)
      await fs.writeFile(path.join(destination, 'partial.txt'), 'partial\n')
      throw copyError
    },
    rename: async (...args) => {
      renameCalls += 1
      return fs.rename(...args)
    },
  })

  await assert.rejects(
    replaceArtifactsWithRollback(fixture.artifacts, {
      fileSystem,
      randomUUIDImpl: sequenceUuid('copy-failure'),
    }),
    error => error === copyError,
  )

  assert.equal(renameCalls, 0)
  assert.deepEqual(await snapshotEntry(fixture.root), before)
  await assertNoTransactionDebris(fixture.root)
})

test('target parent 首次不存在时可以成功发布', async (t) => {
  const root = await createSandbox(t)
  const target = path.join(root, 'fresh', 'deep', 'contract.json')

  await replaceArtifactsWithRollback([
    { kind: 'file', path: target, contents: 'first-publish\n' },
  ], { randomUUIDImpl: sequenceUuid('fresh-success') })

  assert.equal(await fs.readFile(target, 'utf8'), 'first-publish\n')
  await assertNoTransactionDebris(root)
})

test('失败只删除本次创建且仍为空的 parent，保留既有 parent canary', async (t) => {
  for (const failureStage of ['staging write', 'install rename']) {
    await t.test(failureStage, async (subtest) => {
      const root = await createSandbox(subtest)
      const existingParent = path.join(root, 'existing-parent')
      const target = path.join(existingParent, 'new', 'deep', 'contract.json')
      await fs.mkdir(existingParent)
      await fs.writeFile(path.join(existingParent, 'canary.txt'), 'canary\n')
      const before = await snapshotEntry(root)
      const failure = new Error(`${failureStage} failed`)
      const fileSystem = createInjectedFileSystem({
        rename: async (...args) => {
          if (failureStage === 'install rename') {
            throw failure
          }
          return fs.rename(...args)
        },
        writeFile: async (...args) => {
          await fs.writeFile(...args)
          if (failureStage === 'staging write') {
            throw failure
          }
        },
      })

      await assert.rejects(
        replaceArtifactsWithRollback([
          { kind: 'file', path: target, contents: 'replacement\n' },
        ], {
          fileSystem,
          randomUUIDImpl: sequenceUuid('fresh-failure'),
        }),
        error => error === failure,
      )

      assert.deepEqual(await snapshotEntry(root), before)
      await assertNoTransactionDebris(root)
    })
  }
})

test('每个 forward backup/install rename failpoint 都完整回滚混合 artifact tree', async (t) => {
  const failpoints = [
    'existing file backup',
    'existing file install',
    'absent file install',
    'existing directory backup after absent file install',
    'existing directory install after absent file install',
  ]

  for (const [failpointIndex, label] of failpoints.entries()) {
    await t.test(label, async (subtest) => {
      const fixture = await createTransactionFixture(subtest)
      const before = await snapshotEntry(fixture.root)
      const failure = new Error(`forward rename failpoint ${failpointIndex + 1}`)
      let renameCalls = 0
      let failed = false
      const fileSystem = createInjectedFileSystem({
        rename: async (...args) => {
          renameCalls += 1
          if (!failed && renameCalls === failpointIndex + 1) {
            failed = true
            throw failure
          }
          return fs.rename(...args)
        },
      })

      await assert.rejects(
        replaceArtifactsWithRollback(fixture.artifacts, {
          fileSystem,
          randomUUIDImpl: sequenceUuid(`failpoint-${failpointIndex + 1}`),
        }),
        error => error === failure,
      )

      assert.equal(failed, true)
      assert.ok(renameCalls >= failpointIndex + 1)
      assert.deepEqual(await snapshotEntry(fixture.root), before)
      await assertNoTransactionDebris(fixture.root)
    })
  }
})

test('每个 forward rename 已实际成功后 reject 仍完整 reconciliation 与 rollback', async (t) => {
  for (let failpointIndex = 0; failpointIndex < 5; failpointIndex += 1) {
    await t.test(`post-success ${failpointIndex + 1}`, async (subtest) => {
      const fixture = await createTransactionFixture(subtest)
      const before = await snapshotEntry(fixture.root)
      const uuidPrefix = `post-success-${failpointIndex + 1}`
      const expectedStep = expectedForwardRenameSteps(
        fixture,
        uuidPrefix,
      )[failpointIndex]
      const failure = new Error(
        `post-success rename failure: ${expectedStep.label}`,
      )
      let injected = false
      const fileSystem = createInjectedFileSystem({
        rename: async (source, destination) => {
          await fs.rename(source, destination)
          if (
            !injected
            && source === expectedStep.source
            && destination === expectedStep.destination
          ) {
            injected = true
            throw failure
          }
        },
      })

      await assert.rejects(
        replaceArtifactsWithRollback(fixture.artifacts, {
          fileSystem,
          randomUUIDImpl: sequenceUuid(uuidPrefix),
        }),
        error => error === failure,
      )

      assert.equal(injected, true)
      assert.deepEqual(await snapshotEntry(fixture.root), before)
      await assertNoTransactionDebris(fixture.root)
    })
  }
})

test('rename outcome 歧义时报告 recovery incomplete 并保留可能唯一 backup', async (t) => {
  const fixture = await createTransactionFixture(t)
  const uuidPrefix = 'ambiguous-backup'
  const [backupStep] = expectedForwardRenameSteps(fixture, uuidPrefix)
  const failure = new Error('ambiguous backup rename failure')
  let injected = false
  const fileSystem = createInjectedFileSystem({
    rename: async (source, destination) => {
      await fs.rename(source, destination)
      if (
        !injected
        && source === backupStep.source
        && destination === backupStep.destination
      ) {
        injected = true
        // 同时存在 source/destination 时无法证明 rename 是否生效；旧副本可能只在 backup。
        await fs.writeFile(source, 'concurrent-writer\n')
        throw failure
      }
    },
  })

  await assert.rejects(
    replaceArtifactsWithRollback(fixture.artifacts, {
      fileSystem,
      randomUUIDImpl: sequenceUuid(uuidPrefix),
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.match(error.message, /recovery was incomplete/u)
      assert.equal(error.cause, failure)
      assert.equal(error.errors.includes(failure), true)
      return true
    },
  )

  assert.equal(injected, true)
  assert.equal(
    await fs.readFile(backupStep.destination, 'utf8'),
    'old-contract\n',
  )
  assert.equal(await fs.readFile(fixture.existingFile, 'utf8'), 'concurrent-writer\n')
  const transactionSiblings = (await fs.readdir(fixture.publishedDirectory))
    .filter(name => /\.(?:tmp|bak)$/u.test(name))
    .sort()
  assert.deepEqual(transactionSiblings, [path.basename(backupStep.destination)])
})

test('rollback restore rename 失败时报告 recovery incomplete 并保留唯一 old backup', async (t) => {
  const fixture = await createTransactionFixture(t)
  const uuidPrefix = 'restore-failure'
  const forwardSteps = expectedForwardRenameSteps(fixture, uuidPrefix)
  const backupStep = forwardSteps[0]
  const laterForwardStep = forwardSteps[2]
  const forwardFailure = new Error('later forward install failed')
  const restoreFailure = new Error('backup restore failed')
  let forwardFailureInjected = false
  let restoreFailureInjected = false
  const fileSystem = createInjectedFileSystem({
    rename: async (source, destination) => {
      if (
        !forwardFailureInjected
        && source === laterForwardStep.source
        && destination === laterForwardStep.destination
      ) {
        forwardFailureInjected = true
        throw forwardFailure
      }
      if (
        !restoreFailureInjected
        && source === backupStep.destination
        && destination === backupStep.source
      ) {
        restoreFailureInjected = true
        throw restoreFailure
      }
      return fs.rename(source, destination)
    },
  })

  await assert.rejects(
    replaceArtifactsWithRollback(fixture.artifacts, {
      fileSystem,
      randomUUIDImpl: sequenceUuid(uuidPrefix),
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.match(error.message, /recovery was incomplete/u)
      assert.equal(error.cause, forwardFailure)
      assert.equal(error.errors.includes(forwardFailure), true)
      assert.equal(error.errors.includes(restoreFailure), true)
      return true
    },
  )

  assert.equal(forwardFailureInjected, true)
  assert.equal(restoreFailureInjected, true)
  assert.equal(
    await fs.readFile(backupStep.destination, 'utf8'),
    'old-contract\n',
  )
  await assertPathMissing(fixture.existingFile)
  await assertPathMissing(fixture.absentFile)
  const transactionSiblings = (await fs.readdir(fixture.publishedDirectory))
    .filter(name => /\.(?:tmp|bak)$/u.test(name))
    .sort()
  assert.deepEqual(transactionSiblings, [path.basename(backupStep.destination)])
})

test('成功发布后 backup cleanup 失败时保留 committed target 与 old backup', async (t) => {
  const fixture = await createTransactionFixture(t)
  const sourceBefore = await snapshotEntry(fixture.sourceDirectory)
  const uuidPrefix = 'committed-cleanup-failure'
  const [backupStep] = expectedForwardRenameSteps(fixture, uuidPrefix)
  const cleanupFailure = new Error('backup cleanup failed')
  let cleanupFailureInjected = false
  const fileSystem = createInjectedFileSystem({
    rm: async (entryPath, options) => {
      if (!cleanupFailureInjected && entryPath === backupStep.destination) {
        cleanupFailureInjected = true
        throw cleanupFailure
      }
      return fs.rm(entryPath, options)
    },
  })

  await assert.rejects(
    replaceArtifactsWithRollback(fixture.artifacts, {
      fileSystem,
      randomUUIDImpl: sequenceUuid(uuidPrefix),
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.equal(error.message, 'Published artifact cleanup failed')
      assert.deepEqual(error.errors, [cleanupFailure])
      assert.doesNotMatch(
        error.message,
        /old-contract|new-contract|first-sync|source-canary/u,
      )
      return true
    },
  )

  assert.equal(cleanupFailureInjected, true)
  assert.equal(await fs.readFile(fixture.existingFile, 'utf8'), 'new-contract\n')
  assert.equal(await fs.readFile(fixture.absentFile, 'utf8'), 'first-sync\n')
  assert.deepEqual(await snapshotEntry(fixture.existingDirectory), sourceBefore)
  assert.equal(
    await fs.readFile(backupStep.destination, 'utf8'),
    'old-contract\n',
  )
  const transactionSiblings = (await fs.readdir(fixture.publishedDirectory))
    .filter(name => /\.(?:tmp|bak)$/u.test(name))
    .sort()
  assert.deepEqual(transactionSiblings, [path.basename(backupStep.destination)])
})

test('sibling portable alias 碰撞时重选 UUID 并正确发布两个 targets', async (t) => {
  const root = await createSandbox(t)
  const aliasTarget = path.join(root, '.CONTRACT.JSON.PORTABLE-2.TMP')
  const regularTarget = path.join(root, 'contract.json')
  const uuids = ['portable-1', 'portable-2', 'portable-3']
  let uuidCalls = 0

  await replaceArtifactsWithRollback([
    { kind: 'file', path: aliasTarget, contents: 'alias-target\n' },
    { kind: 'file', path: regularTarget, contents: 'regular-target\n' },
  ], {
    randomUUIDImpl: () => {
      const value = uuids[uuidCalls]
      uuidCalls += 1
      return value
    },
  })

  assert.equal(uuidCalls, 3)
  assert.equal(await fs.readFile(aliasTarget, 'utf8'), 'alias-target\n')
  assert.equal(await fs.readFile(regularTarget, 'utf8'), 'regular-target\n')
  await assertNoTransactionDebris(root)
})

test('file staging EEXIST 不取得 foreign temp ownership 并保留 inode 与 canary', async (t) => {
  const root = await createSandbox(t)
  const target = path.join(root, 'contract.json')
  let foreignPath
  let foreignIdentity
  const fileSystem = createInjectedFileSystem({
    writeFile: async (file, contents, options) => {
      foreignPath = file
      await fs.writeFile(file, 'foreign-file-canary\n', { flag: 'wx' })
      foreignIdentity = await fs.lstat(file)
      return fs.writeFile(file, contents, options)
    },
  })

  await assert.rejects(
    replaceArtifactsWithRollback([
      { kind: 'file', path: target, contents: 'transaction-data\n' },
    ], {
      fileSystem,
      randomUUIDImpl: sequenceUuid('file-race'),
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.match(error.message, /recovery was incomplete/u)
      assert.equal(error.cause?.code, 'EEXIST')
      return true
    },
  )

  const afterIdentity = await fs.lstat(foreignPath)
  assert.equal(afterIdentity.dev, foreignIdentity.dev)
  assert.equal(afterIdentity.ino, foreignIdentity.ino)
  assert.equal(await fs.readFile(foreignPath, 'utf8'), 'foreign-file-canary\n')
  await assertPathMissing(target)
})

test('directory staging EEXIST 不取得 foreign tree ownership 并保留 link identity', async (t) => {
  const root = await createSandbox(t)
  const source = path.join(root, 'source')
  const target = path.join(root, 'generated')
  const externalCanary = path.join(root, 'external-canary.txt')
  await fs.mkdir(source)
  await fs.writeFile(path.join(source, 'types.gen.ts'), 'transaction-data\n')
  await fs.writeFile(externalCanary, 'external-canary\n')
  let foreignDirectory
  let foreignDirectoryIdentity
  let foreignLink
  let foreignLinkIdentity
  let foreignTreeBefore
  const fileSystem = createInjectedFileSystem({
    cp: async (_source, destination) => {
      foreignDirectory = destination
      foreignLink = path.join(destination, 'foreign-link')
      await fs.mkdir(destination)
      await fs.writeFile(
        path.join(destination, 'foreign-canary.txt'),
        'foreign-tree-canary\n',
      )
      await fs.symlink(externalCanary, foreignLink)
      foreignDirectoryIdentity = await fs.lstat(destination)
      foreignLinkIdentity = await fs.lstat(foreignLink)
      foreignTreeBefore = await snapshotEntry(destination)
      throw Object.assign(new Error('directory destination exists'), {
        code: 'EEXIST',
      })
    },
  })

  await assert.rejects(
    replaceArtifactsWithRollback([
      { kind: 'directory', path: target, sourcePath: source },
    ], {
      fileSystem,
      randomUUIDImpl: sequenceUuid('directory-race'),
    }),
    (error) => {
      assert.equal(error instanceof AggregateError, true)
      assert.match(error.message, /recovery was incomplete/u)
      assert.equal(error.cause?.code, 'EEXIST')
      return true
    },
  )

  const directoryAfter = await fs.lstat(foreignDirectory)
  const linkAfter = await fs.lstat(foreignLink)
  assert.equal(directoryAfter.dev, foreignDirectoryIdentity.dev)
  assert.equal(directoryAfter.ino, foreignDirectoryIdentity.ino)
  assert.equal(linkAfter.dev, foreignLinkIdentity.dev)
  assert.equal(linkAfter.ino, foreignLinkIdentity.ino)
  assert.deepEqual(await snapshotEntry(foreignDirectory), foreignTreeBefore)
  assert.equal(await fs.readFile(externalCanary, 'utf8'), 'external-canary\n')
  await assertPathMissing(target)
})

test('sibling UUID 冲突时重新选择名称且不覆盖既有 canary', async (t) => {
  const root = await createSandbox(t)
  const target = path.join(root, 'contract.json')
  const collisionTemp = path.join(root, '.contract.json.collision.tmp')
  const collisionBackup = path.join(root, '.contract.json.collision.bak')
  await fs.writeFile(target, 'old\n')
  await fs.writeFile(collisionTemp, 'temp-canary\n')
  await fs.writeFile(collisionBackup, 'backup-canary\n')
  const uuids = ['collision', 'fresh']
  let uuidCalls = 0

  await replaceArtifactsWithRollback([
    { kind: 'file', path: target, contents: 'new\n' },
  ], {
    randomUUIDImpl: () => {
      const value = uuids[uuidCalls]
      uuidCalls += 1
      return value
    },
  })

  assert.equal(uuidCalls, 2)
  assert.equal(await fs.readFile(target, 'utf8'), 'new\n')
  assert.equal(await fs.readFile(collisionTemp, 'utf8'), 'temp-canary\n')
  assert.equal(await fs.readFile(collisionBackup, 'utf8'), 'backup-canary\n')
})
