import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { generateReleaseBundle } from './release-manifest.mjs'
import {
  coordinateDraftRelease,
  createGitHubClient,
  createOwnershipMarker,
  createReleaseBody,
  parseOwnershipMarker,
  parseReleaseGitHubArguments,
  verifyRemoteReleaseTag,
  verifyWorkflowArtifact,
} from './release-github.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const manifestSchemaPath = path.join(
  repositoryRoot,
  'release',
  'manifest.schema.json',
)
const repository = 'SilnoGM/QIANSHU-DMS'
const tag = 'v1.2.3'
const version = '1.2.3'
const sourceCommit = 'b'.repeat(40)
const tagObjectSha = 'a'.repeat(40)
// 用户视角的 Release 文案样本；写入 release/notes/<tag>.md 后由发布步骤读取。
const releaseNotes = '本版影响角色：运营人员\n\n功能新增\n- 【运营人员】用户能看到的新能力\n\n功能优化\n- 无\n\n缺陷修复\n- 无\n\n已知问题\n- 无'
const artifactDigest = `sha256:${'f'.repeat(64)}`
const runId = '123456789'
const artifactId = '456'
const bundleRunAttempt = 1
const artifactName = `release-final-${runId}-${bundleRunAttempt}`
const apiUrl = 'https://api.github.test'
const uploadOrigin = 'https://uploads.github.test'
const botLogin = 'github-actions[bot]'
const token = 'github-token-fixture-value'

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalJson(value) {
  return `${JSON.stringify(value)}\n`
}

function jsonResponse(status, data, headers = {}) {
  return {
    status,
    headers: new Headers({ 'content-type': 'application/json', ...headers }),
    async text() {
      return JSON.stringify(data)
    },
  }
}

function rawResponse(status, body, headers = {}) {
  return {
    status,
    headers: new Headers(headers),
    async text() {
      return body
    },
  }
}

function runtimeDependencies(repositoryDirectory) {
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
    repositoryRoot: repositoryDirectory,
    runCapture: async command => command === 'pnpm'
      ? '11.9.0\n'
      : 'ldd (Ubuntu GLIBC 2.39-0ubuntu8.4) 2.39\n',
    schemaPath: manifestSchemaPath,
  }
}

async function createBundleFixture(t) {
  const temporaryRoot = await fs.realpath(os.tmpdir())
  const sandbox = await fs.mkdtemp(
    path.join(temporaryRoot, 'qianshu-release-github-test-'),
  )
  const repositoryDirectory = path.join(sandbox, 'repository')
  const inputs = path.join(sandbox, 'inputs')
  const bundleDirectory = path.join(sandbox, 'final-bundle')
  const migrations = path.join(
    repositoryDirectory,
    'server',
    'prisma',
    'migrations',
  )
  await fs.mkdir(path.join(migrations, '20260710152144_init'), {
    recursive: true,
  })
  await fs.mkdir(path.join(repositoryDirectory, 'server', 'openapi'), {
    recursive: true,
  })
  await fs.mkdir(inputs)
  await fs.mkdir(bundleDirectory)
  const releaseNotesPath = path.join(
    repositoryDirectory,
    'release',
    'notes',
    `${tag}.md`,
  )
  await fs.mkdir(path.dirname(releaseNotesPath), { recursive: true })
  await fs.writeFile(releaseNotesPath, `${releaseNotes}\n`)
  await fs.writeFile(
    path.join(repositoryDirectory, 'server', 'openapi', 'openapi.json'),
    '{"openapi":"3.1.0"}\n',
  )
  await fs.writeFile(
    path.join(repositoryDirectory, 'server', 'prisma', 'schema.prisma'),
    'datasource db { provider = "postgresql" }\n',
  )
  await fs.writeFile(
    path.join(migrations, 'migration_lock.toml'),
    'provider = "postgresql"\n',
  )
  await fs.writeFile(
    path.join(migrations, '20260710152144_init', 'migration.sql'),
    'SELECT 1;\n',
  )

  const releaseMetadataPath = path.join(sandbox, 'release-version.json')
  await fs.writeFile(releaseMetadataPath, canonicalJson({
    version,
    tag,
    tagObjectSha,
    sourceCommit,
  }))
  const webArchivePath = path.join(inputs, `qsmds-web-${tag}.tar.gz`)
  const serverArchivePath = path.join(
    inputs,
    `qsmds-server-${tag}-linux-x64.tar.gz`,
  )
  await fs.writeFile(webArchivePath, 'web archive fixture\n')
  await fs.writeFile(serverArchivePath, 'server archive fixture\n')
  const webImagePath = path.join(inputs, `qsmds-web-image-${tag}-linux-x64.tar.gz`)
  const serverImagePath = path.join(
    inputs,
    `qsmds-server-image-${tag}-linux-x64.tar.gz`,
  )
  const webImageBytes = Buffer.from('web image archive fixture\n')
  const serverImageBytes = Buffer.from('server image archive fixture\n')
  await fs.writeFile(webImagePath, webImageBytes)
  await fs.writeFile(serverImagePath, serverImageBytes)
  const imagesMetadataPath = path.join(inputs, 'release-images.json')
  await fs.writeFile(imagesMetadataPath, canonicalJson({
    schemaVersion: 1,
    tag,
    images: {
      server: {
        reference: `qsmds-server:${tag}`,
        digest: `sha256:${'1'.repeat(64)}`,
        archive: `qsmds-server-image-${tag}-linux-x64.tar.gz`,
        platform: 'linux',
        arch: 'x64',
        sha256: `sha256:${sha256(serverImageBytes)}`,
        size: serverImageBytes.length,
      },
      web: {
        reference: `qsmds-web:${tag}`,
        digest: `sha256:${'2'.repeat(64)}`,
        archive: `qsmds-web-image-${tag}-linux-x64.tar.gz`,
        platform: 'linux',
        arch: 'x64',
        sha256: `sha256:${sha256(webImageBytes)}`,
        size: webImageBytes.length,
      },
    },
  }))
  await generateReleaseBundle(
    {
      imagesMetadataPath,
      releaseMetadataPath,
      repository,
      workflow: 'release.yml',
      runId,
      runAttempt: bundleRunAttempt,
      webArchivePath,
      serverArchivePath,
      webImagePath,
      serverImagePath,
      outputDirectory: bundleDirectory,
    },
    runtimeDependencies(repositoryDirectory),
  )
  t.after(() => fs.rm(sandbox, { force: true, recursive: true }))
  return {
    bundleDirectory,
    releaseMetadataPath,
    releaseNotesPath,
    repositoryDirectory,
    sandbox,
  }
}

function coordinateInput(fixture, overrides = {}) {
  return {
    repository,
    tag,
    sourceCommit,
    runId,
    bundleRunAttempt,
    currentRunAttempt: bundleRunAttempt,
    artifactId,
    artifactDigest,
    artifactName,
    bundleDirectory: fixture.bundleDirectory,
    releaseNotesPath: fixture.releaseNotesPath,
    ...overrides,
  }
}

function markerIdentity(overrides = {}) {
  return {
    schemaVersion: 1,
    repository,
    tag,
    sourceCommit,
    runId,
    bundleRunAttempt,
    artifactId,
    artifactDigest,
    ...overrides,
  }
}

function remoteTagExpected(overrides = {}) {
  return {
    repository,
    tag,
    sourceCommit,
    tagObjectSha,
    ...overrides,
  }
}

function artifactExpected(overrides = {}) {
  return {
    repository,
    runId,
    bundleRunAttempt,
    artifactId,
    artifactDigest,
    artifactName,
    sourceCommit,
    ...overrides,
  }
}

async function localAssets(bundleDirectory) {
  const names = [
    `qsmds-web-${tag}.tar.gz`,
    `qsmds-server-${tag}-linux-x64.tar.gz`,
    `qsmds-web-image-${tag}-linux-x64.tar.gz`,
    `qsmds-server-image-${tag}-linux-x64.tar.gz`,
    'release-manifest.json',
    'SHA256SUMS',
  ]
  return Promise.all(names.map(async (name, index) => {
    const bytes = await fs.readFile(path.join(bundleDirectory, name))
    return {
      id: 1000 + index,
      name,
      size: bytes.length,
      digest: `sha256:${sha256(bytes)}`,
      uploader: { login: botLogin },
      state: 'uploaded',
    }
  }))
}

function releaseFixture({
  body = createOwnershipMarker(markerIdentity()),
  draft = true,
  id = 99,
  targetCommitish = sourceCommit,
  author = botLogin,
} = {}) {
  return {
    id,
    tag_name: tag,
    target_commitish: targetCommitish,
    draft,
    prerelease: false,
    body,
    author: { login: author },
    upload_url:
      `${uploadOrigin}/repos/${repository}/releases/${id}/assets{?name,label}`,
    assets_url: `${apiUrl}/repos/${repository}/releases/${id}/assets`,
  }
}

function createGitHubFixture(options = {}) {
  const state = {
    requests: [],
    mutations: [],
    releases: [],
    assetsByRelease: new Map(),
    waits: [],
    clockValue: 1_000,
    tagRefReads: 0,
    uploadCount: 0,
    nextAssetId: 2000,
    ...options,
  }
  state.artifact ??= {
    id: Number(artifactId),
    name: artifactName,
    expired: false,
    digest: artifactDigest,
    url: `${apiUrl}/repos/${repository}/actions/artifacts/${artifactId}`,
    workflow_run: {
      id: Number(runId),
      repository_id: 7,
      head_repository_id: 7,
      head_sha: sourceCommit,
    },
  }
  state.tagRefs ??= [
    {
      ref: 'refs/tags/v1.0.0',
      object: { type: 'tag', sha: 'c'.repeat(40) },
    },
    {
      ref: `refs/tags/${tag}`,
      object: { type: 'tag', sha: tagObjectSha },
    },
  ]
  state.currentTagRef ??= {
    ref: `refs/tags/${tag}`,
    object: { type: 'tag', sha: tagObjectSha },
  }
  state.tagObject ??= {
    sha: tagObjectSha,
    tag,
    object: { type: 'commit', sha: sourceCommit },
  }
  state.compare ??= {
    status: 'behind',
    merge_base_commit: { sha: sourceCommit },
  }

  function listResponse(items, url, pageSize = 100) {
    const page = Number(url.searchParams.get('page') ?? '1')
    const start = (page - 1) * pageSize
    const data = items.slice(start, start + pageSize)
    const headers = {}
    if (start + pageSize < items.length) {
      const next = new URL(url)
      next.searchParams.set('page', String(page + 1))
      headers.link = `<${next.href}>; rel="next"`
    }
    if (state.paginationLink !== undefined) {
      headers.link = state.paginationLink(url)
    }
    return jsonResponse(200, data, headers)
  }

  function addDraft(payload) {
    const release = releaseFixture({
      body: payload.body,
      id: state.nextReleaseId ?? 99,
      targetCommitish: payload.target_commitish,
    })
    state.releases.push(release)
    state.assetsByRelease.set(release.id, [])
    return release
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(String(input))
    const method = String(init.method ?? 'GET').toUpperCase()
    const headers = new Headers(init.headers)
    const body = init.body
    const request = { url: url.href, method, headers, body }
    state.requests.push(request)
    if (method !== 'GET') {
      state.mutations.push(request)
    }

    if (state.networkFailure?.({ url, method, state })) {
      throw new Error('network secret fixture')
    }
    const forcedStatus = state.statusFor?.({ url, method, state })
    if (forcedStatus !== undefined) {
      return jsonResponse(forcedStatus, { secret: 'remote response secret' })
    }

    const repoPrefix = `/repos/${repository}`
    if (method === 'GET' && url.pathname === `${repoPrefix}/git/ref/tags/${tag}`) {
      state.tagRefReads += 1
      if (
        state.changeTagOnSecondRead
        && state.tagRefReads >= 2
      ) {
        return jsonResponse(200, {
          ...state.currentTagRef,
          object: { type: 'tag', sha: 'd'.repeat(40) },
        })
      }
      return jsonResponse(200, state.currentTagRef)
    }
    if (
      method === 'GET'
      && url.pathname.startsWith(`${repoPrefix}/git/tags/`)
    ) {
      return jsonResponse(200, state.tagObject)
    }
    if (
      method === 'GET'
      && url.pathname === `${repoPrefix}/git/matching-refs/tags/`
    ) {
      return listResponse(state.tagRefs, url, state.tagPageSize ?? 100)
    }
    if (
      method === 'GET'
      && url.pathname === `${repoPrefix}/compare/main...${sourceCommit}`
    ) {
      return jsonResponse(200, state.compare)
    }
    if (
      method === 'GET'
      && url.pathname === `${repoPrefix}/actions/artifacts/${artifactId}`
    ) {
      return jsonResponse(200, state.artifact)
    }
    if (method === 'GET' && url.pathname === `${repoPrefix}/releases`) {
      return listResponse(state.releases, url, state.releasePageSize ?? 100)
    }

    const assetListMatch = new RegExp(
      `^${repoPrefix.replaceAll('/', '\\/')}/releases/(\\d+)/assets$`,
      'u',
    ).exec(url.pathname)
    if (method === 'GET' && assetListMatch) {
      const releaseId = Number(assetListMatch[1])
      const assets = state.assetsByRelease.get(releaseId) ?? []
      for (const asset of assets) {
        if (asset.digest === null && asset.pendingDigest !== undefined) {
          asset.nullReadsRemaining ??= 0
          if (asset.nullReadsRemaining <= 0) {
            asset.digest = asset.pendingDigest
            delete asset.pendingDigest
          } else {
            asset.nullReadsRemaining -= 1
          }
        }
      }
      return listResponse(assets, url, state.assetPageSize ?? 100)
    }

    if (method === 'POST' && url.pathname === `${repoPrefix}/releases`) {
      const payload = JSON.parse(String(body))
      if (state.createMutation === 'network-after-create') {
        addDraft(payload)
        throw new Error('uncertain create fixture')
      }
      if (state.createMutation === 'network-before-create') {
        throw new Error('uncertain create fixture')
      }
      const release = addDraft(payload)
      return jsonResponse(201, release)
    }

    const uploadMatch = new RegExp(
      `^${repoPrefix.replaceAll('/', '\\/')}/releases/(\\d+)/assets$`,
      'u',
    ).exec(url.pathname)
    if (method === 'POST' && url.origin === uploadOrigin && uploadMatch) {
      state.uploadCount += 1
      const releaseId = Number(uploadMatch[1])
      const name = url.searchParams.get('name')
      const bytes = Buffer.from(body)
      const asset = {
        id: state.nextAssetId++,
        name,
        size: bytes.length,
        digest: `sha256:${sha256(bytes)}`,
        uploader: { login: botLogin },
        state: 'uploaded',
      }
      if (state.nullDigestUploads?.includes(name)) {
        asset.pendingDigest = asset.digest
        asset.digest = null
        asset.nullReadsRemaining = state.nullReadsRemaining ?? 0
      }
      if (state.uploadFailureAt === state.uploadCount) {
        if (state.uploadMutation === 'network-after-upload') {
          state.assetsByRelease.get(releaseId).push(asset)
        }
        throw new Error('uncertain upload fixture')
      }
      state.assetsByRelease.get(releaseId).push(asset)
      return jsonResponse(201, asset)
    }

    const releaseMatch = new RegExp(
      `^${repoPrefix.replaceAll('/', '\\/')}/releases/(\\d+)$`,
      'u',
    ).exec(url.pathname)
    if (method === 'PATCH' && releaseMatch) {
      const releaseId = Number(releaseMatch[1])
      const release = state.releases.find(item => item.id === releaseId)
      const payload = JSON.parse(String(body))
      if (state.publishMutation === 'network-after-publish') {
        Object.assign(release, payload)
        throw new Error('uncertain publish fixture')
      }
      if (state.publishMutation === 'network-before-publish') {
        throw new Error('uncertain publish fixture')
      }
      Object.assign(release, payload)
      return jsonResponse(200, release)
    }

    return jsonResponse(404, { message: 'fixture route not found' })
  }

  state.fetchImpl = fetchImpl
  state.wait = async milliseconds => {
    state.waits.push(milliseconds)
    state.clockValue += milliseconds
  }
  state.clock = () => state.clockValue
  return state
}

function coordinateDependencies(github, overrides = {}) {
  return {
    apiUrl,
    token,
    fetchImpl: github.fetchImpl,
    clock: github.clock,
    wait: github.wait,
    schemaPath: manifestSchemaPath,
    ...overrides,
  }
}

async function installExistingDraft(github, fixture, overrides = {}) {
  const release = releaseFixture(overrides.release)
  github.releases.push(release)
  const assets = overrides.assets ?? await localAssets(fixture.bundleDirectory)
  github.assetsByRelease.set(release.id, assets)
  return { release, assets }
}

test('client 固定认证 headers、API version、User-Agent 且返回冻结结果', async () => {
  const requests = []
  const client = createGitHubClient({
    apiUrl,
    token,
    fetchImpl: async (url, init) => {
      requests.push({ url, init })
      return jsonResponse(200, { ok: true })
    },
    clock: () => 1,
    wait: async () => {},
  })
  const response = await client.get('/fixture')
  assert.deepEqual(response.data, { ok: true })
  assert.equal(Object.isFrozen(response), true)
  const headers = new Headers(requests[0].init.headers)
  assert.equal(headers.get('accept'), 'application/vnd.github+json')
  assert.equal(headers.get('authorization'), `Bearer ${token}`)
  assert.equal(headers.get('x-github-api-version'), '2022-11-28')
  assert.equal(headers.get('user-agent'), 'qianshu-dms-release')
})

test('client 对 HTTP status、网络与恶意 JSON 固定分类且不泄露内容', async () => {
  const cases = [
    [401, 'GitHub API authentication failed'],
    [403, 'GitHub API authorization failed'],
    [404, 'GitHub API resource not found'],
    [409, 'GitHub API conflict'],
    [410, 'GitHub API version unavailable'],
    [422, 'GitHub API validation failed'],
    [500, 'GitHub API service failed'],
  ]
  for (const [status, message] of cases) {
    const client = createGitHubClient({
      apiUrl,
      token,
      fetchImpl: async () => jsonResponse(status, {
        secret: token,
        body: 'remote-secret',
      }),
      clock: () => 1,
      wait: async () => {},
    })
    await assert.rejects(client.get('/fixture'), error => {
      assert.equal(error.message, message)
      assert.equal(error.message.includes(token), false)
      assert.equal(error.message.includes('remote-secret'), false)
      return true
    })
  }

  for (const fetchImpl of [
    async () => { throw new Error(`network ${token}`) },
    async () => rawResponse(200, `{ invalid ${token}`),
    async () => rawResponse(200, 'null'),
  ]) {
    const client = createGitHubClient({
      apiUrl,
      token,
      fetchImpl,
      clock: () => 1,
      wait: async () => {},
    })
    await assert.rejects(client.get('/fixture'), error => {
      assert.equal(error.message.includes(token), false)
      assert.equal(error.cause, undefined)
      return true
    })
  }
})

test('client mutation 网络失败标记为不确定且不自动重试', async () => {
  let calls = 0
  const client = createGitHubClient({
    apiUrl,
    token,
    fetchImpl: async () => {
      calls += 1
      throw new Error('network')
    },
    clock: () => 1,
    wait: async () => {},
  })
  await assert.rejects(client.post('/fixture', { draft: true }), error => {
    assert.equal(error.uncertain, true)
    return true
  })
  assert.equal(calls, 1)
})

test('marker 使用唯一 canonical JSON comment 并拒绝缺失、重复和伪造', () => {
  const identity = markerIdentity()
  const marker = createOwnershipMarker(identity)
  assert.equal(
    marker,
    `<!-- qianshu-release:${JSON.stringify(identity)} -->`,
  )
  assert.deepEqual(parseOwnershipMarker(`notes\n${marker}\nmore`), identity)
  assert.equal(Object.isFrozen(parseOwnershipMarker(marker)), true)
  for (const body of [
    '',
    `${marker}\n${marker}`,
    '<!-- qianshu-release:{"schemaVersion":1} -->',
    marker.replace('"schemaVersion":1', '"schemaVersion":2'),
    marker.replace(' -->', ',"unknown":true} -->').replace('}}', '}'),
  ]) {
    assert.throws(() => parseOwnershipMarker(body))
  }
})

test('CLI parser 只接受唯一固定 flag 顺序与严格身份格式', () => {
  const argv = [
    '--repository', repository,
    '--tag', tag,
    '--source-commit', sourceCommit,
    '--run-id', runId,
    '--bundle-run-attempt', '1',
    '--current-run-attempt', '2',
    '--artifact-id', artifactId,
    '--artifact-digest', artifactDigest,
    '--artifact-name', artifactName,
    '--bundle', '/tmp/final-bundle',
  ]
  const parsed = parseReleaseGitHubArguments(argv, '/tmp/repository')
  assert.deepEqual(parsed, {
    repository,
    tag,
    sourceCommit,
    runId,
    bundleRunAttempt: 1,
    currentRunAttempt: 2,
    artifactId,
    artifactDigest,
    artifactName,
    bundleDirectory: '/tmp/final-bundle',
    releaseNotesPath: `/tmp/repository/release/notes/${tag}.md`,
  })
  for (const invalid of [
    [],
    argv.slice(0, -1),
    [...argv, '--unknown', 'value'],
    ['--tag', tag, ...argv.filter((_, index) => index > 1)],
    argv.map(value => value === sourceCommit ? sourceCommit.slice(1) : value),
    argv.map(value => value === artifactDigest ? 'sha256:ABC' : value),
    argv.map(value => value === artifactName ? 'release-final-wrong' : value),
  ]) {
    assert.throws(() => parseReleaseGitHubArguments(invalid))
  }
})

test('远端 Tag verifier 完整读取分页稳定 Tag、annotated object 与 main 身份', async () => {
  const github = createGitHubFixture({ tagPageSize: 1 })
  const client = createGitHubClient({
    apiUrl,
    token,
    fetchImpl: github.fetchImpl,
    clock: github.clock,
    wait: github.wait,
  })
  const identity = await verifyRemoteReleaseTag(client, remoteTagExpected())
  assert.deepEqual(identity, {
    version,
    tag,
    tagObjectSha,
    sourceCommit,
  })
  assert.equal(Object.isFrozen(identity), true)
  assert.equal(
    github.requests.filter(request => request.url.includes('matching-refs')).length,
    2,
  )
})

test('远端 Tag verifier 拒绝 lightweight、peel、main、版本与分页漂移', async () => {
  const mutations = [
    github => { github.currentTagRef.object.type = 'commit' },
    github => { github.tagObject.object.type = 'tag' },
    github => { github.tagObject.object.sha = 'e'.repeat(40) },
    github => { github.compare.status = 'ahead' },
    github => { github.compare.status = 'diverged' },
    github => { github.compare.merge_base_commit.sha = 'e'.repeat(40) },
    github => {
      github.tagRefs.push({
        ref: 'refs/tags/v1.2.4',
        object: { type: 'tag', sha: 'e'.repeat(40) },
      })
    },
    github => {
      github.paginationLink = url => `<${url.href}>; rel="next"`
    },
    github => {
      github.paginationLink = url => {
        const next = new URL(url)
        const page = Number(next.searchParams.get('page') ?? '1')
        next.searchParams.set('page', String(page + 1))
        return `<${next.href}>; rel="next"`
      }
    },
    github => {
      github.paginationLink = () => '<https://evil.example/page=2>; rel="next"'
    },
  ]
  for (const mutate of mutations) {
    const github = createGitHubFixture()
    mutate(github)
    const client = createGitHubClient({
      apiUrl,
      token,
      fetchImpl: github.fetchImpl,
      clock: github.clock,
      wait: github.wait,
    })
    await assert.rejects(
      verifyRemoteReleaseTag(client, remoteTagExpected()),
    )
    assert.equal(github.mutations.length, 0)
  }
})

test('Release 文案缺失、为空、含所有权标记或非文本字节时失败关闭', async (t) => {
  const cases = [
    {
      name: 'missing',
      prepare: async ({ releaseNotesPath }) => fs.rm(releaseNotesPath),
    },
    {
      name: 'empty',
      prepare: async ({ releaseNotesPath }) => fs.writeFile(releaseNotesPath, '\n\n'),
    },
    {
      name: 'marker',
      prepare: async ({ releaseNotesPath }) => fs.writeFile(
        releaseNotesPath,
        `${createOwnershipMarker(markerIdentity())}\n`,
      ),
    },
    {
      name: 'binary',
      prepare: async ({ releaseNotesPath }) => fs.writeFile(
        releaseNotesPath,
        Buffer.from([0x61, 0x00, 0x62]),
      ),
    },
    {
      name: 'symlink',
      prepare: async ({ releaseNotesPath, sandbox }) => {
        const target = path.join(sandbox, 'notes-target.md')
        await fs.writeFile(target, `${releaseNotes}\n`)
        await fs.rm(releaseNotesPath)
        await fs.symlink(target, releaseNotesPath)
      },
    },
    {
      name: 'directory',
      prepare: async ({ releaseNotesPath }) => {
        await fs.rm(releaseNotesPath)
        await fs.mkdir(releaseNotesPath)
      },
    },
  ]
  for (const fixtureCase of cases) {
    const fixture = await createBundleFixture(t)
    await fixtureCase.prepare(fixture)
    const github = createGitHubFixture()
    await assert.rejects(
      coordinateDraftRelease(coordinateInput(fixture), coordinateDependencies(github)),
      undefined,
      fixtureCase.name,
    )
    assert.equal(
      github.mutations.some(request => request.method === 'POST'),
      false,
      `不应创建 Draft：${fixtureCase.name}`,
    )
  }
})

test('workflow artifact verifier 绑定 repository/run/attempt/id/digest/name/head SHA', async () => {
  const github = createGitHubFixture()
  const client = createGitHubClient({
    apiUrl,
    token,
    fetchImpl: github.fetchImpl,
    clock: github.clock,
    wait: github.wait,
  })
  const identity = await verifyWorkflowArtifact(client, artifactExpected())
  assert.deepEqual(identity, artifactExpected())
  assert.equal(Object.isFrozen(identity), true)
})

test('workflow artifact 任一身份字段不一致都失败且无 mutation', async () => {
  const mutations = [
    artifact => { artifact.url = `${apiUrl}/repos/foreign/repo/actions/artifacts/${artifactId}` },
    artifact => { artifact.workflow_run.id += 1 },
    artifact => { artifact.name = `release-final-${runId}-2` },
    artifact => { artifact.id += 1 },
    artifact => { artifact.digest = `sha256:${'e'.repeat(64)}` },
    artifact => { artifact.workflow_run.head_sha = 'e'.repeat(40) },
    artifact => { artifact.workflow_run.head_repository_id += 1 },
    artifact => { artifact.expired = true },
  ]
  for (const mutate of mutations) {
    const github = createGitHubFixture()
    mutate(github.artifact)
    const client = createGitHubClient({
      apiUrl,
      token,
      fetchImpl: github.fetchImpl,
      clock: github.clock,
      wait: github.wait,
    })
    await assert.rejects(
      verifyWorkflowArtifact(client, artifactExpected()),
    )
    assert.equal(github.mutations.length, 0)
  }
})

test('无 Release 时创建 Draft、重读 author、上传六附件后唯一发布', async (t) => {
  const fixture = await createBundleFixture(t)
  const github = createGitHubFixture()
  const result = await coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(github),
  )
  assert.deepEqual(result, { releaseId: 99, state: 'published' })
  assert.equal(Object.isFrozen(result), true)
  assert.deepEqual(
    github.mutations.map(request => request.method),
    ['POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'POST', 'PATCH'],
  )
  assert.equal(
    github.mutations.some(request => request.method === 'DELETE'),
    false,
  )
  const createPayload = JSON.parse(String(github.mutations[0].body))
  assert.deepEqual(createPayload, {
    tag_name: tag,
    target_commitish: sourceCommit,
    name: tag,
    body: createReleaseBody(markerIdentity(), releaseNotes),
    draft: true,
    prerelease: false,
    generate_release_notes: false,
  })
  assert.match(
    String(createPayload.body),
    /用户能看到的新能力/u,
    'Release 正文必须带上 release/notes 的用户视角文案',
  )
  assert.deepEqual(
    JSON.parse(String(github.mutations.at(-1).body)),
    { draft: false },
  )
  const uploadNames = github.mutations
    .slice(1, 7)
    .map(request => new URL(request.url).searchParams.get('name'))
  assert.deepEqual(uploadNames, [
    `qsmds-web-${tag}.tar.gz`,
    `qsmds-server-${tag}-linux-x64.tar.gz`,
    `qsmds-web-image-${tag}-linux-x64.tar.gz`,
    `qsmds-server-image-${tag}-linux-x64.tar.gz`,
    'release-manifest.json',
    'SHA256SUMS',
  ])
  const expectedContentTypes = [
    'application/gzip',
    'application/gzip',
    'application/gzip',
    'application/gzip',
    'application/json',
    'text/plain',
  ]
  for (const [index, request] of github.mutations.slice(1, 7).entries()) {
    const bytes = await fs.readFile(
      path.join(fixture.bundleDirectory, uploadNames[index]),
    )
    assert.equal(request.headers.get('content-type'), expectedContentTypes[index])
    assert.equal(request.headers.get('content-length'), String(bytes.length))
  }
})

test('已发布或 foreign Draft ownership 全部失败且无 mutation', async (t) => {
  const cases = [
    { release: { draft: false } },
    { release: { author: 'foreign-user' } },
    { release: { body: '' } },
    { release: { body: `${createOwnershipMarker(markerIdentity())}\n${createOwnershipMarker(markerIdentity())}` } },
    { release: { body: createOwnershipMarker(markerIdentity({ artifactId: '999' })) } },
    { release: { targetCommitish: 'e'.repeat(40) } },
  ]
  for (const fixtureCase of cases) {
    const fixture = await createBundleFixture(t)
    const github = createGitHubFixture()
    await installExistingDraft(github, fixture, fixtureCase)
    await assert.rejects(
      coordinateDraftRelease(
        coordinateInput(fixture),
        coordinateDependencies(github),
      ),
    )
    assert.equal(github.mutations.length, 0)
  }
})

test('重复 tag Release、完整重跑新 bundle 与 Manifest identity 不一致都安全失败', async (t) => {
  const fixture = await createBundleFixture(t)

  const duplicate = createGitHubFixture()
  duplicate.releases.push(releaseFixture({ id: 98 }), releaseFixture({ id: 99 }))
  duplicate.assetsByRelease.set(98, [])
  duplicate.assetsByRelease.set(99, [])
  await assert.rejects(coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(duplicate),
  ))
  assert.equal(duplicate.mutations.length, 0)

  const rerun = createGitHubFixture()
  await installExistingDraft(rerun, fixture)
  await assert.rejects(coordinateDraftRelease(
    coordinateInput(fixture, {
      artifactDigest: `sha256:${'e'.repeat(64)}`,
    }),
    coordinateDependencies(rerun),
  ))
  assert.equal(rerun.mutations.length, 0)

  for (const overrides of [
    { repository: 'foreign/repository' },
    { tag: 'v1.2.4' },
    { sourceCommit: 'e'.repeat(40) },
    { runId: '987' },
    { bundleRunAttempt: 2, currentRunAttempt: 2, artifactName: `release-final-${runId}-2` },
  ]) {
    const github = createGitHubFixture()
    await assert.rejects(coordinateDraftRelease(
      coordinateInput(fixture, overrides),
      coordinateDependencies(github),
    ))
    assert.equal(github.mutations.length, 0)
  }
})

test('publish-only rerun 允许 current attempt 增加且完整资产只执行 PATCH', async (t) => {
  const fixture = await createBundleFixture(t)
  const github = createGitHubFixture()
  await installExistingDraft(github, fixture)
  const result = await coordinateDraftRelease(
    coordinateInput(fixture, { currentRunAttempt: 3 }),
    coordinateDependencies(github),
  )
  assert.deepEqual(result, { releaseId: 99, state: 'published' })
  assert.deepEqual(github.mutations.map(request => request.method), ['PATCH'])
})

test('缺失 assets 只补传；unknown、duplicate、size、digest、uploader 冲突均失败', async (t) => {
  const fixture = await createBundleFixture(t)
  const expectedAssets = await localAssets(fixture.bundleDirectory)

  const missing = createGitHubFixture()
  await installExistingDraft(missing, fixture, {
    assets: expectedAssets.slice(0, 2),
  })
  await coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(missing),
  )
  assert.deepEqual(
    missing.mutations.map(request => request.method),
    ['POST', 'POST', 'POST', 'POST', 'PATCH'],
  )

  const corruptions = [
    assets => assets.push({ ...assets[0], id: 9999, name: 'unknown.bin' }),
    assets => assets.push({ ...assets[0], id: 9999 }),
    assets => { assets[0].size += 1 },
    assets => { assets[0].digest = `sha256:${'e'.repeat(64)}` },
    assets => { assets[0].uploader = { login: 'foreign-user' } },
  ]
  for (const corrupt of corruptions) {
    const github = createGitHubFixture()
    const assets = structuredClone(expectedAssets)
    corrupt(assets)
    await installExistingDraft(github, fixture, { assets })
    await assert.rejects(coordinateDraftRelease(
      coordinateInput(fixture),
      coordinateDependencies(github),
    ))
    assert.equal(github.mutations.length, 0)
  }
})

test('null digest 按 1s/2s/4s/8s 有界重读，最终可见后发布', async (t) => {
  const fixture = await createBundleFixture(t)
  const github = createGitHubFixture()
  const assets = await localAssets(fixture.bundleDirectory)
  assets[0].pendingDigest = assets[0].digest
  assets[0].digest = null
  assets[0].nullReadsRemaining = 3
  await installExistingDraft(github, fixture, { assets })
  await coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(github),
  )
  assert.deepEqual(github.waits, [1000, 2000, 4000])
  assert.deepEqual(github.mutations.map(request => request.method), ['PATCH'])
})

test('null digest 耗尽或变为错误 digest 时保留 Draft 且不发布', async (t) => {
  const fixture = await createBundleFixture(t)
  for (const finalDigest of [null, `sha256:${'e'.repeat(64)}`]) {
    const github = createGitHubFixture()
    const assets = await localAssets(fixture.bundleDirectory)
    assets[0].pendingDigest = finalDigest
    assets[0].digest = null
    assets[0].nullReadsRemaining = 10
    await installExistingDraft(github, fixture, { assets })
    await assert.rejects(coordinateDraftRelease(
      coordinateInput(fixture),
      coordinateDependencies(github),
    ))
    assert.deepEqual(github.waits, [1000, 2000, 4000, 8000])
    assert.equal(github.mutations.length, 0)
    assert.equal(github.releases[0].draft, true)
  }
})

test('部分上传失败不发布，再次运行只补剩余附件', async (t) => {
  const fixture = await createBundleFixture(t)
  const github = createGitHubFixture({ uploadFailureAt: 3 })
  await assert.rejects(coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(github),
  ))
  assert.equal(github.releases[0].draft, true)
  assert.deepEqual(
    github.mutations.map(request => request.method),
    ['POST', 'POST', 'POST', 'POST'],
  )
  github.uploadFailureAt = undefined
  github.mutations.length = 0
  github.uploadCount = 0
  await coordinateDraftRelease(
    coordinateInput(fixture, { currentRunAttempt: 2 }),
    coordinateDependencies(github),
  )
  assert.deepEqual(
    github.mutations.map(request => request.method),
    ['POST', 'POST', 'POST', 'POST', 'PATCH'],
  )
})

test('Tag 在两次远端复验间变化时不发布且 Draft 保留', async (t) => {
  const fixture = await createBundleFixture(t)
  const github = createGitHubFixture({ changeTagOnSecondRead: true })
  await assert.rejects(coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(github),
  ))
  assert.equal(github.releases[0].draft, true)
  assert.equal(
    github.mutations.some(request => request.method === 'PATCH'),
    false,
  )
})

test('create mutation 不确定时只重读状态，不重复 POST', async (t) => {
  const fixture = await createBundleFixture(t)
  for (const mode of ['network-after-create', 'network-before-create']) {
    const github = createGitHubFixture({ createMutation: mode })
    const action = coordinateDraftRelease(
      coordinateInput(fixture),
      coordinateDependencies(github),
    )
    if (mode === 'network-after-create') {
      await action
    } else {
      await assert.rejects(action)
    }
    assert.equal(
      github.mutations.filter(request => (
        request.method === 'POST'
        && new URL(request.url).pathname.endsWith('/releases')
      )).length,
      1,
    )
  }
})

test('upload 与 publish mutation 不确定时通过重读收敛且不盲重试', async (t) => {
  const fixture = await createBundleFixture(t)
  const upload = createGitHubFixture({
    uploadFailureAt: 1,
    uploadMutation: 'network-after-upload',
  })
  await coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(upload),
  )
  const firstName = `qsmds-web-${tag}.tar.gz`
  assert.equal(
    upload.mutations.filter(request => (
      new URL(request.url).searchParams.get('name') === firstName
    )).length,
    1,
  )

  const publish = createGitHubFixture({
    publishMutation: 'network-after-publish',
  })
  await installExistingDraft(publish, fixture)
  const result = await coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(publish),
  )
  assert.deepEqual(result, { releaseId: 99, state: 'published' })
  assert.equal(
    publish.mutations.filter(request => request.method === 'PATCH').length,
    1,
  )
})

test('已知 422 与不确定但未落地 mutation 均失败且不重复请求', async (t) => {
  const fixture = await createBundleFixture(t)
  const validation = createGitHubFixture({
    statusFor: ({ method, url }) => (
      method === 'POST' && url.pathname.endsWith('/releases') ? 422 : undefined
    ),
  })
  await assert.rejects(coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(validation),
  ))
  assert.equal(validation.mutations.length, 1)

  const publish = createGitHubFixture({
    publishMutation: 'network-before-publish',
  })
  await installExistingDraft(publish, fixture)
  await assert.rejects(coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(publish),
  ))
  assert.equal(
    publish.mutations.filter(request => request.method === 'PATCH').length,
    1,
  )
  assert.equal(publish.releases[0].draft, true)
})

test('任何协调路径都不发 DELETE、覆盖 upload 或 Tag 写请求', async (t) => {
  const fixture = await createBundleFixture(t)
  const github = createGitHubFixture()
  await coordinateDraftRelease(
    coordinateInput(fixture),
    coordinateDependencies(github),
  )
  assert.equal(github.requests.some(request => request.method === 'DELETE'), false)
  assert.equal(
    github.requests.some(request => (
      request.method !== 'GET'
      && new URL(request.url).pathname.includes('/git/')
    )),
    false,
  )
  const uploadNames = github.mutations
    .filter(request => new URL(request.url).origin === uploadOrigin)
    .map(request => new URL(request.url).searchParams.get('name'))
  assert.equal(uploadNames.length, new Set(uploadNames).size)
})
