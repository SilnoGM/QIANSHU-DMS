import { createHash } from 'node:crypto'
import * as defaultFileSystem from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'

import { validateCiDatabaseUrl } from './ci-server-e2e.mjs'
import {
  STABLE_TAG_PATTERN,
  parseStableVersion,
} from './release-version.mjs'
import {
  CommandExecutionError,
  isDirectEntry,
  runCommand,
} from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptsDirectory, '..')
const archiveInputLimit = 256 * 1024 * 1024
const archiveOutputLimit = 512 * 1024 * 1024
const tarBlockSize = 512
const healthTimeoutMilliseconds = 30_000
const healthPollMilliseconds = 250
const portAttemptLimit = 3
const processTerminationGraceMilliseconds = 5_000

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
// 构造器身份供 reporter 信任；factory 身份只供内部阶段传播，二者不可混用。
const releasePackageStageErrorSet = new WeakSet()
const classifiedReleasePackageStageErrorSet = new WeakSet()

function normalizeReleasePackageExitCode(value) {
  return Number.isInteger(value) && value > 0 ? value : 1
}

function commandExecutionExitCode(error) {
  try {
    return Error.isError(error) && error instanceof CommandExecutionError
      ? normalizeReleasePackageExitCode(error.exitCode)
      : 1
  } catch {
    // 外部错误的 prototype 或 exitCode getter 不可信，读取异常统一安全降级。
    return 1
  }
}

export class ReleasePackageStageError extends Error {
  constructor(code, cause) {
    if (!releasePackageFailureCodeSet.has(code)) {
      throw new TypeError('Release package failure code is unsupported')
    }
    super('Release package stage failed', { cause })
    this.name = 'ReleasePackageStageError'
    Object.defineProperties(this, {
      code: {
        enumerable: true,
        value: code,
      },
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
      // 只有本模块 factory 分类的错误才能跨外层阶段保留首错位置。
      throw cause
    }
    throw createReleasePackageStageError(code, cause)
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (
    actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])
  ) {
    throw new TypeError(`${label} has an unsupported shape`)
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

function assertStableTag(value) {
  if (!STABLE_TAG_PATTERN.test(value)) {
    throw new TypeError('Release tag must be a stable vX.Y.Z tag')
  }
  parseStableVersion(value.slice(1))
  return value
}

function resolveFileSystemMethod(fileSystem, method) {
  const owner = typeof fileSystem?.[method] === 'function'
    ? fileSystem
    : defaultFileSystem
  return owner[method].bind(owner)
}

function normalizeRepositoryRoot(value) {
  return path.resolve(assertNonEmptyString(value, 'Repository root'))
}

function normalizePolicy(policy) {
  assertExactKeys(policy, ['kind', 'topLevelName'], 'Release tree policy')
  if (!['web', 'server'].includes(policy.kind)) {
    throw new TypeError('Release tree policy kind is unsupported')
  }
  const topLevelName = assertNonEmptyString(
    policy.topLevelName,
    'Release tree top-level name',
  )
  const match = policy.kind === 'web'
    ? /^qsmds-web-(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/u.exec(topLevelName)
    : /^qsmds-server-(v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))-linux-x64$/u.exec(topLevelName)
  if (!match) {
    throw new TypeError('Release tree top-level name is invalid')
  }
  assertStableTag(match[1])
  return Object.freeze({ kind: policy.kind, topLevelName })
}

function policyFor(kind, tag) {
  return normalizePolicy({
    kind,
    topLevelName: kind === 'web'
      ? `qsmds-web-${tag}`
      : `qsmds-server-${tag}-linux-x64`,
  })
}

function normalizePackageInput(input) {
  assertExactKeys(input, ['outputDirectory', 'tag'], 'Release package input')
  return Object.freeze({
    outputDirectory: path.resolve(
      assertNonEmptyString(input.outputDirectory, 'Release output directory'),
    ),
    tag: assertStableTag(input.tag),
  })
}

function normalizeSmokeInput(input) {
  assertExactKeys(
    input,
    ['archivePath', 'databaseUrl', 'tag'],
    'Release smoke input',
  )
  return Object.freeze({
    archivePath: path.resolve(
      assertNonEmptyString(input.archivePath, 'Release archive path'),
    ),
    databaseUrl: validateCiDatabaseUrl(input.databaseUrl),
    tag: assertStableTag(input.tag),
  })
}

function createDefaultProcessGroup() {
  return {
    spawn(command, args, options) {
      const child = spawn(command, args, {
        ...options,
        detached: process.platform !== 'win32',
        stdio: 'ignore',
      })
      const handle = {
        child,
        status: undefined,
      }
      handle.completion = new Promise(resolve => {
        child.once('error', () => {
          handle.status = Object.freeze({ exitCode: 1 })
          resolve(handle.status)
        })
        child.once('exit', (exitCode, signal) => {
          if (handle.status !== undefined) {
            return
          }
          handle.status = Object.freeze({
            exitCode: Number.isInteger(exitCode) ? exitCode : 1,
            signal,
          })
          resolve(handle.status)
        })
      })
      return handle
    },
    status(handle) {
      return handle.status
    },
    async terminate(handle, signal = 'SIGTERM') {
      if (handle.status !== undefined) {
        return
      }
      try {
        if (process.platform !== 'win32' && Number.isInteger(handle.child.pid)) {
          process.kill(-handle.child.pid, signal)
        } else {
          handle.child.kill(signal)
        }
      } catch (error) {
        if (error?.code !== 'ESRCH') {
          throw new CommandExecutionError('Server process termination failed')
        }
      }
    },
    async wait(handle) {
      return handle.completion
    },
  }
}

function reserveLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (!isRecord(address) || !Number.isInteger(address.port)) {
        server.close()
        reject(new Error('Loopback port reservation failed'))
        return
      }
      resolve({
        port: address.port,
        close() {
          return new Promise((closeResolve, closeReject) => {
            server.close(error => error ? closeReject(error) : closeResolve())
          })
        },
      })
    })
  })
}

function waitForTerminationGrace(milliseconds) {
  return new Promise(resolve => {
    const timer = setTimeout(resolve, milliseconds)
    // 正常退出后遗留的宽限计时器不得额外阻塞 release CLI 退出。
    timer.unref?.()
  })
}

function normalizeDependencies(dependencies = {}) {
  if (!isRecord(dependencies)) {
    throw new TypeError('Release package dependencies must be an object')
  }
  const run = dependencies.run ?? runCommand
  const processGroup = dependencies.processGroup ?? createDefaultProcessGroup()
  const processRef = dependencies.processRef ?? process
  const fetchImpl = dependencies.fetch ?? globalThis.fetch
  if (
    typeof run !== 'function'
    || (
      typeof dependencies.now !== 'undefined'
      && typeof dependencies.now !== 'function'
    )
    || (
      typeof dependencies.wait !== 'undefined'
      && typeof dependencies.wait !== 'function'
    )
    || (
      typeof dependencies.terminationWait !== 'undefined'
      && typeof dependencies.terminationWait !== 'function'
    )
    || (
      typeof dependencies.reservePort !== 'undefined'
      && typeof dependencies.reservePort !== 'function'
    )
    || typeof fetchImpl !== 'function'
    || !isRecord(processRef)
    || typeof processRef.on !== 'function'
    || typeof processRef.off !== 'function'
    || !isRecord(processGroup)
    || typeof processGroup.spawn !== 'function'
    || typeof processGroup.status !== 'function'
    || typeof processGroup.terminate !== 'function'
    || typeof processGroup.wait !== 'function'
  ) {
    throw new TypeError('Release package dependencies are incomplete')
  }
  return {
    arch: dependencies.arch ?? process.arch,
    env: isRecord(dependencies.env) ? dependencies.env : process.env,
    fetch: fetchImpl,
    fileSystem: dependencies.fileSystem,
    now: dependencies.now ?? Date.now,
    platform: dependencies.platform ?? process.platform,
    processGroup,
    processRef,
    repositoryRoot: normalizeRepositoryRoot(
      dependencies.repositoryRoot ?? defaultRepositoryRoot,
    ),
    reservePort: dependencies.reservePort ?? reserveLoopbackPort,
    run,
    temporaryRoot: path.resolve(dependencies.temporaryRoot ?? os.tmpdir()),
    terminationWait: dependencies.terminationWait ?? waitForTerminationGrace,
    wait: dependencies.wait ?? (milliseconds =>
      new Promise(resolve => setTimeout(resolve, milliseconds))),
  }
}

function statsIdentity(stats) {
  return Object.freeze({
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    size: stats.size,
  })
}

function sameIdentity(stats, identity) {
  return stats.dev === identity.dev
    && stats.ino === identity.ino
    && stats.mode === identity.mode
    && stats.size === identity.size
}

function pathInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative === '' || (
    relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  )
}

function portablePathKey(value) {
  return value.normalize('NFC').toLowerCase()
}

function comparePortablePaths(left, right) {
  const leftKey = portablePathKey(left)
  const rightKey = portablePathKey(right)
  if (leftKey < rightKey) {
    return -1
  }
  if (leftKey > rightKey) {
    return 1
  }
  return left < right ? -1 : left > right ? 1 : 0
}

function assertPortableRelativePath(value) {
  if (
    value.length === 0
    || value.includes('\\')
    || value.startsWith('/')
    || value.split('/').some(segment =>
      segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error('Release tree contains an unsafe relative path')
  }
}

function assertAllowedRelativePath(relativePath, policy) {
  assertPortableRelativePath(relativePath)
  const segments = relativePath.split('/')
  const leaf = segments.at(-1)
  if (
    segments.some(segment => segment === '.env' || segment.startsWith('.env.'))
    || leaf.endsWith('.log')
  ) {
    throw new Error('Release tree contains a sensitive file')
  }
  if (
    policy.kind === 'web'
    && ['node_modules', 'src'].includes(segments[0])
  ) {
    throw new Error('Web release tree contains a forbidden source directory')
  }
  if (policy.kind === 'server') {
    if (
      relativePath === 'node_modules/prisma'
      || relativePath.startsWith('node_modules/prisma/')
      || relativePath === 'node_modules/.bin/prisma'
      || relativePath.startsWith('node_modules/.bin/prisma/')
      || /(?:^|\/)(?:test|tests|__tests__)(?:\/|$)/u.test(relativePath)
      || /\.(?:spec|test)\.[^/]+$/u.test(relativePath)
    ) {
      throw new Error('Server release tree contains a forbidden development file')
    }
  }
}

function assertTreeRequirements(entries, policy) {
  const byPath = new Map(entries.map(entry => [entry.path, entry]))
  if (policy.kind === 'web') {
    const index = byPath.get('index.html')
    if (index?.type !== 'file' || index.size <= 0) {
      throw new Error('Web release requires a non-empty index.html')
    }
    return
  }
  const requiredFiles = [
    'dist/main.js',
    'pnpm-lock.yaml',
    'prisma/schema.prisma',
    'prisma/migrations/migration_lock.toml',
  ]
  if (
    byPath.get('node_modules')?.type !== 'directory'
    || requiredFiles.some(file =>
      byPath.get(file)?.type !== 'file' || byPath.get(file).size <= 0)
  ) {
    throw new Error('Server release tree is missing a runtime file')
  }
  const hasMigration = entries.some(entry =>
    /^prisma\/migrations\/[^/]+\/migration\.sql$/u.test(entry.path)
    && entry.type === 'file'
    && entry.size > 0)
  if (!hasMigration) {
    throw new Error('Server release tree requires at least one migration')
  }
}

export async function validateReleaseTree(root, policy, dependencies = {}) {
  const normalizedPolicy = normalizePolicy(policy)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const lstat = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'lstat')
  const readlink = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'readlink')
  const readdir = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'readdir')
  const realpath = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'realpath')
  const resolvedRoot = path.resolve(assertNonEmptyString(root, 'Release tree root'))
  const lexicalStats = await lstat(resolvedRoot)
  if (lexicalStats.isSymbolicLink() || !lexicalStats.isDirectory()) {
    throw new Error('Release tree root must be a real directory')
  }
  const canonicalRoot = await realpath(resolvedRoot)
  const rootStats = await lstat(canonicalRoot)
  const rootIdentity = statsIdentity(rootStats)
  const entries = []
  const portablePaths = new Set()

  // 每层都在读取前后复核 parent/leaf inode 快照，避免校验期间被 symlink
  // 或另一个目录替换；portable key 则提前阻止跨平台解压后的路径折叠。
  async function walk(directory, relativeDirectory = '') {
    const directoryStats = await lstat(directory)
    const directoryIdentity = statsIdentity(directoryStats)
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
      throw new Error('Release tree directory identity is invalid')
    }
    const names = await readdir(directory)
    names.sort()
    for (const name of names) {
      if (
        typeof name !== 'string'
        || name.length === 0
        || name === '.'
        || name === '..'
        || name.includes(path.sep)
      ) {
        throw new Error('Release tree entry name is invalid')
      }
      if (!sameIdentity(await lstat(directory), directoryIdentity)) {
        throw new Error('Release tree parent identity changed')
      }
      const entryPath = path.join(directory, name)
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name
      assertAllowedRelativePath(relativePath, normalizedPolicy)
      const portableKey = portablePathKey(relativePath)
      if (portablePaths.has(portableKey)) {
        throw new Error('Release tree contains a portable path collision')
      }
      portablePaths.add(portableKey)
      const stats = await lstat(entryPath)
      const identity = statsIdentity(stats)
      let entry
      if (stats.isDirectory()) {
        entry = Object.freeze({
          path: relativePath,
          size: 0,
          type: 'directory',
        })
        entries.push(entry)
        await walk(entryPath, relativePath)
      } else if (stats.isFile()) {
        entry = Object.freeze({
          path: relativePath,
          size: stats.size,
          type: 'file',
        })
        entries.push(entry)
      } else if (stats.isSymbolicLink()) {
        if (
          normalizedPolicy.kind !== 'server'
          || !relativePath.startsWith('node_modules/')
        ) {
          throw new Error('Release tree contains a forbidden symbolic link')
        }
        const target = await readlink(entryPath)
        if (path.isAbsolute(target) || target.includes('\\')) {
          throw new Error('Server dependency link must be relative')
        }
        const canonicalTarget = await realpath(entryPath)
        if (!pathInside(canonicalRoot, canonicalTarget)) {
          throw new Error('Server dependency link escapes the deploy root')
        }
        entry = Object.freeze({
          path: relativePath,
          size: 0,
          target,
          type: 'symlink',
        })
        entries.push(entry)
      } else {
        throw new Error('Release tree contains a special file')
      }
      if (!sameIdentity(await lstat(entryPath), identity)) {
        throw new Error('Release tree entry identity changed')
      }
    }
    if (!sameIdentity(await lstat(directory), directoryIdentity)) {
      throw new Error('Release tree directory identity changed')
    }
  }

  await walk(canonicalRoot)
  if (!sameIdentity(await lstat(canonicalRoot), rootIdentity)) {
    throw new Error('Release tree root identity changed')
  }
  entries.sort((left, right) => comparePortablePaths(left.path, right.path))
  assertTreeRequirements(entries, normalizedPolicy)
  return Object.freeze(entries)
}

function readTarString(buffer, offset, length, label) {
  const field = buffer.subarray(offset, offset + length)
  const nulIndex = field.indexOf(0)
  const valueBytes = nulIndex === -1 ? field : field.subarray(0, nulIndex)
  if (
    nulIndex !== -1
    && field.subarray(nulIndex + 1).some(byte => byte !== 0)
  ) {
    throw new Error(`${label} has bytes after NUL`)
  }
  const value = valueBytes.toString('utf8')
  if (value.includes('\uFFFD') || value.includes('\u0000')) {
    throw new Error(`${label} is not valid UTF-8`)
  }
  return value
}

function readTarOctal(buffer, offset, length, label) {
  const value = buffer.subarray(offset, offset + length)
    .toString('ascii')
    .replace(/[\0 ]+$/u, '')
    .trimStart()
  if (!/^[0-7]+$/u.test(value)) {
    throw new Error(`${label} is not valid octal`)
  }
  const parsed = Number.parseInt(value, 8)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${label} exceeds the safe integer range`)
  }
  return parsed
}

function assertTarChecksum(header) {
  const expected = readTarOctal(header, 148, 8, 'Tar checksum')
  const copy = Buffer.from(header)
  copy.fill(0x20, 148, 156)
  const actual = copy.reduce((sum, byte) => sum + byte, 0)
  if (actual !== expected) {
    throw new Error('Tar header checksum mismatch')
  }
}

function parsePaxRecords(contents) {
  const records = new Map()
  let offset = 0
  while (offset < contents.length) {
    const space = contents.indexOf(0x20, offset)
    if (space <= offset) {
      throw new Error('PAX record length is invalid')
    }
    const lengthText = contents.subarray(offset, space).toString('ascii')
    if (!/^[1-9]\d*$/u.test(lengthText)) {
      throw new Error('PAX record length is invalid')
    }
    const length = Number(lengthText)
    const end = offset + length
    if (!Number.isSafeInteger(length) || end > contents.length || contents[end - 1] !== 0x0a) {
      throw new Error('PAX record is truncated')
    }
    const record = contents.subarray(space + 1, end - 1).toString('utf8')
    const equals = record.indexOf('=')
    if (equals <= 0 || record.includes('\uFFFD')) {
      throw new Error('PAX record is invalid')
    }
    const key = record.slice(0, equals)
    const value = record.slice(equals + 1)
    if (!['path', 'linkpath'].includes(key) || records.has(key)) {
      throw new Error('PAX record key is unsupported')
    }
    records.set(key, value)
    offset = end
  }
  return records
}

function normalizeArchiveMember(rawPath, type, policy) {
  let value = rawPath
  if (type === 'directory' && value.endsWith('/')) {
    value = value.slice(0, -1)
  }
  if (
    value.length === 0
    || value.startsWith('/')
    || /^[A-Za-z]:/u.test(value)
    || value.includes('\\')
  ) {
    throw new Error('Archive member path is unsafe')
  }
  assertPortableRelativePath(value)
  if (
    value !== policy.topLevelName
    && !value.startsWith(`${policy.topLevelName}/`)
  ) {
    throw new Error('Archive member is outside the exact top-level directory')
  }
  const relative = value === policy.topLevelName
    ? ''
    : value.slice(policy.topLevelName.length + 1)
  if (relative !== '') {
    assertAllowedRelativePath(relative, policy)
  }
  return { path: value, relative }
}

function assertArchiveRequirements(entries, policy) {
  const top = entries.find(entry => entry.path === policy.topLevelName)
  if (top?.type !== 'directory') {
    throw new Error('Archive requires its exact top-level directory')
  }
  const innerEntries = entries
    .filter(entry => entry.path !== policy.topLevelName)
    .map(entry => Object.freeze({
      ...entry,
      path: entry.path.slice(policy.topLevelName.length + 1),
    }))
  assertTreeRequirements(innerEntries, policy)
}

export async function inspectTarGzipArchive(
  archivePath,
  policy,
  dependencies = {},
) {
  const normalizedPolicy = normalizePolicy(policy)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const lstat = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'lstat')
  const readFile = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'readFile')
  const resolvedArchivePath = path.resolve(
    assertNonEmptyString(archivePath, 'Release archive path'),
  )
  const stats = await lstat(resolvedArchivePath)
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0 || stats.size > archiveInputLimit) {
    throw new Error('Release archive must be a bounded non-empty regular file')
  }
  const gzipBytes = Buffer.from(await readFile(resolvedArchivePath))
  if (
    gzipBytes.length < 18
    || gzipBytes[0] !== 0x1f
    || gzipBytes[1] !== 0x8b
    || gzipBytes[2] !== 8
    || gzipBytes[3] !== 0
    || gzipBytes.readUInt32LE(4) !== 0
  ) {
    throw new Error('Release archive gzip header is not deterministic')
  }
  let tarBytes
  try {
    tarBytes = gunzipSync(gzipBytes, { maxOutputLength: archiveOutputLimit })
  } catch {
    throw new Error('Release archive gzip stream is invalid')
  }
  if (tarBytes.length % tarBlockSize !== 0) {
    throw new Error('Tar stream must be block-aligned')
  }

  const entries = []
  const portablePaths = new Set()
  let pendingPax
  let offset = 0
  let foundEnd = false
  // 解析器只读有上限的解压字节，并在任何外部 tar extract 调用前逐 header
  // 校验 checksum、metadata、PAX 覆盖和 member type。
  while (offset + tarBlockSize <= tarBytes.length) {
    const header = tarBytes.subarray(offset, offset + tarBlockSize)
    if (header.every(byte => byte === 0)) {
      if (
        tarBytes.length - offset < 1024
        || tarBytes.subarray(offset).some(byte => byte !== 0)
      ) {
        throw new Error('Tar end marker is invalid')
      }
      foundEnd = true
      break
    }
    assertTarChecksum(header)
    const magic = readTarString(header, 257, 6, 'Tar magic')
    const version = readTarString(header, 263, 2, 'Tar version')
    if (magic !== 'ustar' || version !== '00') {
      throw new Error('Tar header must use the POSIX ustar format')
    }
    const uid = readTarOctal(header, 108, 8, 'Tar uid')
    const gid = readTarOctal(header, 116, 8, 'Tar gid')
    const mtime = readTarOctal(header, 136, 12, 'Tar mtime')
    if (uid !== 0 || gid !== 0 || mtime !== 0) {
      throw new Error('Tar header contains non-deterministic metadata')
    }
    const name = readTarString(header, 0, 100, 'Tar name')
    const prefix = readTarString(header, 345, 155, 'Tar prefix')
    const rawPath = prefix ? `${prefix}/${name}` : name
    const size = readTarOctal(header, 124, 12, 'Tar size')
    const typeFlag = header[156] === 0 ? '0' : String.fromCharCode(header[156])
    const linkTarget = readTarString(header, 157, 100, 'Tar linkname')
    const dataStart = offset + tarBlockSize
    const paddedSize = Math.ceil(size / tarBlockSize) * tarBlockSize
    const nextOffset = dataStart + paddedSize
    if (nextOffset > tarBytes.length) {
      throw new Error('Tar member contents are truncated')
    }
    const contents = tarBytes.subarray(dataStart, dataStart + size)
    offset = nextOffset

    if (typeFlag === 'x') {
      if (pendingPax !== undefined) {
        throw new Error('Tar contains consecutive PAX headers')
      }
      pendingPax = parsePaxRecords(contents)
      continue
    }
    const type = typeFlag === '0'
      ? 'file'
      : typeFlag === '5'
        ? 'directory'
        : typeFlag === '2'
          ? 'symlink'
          : undefined
    if (type === undefined) {
      throw new Error('Tar member type is unsupported')
    }
    if (type !== 'file' && size !== 0) {
      throw new Error('Tar non-file member must have zero size')
    }
    const effectivePath = pendingPax?.get('path') ?? rawPath
    const effectiveLink = pendingPax?.get('linkpath') ?? linkTarget
    pendingPax = undefined
    const member = normalizeArchiveMember(
      effectivePath,
      type,
      normalizedPolicy,
    )
    const portableKey = portablePathKey(member.path)
    if (portablePaths.has(portableKey)) {
      throw new Error('Archive contains a duplicate portable path')
    }
    portablePaths.add(portableKey)
    let entry
    if (type === 'symlink') {
      if (
        normalizedPolicy.kind !== 'server'
        || !member.relative.startsWith('node_modules/')
        || effectiveLink.length === 0
        || effectiveLink.startsWith('/')
        || effectiveLink.includes('\\')
      ) {
        throw new Error('Archive contains a forbidden symbolic link')
      }
      const resolvedLink = path.posix.normalize(
        path.posix.join(path.posix.dirname(member.path), effectiveLink),
      )
      if (
        resolvedLink !== normalizedPolicy.topLevelName
        && !resolvedLink.startsWith(`${normalizedPolicy.topLevelName}/`)
      ) {
        throw new Error('Archive symbolic link escapes the deploy root')
      }
      entry = Object.freeze({
        linkTarget: effectiveLink,
        path: member.path,
        size: 0,
        type,
      })
    } else {
      entry = Object.freeze({
        path: member.path,
        size,
        type,
      })
    }
    entries.push(entry)
  }
  if (!foundEnd || pendingPax !== undefined) {
    throw new Error('Tar stream is incomplete')
  }
  const entriesByPath = new Map(entries.map(entry => [entry.path, entry]))
  for (const entry of entries) {
    let ancestor = path.posix.dirname(entry.path)
    while (ancestor !== '.') {
      const ancestorEntry = entriesByPath.get(ancestor)
      if (ancestorEntry !== undefined && ancestorEntry.type !== 'directory') {
        // 禁止 tar 经先前 symlink/file ancestor 改写另一个逻辑路径。
        throw new Error('Archive member has a non-directory ancestor')
      }
      ancestor = path.posix.dirname(ancestor)
    }
  }
  entries.sort((left, right) => comparePortablePaths(left.path, right.path))
  assertArchiveRequirements(entries, normalizedPolicy)
  return Object.freeze(entries)
}

async function runStep(run, command, args, options) {
  const result = await run(command, args, options)
  if (result !== undefined && result !== 0) {
    throw new CommandExecutionError(`Command failed: ${command}`, result)
  }
}

async function prepareOutputDirectory(directory, dependencies) {
  const lstat = resolveFileSystemMethod(dependencies.fileSystem, 'lstat')
  const mkdir = resolveFileSystemMethod(dependencies.fileSystem, 'mkdir')
  const readdir = resolveFileSystemMethod(dependencies.fileSystem, 'readdir')
  const realpath = resolveFileSystemMethod(dependencies.fileSystem, 'realpath')
  const rm = resolveFileSystemMethod(dependencies.fileSystem, 'rm')
  const resolved = path.resolve(directory)
  let created = false
  let createdIdentity
  let outputDirectory = resolved
  try {
    await lstat(resolved)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
    const parent = path.dirname(resolved)
    const parentStats = await lstat(parent)
    if (parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
      throw new Error('Release output parent must be a real directory')
    }
    const canonicalParent = await realpath(parent)
    outputDirectory = path.join(canonicalParent, path.basename(resolved))
    await mkdir(outputDirectory, { mode: 0o700 })
    const outputStats = await lstat(outputDirectory)
    if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
      throw new Error('Release output creation is invalid')
    }
    created = true
    createdIdentity = statsIdentity(outputStats)
  }
  try {
    const lexicalStats = await lstat(outputDirectory)
    if (lexicalStats.isSymbolicLink() || !lexicalStats.isDirectory()) {
      throw new Error('Release output must be a real directory')
    }
    const canonical = await realpath(outputDirectory)
    if ((await readdir(canonical)).length !== 0) {
      throw new Error('Release output directory must start empty')
    }
    return Object.freeze({ created, directory: canonical })
  } catch (error) {
    if (created) {
      try {
        const currentStats = await lstat(outputDirectory)
        if (sameIdentity(currentStats, createdIdentity)) {
          await rm(outputDirectory, { force: true, recursive: true })
        }
      } catch {
        // 输出准备的首个错误是稳定诊断，清理失败不得覆盖它。
      }
    }
    throw error
  }
}

function tarArguments(archivePath, topLevelName) {
  return [
    '--create',
    '--gzip',
    '--file',
    archivePath,
    '--sort=name',
    '--mtime=@0',
    '--owner=0',
    '--group=0',
    '--numeric-owner',
    '--format=posix',
    '--pax-option=delete=atime,delete=ctime',
    topLevelName,
  ]
}

async function finalizeArchive(
  archivePath,
  policy,
  dependencies,
) {
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

async function pruneServerDevelopmentArtifacts(stageRoot, dependencies) {
  const lstat = resolveFileSystemMethod(dependencies.fileSystem, 'lstat')
  const readdir = resolveFileSystemMethod(dependencies.fileSystem, 'readdir')
  const rm = resolveFileSystemMethod(dependencies.fileSystem, 'rm')

  // @prisma/client 的 optional peer 会让 pnpm deploy 保留 CLI 顶层入口；
  // migration 使用 checkout 内的 Prisma CLI，archive 运行时无需暴露这两个入口。
  for (const relativePath of [
    'node_modules/prisma',
    'node_modules/.bin/prisma',
  ]) {
    await rm(path.join(stageRoot, relativePath), {
      force: true,
      recursive: true,
    })
  }

  async function walk(directory, relativeDirectory = '') {
    const names = await readdir(directory)
    names.sort()
    for (const name of names) {
      const entryPath = path.join(directory, name)
      const relativePath = relativeDirectory
        ? `${relativeDirectory}/${name}`
        : name
      const segments = relativePath.split('/')
      const isTestArtifact = segments.some(segment =>
        ['test', 'tests', '__tests__'].includes(segment))
        || /\.(?:spec|test)\.[^/]+$/u.test(relativePath)
      const stats = await lstat(entryPath)
      if (isTestArtifact) {
        // lstat 后直接删除当前 leaf；若它是 symlink，fs.rm 不会跟随其目标。
        await rm(entryPath, { force: true, recursive: true })
      } else if (stats.isDirectory()) {
        await walk(entryPath, relativePath)
      }
    }
  }

  await walk(stageRoot)
}

async function packageRelease(kind, input, dependencies) {
  const normalizedInput = normalizePackageInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  if (
    kind === 'server'
    && (
      normalizedDependencies.platform !== 'linux'
      || normalizedDependencies.arch !== 'x64'
    )
  ) {
    throw new Error('Server release packaging requires linux/x64')
  }
  const policy = policyFor(kind, normalizedInput.tag)
  const output = await withReleasePackageStage(
    RELEASE_PACKAGE_FAILURE_CODES.outputPrepare,
    () => prepareOutputDirectory(
      normalizedInput.outputDirectory,
      normalizedDependencies,
    ),
  )
  const outputDirectory = output.directory
  const mkdtemp = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'mkdtemp')
  const rm = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'rm')
  const cp = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'cp')
  const archiveName = kind === 'web'
    ? `qsmds-web-${normalizedInput.tag}.tar.gz`
    : `qsmds-server-${normalizedInput.tag}-linux-x64.tar.gz`
  const archivePath = path.join(outputDirectory, archiveName)
  let completed = false
  let primaryError
  let stageParent
  try {
    stageParent = await withReleasePackageStage(
      RELEASE_PACKAGE_FAILURE_CODES.stageCreate,
      () => mkdtemp(path.join(outputDirectory, 'qianshu-release-stage-')),
    )
    const stageRoot = path.join(stageParent, policy.topLevelName)
    if (kind === 'web') {
      const sourceRoot = path.join(
        normalizedDependencies.repositoryRoot,
        'web',
        'apps',
        'qsmds-arco',
        'dist',
      )
      await validateReleaseTree(sourceRoot, policy, normalizedDependencies)
      await cp(sourceRoot, stageRoot, {
        errorOnExist: true,
        force: false,
        recursive: true,
        verbatimSymlinks: true,
      })
    } else {
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
        () => pruneServerDevelopmentArtifacts(
          stageRoot,
          normalizedDependencies,
        ),
      )
    }
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
    const result = await finalizeArchive(
      archivePath,
      policy,
      normalizedDependencies,
    )
    completed = true
    return result
  } catch (error) {
    primaryError = classifiedReleasePackageStageErrorSet.has(error)
      ? error
      : createReleasePackageStageError(
          RELEASE_PACKAGE_FAILURE_CODES.unknown,
          error,
        )
    throw primaryError
  } finally {
    let cleanupError
    if (stageParent !== undefined) {
      try {
        await rm(stageParent, { force: true, recursive: true })
      } catch (error) {
        cleanupError = error
      }
    }
    if (!completed || cleanupError !== undefined) {
      try {
        // 归档命令可能已经写入部分字节；失败时不得留下可被误发布的文件。
        await rm(archivePath, { force: true })
      } catch {
        // 首个构建/清理错误才是本次调用的稳定失败原因。
      }
      if (output.created) {
        try {
          await rm(outputDirectory, { force: true, recursive: true })
        } catch {
          // 失败路径保持首个错误；输出目录只在本次调用创建时才回收。
        }
      }
    }
    if (primaryError === undefined && cleanupError !== undefined) {
      throw createReleasePackageStageError(
        RELEASE_PACKAGE_FAILURE_CODES.stageCleanup,
        cleanupError,
      )
    }
  }
}

export function packageWeb(input, dependencies = {}) {
  return packageRelease('web', input, dependencies)
}

export function packageServer(input, dependencies = {}) {
  return packageRelease('server', input, dependencies)
}

function sanitizedDatabaseEnv(sourceEnv, databaseUrl, extra = {}) {
  const env = {
    ...sourceEnv,
    ...extra,
    DATABASE_URL: databaseUrl,
    DOTENV_CONFIG_PATH: '/dev/null',
  }
  delete env.DEBUG
  delete env.NODE_PATH
  delete env.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
  return env
}

async function extractServerArchive(
  input,
  policy,
  dependencies,
) {
  await inspectTarGzipArchive(input.archivePath, policy, dependencies)
  const lstat = resolveFileSystemMethod(dependencies.fileSystem, 'lstat')
  const mkdtemp = resolveFileSystemMethod(dependencies.fileSystem, 'mkdtemp')
  const readdir = resolveFileSystemMethod(dependencies.fileSystem, 'readdir')
  const realpath = resolveFileSystemMethod(dependencies.fileSystem, 'realpath')
  const temporaryRoot = await realpath(dependencies.temporaryRoot)
  const rootStats = await lstat(temporaryRoot)
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error('Release smoke temporary root must be a real directory')
  }
  const createdExtractRoot = await mkdtemp(
    path.join(temporaryRoot, 'qianshu-release-smoke-'),
  )
  // mkdtemp 本身会改变 parent directory size，快照必须在合法创建之后取得。
  const temporaryRootIdentity = statsIdentity(await lstat(temporaryRoot))
  const rm = resolveFileSystemMethod(dependencies.fileSystem, 'rm')
  let completed = false
  let extractRoot
  let owned = false
  let primaryError
  try {
    const lexicalExtractRoot = path.resolve(createdExtractRoot)
    const lexicalStats = await lstat(lexicalExtractRoot)
    if (
      path.dirname(lexicalExtractRoot) !== temporaryRoot
      || !path.basename(lexicalExtractRoot).startsWith('qianshu-release-smoke-')
      || lexicalStats.isSymbolicLink()
      || !lexicalStats.isDirectory()
    ) {
      throw new Error('Release smoke extract directory is not owned')
    }
    const canonicalExtractRoot = await realpath(lexicalExtractRoot)
    if (
      canonicalExtractRoot !== lexicalExtractRoot
      || !pathInside(temporaryRoot, canonicalExtractRoot)
      || (await readdir(canonicalExtractRoot)).length !== 0
      || !sameIdentity(await lstat(lexicalExtractRoot), statsIdentity(lexicalStats))
      || !sameIdentity(await lstat(temporaryRoot), temporaryRootIdentity)
    ) {
      throw new Error('Release smoke extract directory is not fresh')
    }
    // 只有完成 canonical、空目录与 parent identity 校验后才取得删除所有权。
    extractRoot = canonicalExtractRoot
    owned = true
    await runStep(
      dependencies.run,
      'tar',
      [
        '--extract',
        '--gzip',
        '--file',
        input.archivePath,
        '--no-same-owner',
        '--no-same-permissions',
        '--directory',
        extractRoot,
      ],
      { cwd: dependencies.repositoryRoot },
    )
    const serverRoot = path.join(extractRoot, policy.topLevelName)
    await validateReleaseTree(serverRoot, policy, dependencies)
    completed = true
    return { extractRoot, serverRoot }
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    if (owned && !completed) {
      try {
        await rm(extractRoot, { force: true, recursive: true })
      } catch (cleanupError) {
        if (primaryError === undefined) {
          throw cleanupError
        }
      }
    }
  }
}

function assertHealthResponse(response, body) {
  const requestId = response?.headers?.get?.('x-request-id')
  if (
    response?.status !== 200
    || typeof requestId !== 'string'
    || requestId.length === 0
    || !isRecord(body)
    || body.status !== 'ok'
    || !isRecord(body.info)
    || !isRecord(body.info.database)
    || body.info.database.status !== 'up'
  ) {
    throw new Error('Server archive health response is invalid')
  }
}

async function stopProcessGroup(handle, signal, dependencies) {
  if (dependencies.processGroup.status(handle) !== undefined) {
    await dependencies.processGroup.wait(handle)
    return
  }
  await dependencies.processGroup.terminate(handle, signal)
  const completion = Promise.resolve(dependencies.processGroup.wait(handle))
  if (dependencies.processGroup.status(handle) === undefined) {
    const outcome = await Promise.race([
      completion.then(() => 'exited'),
      Promise.resolve(
        dependencies.terminationWait(processTerminationGraceMilliseconds),
      )
        .then(() => 'timeout'),
    ])
    if (
      outcome === 'timeout'
      && dependencies.processGroup.status(handle) === undefined
    ) {
      // 宽限期只针对本次 detached process group，避免遗留 Server 后代进程。
      await dependencies.processGroup.terminate(handle, 'SIGKILL')
    }
  }
  await completion
}

async function runHealthAttempt(serverRoot, port, input, dependencies, signalState) {
  const childEnv = sanitizedDatabaseEnv(
    dependencies.env,
    input.databaseUrl,
    { NODE_ENV: 'production', PORT: String(port) },
  )
  const handle = dependencies.processGroup.spawn(
    process.execPath,
    ['dist/main.js'],
    { cwd: serverRoot, env: childEnv },
  )
  try {
    const startedAt = dependencies.now()
    if (!Number.isFinite(startedAt)) {
      throw new Error('Server archive health clock is invalid')
    }
    const deadline = startedAt + healthTimeoutMilliseconds
    while (true) {
      const currentTime = dependencies.now()
      if (!Number.isFinite(currentTime)) {
        throw new Error('Server archive health clock is invalid')
      }
      if (currentTime > deadline) {
        break
      }
      if (signalState.signal !== undefined) {
        throw new Error('Server archive smoke was interrupted')
      }
      const status = dependencies.processGroup.status(handle)
      if (status !== undefined) {
        return false
      }
      let abortForTimeout
      let controller
      let timeoutSignal
      try {
        controller = new AbortController()
        timeoutSignal = AbortSignal.timeout(
          Math.max(1, deadline - currentTime),
        )
        abortForTimeout = () => controller.abort()
        timeoutSignal.addEventListener('abort', abortForTimeout, { once: true })
        signalState.controller = controller
        const response = await dependencies.fetch(
          `http://127.0.0.1:${port}/api/health`,
          { signal: controller.signal },
        )
        const body = await response.json()
        assertHealthResponse(response, body)
        return true
      } catch (error) {
        if (error?.message === 'Server archive health response is invalid') {
          throw error
        }
      } finally {
        if (timeoutSignal !== undefined && abortForTimeout !== undefined) {
          timeoutSignal.removeEventListener('abort', abortForTimeout)
        }
        if (signalState.controller === controller) {
          signalState.controller = undefined
        }
      }
      if (signalState.signal !== undefined) {
        throw new Error('Server archive smoke was interrupted')
      }
      await dependencies.wait(healthPollMilliseconds)
    }
    throw new Error('Server archive health check timed out')
  } finally {
    await stopProcessGroup(
      handle,
      signalState.signal ?? 'SIGTERM',
      dependencies,
    )
  }
}

export async function smokeServerArchive(input, dependencies = {}) {
  const normalizedInput = normalizeSmokeInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  if (
    normalizedDependencies.platform !== 'linux'
    || normalizedDependencies.arch !== 'x64'
  ) {
    throw new Error('Server archive smoke requires linux/x64')
  }
  const policy = policyFor('server', normalizedInput.tag)
  // 任何数据库或解压副作用之前先完成原始 archive header 审计。
  await inspectTarGzipArchive(
    normalizedInput.archivePath,
    policy,
    normalizedDependencies,
  )
  const migrationEnv = sanitizedDatabaseEnv(
    normalizedDependencies.env,
    normalizedInput.databaseUrl,
  )
  await runStep(
    normalizedDependencies.run,
    'pnpm',
    ['-C', 'server', 'db:migrate:deploy'],
    { cwd: normalizedDependencies.repositoryRoot, env: migrationEnv },
  )

  const rm = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'rm')
  let extractRoot
  let primaryError
  const signalState = { controller: undefined, signal: undefined }
  const handleSignal = signal => {
    signalState.signal ??= signal
    // fetch 正在等待网络时主动 abort，保证终端信号无需等待完整 health deadline。
    signalState.controller?.abort()
  }
  const onSigint = () => handleSignal('SIGINT')
  const onSigterm = () => handleSignal('SIGTERM')
  normalizedDependencies.processRef.on?.('SIGINT', onSigint)
  normalizedDependencies.processRef.on?.('SIGTERM', onSigterm)
  try {
    const extracted = await extractServerArchive(
      normalizedInput,
      policy,
      normalizedDependencies,
    )
    extractRoot = extracted.extractRoot
    for (let attempt = 0; attempt < portAttemptLimit; attempt += 1) {
      const reservation = await normalizedDependencies.reservePort()
      if (
        !isRecord(reservation)
        || !Number.isInteger(reservation.port)
        || reservation.port < 1
        || reservation.port > 65_535
        || typeof reservation.close !== 'function'
      ) {
        throw new Error('Loopback port reservation is invalid')
      }
      await reservation.close()
      const passed = await runHealthAttempt(
        extracted.serverRoot,
        reservation.port,
        normalizedInput,
        normalizedDependencies,
        signalState,
      )
      if (passed) {
        return
      }
    }
    throw new Error('Server archive exited during startup')
  } catch (error) {
    primaryError = error
    throw error
  } finally {
    normalizedDependencies.processRef.off?.('SIGINT', onSigint)
    normalizedDependencies.processRef.off?.('SIGTERM', onSigterm)
    if (extractRoot !== undefined) {
      try {
        await rm(extractRoot, { force: true, recursive: true })
      } catch (cleanupError) {
        if (primaryError === undefined) {
          throw cleanupError
        }
      }
    }
  }
}

export function parseReleasePackageArguments(argv, cwd = process.cwd()) {
  if (!Array.isArray(argv)) {
    throw new TypeError('Release package arguments must be an array')
  }
  const normalizedCwd = path.resolve(assertNonEmptyString(cwd, 'Invocation cwd'))
  if (
    argv.length !== 5
    || !['web', 'server', 'smoke-server'].includes(argv[0])
    || argv[1] !== '--tag'
    || typeof argv[2] !== 'string'
    || !['--output', '--archive'].includes(argv[3])
    || typeof argv[4] !== 'string'
    || argv[4].length === 0
    || argv[4].startsWith('--')
  ) {
    throw new TypeError('Release package CLI arguments are invalid')
  }
  const command = argv[0]
  const expectedPathFlag = command === 'smoke-server' ? '--archive' : '--output'
  if (argv[3] !== expectedPathFlag) {
    throw new TypeError('Release package CLI path flag is invalid')
  }
  const normalizedTag = assertStableTag(argv[2])
  const resolvedPath = path.resolve(normalizedCwd, argv[4])
  return command === 'smoke-server'
    ? Object.freeze({ archivePath: resolvedPath, command, tag: normalizedTag })
    : Object.freeze({ command, outputPath: resolvedPath, tag: normalizedTag })
}

export async function runReleasePackageCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  dependencies = {},
  env = process.env,
  stdout = process.stdout,
} = {}) {
  if (typeof stdout?.write !== 'function') {
    throw new TypeError('Release package stdout must provide write()')
  }
  const parsed = parseReleasePackageArguments(argv, cwd)
  const mergedDependencies = {
    ...dependencies,
    env: isRecord(dependencies.env) ? dependencies.env : env,
  }
  if (parsed.command === 'smoke-server') {
    await smokeServerArchive({
      archivePath: parsed.archivePath,
      databaseUrl: mergedDependencies.env.DATABASE_URL,
      tag: parsed.tag,
    }, mergedDependencies)
    return
  }
  const result = parsed.command === 'web'
    ? await packageWeb(
        { outputDirectory: parsed.outputPath, tag: parsed.tag },
        mergedDependencies,
      )
    : await packageServer(
        { outputDirectory: parsed.outputPath, tag: parsed.tag },
        mergedDependencies,
      )
  stdout.write(`${JSON.stringify(result)}\n`)
  return result
}

export function applyReleasePackageFailure(
  error,
  processRef = process,
  consoleRef = console,
) {
  const failure = releasePackageStageErrorSet.has(error) ? error : undefined
  processRef.exitCode = failure?.exitCode
    ?? commandExecutionExitCode(error)
  const code = failure?.code ?? RELEASE_PACKAGE_FAILURE_CODES.unknown
  consoleRef.error(`Release package failed [code=${code}]`)
}

if (isDirectEntry(import.meta.url)) {
  runReleasePackageCli().catch(error => applyReleasePackageFailure(error))
}
