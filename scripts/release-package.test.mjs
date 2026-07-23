import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'

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
import { CommandExecutionError } from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const entrypoint = path.join(scriptsDirectory, 'release-package.mjs')
const tag = 'v1.2.3'
const databaseUrl =
  'postgresql://qianshu_ci:fixture-password@127.0.0.1:54321/qianshu_ci?schema=public'
const smokeAppOrigin = 'https://release-smoke.invalid'
const smokeHmacKeyNames = Object.freeze([
  'AUTH_USERNAME_HMAC_KEY',
  'AUTH_USER_ID_HMAC_KEY',
  'AUTH_IP_HMAC_KEY',
])

function webPolicy(versionTag = tag) {
  return {
    kind: 'web',
    topLevelName: `qsmds-web-${versionTag}`,
  }
}

function serverPolicy(versionTag = tag) {
  return {
    kind: 'server',
    topLevelName: `qsmds-server-${versionTag}-linux-x64`,
  }
}

async function createSandbox(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir())
  const sandbox = await fs.mkdtemp(
    path.join(temporaryRoot, 'qianshu-release-package-test-'),
  )
  const repositoryRoot = path.join(sandbox, 'repository')
  const outputRoot = path.join(sandbox, 'outputs')
  const runnerTemp = path.join(sandbox, 'runner-temp')
  await fs.mkdir(repositoryRoot)
  await fs.mkdir(outputRoot)
  await fs.mkdir(runnerTemp)
  t.after(() => fs.rm(sandbox, { force: true, recursive: true }))
  return { outputRoot, repositoryRoot, runnerTemp, sandbox }
}

async function createWebTree(root) {
  await fs.mkdir(path.join(root, 'assets'), { recursive: true })
  await fs.writeFile(path.join(root, 'index.html'), '<!doctype html>\n')
  await fs.writeFile(path.join(root, 'assets', 'app.js'), 'console.log("ok")\n')
}

async function createServerTree(root) {
  const packageTarget = path.join(
    root,
    'node_modules',
    '.pnpm',
    'fixture@1.0.0',
    'node_modules',
    'fixture',
  )
  await fs.mkdir(path.join(root, 'dist'), { recursive: true })
  await fs.mkdir(packageTarget, { recursive: true })
  await fs.mkdir(path.join(root, 'node_modules', '.bin'), { recursive: true })
  await fs.mkdir(
    path.join(root, 'prisma', 'migrations', '20260713000000_init'),
    { recursive: true },
  )
  await fs.writeFile(path.join(root, 'dist', 'main.js'), 'main()\n')
  await fs.writeFile(path.join(packageTarget, 'index.js'), 'module.exports = {}\n')
  await fs.symlink(
    path.join('.pnpm', 'fixture@1.0.0', 'node_modules', 'fixture'),
    path.join(root, 'node_modules', 'fixture'),
    'dir',
  )
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"server"}\n')
  await fs.writeFile(path.join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
  await fs.writeFile(
    path.join(root, 'prisma', 'schema.prisma'),
    'generator client { provider = "prisma-client" }\n',
  )
  await fs.writeFile(
    path.join(root, 'prisma', 'migrations', 'migration_lock.toml'),
    'provider = "postgresql"\n',
  )
  await fs.writeFile(
    path.join(
      root,
      'prisma',
      'migrations',
      '20260713000000_init',
      'migration.sql',
    ),
    'SELECT 1;\n',
  )
}

function writeString(target, offset, length, value) {
  const bytes = Buffer.from(value)
  assert.ok(bytes.length <= length)
  bytes.copy(target, offset)
}

function writeOctal(target, offset, length, value) {
  const digits = value.toString(8).padStart(length - 1, '0')
  writeString(target, offset, length, `${digits}\0`)
}

function tarHeader({
  gid = 0,
  linkTarget = '',
  magic = 'ustar\0',
  mtime = 0,
  name,
  size = 0,
  type = '0',
  uid = 0,
  version = '00',
}) {
  const header = Buffer.alloc(512)
  writeString(header, 0, 100, name)
  writeOctal(header, 100, 8, type === '5' ? 0o755 : 0o644)
  writeOctal(header, 108, 8, uid)
  writeOctal(header, 116, 8, gid)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, mtime)
  header.fill(0x20, 148, 156)
  writeString(header, 156, 1, type)
  writeString(header, 157, 100, linkTarget)
  writeString(header, 257, 6, magic)
  writeString(header, 263, 2, version)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `)
  return header
}

function paxRecord(key, value) {
  const payload = `${key}=${value}\n`
  let length = Buffer.byteLength(payload) + 2
  while (true) {
    const record = `${length} ${payload}`
    const actualLength = Buffer.byteLength(record)
    if (actualLength === length) {
      return Buffer.from(record)
    }
    length = actualLength
  }
}

function createTarGzip(entries, { corruptChecksum = false } = {}) {
  const chunks = []
  for (const entry of entries) {
    const contents = Buffer.from(entry.contents ?? '')
    const size = ['0', '\0', 'x'].includes(entry.type ?? '0')
      ? contents.length
      : 0
    const header = tarHeader({
      gid: entry.gid,
      linkTarget: entry.linkTarget,
      magic: entry.magic,
      mtime: entry.mtime,
      name: entry.path,
      size,
      type: entry.type ?? '0',
      uid: entry.uid,
      version: entry.version,
    })
    if (corruptChecksum && chunks.length === 0) {
      header[0] ^= 1
    }
    chunks.push(header, contents)
    const padding = (512 - (contents.length % 512)) % 512
    if (padding > 0) {
      chunks.push(Buffer.alloc(padding))
    }
  }
  chunks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(chunks), { level: 9, mtime: 0 })
}

async function entriesFromTree(root, topLevelName) {
  const entries = [{ path: `${topLevelName}/`, type: '5' }]
  async function walk(directory, relativeDirectory = '') {
    const names = await fs.readdir(directory)
    names.sort()
    for (const name of names) {
      const absolutePath = path.join(directory, name)
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name
      const stats = await fs.lstat(absolutePath)
      const archivePath = `${topLevelName}/${relativePath}`
      if (stats.isDirectory()) {
        entries.push({ path: `${archivePath}/`, type: '5' })
        await walk(absolutePath, relativePath)
      } else if (stats.isSymbolicLink()) {
        entries.push({
          linkTarget: await fs.readlink(absolutePath),
          path: archivePath,
          type: '2',
        })
      } else {
        entries.push({
          contents: await fs.readFile(absolutePath),
          path: archivePath,
          type: '0',
        })
      }
    }
  }
  await walk(root)
  return entries
}

function response({ status = 200, requestId = 'request-fixture', body } = {}) {
  return {
    status,
    headers: { get: name => name.toLowerCase() === 'x-request-id' ? requestId : null },
    async json() {
      return body ?? {
        status: 'ok',
        info: { database: { status: 'up' } },
      }
    },
  }
}

function createProcessGroup(statuses = []) {
  const calls = []
  return {
    calls,
    spawn(command, args, options) {
      const handle = {
        command,
        args,
        options,
        status: statuses[calls.length],
      }
      calls.push({ handle, type: 'spawn' })
      return handle
    },
    status(handle) {
      return handle.status
    },
    async terminate(handle, signal) {
      calls.push({ handle, signal, type: 'terminate' })
      handle.status ??= { exitCode: 0, signal }
    },
    async wait(handle) {
      calls.push({ handle, type: 'wait' })
      return handle.status ?? { exitCode: 0 }
    },
  }
}

function createDependencies(fixture, overrides = {}) {
  let currentTime = 0
  const processGroup = createProcessGroup()
  const processRef = new EventEmitter()
  const calls = []
  return {
    calls,
    dependencies: {
      arch: 'x64',
      env: {
        DATABASE_URL: databaseUrl,
        DEBUG: 'unsafe-debug',
        NODE_PATH: '/unsafe/node-path',
        PATH: process.env.PATH,
        PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION: 'yes',
        QIANSHU_SAFE_VALUE: 'preserved',
      },
      fetch: async () => response(),
      fileSystem: fs,
      now: () => currentTime,
      platform: 'linux',
      processGroup,
      processRef,
      repositoryRoot: fixture.repositoryRoot,
      reservePort: async () => ({
        port: 41234,
        async close() {
          calls.push(['port-close', 41234])
        },
      }),
      async run(command, args, options) {
        calls.push([command, args, options])
      },
      async terminationWait() {},
      temporaryRoot: fixture.runnerTemp,
      async wait(milliseconds) {
        currentTime += milliseconds
      },
      ...overrides,
    },
    processGroup,
    processRef,
  }
}

test('input parser 只接受三个固定 CLI 形状与稳定 Tag', () => {
  const cwd = path.join(path.sep, 'tmp', 'caller')
  assert.deepEqual(
    parseReleasePackageArguments(['web', '--tag', tag, '--output', 'out'], cwd),
    { command: 'web', outputPath: path.join(cwd, 'out'), tag },
  )
  assert.deepEqual(
    parseReleasePackageArguments(['server', '--tag', tag, '--output', '/out'], cwd),
    { command: 'server', outputPath: '/out', tag },
  )
  assert.deepEqual(
    parseReleasePackageArguments([
      'smoke-server',
      '--tag',
      tag,
      '--archive',
      'server.tar.gz',
    ], cwd),
    {
      archivePath: path.join(cwd, 'server.tar.gz'),
      command: 'smoke-server',
      tag,
    },
  )

  for (const argv of [
    [],
    ['web', '--tag', 'v1.2', '--output', 'out'],
    ['web', '--output', 'out', '--tag', tag],
    ['server', '--tag', tag],
    ['smoke-server', '--tag', tag, '--output', 'out'],
    ['unknown', '--tag', tag, '--output', 'out'],
  ]) {
    assert.throws(() => parseReleasePackageArguments(argv, cwd))
  }
})

test('公开函数精确拒绝未知 input key 且零副作用', async (t) => {
  const fixture = await createSandbox(t)
  const harness = createDependencies(fixture)
  const invalidPackageInput = {
    outputDirectory: fixture.outputRoot,
    tag,
    token: 'must-not-propagate',
  }
  const invalidSmokeInput = {
    archivePath: path.join(fixture.sandbox, 'archive.tar.gz'),
    databaseUrl,
    tag,
    token: 'must-not-propagate',
  }

  await assert.rejects(packageWeb(invalidPackageInput, harness.dependencies))
  await assert.rejects(packageServer(invalidPackageInput, harness.dependencies))
  await assert.rejects(smokeServerArchive(invalidSmokeInput, harness.dependencies))
  assert.deepEqual(harness.calls, [])
  assert.deepEqual(harness.processGroup.calls, [])
})

test('Web tree 返回 portable 排序冻结快照并要求非空 index.html', async (t) => {
  const fixture = await createSandbox(t)
  const root = path.join(fixture.sandbox, 'web-tree')
  await createWebTree(root)
  const harness = createDependencies(fixture)

  const entries = await validateReleaseTree(root, webPolicy(), harness.dependencies)

  assert.equal(Object.isFrozen(entries), true)
  assert.ok(entries.every(Object.isFrozen))
  assert.deepEqual(entries.map(entry => entry.path), [
    'assets',
    'assets/app.js',
    'index.html',
  ])
  assert.deepEqual(entries.map(entry => entry.type), [
    'directory',
    'file',
    'file',
  ])

  await fs.writeFile(path.join(root, 'index.html'), '')
  await assert.rejects(validateReleaseTree(root, webPolicy(), harness.dependencies))
})

test('tree 只要求关键运行文件非空，允许普通零字节文件', async (t) => {
  const fixture = await createSandbox(t)
  const root = path.join(fixture.sandbox, 'web-tree')
  await createWebTree(root)
  await fs.writeFile(path.join(root, 'assets', 'empty.css'), '')
  const harness = createDependencies(fixture)

  const entries = await validateReleaseTree(
    root,
    webPolicy(),
    harness.dependencies,
  )

  assert.deepEqual(
    entries.find(entry => entry.path === 'assets/empty.css'),
    { path: 'assets/empty.css', size: 0, type: 'file' },
  )
})

test('tree portable 排序不依赖主机 locale collation', async (t) => {
  const fixture = await createSandbox(t)
  const root = path.join(fixture.sandbox, 'web-tree')
  await createWebTree(root)
  await fs.writeFile(path.join(root, 'z.txt'), 'z\n')
  await fs.writeFile(path.join(root, 'ä.txt'), 'a-umlaut\n')
  const harness = createDependencies(fixture)

  const entries = await validateReleaseTree(
    root,
    webPolicy(),
    harness.dependencies,
  )

  assert.deepEqual(entries.map(entry => entry.path), [
    'assets',
    'assets/app.js',
    'index.html',
    'z.txt',
    'ä.txt',
  ])
})

test('Web tree 拒绝 symlink、禁止目录、环境文件、日志与 portable alias', async (t) => {
  for (const mutation of [
    'symlink',
    'node_modules',
    'src',
    '.env.production',
    'runtime.log',
    'case-alias',
    'unicode-alias',
  ]) {
    await t.test(mutation, async (nestedT) => {
      const fixture = await createSandbox(nestedT)
      const root = path.join(fixture.sandbox, 'web-tree')
      await createWebTree(root)
      let fileSystem = fs
      if (mutation === 'symlink') {
        await fs.symlink('index.html', path.join(root, 'linked.html'))
      } else if (mutation === 'case-alias') {
        // macOS 默认文件系统会折叠大小写；通过受控目录快照模拟跨平台归档输入。
        fileSystem = {
          async lstat(entryPath) {
            return fs.lstat(
              entryPath === path.join(root, 'INDEX.HTML')
                ? path.join(root, 'index.html')
                : entryPath,
            )
          },
          async readdir(directory) {
            const names = await fs.readdir(directory)
            return directory === root ? [...names, 'INDEX.HTML'] : names
          },
        }
      } else if (mutation === 'unicode-alias') {
        await fs.writeFile(path.join(root, 'é.txt'), 'one\n')
        fileSystem = {
          async lstat(entryPath) {
            return fs.lstat(
              entryPath === path.join(root, 'é.txt')
                ? path.join(root, 'é.txt')
                : entryPath,
            )
          },
          async readdir(directory) {
            const names = await fs.readdir(directory)
            return directory === root ? [...names, 'é.txt'] : names
          },
        }
      } else if (mutation.includes('.')) {
        await fs.writeFile(path.join(root, mutation), 'secret\n')
      } else {
        await fs.mkdir(path.join(root, mutation))
        await fs.writeFile(path.join(root, mutation, 'file.js'), 'unsafe\n')
      }
      const harness = createDependencies(fixture)
      await assert.rejects(
        validateReleaseTree(root, webPolicy(), {
          ...harness.dependencies,
          fileSystem,
        }),
      )
    })
  }
})

test('Web tree 拒绝真实 FIFO 与 Unix socket 特殊文件', async (t) => {
  const fixture = await createSandbox(t)
  // Darwin 的 Unix socket 地址长度很短，使用短路径才能创建真实 socket 节点。
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qsdms-special-'))
  t.after(() => fs.rm(root, { force: true, recursive: true }))
  await createWebTree(root)
  const fifoPath = path.join(root, 'unsafe.fifo')
  const fifo = spawnSync('mkfifo', [fifoPath])
  assert.equal(fifo.status, 0)
  const harness = createDependencies(fixture)
  await assert.rejects(validateReleaseTree(root, webPolicy(), harness.dependencies))
  await fs.rm(fifoPath)

  const socketPath = path.join(root, 'unsafe.socket')
  const server = net.createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, resolve)
  })
  try {
    await assert.rejects(
      validateReleaseTree(root, webPolicy(), harness.dependencies),
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('Server tree 接受内部 pnpm symlink 并要求完整 runtime/migration 边界', async (t) => {
  const fixture = await createSandbox(t)
  const root = path.join(fixture.sandbox, 'server-tree')
  await createServerTree(root)
  const harness = createDependencies(fixture)

  const entries = await validateReleaseTree(root, serverPolicy(), harness.dependencies)

  assert.ok(entries.some(entry =>
    entry.path === 'node_modules/fixture'
    && entry.type === 'symlink',
  ))
  assert.ok(entries.some(entry => entry.path === 'dist/main.js'))
  assert.ok(entries.some(entry => entry.path.endsWith('/migration.sql')))
})

test('Server tree 拒绝逃逸/断裂 symlink、Prisma CLI、测试与敏感文件', async (t) => {
  for (const mutation of [
    'escape-symlink',
    'broken-symlink',
    'node_modules/prisma',
    'node_modules/.bin/prisma',
    'dist/main.spec.js',
    '.env',
    'runtime.log',
  ]) {
    await t.test(mutation, async (nestedT) => {
      const fixture = await createSandbox(nestedT)
      const root = path.join(fixture.sandbox, 'server-tree')
      await createServerTree(root)
      if (mutation === 'escape-symlink') {
        await fs.symlink(
          fixture.sandbox,
          path.join(root, 'node_modules', 'escape'),
          'dir',
        )
      } else if (mutation === 'broken-symlink') {
        await fs.symlink(
          'missing-package',
          path.join(root, 'node_modules', 'broken'),
          'dir',
        )
      } else {
        const target = path.join(root, mutation)
        await fs.mkdir(path.dirname(target), { recursive: true })
        await fs.writeFile(target, 'unsafe\n')
      }
      const harness = createDependencies(fixture)
      await assert.rejects(
        validateReleaseTree(root, serverPolicy(), harness.dependencies),
      )
    })
  }
})

test('archive inspector 接受 exact Web tree 并返回排序冻结 entries', async (t) => {
  const fixture = await createSandbox(t)
  const archivePath = path.join(fixture.sandbox, 'web.tar.gz')
  await fs.writeFile(archivePath, createTarGzip([
    { path: 'qsmds-web-v1.2.3/', type: '5' },
    { path: 'qsmds-web-v1.2.3/assets/', type: '5' },
    { path: 'qsmds-web-v1.2.3/assets/app.js', contents: 'app\n' },
    { path: 'qsmds-web-v1.2.3/index.html', contents: '<html>\n' },
  ]))
  const harness = createDependencies(fixture)

  const entries = await inspectTarGzipArchive(
    archivePath,
    webPolicy(),
    harness.dependencies,
  )

  assert.equal(Object.isFrozen(entries), true)
  assert.ok(entries.every(Object.isFrozen))
  assert.deepEqual(entries.map(entry => entry.path), [
    'qsmds-web-v1.2.3',
    'qsmds-web-v1.2.3/assets',
    'qsmds-web-v1.2.3/assets/app.js',
    'qsmds-web-v1.2.3/index.html',
  ])
})

test('archive inspector 在解压前拒绝 traversal、重复、hardlink、特殊类型与坏 checksum', async (t) => {
  const maliciousCases = [
    [{ path: '/absolute.txt', contents: 'x' }],
    [{ path: 'qsmds-web-v1.2.3/../escape.txt', contents: 'x' }],
    [
      { path: 'qsmds-web-v1.2.3/A.txt', contents: 'x' },
      { path: 'qsmds-web-v1.2.3/a.txt', contents: 'y' },
    ],
    [{ path: 'qsmds-web-v1.2.3/link', type: '1', linkTarget: 'target' }],
    [{ path: 'qsmds-web-v1.2.3/fifo', type: '6' }],
    [{ path: 'qsmds-web-v1.2.3/long', type: 'L', contents: 'name\0' }],
  ]

  for (const [index, entries] of maliciousCases.entries()) {
    const fixture = await createSandbox(t)
    const archivePath = path.join(fixture.sandbox, `malicious-${index}.tar.gz`)
    await fs.writeFile(archivePath, createTarGzip(entries))
    const harness = createDependencies(fixture)
    await assert.rejects(
      inspectTarGzipArchive(archivePath, webPolicy(), harness.dependencies),
    )
  }

  const fixture = await createSandbox(t)
  const corruptPath = path.join(fixture.sandbox, 'corrupt.tar.gz')
  await fs.writeFile(corruptPath, createTarGzip([
    { path: 'qsmds-web-v1.2.3/index.html', contents: 'x' },
  ], { corruptChecksum: true }))
  const harness = createDependencies(fixture)
  await assert.rejects(
    inspectTarGzipArchive(corruptPath, webPolicy(), harness.dependencies),
  )
})

test('archive inspector 拒绝越界 PAX path 与 Server symlink linkpath', async (t) => {
  const cases = [
    {
      policy: webPolicy(),
      entries: [
        { path: 'PaxHeaders/file', type: 'x', contents: paxRecord('path', '../escape') },
        { path: 'qsmds-web-v1.2.3/file', contents: 'x' },
      ],
    },
    {
      policy: serverPolicy(),
      entries: [
        {
          path: 'PaxHeaders/link',
          type: 'x',
          contents: paxRecord('linkpath', '../../../../escape'),
        },
        {
          path: 'qsmds-server-v1.2.3-linux-x64/node_modules/pkg',
          type: '2',
          linkTarget: 'safe',
        },
      ],
    },
  ]
  for (const [index, fixtureCase] of cases.entries()) {
    const fixture = await createSandbox(t)
    const archivePath = path.join(fixture.sandbox, `pax-${index}.tar.gz`)
    await fs.writeFile(archivePath, createTarGzip(fixtureCase.entries))
    const harness = createDependencies(fixture)
    await assert.rejects(
      inspectTarGzipArchive(
        archivePath,
        fixtureCase.policy,
        harness.dependencies,
      ),
    )
  }
})

test('archive inspector 拒绝非 POSIX header、可变身份元数据与非 block 对齐尾部', async (t) => {
  const cases = [
    {
      label: 'magic',
      expected: /POSIX/u,
      entries: [
        { path: 'qsmds-web-v1.2.3/', type: '5', magic: 'legacy' },
        { path: 'qsmds-web-v1.2.3/index.html', contents: '<html>\n' },
      ],
    },
    {
      label: 'version',
      expected: /POSIX/u,
      entries: [
        { path: 'qsmds-web-v1.2.3/', type: '5', version: '01' },
        { path: 'qsmds-web-v1.2.3/index.html', contents: '<html>\n' },
      ],
    },
    {
      label: 'metadata',
      expected: /metadata/u,
      entries: [
        { path: 'qsmds-web-v1.2.3/', type: '5' },
        {
          path: 'qsmds-web-v1.2.3/index.html',
          contents: '<html>\n',
          gid: 42,
          mtime: 1,
          uid: 42,
        },
      ],
    },
  ]
  for (const fixtureCase of cases) {
    const fixture = await createSandbox(t)
    const archivePath = path.join(
      fixture.sandbox,
      `${fixtureCase.label}.tar.gz`,
    )
    await fs.writeFile(archivePath, createTarGzip(fixtureCase.entries))
    const harness = createDependencies(fixture)
    await assert.rejects(
      inspectTarGzipArchive(archivePath, webPolicy(), harness.dependencies),
      fixtureCase.expected,
    )
  }

  const fixture = await createSandbox(t)
  const archivePath = path.join(fixture.sandbox, 'misaligned.tar.gz')
  const validArchive = createTarGzip([
    { path: 'qsmds-web-v1.2.3/', type: '5' },
    { path: 'qsmds-web-v1.2.3/index.html', contents: '<html>\n' },
  ])
  await fs.writeFile(
    archivePath,
    gzipSync(gunzipSync(validArchive).subarray(0, -1), { level: 9, mtime: 0 }),
  )
  const harness = createDependencies(fixture)
  await assert.rejects(
    inspectTarGzipArchive(archivePath, webPolicy(), harness.dependencies),
    /block-aligned/u,
  )
})

test('archive inspector 拒绝通过 symlink ancestor 写入的 Server member', async (t) => {
  const fixture = await createSandbox(t)
  const archivePath = path.join(fixture.sandbox, 'symlink-ancestor.tar.gz')
  const top = 'qsmds-server-v1.2.3-linux-x64'
  await fs.writeFile(archivePath, createTarGzip([
    { path: `${top}/`, type: '5' },
    { path: `${top}/dist/`, type: '5' },
    { path: `${top}/dist/main.js`, contents: 'main\n' },
    { path: `${top}/node_modules/`, type: '5' },
    { path: `${top}/node_modules/.pnpm/`, type: '5' },
    { path: `${top}/node_modules/.pnpm/pkg/`, type: '5' },
    {
      path: `${top}/node_modules/alias`,
      type: '2',
      linkTarget: '.pnpm/pkg',
    },
    { path: `${top}/node_modules/alias/injected.js`, contents: 'unsafe\n' },
    { path: `${top}/pnpm-lock.yaml`, contents: 'lock\n' },
    { path: `${top}/prisma/`, type: '5' },
    { path: `${top}/prisma/schema.prisma`, contents: 'schema\n' },
    { path: `${top}/prisma/migrations/`, type: '5' },
    {
      path: `${top}/prisma/migrations/migration_lock.toml`,
      contents: 'lock\n',
    },
    { path: `${top}/prisma/migrations/20260713000000_init/`, type: '5' },
    {
      path: `${top}/prisma/migrations/20260713000000_init/migration.sql`,
      contents: 'SELECT 1;\n',
    },
  ]))
  const harness = createDependencies(fixture)

  await assert.rejects(
    inspectTarGzipArchive(archivePath, serverPolicy(), harness.dependencies),
    /ancestor/u,
  )
})

function createPackagingRunner({ serverDeploySource, calls }) {
  return async (command, args, options) => {
    calls.push([command, args, options])
    if (command === 'pnpm') {
      await fs.cp(serverDeploySource, args.at(-1), {
        recursive: true,
        verbatimSymlinks: true,
      })
      return
    }
    assert.equal(command, 'tar')
    const archivePath = args[args.indexOf('--file') + 1]
    const topLevelName = args.at(-1)
    const topLevelRoot = path.join(options.cwd, topLevelName)
    const entries = await entriesFromTree(topLevelRoot, topLevelName)
    await fs.writeFile(archivePath, createTarGzip(entries))
  }
}

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
  const baseRun = createPackagingRunner({
    calls,
    serverDeploySource: deploySource,
  })
  return { baseRun, calls, deploySource, fixture, output }
}

async function createWebPackagingFixture(t) {
  const fixture = await createSandbox(t)
  const sourceRoot = path.join(
    fixture.repositoryRoot,
    'web',
    'apps',
    'qsmds-arco',
    'dist',
  )
  await createWebTree(sourceRoot)
  return {
    fixture,
    output: path.join(fixture.outputRoot, 'web-package'),
    sourceRoot,
  }
}

test('ReleasePackageStageError 只接受白名单 code 并保留安全退出码', () => {
  assert.deepEqual(RELEASE_PACKAGE_FAILURE_CODES, {
    archiveCreate: 'RELEASE_PACKAGE_ARCHIVE_CREATE_FAILED',
    archiveDigest: 'RELEASE_PACKAGE_ARCHIVE_DIGEST_FAILED',
    archiveInspect: 'RELEASE_PACKAGE_ARCHIVE_INSPECT_FAILED',
    outputPrepare: 'RELEASE_PACKAGE_OUTPUT_PREPARE_FAILED',
    serverDeploy: 'RELEASE_PACKAGE_SERVER_DEPLOY_FAILED',
    serverPrune: 'RELEASE_PACKAGE_SERVER_PRUNE_FAILED',
    serverSmoke: 'RELEASE_PACKAGE_SERVER_SMOKE_FAILED',
    stageCleanup: 'RELEASE_PACKAGE_STAGE_CLEANUP_FAILED',
    stageCreate: 'RELEASE_PACKAGE_STAGE_CREATE_FAILED',
    stageValidate: 'RELEASE_PACKAGE_STAGE_VALIDATE_FAILED',
    unknown: 'RELEASE_PACKAGE_UNKNOWN_FAILED',
  })
  assert.equal(Object.isFrozen(RELEASE_PACKAGE_FAILURE_CODES), true)

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

test('ReleasePackageStageError 安全归一异常命令退出码', async (t) => {
  const secret = 'command-exit-code-getter-secret'
  const trustedCommandError = new CommandExecutionError('Command failed: pnpm', 7)
  Reflect.set(trustedCommandError, 'exitCode', -99)
  const forgedPositiveCommandError = Object.assign(
    new Error('forged positive command failure'),
    { exitCode: 7 },
  )
  Object.setPrototypeOf(
    forgedPositiveCommandError,
    CommandExecutionError.prototype,
  )
  const forgedOutOfRangeCommandError = Object.assign(
    new Error('forged out-of-range command failure'),
    { exitCode: 256 },
  )
  Object.setPrototypeOf(
    forgedOutOfRangeCommandError,
    CommandExecutionError.prototype,
  )
  let throwingExitCodeReadCount = 0
  const throwingExitCodeError = new Error('forged getter command failure')
  Object.defineProperty(throwingExitCodeError, 'exitCode', {
    get() {
      throwingExitCodeReadCount += 1
      throw new Error(secret)
    },
  })
  Object.setPrototypeOf(throwingExitCodeError, CommandExecutionError.prototype)
  const throwingInstanceofError = new Proxy({}, {
    getPrototypeOf() {
      throw new Error(secret)
    },
  })

  for (const fixtureCase of [
    {
      cause: trustedCommandError,
      exitCode: 7,
      label: 'trusted snapshot ignores external mutation',
    },
    {
      cause: forgedPositiveCommandError,
      exitCode: 1,
      label: 'forged positive exitCode',
    },
    {
      cause: forgedOutOfRangeCommandError,
      exitCode: 1,
      label: 'forged 256 exitCode',
    },
    {
      cause: throwingExitCodeError,
      exitCode: 1,
      label: 'throwing exitCode getter',
      readCount: () => throwingExitCodeReadCount,
    },
    {
      cause: throwingInstanceofError,
      exitCode: 1,
      label: 'throwing instanceof check',
    },
  ]) {
    await t.test(fixtureCase.label, () => {
      let failure
      assert.doesNotThrow(() => {
        failure = new ReleasePackageStageError(
          RELEASE_PACKAGE_FAILURE_CODES.serverDeploy,
          fixtureCase.cause,
        )
      })
      assert.equal(failure.exitCode, fixtureCase.exitCode)
      assert.equal(fixtureCase.readCount?.() ?? 0, 0)
    })
  }
})

test('packageServer 将 pnpm deploy 首错分类且保留退出码', async (t) => {
  const context = await createServerPackagingFixture(t)
  const commandCause = new CommandExecutionError('Command failed: pnpm', 9)
  const harness = createDependencies(context.fixture, {
    async run(command) {
      assert.equal(command, 'pnpm')
      throw commandCause
    },
  })

  await assert.rejects(
    packageServer(
      { outputDirectory: context.output, tag },
      harness.dependencies,
    ),
    error => (
      error instanceof ReleasePackageStageError
      && error.code === RELEASE_PACKAGE_FAILURE_CODES.serverDeploy
      && error.cause === commandCause
      && error.exitCode === 9
    ),
  )
})

test('packageServer 将外部阶段错误按 deploy 边界重新分类', async (t) => {
  const context = await createServerPackagingFixture(t)
  const externalStageError = new ReleasePackageStageError(
    RELEASE_PACKAGE_FAILURE_CODES.archiveDigest,
    new Error('external-stage-error'),
  )
  const harness = createDependencies(context.fixture, {
    async run(command) {
      assert.equal(command, 'pnpm')
      throw externalStageError
    },
  })

  await assert.rejects(
    packageServer(
      { outputDirectory: context.output, tag },
      harness.dependencies,
    ),
    error => (
      error instanceof ReleasePackageStageError
      && error.code === RELEASE_PACKAGE_FAILURE_CODES.serverDeploy
      && error.cause === externalStageError
    ),
  )
})

test('packageServer 对每个 packaging 边界返回固定阶段 code', async (t) => {
  const cases = [
    {
      code: RELEASE_PACKAGE_FAILURE_CODES.outputPrepare,
      label: 'output prepare',
      overrides(context, cause) {
        return {
          fileSystem: fileSystemWith({
            async lstat(target) {
              if (target === context.output) {
                throw cause
              }
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
          fileSystem: fileSystemWith({
            async mkdtemp() {
              throw cause
            },
          }),
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
              if (target.endsWith('/node_modules/prisma')) {
                throw cause
              }
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
              // Server packaging 不预校验源码；这个 basename 只命中 deploy 后的 staging root。
              if (path.basename(target).startsWith('qsmds-server-')) {
                throw cause
              }
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
            if (command === 'tar') {
              throw cause
            }
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
              // finalizeArchive 第一次读取 archive 属于安全检查阶段。
              if (target.endsWith('.tar.gz') && archiveReads++ === 0) {
                throw cause
              }
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
              // archive 通过 inspector 后的第二次读取才进入 digest 阶段。
              if (target.endsWith('.tar.gz') && archiveReads++ === 1) {
                throw cause
              }
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
    await t.test(fixtureCase.label, async (nestedT) => {
      const context = await createServerPackagingFixture(nestedT)
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

test('packageServer cleanup 不覆盖主错误且唯一 cleanup 错误删除 archive', async (t) => {
  const primaryContext = await createServerPackagingFixture(t)
  const primaryCause = new Error('archive-create-primary-canary')
  const primaryCleanupCause = new Error('stage-cleanup-secondary-canary')
  let primaryCleanupCalls = 0
  const primaryCleanupFileSystem = fileSystemWith({
    async rm(target, options) {
      if (path.basename(target).startsWith('qianshu-release-stage-')) {
        primaryCleanupCalls += 1
        throw primaryCleanupCause
      }
      return fs.rm(target, options)
    },
  })
  const primaryHarness = createDependencies(primaryContext.fixture, {
    fileSystem: primaryCleanupFileSystem,
    async run(command, args, options) {
      if (command === 'tar') {
        throw primaryCause
      }
      return primaryContext.baseRun(command, args, options)
    },
  })

  await assert.rejects(
    packageServer(
      { outputDirectory: primaryContext.output, tag },
      primaryHarness.dependencies,
    ),
    error => (
      error instanceof ReleasePackageStageError
      && error.code === RELEASE_PACKAGE_FAILURE_CODES.archiveCreate
      && error.cause === primaryCause
    ),
  )
  assert.equal(primaryCleanupCalls, 1)

  const cleanupContext = await createServerPackagingFixture(t)
  const cleanupCause = new Error('stage-cleanup-only-canary')
  let cleanupCalls = 0
  const cleanupFileSystem = fileSystemWith({
    async rm(target, options) {
      if (path.basename(target).startsWith('qianshu-release-stage-')) {
        cleanupCalls += 1
        throw cleanupCause
      }
      return fs.rm(target, options)
    },
  })
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
      error instanceof ReleasePackageStageError
      && error.code === RELEASE_PACKAGE_FAILURE_CODES.stageCleanup
      && error.cause === cleanupCause
    ),
  )
  assert.equal(cleanupCalls, 1)
  await assert.rejects(
    fs.lstat(path.join(
      cleanupContext.output,
      'qsmds-server-v1.2.3-linux-x64.tar.gz',
    )),
    { code: 'ENOENT' },
  )
})

test('packageWeb 将 source validation 与 copy 的外部阶段错误归一 unknown', async (t) => {
  const cases = [
    {
      fileSystem(context, cause) {
        return fileSystemWith({
          async lstat(target) {
            if (target === context.sourceRoot) {
              throw cause
            }
            return fs.lstat(target)
          },
        })
      },
      label: 'source validation',
    },
    {
      fileSystem(_context, cause) {
        return fileSystemWith({
          async cp() {
            throw cause
          },
        })
      },
      label: 'copy',
    },
  ]

  for (const fixtureCase of cases) {
    await t.test(fixtureCase.label, async (nestedT) => {
      const context = await createWebPackagingFixture(nestedT)
      const externalStageError = new ReleasePackageStageError(
        RELEASE_PACKAGE_FAILURE_CODES.archiveDigest,
        new Error(`external-web-stage-${fixtureCase.label}`),
      )
      const harness = createDependencies(context.fixture, {
        fileSystem: fixtureCase.fileSystem(context, externalStageError),
        async run() {
          assert.fail('Web failure must happen before tar')
        },
      })

      await assert.rejects(
        packageWeb(
          { outputDirectory: context.output, tag },
          harness.dependencies,
        ),
        error => (
          error instanceof ReleasePackageStageError
          && error.code === RELEASE_PACKAGE_FAILURE_CODES.unknown
          && error.cause === externalStageError
        ),
      )
    })
  }
})

test('release package reporter 只输出内部白名单 code', () => {
  const secret = 'postgresql://user:password@host/database?token=secret'
  const stderrCalls = []
  const processRef = { exitCode: 0 }
  const consoleRef = {
    error(...values) {
      stderrCalls.push(values)
    },
  }
  const failure = new ReleasePackageStageError(
    RELEASE_PACKAGE_FAILURE_CODES.archiveInspect,
    new Error(secret),
  )

  applyReleasePackageFailure(failure, processRef, consoleRef)
  assert.equal(processRef.exitCode, 1)
  assert.equal(stderrCalls.length, 1)
  assert.equal(stderrCalls[0].length, 1)
  assert.equal(typeof stderrCalls[0][0], 'string')
  assert.equal(
    stderrCalls[0][0],
    'Release package failed [code=RELEASE_PACKAGE_ARCHIVE_INSPECT_FAILED]',
  )
  assert.equal(
    stderrCalls.flat().some(value => String(value).includes(secret)),
    false,
  )

  stderrCalls.length = 0
  processRef.exitCode = 0
  applyReleasePackageFailure(
    { code: 'RELEASE_PACKAGE_SERVER_DEPLOY_FAILED', message: secret },
    processRef,
    consoleRef,
  )
  assert.equal(processRef.exitCode, 1)
  assert.equal(stderrCalls.length, 1)
  assert.equal(stderrCalls[0].length, 1)
  assert.equal(typeof stderrCalls[0][0], 'string')
  assert.equal(
    stderrCalls[0][0],
    'Release package failed [code=RELEASE_PACKAGE_UNKNOWN_FAILED]',
  )
  assert.equal(
    stderrCalls.flat().some(value => String(value).includes(secret)),
    false,
  )
})

test('release package reporter 拒绝伪造阶段错误原型', () => {
  const secretCanary = 'forged-stage-code-secret-canary'
  const forgedFailure = Object.assign(
    Object.create(ReleasePackageStageError.prototype),
    { code: secretCanary, exitCode: -99 },
  )
  const stderrCalls = []
  const processRef = { exitCode: 0 }
  const consoleRef = {
    error(...values) {
      stderrCalls.push(values)
    },
  }

  applyReleasePackageFailure(forgedFailure, processRef, consoleRef)

  assert.deepEqual({
    exitCode: processRef.exitCode,
    leaked: stderrCalls.flat().some(value =>
      String(value).includes(secretCanary)),
    stderrCalls,
  }, {
    exitCode: 1,
    leaked: false,
    stderrCalls: [[
      'Release package failed [code=RELEASE_PACKAGE_UNKNOWN_FAILED]',
    ]],
  })
})

test('release package reporter 安全归一命令错误退出码', async (t) => {
  const secret = 'command-reporter-secret-canary'
  const trustedCommandError = new CommandExecutionError('Command failed: pnpm', 7)
  Reflect.set(trustedCommandError, 'exitCode', -99)
  const forgedCommandError = Object.assign(
    new Error('forged positive command reporter failure'),
    { exitCode: 7 },
  )
  Object.setPrototypeOf(forgedCommandError, CommandExecutionError.prototype)
  const forgedOutOfRangeCommandError = Object.assign(
    new Error('forged out-of-range command reporter failure'),
    { exitCode: 256 },
  )
  Object.setPrototypeOf(
    forgedOutOfRangeCommandError,
    CommandExecutionError.prototype,
  )
  let throwingExitCodeReadCount = 0
  const throwingExitCodeError = new Error('forged getter command reporter failure')
  Object.defineProperty(throwingExitCodeError, 'exitCode', {
    get() {
      throwingExitCodeReadCount += 1
      throw new Error(secret)
    },
  })
  Object.setPrototypeOf(throwingExitCodeError, CommandExecutionError.prototype)
  const throwingInstanceofError = new Proxy({}, {
    getPrototypeOf() {
      throw new Error(secret)
    },
  })

  for (const fixtureCase of [
    { error: forgedCommandError, exitCode: 1, label: 'forged positive prototype' },
    {
      error: forgedOutOfRangeCommandError,
      exitCode: 1,
      label: 'forged 256 prototype',
    },
    {
      error: trustedCommandError,
      exitCode: 7,
      label: 'trusted snapshot ignores external mutation',
    },
    {
      error: throwingExitCodeError,
      exitCode: 1,
      label: 'throwing exitCode getter',
      readCount: () => throwingExitCodeReadCount,
    },
    { error: throwingInstanceofError, exitCode: 1, label: 'throwing instanceof check' },
    {
      error: new CommandExecutionError('Command failed: pnpm', 7),
      exitCode: 7,
      label: 'valid real exitCode',
    },
  ]) {
    await t.test(fixtureCase.label, () => {
      const stderrCalls = []
      const processRef = { exitCode: 0 }
      const consoleRef = {
        error(...values) {
          stderrCalls.push(values)
        },
      }

      assert.doesNotThrow(() => {
        applyReleasePackageFailure(
          fixtureCase.error,
          processRef,
          consoleRef,
        )
      })
      assert.equal(processRef.exitCode, fixtureCase.exitCode)
      assert.equal(fixtureCase.readCount?.() ?? 0, 0)
      assert.deepEqual(stderrCalls, [[
        'Release package failed [code=RELEASE_PACKAGE_UNKNOWN_FAILED]',
      ]])
      assert.equal(
        stderrCalls.flat().some(value => String(value).includes(secret)),
        false,
      )
    })
  }
})

test('packageWeb 构建 exact staging、固定 GNU tar argv 与确定性 archive', async (t) => {
  const fixture = await createSandbox(t)
  const distRoot = path.join(
    fixture.repositoryRoot,
    'web',
    'apps',
    'qsmds-arco',
    'dist',
  )
  await createWebTree(distRoot)
  const outputOne = path.join(fixture.outputRoot, 'web-one')
  const outputTwo = path.join(fixture.outputRoot, 'web-two')
  const calls = []
  const run = createPackagingRunner({ calls })
  const harness = createDependencies(fixture, { run })

  const first = await packageWeb(
    { outputDirectory: outputOne, tag },
    harness.dependencies,
  )
  const second = await packageWeb(
    { outputDirectory: outputTwo, tag },
    harness.dependencies,
  )

  assert.deepEqual(
    await fs.readFile(first.archivePath),
    await fs.readFile(second.archivePath),
  )
  assert.equal(first.sha256, second.sha256)
  assert.equal(first.size, (await fs.lstat(first.archivePath)).size)
  assert.deepEqual(calls[0][1].slice(0, 13), [
    '--create',
    '--gzip',
    '--file',
    first.archivePath,
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--format=posix',
    '--pax-option=delete=atime,delete=ctime',
    '--hard-dereference',
    'qsmds-web-v1.2.3',
  ])
  const gzip = await fs.readFile(first.archivePath)
  assert.equal(gzip.readUInt32LE(4), 0)
  assert.equal(gzip[3] & 0x18, 0)
  assert.equal(
    first.sha256,
    createHash('sha256').update(gzip).digest('hex'),
  )
})

test('packageServer 非 linux/x64 fail-closed；Linux 使用精确 pnpm deploy', async (t) => {
  const fixture = await createSandbox(t)
  const deploySource = path.join(fixture.sandbox, 'deploy-source')
  await createServerTree(deploySource)
  const prismaCliStore = path.join(
    deploySource,
    'node_modules',
    '.pnpm',
    'prisma@7.8.0',
    'node_modules',
    'prisma',
  )
  await fs.mkdir(prismaCliStore, { recursive: true })
  await fs.writeFile(path.join(prismaCliStore, 'index.js'), 'cli\n')
  await fs.symlink(
    path.join('.pnpm', 'prisma@7.8.0', 'node_modules', 'prisma'),
    path.join(deploySource, 'node_modules', 'prisma'),
    'dir',
  )
  await fs.symlink(
    path.join('..', 'prisma', 'index.js'),
    path.join(deploySource, 'node_modules', '.bin', 'prisma'),
  )
  const publishedDependency = path.join(
    deploySource,
    'node_modules',
    '.pnpm',
    'p@1.0.0',
    'node_modules',
    'p',
  )
  await fs.mkdir(path.join(publishedDependency, 'test'), { recursive: true })
  await fs.mkdir(path.join(publishedDependency, 'lib'), { recursive: true })
  await fs.writeFile(
    path.join(publishedDependency, 'test', 'index.js'),
    'dependency test\n',
  )
  await fs.writeFile(
    path.join(publishedDependency, 'lib', 'unit.test.js.map'),
    '{}\n',
  )
  const output = await fs.mkdtemp(path.join(fixture.outputRoot, 'server-'))
  const calls = []
  const run = createPackagingRunner({ calls, serverDeploySource: deploySource })

  const darwinHarness = createDependencies(fixture, {
    arch: 'arm64',
    platform: 'darwin',
    run,
  })
  await assert.rejects(
    packageServer({ outputDirectory: output, tag }, darwinHarness.dependencies),
  )
  assert.deepEqual(calls, [])

  const linuxHarness = createDependencies(fixture, { run })
  const result = await packageServer(
    { outputDirectory: output, tag },
    linuxHarness.dependencies,
  )
  assert.deepEqual(calls[0][0], 'pnpm')
  assert.deepEqual(calls[0][1].slice(0, 7), [
    '-C',
    'server',
    '--filter',
    '@qianshu-dms/server',
    '--prod',
    'deploy',
    calls[0][1][6],
  ])
  const tarCall = calls.find(([command]) => command === 'tar')
  assert.ok(tarCall)
  assert.deepEqual(tarCall[1].slice(-2), [
    '--hard-dereference',
    'qsmds-server-v1.2.3-linux-x64',
  ])
  assert.equal(path.basename(result.archivePath),
    'qsmds-server-v1.2.3-linux-x64.tar.gz')
})

test('package 失败会删除 staging 与半成品 archive', async (t) => {
  const fixture = await createSandbox(t)
  const distRoot = path.join(
    fixture.repositoryRoot,
    'web',
    'apps',
    'qsmds-arco',
    'dist',
  )
  await createWebTree(distRoot)
  const output = path.join(fixture.outputRoot, 'failed-web')
  let tarCalled = false
  const harness = createDependencies(fixture, {
    async run(command, args) {
      assert.equal(command, 'tar')
      tarCalled = true
      await fs.writeFile(args[args.indexOf('--file') + 1], 'partial archive')
    },
  })

  await assert.rejects(
    packageWeb({ outputDirectory: output, tag }, harness.dependencies),
  )
  assert.equal(tarCalled, true)
  await assert.rejects(fs.lstat(output), { code: 'ENOENT' })
})

async function createServerArchiveFixture(fixture) {
  const root = path.join(fixture.sandbox, 'server-archive-tree')
  await createServerTree(root)
  const archivePath = path.join(
    fixture.sandbox,
    'qsmds-server-v1.2.3-linux-x64.tar.gz',
  )
  const entries = await entriesFromTree(
    root,
    'qsmds-server-v1.2.3-linux-x64',
  )
  await fs.writeFile(archivePath, createTarGzip(entries))
  return { archivePath, root }
}

test('smoke 先 migration/安全提取，再以净化 env 和动态端口启动 archive', async (t) => {
  const fixture = await createSandbox(t)
  const archive = await createServerArchiveFixture(fixture)
  const calls = []
  const processGroup = createProcessGroup()
  const run = async (command, args, options) => {
    calls.push([command, args, options])
    if (command === 'tar') {
      const extractRoot = args[args.indexOf('--directory') + 1]
      await fs.cp(
        archive.root,
        path.join(extractRoot, 'qsmds-server-v1.2.3-linux-x64'),
        { recursive: true, verbatimSymlinks: true },
      )
    }
  }
  const harness = createDependencies(fixture, { processGroup, run })
  const callerCanaries = {
    APP_ORIGIN: 'https://production.example.com',
    AUTH_USERNAME_HMAC_KEY: 'caller-username-secret',
    AUTH_USER_ID_HMAC_KEY: 'caller-user-id-secret',
    AUTH_IP_HMAC_KEY: 'caller-ip-secret',
  }
  Object.assign(harness.dependencies.env, callerCanaries)

  await smokeServerArchive(
    { archivePath: archive.archivePath, databaseUrl, tag },
    harness.dependencies,
  )

  assert.deepEqual(calls[0].slice(0, 2), [
    'pnpm',
    ['-C', 'server', 'db:migrate:deploy'],
  ])
  assert.equal(calls[1][0], 'tar')
  assert.deepEqual(calls[1][1].slice(0, 3), [
    '--extract',
    '--gzip',
    '--file',
  ])
  const spawnCall = processGroup.calls.find(call => call.type === 'spawn')
  assert.equal(spawnCall.handle.command, process.execPath)
  assert.deepEqual(spawnCall.handle.args, ['dist/main.js'])
  assert.equal(
    path.basename(spawnCall.handle.options.cwd),
    'qsmds-server-v1.2.3-linux-x64',
  )
  const childEnv = spawnCall.handle.options.env
  assert.equal(childEnv.PORT, '41234')
  assert.equal(childEnv.NODE_ENV, 'production')
  assert.equal(childEnv.DOTENV_CONFIG_PATH, '/dev/null')
  assert.equal(childEnv.DATABASE_URL, new URL(databaseUrl).toString())
  assert.equal(Object.hasOwn(childEnv, 'NODE_PATH'), false)
  assert.equal(Object.hasOwn(childEnv, 'DEBUG'), false)
  assert.equal(
    Object.hasOwn(childEnv, 'PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION'),
    false,
  )
  const migrationEnv = calls[0][2].env
  for (const smokeEnv of [migrationEnv, childEnv]) {
    assert.equal(smokeEnv.APP_ORIGIN, smokeAppOrigin)
    const smokeKeys = smokeHmacKeyNames.map(name => smokeEnv[name])
    assert.equal(new Set(smokeKeys).size, smokeHmacKeyNames.length)
    for (const [index, value] of smokeKeys.entries()) {
      assert.match(value, /^[A-Za-z0-9_-]{43}$/u)
      const decoded = Buffer.from(value, 'base64url')
      assert.equal(decoded.length, 32)
      assert.equal(decoded.toString('base64url'), value)
      assert.notEqual(value, callerCanaries[smokeHmacKeyNames[index]])
    }
  }
  assert.deepEqual(
    Object.fromEntries(smokeHmacKeyNames.map(name => [name, migrationEnv[name]])),
    Object.fromEntries(smokeHmacKeyNames.map(name => [name, childEnv[name]])),
  )
  assert.ok(processGroup.calls.some(call => call.type === 'terminate'))
  assert.ok(processGroup.calls.some(call => call.type === 'wait'))
  assert.deepEqual(await fs.readdir(fixture.runnerTemp), [])
})

test('smoke 端口竞争最多重试三次且 health 必须含 request id 与数据库 up', async (t) => {
  const fixture = await createSandbox(t)
  const archive = await createServerArchiveFixture(fixture)
  const processGroup = createProcessGroup([
    { exitCode: 1 },
    undefined,
  ])
  const ports = [41001, 41002]
  let portIndex = 0
  const run = async (command, args) => {
    if (command === 'tar') {
      const extractRoot = args[args.indexOf('--directory') + 1]
      await fs.cp(
        archive.root,
        path.join(extractRoot, 'qsmds-server-v1.2.3-linux-x64'),
        { recursive: true, verbatimSymlinks: true },
      )
    }
  }
  const harness = createDependencies(fixture, {
    processGroup,
    reservePort: async () => ({
      port: ports[portIndex++],
      async close() {},
    }),
    run,
  })

  await smokeServerArchive(
    { archivePath: archive.archivePath, databaseUrl, tag },
    harness.dependencies,
  )
  assert.equal(
    processGroup.calls.filter(call => call.type === 'spawn').length,
    2,
  )
  const spawnCalls = processGroup.calls.filter(call => call.type === 'spawn')
  assert.deepEqual(
    spawnCalls.map(call => call.handle.options.env.PORT),
    ['41001', '41002'],
  )
  for (const name of ['APP_ORIGIN', ...smokeHmacKeyNames]) {
    assert.equal(
      spawnCalls[0].handle.options.env[name],
      spawnCalls[1].handle.options.env[name],
    )
  }

  const invalidHarness = createDependencies(fixture, {
    fetch: async () => response({ requestId: '', body: { status: 'ok' } }),
    run,
  })
  await assert.rejects(
    smokeServerArchive(
      { archivePath: archive.archivePath, databaseUrl, tag },
      invalidHarness.dependencies,
    ),
  )
})

test('smoke 解压失败仍删除本次临时目录', async (t) => {
  const fixture = await createSandbox(t)
  const archive = await createServerArchiveFixture(fixture)
  const harness = createDependencies(fixture, {
    async run(command, args) {
      if (command === 'tar') {
        const extractRoot = args[args.indexOf('--directory') + 1]
        await fs.writeFile(path.join(extractRoot, 'partial'), 'partial\n')
        throw new Error('fixture extract failure')
      }
    },
  })

  await assert.rejects(
    smokeServerArchive(
      { archivePath: archive.archivePath, databaseUrl, tag },
      harness.dependencies,
    ),
  )
  assert.deepEqual(await fs.readdir(fixture.runnerTemp), [])
})

test('smoke 在 extract 前拒绝非空或越界目录且不删除 foreign tree', async (t) => {
  const fixture = await createSandbox(t)
  const archive = await createServerArchiveFixture(fixture)
  const foreignRoot = path.join(fixture.runnerTemp, 'foreign-tree')
  const canaryPath = path.join(foreignRoot, 'canary.txt')
  await fs.mkdir(foreignRoot)
  await fs.writeFile(canaryPath, 'keep\n')
  let tarCalled = false
  const harness = createDependencies(fixture, {
    fileSystem: {
      async mkdtemp() {
        return foreignRoot
      },
    },
    async run(command) {
      if (command === 'tar') {
        tarCalled = true
        throw new Error('tar must not run')
      }
    },
  })

  await assert.rejects(
    smokeServerArchive(
      { archivePath: archive.archivePath, databaseUrl, tag },
      harness.dependencies,
    ),
  )
  assert.equal(tarCalled, false)
  assert.equal(await fs.readFile(canaryPath, 'utf8'), 'keep\n')
})

test('smoke health timeout 与终端信号均终止进程组并清理临时目录', async (t) => {
  for (const scenario of ['timeout', 'SIGINT', 'SIGTERM']) {
    await t.test(scenario, async (nestedT) => {
      const fixture = await createSandbox(nestedT)
      const archive = await createServerArchiveFixture(fixture)
      const processGroup = createProcessGroup()
      const processRef = new EventEmitter()
      let currentTime = 0
      const run = async (command, args) => {
        if (command === 'tar') {
          const extractRoot = args[args.indexOf('--directory') + 1]
          await fs.cp(
            archive.root,
            path.join(extractRoot, 'qsmds-server-v1.2.3-linux-x64'),
            { recursive: true, verbatimSymlinks: true },
          )
        }
      }
      const harness = createDependencies(fixture, {
        fetch: async (_url, options) => {
          if (scenario === 'timeout') {
            throw new Error('not ready')
          }
          assert.ok(options?.signal instanceof AbortSignal)
          return new Promise((resolve, reject) => {
            options.signal.addEventListener(
              'abort',
              () => reject(new Error('aborted by signal')),
              { once: true },
            )
            processRef.emit(scenario)
            void resolve
          })
        },
        now: () => currentTime,
        processGroup,
        processRef,
        run,
        async wait(milliseconds) {
          currentTime += milliseconds
        },
      })

      let failure
      try {
        await smokeServerArchive(
          { archivePath: archive.archivePath, databaseUrl, tag },
          harness.dependencies,
        )
      } catch (error) {
        failure = error
      }
      assert.ok(failure instanceof Error)
      assert.equal(failure.message.includes(databaseUrl), false)
      const termination = processGroup.calls.find(call =>
        call.type === 'terminate')
      assert.equal(
        termination.signal,
        scenario === 'timeout' ? 'SIGTERM' : scenario,
      )
      assert.ok(processGroup.calls.some(call => call.type === 'wait'))
      assert.deepEqual(await fs.readdir(fixture.runnerTemp), [])
      assert.equal(processRef.listenerCount('SIGINT'), 0)
      assert.equal(processRef.listenerCount('SIGTERM'), 0)
    })
  }
})

test('smoke 进程组宽限期超时后升级 SIGKILL 并等待真实终态', async (t) => {
  const fixture = await createSandbox(t)
  const archive = await createServerArchiveFixture(fixture)
  const calls = []
  let fallbackTimer
  let resolveCompletion
  const completion = new Promise(resolve => {
    resolveCompletion = resolve
    fallbackTimer = setTimeout(resolve, 20)
  })
  const processGroup = {
    spawn() {
      const handle = { status: undefined }
      calls.push({ handle, type: 'spawn' })
      return handle
    },
    status(handle) {
      return handle.status
    },
    async terminate(handle, signal) {
      calls.push({ signal, type: 'terminate' })
      if (signal === 'SIGKILL') {
        clearTimeout(fallbackTimer)
        handle.status = { exitCode: 1, signal }
        resolveCompletion(handle.status)
      }
    },
    async wait() {
      calls.push({ type: 'wait' })
      return completion
    },
  }
  const run = async (command, args) => {
    if (command === 'tar') {
      const extractRoot = args[args.indexOf('--directory') + 1]
      await fs.cp(
        archive.root,
        path.join(extractRoot, 'qsmds-server-v1.2.3-linux-x64'),
        { recursive: true, verbatimSymlinks: true },
      )
    }
  }
  const harness = createDependencies(fixture, {
    processGroup,
    run,
    async terminationWait() {},
  })

  await smokeServerArchive(
    { archivePath: archive.archivePath, databaseUrl, tag },
    harness.dependencies,
  )

  assert.deepEqual(
    calls.filter(call => call.type === 'terminate').map(call => call.signal),
    ['SIGTERM', 'SIGKILL'],
  )
  assert.ok(calls.some(call => call.type === 'wait'))
  assert.deepEqual(await fs.readdir(fixture.runnerTemp), [])
})

test('smoke health clock 非有限值时安全失败并完成清理', async (t) => {
  const fixture = await createSandbox(t)
  const archive = await createServerArchiveFixture(fixture)
  const observedTimes = [0, Number.POSITIVE_INFINITY]
  const run = async (command, args) => {
    if (command === 'tar') {
      const extractRoot = args[args.indexOf('--directory') + 1]
      await fs.cp(
        archive.root,
        path.join(extractRoot, 'qsmds-server-v1.2.3-linux-x64'),
        { recursive: true, verbatimSymlinks: true },
      )
    }
  }
  const harness = createDependencies(fixture, {
    fetch: async () => { throw new Error('fetch must not run') },
    now: () => observedTimes.shift() ?? Number.POSITIVE_INFINITY,
    run,
  })

  await assert.rejects(
    smokeServerArchive(
      { archivePath: archive.archivePath, databaseUrl, tag },
      harness.dependencies,
    ),
    error => (
      error instanceof ReleasePackageStageError
      && error.code === RELEASE_PACKAGE_FAILURE_CODES.serverSmoke
      && /clock/u.test(error.cause?.message)
    ),
  )
  assert.deepEqual(await fs.readdir(fixture.runnerTemp), [])
})

test('smoke 失败使用固定阶段 code 且 reporter 不泄露运行环境', async (t) => {
  const fixture = await createSandbox(t)
  const archive = await createServerArchiveFixture(fixture)
  const callerSecret = 'caller-production-hmac-secret'
  let attemptedEnv
  const processGroup = {
    spawn(_command, _args, options) {
      attemptedEnv = options.env
      throw new Error(`fixture startup failure: ${JSON.stringify(options.env)}`)
    },
    status() {
      assert.fail('spawn 失败后不得查询进程状态')
    },
    async terminate() {
      assert.fail('spawn 失败后不得终止不存在的进程')
    },
    async wait() {
      assert.fail('spawn 失败后不得等待不存在的进程')
    },
  }
  const run = async (command, args) => {
    if (command === 'tar') {
      const extractRoot = args[args.indexOf('--directory') + 1]
      await fs.cp(
        archive.root,
        path.join(extractRoot, 'qsmds-server-v1.2.3-linux-x64'),
        { recursive: true, verbatimSymlinks: true },
      )
    }
  }
  const harness = createDependencies(fixture, { processGroup, run })
  Object.assign(harness.dependencies.env, {
    AUTH_USERNAME_HMAC_KEY: callerSecret,
    AUTH_USER_ID_HMAC_KEY: callerSecret,
    AUTH_IP_HMAC_KEY: callerSecret,
  })

  let failure
  try {
    await smokeServerArchive(
      { archivePath: archive.archivePath, databaseUrl, tag },
      harness.dependencies,
    )
  } catch (error) {
    failure = error
  }

  assert.ok(failure instanceof ReleasePackageStageError)
  assert.equal(failure.code, RELEASE_PACKAGE_FAILURE_CODES.serverSmoke)
  assert.ok(attemptedEnv)
  const stderrCalls = []
  const processRef = { exitCode: 0 }
  applyReleasePackageFailure(
    failure,
    processRef,
    { error: value => stderrCalls.push(value) },
  )
  assert.equal(processRef.exitCode, 1)
  assert.deepEqual(stderrCalls, [
    'Release package failed [code=RELEASE_PACKAGE_SERVER_SMOKE_FAILED]',
  ])
  const stderr = stderrCalls.join('\n')
  assert.equal(stderr.includes(callerSecret), false)
  assert.equal(stderr.includes(databaseUrl), false)
  for (const name of smokeHmacKeyNames) {
    assert.equal(stderr.includes(attemptedEnv[name]), false)
  }
  assert.deepEqual(await fs.readdir(fixture.runnerTemp), [])
})

test('恶意 archive 在 migration/extract/spawn 前失败', async (t) => {
  const fixture = await createSandbox(t)
  const archivePath = path.join(fixture.sandbox, 'malicious.tar.gz')
  await fs.writeFile(archivePath, createTarGzip([
    { path: '../escape', contents: 'secret' },
  ]))
  const harness = createDependencies(fixture)

  await assert.rejects(
    smokeServerArchive({ archivePath, databaseUrl, tag }, harness.dependencies),
  )
  assert.deepEqual(harness.calls, [])
  assert.deepEqual(harness.processGroup.calls, [])
})

test('CLI dispatch 返回单行 JSON，失败固定脱敏', async (t) => {
  const fixture = await createSandbox(t)
  const distRoot = path.join(
    fixture.repositoryRoot,
    'web',
    'apps',
    'qsmds-arco',
    'dist',
  )
  await createWebTree(distRoot)
  const output = await fs.mkdtemp(path.join(fixture.outputRoot, 'cli-web-'))
  const calls = []
  const harness = createDependencies(fixture, {
    run: createPackagingRunner({ calls }),
  })
  const writes = []

  const result = await runReleasePackageCli({
    argv: ['web', '--tag', tag, '--output', output],
    cwd: fixture.repositoryRoot,
    dependencies: harness.dependencies,
    env: harness.dependencies.env,
    stdout: { write: value => writes.push(value) },
  })
  assert.equal(writes.join(''), `${JSON.stringify(result)}\n`)

  const secret = 'release-package-cli-secret'
  const cliFailure = spawnSync(
    process.execPath,
    [entrypoint, 'web', '--tag', secret, '--output', secret],
    { encoding: 'utf8', env: { PATH: process.env.PATH } },
  )
  assert.equal(cliFailure.status, 1)
  assert.equal(cliFailure.stdout, '')
  assert.equal(
    cliFailure.stderr,
    'Release package failed [code=RELEASE_PACKAGE_UNKNOWN_FAILED]\n',
  )
  assert.equal(cliFailure.stderr.includes(secret), false)
})
