import type { CreateClientImplementation } from './generate-api.ts'

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 Node.js 内置 test runner 直接运行。
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  generateApiTypes,
  parseGenerateApiArguments,
  resolveSafeOutputDirectory,
  runGenerateApi,
} from './generate-api.ts'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const webRoot = path.resolve(scriptsDirectory, '..')
const repositoryRoot = path.resolve(webRoot, '..')
const applicationRoot = path.join(webRoot, 'apps/qsmds-arco')
const applicationTsconfig = path.join(applicationRoot, 'tsconfig.app.json')
const defaultInput = path.join(webRoot, 'openapi/openapi.json')
const defaultOutputDirectory = path.join(applicationRoot, 'src/api/generated')
const tsxBinary = path.join(webRoot, 'node_modules/.bin/tsx')
const wrapperPath = path.join(scriptsDirectory, 'generate-api.ts')

function asCreateClient(
  implementation: (configuration: unknown) => Promise<void> | void,
): CreateClientImplementation {
  return (async (configuration: unknown) => {
    await implementation(configuration)
    return []
  }) as unknown as CreateClientImplementation
}

function getOutputClean(configuration: unknown): boolean {
  const candidate = configuration as { output?: { clean?: unknown } }
  if (typeof candidate.output?.clean !== 'boolean') {
    throw new TypeError('createClient output.clean must be boolean')
  }
  return candidate.output.clean
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await lstat(targetPath)
    return true
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function createTemporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix))
}

async function writeOpenApiFixture(directory: string): Promise<string> {
  const inputPath = path.join(directory, 'openapi.json')
  const document = {
    openapi: '3.0.3',
    info: {
      title: 'Task 6 generator fixture',
      version: '1.0.0',
    },
    paths: {
      '/api/health': {
        get: {
          operationId: 'health_get',
          responses: {
            200: {
              description: 'Healthy',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/HealthResponse',
                  },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        HealthResponse: {
          type: 'object',
          required: ['status'],
          properties: {
            status: {
              type: 'string',
            },
          },
        },
      },
    },
  }

  await writeFile(inputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
  return inputPath
}

async function snapshotTree(root: string): Promise<readonly string[]> {
  if (!await exists(root)) {
    return ['<missing>']
  }

  const snapshot: string[] = []

  async function visit(absolutePath: string, relativePath: string): Promise<void> {
    const stats = await lstat(absolutePath)
    if (stats.isSymbolicLink()) {
      snapshot.push(`link:${relativePath}:${await readlink(absolutePath)}`)
      return
    }
    if (stats.isDirectory()) {
      snapshot.push(`directory:${relativePath}`)
      for (const entry of (await readdir(absolutePath)).sort()) {
        await visit(path.join(absolutePath, entry), path.join(relativePath, entry))
      }
      return
    }
    snapshot.push(`file:${relativePath}:${await readFile(absolutePath, 'utf8')}`)
  }

  await visit(root, '.')
  return snapshot
}

test('CLI parser 使用不依赖 cwd 的默认输入和输出', () => {
  assert.deepEqual(parseGenerateApiArguments([]), {
    input: defaultInput,
    outputDirectory: defaultOutputDirectory,
  })
})

test('CLI parser 接受绝对 input/output override', () => {
  const input = path.join(os.tmpdir(), 'fixture-openapi.json')
  const outputDirectory = path.join(os.tmpdir(), 'fixture-generated')

  assert.deepEqual(parseGenerateApiArguments([
    '--input',
    input,
    '--output',
    outputDirectory,
  ]), {
    input,
    outputDirectory,
  })
  assert.deepEqual(parseGenerateApiArguments(['--input', input]), {
    input,
    outputDirectory: defaultOutputDirectory,
  })
  assert.deepEqual(parseGenerateApiArguments(['--output', outputDirectory]), {
    input: defaultInput,
    outputDirectory,
  })
})

test('CLI parser 拒绝任一相对 override', () => {
  const absoluteInput = path.join(os.tmpdir(), 'fixture-openapi.json')
  const absoluteOutput = path.join(os.tmpdir(), 'fixture-generated')

  assert.throws(
    () => parseGenerateApiArguments(['--input', 'relative.json', '--output', absoluteOutput]),
    /absolute paths/,
  )
  assert.throws(
    () => parseGenerateApiArguments(['--input', absoluteInput, '--output', 'relative-output']),
    /absolute paths/,
  )
})

test('CLI parser 拒绝未知、缺值和重复参数', () => {
  const absoluteInput = path.join(os.tmpdir(), 'fixture-openapi.json')
  const absoluteOutput = path.join(os.tmpdir(), 'fixture-generated')

  assert.throws(() => parseGenerateApiArguments(['--unknown', absoluteInput]), /Unknown argument/)
  assert.throws(() => parseGenerateApiArguments(['--input']), /requires a value/)
  assert.throws(() => parseGenerateApiArguments(['--output']), /requires a value/)
  assert.throws(
    () => parseGenerateApiArguments(['--input', '--output', absoluteOutput]),
    /requires a value/,
  )
  assert.throws(() => parseGenerateApiArguments([absoluteInput]), /Unknown argument/)
  assert.throws(
    () => parseGenerateApiArguments(['--input', absoluteInput, '--input', absoluteInput]),
    /Duplicate argument/,
  )
  assert.throws(
    () => parseGenerateApiArguments(['--output', absoluteOutput, '--output', absoluteOutput]),
    /Duplicate argument/,
  )
})

test('默认目录和 canonical 临时根下的不存在/空目录可通过安全守卫', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-safe-')

  try {
    const nonexistent = path.join(temporaryDirectory, 'first', 'nested', 'generation')
    const empty = path.join(temporaryDirectory, 'empty-generation')
    await mkdir(empty)

    assert.equal(await resolveSafeOutputDirectory(defaultOutputDirectory), defaultOutputDirectory)
    assert.equal(
      await resolveSafeOutputDirectory(nonexistent),
      path.join(await realpath(temporaryDirectory), 'first', 'nested', 'generation'),
    )
    assert.equal(await resolveSafeOutputDirectory(empty), await realpath(empty))
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('所有危险、非空和 symlink override 都在 createClient 前被拒绝且 canary 不变', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-reject-')
  const input = await writeOpenApiFixture(temporaryDirectory)
  const regularFile = path.join(temporaryDirectory, 'regular-file')
  const nonemptyDirectory = path.join(temporaryDirectory, 'nonempty')
  const targetSymlink = path.join(temporaryDirectory, 'target-link')
  const intermediateRoot = path.join(temporaryDirectory, 'intermediate')
  const intermediateSymlink = path.join(intermediateRoot, 'link')
  const externalDirectory = await createTemporaryDirectory('qianshu-api-external-')
  const outsideTemporaryRoot = path.join(path.dirname(await realpath(os.tmpdir())), 'qianshu-api-outside')
  const temporaryPrefixCollision = `${await realpath(os.tmpdir())}-evil/generated`

  try {
    await writeFile(regularFile, 'canary.keep\n', 'utf8')
    await mkdir(nonemptyDirectory)
    await writeFile(path.join(nonemptyDirectory, 'canary.keep'), 'keep\n', 'utf8')
    await mkdir(path.join(externalDirectory, 'nested'), { recursive: true })
    await writeFile(path.join(externalDirectory, 'nested/canary.keep'), 'external\n', 'utf8')
    await symlink(externalDirectory, targetSymlink, 'dir')
    await mkdir(intermediateRoot)
    await symlink(externalDirectory, intermediateSymlink, 'dir')

    const externalBefore = await snapshotTree(externalDirectory)
    const nonemptyBefore = await snapshotTree(nonemptyDirectory)
    const cases = [
      ['filesystem root', path.parse(webRoot).root],
      ['repository root', repositoryRoot],
      ['web root', webRoot],
      ['application root', applicationRoot],
      ['relative path', 'relative-output'],
      ['regular file', regularFile],
      ['symlink target', targetSymlink],
      ['canonical temporary root', await realpath(os.tmpdir())],
      ['outside canonical temporary root', outsideTemporaryRoot],
      ['canonical temporary prefix collision', temporaryPrefixCollision],
      ['canonical escape through intermediate symlink', path.join(intermediateSymlink, 'generated')],
      ['nonempty override', nonemptyDirectory],
      ['lexically unnormalized override', `${path.join(temporaryDirectory, 'branch')}/../normalized`],
      ['lexical alias of privileged default', `${path.dirname(defaultOutputDirectory)}/./generated`],
    ] as const

    for (const [name, outputDirectory] of cases) {
      let createClientCalls = 0
      const createClientImpl = asCreateClient(() => {
        createClientCalls += 1
      })

      await assert.rejects(
        generateApiTypes({ input, outputDirectory }, createClientImpl),
        (error: unknown) => error instanceof Error,
        `${name} 应被拒绝`,
      )
      assert.equal(createClientCalls, 0, `${name} 不得进入 createClient`)
    }

    assert.equal(await readFile(regularFile, 'utf8'), 'canary.keep\n')
    assert.deepEqual(await snapshotTree(nonemptyDirectory), nonemptyBefore)
    assert.equal((await lstat(targetSymlink)).isSymbolicLink(), true)
    assert.equal(await readlink(targetSymlink), externalDirectory)
    assert.equal((await lstat(intermediateSymlink)).isSymbolicLink(), true)
    assert.equal(await readlink(intermediateSymlink), externalDirectory)
    assert.deepEqual(await snapshotTree(externalDirectory), externalBefore)
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
    await rm(externalDirectory, { force: true, recursive: true })
  }
})

test('POSIX 反斜杠文件名仍按单一 component 检查 nonempty 与 symlink', {
  skip: path.sep !== '/',
}, async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-backslash-')
  const externalDirectory = await createTemporaryDirectory('qianshu-api-backslash-external-')
  const input = await writeOpenApiFixture(temporaryDirectory)
  const nonemptyOutput = path.join(temporaryDirectory, 'branch\\name', 'output')
  const nonemptyCanary = path.join(nonemptyOutput, 'canary.keep')
  const symlinkComponent = path.join(temporaryDirectory, 'link\\name')
  const symlinkOutput = path.join(symlinkComponent, 'output')
  const externalOutput = path.join(externalDirectory, 'output')
  const externalCanary = path.join(externalOutput, 'canary.keep')

  await mkdir(nonemptyOutput, { recursive: true })
  await writeFile(nonemptyCanary, 'nonempty\n', 'utf8')
  await mkdir(externalOutput)
  await writeFile(externalCanary, 'external\n', 'utf8')
  await symlink(externalDirectory, symlinkComponent, 'dir')

  try {
    for (const outputDirectory of [nonemptyOutput, symlinkOutput]) {
      let createClientCalls = 0
      await assert.rejects(generateApiTypes(
        { input, outputDirectory },
        asCreateClient(() => {
          createClientCalls += 1
          throw new Error('createClient must not run')
        }),
      ))
      assert.equal(createClientCalls, 0)
    }

    assert.equal(await readFile(nonemptyCanary, 'utf8'), 'nonempty\n')
    assert.equal((await lstat(symlinkComponent)).isSymbolicLink(), true)
    assert.equal(await readlink(symlinkComponent), externalDirectory)
    assert.equal(await readFile(externalCanary, 'utf8'), 'external\n')
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
    await rm(externalDirectory, { force: true, recursive: true })
  }
})

test('临时 fixture 覆盖默认路径分支并拒绝 api 祖先 symlink', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-default-context-')
  const externalDirectory = await createTemporaryDirectory('qianshu-api-default-link-')
  const fixtureWebRoot = path.join(temporaryDirectory, 'web')
  const fixtureApplicationRoot = path.join(
    fixtureWebRoot,
    'apps/qsmds-arco',
  )
  const fixtureApiDirectory = path.join(fixtureApplicationRoot, 'src/api')
  const fixtureDefaultOutput = path.join(fixtureApiDirectory, 'generated')

  await mkdir(fixtureDefaultOutput, { recursive: true })
  await writeFile(
    path.join(fixtureDefaultOutput, 'existing.canary'),
    'managed-default\n',
    'utf8',
  )

  try {
    // 非空目录只有在被识别为受管默认输出时才允许通过；这个断言
    // 先证明测试传入的临时布局确实走 default 分支，而不是普通 override。
    assert.equal(
      await resolveSafeOutputDirectory(fixtureDefaultOutput, {
        applicationRoot: fixtureApplicationRoot,
        webRoot: fixtureWebRoot,
      }),
      await realpath(fixtureDefaultOutput),
    )

    await rm(fixtureApiDirectory, { force: true, recursive: true })
    await mkdir(path.join(externalDirectory, 'nested'), { recursive: true })
    await writeFile(
      path.join(externalDirectory, 'nested/canary.keep'),
      'external-default\n',
      'utf8',
    )
    const externalBefore = await snapshotTree(externalDirectory)
    await symlink(externalDirectory, fixtureApiDirectory, 'dir')
    const linkTargetBefore = await readlink(fixtureApiDirectory)

    await assert.rejects(resolveSafeOutputDirectory(fixtureDefaultOutput, {
      applicationRoot: fixtureApplicationRoot,
      webRoot: fixtureWebRoot,
    }))

    assert.equal((await lstat(fixtureApiDirectory)).isSymbolicLink(), true)
    assert.equal(await readlink(fixtureApiDirectory), linkTargetBefore)
    assert.deepEqual(await snapshotTree(externalDirectory), externalBefore)
  }
  finally {
    // 两个清理根都是 mkdtemp 返回的专用目录，不会触碰仓库源码。
    await rm(temporaryDirectory, { force: true, recursive: true })
    await rm(externalDirectory, { force: true, recursive: true })
  }
})

test('preflight 后父目录身份漂移时不沿 symlink 清理外部 canary', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-identity-')
  const externalDirectory = await createTemporaryDirectory('qianshu-api-identity-external-')
  const parentDirectory = path.join(temporaryDirectory, 'verified-parent')
  const movedParentDirectory = path.join(temporaryDirectory, 'moved-parent')
  const outputDirectory = path.join(parentDirectory, 'output')
  const externalOutputDirectory = path.join(externalDirectory, 'output')
  const externalCanary = path.join(externalOutputDirectory, 'canary.keep')
  const input = await writeOpenApiFixture(temporaryDirectory)
  const generationError = new Error('generator sentinel')

  await mkdir(outputDirectory, { recursive: true })
  await mkdir(externalOutputDirectory)
  await writeFile(externalCanary, 'external\n', 'utf8')

  try {
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory },
        asCreateClient(async () => {
          await rename(parentDirectory, movedParentDirectory)
          await symlink(externalDirectory, parentDirectory, 'dir')
          throw generationError
        }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors[0], generationError)
        assert.match(error.message, /ownership changed/)
        return true
      },
    )

    assert.equal(await readFile(externalCanary, 'utf8'), 'external\n')
    assert.equal((await lstat(parentDirectory)).isSymbolicLink(), true)
    assert.equal(await readlink(parentDirectory), externalDirectory)
    assert.deepEqual(await readdir(path.join(movedParentDirectory, 'output')), [])
  }
  finally {
    // 临时树内的 symlink 由 fs.rm() 作为链接本身删除，不跟随到 externalDirectory。
    await rm(temporaryDirectory, { force: true, recursive: true })
    await rm(externalDirectory, { force: true, recursive: true })
  }
})

test('cleanup 不安全时同时保留原始生成错误和恢复错误', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-cleanup-error-')
  const parentDirectory = path.join(temporaryDirectory, 'verified-parent')
  const movedParentDirectory = path.join(temporaryDirectory, 'moved-parent')
  const outputDirectory = path.join(parentDirectory, 'output')
  const input = await writeOpenApiFixture(temporaryDirectory)
  const generationError = new Error('generator sentinel')

  await mkdir(outputDirectory, { recursive: true })

  try {
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory },
        asCreateClient(async () => {
          await rename(parentDirectory, movedParentDirectory)
          await writeFile(parentDirectory, 'replacement\n', 'utf8')
          throw generationError
        }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors[0], generationError)
        assert.match(error.message, /ownership changed|cleanup failed/)
        return true
      },
    )
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('已存在 output 被真实目录替换时不删除替换目录 canary', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-target-identity-')
  const outputDirectory = path.join(temporaryDirectory, 'output')
  const movedOriginalDirectory = path.join(temporaryDirectory, 'moved-original')
  const foreignDirectory = path.join(temporaryDirectory, 'foreign-output')
  const foreignCanary = path.join(outputDirectory, 'canary.keep')
  const input = await writeOpenApiFixture(temporaryDirectory)
  const generationError = new Error('generator sentinel')

  await mkdir(outputDirectory)
  await mkdir(foreignDirectory)
  await writeFile(path.join(foreignDirectory, 'canary.keep'), 'foreign\n', 'utf8')

  try {
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory },
        asCreateClient(async () => {
          await rename(outputDirectory, movedOriginalDirectory)
          await rename(foreignDirectory, outputDirectory)
          throw generationError
        }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors[0], generationError)
        assert.match(error.message, /ownership changed/)
        return true
      },
    )

    assert.equal(await readFile(foreignCanary, 'utf8'), 'foreign\n')
    assert.deepEqual(await readdir(movedOriginalDirectory), [])
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('初始不存在的 output 被真实目录替换时也不删除替换目录 canary', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-missing-target-')
  const outputDirectory = path.join(temporaryDirectory, 'output')
  const movedOwnedDirectory = path.join(temporaryDirectory, 'moved-owned-output')
  const foreignDirectory = path.join(temporaryDirectory, 'foreign-output')
  const foreignCanary = path.join(outputDirectory, 'canary.keep')
  const input = await writeOpenApiFixture(temporaryDirectory)
  const generationError = new Error('generator sentinel')

  await mkdir(foreignDirectory)
  await writeFile(path.join(foreignDirectory, 'canary.keep'), 'foreign\n', 'utf8')

  try {
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory },
        asCreateClient(async () => {
          if (await exists(outputDirectory)) {
            await rename(outputDirectory, movedOwnedDirectory)
          }
          await rename(foreignDirectory, outputDirectory)
          throw generationError
        }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof AggregateError)
        assert.equal(error.errors[0], generationError)
        assert.match(error.message, /ownership changed/)
        return true
      },
    )

    assert.equal(await readFile(foreignCanary, 'utf8'), 'foreign\n')
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('环境临时根与仓库重叠时拒绝扩大 override 写入边界', async () => {
  const previousTemporaryDirectory = process.env.TMPDIR
  const outputDirectory = path.join(repositoryRoot, 'server/task6-review-output')

  try {
    process.env.TMPDIR = repositoryRoot
    await assert.rejects(
      resolveSafeOutputDirectory(outputDirectory),
      /temporary directory overlaps a protected root/,
    )
    assert.equal(await exists(outputDirectory), false)
  }
  finally {
    if (previousTemporaryDirectory === undefined) {
      delete process.env.TMPDIR
    }
    else {
      process.env.TMPDIR = previousTemporaryDirectory
    }
  }
})

test('临时根是仓库父级时允许受保护树之外的安全 sibling', async () => {
  const previousTemporaryDirectory = process.env.TMPDIR
  const temporaryParent = path.dirname(repositoryRoot)
  const outputDirectory = path.join(
    temporaryParent,
    `qianshu-task6-safe-output-${randomUUID()}`,
  )

  try {
    process.env.TMPDIR = temporaryParent
    assert.equal(
      await resolveSafeOutputDirectory(outputDirectory),
      path.join(await realpath(temporaryParent), path.basename(outputDirectory)),
    )
    assert.equal(await exists(outputDirectory), false)
  }
  finally {
    if (previousTemporaryDirectory === undefined) {
      delete process.env.TMPDIR
    }
    else {
      process.env.TMPDIR = previousTemporaryDirectory
    }
  }
})

test('types-only 配置在安全守卫后传入 createClient', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-config-')
  const input = await writeOpenApiFixture(temporaryDirectory)
  const outputDirectory = path.join(temporaryDirectory, 'generated')
  let capturedConfiguration: unknown

  try {
    await generateApiTypes(
      { input, outputDirectory },
      asCreateClient(async (configuration) => {
        capturedConfiguration = configuration
        await writeFile(path.join(outputDirectory, 'types.gen.ts'), 'export type HealthGetResponses = true\n', 'utf8')
      }),
    )

    assert.deepEqual(capturedConfiguration, {
      input,
      logs: {
        file: false,
        level: 'silent',
      },
      output: {
        path: await realpath(outputDirectory),
        clean: false,
        entryFile: false,
        tsConfigPath: applicationTsconfig,
      },
      plugins: [{ name: '@hey-api/typescript', enums: false }],
    })
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('精确 default 保留 clean:true 且 mock 失败不改变既有目录树', async () => {
  const input = path.join(os.tmpdir(), 'qianshu-default-openapi.json')
  const generationError = new Error('default generator sentinel')
  const before = await snapshotTree(defaultOutputDirectory)
  let capturedConfiguration: unknown

  await assert.rejects(
    generateApiTypes(
      { input, outputDirectory: defaultOutputDirectory },
      asCreateClient((configuration) => {
        capturedConfiguration = configuration
        throw generationError
      }),
    ),
    (error: unknown) => error === generationError,
  )

  assert.equal(getOutputClean(capturedConfiguration), true)
  assert.deepEqual(await snapshotTree(defaultOutputDirectory), before)
})

test('generateApiTypes 程序化入口也在 createClient 前拒绝 relative input', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-relative-input-')
  const outputDirectory = path.join(temporaryDirectory, 'generated')
  let createClientCalls = 0

  try {
    await assert.rejects(
      generateApiTypes(
        { input: 'relative-openapi.json', outputDirectory },
        asCreateClient(() => {
          createClientCalls += 1
        }),
      ),
      /absolute paths/,
    )
    assert.equal(createClientCalls, 0)
    assert.equal(await exists(outputDirectory), false)
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('合成 OpenAPI 实际只生成非空 types.gen.ts', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-real-')
  const input = await writeOpenApiFixture(temporaryDirectory)
  const outputDirectory = path.join(temporaryDirectory, 'generated')

  try {
    await generateApiTypes({ input, outputDirectory })
    assert.deepEqual(await readdir(outputDirectory), ['types.gen.ts'])

    const typesPath = path.join(outputDirectory, 'types.gen.ts')
    const stats = await lstat(typesPath)
    assert.equal(stats.isFile(), true)
    assert.equal(stats.isSymbolicLink(), false)
    assert.ok(stats.size > 0)
    assert.match(await readFile(typesPath, 'utf8'), /HealthGetResponses/)
    for (const forbiddenEntry of ['index.ts', 'sdk.gen.ts', 'client.gen.ts']) {
      assert.equal(await exists(path.join(outputDirectory, forbiddenEntry)), false)
    }
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('生成器失败、空产物或额外 entry 都恢复 override 原始状态', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-rollback-')
  const input = await writeOpenApiFixture(temporaryDirectory)

  try {
    const stableAncestor = path.join(temporaryDirectory, 'stable-ancestor')
    const siblingCanary = path.join(stableAncestor, 'sibling.canary')
    const nonexistentFailure = path.join(stableAncestor, 'missing', 'nested', 'generated')
    await mkdir(stableAncestor)
    await writeFile(siblingCanary, 'sibling\n', 'utf8')
    const stableAncestorBefore = await snapshotTree(stableAncestor)
    const generationError = new Error('generator sentinel')
    const nonexistentFailureCleanValues: boolean[] = []
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory: nonexistentFailure },
        asCreateClient(async (configuration) => {
          const clean = getOutputClean(configuration)
          nonexistentFailureCleanValues.push(clean)
          if (clean) {
            await rm(nonexistentFailure, { force: true, recursive: true })
            await mkdir(nonexistentFailure, { recursive: true })
          }
          await writeFile(path.join(nonexistentFailure, 'partial.ts'), 'partial\n', 'utf8')
          throw generationError
        }),
      ),
      (error: unknown) => error === generationError,
    )
    assert.equal(await exists(nonexistentFailure), false)
    assert.deepEqual(await snapshotTree(stableAncestor), stableAncestorBefore)
    assert.deepEqual(nonexistentFailureCleanValues, [false])

    const emptyFailure = path.join(temporaryDirectory, 'empty-failure')
    await mkdir(emptyFailure)
    const emptyFailureStats = await lstat(emptyFailure)
    const emptyFailureCleanValues: boolean[] = []
    await assert.rejects(generateApiTypes(
      { input, outputDirectory: emptyFailure },
      asCreateClient(async (configuration) => {
        const clean = getOutputClean(configuration)
        emptyFailureCleanValues.push(clean)
        if (clean) {
          await rm(emptyFailure, { force: true, recursive: true })
          await mkdir(emptyFailure)
        }
        await writeFile(path.join(emptyFailure, 'partial.ts'), 'partial\n', 'utf8')
        throw generationError
      }),
    ))
    assert.deepEqual(await readdir(emptyFailure), [])
    const restoredEmptyFailureStats = await lstat(emptyFailure)
    assert.equal(restoredEmptyFailureStats.dev, emptyFailureStats.dev)
    assert.equal(restoredEmptyFailureStats.ino, emptyFailureStats.ino)
    assert.equal(restoredEmptyFailureStats.mode, emptyFailureStats.mode)
    assert.deepEqual(emptyFailureCleanValues, [false])

    const emptyProduct = path.join(temporaryDirectory, 'empty-product')
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory: emptyProduct },
        asCreateClient(async () => {}),
      ),
      /exactly one non-empty regular types\.gen\.ts/,
    )
    assert.equal(await exists(emptyProduct), false)

    const emptyProductInitiallyEmpty = path.join(temporaryDirectory, 'empty-product-initially-empty')
    await mkdir(emptyProductInitiallyEmpty)
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory: emptyProductInitiallyEmpty },
        asCreateClient(async () => {}),
      ),
      /exactly one non-empty regular types\.gen\.ts/,
    )
    assert.deepEqual(await readdir(emptyProductInitiallyEmpty), [])

    const extraEntry = path.join(temporaryDirectory, 'extra-entry')
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory: extraEntry },
        asCreateClient(async () => {
          await writeFile(path.join(extraEntry, 'types.gen.ts'), 'export type Valid = true\n', 'utf8')
          await writeFile(path.join(extraEntry, 'index.ts'), 'export * from "./types.gen"\n', 'utf8')
        }),
      ),
      /exactly one non-empty regular types\.gen\.ts/,
    )
    assert.equal(await exists(extraEntry), false)

    const extraEntryInitiallyEmpty = path.join(temporaryDirectory, 'extra-entry-initially-empty')
    await mkdir(extraEntryInitiallyEmpty)
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory: extraEntryInitiallyEmpty },
        asCreateClient(async () => {
          await writeFile(path.join(extraEntryInitiallyEmpty, 'types.gen.ts'), 'export type Valid = true\n', 'utf8')
          await writeFile(path.join(extraEntryInitiallyEmpty, 'client.gen.ts'), 'export {}\n', 'utf8')
        }),
      ),
      /exactly one non-empty regular types\.gen\.ts/,
    )
    assert.deepEqual(await readdir(extraEntryInitiallyEmpty), [])

    const symlinkProduct = path.join(temporaryDirectory, 'symlink-product')
    const symlinkCanary = path.join(temporaryDirectory, 'symlink-source.canary')
    await writeFile(symlinkCanary, 'source\n', 'utf8')
    await assert.rejects(
      generateApiTypes(
        { input, outputDirectory: symlinkProduct },
        asCreateClient(async () => {
          await symlink(symlinkCanary, path.join(symlinkProduct, 'types.gen.ts'))
        }),
      ),
      /exactly one non-empty regular types\.gen\.ts/,
    )
    assert.equal(await exists(symlinkProduct), false)
    assert.equal(await readFile(symlinkCanary, 'utf8'), 'source\n')
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('runGenerateApi 将程序化生成失败原样传播', async () => {
  const input = path.join(os.tmpdir(), 'fixture-openapi.json')
  const outputDirectory = path.join(os.tmpdir(), 'fixture-generated')
  const generationError = new Error('programmatic sentinel')

  await assert.rejects(
    runGenerateApi(
      ['--input', input, '--output', outputDirectory],
      async () => {
        throw generationError
      },
    ),
    (error: unknown) => error === generationError,
  )
})

test('导入 wrapper 时 no-op，直接失败时只输出固定错误并返回 1', async () => {
  const importResult = spawnSync(
    tsxBinary,
    ['--eval', 'import(\'./scripts/generate-api.ts\').then(() => {})'],
    { cwd: webRoot, encoding: 'utf8' },
  )
  assert.equal(importResult.status, 0, importResult.stderr)
  assert.equal(importResult.stdout, '')
  assert.equal(importResult.stderr, '')

  const outputDirectory = path.join(await realpath(os.tmpdir()), `qianshu-cli-failure-${process.pid}`)
  const failureResult = spawnSync(
    tsxBinary,
    [wrapperPath, '--input', 'relative-openapi.json', '--output', outputDirectory],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
  assert.equal(failureResult.status, 1)
  assert.equal(failureResult.stdout, '')
  assert.equal(failureResult.stderr, 'API type generation failed\n')

  const temporaryDirectory = await createTemporaryDirectory('qianshu-cli-real-failure-')
  try {
    const missingInput = path.join(temporaryDirectory, 'missing-openapi.json')
    const generatedOutput = path.join(temporaryDirectory, 'generated')
    const generatorFailureResult = spawnSync(
      tsxBinary,
      [wrapperPath, '--input', missingInput, '--output', generatedOutput],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )
    assert.equal(generatorFailureResult.status, 1)
    assert.equal(generatorFailureResult.stdout, '')
    assert.equal(generatorFailureResult.stderr, 'API type generation failed\n')
    assert.equal(await exists(generatedOutput), false)
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})

test('直接 CLI 接受绝对 override 并只生成 types.gen.ts', async () => {
  const temporaryDirectory = await createTemporaryDirectory('qianshu-api-cli-')
  const input = await writeOpenApiFixture(temporaryDirectory)
  const outputDirectory = path.join(temporaryDirectory, 'generated')

  try {
    const result = spawnSync(
      tsxBinary,
      [wrapperPath, '--input', input, '--output', outputDirectory],
      { cwd: repositoryRoot, encoding: 'utf8' },
    )

    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(await readdir(outputDirectory), ['types.gen.ts'])
    assert.match(await readFile(path.join(outputDirectory, 'types.gen.ts'), 'utf8'), /HealthGetResponses/)
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
})
