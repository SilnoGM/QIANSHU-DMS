import { createHash } from 'node:crypto'
import * as defaultFileSystem from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { verifyReleaseBundle } from './release-manifest.mjs'
import { imageArtifactNames } from './release-images.mjs'
import {
  applyFailureToProcess,
  isDirectEntry,
} from './run-command.mjs'

const defaultApiUrl = 'https://api.github.com'
const apiVersion = '2022-11-28'
const userAgent = 'qianshu-dms-release'
const botLogin = 'github-actions[bot]'
const manifestFileName = 'release-manifest.json'
const checksumFileName = 'SHA256SUMS'
// 用户视角的 Release 文案在仓库内的固定位置：release/notes/vX.Y.Z.md
const releaseNotesDirectory = path.join('release', 'notes')
const maximumResponseBytes = 8 * 1024 * 1024
const maximumPages = 20
const digestWaits = Object.freeze([1000, 2000, 4000, 8000])
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const stableTagPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u
const fullShaPattern = /^(?!0{40}$)[0-9a-f]{40}$/u
const digestPattern = /^sha256:[0-9a-f]{64}$/u
const positiveDigitsPattern = /^[1-9]\d*$/u
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u
const clientInternals = new WeakMap()

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
  // Buffer/typed array 是上传请求的二进制叶节点，Node.js 不允许冻结含元素的 view。
  // 外层资产记录仍会被冻结，协调器也不会向二进制内容写入数据。
  if (ArrayBuffer.isView(value)) {
    return value
  }
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

function repositoryPath(repository) {
  return repository.split('/').map(encodeURIComponent).join('/')
}

function parseStableVersion(version) {
  const match = stableVersionPattern.exec(version)
  if (!match) {
    throw new TypeError('Release version is invalid')
  }
  const tuple = match.slice(1).map(Number)
  if (!tuple.every(Number.isSafeInteger)) {
    throw new TypeError('Release version is unsafe')
  }
  return tuple
}

function compareVersionTuples(left, right) {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index]
    }
  }
  return 0
}

function normalizeApiUrl(value) {
  let url
  try {
    url = new URL(assertNonEmptyString(value, 'GitHub API URL'))
  } catch {
    throw new TypeError('GitHub API URL is invalid')
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw new TypeError('GitHub API URL is invalid')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '')
  return url
}

function expectedUploadOrigins(apiUrl) {
  const origins = new Set([apiUrl.origin])
  if (apiUrl.hostname.startsWith('api.')) {
    const uploadUrl = new URL(apiUrl.origin)
    uploadUrl.hostname = `uploads.${apiUrl.hostname.slice(4)}`
    origins.add(uploadUrl.origin)
  }
  return origins
}

export class GitHubApiError extends Error {
  constructor(message, { uncertain = false } = {}) {
    // 底层网络异常可能携带 URL、header 或 token，错误边界只保留固定分类。
    super(message)
    this.name = 'GitHubApiError'
    this.uncertain = uncertain
  }
}

function statusError(status, mutation) {
  const messages = new Map([
    [401, 'GitHub API authentication failed'],
    [403, 'GitHub API authorization failed'],
    [404, 'GitHub API resource not found'],
    [409, 'GitHub API conflict'],
    [410, 'GitHub API version unavailable'],
    [422, 'GitHub API validation failed'],
  ])
  const message = messages.get(status)
    ?? (status >= 500
      ? 'GitHub API service failed'
      : 'GitHub API request failed')
  return new GitHubApiError(message, {
    uncertain: mutation && status >= 500,
  })
}

/**
 * 该 client 刻意不暴露 delete/put，也不包含任何自动重试。Mutation 的网络或
 * 5xx 结果会标记 uncertain，由上层状态机通过只读 GET 协调，而不是重复写入。
 */
export function createGitHubClient({
  apiUrl,
  token,
  fetchImpl,
  clock,
  wait,
}) {
  const normalizedApiUrl = normalizeApiUrl(apiUrl)
  if (
    typeof token !== 'string'
    || token.length === 0
    || /[\u0000-\u0020\u007f]/u.test(token)
  ) {
    throw new TypeError('GitHub token is invalid')
  }
  if (
    typeof fetchImpl !== 'function'
    || typeof clock !== 'function'
    || typeof wait !== 'function'
  ) {
    throw new TypeError('GitHub client dependencies are incomplete')
  }

  const apiBase = normalizedApiUrl.href.replace(/\/$/u, '')
  const uploadOrigins = expectedUploadOrigins(normalizedApiUrl)

  function resolveApiTarget(target) {
    assertNonEmptyString(target, 'GitHub API target')
    if (target.startsWith('/')) {
      return new URL(`${apiBase}${target}`)
    }
    let absolute
    try {
      absolute = new URL(target)
    } catch {
      throw new TypeError('GitHub API target is invalid')
    }
    if (
      absolute.origin !== normalizedApiUrl.origin
      || !absolute.pathname.startsWith(
        normalizedApiUrl.pathname === '' ? '/' : normalizedApiUrl.pathname,
      )
    ) {
      throw new TypeError('GitHub API pagination target is invalid')
    }
    return absolute
  }

  function resolveUploadTarget(target) {
    let absolute
    try {
      absolute = new URL(assertNonEmptyString(target, 'GitHub upload target'))
    } catch {
      throw new TypeError('GitHub upload target is invalid')
    }
    if (
      absolute.protocol !== 'https:'
      || absolute.username !== ''
      || absolute.password !== ''
      || !uploadOrigins.has(absolute.origin)
    ) {
      throw new TypeError('GitHub upload target is invalid')
    }
    return absolute
  }

  async function request(method, target, { json, bytes, contentType } = {}) {
    const mutation = method !== 'GET'
    const url = bytes === undefined
      ? resolveApiTarget(target)
      : resolveUploadTarget(target)
    const headers = new Headers({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'User-Agent': userAgent,
      'X-GitHub-Api-Version': apiVersion,
    })
    let body
    if (json !== undefined) {
      body = JSON.stringify(json)
      headers.set('Content-Type', 'application/json')
    } else if (bytes !== undefined) {
      body = Buffer.from(bytes)
      headers.set('Content-Type', contentType)
      headers.set('Content-Length', String(body.length))
    }

    let response
    try {
      response = await fetchImpl(url.href, { method, headers, body })
    } catch {
      throw new GitHubApiError('GitHub API network failed', {
        uncertain: mutation,
      })
    }
    if (
      !isRecord(response)
      || !Number.isInteger(response.status)
      || typeof response.text !== 'function'
      || typeof response.headers?.get !== 'function'
    ) {
      throw new GitHubApiError('GitHub API response is invalid', {
        uncertain: mutation,
      })
    }
    const expectedStatus = method === 'GET' || method === 'PATCH' ? 200 : 201
    if (response.status !== expectedStatus) {
      throw statusError(response.status, mutation)
    }
    let text
    try {
      text = await response.text()
    } catch {
      throw new GitHubApiError('GitHub API response is invalid', {
        uncertain: mutation,
      })
    }
    if (
      typeof text !== 'string'
      || Buffer.byteLength(text) > maximumResponseBytes
    ) {
      throw new GitHubApiError('GitHub API response is invalid', {
        uncertain: mutation,
      })
    }
    let data
    try {
      data = JSON.parse(text)
    } catch {
      throw new GitHubApiError('GitHub API response is invalid', {
        uncertain: mutation,
      })
    }
    if (!isRecord(data) && !Array.isArray(data)) {
      throw new GitHubApiError('GitHub API response is invalid', {
        uncertain: mutation,
      })
    }
    return Object.freeze({
      data: deepFreeze(data),
      headers: response.headers,
      status: response.status,
    })
  }

  const client = Object.freeze({
    get: target => request('GET', target),
    post: (target, json) => request('POST', target, { json }),
    patch: (target, json) => request('PATCH', target, { json }),
    upload: (target, bytes, { contentType }) => request(
      'POST',
      target,
      { bytes, contentType },
    ),
  })
  clientInternals.set(client, Object.freeze({
    apiBase,
    apiUrl: normalizedApiUrl,
    clock,
    uploadOrigins,
    wait,
  }))
  return client
}

function requireClientInternals(client) {
  const internals = clientInternals.get(client)
  if (internals === undefined) {
    throw new TypeError('GitHub client is invalid')
  }
  return internals
}

function parseNextLink(header) {
  if (header === null || header === '') {
    return undefined
  }
  if (typeof header !== 'string') {
    throw new GitHubApiError('GitHub pagination is invalid')
  }
  const links = header.split(',').map(part => part.trim())
  let next
  for (const link of links) {
    const match = /^<([^<>]+)>;\s*rel="([a-z]+)"$/u.exec(link)
    if (!match) {
      throw new GitHubApiError('GitHub pagination is invalid')
    }
    if (match[2] === 'next') {
      if (next !== undefined) {
        throw new GitHubApiError('GitHub pagination is invalid')
      }
      next = match[1]
    }
  }
  return next
}

async function readAllPages(client, initialTarget) {
  requireClientInternals(client)
  const seen = new Set()
  const items = []
  let target = initialTarget
  for (let page = 0; page < maximumPages; page += 1) {
    if (seen.has(target)) {
      throw new GitHubApiError('GitHub pagination loop detected')
    }
    seen.add(target)
    const response = await client.get(target)
    if (!Array.isArray(response.data)) {
      throw new GitHubApiError('GitHub paginated response is invalid')
    }
    items.push(...response.data)
    const next = parseNextLink(response.headers.get('link'))
    if (next === undefined) {
      return items
    }
    // client.get 会再次验证 origin 和 API base；这里只负责 seen/max 页边界。
    target = next
  }
  throw new GitHubApiError('GitHub pagination limit exceeded')
}

function normalizeRemoteTagExpected(expected) {
  assertExactKeys(
    expected,
    ['repository', 'tag', 'sourceCommit', 'tagObjectSha'],
    'Remote Tag expectation',
  )
  const repository = assertPattern(
    expected.repository,
    repositoryPattern,
    'Repository',
  )
  const tag = assertPattern(expected.tag, stableTagPattern, 'Release tag')
  return {
    repository,
    tag,
    sourceCommit: assertPattern(
      expected.sourceCommit,
      fullShaPattern,
      'Source commit',
    ),
    tagObjectSha: assertPattern(
      expected.tagObjectSha,
      fullShaPattern,
      'Tag object SHA',
    ),
  }
}

/**
 * main...sourceCommit 只有 behind/identical 且 merge base 等于 sourceCommit
 * 才能证明发布 Commit 可从 main 到达；ahead/diverged 都必须安全失败。
 */
export async function verifyRemoteReleaseTag(client, expected) {
  const normalized = normalizeRemoteTagExpected(expected)
  const repo = repositoryPath(normalized.repository)
  const refResponse = await client.get(
    `/repos/${repo}/git/ref/tags/${encodeURIComponent(normalized.tag)}`,
  )
  const ref = refResponse.data
  if (
    !isRecord(ref)
    || ref.ref !== `refs/tags/${normalized.tag}`
    || !isRecord(ref.object)
    || ref.object.type !== 'tag'
    || ref.object.sha !== normalized.tagObjectSha
  ) {
    throw new GitHubApiError('Remote release Tag reference is invalid')
  }
  const tagResponse = await client.get(
    `/repos/${repo}/git/tags/${normalized.tagObjectSha}`,
  )
  const tagObject = tagResponse.data
  if (
    !isRecord(tagObject)
    || tagObject.sha !== normalized.tagObjectSha
    || tagObject.tag !== normalized.tag
    || !isRecord(tagObject.object)
    || tagObject.object.type !== 'commit'
    || tagObject.object.sha !== normalized.sourceCommit
  ) {
    throw new GitHubApiError('Remote annotated Tag object is invalid')
  }

  const tagRefs = await readAllPages(
    client,
    `/repos/${repo}/git/matching-refs/tags/?per_page=100&page=1`,
  )
  const currentVersion = parseStableVersion(normalized.tag.slice(1))
  let currentCount = 0
  const stableTags = []
  for (const candidate of tagRefs) {
    if (
      !isRecord(candidate)
      || typeof candidate.ref !== 'string'
      || !isRecord(candidate.object)
    ) {
      throw new GitHubApiError('Remote stable Tag list is invalid')
    }
    const name = candidate.ref.startsWith('refs/tags/')
      ? candidate.ref.slice('refs/tags/'.length)
      : ''
    if (!stableTagPattern.test(name)) {
      continue
    }
    if (
      candidate.object.type !== 'tag'
      || !fullShaPattern.test(candidate.object.sha)
    ) {
      throw new GitHubApiError('Remote stable Tag identity is invalid')
    }
    if (name === normalized.tag) {
      currentCount += 1
      if (candidate.object.sha !== normalized.tagObjectSha) {
        throw new GitHubApiError('Remote stable Tag identity is invalid')
      }
      continue
    }
    stableTags.push({ name, tuple: parseStableVersion(name.slice(1)) })
  }
  if (currentCount !== 1) {
    throw new GitHubApiError('Remote current Tag list identity is invalid')
  }
  stableTags.sort((left, right) => compareVersionTuples(left.tuple, right.tuple))
  if (
    stableTags.some(candidate => (
      compareVersionTuples(candidate.tuple, currentVersion) >= 0
    ))
  ) {
    throw new GitHubApiError('Remote release version is not monotonic')
  }

  const compareResponse = await client.get(
    `/repos/${repo}/compare/main...${normalized.sourceCommit}`,
  )
  const comparison = compareResponse.data
  if (
    !isRecord(comparison)
    || !['behind', 'identical'].includes(comparison.status)
    || !isRecord(comparison.merge_base_commit)
    || comparison.merge_base_commit.sha !== normalized.sourceCommit
  ) {
    throw new GitHubApiError('Remote source Commit is not reachable from main')
  }
  return deepFreeze({
    version: normalized.tag.slice(1),
    tag: normalized.tag,
    tagObjectSha: normalized.tagObjectSha,
    sourceCommit: normalized.sourceCommit,
  })
}

function normalizeArtifactExpected(expected) {
  assertExactKeys(
    expected,
    [
      'repository',
      'runId',
      'bundleRunAttempt',
      'artifactId',
      'artifactDigest',
      'artifactName',
      'sourceCommit',
    ],
    'Workflow artifact expectation',
  )
  const repository = assertPattern(
    expected.repository,
    repositoryPattern,
    'Repository',
  )
  const runId = assertPattern(expected.runId, positiveDigitsPattern, 'Run ID')
  const bundleRunAttempt = assertPositiveInteger(
    expected.bundleRunAttempt,
    'Bundle run attempt',
  )
  const artifactId = assertPattern(
    expected.artifactId,
    positiveDigitsPattern,
    'Artifact ID',
  )
  const expectedName = `release-final-${runId}-${bundleRunAttempt}`
  if (expected.artifactName !== expectedName) {
    throw new TypeError('Artifact name is invalid')
  }
  return {
    repository,
    runId,
    bundleRunAttempt,
    artifactId,
    artifactDigest: assertPattern(
      expected.artifactDigest,
      digestPattern,
      'Artifact digest',
    ),
    artifactName: expectedName,
    sourceCommit: assertPattern(
      expected.sourceCommit,
      fullShaPattern,
      'Source commit',
    ),
  }
}

export async function verifyWorkflowArtifact(client, expected) {
  const normalized = normalizeArtifactExpected(expected)
  const internals = requireClientInternals(client)
  const repo = repositoryPath(normalized.repository)
  const endpoint = `/repos/${repo}/actions/artifacts/${normalized.artifactId}`
  const response = await client.get(endpoint)
  const artifact = response.data
  const expectedUrl = `${internals.apiBase}${endpoint}`
  if (
    !isRecord(artifact)
    || !Number.isSafeInteger(artifact.id)
    || String(artifact.id) !== normalized.artifactId
    || artifact.name !== normalized.artifactName
    || artifact.expired !== false
    || artifact.digest !== normalized.artifactDigest
    || artifact.url !== expectedUrl
    || !isRecord(artifact.workflow_run)
    || !Number.isSafeInteger(artifact.workflow_run.id)
    || String(artifact.workflow_run.id) !== normalized.runId
    || artifact.workflow_run.head_sha !== normalized.sourceCommit
    || !Number.isSafeInteger(artifact.workflow_run.repository_id)
    || artifact.workflow_run.repository_id
      !== artifact.workflow_run.head_repository_id
  ) {
    throw new GitHubApiError('Workflow artifact identity is invalid')
  }
  return deepFreeze({ ...normalized })
}

function normalizeMarkerIdentity(identity) {
  assertExactKeys(
    identity,
    [
      'schemaVersion',
      'repository',
      'tag',
      'sourceCommit',
      'runId',
      'bundleRunAttempt',
      'artifactId',
      'artifactDigest',
    ],
    'Release ownership marker',
  )
  if (identity.schemaVersion !== 1) {
    throw new TypeError('Release ownership marker schema is invalid')
  }
  return deepFreeze({
    schemaVersion: 1,
    repository: assertPattern(
      identity.repository,
      repositoryPattern,
      'Repository',
    ),
    tag: assertPattern(identity.tag, stableTagPattern, 'Release tag'),
    sourceCommit: assertPattern(
      identity.sourceCommit,
      fullShaPattern,
      'Source commit',
    ),
    runId: assertPattern(identity.runId, positiveDigitsPattern, 'Run ID'),
    bundleRunAttempt: assertPositiveInteger(
      identity.bundleRunAttempt,
      'Bundle run attempt',
    ),
    artifactId: assertPattern(
      identity.artifactId,
      positiveDigitsPattern,
      'Artifact ID',
    ),
    artifactDigest: assertPattern(
      identity.artifactDigest,
      digestPattern,
      'Artifact digest',
    ),
  })
}

const ownershipMarkerPrefix = '<!-- qianshu-release:'

export function createOwnershipMarker(identity) {
  const normalized = normalizeMarkerIdentity(identity)
  return `${ownershipMarkerPrefix}${JSON.stringify(normalized)} -->`
}

// Release 正文固定为「机器标记 + 用户视角文案」：标记供所有权校验，文案供业务用户阅读。
// 用户文案来自独立的 release/notes/<tag>.md，与面向开发者的 Tag 文案互不复用。
export function createReleaseBody(identity, releaseNotes) {
  return `${createOwnershipMarker(identity)}\n\n${releaseNotes}\n`
}

export function parseOwnershipMarker(body) {
  if (typeof body !== 'string') {
    throw new TypeError('Release ownership marker body is invalid')
  }
  const prefix = ownershipMarkerPrefix
  const prefixCount = body.split(prefix).length - 1
  const matches = [...body.matchAll(
    /<!-- qianshu-release:(\{[^\r\n]*\}) -->/gu,
  )]
  if (prefixCount !== 1 || matches.length !== 1) {
    throw new TypeError('Release ownership marker count is invalid')
  }
  let parsed
  try {
    parsed = JSON.parse(matches[0][1])
  } catch {
    throw new TypeError('Release ownership marker JSON is invalid')
  }
  const normalized = normalizeMarkerIdentity(parsed)
  if (JSON.stringify(normalized) !== matches[0][1]) {
    throw new TypeError('Release ownership marker is not canonical')
  }
  return normalized
}

function normalizeCoordinateInput(input) {
  assertExactKeys(
    input,
    [
      'repository',
      'tag',
      'sourceCommit',
      'runId',
      'bundleRunAttempt',
      'currentRunAttempt',
      'artifactId',
      'artifactDigest',
      'artifactName',
      'bundleDirectory',
      'releaseNotesPath',
    ],
    'Release coordination input',
  )
  const artifact = normalizeArtifactExpected({
    repository: input.repository,
    runId: input.runId,
    bundleRunAttempt: input.bundleRunAttempt,
    artifactId: input.artifactId,
    artifactDigest: input.artifactDigest,
    artifactName: input.artifactName,
    sourceCommit: input.sourceCommit,
  })
  const tag = assertPattern(input.tag, stableTagPattern, 'Release tag')
  const currentRunAttempt = assertPositiveInteger(
    input.currentRunAttempt,
    'Current run attempt',
  )
  if (currentRunAttempt < artifact.bundleRunAttempt) {
    throw new TypeError('Current run attempt precedes bundle generation')
  }
  return deepFreeze({
    ...artifact,
    tag,
    currentRunAttempt,
    bundleDirectory: path.resolve(
      assertNonEmptyString(input.bundleDirectory, 'Bundle directory'),
    ),
    releaseNotesPath: path.resolve(
      assertNonEmptyString(input.releaseNotesPath, 'Release notes path'),
    ),
  })
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

async function readStableRegularFile(filePath, fileSystem, label) {
  const lstat = resolveFileSystemMethod(fileSystem, 'lstat')
  const readFile = resolveFileSystemMethod(fileSystem, 'readFile')
  const before = await lstat(filePath)
  if (before.isSymbolicLink() || !before.isFile() || before.size <= 0) {
    throw new Error(`${label} must be a non-empty regular file`)
  }
  const identity = statsIdentity(before)
  const bytes = Buffer.from(await readFile(filePath))
  const after = await lstat(filePath)
  if (!sameIdentity(after, identity) || bytes.length !== identity.size) {
    throw new Error('Release bundle file changed while reading')
  }
  return {
    bytes,
    size: bytes.length,
    digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  }
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

function normalizeDependencies(dependencies = {}) {
  if (!isRecord(dependencies)) {
    throw new TypeError('Release coordination dependencies must be an object')
  }
  const clock = dependencies.clock ?? Date.now
  const wait = dependencies.wait ?? (milliseconds => new Promise(resolve => {
    setTimeout(resolve, milliseconds)
  }))
  const fetchImpl = dependencies.fetchImpl ?? globalThis.fetch
  const verifyBundle = dependencies.verifyBundle ?? verifyReleaseBundle
  if (
    typeof clock !== 'function'
    || typeof wait !== 'function'
    || typeof fetchImpl !== 'function'
    || typeof verifyBundle !== 'function'
  ) {
    throw new TypeError('Release coordination dependencies are incomplete')
  }
  return {
    apiUrl: dependencies.apiUrl ?? defaultApiUrl,
    clock,
    fetchImpl,
    fileSystem: dependencies.fileSystem,
    schemaPath: dependencies.schemaPath,
    temporaryRoot: path.resolve(dependencies.temporaryRoot ?? os.tmpdir()),
    token: assertNonEmptyString(dependencies.token, 'GitHub token'),
    verifyBundle,
    wait,
  }
}

async function verifyLocalBundle(input, dependencies) {
  const manifestPath = path.join(input.bundleDirectory, manifestFileName)
  const manifestPreflight = await readStableRegularFile(
    manifestPath,
    dependencies.fileSystem,
    'Release Manifest',
  )
  const preflight = parseJsonObject(
    manifestPreflight.bytes,
    'Release Manifest',
  )
  if (
    !isRecord(preflight.release)
    || typeof preflight.release.version !== 'string'
    || typeof preflight.release.tag !== 'string'
    || typeof preflight.release.tagObjectSha !== 'string'
    || typeof preflight.release.sourceCommit !== 'string'
  ) {
    throw new Error('Release Manifest identity is invalid')
  }
  const releaseMetadata = {
    version: preflight.release.version,
    tag: preflight.release.tag,
    tagObjectSha: preflight.release.tagObjectSha,
    sourceCommit: preflight.release.sourceCommit,
  }
  const mkdtemp = resolveFileSystemMethod(dependencies.fileSystem, 'mkdtemp')
  const rm = resolveFileSystemMethod(dependencies.fileSystem, 'rm')
  const writeFile = resolveFileSystemMethod(dependencies.fileSystem, 'writeFile')
  const temporaryDirectory = await mkdtemp(
    path.join(dependencies.temporaryRoot, 'qianshu-release-github-'),
  )
  const releaseMetadataPath = path.join(
    temporaryDirectory,
    'release-version.json',
  )
  try {
    await writeFile(
      releaseMetadataPath,
      canonicalJson(releaseMetadata),
      { flag: 'wx', mode: 0o600 },
    )
    const verified = await dependencies.verifyBundle(
      {
        bundleDirectory: input.bundleDirectory,
        bundleRunAttempt: input.bundleRunAttempt,
        releaseMetadataPath,
        repository: input.repository,
        runId: input.runId,
      },
      {
        fileSystem: dependencies.fileSystem,
        schemaPath: dependencies.schemaPath,
      },
    )
    const manifest = verified?.manifest
    if (
      !isRecord(manifest)
      || manifest.release.tag !== input.tag
      || manifest.release.sourceCommit !== input.sourceCommit
      || manifest.build.repository !== input.repository
      || manifest.build.runId !== input.runId
      || manifest.build.runAttempt !== input.bundleRunAttempt
    ) {
      throw new Error('Release Manifest identity is invalid')
    }
    return manifest
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

function assetNames(tag) {
  const imageNames = imageArtifactNames(tag)
  return [
    `qsmds-web-${tag}.tar.gz`,
    `qsmds-server-${tag}-linux-x64.tar.gz`,
    imageNames.web,
    imageNames.server,
    manifestFileName,
    checksumFileName,
  ]
}

function contentTypeFor(name) {
  if (name.endsWith('.tar.gz')) {
    return 'application/gzip'
  }
  if (name.endsWith('.json')) {
    return 'application/json'
  }
  return 'text/plain'
}

async function readLocalAssets(input, dependencies) {
  const assets = []
  for (const name of assetNames(input.tag)) {
    const file = await readStableRegularFile(
      path.join(input.bundleDirectory, name),
      dependencies.fileSystem,
      'Release asset',
    )
    assets.push(deepFreeze({
      name,
      path: path.join(input.bundleDirectory, name),
      size: file.size,
      digest: file.digest,
      bytes: file.bytes,
      contentType: contentTypeFor(name),
    }))
  }
  return assets
}

function sameMarker(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

// 用户视角的 Release 文案来自版本准备阶段提交的 release/notes/<tag>.md。
// 文件必须随 Tag 一起进入被发布的提交；缺失、为空、含所有权标记或不是 UTF-8 文本
// 都在创建 Draft 之前失败关闭，避免发出没有用户文案或所有权标记被破坏的 Release。
async function readReleaseNotes(input, dependencies) {
  const file = await readStableRegularFile(
    input.releaseNotesPath,
    dependencies.fileSystem,
    'Release notes',
  )
  if (file.bytes.includes(0)) {
    throw new Error('Release notes must be UTF-8 text')
  }
  const releaseNotes = file.bytes.toString('utf8').trimEnd()
  if (releaseNotes === '') {
    throw new Error('Release notes must not be empty')
  }
  if (releaseNotes.includes(ownershipMarkerPrefix)) {
    throw new Error('Release notes must not contain the ownership marker')
  }
  return releaseNotes
}

async function listReleases(client, repository) {
  return readAllPages(
    client,
    `/repos/${repositoryPath(repository)}/releases?per_page=100&page=1`,
  )
}

function findReleaseForTag(releases, tag) {
  const matches = releases.filter(release => (
    isRecord(release) && release.tag_name === tag
  ))
  if (matches.length > 1) {
    throw new GitHubApiError('Duplicate GitHub Releases use the same Tag')
  }
  return matches[0]
}

function validateUploadTemplate(client, release, repository) {
  const internals = requireClientInternals(client)
  if (typeof release.upload_url !== 'string') {
    throw new GitHubApiError('Draft Release upload URL is invalid')
  }
  let uploadUrl
  try {
    uploadUrl = new URL(release.upload_url.replace('{?name,label}', ''))
  } catch {
    throw new GitHubApiError('Draft Release upload URL is invalid')
  }
  const expectedPath = `/repos/${repositoryPath(repository)}/releases/${release.id}/assets`
  if (
    !release.upload_url.endsWith(`${expectedPath}{?name,label}`)
    || uploadUrl.pathname !== expectedPath
    || uploadUrl.search !== ''
    || uploadUrl.hash !== ''
    || !internals.uploadOrigins.has(uploadUrl.origin)
  ) {
    throw new GitHubApiError('Draft Release upload URL is invalid')
  }
  return uploadUrl.href
}

function validateReleaseOwnership(
  client,
  release,
  expectedMarker,
  { allowPublished = false } = {},
) {
  if (
    !isRecord(release)
    || !Number.isSafeInteger(release.id)
    || release.id < 1
    || release.tag_name !== expectedMarker.tag
    || release.target_commitish !== expectedMarker.sourceCommit
    || release.prerelease !== false
    || !isRecord(release.author)
    || release.author.login !== botLogin
    || (allowPublished ? release.draft !== false : release.draft !== true)
  ) {
    throw new GitHubApiError('GitHub Release ownership is invalid')
  }
  const marker = parseOwnershipMarker(release.body)
  if (!sameMarker(marker, expectedMarker)) {
    throw new GitHubApiError('GitHub Release marker does not match bundle')
  }
  validateUploadTemplate(client, release, expectedMarker.repository)
  return release
}

async function listAssets(client, repository, releaseId) {
  return readAllPages(
    client,
    `/repos/${repositoryPath(repository)}/releases/${releaseId}/assets?per_page=100&page=1`,
  )
}

function validateAssetEntries(
  assets,
  localAssets,
  { allowMissing, allowNullDigest },
) {
  const expected = new Map(localAssets.map(asset => [asset.name, asset]))
  const seen = new Set()
  for (const asset of assets) {
    if (
      !isRecord(asset)
      || typeof asset.name !== 'string'
      || !expected.has(asset.name)
      || seen.has(asset.name)
    ) {
      throw new GitHubApiError('Release asset set is invalid')
    }
    seen.add(asset.name)
    const local = expected.get(asset.name)
    if (
      !Number.isSafeInteger(asset.id)
      || !Number.isSafeInteger(asset.size)
      || asset.size !== local.size
      || asset.state !== 'uploaded'
      || !isRecord(asset.uploader)
      || asset.uploader.login !== botLogin
      || (
        asset.digest !== local.digest
        && !(allowNullDigest && asset.digest === null)
      )
    ) {
      throw new GitHubApiError('Release asset identity is invalid')
    }
  }
  if (!allowMissing && seen.size !== expected.size) {
    throw new GitHubApiError('Release asset set is incomplete')
  }
  return seen
}

async function resolveAssetDigests(
  client,
  repository,
  releaseId,
  localAssets,
  assets,
  dependencies,
  allowMissing,
) {
  let current = assets
  validateAssetEntries(current, localAssets, {
    allowMissing,
    allowNullDigest: true,
  })
  for (const delay of digestWaits) {
    if (!current.some(asset => asset.digest === null)) {
      validateAssetEntries(current, localAssets, {
        allowMissing,
        allowNullDigest: false,
      })
      return current
    }
    const before = dependencies.clock()
    if (!Number.isFinite(before)) {
      throw new GitHubApiError('Digest verification clock is invalid')
    }
    await dependencies.wait(delay)
    const after = dependencies.clock()
    if (!Number.isFinite(after) || after < before) {
      throw new GitHubApiError('Digest verification clock is invalid')
    }
    current = await listAssets(client, repository, releaseId)
    validateAssetEntries(current, localAssets, {
      allowMissing,
      allowNullDigest: true,
    })
  }
  if (current.some(asset => asset.digest === null)) {
    throw new GitHubApiError('Release asset digest is unavailable')
  }
  validateAssetEntries(current, localAssets, {
    allowMissing,
    allowNullDigest: false,
  })
  return current
}

async function reconcileAssets(
  client,
  release,
  marker,
  localAssets,
  dependencies,
) {
  let remote = await listAssets(client, marker.repository, release.id)
  remote = await resolveAssetDigests(
    client,
    marker.repository,
    release.id,
    localAssets,
    remote,
    dependencies,
    true,
  )
  let names = validateAssetEntries(remote, localAssets, {
    allowMissing: true,
    allowNullDigest: false,
  })
  const uploadBase = validateUploadTemplate(client, release, marker.repository)

  for (const local of localAssets) {
    if (names.has(local.name)) {
      continue
    }
    const reread = await readStableRegularFile(
      local.path,
      dependencies.fileSystem,
      'Release asset',
    )
    if (reread.size !== local.size || reread.digest !== local.digest) {
      throw new Error('Release asset changed before upload')
    }
    const uploadUrl = new URL(uploadBase)
    uploadUrl.searchParams.set('name', local.name)
    try {
      await client.upload(uploadUrl.href, reread.bytes, {
        contentType: local.contentType,
      })
    } catch (error) {
      if (!(error instanceof GitHubApiError) || !error.uncertain) {
        throw error
      }
      // 上传结果不确定时只重读 asset 集合；缺失即失败，绝不重复 POST。
    }
    remote = await listAssets(client, marker.repository, release.id)
    remote = await resolveAssetDigests(
      client,
      marker.repository,
      release.id,
      localAssets,
      remote,
      dependencies,
      true,
    )
    names = validateAssetEntries(remote, localAssets, {
      allowMissing: true,
      allowNullDigest: false,
    })
    if (!names.has(local.name)) {
      throw new GitHubApiError('Release asset upload outcome is uncertain')
    }
  }
  remote = await listAssets(client, marker.repository, release.id)
  remote = await resolveAssetDigests(
    client,
    marker.repository,
    release.id,
    localAssets,
    remote,
    dependencies,
    false,
  )
  validateAssetEntries(remote, localAssets, {
    allowMissing: false,
    allowNullDigest: false,
  })
  return remote
}

async function createOrResumeDraft(client, input, marker, dependencies) {
  let releases = await listReleases(client, input.repository)
  let release = findReleaseForTag(releases, input.tag)
  if (release !== undefined) {
    if (release.draft !== true) {
      throw new GitHubApiError('Published GitHub Release already exists')
    }
    return validateReleaseOwnership(client, release, marker)
  }

  const releaseNotes = await readReleaseNotes(input, dependencies)
  const payload = {
    tag_name: input.tag,
    target_commitish: input.sourceCommit,
    name: input.tag,
    body: createReleaseBody(marker, releaseNotes),
    draft: true,
    prerelease: false,
    generate_release_notes: false,
  }
  try {
    await client.post(
      `/repos/${repositoryPath(input.repository)}/releases`,
      payload,
    )
  } catch (error) {
    if (!(error instanceof GitHubApiError) || !error.uncertain) {
      throw error
    }
    // POST 可能已经创建 Draft；不重复 POST，只以 list 的可证明状态收敛。
  }
  releases = await listReleases(client, input.repository)
  release = findReleaseForTag(releases, input.tag)
  if (release === undefined) {
    throw new GitHubApiError('Draft creation outcome is uncertain')
  }
  return validateReleaseOwnership(client, release, marker)
}

async function rereadOwnedRelease(client, input, marker, releaseId, options) {
  const releases = await listReleases(client, input.repository)
  const release = findReleaseForTag(releases, input.tag)
  if (release === undefined || release.id !== releaseId) {
    throw new GitHubApiError('GitHub Release identity changed')
  }
  return validateReleaseOwnership(client, release, marker, options)
}

export async function coordinateDraftRelease(input, dependencies = {}) {
  const normalizedInput = normalizeCoordinateInput(input)
  const normalizedDependencies = normalizeDependencies(dependencies)
  const client = createGitHubClient({
    apiUrl: normalizedDependencies.apiUrl,
    token: normalizedDependencies.token,
    fetchImpl: normalizedDependencies.fetchImpl,
    clock: normalizedDependencies.clock,
    wait: normalizedDependencies.wait,
  })

  const manifest = await verifyLocalBundle(
    normalizedInput,
    normalizedDependencies,
  )
  const marker = normalizeMarkerIdentity({
    schemaVersion: 1,
    repository: normalizedInput.repository,
    tag: normalizedInput.tag,
    sourceCommit: normalizedInput.sourceCommit,
    runId: normalizedInput.runId,
    bundleRunAttempt: normalizedInput.bundleRunAttempt,
    artifactId: normalizedInput.artifactId,
    artifactDigest: normalizedInput.artifactDigest,
  })
  const remoteExpected = {
    repository: normalizedInput.repository,
    tag: normalizedInput.tag,
    sourceCommit: normalizedInput.sourceCommit,
    tagObjectSha: manifest.release.tagObjectSha,
  }
  await verifyWorkflowArtifact(client, {
    repository: normalizedInput.repository,
    runId: normalizedInput.runId,
    bundleRunAttempt: normalizedInput.bundleRunAttempt,
    artifactId: normalizedInput.artifactId,
    artifactDigest: normalizedInput.artifactDigest,
    artifactName: normalizedInput.artifactName,
    sourceCommit: normalizedInput.sourceCommit,
  })
  const firstRemoteIdentity = await verifyRemoteReleaseTag(
    client,
    remoteExpected,
  )
  const release = await createOrResumeDraft(
    client,
    normalizedInput,
    marker,
    normalizedDependencies,
  )
  const initialLocalAssets = await readLocalAssets(
    normalizedInput,
    normalizedDependencies,
  )
  await reconcileAssets(
    client,
    release,
    marker,
    initialLocalAssets,
    normalizedDependencies,
  )

  const secondRemoteIdentity = await verifyRemoteReleaseTag(
    client,
    remoteExpected,
  )
  if (JSON.stringify(firstRemoteIdentity) !== JSON.stringify(secondRemoteIdentity)) {
    throw new GitHubApiError('Remote Tag identity changed before publish')
  }
  const rereadDraft = await rereadOwnedRelease(
    client,
    normalizedInput,
    marker,
    release.id,
  )
  const finalManifest = await verifyLocalBundle(
    normalizedInput,
    normalizedDependencies,
  )
  if (JSON.stringify(finalManifest) !== JSON.stringify(manifest)) {
    throw new Error('Release Manifest changed before publish')
  }
  const finalLocalAssets = await readLocalAssets(
    normalizedInput,
    normalizedDependencies,
  )
  if (
    finalLocalAssets.some((asset, index) => (
      asset.name !== initialLocalAssets[index].name
      || asset.size !== initialLocalAssets[index].size
      || asset.digest !== initialLocalAssets[index].digest
    ))
  ) {
    throw new Error('Release assets changed before publish')
  }
  const finalRemoteAssets = await listAssets(
    client,
    normalizedInput.repository,
    rereadDraft.id,
  )
  validateAssetEntries(finalRemoteAssets, finalLocalAssets, {
    allowMissing: false,
    allowNullDigest: false,
  })

  try {
    await client.patch(
      `/repos/${repositoryPath(normalizedInput.repository)}/releases/${release.id}`,
      { draft: false },
    )
  } catch (error) {
    if (!(error instanceof GitHubApiError) || !error.uncertain) {
      throw error
    }
    // PATCH 的网络结果不确定时只读取 Release 状态，不重复发布请求。
  }
  const published = await rereadOwnedRelease(
    client,
    normalizedInput,
    marker,
    release.id,
    { allowPublished: true },
  )
  const publishedAssets = await listAssets(
    client,
    normalizedInput.repository,
    published.id,
  )
  validateAssetEntries(publishedAssets, finalLocalAssets, {
    allowMissing: false,
    allowNullDigest: false,
  })
  return deepFreeze({ releaseId: published.id, state: 'published' })
}

function parseFlagPairs(argv, flags, usage) {
  if (argv.length !== flags.length * 2) {
    throw new TypeError(usage)
  }
  const values = {}
  for (let index = 0; index < flags.length; index += 1) {
    const flag = argv[index * 2]
    const value = argv[index * 2 + 1]
    if (
      flag !== flags[index]
      || typeof value !== 'string'
      || value.length === 0
      || value.startsWith('--')
    ) {
      throw new TypeError(usage)
    }
    values[flag] = value
  }
  return values
}

export function parseReleaseGitHubArguments(argv, cwd = process.cwd()) {
  if (!Array.isArray(argv)) {
    throw new TypeError('Release GitHub arguments must be an array')
  }
  const flags = [
    '--repository',
    '--tag',
    '--source-commit',
    '--run-id',
    '--bundle-run-attempt',
    '--current-run-attempt',
    '--artifact-id',
    '--artifact-digest',
    '--artifact-name',
    '--bundle',
  ]
  const usage = 'Usage: release-github --repository owner/repo --tag vX.Y.Z --source-commit SHA --run-id digits --bundle-run-attempt positive-int --current-run-attempt positive-int --artifact-id digits --artifact-digest sha256:hex --artifact-name name --bundle directory'
  const values = parseFlagPairs(argv, flags, usage)
  // 先用严格 Tag 模式校验，再参与路径拼接，避免非法 Tag 影响 release/notes 的解析位置。
  const releaseTag = assertPattern(values['--tag'], stableTagPattern, 'Release tag')
  return normalizeCoordinateInput({
    repository: values['--repository'],
    tag: releaseTag,
    sourceCommit: values['--source-commit'],
    runId: values['--run-id'],
    bundleRunAttempt: parsePositiveInteger(
      values['--bundle-run-attempt'],
      'Bundle run attempt',
    ),
    currentRunAttempt: parsePositiveInteger(
      values['--current-run-attempt'],
      'Current run attempt',
    ),
    artifactId: values['--artifact-id'],
    artifactDigest: values['--artifact-digest'],
    artifactName: values['--artifact-name'],
    bundleDirectory: path.resolve(cwd, values['--bundle']),
    releaseNotesPath: path.resolve(
      cwd,
      releaseNotesDirectory,
      `${releaseTag}.md`,
    ),
  })
}

export async function runReleaseGitHubCli({
  argv = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  dependencies = {},
  stdout = process.stdout,
} = {}) {
  if (!isRecord(env) || typeof stdout?.write !== 'function') {
    throw new TypeError('Release GitHub CLI dependencies are invalid')
  }
  const input = parseReleaseGitHubArguments(argv, cwd)
  const result = await coordinateDraftRelease(input, {
    ...dependencies,
    apiUrl: dependencies.apiUrl ?? env.GITHUB_API_URL ?? defaultApiUrl,
    token: dependencies.token ?? env.GITHUB_TOKEN,
  })
  stdout.write(canonicalJson(result))
  return result
}

if (isDirectEntry(import.meta.url)) {
  runReleaseGitHubCli().catch(error => {
    applyFailureToProcess(error)
  })
}
