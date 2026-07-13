import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  collectMigrationMetadata,
  createAndVerifyChecksums,
  createReleaseManifest,
  generateReleaseBundle,
  parseReleaseManifestArguments,
  validateManifestSchema,
  validateValueAgainstSchema,
  verifyReleaseBundle,
} from './release-manifest.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const schemaPath = path.join(repositoryRoot, 'release', 'manifest.schema.json')
const version = '1.2.3'
const tag = `v${version}`
const tagObjectSha = 'a'.repeat(40)
const sourceCommit = 'b'.repeat(40)

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`
}

function runtimeDependencies(repository, overrides = {}) {
  return {
    env: {
      ImageOS: 'ubuntu24',
      QIANSHU_RUNNER_IMAGE: 'ubuntu-24.04',
      RUNNER_ARCH: 'X64',
      RUNNER_OS: 'Linux',
    },
    now: () => new Date('2026-07-12T12:00:00.000Z'),
    processRef: {
      arch: 'x64',
      platform: 'linux',
      versions: { node: '24.15.0' },
    },
    repositoryRoot: repository,
    runCapture: async (command, args) => {
      if (command === 'pnpm' && args.length === 1 && args[0] === '--version') {
        return '11.9.0\n'
      }
      if (command === 'ldd' && args.length === 1 && args[0] === '--version') {
        return 'ldd (Ubuntu GLIBC 2.39-0ubuntu8.4) 2.39\nCopyright fixture\n'
      }
      throw new Error('Unexpected fixture command')
    },
    schemaPath,
    ...overrides,
  }
}

async function createSandbox(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir())
  const sandbox = await fs.mkdtemp(
    path.join(temporaryRoot, 'qianshu-release-manifest-test-'),
  )
  const repository = path.join(sandbox, 'repository')
  const inputs = path.join(sandbox, 'inputs')
  const output = path.join(sandbox, 'final-bundle')
  await fs.mkdir(
    path.join(repository, 'server', 'prisma', 'migrations', '20260710152144_init'),
    { recursive: true },
  )
  await fs.mkdir(path.join(repository, 'server', 'openapi'), { recursive: true })
  await fs.mkdir(inputs)
  await fs.mkdir(output)

  const openapi = Buffer.from('{"openapi":"3.1.0"}\n')
  const prismaSchema = Buffer.from('datasource db { provider = "postgresql" }\n')
  const migrationLock = Buffer.from('provider = "postgresql"\n')
  const migrationSql = Buffer.from('SELECT 1;\n')
  await fs.writeFile(path.join(repository, 'server', 'openapi', 'openapi.json'), openapi)
  await fs.writeFile(path.join(repository, 'server', 'prisma', 'schema.prisma'), prismaSchema)
  await fs.writeFile(
    path.join(repository, 'server', 'prisma', 'migrations', 'migration_lock.toml'),
    migrationLock,
  )
  await fs.writeFile(
    path.join(
      repository,
      'server',
      'prisma',
      'migrations',
      '20260710152144_init',
      'migration.sql',
    ),
    migrationSql,
  )

  const releaseMetadata = {
    version,
    tag,
    tagObjectSha,
    sourceCommit,
  }
  const releaseMetadataPath = path.join(sandbox, 'release-version.json')
  await fs.writeFile(releaseMetadataPath, canonicalJson(releaseMetadata))
  const webArchivePath = path.join(inputs, `qsmds-web-${tag}.tar.gz`)
  const serverArchivePath = path.join(
    inputs,
    `qsmds-server-${tag}-linux-x64.tar.gz`,
  )
  await fs.writeFile(webArchivePath, 'web archive fixture\n')
  await fs.writeFile(serverArchivePath, 'server archive fixture\n')

  t.after(() => fs.rm(sandbox, { force: true, recursive: true }))
  return {
    inputs,
    openapi,
    output,
    prismaSchema,
    releaseMetadata,
    releaseMetadataPath,
    repository,
    sandbox,
    serverArchivePath,
    webArchivePath,
  }
}

function manifestInput(fixture, overrides = {}) {
  return {
    releaseMetadataPath: fixture.releaseMetadataPath,
    repository: 'SilnoGM/QIANSHU-DMS',
    runAttempt: 1,
    runId: '123456789',
    serverArchivePath: fixture.serverArchivePath,
    webArchivePath: fixture.webArchivePath,
    workflow: 'release.yml',
    ...overrides,
  }
}

function verifyInput(fixture, overrides = {}) {
  return {
    bundleDirectory: fixture.output,
    bundleRunAttempt: 1,
    releaseMetadataPath: fixture.releaseMetadataPath,
    repository: 'SilnoGM/QIANSHU-DMS',
    runId: '123456789',
    ...overrides,
  }
}

async function readSchema() {
  return JSON.parse(await fs.readFile(schemaPath, 'utf8'))
}

async function validManifest(fixture) {
  return createReleaseManifest(
    manifestInput(fixture),
    runtimeDependencies(fixture.repository),
  )
}

function visitObjectSchemas(schema, schemaPathValue = '$', result = []) {
  if (schema.type === 'object') {
    result.push([schemaPathValue, schema])
    for (const [name, child] of Object.entries(schema.properties)) {
      visitObjectSchemas(child, `${schemaPathValue}.${name}`, result)
    }
  }
  return result
}

function valueAtPath(document, jsonPath) {
  return jsonPath === '$'
    ? document
    : jsonPath.slice(2).split('.').reduce((value, key) => value[key], document)
}

test('Manifest schema 使用受支持的 Draft 2020-12 精确子集', async () => {
  const schema = await readSchema()
  const validated = validateManifestSchema(schema)
  assert.equal(validated, schema)
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema')

  for (const [jsonPath, objectSchema] of visitObjectSchemas(schema)) {
    assert.equal(objectSchema.additionalProperties, false, jsonPath)
    assert.deepEqual(
      [...objectSchema.required].sort(),
      Object.keys(objectSchema.properties).sort(),
      jsonPath,
    )
  }
})

test('schema loader 拒绝未知 keyword 与不支持的组合', async () => {
  const schema = await readSchema()
  assert.throws(
    () => validateManifestSchema({ ...schema, description: 'unsupported' }),
    /Schema keyword is unsupported at \$: description/,
  )
  assert.throws(
    () => validateManifestSchema({ ...schema, required: ['missing'] }),
    /Schema required property is undefined at \$: missing/,
  )
  assert.throws(
    () => validateManifestSchema({ ...schema, type: ['object', 'null'] }),
    /Schema type is unsupported at \$/,
  )
})

test('每个 object 都拒绝缺失 required、未知属性和错误 type', async (t) => {
  const fixture = await createSandbox(t)
  const schema = await readSchema()
  const manifest = await validManifest(fixture)

  for (const [jsonPath, objectSchema] of visitObjectSchemas(schema)) {
    const missingDocument = structuredClone(manifest)
    const missingTarget = valueAtPath(missingDocument, jsonPath)
    delete missingTarget[objectSchema.required[0]]
    assert.throws(
      () => validateValueAgainstSchema(missingDocument, schema),
      /Manifest validation failed at .*: required$/,
      `${jsonPath} missing required`,
    )

    const unknownDocument = structuredClone(manifest)
    valueAtPath(unknownDocument, jsonPath).unknown = true
    assert.throws(
      () => validateValueAgainstSchema(unknownDocument, schema),
      /: additionalProperties$/,
      `${jsonPath} additional property`,
    )

    const wrongTypeDocument = structuredClone(manifest)
    if (jsonPath === '$') {
      assert.throws(
        () => validateValueAgainstSchema([], schema),
        /Manifest validation failed at \$: type/,
      )
    } else {
      const segments = jsonPath.slice(2).split('.')
      const name = segments.pop()
      const parentPath = segments.length === 0 ? '$' : `$.${segments.join('.')}`
      valueAtPath(wrongTypeDocument, parentPath)[name] = []
      assert.throws(
        () => validateValueAgainstSchema(wrongTypeDocument, schema),
        /: type$/,
        `${jsonPath} wrong type`,
      )
    }
  }
})

test('schema const、pattern、enum、minimum 和基础 type mutation 全部生效', async (t) => {
  const fixture = await createSandbox(t)
  const schema = await readSchema()
  const manifest = await validManifest(fixture)
  const mutations = [
    [document => { document.schemaVersion = 2 }, 'const'],
    [document => { document.release.tag = '1.2.3' }, 'pattern'],
    [document => { document.release.sourceCommit = 'A'.repeat(40) }, 'pattern'],
    [document => { document.components.web.sha256 = `sha256:${'g'.repeat(64)}` }, 'pattern'],
    [document => { document.components.web.artifact = '../web.tar.gz' }, 'pattern'],
    [document => { document.runtime.os = 'darwin' }, 'enum'],
    [document => { document.build.runAttempt = 0 }, 'minimum'],
    [document => { document.build.runId = 123 }, 'type'],
  ]
  for (const [mutate, constraint] of mutations) {
    const document = structuredClone(manifest)
    mutate(document)
    assert.throws(
      () => validateValueAgainstSchema(document, schema),
      new RegExp(`: ${constraint}$`),
    )
  }
})

test('migration 清单按相对路径 code-point 排序并以 canonical JSON 聚合', async (t) => {
  const fixture = await createSandbox(t)
  const secondMigration = path.join(
    fixture.repository,
    'server',
    'prisma',
    'migrations',
    '20260711152144_second',
  )
  await fs.mkdir(secondMigration)
  await fs.writeFile(path.join(secondMigration, 'migration.sql'), 'SELECT 2;\n')
  const metadata = await collectMigrationMetadata(
    path.join(fixture.repository, 'server', 'prisma', 'migrations'),
  )
  const expectedFiles = [
    {
      path: '20260710152144_init/migration.sql',
      sha256: sha256('SELECT 1;\n'),
    },
    {
      path: '20260711152144_second/migration.sql',
      sha256: sha256('SELECT 2;\n'),
    },
    {
      path: 'migration_lock.toml',
      sha256: sha256('provider = "postgresql"\n'),
    },
  ]
  assert.deepEqual(metadata.files, expectedFiles)
  assert.equal(metadata.migrationHead, '20260711152144_second')
  assert.equal(metadata.sha256, sha256(canonicalJson(expectedFiles)))
  assert.equal(Object.isFrozen(metadata), true)
  assert.equal(Object.isFrozen(metadata.files), true)
})

test('migration 拒绝空集合、非法目录名、重复时间戳和 portable 冲突', async (t) => {
  const fixture = await createSandbox(t)
  const casesRoot = path.join(fixture.sandbox, 'migration-cases')
  await fs.mkdir(casesRoot)

  const empty = path.join(casesRoot, 'empty')
  await fs.mkdir(empty)
  await assert.rejects(collectMigrationMetadata(empty), /Migration set is empty/)

  const invalid = path.join(casesRoot, 'invalid')
  await fs.mkdir(path.join(invalid, 'not-a-migration'), { recursive: true })
  await fs.writeFile(path.join(invalid, 'not-a-migration', 'migration.sql'), '')
  await assert.rejects(
    collectMigrationMetadata(invalid),
    /Migration directory name is invalid/,
  )

  const emptyDirectory = path.join(casesRoot, 'empty-directory')
  await fs.mkdir(path.join(emptyDirectory, '20260710152144_init'), {
    recursive: true,
  })
  await assert.rejects(
    collectMigrationMetadata(emptyDirectory),
    /Migration directory is empty/,
  )

  const duplicateTimestamp = path.join(casesRoot, 'duplicate-timestamp')
  for (const name of ['20260710152144_one', '20260710152144_two']) {
    await fs.mkdir(path.join(duplicateTimestamp, name), { recursive: true })
    await fs.writeFile(path.join(duplicateTimestamp, name, 'migration.sql'), '')
  }
  await assert.rejects(
    collectMigrationMetadata(duplicateTimestamp),
    /Migration timestamp is duplicated/,
  )

  const portableConflict = path.join(casesRoot, 'portable-conflict')
  const portableMigration = path.join(portableConflict, '20260710152144_init')
  await fs.mkdir(portableMigration, { recursive: true })
  await fs.writeFile(
    path.join(portableMigration, 'A.sql'),
    '',
  )
  // macOS 默认文件系统通常大小写不敏感，无法真实同时创建 A.sql/a.sql；通过
  // 文件系统注入只模拟目录枚举冲突，底层 bytes 和 stat 仍来自真实 regular file。
  const collisionFileSystem = {
    async lstat(target) {
      return fs.lstat(
        target === path.join(portableMigration, 'a.sql')
          ? path.join(portableMigration, 'A.sql')
          : target,
      )
    },
    async readFile(target) {
      return fs.readFile(
        target === path.join(portableMigration, 'a.sql')
          ? path.join(portableMigration, 'A.sql')
          : target,
      )
    },
    async readdir(target) {
      return target === portableMigration
        ? ['A.sql', 'a.sql']
        : fs.readdir(target)
    },
  }
  await assert.rejects(
    collectMigrationMetadata(portableConflict, {
      fileSystem: collisionFileSystem,
    }),
    /Migration path has a portable collision/,
  )
})

test('migration 拒绝 symlink、special file 和嵌套目录', async (t) => {
  const fixture = await createSandbox(t)
  const casesRoot = path.join(fixture.sandbox, 'unsafe-migrations')
  const targets = [
    ['symlink', async directory => {
      await fs.symlink(
        path.join(fixture.repository, 'server', 'prisma', 'schema.prisma'),
        path.join(directory, 'migration.sql'),
      )
    }],
    ['special', async directory => {
      await fs.mkdir(path.join(directory, 'migration.sql'))
    }],
    ['nested', async directory => {
      await fs.mkdir(path.join(directory, 'nested'))
    }],
  ]
  for (const [name, createUnsafeEntry] of targets) {
    const migrationDirectory = path.join(
      casesRoot,
      name,
      '20260710152144_init',
    )
    await fs.mkdir(migrationDirectory, { recursive: true })
    await createUnsafeEntry(migrationDirectory)
    await assert.rejects(
      collectMigrationMetadata(path.dirname(migrationDirectory)),
      /Migration tree contains an unsupported entry/,
    )
  }
})

test('Manifest 使用源文件原始 bytes hash、真实 archive size/hash 与受控 runtime', async (t) => {
  const fixture = await createSandbox(t)
  const manifest = await validManifest(fixture)
  assert.deepEqual(manifest.release, fixture.releaseMetadata)
  assert.deepEqual(manifest.build, {
    repository: 'SilnoGM/QIANSHU-DMS',
    workflow: 'release.yml',
    runId: '123456789',
    runAttempt: 1,
    createdAt: '2026-07-12T12:00:00.000Z',
  })
  assert.deepEqual(manifest.runtime, {
    node: '24.15.0',
    pnpm: '11.9.0',
    runnerImage: 'ubuntu-24.04',
    os: 'linux',
    arch: 'x64',
    libc: 'glibc',
    libcVersion: '2.39',
  })
  assert.equal(manifest.contract.version, version)
  assert.equal(manifest.contract.openapiSha256, `sha256:${sha256(fixture.openapi)}`)
  assert.equal(manifest.database.schemaSha256, `sha256:${sha256(fixture.prismaSchema)}`)
  assert.equal(
    manifest.components.web.sha256,
    `sha256:${sha256('web archive fixture\n')}`,
  )
  assert.equal(Object.isFrozen(manifest), true)
  assert.equal(Object.isFrozen(manifest.components.web), true)
})

test('runtime metadata 缺失、不一致或非 glibc 都失败且不回显底层输出', async (t) => {
  const fixture = await createSandbox(t)
  const cases = [
    runtimeDependencies(fixture.repository, { env: {} }),
    runtimeDependencies(fixture.repository, {
      processRef: { arch: 'arm64', platform: 'linux', versions: { node: '24.15.0' } },
    }),
    runtimeDependencies(fixture.repository, {
      runCapture: async command => command === 'pnpm'
        ? '11.9.0\n'
        : 'musl libc (x86_64)\nsecret-fixture\n',
    }),
  ]
  for (const dependencies of cases) {
    await assert.rejects(
      createReleaseManifest(manifestInput(fixture), dependencies),
      error => {
        assert.equal(error.message.includes('secret-fixture'), false)
        return true
      },
    )
  }
})

test('artifact 只接受精确 basename，拒绝路径分隔符、重复名、空文件和 special file', async (t) => {
  const fixture = await createSandbox(t)
  const duplicateServer = path.join(fixture.inputs, path.basename(fixture.webArchivePath))
  const emptyDirectory = path.join(fixture.sandbox, 'empty-archive')
  const specialDirectory = path.join(fixture.sandbox, 'special-archive')
  await fs.mkdir(emptyDirectory)
  await fs.mkdir(specialDirectory)
  const emptyWeb = path.join(emptyDirectory, path.basename(fixture.webArchivePath))
  const specialWeb = path.join(specialDirectory, path.basename(fixture.webArchivePath))
  await fs.writeFile(emptyWeb, '')
  await fs.mkdir(specialWeb)

  const cases = [
    manifestInput(fixture, { webArchivePath: path.join(fixture.inputs, '..', path.basename(fixture.webArchivePath)) }),
    manifestInput(fixture, { serverArchivePath: duplicateServer }),
    manifestInput(fixture, { webArchivePath: emptyWeb }),
    manifestInput(fixture, { webArchivePath: specialWeb }),
  ]
  for (const input of cases) {
    await assert.rejects(
      createReleaseManifest(input, runtimeDependencies(fixture.repository)),
    )
  }
})

test('archive 文件替换 TOCTOU 会使 Manifest 生成失败', async (t) => {
  const fixture = await createSandbox(t)
  let reads = 0
  const fileSystem = {
    ...fs,
    async readFile(target, ...args) {
      const contents = await fs.readFile(target, ...args)
      if (path.resolve(target) === fixture.webArchivePath && reads++ === 0) {
        await fs.rm(target)
        await fs.writeFile(target, contents)
      }
      return contents
    },
  }
  await assert.rejects(
    createReleaseManifest(
      manifestInput(fixture),
      runtimeDependencies(fixture.repository, { fileSystem }),
    ),
    /File changed while hashing/,
  )
})

test('SHA256SUMS 恰好三行、两个空格、固定顺序且生成后重读通过', async (t) => {
  const fixture = await createSandbox(t)
  await generateReleaseBundle(
    { ...manifestInput(fixture), outputDirectory: fixture.output },
    runtimeDependencies(fixture.repository),
  )
  const sums = await fs.readFile(path.join(fixture.output, 'SHA256SUMS'), 'utf8')
  const lines = sums.trimEnd().split('\n')
  assert.deepEqual(lines.map(line => line.slice(66)), [
    path.basename(fixture.webArchivePath),
    path.basename(fixture.serverArchivePath),
    'release-manifest.json',
  ])
  assert.equal(lines.length, 3)
  assert.ok(lines.every(line => /^[0-9a-f]{64}  [^/\\]+$/u.test(line)))

  const entries = await createAndVerifyChecksums({
    bundleDirectory: fixture.output,
    fileNames: lines.map(line => line.slice(66)),
  })
  assert.equal(entries.length, 3)
  assert.equal(Object.isFrozen(entries), true)
})

test('bundle 生成要求 fresh 空目录并拒绝重复 basename', async (t) => {
  const fixture = await createSandbox(t)
  await fs.writeFile(path.join(fixture.output, 'stale.txt'), 'stale\n')
  await assert.rejects(
    generateReleaseBundle(
      { ...manifestInput(fixture), outputDirectory: fixture.output },
      runtimeDependencies(fixture.repository),
    ),
    /Release bundle output directory must be empty/,
  )
})

test('verify 从磁盘重读四文件并交叉校验 identity、archive size/hash', async (t) => {
  const fixture = await createSandbox(t)
  await generateReleaseBundle(
    { ...manifestInput(fixture), outputDirectory: fixture.output },
    runtimeDependencies(fixture.repository),
  )
  const verified = await verifyReleaseBundle(
    verifyInput(fixture),
    runtimeDependencies(fixture.repository),
  )
  assert.equal(verified.manifest.release.sourceCommit, sourceCommit)
  assert.equal(verified.checksums.length, 3)
  assert.equal(Object.isFrozen(verified), true)
})

test('SHA256SUMS 格式 mutation 与固定文件集合变化都失败', async (t) => {
  const mutations = [
    text => text.replace('  ', ' '),
    text => text.toUpperCase(),
    text => `${text}0${'f'.repeat(63)}  extra.tar.gz\n`,
    text => text.split('\n').reverse().join('\n'),
  ]
  for (const mutate of mutations) {
    const fixture = await createSandbox(t)
    await generateReleaseBundle(
      { ...manifestInput(fixture), outputDirectory: fixture.output },
      runtimeDependencies(fixture.repository),
    )
    const sumsPath = path.join(fixture.output, 'SHA256SUMS')
    await fs.writeFile(sumsPath, mutate(await fs.readFile(sumsPath, 'utf8')))
    await assert.rejects(
      verifyReleaseBundle(
        verifyInput(fixture),
        runtimeDependencies(fixture.repository),
      ),
    )
  }

  const fixture = await createSandbox(t)
  await generateReleaseBundle(
    { ...manifestInput(fixture), outputDirectory: fixture.output },
    runtimeDependencies(fixture.repository),
  )
  await fs.writeFile(path.join(fixture.output, 'unexpected.txt'), 'extra\n')
  await assert.rejects(
    verifyReleaseBundle(
      verifyInput(fixture),
      runtimeDependencies(fixture.repository),
    ),
    /Release bundle file set is invalid/,
  )
})

test('生成后重读任一摘要文件变化都失败', async (t) => {
  for (const name of [
    `qsmds-web-${tag}.tar.gz`,
    `qsmds-server-${tag}-linux-x64.tar.gz`,
    'release-manifest.json',
  ]) {
    const fixture = await createSandbox(t)
    await generateReleaseBundle(
      { ...manifestInput(fixture), outputDirectory: fixture.output },
      runtimeDependencies(fixture.repository),
    )
    await fs.appendFile(path.join(fixture.output, name), 'changed')
    await assert.rejects(
      verifyReleaseBundle(
        verifyInput(fixture),
        runtimeDependencies(fixture.repository),
      ),
      /Checksum verification failed/,
    )
  }
})

test('verify 拒绝 Manifest schema 与 release/build identity mutation', async (t) => {
  const mutations = [
    document => { document.unknown = true },
    document => { document.release.sourceCommit = 'c'.repeat(40) },
    document => { document.build.repository = 'foreign/repository' },
    document => { document.build.runId = '987654321' },
    document => { document.build.runAttempt = 2 },
    document => { document.contract.version = '9.9.9' },
  ]
  for (const mutate of mutations) {
    const fixture = await createSandbox(t)
    await generateReleaseBundle(
      { ...manifestInput(fixture), outputDirectory: fixture.output },
      runtimeDependencies(fixture.repository),
    )
    const manifestPath = path.join(fixture.output, 'release-manifest.json')
    const document = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
    mutate(document)
    await fs.writeFile(manifestPath, canonicalJson(document))
    const webName = path.basename(fixture.webArchivePath)
    const serverName = path.basename(fixture.serverArchivePath)
    const checksumLines = [webName, serverName, 'release-manifest.json'].map(name => {
      const target = path.join(fixture.output, name)
      return fs.readFile(target).then(bytes => `${sha256(bytes)}  ${name}`)
    })
    await fs.writeFile(
      path.join(fixture.output, 'SHA256SUMS'),
      `${(await Promise.all(checksumLines)).join('\n')}\n`,
    )
    await assert.rejects(
      verifyReleaseBundle(
        verifyInput(fixture),
        runtimeDependencies(fixture.repository),
      ),
    )
  }
})

test('CLI 参数只接受固定 generate 与 verify 协议', () => {
  const generated = parseReleaseManifestArguments([
    '--release-metadata', '/tmp/release-version.json',
    '--repository', 'SilnoGM/QIANSHU-DMS',
    '--workflow', 'release.yml',
    '--run-id', '1',
    '--run-attempt', '2',
    '--web-archive', `/tmp/qsmds-web-${tag}.tar.gz`,
    '--server-archive', `/tmp/qsmds-server-${tag}-linux-x64.tar.gz`,
    '--output', '/tmp/final-bundle',
  ])
  assert.equal(generated.command, 'generate')
  assert.equal(generated.input.runAttempt, 2)

  const verified = parseReleaseManifestArguments([
    'verify',
    '--bundle', '/tmp/final-bundle',
    '--release-metadata', '/tmp/release-version.json',
    '--repository', 'SilnoGM/QIANSHU-DMS',
    '--run-id', '1',
    '--bundle-run-attempt', '2',
  ])
  assert.equal(verified.command, 'verify')
  assert.equal(verified.input.bundleRunAttempt, 2)

  for (const argv of [[], ['verify'], ['--repository', 'x/y'], [
    '--release-metadata', '/tmp/release-version.json',
    '--repository', 'SilnoGM/QIANSHU-DMS',
    '--workflow', 'release.yml',
    '--run-id', '0',
    '--run-attempt', '1',
    '--web-archive', '/tmp/web.tar.gz',
    '--server-archive', '/tmp/server.tar.gz',
    '--output', '/tmp/final-bundle',
  ]]) {
    assert.throws(() => parseReleaseManifestArguments(argv))
  }
})
