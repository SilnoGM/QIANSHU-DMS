import { execFile } from 'node:child_process'
import * as defaultFileSystem from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  CommandExecutionError,
  getTrustedCommandExitCode,
  isDirectEntry,
} from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultRepositoryRoot = path.resolve(scriptsDirectory, '..')
const fullShaPattern = /^[0-9a-f]{40}$/u
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const gitOutputLimit = 16 * 1024 * 1024
const productFiles = Object.freeze({
  root: 'package.json',
  server: 'server/package.json',
  serverOpenApi: 'server/openapi/openapi.json',
  webApp: 'web/apps/qsmds-arco/package.json',
  webOpenApi: 'web/openapi/openapi.json',
})

export const STABLE_TAG_PATTERN = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u

// 面向业务用户的 Release 文案由 release/notes/<tag>.md 承载，必须在打 Tag 之前就已提交。
// Tag 文案面向开发者、允许技术名词；这份文件面向不懂技术的用户，因此禁止技术词汇与代码痕迹。
const releaseNotesDirectory = path.join('release', 'notes')
const ownershipMarkerPrefix = '<!-- qianshu-release:'
const forbiddenReleaseNotesAsciiPattern = /\b(?:API|SQL|PR|commit|issue|token|Vue|React|Arco|NestJS|PostgreSQL|Postgres|Redis|Docker|nginx|ffmpeg|ffprobe|Prisma|TypeScript|Node|pnpm|COS)\b/iu
const forbiddenReleaseNotesChineseTerms = Object.freeze([
  '接口',
  '字段',
  '数据库',
  '缓存',
  '构建',
  '部署',
  '环境变量',
  '重构',
  '依赖',
  '迁移',
  '容器',
  '镜像',
  '脚本',
])
const releaseNotesCodePatterns = Object.freeze([
  Object.freeze({
    label: 'a function call or identifier',
    pattern: /[A-Za-z_][A-Za-z0-9_]*\s*\(/u,
  }),
  Object.freeze({
    label: 'a file path',
    pattern: /[A-Za-z0-9_-]*[A-Za-z][A-Za-z0-9_-]*\/[A-Za-z0-9_-]+/u,
  }),
  Object.freeze({
    label: 'a file name',
    pattern: /\.(?:ts|tsx|js|mjs|cjs|json|md|sql|yml|yaml|sh|prisma)\b/u,
  }),
  Object.freeze({
    label: 'a constant name',
    pattern: /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/u,
  }),
  Object.freeze({
    label: 'a commit hash or digest',
    pattern: /\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/u,
  }),
])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  const actualKeys = Object.keys(value).sort()
  const normalizedExpectedKeys = [...expectedKeys].sort()
  if (
    actualKeys.length !== normalizedExpectedKeys.length
    || actualKeys.some(
      (key, index) => key !== normalizedExpectedKeys[index],
    )
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

function assertFullSha(value, label) {
  if (!fullShaPattern.test(value) || /^0{40}$/u.test(value)) {
    throw new TypeError(`${label} must be a full Git SHA`)
  }
  return value
}

export function parseStableVersion(value) {
  const match = stableVersionPattern.exec(value)
  if (!match) {
    throw new Error('Stable version is invalid')
  }
  const tuple = match.slice(1).map(Number)
  if (!tuple.every(Number.isSafeInteger)) {
    throw new Error('Stable version is unsafe')
  }
  return Object.freeze(tuple)
}

export function compareVersions(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index]
    }
  }
  return 0
}

function resolveFileSystemMethod(fileSystem, method) {
  const owner = typeof fileSystem?.[method] === 'function'
    ? fileSystem
    : defaultFileSystem
  return owner[method].bind(owner)
}

function normalizeRepositoryRoot(repositoryRoot) {
  if (typeof repositoryRoot !== 'string' || repositoryRoot.length === 0) {
    throw new TypeError('Repository root must be a non-empty path')
  }
  return path.resolve(repositoryRoot)
}

async function readRegularFile(fileSystem, filePath, label) {
  const lstat = resolveFileSystemMethod(fileSystem, 'lstat')
  const readFile = resolveFileSystemMethod(fileSystem, 'readFile')
  const stats = await lstat(filePath)
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size <= 0) {
    throw new Error(`${label} must be a non-empty regular file`)
  }
  return readFile(filePath)
}

function parseJson(bytes, label) {
  let document
  try {
    document = JSON.parse(Buffer.from(bytes).toString('utf8'))
  } catch {
    throw new Error(`${label} is invalid JSON`)
  }
  if (!isRecord(document)) {
    throw new Error(`${label} must contain a JSON object`)
  }
  return document
}

function readManifestVersion(document, label) {
  if (typeof document.version !== 'string') {
    throw new Error(`${label} version is invalid`)
  }
  parseStableVersion(document.version)
  return document.version
}

function readOpenApiVersion(document, label) {
  if (!isRecord(document.info) || typeof document.info.version !== 'string') {
    throw new Error(`${label} version is invalid`)
  }
  parseStableVersion(document.info.version)
  return document.info.version
}

export async function readProductVersions(fileSystem, repositoryRoot) {
  const normalizedRoot = normalizeRepositoryRoot(repositoryRoot)
  const entries = await Promise.all(
    Object.entries(productFiles).map(async ([key, relativePath]) => {
      const bytes = await readRegularFile(
        fileSystem,
        path.join(normalizedRoot, relativePath),
        `Product version source ${key}`,
      )
      return [key, bytes]
    }),
  )
  const bytesByKey = Object.fromEntries(entries)
  // 两份 snapshot 即使解析后对象与 version 都相同，只要 whitespace、换行或
  // serialization 不同也必须失败，避免 Release 校验掩盖未同步的 tracked 契约。
  if (!bytesByKey.serverOpenApi.equals(bytesByKey.webOpenApi)) {
    throw new Error('Server and Web OpenAPI snapshot bytes differ')
  }

  const versions = Object.freeze({
    root: readManifestVersion(
      parseJson(bytesByKey.root, 'Root manifest'),
      'Root manifest',
    ),
    server: readManifestVersion(
      parseJson(bytesByKey.server, 'Server manifest'),
      'Server manifest',
    ),
    serverOpenApi: readOpenApiVersion(
      parseJson(bytesByKey.serverOpenApi, 'Server OpenAPI snapshot'),
      'Server OpenAPI snapshot',
    ),
    webApp: readManifestVersion(
      parseJson(bytesByKey.webApp, 'Web app manifest'),
      'Web app manifest',
    ),
    webOpenApi: readOpenApiVersion(
      parseJson(bytesByKey.webOpenApi, 'Web OpenAPI snapshot'),
      'Web OpenAPI snapshot',
    ),
  })
  const distinctVersions = new Set(Object.values(versions))
  if (distinctVersions.size !== 1) {
    throw new Error('Product version sources must match exactly')
  }
  return versions
}

function toBuffer(value, label) {
  if (Buffer.isBuffer(value)) {
    return value
  }
  if (typeof value === 'string' || value instanceof Uint8Array) {
    return Buffer.from(value)
  }
  throw new TypeError(`${label} must be bytes`)
}

function normalizeExitCode(value) {
  return Number.isInteger(value) && value > 0 ? value : 1
}

/**
 * Git 只以 argv 形式执行并捕获有界输出。失败内容从不进入异常 message，避免
 * Tag message、路径或底层配置意外出现在 Release 日志。
 */
function runGitCommand(args, { cwd, execFileImpl = execFile } = {}) {
  return new Promise((resolve, reject) => {
    execFileImpl(
      'git',
      args,
      { cwd, encoding: 'buffer', maxBuffer: gitOutputLimit },
      (error, stdout, stderr) => {
        if (error && !Number.isInteger(error.code)) {
          reject(new CommandExecutionError('Git command failed', 1, error))
          return
        }
        resolve({
          exitCode: error ? normalizeExitCode(error.code) : 0,
          stderr: toBuffer(stderr ?? Buffer.alloc(0), 'Git stderr'),
          stdout: toBuffer(stdout ?? Buffer.alloc(0), 'Git stdout'),
        })
      },
    )
  })
}

function normalizeDependencies(dependencies = {}) {
  if (!isRecord(dependencies)) {
    throw new TypeError('Release version dependencies must be an object')
  }
  const git = dependencies.git ?? runGitCommand
  if (typeof git !== 'function') {
    throw new TypeError('Git runner must be a function')
  }
  return {
    fileSystem: dependencies.fileSystem,
    git,
    repositoryRoot: normalizeRepositoryRoot(
      dependencies.repositoryRoot ?? defaultRepositoryRoot,
    ),
  }
}

async function invokeGit(dependencies, args, allowedExitCodes = [0]) {
  const result = await dependencies.git(args, {
    cwd: dependencies.repositoryRoot,
  })
  if (!isRecord(result) || !Number.isInteger(result.exitCode)) {
    throw new TypeError('Git runner returned an unsupported result')
  }
  const normalizedResult = {
    exitCode: result.exitCode,
    stderr: toBuffer(result.stderr, 'Git stderr'),
    stdout: toBuffer(result.stdout, 'Git stdout'),
  }
  if (!allowedExitCodes.includes(normalizedResult.exitCode)) {
    throw new CommandExecutionError(
      'Git command failed',
      normalizedResult.exitCode,
    )
  }
  return normalizedResult
}

function parseSingleLine(contents, label) {
  const text = contents.toString('utf8')
  const match = /^([^\n]+)\n?$/u.exec(text)
  if (!match) {
    throw new Error(`${label} returned an invalid line`)
  }
  return match[1]
}

function parseSingleSha(contents, label) {
  return assertFullSha(parseSingleLine(contents, label), label)
}

function parseAnnotatedTagObject(contents, expectedTag) {
  const text = contents.toString('utf8')
  const separatorIndex = text.indexOf('\n\n')
  if (separatorIndex <= 0 || text.includes('\u0000')) {
    throw new Error('Annotated Tag object is invalid')
  }
  const headerLines = text.slice(0, separatorIndex).split('\n')
  const expectedFields = ['object', 'type', 'tag', 'tagger']
  const fields = new Map()
  // 不依赖 Git 的递归 peel 结果推断 Tag 类型；直接解析四个唯一 header，才能
  // 拒绝 tag -> tag -> commit 和重复 header 造成的身份歧义。
  for (const line of headerLines) {
    const spaceIndex = line.indexOf(' ')
    if (spaceIndex <= 0) {
      throw new Error('Annotated Tag object header is invalid')
    }
    const name = line.slice(0, spaceIndex)
    const value = line.slice(spaceIndex + 1)
    if (
      !expectedFields.includes(name)
      || value.length === 0
      || fields.has(name)
    ) {
      throw new Error('Annotated Tag object header is invalid')
    }
    fields.set(name, value)
  }
  if (
    fields.size !== expectedFields.length
    || expectedFields.some(field => !fields.has(field))
  ) {
    throw new Error('Annotated Tag object header is incomplete')
  }
  const target = assertFullSha(fields.get('object'), 'Annotated Tag target')
  if (fields.get('type') !== 'commit') {
    throw new Error('Annotated Tag must point directly to a commit')
  }
  if (fields.get('tag') !== expectedTag) {
    throw new Error('Annotated Tag header does not match the input tag')
  }
  const message = text.slice(separatorIndex + 2).trimEnd()
  if (message === '') {
    throw new Error('Annotated Tag message must not be empty')
  }
  return Object.freeze({ target, message })
}

function normalizeVerificationInput(input) {
  assertExactKeys(input, ['sourceCommit', 'tag'], 'Release version input')
  if (!STABLE_TAG_PATTERN.test(input.tag)) {
    throw new TypeError('Release tag must be a stable vX.Y.Z tag')
  }
  parseStableVersion(input.tag.slice(1))
  return Object.freeze({
    sourceCommit: assertFullSha(input.sourceCommit, 'Source commit'),
    tag: input.tag,
  })
}

async function verifyCurrentTag(input, dependencies) {
  const tagRef = `refs/tags/${input.tag}`
  // 前六个 Git 调用的顺序是 Release 身份协议的一部分：先证明 annotated Tag
  // 对象，再读取 object/peeled SHA，最后验证本地 origin/main 可达性。
  const type = parseSingleLine(
    (await invokeGit(dependencies, ['cat-file', '-t', tagRef])).stdout,
    'Tag object type',
  )
  if (type !== 'tag') {
    throw new Error('Release tag must be an annotated Tag object')
  }
  const tagObject = parseAnnotatedTagObject(
    (await invokeGit(dependencies, ['cat-file', 'tag', tagRef])).stdout,
    input.tag,
  )
  const tagObjectSha = parseSingleSha(
    (await invokeGit(dependencies, ['rev-parse', tagRef])).stdout,
    'Tag object SHA',
  )
  const peeledCommit = parseSingleSha(
    (await invokeGit(
      dependencies,
      ['rev-parse', `${tagRef}^{commit}`],
    )).stdout,
    'Peeled Tag commit',
  )
  if (
    tagObject.target !== peeledCommit
    || peeledCommit !== input.sourceCommit
  ) {
    throw new Error('Release tag target does not match source commit')
  }

  parseSingleSha(
    (await invokeGit(
      dependencies,
      ['rev-parse', 'refs/remotes/origin/main'],
    )).stdout,
    'origin/main',
  )
  const reachable = await invokeGit(
    dependencies,
    [
      'merge-base',
      '--is-ancestor',
      input.sourceCommit,
      'refs/remotes/origin/main',
    ],
    [0, 1],
  )
  if (reachable.exitCode !== 0) {
    throw new Error('Source commit is not reachable from origin/main')
  }
  // sourceCommit 由 Workflow 传入仍不足以证明 checkout 身份；显式核对 HEAD，
  // 防止 runner 在 Tag 校验前后切换到另一个同仓库 Commit。
  const checkoutCommit = parseSingleSha(
    (await invokeGit(dependencies, ['rev-parse', 'HEAD'])).stdout,
    'Current checkout',
  )
  if (checkoutCommit !== input.sourceCommit) {
    throw new Error('Source commit does not match the current checkout')
  }
  return Object.freeze({ tagObjectSha })
}

function assertUserFacingReleaseNotes(releaseNotes) {
  if (releaseNotes.includes(ownershipMarkerPrefix)) {
    throw new Error('Release notes must not contain the ownership marker')
  }
  const asciiMatch = releaseNotes.match(forbiddenReleaseNotesAsciiPattern)
  if (asciiMatch !== null) {
    throw new Error(
      `Release notes must not contain technical vocabulary: ${asciiMatch[0]}`,
    )
  }
  for (const term of forbiddenReleaseNotesChineseTerms) {
    if (releaseNotes.includes(term)) {
      throw new Error(
        `Release notes must not contain technical vocabulary: ${term}`,
      )
    }
  }
  for (const { label, pattern } of releaseNotesCodePatterns) {
    if (pattern.test(releaseNotes)) {
      throw new Error(`Release notes must not contain ${label}`)
    }
  }
}

async function verifyReleaseNotes(input, dependencies) {
  const notesPath = path.join(
    dependencies.repositoryRoot,
    releaseNotesDirectory,
    `${input.tag}.md`,
  )
  const bytes = await readRegularFile(
    dependencies.fileSystem,
    notesPath,
    'Release notes',
  )
  if (Buffer.from(bytes).includes(0)) {
    throw new Error('Release notes must be UTF-8 text')
  }
  const releaseNotes = Buffer.from(bytes).toString('utf8').trimEnd()
  if (releaseNotes === '') {
    throw new Error('Release notes must not be empty')
  }
  assertUserFacingReleaseNotes(releaseNotes)
  return Object.freeze({ releaseNotesPath: notesPath })
}

function parseTagList(contents) {
  const text = contents.toString('utf8')
  if (text.length === 0) {
    return []
  }
  if (!text.endsWith('\n')) {
    throw new Error('Git Tag list is invalid')
  }
  const tags = text.slice(0, -1).split('\n')
  if (tags.some(tag => tag.length === 0 || tag.includes('\u0000'))) {
    throw new Error('Git Tag list is invalid')
  }
  return tags
}

async function readHistoricalStableTag(tag, input, dependencies) {
  const tagRef = `refs/tags/${tag}`
  const type = parseSingleLine(
    (await invokeGit(dependencies, ['cat-file', '-t', tagRef])).stdout,
    'Historical Tag object type',
  )
  if (type !== 'tag') {
    throw new Error('Historical stable Tag must be annotated')
  }
  const tagObject = parseAnnotatedTagObject(
    (await invokeGit(dependencies, ['cat-file', 'tag', tagRef])).stdout,
    tag,
  )
  const peeledCommit = parseSingleSha(
    (await invokeGit(
      dependencies,
      ['rev-parse', `${tagRef}^{commit}`],
    )).stdout,
    'Historical peeled Tag commit',
  )
  if (tagObject.target !== peeledCommit) {
    throw new Error('Historical Tag must point directly to its peeled commit')
  }
  const reachable = await invokeGit(
    dependencies,
    ['merge-base', '--is-ancestor', peeledCommit, input.sourceCommit],
    [0, 1],
  )
  return reachable.exitCode === 0
    ? Object.freeze({ tag, version: parseStableVersion(tag.slice(1)) })
    : undefined
}

async function verifyVersionMonotonicity(input, dependencies) {
  const tags = parseTagList((await invokeGit(dependencies, [
    'for-each-ref',
    '--format=%(refname:strip=2)',
    'refs/tags',
  ])).stdout)
  let highestHistoricalVersion

  for (const tag of tags) {
    // prerelease 与其他非稳定命名不参与产品版本排序；一旦名字是稳定 vX.Y.Z，
    // 它就必须是可直接 peel 到 Commit 的 annotated Tag，损坏状态不得静默跳过。
    if (tag === input.tag || !STABLE_TAG_PATTERN.test(tag)) {
      continue
    }
    const historical = await readHistoricalStableTag(
      tag,
      input,
      dependencies,
    )
    if (
      historical !== undefined
      && (
        highestHistoricalVersion === undefined
        || compareVersions(
          historical.version,
          highestHistoricalVersion,
        ) > 0
      )
    ) {
      highestHistoricalVersion = historical.version
    }
  }

  const currentVersion = parseStableVersion(input.tag.slice(1))
  if (
    highestHistoricalVersion !== undefined
    && compareVersions(currentVersion, highestHistoricalVersion) <= 0
  ) {
    throw new Error('Release version must exceed historical stable versions')
  }
}

export async function verifyReleaseVersion(input, dependencies = {}) {
  const normalizedInput = normalizeVerificationInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const versions = await readProductVersions(
    normalizedDependencies.fileSystem,
    normalizedDependencies.repositoryRoot,
  )
  if (versions.root !== normalizedInput.tag.slice(1)) {
    throw new Error('Release tag must match the product version')
  }

  const { tagObjectSha } = await verifyCurrentTag(
    normalizedInput,
    normalizedDependencies,
  )
  await verifyReleaseNotes(normalizedInput, normalizedDependencies)
  await verifyVersionMonotonicity(
    normalizedInput,
    normalizedDependencies,
  )
  return Object.freeze({
    version: versions.root,
    tag: normalizedInput.tag,
    tagObjectSha,
    sourceCommit: normalizedInput.sourceCommit,
  })
}

export function parseReleaseVersionArguments(argv, cwd = process.cwd()) {
  if (!Array.isArray(argv)) {
    throw new TypeError('Release version arguments must be an array')
  }
  assertNonEmptyString(cwd, 'Invocation cwd')
  const hasOutput = argv.length === 6
  if (
    (argv.length !== 4 && !hasOutput)
    || argv[0] !== '--tag'
    || argv[2] !== '--source-commit'
    || (hasOutput && argv[4] !== '--output')
  ) {
    throw new TypeError(
      'Usage: release-version --tag vX.Y.Z --source-commit SHA [--output file]',
    )
  }
  const normalizedInput = normalizeVerificationInput({
    sourceCommit: argv[3],
    tag: argv[1],
  })
  let outputPath
  if (hasOutput) {
    const value = assertNonEmptyString(argv[5], 'Release version output path')
    if (value.startsWith('--')) {
      throw new TypeError('Release version output path is invalid')
    }
    outputPath = path.resolve(cwd, value)
  }
  return Object.freeze({
    outputPath,
    sourceCommit: normalizedInput.sourceCommit,
    tag: normalizedInput.tag,
  })
}

async function writeReleaseVersionOutput(
  outputPath,
  line,
  { env, fileSystem },
) {
  if (!isRecord(env)) {
    throw new TypeError('Environment must be an object')
  }
  const runnerTemp = assertNonEmptyString(env.RUNNER_TEMP, 'RUNNER_TEMP')
  if (path.basename(outputPath) !== 'release-version.json') {
    throw new Error('Release version output file name is invalid')
  }
  const realpath = resolveFileSystemMethod(fileSystem, 'realpath')
  const lstat = resolveFileSystemMethod(fileSystem, 'lstat')
  const writeFile = resolveFileSystemMethod(fileSystem, 'writeFile')
  const canonicalRoot = await realpath(path.resolve(runnerTemp))
  const rootStats = await lstat(canonicalRoot)
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error('RUNNER_TEMP must resolve to a real directory')
  }

  const outputDirectory = path.dirname(outputPath)
  // output 只能位于 RUNNER_TEMP 直接子目录，并要求调用者先用 mkdtemp 建立该
  // 目录。先在调用者提供的 lexical 路径上拒绝 symlink child，再比较 realpath；
  // 这样既接受 macOS /var -> /private/var 的 RUNNER_TEMP alias，也不接受由 child
  // symlink 产生的越界解释。
  const resolvedRunnerTemp = path.resolve(runnerTemp)
  const resolvedOutputDirectory = path.resolve(outputDirectory)
  if (
    path.dirname(resolvedOutputDirectory) !== resolvedRunnerTemp
  ) {
    throw new Error('Release version output escaped RUNNER_TEMP child')
  }
  const directoryStats = await lstat(resolvedOutputDirectory)
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new Error('Release version output parent must be a real directory')
  }
  const canonicalDirectory = await realpath(resolvedOutputDirectory)
  if (path.dirname(canonicalDirectory) !== canonicalRoot) {
    throw new Error('Release version output escaped RUNNER_TEMP child')
  }
  await writeFile(outputPath, line, { flag: 'wx', mode: 0o600 })
  const outputStats = await lstat(outputPath)
  if (outputStats.isSymbolicLink() || !outputStats.isFile()) {
    throw new Error('Release version output must be a regular file')
  }
}

export async function runReleaseVersionCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  fileSystem,
  git,
  repositoryRoot = defaultRepositoryRoot,
  stdout = process.stdout,
} = {}) {
  if (typeof stdout?.write !== 'function') {
    throw new TypeError('Release version stdout must provide write()')
  }
  const parsed = parseReleaseVersionArguments(argv, cwd)
  const result = await verifyReleaseVersion(
    { sourceCommit: parsed.sourceCommit, tag: parsed.tag },
    { fileSystem, git, repositoryRoot },
  )
  const line = `${JSON.stringify(result)}\n`
  if (parsed.outputPath !== undefined) {
    await writeReleaseVersionOutput(parsed.outputPath, line, {
      env,
      fileSystem,
    })
  }
  stdout.write(line)
  return result
}

function applyReleaseFailureToProcess(
  error,
  processRef = process,
  consoleRef = console,
) {
  processRef.exitCode = getTrustedCommandExitCode(error) ?? 1
  consoleRef.error('Release version check failed')
}

if (isDirectEntry(import.meta.url)) {
  runReleaseVersionCli().catch(error => {
    applyReleaseFailureToProcess(error)
  })
}
