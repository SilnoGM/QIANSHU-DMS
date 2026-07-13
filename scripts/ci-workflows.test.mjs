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
const requiredJobIds = Object.freeze([
  'root-governance',
  'server-check-build',
  'server-e2e',
  'contract',
  'web-check-build',
  'ci-gate',
])
const validationJobIds = requiredJobIds.slice(0, -1)

let workflowPromise
let examplesWorkflowPromise

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

async function readReleaseWorkflowIfPresent() {
  try {
    return await readFile(releaseWorkflowPath, 'utf8')
  }
  catch (error) {
    if (error?.code === 'ENOENT') {
      return ''
    }
    throw error
  }
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
  assert.equal(references.filter(value => value === checkoutAction).length, 5)
  assert.equal(references.filter(value => value === pnpmSetupAction).length, 4)
  assert.equal(references.filter(value => value === setupNodeAction).length, 5)
  assert.equal(references.length, 14)
  assert.equal((source.match(/          cache: pnpm$/gmu) ?? []).length, 4)
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

test('ci-gate always 汇总五个 Job 且拒绝所有非 success 状态', async () => {
  const gate = extractJobs(await readCiWorkflow()).get('ci-gate')
  assert.match(
    gate,
    /\n    needs: \[root-governance, server-check-build, server-e2e, contract, web-check-build\](?:\n|$)/u,
  )
  assert.match(gate, /\n    if: always\(\)(?:\n|$)/u)
  assert.match(gate, /\n          NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}(?:\n|$)/u)
  const program = gateProgram(gate)
  const success = runGate(program, successfulNeeds())
  assert.equal(success.error, undefined)
  assert.equal(success.status, 0, success.stderr)

  for (const result of ['failure', 'cancelled', 'skipped']) {
    const needs = successfulNeeds()
    needs.contract.result = result
    const rejected = runGate(program, needs)
    assert.equal(rejected.error, undefined)
    assert.equal(rejected.status, 1, `ci-gate 必须拒绝 ${result}`)
  }
})

test('server-check-build 使用 Server cache 并执行固定检查构建顺序', async () => {
  const job = extractJobs(await readCiWorkflow()).get('server-check-build')
  assertDependencySetup(job, ['server/pnpm-lock.yaml'])
  assertTextOrder(job, [
    'run: pnpm -C server install --frozen-lockfile',
    'run: pnpm -C server check',
    'run: pnpm -C server build',
    'run: test -f server/dist/main.js && test ! -L server/dist/main.js && test -s server/dist/main.js',
    'run: git diff --exit-code -- .',
  ], 'server-check-build')
  assert.equal(job.includes('web/pnpm-lock.yaml'), false)
})

test('server-e2e 只通过固定 PostgreSQL wrapper 执行隔离 E2E', async () => {
  const job = extractJobs(await readCiWorkflow()).get('server-e2e')
  assertDependencySetup(job, ['server/pnpm-lock.yaml'])
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
    'run: git diff --exit-code -- .',
  ], 'web-check-build')
  assert.equal(job.includes('server/pnpm-lock.yaml'), false)
  assert.equal(job.includes('check:examples'), false)
  assert.equal(job.includes('build:examples'), false)
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
    ['release.yml', await readReleaseWorkflowIfPresent()],
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
