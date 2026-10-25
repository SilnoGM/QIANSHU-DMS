import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { POSTGRES_IMAGE } from './ci-postgres.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const workflowPath = path.join(repositoryRoot, '.github', 'workflows', 'ci.yml')
const examplesWorkflowPath = path.join(
  repositoryRoot,
  '.github',
  'workflows',
  'examples.yml',
)
const releaseWorkflowPath = path.join(
  repositoryRoot,
  '.github',
  'workflows',
  'release.yml',
)

const checkoutAction =
  'actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0'
const pnpmSetupAction =
  'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6.0.9'
const setupNodeAction =
  'actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0'
const uploadArtifactAction =
  'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1'
const downloadArtifactAction =
  'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1'
const requiredJobIds = Object.freeze([
  'root-governance',
  'server-check-build',
  'server-e2e',
  'contract',
  'web-check-build',
  'browser-auth-e2e',
  'browser-dictionaries-e2e',
  'browser-business-e2e',
  'ci-gate',
])
const validationJobIds = requiredJobIds.slice(0, -1)
const releaseJobIds = Object.freeze([
  'verify',
  'package-web',
  'package-server',
  'package-images',
  'manifest',
  'publish',
])

let workflowPromise
let examplesWorkflowPromise
let releaseWorkflowPromise

async function readCiWorkflow() {
  workflowPromise ??= (async () => {
    const stats = await lstat(workflowPath)
    assert.equal(stats.isSymbolicLink(), false, 'ci.yml 不得是 symlink')
    assert.equal(stats.isFile(), true, 'ci.yml 必须是实际文件')
    const source = await readFile(workflowPath, 'utf8')
    assert.notEqual(source.length, 0, 'ci.yml 不得为空')
    return source
  })()
  return workflowPromise
}

async function readExamplesWorkflow() {
  examplesWorkflowPromise ??= (async () => {
    const stats = await lstat(examplesWorkflowPath)
    assert.equal(stats.isSymbolicLink(), false, 'examples.yml 不得是 symlink')
    assert.equal(stats.isFile(), true, 'examples.yml 必须是实际文件')
    const source = await readFile(examplesWorkflowPath, 'utf8')
    assert.notEqual(source.length, 0, 'examples.yml 不得为空')
    return source
  })()
  return examplesWorkflowPromise
}

async function readReleaseWorkflow() {
  releaseWorkflowPromise ??= (async () => {
    const stats = await lstat(releaseWorkflowPath)
    assert.equal(stats.isSymbolicLink(), false, 'release.yml 不得是 symlink')
    assert.equal(stats.isFile(), true, 'release.yml 必须是实际文件')
    const source = await readFile(releaseWorkflowPath, 'utf8')
    assert.notEqual(source.length, 0, 'release.yml 不得为空')
    return source
  })()
  return releaseWorkflowPromise
}

function indentation(line) {
  return line.length - line.trimStart().length
}

/**
 * 只提取采用空格缩进的固定 YAML mapping block。测试不尝试实现通用 YAML，
 * 未知缩进、alias 或替代写法应由严格源码约束和 actionlint 共同拒绝。
 */
function extractBlock(source, key, indent) {
  const lines = source.split('\n')
  const header = `${' '.repeat(indent)}${key}:`
  const start = lines.indexOf(header)
  assert.notEqual(start, -1, `Workflow 缺少 block：${key}`)
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (
      line.trim() !== ''
      && !line.trimStart().startsWith('#')
      && indentation(line) <= indent
    ) {
      end = index
      break
    }
  }
  return lines.slice(start, end).join('\n').trimEnd()
}

function extractJobs(source) {
  const jobs = extractBlock(source, 'jobs', 0)
  const ids = [...jobs.matchAll(/^  ([a-z][a-z0-9-]*):$/gmu)]
    .map(match => match[1])
  return new Map(ids.map(id => [id, extractBlock(jobs, id, 2)]))
}

function extractSteps(job) {
  const block = extractBlock(job, 'steps', 4)
  const lines = block.split('\n')
  const starts = []
  for (let index = 1; index < lines.length; index += 1) {
    if (/^      - /u.test(lines[index])) {
      starts.push(index)
    }
  }
  assert.notEqual(starts.length, 0, 'Job 必须至少包含一个 step')
  return starts.map((start, index) => (
    lines.slice(start, starts[index + 1] ?? lines.length).join('\n').trimEnd()
  ))
}

function usesFrom(source) {
  return [...source.matchAll(/^\s+uses: (.+)$/gmu)].map(match => match[1])
}

function findUseStep(job, action) {
  const matches = extractSteps(job).filter(step => step.includes(`uses: ${action}`))
  assert.equal(matches.length, 1, `Action 必须在 Job 中恰好出现一次：${action}`)
  return matches[0]
}

function findNamedStep(job, name) {
  const matches = extractSteps(job).filter(step => (
    step.startsWith(`      - name: ${name}\n`)
    || step === `      - name: ${name}`
  ))
  assert.equal(matches.length, 1, `命名 Step 必须恰好出现一次：${name}`)
  return matches[0]
}

function assertTextOrder(source, expected, label) {
  let previous = -1
  for (const value of expected) {
    const position = source.indexOf(value)
    assert.ok(position > previous, `${label} 顺序错误或缺少：${value}`)
    previous = position
  }
}

function assertCheckout(job, fetchDepth) {
  const checkout = findUseStep(job, checkoutAction)
  assert.match(checkout, /\n          persist-credentials: false(?:\n|$)/u)
  assert.match(checkout, new RegExp(`\\n          fetch-depth: ${fetchDepth}(?:\\n|$)`, 'u'))
}

function assertDependencySetup(job, expectedCachePaths) {
  assertTextOrder(
    job,
    [`uses: ${checkoutAction}`, `uses: ${pnpmSetupAction}`, `uses: ${setupNodeAction}`],
    '依赖 Job setup',
  )
  const pnpm = findUseStep(job, pnpmSetupAction)
  assert.match(pnpm, /\n          version: 11\.9\.0(?:\n|$)/u)
  assert.match(pnpm, /\n          run_install: false(?:\n|$)/u)
  assert.equal(pnpm.includes('cache:'), false)

  const node = findUseStep(job, setupNodeAction)
  assert.match(node, /\n          node-version-file: \.node-version(?:\n|$)/u)
  assert.match(node, /\n          cache: pnpm(?:\n|$)/u)
  const cacheLines = node.split('\n').flatMap((line) => {
    const normalized = line.trim()
    const prefix = 'cache-dependency-path: '
    if (normalized.startsWith(prefix)) {
      const value = normalized.slice(prefix.length)
      return value === '|' ? [] : [value]
    }
    return normalized.endsWith('pnpm-lock.yaml') ? [normalized] : []
  })
  assert.deepEqual(cacheLines, expectedCachePaths)
}

function assertToolSetupWithoutCache(job) {
  assertTextOrder(
    job,
    [`uses: ${checkoutAction}`, `uses: ${pnpmSetupAction}`, `uses: ${setupNodeAction}`],
    '无依赖安装的工具 setup',
  )
  const pnpm = findUseStep(job, pnpmSetupAction)
  assert.match(pnpm, /\n          version: 11\.9\.0(?:\n|$)/u)
  assert.match(pnpm, /\n          run_install: false(?:\n|$)/u)
  const node = findUseStep(job, setupNodeAction)
  assert.match(node, /\n          node-version-file: \.node-version(?:\n|$)/u)
  assert.match(node, /\n          package-manager-cache: false(?:\n|$)/u)
  assert.equal(job.includes('cache: pnpm'), false)
  assert.equal(job.includes('cache-dependency-path:'), false)
}

function countOccurrences(source, value) {
  return source.split(value).length - 1
}

function assertTrackedDiffIsLast(job) {
  const steps = extractSteps(job)
  assert.match(steps.at(-1), /\n        run: git diff --exit-code -- \.(?:\n|$)/u)
}

function gateProgram(gateJob) {
  const match = /^        run: node -e "([^"\n]+)"$/mu.exec(gateJob)
  assert.notEqual(match, null, 'ci-gate 必须使用固定单行 Node 判定程序')
  return match[1]
}

function runGate(program, needs) {
  return spawnSync(process.execPath, ['-e', program], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      NEEDS_JSON: JSON.stringify(needs),
    },
  })
}

function successfulNeeds() {
  return Object.fromEntries(validationJobIds.map(id => [id, {
    outputs: {},
    result: 'success',
  }]))
}

test('ci.yml 只声明 main PR/push 与可选 release workflow_call', async () => {
  const source = await readCiWorkflow()
  assert.equal(source.endsWith('\n'), true, 'ci.yml 必须以 LF 结尾')
  assert.equal(source.includes('\r'), false, 'ci.yml 只允许 LF')
  assert.equal(source.includes('\t'), false, 'ci.yml 禁止 tab 缩进')
  assert.equal(/^.* +$/mu.test(source), false, 'ci.yml 禁止行尾空格')
  assert.deepEqual(
    [...source.matchAll(/^([a-z][a-z0-9-]*):(?: .*)?$/gmu)].map(match => match[1]),
    ['name', 'on', 'permissions', 'concurrency', 'jobs'],
  )
  assert.equal(source.startsWith('name: CI\n'), true)
  assert.equal(extractBlock(source, 'on', 0), [
    'on:',
    '  pull_request:',
    '    branches: [main]',
    '  push:',
    '    branches: [main]',
    '  workflow_call:',
    '    inputs:',
    '      release_tag:',
    '        required: false',
    '        type: string',
    "        default: ''",
  ].join('\n'))
  assert.equal(extractBlock(source, 'permissions', 0), [
    'permissions:',
    '  contents: read',
  ].join('\n'))
  assert.equal(extractBlock(source, 'concurrency', 0), [
    'concurrency:',
    "  group: qianshu-ci-${{ inputs.release_tag != '' && github.run_id || github.event.pull_request.number || github.ref }}",
    "  cancel-in-progress: ${{ inputs.release_tag == '' }}",
  ].join('\n'))
  for (const forbidden of [
    'pull_request_target',
    'workflow_dispatch',
    'paths:',
    'paths-ignore:',
    'secrets:',
    '${{ secrets.',
    'qianshu-release',
  ]) {
    assert.equal(source.includes(forbidden), false, `ci.yml 禁止：${forbidden}`)
  }
})

test('ci.yml Required Job、runner、timeout 与 tracked diff 精确', async () => {
  const jobs = extractJobs(await readCiWorkflow())
  assert.deepEqual([...jobs.keys()], requiredJobIds)
  for (const id of validationJobIds) {
    const job = jobs.get(id)
    assert.match(job, /\n    runs-on: ubuntu-24\.04(?:\n|$)/u)
    assert.match(job, /\n    timeout-minutes: [1-9]\d*(?:\n|$)/u)
    assertCheckout(job, id === 'contract' ? 0 : 1)
    assertTrackedDiffIsLast(job)
  }
  const gate = jobs.get('ci-gate')
  assert.match(gate, /\n    runs-on: ubuntu-24\.04(?:\n|$)/u)
  assert.match(gate, /\n    timeout-minutes: [1-9]\d*(?:\n|$)/u)
  assert.equal(gate.includes('uses:'), false)
})

test('ci.yml 只使用固定 Action SHA 且 cache owner 唯一', async () => {
  const source = await readCiWorkflow()
  const references = usesFrom(source)
  assert.equal(references.filter(value => value === checkoutAction).length, 8)
  assert.equal(references.filter(value => value === pnpmSetupAction).length, 7)
  assert.equal(references.filter(value => value === setupNodeAction).length, 8)
  assert.equal(references.filter(value => value === uploadArtifactAction).length, 2)
  assert.equal(references.length, 25)
  assert.equal((source.match(/          cache: pnpm$/gmu) ?? []).length, 7)
  assert.equal(source.includes('services:'), false)
  assert.equal(source.includes('postgres:'), false)
})

test('root-governance 不安装依赖并保持根依赖域为空', async () => {
  const root = extractJobs(await readCiWorkflow()).get('root-governance')
  assert.equal(root.includes(pnpmSetupAction), false)
  assert.equal(root.includes(' install'), false)
  assert.equal(root.includes('cache: pnpm'), false)
  const node = findUseStep(root, setupNodeAction)
  assert.match(node, /\n          node-version-file: \.node-version(?:\n|$)/u)
  assert.match(node, /\n          package-manager-cache: false(?:\n|$)/u)
  assertTextOrder(root, [
    'run: node --run test:root',
    'test ! -e pnpm-workspace.yaml',
    'test ! -e pnpm-lock.yaml',
    'test ! -e node_modules',
    'run: git diff --exit-code -- .',
  ], 'root-governance')
})

test('ci-gate always 汇总八个验证 Job 且拒绝所有非 success 状态', async () => {
  const gate = extractJobs(await readCiWorkflow()).get('ci-gate')
  assert.match(
    gate,
    /\n    needs: \[root-governance, server-check-build, server-e2e, contract, web-check-build, browser-auth-e2e, browser-dictionaries-e2e, browser-business-e2e\](?:\n|$)/u,
  )
  assert.match(gate, /\n    if: always\(\)(?:\n|$)/u)
  assert.match(gate, /\n          NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}(?:\n|$)/u)
  const program = gateProgram(gate)
  const success = runGate(program, successfulNeeds())
  assert.equal(success.error, undefined)
  assert.equal(success.status, 0, success.stderr)

  for (const result of ['failure', 'cancelled', 'skipped']) {
    const needs = successfulNeeds()
    needs['browser-dictionaries-e2e'].result = result
    const rejected = runGate(program, needs)
    assert.equal(rejected.error, undefined)
    assert.equal(rejected.status, 1, `ci-gate 必须拒绝 ${result}`)
  }
})

test('server-check-build 使用 Server cache 并执行固定检查构建顺序', async () => {
  const job = extractJobs(await readCiWorkflow()).get('server-check-build')
  assertDependencySetup(job, ['server/pnpm-lock.yaml'])
  const packageStep = findNamedStep(job, 'Package Server release archive')
  assert.equal(packageStep, [
    '      - name: Package Server release archive',
    "        if: inputs.release_tag == ''",
    '        run: |',
    '          package_tag="v$(node -p \'require("./package.json").version\')"',
    '          output="$RUNNER_TEMP/release-server-ci"',
    '          node --run release:package:server -- \\',
    '            --tag "$package_tag" \\',
    '            --output "$output"',
    '          archive="$output/qsmds-server-${package_tag}-linux-x64.tar.gz"',
    '          test -f "$archive"',
    '          test ! -L "$archive"',
    '          test -s "$archive"',
  ].join('\n'))
  const smokeStep = findNamedStep(job, 'Smoke test Server release archive')
  assert.equal(smokeStep, [
    '      - name: Smoke test Server release archive',
    "        if: inputs.release_tag == ''",
    '        run: |',
    '          package_tag="v$(node -p \'require("./package.json").version\')"',
    '          archive="$RUNNER_TEMP/release-server-ci/qsmds-server-${package_tag}-linux-x64.tar.gz"',
    '          node --run release:smoke:server -- \\',
    '            --tag "$package_tag" \\',
    '            --archive "$archive"',
  ].join('\n'))
  const mediaTools = findNamedStep(job, 'Install media tools')
  for (const fact of [
    'https://archive.ubuntu.com/ubuntu/',
    'https://security.ubuntu.com/ubuntu/',
    'Acquire::Retries=3',
    'sudo timeout 5m apt-get "${apt_options[@]}" update',
    'sudo timeout 15m apt-get "${apt_options[@]}" install --yes --no-install-recommends ffmpeg',
    'test -x /usr/bin/ffmpeg',
  ]) {
    assert.ok(mediaTools.includes(fact), `Server media tools 缺少：${fact}`)
  }
  assert.equal(mediaTools.includes('azure.archive.ubuntu.com'), false)
  assertTextOrder(job, [
    'run: pnpm -C server install --frozen-lockfile',
    'sudo timeout 5m apt-get "${apt_options[@]}" update',
    'run: pnpm -C server check',
    'run: pnpm -C server build',
    '      - name: Verify Server entrypoint',
    'run: test -f server/dist/main.js && test ! -L server/dist/main.js && test -s server/dist/main.js',
    '      - name: Package Server release archive',
    '      - name: Smoke test Server release archive',
    'node --run release:smoke:server --',
    '--archive "$archive"',
    'run: git diff --exit-code -- .',
  ], 'server-check-build')
  assert.equal(job.includes('web/pnpm-lock.yaml'), false)
  assert.equal(job.includes('\n    permissions:'), false)
  assert.equal(job.includes('actions/upload-artifact'), false)
  assert.equal(job.includes('release:smoke:server'), true)
  assert.equal(job.includes('DATABASE_URL'), false)
})

test('server-e2e 以两片 matrix 通过固定 PostgreSQL wrapper 执行隔离 E2E', async () => {
  const job = extractJobs(await readCiWorkflow()).get('server-e2e')
  assertDependencySetup(job, ['server/pnpm-lock.yaml'])
  assert.match(job, /\n    name: Server E2E \(\$\{\{ matrix\.shard \}\}\/2\)(?:\n|$)/u)
  assert.equal(extractBlock(job, 'strategy', 4), [
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        shard: [1, 2]',
  ].join('\n'))
  assert.match(
    job,
    /\n      QIANSHU_SERVER_E2E_SHARD: \$\{\{ matrix\.shard \}\}\/2(?:\n|$)/u,
  )
  assertTextOrder(job, [
    'run: pnpm -C server install --frozen-lockfile',
    'run: node --run ci:server-e2e',
    'run: git diff --exit-code -- .',
  ], 'server-e2e')
  assert.equal(job.includes('services:'), false)
  assert.equal(
    POSTGRES_IMAGE,
    'postgres:16@sha256:be01cf82fc7dbba824acf0a82e150b4b360f3ff93c6631d7844af431e841a95c',
  )
})

test('contract 使用完整历史、双 lock cache 与受控 release input', async () => {
  const job = extractJobs(await readCiWorkflow()).get('contract')
  assertDependencySetup(job, [
    'server/pnpm-lock.yaml',
    'web/pnpm-lock.yaml',
  ])
  assert.equal(extractBlock(job, 'env', 4), [
    '    env:',
    '      DOTENV_CONFIG_PATH: /dev/null',
    '      QIANSHU_RELEASE_TAG: ${{ inputs.release_tag }}',
  ].join('\n'))
  assertTextOrder(job, [
    'fetch-depth: 0',
    'run: pnpm -C server install --frozen-lockfile',
    'run: pnpm -C web install --frozen-lockfile',
    'run: node --run ci:contract',
    'run: git diff --exit-code -- .',
  ], 'contract')
  for (const forbidden of [
    'DATABASE_URL',
    'DEBUG:',
    'PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION',
  ]) {
    assert.equal(job.includes(forbidden), false, `Contract Job 禁止：${forbidden}`)
  }
})

test('web-check-build 只使用 Web cache 并验证正式应用产物', async () => {
  const job = extractJobs(await readCiWorkflow()).get('web-check-build')
  assertDependencySetup(job, ['web/pnpm-lock.yaml'])
  assertTextOrder(job, [
    'run: pnpm -C web install --frozen-lockfile',
    'run: pnpm -C web api:generate',
    'run: pnpm -C web check',
    'run: pnpm -C web build',
    'run: test -f web/apps/qsmds-arco/dist/index.html && test ! -L web/apps/qsmds-arco/dist/index.html && test -s web/apps/qsmds-arco/dist/index.html',
    'name: Verify Web build identity',
    'run: git diff --exit-code -- .',
  ], 'web-check-build')
  assert.equal(job.includes('server/pnpm-lock.yaml'), false)
  assert.equal(job.includes('check:examples'), false)
  assert.equal(job.includes('build:examples'), false)
})

test('browser-auth-e2e 以两片 matrix 安装运行依赖并在 Xvfb 中调用隔离根入口', async () => {
  const job = extractJobs(await readCiWorkflow()).get('browser-auth-e2e')
  assertDependencySetup(job, [
    'server/pnpm-lock.yaml',
    'web/pnpm-lock.yaml',
  ])
  assert.match(job, /\n    name: Browser auth E2E \(\$\{\{ matrix\.shard \}\}\/2\)(?:\n|$)/u)
  assert.equal(extractBlock(job, 'strategy', 4), [
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        shard: [1, 2]',
  ].join('\n'))
  const ffmpegDependency = findNamedStep(job, 'Install browser runtime dependencies')
  assert.equal(ffmpegDependency, [
    '      - name: Install browser runtime dependencies',
    '        run: |',
    '          if test ! -x /usr/bin/ffprobe || test ! -x /usr/bin/xvfb-run || test ! -x /usr/bin/xauth; then',
    '            # GitHub Runner 的 mirror+file 会优先选择 Azure 镜像；该镜像异常时可能持续阻塞到 Job 超时。',
    '            # 这里使用隔离索引和 Ubuntu 官方 HTTPS 源，避免旧索引、第三方源或云镜像参与解析。',
    "            sudo tee /etc/apt/sources.list.d/qianshu-ubuntu.sources >/dev/null <<'EOF'",
    '          Types: deb',
    '          URIs: https://archive.ubuntu.com/ubuntu/',
    '          Suites: noble noble-updates noble-backports',
    '          Components: main restricted universe multiverse',
    '          Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg',
    '',
    '          Types: deb',
    '          URIs: https://security.ubuntu.com/ubuntu/',
    '          Suites: noble-security',
    '          Components: main restricted universe multiverse',
    '          Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg',
    '          EOF',
    '            apt_lists=/var/lib/apt/lists/qianshu-browser-auth',
    '            sudo install -d -m 0755 -o root -g root "${apt_lists}"',
    '            sudo install -d -m 0700 -o _apt -g root "${apt_lists}/partial"',
    '            apt_options=(',
    '              -o Dir::Etc::sourcelist=/etc/apt/sources.list.d/qianshu-ubuntu.sources',
    '              -o Dir::Etc::sourceparts=-',
    '              -o "Dir::State::lists=${apt_lists}"',
    '              -o Acquire::Retries=3',
    '              -o Acquire::https::Timeout=30',
    '            )',
    '            sudo timeout 5m apt-get "${apt_options[@]}" update',
    '            sudo timeout 15m apt-get "${apt_options[@]}" install --yes --no-install-recommends ffmpeg xvfb xauth',
    '          fi',
    '          test -x /usr/bin/ffprobe',
    '          test -x /usr/bin/xvfb-run',
    '          test -x /usr/bin/xauth',
    '          /usr/bin/ffprobe -version',
  ].join('\n'))
  assertTextOrder(job, [
    'sudo timeout 5m apt-get "${apt_options[@]}" update',
    'run: pnpm -C server install --frozen-lockfile',
    'run: pnpm -C web install --frozen-lockfile',
    'run: mkdir -p "$RUNNER_TEMP/browser-artifacts"',
    'QIANSHU_BROWSER_AUTH_SHARD: ${{ matrix.shard }}/2',
    "QIANSHU_BROWSER_USE_X11: '1'",
    'TMPDIR: ${{ runner.temp }}/browser-artifacts',
    'run: xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24 -nolisten tcp" node --run ci:browser-auth-e2e',
    'name: Upload browser failure artifacts',
    'run: git diff --exit-code -- .',
  ], 'browser-auth-e2e')
  const upload = findUseStep(job, uploadArtifactAction)
  assert.ok(upload.includes('if: failure()'))
  assert.ok(upload.includes('retention-days: 3'))
  assert.ok(upload.includes('path: ${{ runner.temp }}/browser-artifacts/*-ui-*'))
  assert.equal(job.includes('services:'), false)
  assert.equal(job.includes('DATABASE_URL'), false)
  assert.equal(job.includes('QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD'), false)
  assert.equal(job.includes('mirror+file:'), false)
  assert.equal(job.includes('azure.archive.ubuntu.com'), false)
})

test('browser-dictionaries-e2e 安装双依赖域并只调用字典隔离根入口', async () => {
  const job = extractJobs(await readCiWorkflow()).get('browser-dictionaries-e2e')
  assertDependencySetup(job, [
    'server/pnpm-lock.yaml',
    'web/pnpm-lock.yaml',
  ])
  assertTextOrder(job, [
    'run: pnpm -C server install --frozen-lockfile',
    'run: pnpm -C web install --frozen-lockfile',
    'run: node --run ci:browser-dictionaries-e2e',
    'run: git diff --exit-code -- .',
  ], 'browser-dictionaries-e2e')
  assert.equal(job.includes('services:'), false)
  assert.equal(job.includes('DATABASE_URL'), false)
  assert.equal(job.includes('QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD'), false)
})

test('browser-business-e2e 以 matrix 覆盖可稳定执行的业务浏览器验收', async () => {
  const job = extractJobs(await readCiWorkflow()).get('browser-business-e2e')
  assertDependencySetup(job, [
    'server/pnpm-lock.yaml',
    'web/pnpm-lock.yaml',
  ])
  assert.equal(extractBlock(job, 'strategy', 4), [
    '    strategy:',
    '      fail-fast: false',
    '      matrix:',
    '        suite: [numbering, regions, fund-accounts]',
  ].join('\n'))
  assert.match(job, /\n    name: Browser business E2E \(\$\{\{ matrix\.suite \}\}\)(?:\n|$)/u)
  for (const fact of [
    'https://archive.ubuntu.com/ubuntu/',
    'sudo timeout 5m apt-get "${apt_options[@]}" update',
    'sudo timeout 15m apt-get "${apt_options[@]}" install --yes --no-install-recommends ffmpeg',
    'test -x /usr/bin/ffprobe',
  ]) {
    assert.ok(job.includes(fact), `Browser business 缺少：${fact}`)
  }
  assert.equal(job.includes('azure.archive.ubuntu.com'), false)
  assert.equal(job.includes('xvfb-run'), false)
  assertTextOrder(job, [
    'run: pnpm -C server install --frozen-lockfile',
    'run: pnpm -C web install --frozen-lockfile',
    'run: mkdir -p "$RUNNER_TEMP/browser-artifacts"',
    'TMPDIR: ${{ runner.temp }}/browser-artifacts',
    'run: node --run ci:browser-${{ matrix.suite }}-e2e',
    'name: Upload browser failure artifacts',
    'run: git diff --exit-code -- .',
  ], 'browser-business-e2e')
  const upload = findUseStep(job, uploadArtifactAction)
  assert.ok(upload.includes('if: failure()'))
  assert.ok(upload.includes('retention-days: 3'))
  assert.equal(job.includes('services:'), false)
  assert.equal(job.includes('DATABASE_URL'), false)
  assert.equal(job.includes('QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD'), false)
})

test('examples.yml 只声明手动与每月定时触发并保持只读权限', async () => {
  const source = await readExamplesWorkflow()
  assert.equal(source.endsWith('\n'), true, 'examples.yml 必须以 LF 结尾')
  assert.equal(source.includes('\r'), false, 'examples.yml 只允许 LF')
  assert.equal(source.includes('\t'), false, 'examples.yml 禁止 tab 缩进')
  assert.equal(/^.* +$/mu.test(source), false, 'examples.yml 禁止行尾空格')
  assert.deepEqual(
    [...source.matchAll(/^([a-z][a-z0-9-]*):(?: .*)?$/gmu)].map(match => match[1]),
    ['name', 'on', 'permissions', 'jobs'],
  )
  assert.equal(source.startsWith('name: Examples\n'), true)
  assert.equal(extractBlock(source, 'on', 0), [
    'on:',
    '  workflow_dispatch:',
    '  schedule:',
    "    - cron: '17 2 1 * *'",
  ].join('\n'))
  assert.equal(extractBlock(source, 'permissions', 0), [
    'permissions:',
    '  contents: read',
  ].join('\n'))
  for (const forbidden of [
    'pull_request',
    'push:',
    'workflow_call',
    'continue-on-error',
    'paths:',
    'paths-ignore:',
    'secrets:',
    '${{ secrets.',
  ]) {
    assert.equal(source.includes(forbidden), false, `examples.yml 禁止：${forbidden}`)
  }
})

test('examples.yml 只有独立参考应用 Job 且固定运行时与 Action', async () => {
  const source = await readExamplesWorkflow()
  const jobs = extractJobs(source)
  assert.deepEqual([...jobs.keys()], ['examples-check-build'])
  const job = jobs.get('examples-check-build')
  assert.match(job, /\n    runs-on: ubuntu-24\.04(?:\n|$)/u)
  assert.match(job, /\n    timeout-minutes: 25(?:\n|$)/u)
  assert.equal(job.includes('\n    needs:'), false)
  assertCheckout(job, 1)
  assertDependencySetup(job, ['web/pnpm-lock.yaml'])
  assert.deepEqual(usesFrom(source), [
    checkoutAction,
    pnpmSetupAction,
    setupNodeAction,
  ])
  assert.equal(source.includes('server/pnpm-lock.yaml'), false)
  assert.equal(source.includes('services:'), false)
  assert.equal((source.match(/          cache: pnpm$/gmu) ?? []).length, 1)
})

test('examples.yml 只执行 Web 参考应用冻结安装、检查、构建与 tracked diff', async () => {
  const job = extractJobs(await readExamplesWorkflow()).get('examples-check-build')
  const runCommands = extractSteps(job).flatMap((step) => {
    const match = /^        run: (.+)$/mu.exec(step)
    return match === null ? [] : [match[1]]
  })
  assert.deepEqual(runCommands, [
    'pnpm -C web install --frozen-lockfile',
    'pnpm -C web check:examples',
    'pnpm -C web build:examples',
    'git diff --exit-code -- .',
  ])
  assertTrackedDiffIsLast(job)
  for (const forbidden of [
    'api:generate',
    'pnpm -C web check\n',
    'pnpm -C web build\n',
    'pnpm -C server',
  ]) {
    assert.equal(job.includes(forbidden), false, `参考应用 Job 禁止：${forbidden}`)
  }
})

test('参考应用 Workflow 不被主 CI 或 Release 引用', async () => {
  const workflows = [
    ['ci.yml', await readCiWorkflow()],
    ['release.yml', await readReleaseWorkflow()],
  ]
  for (const [name, source] of workflows) {
    assert.equal(source.includes('examples.yml'), false, `${name} 不得调用 examples.yml`)
    assert.equal(
      source.includes('examples-check-build'),
      false,
      `${name} 不得依赖参考应用 Job`,
    )
  }
})

test('Release trigger、只读权限与 concurrency 只允许稳定 Tag 串行发布', async () => {
  const source = await readReleaseWorkflow()
  assert.equal(source.endsWith('\n'), true, 'release.yml 必须以 LF 结尾')
  assert.equal(source.includes('\r'), false, 'release.yml 只允许 LF')
  assert.equal(source.includes('\t'), false, 'release.yml 禁止 tab 缩进')
  assert.equal(/^.* +$/mu.test(source), false, 'release.yml 禁止行尾空格')
  assert.deepEqual(
    [...source.matchAll(/^([a-z][a-z0-9-]*):(?: .*)?$/gmu)].map(match => match[1]),
    ['name', 'on', 'permissions', 'concurrency', 'jobs'],
  )
  assert.equal(source.startsWith('name: Release\n'), true)
  assert.equal(extractBlock(source, 'on', 0), [
    'on:',
    '  push:',
    '    tags:',
    "      - 'v*.*.*'",
  ].join('\n'))
  assert.equal(extractBlock(source, 'permissions', 0), [
    'permissions:',
    '  contents: read',
  ].join('\n'))
  assert.equal(extractBlock(source, 'concurrency', 0), [
    'concurrency:',
    '  group: qianshu-release',
    '  cancel-in-progress: false',
  ].join('\n'))
  for (const forbidden of [
    'workflow_dispatch',
    'pull_request',
    'workflow_call',
    'branches:',
    'paths:',
    'paths-ignore:',
    'continue-on-error',
    'include-hidden-files',
    'overwrite:',
    'pattern:',
    'git tag',
    'git push',
    'secrets:',
    '${{ secrets.',
  ]) {
    assert.equal(source.includes(forbidden), false, `release.yml 禁止：${forbidden}`)
  }
})

test('Release verify 以本地 reusable CI 复验同一 release tag', async () => {
  const verify = extractJobs(await readReleaseWorkflow()).get('verify')
  assert.equal(verify, [
    '  verify:',
    '    uses: ./.github/workflows/ci.yml',
    '    with:',
    '      release_tag: ${{ github.ref_name }}',
  ].join('\n'))
})

test('Release 六个 Job 的 needs、runner、timeout 和 checkout 精确', async () => {
  const jobs = extractJobs(await readReleaseWorkflow())
  assert.deepEqual([...jobs.keys()], releaseJobIds)
  const expected = new Map([
    ['package-web', { fetchDepth: 0, needs: 'verify', timeout: 30 }],
    ['package-server', { fetchDepth: 0, needs: 'verify', timeout: 40 }],
    ['package-images', { fetchDepth: 1, needs: '[package-web, package-server]', timeout: 40 }],
    ['manifest', { fetchDepth: 0, needs: '[package-web, package-server, package-images]', timeout: 25 }],
    ['publish', { fetchDepth: 1, needs: 'manifest', timeout: 15 }],
  ])
  for (const [id, values] of expected) {
    const job = jobs.get(id)
    assert.match(job, new RegExp(`\\n    needs: ${values.needs.replaceAll('[', '\\[').replaceAll(']', '\\]')}(?:\\n|$)`, 'u'))
    assert.match(job, /\n    runs-on: ubuntu-24\.04(?:\n|$)/u)
    assert.match(job, new RegExp(`\\n    timeout-minutes: ${values.timeout}(?:\\n|$)`, 'u'))
    assertCheckout(job, values.fetchDepth)
    assert.equal(countOccurrences(job, 'run: git diff --exit-code -- .'), 1)
  }
})

test('Release 只使用固定 Action SHA 且 artifact 身份只沿允许 Job 传播', async () => {
  const source = await readReleaseWorkflow()
  const references = usesFrom(source)
  assert.equal(references.filter(value => value === './.github/workflows/ci.yml').length, 1)
  assert.equal(references.filter(value => value === checkoutAction).length, 5)
  assert.equal(references.filter(value => value === pnpmSetupAction).length, 3)
  assert.equal(references.filter(value => value === setupNodeAction).length, 5)
  assert.equal(references.filter(value => value === uploadArtifactAction).length, 4)
  assert.equal(references.filter(value => value === downloadArtifactAction).length, 4)
  assert.equal(references.length, 22)
  assert.deepEqual(new Set(references), new Set([
    './.github/workflows/ci.yml',
    checkoutAction,
    pnpmSetupAction,
    setupNodeAction,
    uploadArtifactAction,
    downloadArtifactAction,
  ]))

  assert.equal(countOccurrences(source, '${{ steps.upload-web.outputs.artifact-id }}'), 1)
  assert.equal(countOccurrences(source, '${{ steps.upload-server.outputs.artifact-id }}'), 1)
  assert.equal(countOccurrences(source, '${{ steps.upload-images.outputs.artifact-id }}'), 1)
  assert.equal(countOccurrences(source, '${{ steps.upload-final.outputs.artifact-id }}'), 1)
  assert.equal(countOccurrences(source, '${{ steps.upload-final.outputs.artifact-digest }}'), 1)
  assert.equal(countOccurrences(source, '${{ needs.package-web.outputs.artifact-id }}'), 2)
  assert.equal(countOccurrences(source, '${{ needs.package-server.outputs.artifact-id }}'), 2)
  assert.equal(countOccurrences(source, '${{ needs.package-images.outputs.artifact-id }}'), 1)
  assert.equal(countOccurrences(source, '${{ needs.manifest.outputs.artifact-id }}'), 2)
  assert.equal(countOccurrences(source, '${{ needs.manifest.outputs.artifact-digest }}'), 1)
  assert.equal(countOccurrences(source, '${{ needs.manifest.outputs.bundle-run-attempt }}'), 2)
  assert.equal(source.includes('services:'), false)
  assert.equal(source.includes('postgres:'), false)
})

test('package-web 重新构建、验证并上传唯一 Web archive', async () => {
  const job = extractJobs(await readReleaseWorkflow()).get('package-web')
  assert.equal(extractBlock(job, 'outputs', 4), [
    '    outputs:',
    '      artifact-id: ${{ steps.upload-web.outputs.artifact-id }}',
  ].join('\n'))
  assertDependencySetup(job, ['web/pnpm-lock.yaml'])
  assert.equal(findNamedStep(job, 'Verify release identity'), [
    '      - name: Verify release identity',
    '        run: |',
    '          node --run release:check -- \\',
    '            --tag "$GITHUB_REF_NAME" \\',
    '            --source-commit "$GITHUB_SHA"',
  ].join('\n'))
  assertTextOrder(job, [
    'run: pnpm -C web install --frozen-lockfile',
    'run: pnpm -C web build',
    'node --run release:package:web --',
    '--output "$RUNNER_TEMP/release-web"',
    'test -f "$RUNNER_TEMP/release-web/qsmds-web-${GITHUB_REF_NAME}.tar.gz"',
    'run: git diff --exit-code -- .',
    `uses: ${uploadArtifactAction}`,
  ], 'package-web')
  assert.equal(findNamedStep(job, 'Upload Web archive'), [
    '      - name: Upload Web archive',
    '        id: upload-web',
    `        uses: ${uploadArtifactAction}`,
    '        with:',
    '          name: release-web-${{ github.run_id }}-${{ github.run_attempt }}',
    '          path: ${{ runner.temp }}/release-web/qsmds-web-${{ github.ref_name }}.tar.gz',
    '          if-no-files-found: error',
    '          retention-days: 1',
    '          compression-level: 0',
  ].join('\n'))
  assert.equal(job.includes('server/pnpm-lock.yaml'), false)
  assert.equal(job.includes('include-hidden-files'), false)
})

test('package-server 重新构建并在上传前完成隔离 PostgreSQL runtime smoke', async () => {
  const job = extractJobs(await readReleaseWorkflow()).get('package-server')
  assert.equal(extractBlock(job, 'outputs', 4), [
    '    outputs:',
    '      artifact-id: ${{ steps.upload-server.outputs.artifact-id }}',
  ].join('\n'))
  assertDependencySetup(job, ['server/pnpm-lock.yaml'])
  assert.equal(findNamedStep(job, 'Verify release identity'), [
    '      - name: Verify release identity',
    '        run: |',
    '          node --run release:check -- \\',
    '            --tag "$GITHUB_REF_NAME" \\',
    '            --source-commit "$GITHUB_SHA"',
  ].join('\n'))
  assertTextOrder(job, [
    'run: pnpm -C server install --frozen-lockfile',
    'run: pnpm -C server build',
    'node --run release:package:server --',
    '--output "$RUNNER_TEMP/release-server"',
    'test -f "$RUNNER_TEMP/release-server/qsmds-server-${GITHUB_REF_NAME}-linux-x64.tar.gz"',
    'node --run release:smoke:server --',
    '--archive "$RUNNER_TEMP/release-server/qsmds-server-${GITHUB_REF_NAME}-linux-x64.tar.gz"',
    'run: git diff --exit-code -- .',
    `uses: ${uploadArtifactAction}`,
  ], 'package-server')
  assert.equal(findNamedStep(job, 'Upload Server archive'), [
    '      - name: Upload Server archive',
    '        id: upload-server',
    `        uses: ${uploadArtifactAction}`,
    '        with:',
    '          name: release-server-${{ github.run_id }}-${{ github.run_attempt }}',
    '          path: ${{ runner.temp }}/release-server/qsmds-server-${{ github.ref_name }}-linux-x64.tar.gz',
    '          if-no-files-found: error',
    '          retention-days: 1',
    '          compression-level: 0',
  ].join('\n'))
  assert.equal(job.includes('web/pnpm-lock.yaml'), false)
  assert.equal(job.includes('services:'), false)
  assert.equal(job.includes('DATABASE_URL'), false)
})

test('manifest 只按精确 artifact ID 下载 package 与 image 两组输入并使用隔离目录', async () => {
  const job = extractJobs(await readReleaseWorkflow()).get('manifest')
  assertToolSetupWithoutCache(job)
  assert.equal(job.includes(' install'), false)
  assert.equal(extractBlock(job, 'outputs', 4), [
    '    outputs:',
    '      artifact-id: ${{ steps.upload-final.outputs.artifact-id }}',
    '      artifact-digest: ${{ steps.upload-final.outputs.artifact-digest }}',
    '      bundle-run-attempt: ${{ github.run_attempt }}',
  ].join('\n'))
  assertTextOrder(job, [
    'test ! -e "$RUNNER_TEMP/release-metadata"',
    'node --run release:check --',
    '--output "$RUNNER_TEMP/release-metadata/release-version.json"',
    'test ! -e "$RUNNER_TEMP/release-inputs"',
    `uses: ${downloadArtifactAction}`,
    'test -d "$RUNNER_TEMP/release-inputs"',
    'test ! -e "$RUNNER_TEMP/release-images"',
    'test -d "$RUNNER_TEMP/release-images"',
    'test ! -e "$RUNNER_TEMP/final-bundle"',
    'node --run release:manifest --',
    '--web-image "$RUNNER_TEMP/release-images/qsmds-web-image-${GITHUB_REF_NAME}-linux-x64.tar.gz"',
    '--server-image "$RUNNER_TEMP/release-images/qsmds-server-image-${GITHUB_REF_NAME}-linux-x64.tar.gz"',
    '--images-metadata "$RUNNER_TEMP/release-images/release-images.json"',
    '--output "$RUNNER_TEMP/final-bundle"',
    'test -f "$RUNNER_TEMP/final-bundle/release-manifest.json"',
    'test -f "$RUNNER_TEMP/final-bundle/SHA256SUMS"',
    'run: git diff --exit-code -- .',
    `uses: ${uploadArtifactAction}`,
  ], 'manifest')
  assert.equal(findNamedStep(job, 'Download package artifacts'), [
    '      - name: Download package artifacts',
    `        uses: ${downloadArtifactAction}`,
    '        with:',
    '          artifact-ids: ${{ needs.package-web.outputs.artifact-id }},${{ needs.package-server.outputs.artifact-id }}',
    '          path: ${{ runner.temp }}/release-inputs',
    '          merge-multiple: true',
  ].join('\n'))
  assert.equal(findNamedStep(job, 'Download image artifacts'), [
    '      - name: Download image artifacts',
    `        uses: ${downloadArtifactAction}`,
    '        with:',
    '          artifact-ids: ${{ needs.package-images.outputs.artifact-id }}',
    '          path: ${{ runner.temp }}/release-images',
    '          merge-multiple: true',
  ].join('\n'))
  const generate = findNamedStep(job, 'Generate final release bundle')
  assert.match(generate, /\n        env:\n          QIANSHU_RUNNER_IMAGE: ubuntu-24\.04\n/u)
  for (const forbidden of [
    'ImageOS:',
    'RUNNER_OS:',
    'RUNNER_ARCH:',
    'pattern:',
    'github-token:',
    'include-hidden-files',
  ]) {
    assert.equal(job.includes(forbidden), false, `Manifest Job 禁止：${forbidden}`)
  }
})

test('package-images 只消费两个归档并在上传前产出两个镜像归档与元数据', async () => {
  const job = extractJobs(await readReleaseWorkflow()).get('package-images')
  assert.equal(extractBlock(job, 'outputs', 4), [
    '    outputs:',
    '      artifact-id: ${{ steps.upload-images.outputs.artifact-id }}',
  ].join('\n'))
  // 镜像构建只需要仓库源码与 docker，不需要安装任何依赖域。
  assert.equal(job.includes(' install'), false)
  assert.equal(job.includes('pnpm'), false)
  assertTextOrder(job, [
    'test ! -e "$RUNNER_TEMP/release-inputs"',
    `uses: ${downloadArtifactAction}`,
    'server_archive="$RUNNER_TEMP/release-inputs/qsmds-server-${GITHUB_REF_NAME}-linux-x64.tar.gz"',
    'test -s "$server_archive"',
    'node --run release:images --',
    '--platform linux/amd64',
    '--server-archive "$RUNNER_TEMP/release-inputs/qsmds-server-${GITHUB_REF_NAME}-linux-x64.tar.gz"',
    '--web-archive "$RUNNER_TEMP/release-inputs/qsmds-web-${GITHUB_REF_NAME}.tar.gz"',
    '--output "$RUNNER_TEMP/release-images"',
    'test -f "$RUNNER_TEMP/release-images/release-images.json"',
    'run: git diff --exit-code -- .',
    `uses: ${uploadArtifactAction}`,
  ], 'package-images')
  assert.equal(findNamedStep(job, 'Upload image archives'), [
    '      - name: Upload image archives',
    '        id: upload-images',
    `        uses: ${uploadArtifactAction}`,
    '        with:',
    '          name: release-images-${{ github.run_id }}-${{ github.run_attempt }}',
    '          path: ${{ runner.temp }}/release-images/',
    '          if-no-files-found: error',
    '          retention-days: 1',
    '          compression-level: 0',
  ].join('\n'))
  for (const forbidden of [
    'services:',
    'postgres:',
    'docker/login-action',
    'docker/build-push-action',
  ]) {
    assert.equal(job.includes(forbidden), false, `package-images Job 禁止：${forbidden}`)
  }
})

test('manifest final bundle 恰好六文件并输出固定 final artifact 身份', async () => {
  const job = extractJobs(await readReleaseWorkflow()).get('manifest')
  const validateInputs = findNamedStep(job, 'Validate package artifact set')
  for (const expected of [
    'qsmds-web-${GITHUB_REF_NAME}.tar.gz',
    'qsmds-server-${GITHUB_REF_NAME}-linux-x64.tar.gz',
    'find "$RUNNER_TEMP/release-inputs" -mindepth 1 -maxdepth 1 | wc -l',
    '-eq 2',
  ]) {
    assert.equal(validateInputs.includes(expected), true, `输入校验缺少：${expected}`)
  }
  const validateImages = findNamedStep(job, 'Validate image artifact set')
  for (const expected of [
    'qsmds-${image}-image-${GITHUB_REF_NAME}-linux-x64.tar.gz',
    'release-images.json',
    'find "$RUNNER_TEMP/release-images" -mindepth 1 -maxdepth 1 | wc -l',
    '-eq 3',
  ]) {
    assert.equal(validateImages.includes(expected), true, `镜像输入校验缺少：${expected}`)
  }
  const validateFinal = findNamedStep(job, 'Validate final release bundle')
  for (const expected of [
    'qsmds-web-${GITHUB_REF_NAME}.tar.gz',
    'qsmds-server-${GITHUB_REF_NAME}-linux-x64.tar.gz',
    'qsmds-${image}-image-${GITHUB_REF_NAME}-linux-x64.tar.gz',
    'release-manifest.json',
    'SHA256SUMS',
    'find "$RUNNER_TEMP/final-bundle" -mindepth 1 -maxdepth 1 | wc -l',
    '-eq 6',
  ]) {
    assert.equal(validateFinal.includes(expected), true, `最终目录校验缺少：${expected}`)
  }
  assert.equal(findNamedStep(job, 'Upload final release bundle'), [
    '      - name: Upload final release bundle',
    '        id: upload-final',
    `        uses: ${uploadArtifactAction}`,
    '        with:',
    '          name: release-final-${{ github.run_id }}-${{ github.run_attempt }}',
    '          path: ${{ runner.temp }}/final-bundle/',
    '          if-no-files-found: error',
    '          retention-days: 7',
    '          compression-level: 0',
  ].join('\n'))
})

test('publish-only 以唯一写权限复用原 bundle 身份且只归一化一次 digest', async () => {
  const source = await readReleaseWorkflow()
  const job = extractJobs(source).get('publish')
  assert.equal(extractBlock(job, 'permissions', 4), [
    '    permissions:',
    '      actions: read',
    '      contents: write',
  ].join('\n'))
  assert.equal(countOccurrences(source, 'contents: write'), 1)
  assert.equal(countOccurrences(source, 'actions: read'), 1)
  const node = findUseStep(job, setupNodeAction)
  assert.match(node, /\n          node-version-file: \.node-version(?:\n|$)/u)
  assert.match(node, /\n          package-manager-cache: false(?:\n|$)/u)
  assert.equal(job.includes(pnpmSetupAction), false)
  assert.equal(job.includes('pnpm '), false)
  assert.deepEqual(usesFrom(job), [
    checkoutAction,
    setupNodeAction,
    downloadArtifactAction,
  ])
  assert.equal(findNamedStep(job, 'Download final release bundle'), [
    '      - name: Download final release bundle',
    `        uses: ${downloadArtifactAction}`,
    '        with:',
    '          artifact-ids: ${{ needs.manifest.outputs.artifact-id }}',
    '          path: ${{ runner.temp }}/final-bundle',
  ].join('\n'))
  assertTextOrder(job, [
    'test ! -e "$RUNNER_TEMP/final-bundle"',
    `uses: ${downloadArtifactAction}`,
    'run: git diff --exit-code -- .',
    'node --run release:publish --',
  ], 'publish')
  assert.equal(findNamedStep(job, 'Publish GitHub Release'), [
    '      - name: Publish GitHub Release',
    '        env:',
    '          GITHUB_TOKEN: ${{ github.token }}',
    '        run: |',
    '          node --run release:publish -- \\',
    '            --repository "$GITHUB_REPOSITORY" \\',
    '            --tag "$GITHUB_REF_NAME" \\',
    '            --source-commit "$GITHUB_SHA" \\',
    '            --run-id "$GITHUB_RUN_ID" \\',
    '            --bundle-run-attempt "${{ needs.manifest.outputs.bundle-run-attempt }}" \\',
    '            --current-run-attempt "$GITHUB_RUN_ATTEMPT" \\',
    '            --artifact-id "${{ needs.manifest.outputs.artifact-id }}" \\',
    '            --artifact-digest "sha256:${{ needs.manifest.outputs.artifact-digest }}" \\',
    '            --artifact-name "release-final-${GITHUB_RUN_ID}-${{ needs.manifest.outputs.bundle-run-attempt }}" \\',
    '            --bundle "$RUNNER_TEMP/final-bundle"',
  ].join('\n'))
  assert.equal(
    countOccurrences(source, 'sha256:${{ needs.manifest.outputs.artifact-digest }}'),
    1,
  )
  for (const forbidden of [
    '--artifact-digest "${{ needs.manifest.outputs.artifact-digest }}"',
    'release:package:',
    'release:manifest',
    `uses: ${uploadArtifactAction}`,
  ]) {
    assert.equal(job.includes(forbidden), false, `Publish Job 禁止：${forbidden}`)
  }
  assert.equal(countOccurrences(source, 'GITHUB_TOKEN:'), 1)
})

// 发布流程曾在 package-images 上因 node --run release:images 缺少根脚本入口而失败，
// 因此工作流引用的根脚本必须在根 package.json 中真实存在。
test('Workflow 引用的根脚本都在根 package.json 中存在', async () => {
  const manifest = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  )
  const scripts = new Set(Object.keys(manifest.scripts ?? {}))
  const sources = [
    ['ci.yml', await readCiWorkflow()],
    ['examples.yml', await readExamplesWorkflow()],
    ['release.yml', await readReleaseWorkflow()],
  ]
  const browserBusinessScripts = [
    'ci:browser-numbering-e2e',
    'ci:browser-regions-e2e',
    'ci:browser-fund-accounts-e2e',
  ]
  let referenceCount = 0
  for (const [label, source] of sources) {
    const references = source.matchAll(
      /node --run (ci:browser-\$\{\{ matrix\.suite \}\}-e2e|[a-z0-9:_-]+)/gu,
    )
    for (const match of references) {
      if (match[1] === 'ci:browser-${{ matrix.suite }}-e2e') {
        for (const script of browserBusinessScripts) {
          referenceCount += 1
          assert.equal(
            scripts.has(script),
            true,
            `${label} 引用了根 package.json 中不存在的脚本：${script}`,
          )
        }
        continue
      }
      referenceCount += 1
      assert.equal(
        scripts.has(match[1]),
        true,
        `${label} 引用了根 package.json 中不存在的脚本：${match[1]}`,
      )
    }
  }
  assert.ok(referenceCount > 0, 'Workflow 应通过 node --run 调用根脚本')
})
