import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import * as defaultFileSystem from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  applyFailureToProcess,
  isDirectEntry,
} from './run-command.mjs'
import {
  imageArtifactNames,
  imageReferences,
} from './release-images.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptsDirectory, '..')
const defaultSchemaPath = path.join(
  defaultRepositoryRoot,
  'release',
  'manifest.schema.json',
)
const schemaDraft = 'https://json-schema.org/draft/2020-12/schema'
const schemaKeywords = new Set([
  '$schema',
  'type',
  'properties',
  'required',
  'additionalProperties',
  'const',
  'enum',
  'pattern',
  'minimum',
])
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const fullShaPattern = /^(?!0{40}$)[0-9a-f]{40}$/u
const digestPattern = /^[0-9a-f]{64}$/u
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const workflowPattern = /^[A-Za-z0-9_.-]+\.ya?ml$/u
const positiveDigitsPattern = /^[1-9]\d*$/u
const migrationDirectoryPattern = /^(\d{14})_[A-Za-z0-9][A-Za-z0-9_-]*$/u
const checksumFileName = 'SHA256SUMS'
const manifestFileName = 'release-manifest.json'
const checksumLineCount = 5
const sha256DigestPattern = /^sha256:[0-9a-f]{64}$/u
const commandOutputLimit = 1024 * 1024

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

function assertPattern(value, pattern, label) {
  assertNonEmptyString(value, label)
  if (!pattern.test(value)) {
    throw new TypeError(`${label} is invalid`)
  }
  return value
}

function assertPositiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer`)
  }
  return value
}

function parsePositiveInteger(value, label) {
  assertPattern(value, positiveDigitsPattern, label)
  return assertPositiveInteger(Number(value), label)
}

function deepFreeze(value) {
  if (isRecord(value) || Array.isArray(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
    Object.freeze(value)
  }
  return value
}

function resolveFileSystemMethod(fileSystem, method) {
  const owner = typeof fileSystem?.[method] === 'function'
    ? fileSystem
    : defaultFileSystem
  return owner[method].bind(owner)
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`
}

function schemaFailure(message, jsonPath, detail) {
  throw new TypeError(
    detail === undefined
      ? `${message} at ${jsonPath}`
      : `${message} at ${jsonPath}: ${detail}`,
  )
}

/**
 * 只接受本项目 schema 实际使用的关键字。这里校验的是 schema 自身，而不是
 * Manifest；新增 JSON Schema 语义时必须先显式扩展本函数，不能被运行时忽略。
 */
export function validateManifestSchema(schema) {
  function visit(node, jsonPath, isRoot = false) {
    if (!isRecord(node)) {
      schemaFailure('Schema node must be an object', jsonPath)
    }
    for (const keyword of Object.keys(node)) {
      if (!schemaKeywords.has(keyword)) {
        schemaFailure('Schema keyword is unsupported', jsonPath, keyword)
      }
    }
    if (isRoot) {
      if (node.$schema !== schemaDraft) {
        schemaFailure('Schema draft is unsupported', jsonPath)
      }
    } else if (Object.hasOwn(node, '$schema')) {
      schemaFailure('Schema keyword is unsupported', jsonPath, '$schema')
    }
    if (!['object', 'string', 'integer'].includes(node.type)) {
      schemaFailure('Schema type is unsupported', jsonPath)
    }

    if (node.type === 'object') {
      if (
        !isRecord(node.properties)
        || !Array.isArray(node.required)
        || node.additionalProperties !== false
        || Object.hasOwn(node, 'const')
        || Object.hasOwn(node, 'enum')
        || Object.hasOwn(node, 'pattern')
        || Object.hasOwn(node, 'minimum')
      ) {
        schemaFailure('Object schema shape is unsupported', jsonPath)
      }
      if (
        node.required.length !== new Set(node.required).size
        || node.required.some(name => typeof name !== 'string')
      ) {
        schemaFailure('Schema required list is invalid', jsonPath)
      }
      for (const name of node.required) {
        if (!Object.hasOwn(node.properties, name)) {
          schemaFailure('Schema required property is undefined', jsonPath, name)
        }
      }
      if (
        Object.keys(node.properties).some(name => !node.required.includes(name))
      ) {
        schemaFailure('Schema optional properties are unsupported', jsonPath)
      }
      for (const [name, child] of Object.entries(node.properties)) {
        visit(child, `${jsonPath}.properties.${name}`)
      }
      return
    }

    if (
      Object.hasOwn(node, 'properties')
      || Object.hasOwn(node, 'required')
      || Object.hasOwn(node, 'additionalProperties')
    ) {
      schemaFailure('Scalar schema shape is unsupported', jsonPath)
    }
    if (Object.hasOwn(node, 'pattern')) {
      if (node.type !== 'string' || typeof node.pattern !== 'string') {
        schemaFailure('Schema pattern is unsupported', jsonPath)
      }
      try {
        new RegExp(node.pattern, 'u')
      } catch {
        schemaFailure('Schema pattern is invalid', jsonPath)
      }
    }
    if (Object.hasOwn(node, 'enum')) {
      if (
        node.type !== 'string'
        || !Array.isArray(node.enum)
        || node.enum.length === 0
        || node.enum.some(value => typeof value !== 'string')
        || node.enum.length !== new Set(node.enum).size
      ) {
        schemaFailure('Schema enum is unsupported', jsonPath)
      }
    }
    if (Object.hasOwn(node, 'minimum')) {
      if (node.type !== 'integer' || !Number.isSafeInteger(node.minimum)) {
        schemaFailure('Schema minimum is unsupported', jsonPath)
      }
    }
    if (Object.hasOwn(node, 'const')) {
      const expectedType = node.type === 'integer' ? 'number' : node.type
      if (
        typeof node.const !== expectedType
        || (node.type === 'integer' && !Number.isSafeInteger(node.const))
      ) {
        schemaFailure('Schema const is unsupported', jsonPath)
      }
    }
  }

  visit(schema, '$', true)
  return deepFreeze(schema)
}

function validationFailure(jsonPath, constraint) {
  throw new TypeError(`Manifest validation failed at ${jsonPath}: ${constraint}`)
}

/**
 * 错误只包含 JSON path 和固定 constraint，不拼接实际值，防止未来误把发布
 * 元数据中的敏感内容回显到 Actions 日志。
 */
export function validateValueAgainstSchema(value, schema, jsonPath = '$') {
  if (schema.type === 'object') {
    if (!isRecord(value)) {
      validationFailure(jsonPath, 'type')
    }
    for (const name of schema.required) {
      if (!Object.hasOwn(value, name)) {
        validationFailure(`${jsonPath}.${name}`, 'required')
      }
    }
    for (const name of Object.keys(value)) {
      if (!Object.hasOwn(schema.properties, name)) {
        validationFailure(`${jsonPath}.${name}`, 'additionalProperties')
      }
    }
    for (const [name, childSchema] of Object.entries(schema.properties)) {
      validateValueAgainstSchema(value[name], childSchema, `${jsonPath}.${name}`)
    }
    return
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      validationFailure(jsonPath, 'type')
    }
  } else if (!Number.isSafeInteger(value)) {
    validationFailure(jsonPath, 'type')
  }
  if (Object.hasOwn(schema, 'const') && value !== schema.const) {
    validationFailure(jsonPath, 'const')
  }
  if (Object.hasOwn(schema, 'enum') && !schema.enum.includes(value)) {
    validationFailure(jsonPath, 'enum')
  }
  if (
    Object.hasOwn(schema, 'pattern')
    && !new RegExp(schema.pattern, 'u').test(value)
  ) {
    validationFailure(jsonPath, 'pattern')
  }
  if (Object.hasOwn(schema, 'minimum') && value < schema.minimum) {
    validationFailure(jsonPath, 'minimum')
  }
}

function statsIdentity(stats) {
  return {
    ctimeMs: stats.ctimeMs,
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    mtimeMs: stats.mtimeMs,
    size: stats.size,
  }
}

function sameIdentity(stats, identity) {
  return Object.entries(identity).every(([key, value]) => stats[key] === value)
}

async function readStableRegularFile(filePath, fileSystem, label, allowEmpty = false) {
  const lstat = resolveFileSystemMethod(fileSystem, 'lstat')
  const readFile = resolveFileSystemMethod(fileSystem, 'readFile')
  const before = await lstat(filePath)
  if (
    before.isSymbolicLink()
    || !before.isFile()
    || (!allowEmpty && before.size <= 0)
  ) {
    throw new Error(`${label} must be a non-empty regular file`)
  }
  const identity = statsIdentity(before)
  const bytes = await readFile(filePath)
  const after = await lstat(filePath)
  if (
    !sameIdentity(after, identity)
    || bytes.length !== identity.size
  ) {
    throw new Error('File changed while hashing')
  }
  return { bytes: Buffer.from(bytes), stats: after }
}

async function hashStableRegularFile(filePath, fileSystem, label, allowEmpty = false) {
  const result = await readStableRegularFile(
    filePath,
    fileSystem,
    label,
    allowEmpty,
  )
  return {
    bytes: result.bytes,
    sha256: createHash('sha256').update(result.bytes).digest('hex'),
    size: result.stats.size,
  }
}

function codePointCompare(left, right) {
  const leftPoints = [...left].map(character => character.codePointAt(0))
  const rightPoints = [...right].map(character => character.codePointAt(0))
  const length = Math.min(leftPoints.length, rightPoints.length)
  for (let index = 0; index < length; index += 1) {
    if (leftPoints[index] !== rightPoints[index]) {
      return leftPoints[index] - rightPoints[index]
    }
  }
  return leftPoints.length - rightPoints.length
}

function assertPortableSegment(segment) {
  const windowsReserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu
  if (
    segment.length === 0
    || segment === '.'
    || segment === '..'
    || /[\u0000-\u001f<>:"/\\|?*]/u.test(segment)
    || /[. ]$/u.test(segment)
    || windowsReserved.test(segment)
  ) {
    throw new Error('Migration path is not portable')
  }
}

function portablePathKey(relativePath) {
  return relativePath.normalize('NFC').toLowerCase()
}

/**
 * migrationHead 只表示合法目录名排序后的最大值；它不是 Prisma 分叉图分析。
 * 清单同时包含 migration_lock.toml，确保 provider 变化会进入集合摘要。
 */
export async function collectMigrationMetadata(
  migrationsRoot,
  { fileSystem } = {},
) {
  const root = path.resolve(assertNonEmptyString(migrationsRoot, 'Migrations root'))
  const lstat = resolveFileSystemMethod(fileSystem, 'lstat')
  const readdir = resolveFileSystemMethod(fileSystem, 'readdir')
  const rootStats = await lstat(root)
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error('Migrations root must be a real directory')
  }
  const names = await readdir(root)
  names.sort(codePointCompare)
  const migrationDirectories = []
  const timestamps = new Set()
  const files = []
  const portableKeys = new Set()

  async function addFile(absolutePath, relativePath) {
    for (const segment of relativePath.split('/')) {
      assertPortableSegment(segment)
    }
    const key = portablePathKey(relativePath)
    if (portableKeys.has(key)) {
      throw new Error('Migration path has a portable collision')
    }
    portableKeys.add(key)
    const file = await hashStableRegularFile(
      absolutePath,
      fileSystem,
      'Migration file',
      true,
    )
    files.push({ path: relativePath, sha256: file.sha256 })
  }

  for (const name of names) {
    assertPortableSegment(name)
    const entryPath = path.join(root, name)
    const stats = await lstat(entryPath)
    if (stats.isSymbolicLink()) {
      throw new Error('Migration tree contains an unsupported entry')
    }
    if (name === 'migration_lock.toml') {
      if (!stats.isFile()) {
        throw new Error('Migration tree contains an unsupported entry')
      }
      await addFile(entryPath, name)
      continue
    }
    if (!stats.isDirectory()) {
      throw new Error('Migration tree contains an unsupported entry')
    }
    const match = migrationDirectoryPattern.exec(name)
    if (!match) {
      throw new Error('Migration directory name is invalid')
    }
    if (timestamps.has(match[1])) {
      throw new Error('Migration timestamp is duplicated')
    }
    timestamps.add(match[1])
    migrationDirectories.push(name)

    const childNames = await readdir(entryPath)
    childNames.sort(codePointCompare)
    if (childNames.length === 0) {
      throw new Error('Migration directory is empty')
    }
    for (const childName of childNames) {
      const childPath = path.join(entryPath, childName)
      const childStats = await lstat(childPath)
      if (childStats.isSymbolicLink() || !childStats.isFile()) {
        throw new Error('Migration tree contains an unsupported entry')
      }
      await addFile(childPath, `${name}/${childName}`)
    }
  }
  if (migrationDirectories.length === 0) {
    throw new Error('Migration set is empty')
  }
  migrationDirectories.sort(codePointCompare)
  files.sort((left, right) => codePointCompare(left.path, right.path))
  const frozenFiles = deepFreeze(files)
  return deepFreeze({
    files: frozenFiles,
    migrationHead: migrationDirectories.at(-1),
    sha256: createHash('sha256').update(canonicalJson(files)).digest('hex'),
  })
}

function defaultRunCapture(command, args, { cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, env, encoding: 'utf8', maxBuffer: commandOutputLimit },
      (error, stdout) => {
        if (error) {
          reject(new Error('Runtime metadata command failed'))
          return
        }
        resolve(stdout)
      },
    )
  })
}

function normalizeDependencies(dependencies = {}) {
  if (!isRecord(dependencies)) {
    throw new TypeError('Release Manifest dependencies must be an object')
  }
  const processRef = dependencies.processRef ?? process
  const runCapture = dependencies.runCapture ?? defaultRunCapture
  if (
    !isRecord(processRef)
    || !isRecord(processRef.versions)
    || typeof runCapture !== 'function'
    || typeof (dependencies.now ?? Date.now) !== 'function'
  ) {
    throw new TypeError('Release Manifest dependencies are incomplete')
  }
  return {
    env: isRecord(dependencies.env) ? dependencies.env : process.env,
    fileSystem: dependencies.fileSystem,
    now: dependencies.now ?? Date.now,
    processRef,
    repositoryRoot: path.resolve(
      dependencies.repositoryRoot ?? defaultRepositoryRoot,
    ),
    runCapture,
    schemaPath: path.resolve(dependencies.schemaPath ?? defaultSchemaPath),
  }
}

async function loadManifestSchema(dependencies) {
  const file = await readStableRegularFile(
    dependencies.schemaPath,
    dependencies.fileSystem,
    'Manifest schema',
  )
  let schema
  try {
    schema = JSON.parse(file.bytes.toString('utf8'))
  } catch {
    throw new Error('Manifest schema is invalid JSON')
  }
  return validateManifestSchema(schema)
}

function parseJsonObject(bytes, label) {
  let value
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw new Error(`${label} is invalid JSON`)
  }
  if (!isRecord(value)) {
    throw new Error(`${label} must contain a JSON object`)
  }
  return value
}

function normalizeReleaseMetadata(value) {
  assertExactKeys(
    value,
    ['version', 'tag', 'tagObjectSha', 'sourceCommit'],
    'Release metadata',
  )
  const version = assertPattern(value.version, stableVersionPattern, 'Release version')
  const tag = assertPattern(value.tag, stableTagPattern, 'Release tag')
  if (tag !== `v${version}`) {
    throw new Error('Release metadata version and tag differ')
  }
  return deepFreeze({
    version,
    tag,
    tagObjectSha: assertPattern(
      value.tagObjectSha,
      fullShaPattern,
      'Tag object SHA',
    ),
    sourceCommit: assertPattern(
      value.sourceCommit,
      fullShaPattern,
      'Source commit',
    ),
  })
}

async function readReleaseMetadata(filePath, fileSystem) {
  const file = await readStableRegularFile(
    filePath,
    fileSystem,
    'Release metadata',
  )
  return normalizeReleaseMetadata(
    parseJsonObject(file.bytes, 'Release metadata'),
  )
}

function normalizeManifestInput(input) {
  assertExactKeys(
    input,
    [
      'imagesMetadataPath',
      'releaseMetadataPath',
      'repository',
      'runAttempt',
      'runId',
      'serverArchivePath',
      'serverImagePath',
      'webArchivePath',
      'webImagePath',
      'workflow',
    ],
    'Release Manifest input',
  )
  return deepFreeze({
    imagesMetadataPath: path.resolve(
      assertNonEmptyString(input.imagesMetadataPath, 'Images metadata path'),
    ),
    releaseMetadataPath: path.resolve(
      assertNonEmptyString(input.releaseMetadataPath, 'Release metadata path'),
    ),
    repository: assertPattern(input.repository, repositoryPattern, 'Repository'),
    runAttempt: assertPositiveInteger(input.runAttempt, 'Run attempt'),
    runId: assertPattern(input.runId, positiveDigitsPattern, 'Run ID'),
    serverArchivePath: path.resolve(
      assertNonEmptyString(input.serverArchivePath, 'Server archive path'),
    ),
    serverImagePath: path.resolve(
      assertNonEmptyString(input.serverImagePath, 'Server image archive path'),
    ),
    webArchivePath: path.resolve(
      assertNonEmptyString(input.webArchivePath, 'Web archive path'),
    ),
    webImagePath: path.resolve(
      assertNonEmptyString(input.webImagePath, 'Web image archive path'),
    ),
    workflow: assertPattern(input.workflow, workflowPattern, 'Workflow'),
  })
}

/*
 * 镜像元数据由 release-images 生成，是镜像 digest 的唯一来源。这里只接受与 Tag
 * 完全一致的引用/归档名，并把摘要与大小交给调用方与真实文件哈希交叉校验，
 * 避免"元数据说自己是多少"取代"文件实际是多少"。
 */
function normalizeImagesMetadata(value, tag) {
  assertExactKeys(value, ['schemaVersion', 'tag', 'images'], 'Images metadata')
  if (value.schemaVersion !== 1 || value.tag !== tag) {
    throw new Error('Images metadata identity is invalid')
  }
  assertExactKeys(value.images, ['server', 'web'], 'Images metadata set')
  const references = imageReferences(tag)
  const artifactNames = imageArtifactNames(tag)
  const images = {}
  for (const kind of ['server', 'web']) {
    const entry = value.images[kind]
    assertExactKeys(
      entry,
      ['reference', 'digest', 'archive', 'platform', 'arch', 'sha256', 'size'],
      'Images metadata entry',
    )
    if (
      entry.reference !== references[kind]
      || entry.archive !== artifactNames[kind]
      || entry.platform !== 'linux'
      || entry.arch !== 'x64'
    ) {
      throw new Error('Images metadata entry identity is invalid')
    }
    images[kind] = deepFreeze({
      reference: entry.reference,
      digest: assertPattern(entry.digest, sha256DigestPattern, 'Image digest'),
      archive: entry.archive,
      platform: 'linux',
      arch: 'x64',
      sha256: assertPattern(
        entry.sha256,
        sha256DigestPattern,
        'Image archive hash',
      ),
      size: assertPositiveInteger(entry.size, 'Image archive size'),
    })
  }
  return deepFreeze({ server: images.server, web: images.web })
}

async function readRuntimeMetadata(dependencies) {
  const { env, processRef } = dependencies
  if (
    env.QIANSHU_RUNNER_IMAGE !== 'ubuntu-24.04'
    || env.ImageOS !== 'ubuntu24'
    || env.RUNNER_OS !== 'Linux'
    || env.RUNNER_ARCH !== 'X64'
    || processRef.platform !== 'linux'
    || processRef.arch !== 'x64'
  ) {
    throw new Error('Release runner metadata is invalid')
  }
  const node = assertPattern(
    processRef.versions.node,
    stableVersionPattern,
    'Node.js version',
  )
  const pnpmOutput = await dependencies.runCapture('pnpm', ['--version'], {
    cwd: dependencies.repositoryRoot,
    env,
  })
  const pnpm = String(pnpmOutput).trim()
  assertPattern(pnpm, stableVersionPattern, 'pnpm version')
  const lddOutput = await dependencies.runCapture('ldd', ['--version'], {
    cwd: dependencies.repositoryRoot,
    env,
  })
  const firstLine = String(lddOutput).split('\n', 1)[0]
  if (!/\b(?:GLIBC|GNU C Library)\b/iu.test(firstLine)) {
    throw new Error('Release libc is unsupported')
  }
  const versionMatch = /\s([0-9]+\.[0-9]+(?:\.[0-9]+)?)\s*$/u.exec(firstLine)
  if (!versionMatch) {
    throw new Error('Release libc version is invalid')
  }
  return deepFreeze({
    node,
    pnpm,
    runnerImage: 'ubuntu-24.04',
    os: 'linux',
    arch: 'x64',
    libc: 'glibc',
    libcVersion: versionMatch[1],
  })
}

function utcCreatedAt(now) {
  const value = now()
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error('Release creation time is invalid')
  }
  return date.toISOString()
}

function expectedArtifactNames(tag) {
  return {
    web: `qsmds-web-${tag}.tar.gz`,
    server: `qsmds-server-${tag}-linux-x64.tar.gz`,
  }
}

export async function createReleaseManifest(input, dependencies = {}) {
  const normalizedInput = normalizeManifestInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const release = await readReleaseMetadata(
    normalizedInput.releaseMetadataPath,
    normalizedDependencies.fileSystem,
  )
  const artifactNames = expectedArtifactNames(release.tag)
  const imageArtifactNamesForTag = imageArtifactNames(release.tag)
  if (
    path.basename(normalizedInput.webArchivePath) !== artifactNames.web
    || path.basename(normalizedInput.serverArchivePath) !== artifactNames.server
    || path.basename(normalizedInput.webImagePath) !== imageArtifactNamesForTag.web
    || path.basename(normalizedInput.serverImagePath) !== imageArtifactNamesForTag.server
    || artifactNames.web === artifactNames.server
  ) {
    throw new Error('Release archive basename is invalid')
  }

  const [
    schema,
    runtime,
    webArchive,
    serverArchive,
    webImageArchive,
    serverImageArchive,
    imagesMetadataFile,
    openapi,
    prismaSchema,
    migrations,
  ] =
    await Promise.all([
      loadManifestSchema(normalizedDependencies),
      readRuntimeMetadata(normalizedDependencies),
      hashStableRegularFile(
        normalizedInput.webArchivePath,
        normalizedDependencies.fileSystem,
        'Web archive',
      ),
      hashStableRegularFile(
        normalizedInput.serverArchivePath,
        normalizedDependencies.fileSystem,
        'Server archive',
      ),
      hashStableRegularFile(
        normalizedInput.webImagePath,
        normalizedDependencies.fileSystem,
        'Web image archive',
      ),
      hashStableRegularFile(
        normalizedInput.serverImagePath,
        normalizedDependencies.fileSystem,
        'Server image archive',
      ),
      readStableRegularFile(
        normalizedInput.imagesMetadataPath,
        normalizedDependencies.fileSystem,
        'Images metadata',
      ),
      hashStableRegularFile(
        path.join(
          normalizedDependencies.repositoryRoot,
          'server',
          'openapi',
          'openapi.json',
        ),
        normalizedDependencies.fileSystem,
        'Server OpenAPI snapshot',
      ),
      hashStableRegularFile(
        path.join(
          normalizedDependencies.repositoryRoot,
          'server',
          'prisma',
          'schema.prisma',
        ),
        normalizedDependencies.fileSystem,
        'Prisma schema',
      ),
      collectMigrationMetadata(
        path.join(
          normalizedDependencies.repositoryRoot,
          'server',
          'prisma',
          'migrations',
        ),
        { fileSystem: normalizedDependencies.fileSystem },
      ),
    ])

  const images = normalizeImagesMetadata(
    parseJsonObject(imagesMetadataFile.bytes, 'Images metadata'),
    release.tag,
  )
  for (const [kind, archive] of [
    ['server', serverImageArchive],
    ['web', webImageArchive],
  ]) {
    // 摘要与大小必须同时吻合：只对摘要会让"元数据写了别的归档大小"漏过校验。
    if (
      images[kind].sha256 !== `sha256:${archive.sha256}`
      || images[kind].size !== archive.size
    ) {
      throw new Error('Image archive identity is invalid')
    }
  }

  const manifest = {
    schemaVersion: 1,
    release,
    build: {
      repository: normalizedInput.repository,
      workflow: normalizedInput.workflow,
      runId: normalizedInput.runId,
      runAttempt: normalizedInput.runAttempt,
      createdAt: utcCreatedAt(normalizedDependencies.now),
    },
    runtime,
    components: {
      web: {
        artifact: artifactNames.web,
        sha256: `sha256:${webArchive.sha256}`,
      },
      server: {
        artifact: artifactNames.server,
        sha256: `sha256:${serverArchive.sha256}`,
        platform: 'linux',
        arch: 'x64',
      },
    },
    images,
    contract: {
      version: release.version,
      openapiSha256: `sha256:${openapi.sha256}`,
    },
    database: {
      migrationHead: migrations.migrationHead,
      schemaSha256: `sha256:${prismaSchema.sha256}`,
      migrationsSha256: `sha256:${migrations.sha256}`,
    },
  }
  validateValueAgainstSchema(manifest, schema)
  return deepFreeze(manifest)
}

function normalizeChecksumInput(input) {
  assertExactKeys(
    input,
    ['bundleDirectory', 'fileNames'],
    'Checksum input',
  )
  if (
    !Array.isArray(input.fileNames)
    || input.fileNames.length !== checksumLineCount
    || input.fileNames.length !== new Set(input.fileNames).size
    || input.fileNames.some(name => (
      typeof name !== 'string'
      || name.length === 0
      || path.basename(name) !== name
      || name.includes('/')
      || name.includes('\\')
      || name === checksumFileName
    ))
    || input.fileNames[checksumLineCount - 1] !== manifestFileName
  ) {
    throw new TypeError('Checksum file list is invalid')
  }
  return {
    bundleDirectory: path.resolve(
      assertNonEmptyString(input.bundleDirectory, 'Bundle directory'),
    ),
    fileNames: [...input.fileNames],
  }
}

function parseChecksumDocument(contents, expectedNames) {
  if (!contents.endsWith('\n')) {
    throw new Error('SHA256SUMS format is invalid')
  }
  const lines = contents.slice(0, -1).split('\n')
  if (lines.length !== expectedNames.length) {
    throw new Error(`SHA256SUMS must contain exactly ${expectedNames.length} lines`)
  }
  return lines.map((line, index) => {
    const match = /^([0-9a-f]{64})  ([^/\\]+)$/u.exec(line)
    if (!match || match[2] !== expectedNames[index]) {
      throw new Error('SHA256SUMS format is invalid')
    }
    return deepFreeze({ sha256: match[1], fileName: match[2] })
  })
}

export async function createAndVerifyChecksums(input, dependencies = {}) {
  const normalizedInput = normalizeChecksumInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const lstat = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'lstat')
  const writeFile = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'writeFile')
  const bundleStats = await lstat(normalizedInput.bundleDirectory)
  if (bundleStats.isSymbolicLink() || !bundleStats.isDirectory()) {
    throw new Error('Release bundle must be a real directory')
  }
  const calculated = []
  for (const fileName of normalizedInput.fileNames) {
    const file = await hashStableRegularFile(
      path.join(normalizedInput.bundleDirectory, fileName),
      normalizedDependencies.fileSystem,
      'Release bundle file',
    )
    calculated.push(deepFreeze({ fileName, sha256: file.sha256 }))
  }
  const checksumPath = path.join(normalizedInput.bundleDirectory, checksumFileName)
  try {
    await lstat(checksumPath)
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }
    const contents = `${calculated.map(
      entry => `${entry.sha256}  ${entry.fileName}`,
    ).join('\n')}\n`
    await writeFile(checksumPath, contents, { flag: 'wx', mode: 0o600 })
  }
  const checksumFile = await readStableRegularFile(
    checksumPath,
    normalizedDependencies.fileSystem,
    checksumFileName,
  )
  const parsed = parseChecksumDocument(
    checksumFile.bytes.toString('utf8'),
    normalizedInput.fileNames,
  )
  for (let index = 0; index < parsed.length; index += 1) {
    if (parsed[index].sha256 !== calculated[index].sha256) {
      throw new Error('Checksum verification failed')
    }
  }
  return deepFreeze(parsed)
}

function normalizeBundleGenerationInput(input) {
  assertExactKeys(
    input,
    [
      'imagesMetadataPath',
      'outputDirectory',
      'releaseMetadataPath',
      'repository',
      'runAttempt',
      'runId',
      'serverArchivePath',
      'serverImagePath',
      'webArchivePath',
      'webImagePath',
      'workflow',
    ],
    'Bundle generation input',
  )
  const { outputDirectory, ...manifestInput } = input
  return {
    manifestInput: normalizeManifestInput(manifestInput),
    outputDirectory: path.resolve(
      assertNonEmptyString(outputDirectory, 'Bundle output directory'),
    ),
  }
}

export async function generateReleaseBundle(input, dependencies = {}) {
  const normalizedInput = normalizeBundleGenerationInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const copyFile = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'copyFile')
  const lstat = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'lstat')
  const readdir = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'readdir')
  const rm = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'rm')
  const writeFile = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'writeFile')
  const outputStats = await lstat(normalizedInput.outputDirectory)
  if (outputStats.isSymbolicLink() || !outputStats.isDirectory()) {
    throw new Error('Release bundle output must be a real directory')
  }
  if ((await readdir(normalizedInput.outputDirectory)).length !== 0) {
    throw new Error('Release bundle output directory must be empty')
  }

  const createdPaths = []
  try {
    const manifest = await createReleaseManifest(
      normalizedInput.manifestInput,
      normalizedDependencies,
    )
    const sourcePaths = [
      normalizedInput.manifestInput.webArchivePath,
      normalizedInput.manifestInput.serverArchivePath,
      normalizedInput.manifestInput.webImagePath,
      normalizedInput.manifestInput.serverImagePath,
    ]
    const fileNames = [
      manifest.components.web.artifact,
      manifest.components.server.artifact,
      manifest.images.web.archive,
      manifest.images.server.archive,
      manifestFileName,
    ]
    const expectedDigests = [
      manifest.components.web.sha256.slice('sha256:'.length),
      manifest.components.server.sha256.slice('sha256:'.length),
      manifest.images.web.sha256.slice('sha256:'.length),
      manifest.images.server.sha256.slice('sha256:'.length),
    ]
    for (let index = 0; index < sourcePaths.length; index += 1) {
      const destination = path.join(normalizedInput.outputDirectory, fileNames[index])
      await copyFile(sourcePaths[index], destination, fsConstants.COPYFILE_EXCL)
      createdPaths.push(destination)
      const copied = await hashStableRegularFile(
        destination,
        normalizedDependencies.fileSystem,
        'Copied release archive',
      )
      if (copied.sha256 !== expectedDigests[index]) {
        throw new Error('Copied release archive digest differs')
      }
    }
    const manifestPath = path.join(normalizedInput.outputDirectory, manifestFileName)
    await writeFile(manifestPath, canonicalJson(manifest), { flag: 'wx', mode: 0o600 })
    createdPaths.push(manifestPath)
    const checksums = await createAndVerifyChecksums(
      { bundleDirectory: normalizedInput.outputDirectory, fileNames },
      normalizedDependencies,
    )
    createdPaths.push(path.join(normalizedInput.outputDirectory, checksumFileName))
    return deepFreeze({ manifest, checksums })
  } catch (error) {
    for (const createdPath of createdPaths.reverse()) {
      await rm(createdPath, { force: true })
    }
    // SHA256SUMS 可能在内部校验失败后已写入，但尚未加入 createdPaths。
    await rm(
      path.join(normalizedInput.outputDirectory, checksumFileName),
      { force: true },
    )
    throw error
  }
}

function normalizeVerifyInput(input) {
  assertExactKeys(
    input,
    [
      'bundleDirectory',
      'bundleRunAttempt',
      'releaseMetadataPath',
      'repository',
      'runId',
    ],
    'Bundle verification input',
  )
  return {
    bundleDirectory: path.resolve(
      assertNonEmptyString(input.bundleDirectory, 'Bundle directory'),
    ),
    bundleRunAttempt: assertPositiveInteger(
      input.bundleRunAttempt,
      'Bundle run attempt',
    ),
    releaseMetadataPath: path.resolve(
      assertNonEmptyString(input.releaseMetadataPath, 'Release metadata path'),
    ),
    repository: assertPattern(input.repository, repositoryPattern, 'Repository'),
    runId: assertPattern(input.runId, positiveDigitsPattern, 'Run ID'),
  }
}

export async function verifyReleaseBundle(input, dependencies = {}) {
  const normalizedInput = normalizeVerifyInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const lstat = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'lstat')
  const readdir = resolveFileSystemMethod(normalizedDependencies.fileSystem, 'readdir')
  const release = await readReleaseMetadata(
    normalizedInput.releaseMetadataPath,
    normalizedDependencies.fileSystem,
  )
  const names = expectedArtifactNames(release.tag)
  const imageNames = imageArtifactNames(release.tag)
  const expectedFiles = [
    names.web,
    names.server,
    imageNames.web,
    imageNames.server,
    manifestFileName,
    checksumFileName,
  ]
  const bundleStats = await lstat(normalizedInput.bundleDirectory)
  if (bundleStats.isSymbolicLink() || !bundleStats.isDirectory()) {
    throw new Error('Release bundle must be a real directory')
  }
  const actualFiles = await readdir(normalizedInput.bundleDirectory)
  actualFiles.sort(codePointCompare)
  const sortedExpected = [...expectedFiles].sort(codePointCompare)
  if (
    actualFiles.length !== sortedExpected.length
    || actualFiles.some((name, index) => name !== sortedExpected[index])
  ) {
    throw new Error('Release bundle file set is invalid')
  }
  for (const name of expectedFiles) {
    const stats = await lstat(path.join(normalizedInput.bundleDirectory, name))
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0) {
      throw new Error('Release bundle contains an unsupported entry')
    }
  }

  const checksums = await createAndVerifyChecksums(
    {
      bundleDirectory: normalizedInput.bundleDirectory,
      fileNames: [
        names.web,
        names.server,
        imageNames.web,
        imageNames.server,
        manifestFileName,
      ],
    },
    normalizedDependencies,
  )
  const manifestFile = await hashStableRegularFile(
    path.join(normalizedInput.bundleDirectory, manifestFileName),
    normalizedDependencies.fileSystem,
    'Release Manifest',
  )
  if (manifestFile.sha256 !== checksums[checksumLineCount - 1].sha256) {
    throw new Error('Checksum verification failed')
  }
  const manifest = parseJsonObject(manifestFile.bytes, 'Release Manifest')
  const schema = await loadManifestSchema(normalizedDependencies)
  validateValueAgainstSchema(manifest, schema)

  if (
    JSON.stringify(manifest.release) !== JSON.stringify(release)
    || manifest.build.repository !== normalizedInput.repository
    || manifest.build.runId !== normalizedInput.runId
    || manifest.build.runAttempt !== normalizedInput.bundleRunAttempt
    || manifest.components.web.artifact !== names.web
    || manifest.components.server.artifact !== names.server
    || manifest.images.web.archive !== imageNames.web
    || manifest.images.server.archive !== imageNames.server
    || manifest.contract.version !== release.version
  ) {
    throw new Error('Release bundle identity is invalid')
  }
  const web = await hashStableRegularFile(
    path.join(normalizedInput.bundleDirectory, names.web),
    normalizedDependencies.fileSystem,
    'Web archive',
  )
  const server = await hashStableRegularFile(
    path.join(normalizedInput.bundleDirectory, names.server),
    normalizedDependencies.fileSystem,
    'Server archive',
  )
  const webImage = await hashStableRegularFile(
    path.join(normalizedInput.bundleDirectory, imageNames.web),
    normalizedDependencies.fileSystem,
    'Web image archive',
  )
  const serverImage = await hashStableRegularFile(
    path.join(normalizedInput.bundleDirectory, imageNames.server),
    normalizedDependencies.fileSystem,
    'Server image archive',
  )
  if (
    manifest.components.web.sha256 !== `sha256:${web.sha256}`
    || manifest.components.server.sha256 !== `sha256:${server.sha256}`
    || manifest.images.web.sha256 !== `sha256:${webImage.sha256}`
    || manifest.images.server.sha256 !== `sha256:${serverImage.sha256}`
    || manifest.images.web.size !== webImage.size
    || manifest.images.server.size !== serverImage.size
    || web.sha256 !== checksums[0].sha256
    || server.sha256 !== checksums[1].sha256
    || webImage.sha256 !== checksums[2].sha256
    || serverImage.sha256 !== checksums[3].sha256
  ) {
    throw new Error('Release archive identity is invalid')
  }
  return deepFreeze({ manifest, checksums })
}

function parseFlagPairs(argv, expectedFlags, usage) {
  if (argv.length !== expectedFlags.length * 2) {
    throw new TypeError(usage)
  }
  const values = {}
  for (let index = 0; index < expectedFlags.length; index += 1) {
    const flag = argv[index * 2]
    const value = argv[index * 2 + 1]
    if (flag !== expectedFlags[index] || typeof value !== 'string' || value.length === 0) {
      throw new TypeError(usage)
    }
    values[flag] = value
  }
  return values
}

export function parseReleaseManifestArguments(argv, cwd = process.cwd()) {
  if (!Array.isArray(argv)) {
    throw new TypeError('Release Manifest arguments must be an array')
  }
  const generateFlags = [
    '--release-metadata',
    '--repository',
    '--workflow',
    '--run-id',
    '--run-attempt',
    '--web-archive',
    '--server-archive',
    '--web-image',
    '--server-image',
    '--images-metadata',
    '--output',
  ]
  const generateUsage = 'Usage: release-manifest --release-metadata file --repository owner/repo --workflow file --run-id digits --run-attempt positive-int --web-archive file --server-archive file --web-image file --server-image file --images-metadata file --output directory'
  if (argv[0] !== 'verify') {
    const values = parseFlagPairs(argv, generateFlags, generateUsage)
    return deepFreeze({
      command: 'generate',
      input: {
        imagesMetadataPath: path.resolve(cwd, values['--images-metadata']),
        releaseMetadataPath: path.resolve(cwd, values['--release-metadata']),
        repository: assertPattern(
          values['--repository'],
          repositoryPattern,
          'Repository',
        ),
        workflow: assertPattern(values['--workflow'], workflowPattern, 'Workflow'),
        runId: assertPattern(values['--run-id'], positiveDigitsPattern, 'Run ID'),
        runAttempt: parsePositiveInteger(values['--run-attempt'], 'Run attempt'),
        webArchivePath: path.resolve(cwd, values['--web-archive']),
        serverArchivePath: path.resolve(cwd, values['--server-archive']),
        webImagePath: path.resolve(cwd, values['--web-image']),
        serverImagePath: path.resolve(cwd, values['--server-image']),
        outputDirectory: path.resolve(cwd, values['--output']),
      },
    })
  }

  const verifyFlags = [
    '--bundle',
    '--release-metadata',
    '--repository',
    '--run-id',
    '--bundle-run-attempt',
  ]
  const verifyUsage = 'Usage: release-manifest verify --bundle directory --release-metadata file --repository owner/repo --run-id digits --bundle-run-attempt positive-int'
  const values = parseFlagPairs(argv.slice(1), verifyFlags, verifyUsage)
  return deepFreeze({
    command: 'verify',
    input: {
      bundleDirectory: path.resolve(cwd, values['--bundle']),
      releaseMetadataPath: path.resolve(cwd, values['--release-metadata']),
      repository: assertPattern(
        values['--repository'],
        repositoryPattern,
        'Repository',
      ),
      runId: assertPattern(values['--run-id'], positiveDigitsPattern, 'Run ID'),
      bundleRunAttempt: parsePositiveInteger(
        values['--bundle-run-attempt'],
        'Bundle run attempt',
      ),
    },
  })
}

export async function runReleaseManifestCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  dependencies = {},
  stdout = process.stdout,
} = {}) {
  if (typeof stdout?.write !== 'function') {
    throw new TypeError('Release Manifest stdout must provide write()')
  }
  const parsed = parseReleaseManifestArguments(argv, cwd)
  const result = parsed.command === 'generate'
    ? await generateReleaseBundle(parsed.input, dependencies)
    : await verifyReleaseBundle(parsed.input, dependencies)
  stdout.write(canonicalJson(result))
  return result
}

if (isDirectEntry(import.meta.url)) {
  runReleaseManifestCli().catch(error => {
    applyFailureToProcess(error)
  })
}
