import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { constants as filesystemConstants } from 'node:fs'
import { access, chmod, mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  createBrowserRegionsOutputRelay,
  createBrowserRegionsPlan,
  createBrowserRegionsProcessRegistry,
} from './ci-browser-regions-e2e.mjs'
import { isDirectEntry } from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const serviceReadyTimeoutMilliseconds = 90_000
const serviceReadyPollMilliseconds = 250
const gracefulStopTimeoutMilliseconds = 3_000

const databaseVerificationProgram = String.raw`
const { Client } = require('pg')

const expectedCodes = [
  'E2E_BROWSER_SEQUENCE',
  'E2E_BROWSER_RANDOM',
  'E2E_BROWSER_MIXED',
  'E2E_BROWSER_CLONE',
]
const requiredEvents = [
  'NUMBERING_RULE_CREATED',
  'NUMBERING_RULE_UPDATED',
  'NUMBERING_RULE_VERSION_PUBLISHED',
  'NUMBERING_RULE_ENABLED',
  'NUMBERING_RULE_DISABLED',
]

;(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const rulesResult = await client.query(
      [
        'SELECT id, rule_code, status, version',
        'FROM numbering_rules',
        'WHERE rule_code = ANY($1::varchar[])',
        'ORDER BY rule_code ASC',
      ].join(' '),
      [expectedCodes],
    )
    const actualCodes = rulesResult.rows.map((row) => row.rule_code)
    if (
      rulesResult.rowCount !== expectedCodes.length
      || expectedCodes.some((code) => !actualCodes.includes(code))
    ) {
      throw new Error('numbering rules')
    }

    const sequenceRule = rulesResult.rows.find(
      (row) => row.rule_code === 'E2E_BROWSER_SEQUENCE',
    )
    const cloneRule = rulesResult.rows.find(
      (row) => row.rule_code === 'E2E_BROWSER_CLONE',
    )
    if (
      sequenceRule?.status !== 'DISABLED'
      || !Number.isInteger(sequenceRule.version)
      || sequenceRule.version < 5
      || cloneRule?.status !== 'DRAFT'
    ) {
      throw new Error('numbering lifecycle')
    }

    const segmentResult = await client.query(
      [
        'SELECT s.type',
        'FROM numbering_rule_segments s',
        'JOIN numbering_rule_versions v ON v.id = s.version_id',
        'WHERE v.rule_id = $1 AND v.status = $2',
        'ORDER BY s.position ASC',
      ].join(' '),
      [sequenceRule.id, 'ACTIVE'],
    )
    const segmentTypes = segmentResult.rows.map((row) => row.type)
    if (
      segmentResult.rowCount !== 5
      || new Set(segmentTypes).size !== 5
      || ['FIXED', 'DATE', 'SEPARATOR', 'SEQUENCE', 'RANDOM']
        .some((type) => !segmentTypes.includes(type))
    ) {
      throw new Error('numbering segments')
    }

    const actorResult = await client.query(
      'SELECT id FROM users WHERE username_normalized = $1',
      ['browser_admin'],
    )
    if (actorResult.rowCount !== 1) {
      throw new Error('audit actor')
    }
    const auditResult = await client.query(
      [
        'SELECT event_type, outcome, actor_user_id, request_id',
        'FROM audit_events',
        'WHERE target_type = $1 AND target_id = $2',
        'AND event_type = ANY($3::audit_event_type[])',
        'ORDER BY occurred_at ASC, id ASC',
      ].join(' '),
      ['NumberingRule', sequenceRule.id, requiredEvents],
    )
    const actualEvents = auditResult.rows.map((row) => row.event_type)
    if (
      requiredEvents.some((event) => !actualEvents.includes(event))
      || auditResult.rows.some((row) => (
        row.outcome !== 'SUCCESS'
        || row.actor_user_id !== actorResult.rows[0].id
        || typeof row.request_id !== 'string'
        || row.request_id.length === 0
      ))
    ) {
      throw new Error('audit state')
    }
  }
  finally {
    await client.end()
  }
})().catch(() => {
  process.stderr.write('DATABASE_VERIFICATION_FAILED')
  process.exit(1)
})
`

class BrowserNumberingE2eError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'BrowserNumberingE2eError'
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0
      ? exitCode
      : 1
  }
}

function fixedError(message, exitCode = 1) {
  return new BrowserNumberingE2eError(message, exitCode)
}

/** 编号 Browser 只接受根级 ci-postgres 动态注入的固定本机数据库边界。 */
export function validateBrowserNumberingDatabaseUrl(rawValue) {
  let parsed
  try {
    parsed = new URL(rawValue)
  }
  catch {
    throw fixedError(
      'Browser numbering E2E database URL is outside the isolated boundary',
    )
  }

  const query = [...parsed.searchParams.entries()]
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol)
    || parsed.username !== 'qianshu_ci'
    || parsed.password.length === 0
    || !['127.0.0.1', 'localhost'].includes(parsed.hostname)
    || !/^\d{1,5}$/u.test(parsed.port)
    || parsed.pathname !== '/qianshu_ci'
    || parsed.hash !== ''
    || JSON.stringify(query) !== JSON.stringify([['schema', 'public']])
  ) {
    throw fixedError(
      'Browser numbering E2E database URL is outside the isolated boundary',
    )
  }
  return rawValue
}

/**
 * 复用地区套件已经审计的真实构建、认证 fixture、双 Server、静态站点与 TLS
 * 同源代理，只替换最终 Browser runner 和编号专属数据库最终态核验。
 */
export function createBrowserNumberingPlan(input) {
  const basePlan = createBrowserRegionsPlan(input)
  return Object.freeze({
    prepare: basePlan.prepare,
    services: basePlan.services,
    runner: Object.freeze({
      ...basePlan.runner,
      args: Object.freeze(['-C', 'web', 'test:browser:numbering']),
      env: Object.freeze({
        ...basePlan.runner.env,
        QIANSHU_BROWSER_NUMBERING_LIMITED_PASSWORD:
          input.secrets.limitedPassword,
      }),
    }),
    verify: Object.freeze([
      Object.freeze({
        name: 'numbering-database-verification',
        command: 'pnpm',
        args: Object.freeze([
          '-C', 'server', 'exec', 'node',
          '--input-type=commonjs',
          '--eval',
          databaseVerificationProgram,
        ]),
        env: basePlan.prepare[0].env,
      }),
    ]),
  })
}

/** 外层进程 relay 必须遮罩本次隔离运行创建的全部数据库与登录凭据。 */
export function createBrowserNumberingSensitiveValues(databaseUrl, secrets) {
  return Object.freeze([
    databaseUrl,
    new URL(databaseUrl).password,
    secrets.adminPassword,
    secrets.limitedPassword,
    ...secrets.hmacKeys,
  ])
}

/** 任何阶段失败都保留首错，并逆序停止本次拥有的服务。 */
export async function runBrowserNumberingE2e({ plan, dependencies }) {
  const started = []
  let primaryError
  try {
    for (const step of plan.prepare) {
      await dependencies.prepare(step)
    }
    for (const definition of plan.services) {
      const handle = await dependencies.startService(definition)
      started.push(handle)
      await dependencies.waitUntilReady(definition, handle)
    }
    await dependencies.runRunner(plan.runner)
    for (const step of plan.verify) {
      await dependencies.verify(step)
    }
  }
  catch (error) {
    primaryError = error
  }
  finally {
    for (const handle of started.reverse()) {
      try {
        await dependencies.stopService(handle)
      }
      catch {
        primaryError ??= fixedError(
          'Browser numbering E2E service cleanup failed',
        )
      }
    }
    try {
      await dependencies.cleanup()
    }
    catch {
      primaryError ??= fixedError(
        'Browser numbering E2E temporary cleanup failed',
      )
    }
  }
  if (primaryError !== undefined) {
    throw primaryError
  }
}

function allocateLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null
        ? address.port
        : undefined
      server.close((error) => {
        if (error) {
          reject(error)
        }
        else if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          reject(fixedError('Browser numbering E2E port allocation failed'))
        }
        else {
          resolve(port)
        }
      })
    })
  })
}

async function allocatePorts() {
  const values = []
  while (values.length < 5) {
    const candidate = await allocateLoopbackPort()
    if (!values.includes(candidate)) {
      values.push(candidate)
    }
  }
  return {
    devProxy: values[0],
    devServer: values[1],
    prodProxy: values[2],
    prodServer: values[3],
    web: values[4],
  }
}

async function resolveChromeExecutable(environment = process.env) {
  const candidates = [
    environment.QIANSHU_CHROME_EXECUTABLE,
    process.platform === 'darwin'
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined,
    process.platform === 'darwin'
      ? '/Applications/Chromium.app/Contents/MacOS/Chromium'
      : undefined,
    process.platform === 'linux' ? '/usr/bin/google-chrome' : undefined,
    process.platform === 'linux' ? '/usr/bin/google-chrome-stable' : undefined,
    process.platform === 'linux' ? '/usr/bin/chromium' : undefined,
    process.platform === 'linux' ? '/usr/bin/chromium-browser' : undefined,
  ].filter(value => typeof value === 'string' && path.isAbsolute(value))

  for (const candidate of candidates) {
    try {
      await access(candidate, filesystemConstants.X_OK)
      return candidate
    }
    catch {
      // 继续检查固定候选，真实路径和底层权限信息不进入最终错误。
    }
  }
  throw fixedError('Browser numbering E2E Chrome executable is unavailable')
}

function exitCodeFromResult(code, signal) {
  if (Number.isInteger(code)) {
    return code
  }
  const signalNumber = typeof signal === 'string'
    ? os.constants.signals[signal]
    : undefined
  return Number.isInteger(signalNumber) && signalNumber > 0
    ? 128 + signalNumber
    : 1
}

function startManagedProcess(definition, sensitiveValues, relay = {}) {
  let child
  try {
    child = spawn(definition.command, definition.args, {
      cwd: repositoryRoot,
      detached: true,
      env: definition.env,
      shell: false,
      stdio: definition.stdio === 'ignore'
        ? ['ignore', 'ignore', 'ignore']
        : ['ignore', 'pipe', 'pipe'],
    })
  }
  catch {
    throw fixedError(
      `Browser numbering E2E process failed to start: ${definition.name}`,
    )
  }

  const stdoutRelay = createBrowserRegionsOutputRelay(
    value => process.stdout.write(value),
    sensitiveValues,
  )
  const stderrRelay = createBrowserRegionsOutputRelay(
    value => process.stderr.write(value),
    sensitiveValues,
  )
  const completion = new Promise((resolve) => {
    let settled = false
    const settle = (result) => {
      if (!settled) {
        settled = true
        stdoutRelay.flush()
        stderrRelay.flush()
        resolve(result)
      }
    }
    child.stdout?.on('data', (chunk) => {
      if (relay.stdout === true) {
        stdoutRelay.push(chunk)
      }
    })
    child.stderr?.on('data', (chunk) => {
      if (relay.stderr !== false) {
        stderrRelay.push(chunk)
      }
    })
    child.once('error', () => settle({ code: 1, signal: null }))
    child.once('close', (code, signal) => settle({ code, signal }))
  })
  return { child, completion, definition }
}

function requestStatus(url) {
  return new Promise((resolve) => {
    const parsed = new URL(url)
    const requester = parsed.protocol === 'https:' ? httpsRequest : httpRequest
    const request = requester(parsed, {
      method: 'GET',
      rejectUnauthorized: false,
      timeout: 2_000,
    }, (response) => {
      response.resume()
      resolve(response.statusCode ?? 0)
    })
    request.once('timeout', () => {
      request.destroy()
      resolve(0)
    })
    request.once('error', () => resolve(0))
    request.end()
  })
}

async function waitUntilReady(definition, handle) {
  const deadline = Date.now() + serviceReadyTimeoutMilliseconds
  while (Date.now() < deadline) {
    const outcome = await Promise.race([
      handle.completion.then(result => ({ result, type: 'exit' })),
      requestStatus(definition.readyUrl)
        .then(status => ({ status, type: 'status' })),
    ])
    if (outcome.type === 'exit') {
      throw fixedError(
        `Browser numbering E2E service exited early: ${definition.name}`,
      )
    }
    if (outcome.status === 200) {
      return
    }
    await new Promise(
      resolve => setTimeout(resolve, serviceReadyPollMilliseconds),
    )
  }
  throw fixedError(
    `Browser numbering E2E service readiness timed out: ${definition.name}`,
  )
}

async function stopManagedProcess(handle) {
  const child = handle.child
  if (child.exitCode !== null || child.signalCode !== null) {
    await handle.completion
    return
  }
  try {
    process.kill(-child.pid, 'SIGTERM')
  }
  catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error
    }
  }
  const stopped = await Promise.race([
    handle.completion.then(() => true),
    new Promise(resolve => setTimeout(
      () => resolve(false),
      gracefulStopTimeoutMilliseconds,
    )),
  ])
  if (!stopped) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    }
    catch (error) {
      if (error?.code !== 'ESRCH') {
        throw error
      }
    }
    await handle.completion
  }
}

async function runManagedStep(definition, registry, sensitiveValues) {
  const ignored = definition.stdio === 'ignore'
  const handle = startManagedProcess(definition, sensitiveValues, {
    stderr: !ignored,
    stdout: !ignored,
  })
  registry.setActive(handle)
  let result
  try {
    result = await handle.completion
  }
  finally {
    registry.clearActive(handle)
  }
  if (result.code !== 0) {
    throw fixedError(
      `Browser numbering E2E step failed: ${definition.name}`,
      exitCodeFromResult(result.code, result.signal),
    )
  }
}

async function runManagedRunner(definition, registry, sensitiveValues) {
  const handle = startManagedProcess(definition, sensitiveValues, {
    stderr: true,
    stdout: true,
  })
  registry.setActive(handle)
  let result
  try {
    result = await handle.completion
  }
  finally {
    registry.clearActive(handle)
  }
  if (result.code !== 0) {
    throw fixedError(
      'Browser numbering E2E Web runner failed',
      exitCodeFromResult(result.code, result.signal),
    )
  }
}

export async function runProductionBrowserNumberingE2e() {
  const databaseUrl = validateBrowserNumberingDatabaseUrl(
    process.env.DATABASE_URL,
  )
  const sessionDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'qianshu-browser-numbering-e2e-'),
  )
  const registry = createBrowserRegionsProcessRegistry(stopManagedProcess)
  let listenersRegistered = false
  let primaryError
  let requestedSignal

  const interruptedError = () => fixedError(
    'Browser numbering E2E interrupted',
    requestedSignal === 'SIGINT' ? 130 : 143,
  )
  const throwIfInterrupted = () => {
    if (requestedSignal !== undefined) {
      throw interruptedError()
    }
  }
  const signalHandler = (signal) => {
    if (requestedSignal !== undefined) {
      return
    }
    requestedSignal = signal
    void registry.stopAll().catch(() => undefined)
  }
  const handleSigint = () => signalHandler('SIGINT')
  const handleSigterm = () => signalHandler('SIGTERM')

  try {
    await chmod(sessionDirectory, 0o700)
    process.on('SIGINT', handleSigint)
    process.on('SIGTERM', handleSigterm)
    listenersRegistered = true

    const chromeExecutable = await resolveChromeExecutable()
    const ports = await allocatePorts()
    throwIfInterrupted()
    const secrets = {
      adminPassword: `Bn-${randomBytes(9).toString('base64url')}!8`,
      hmacKeys: [0, 1, 2]
        .map(() => randomBytes(32).toString('base64url')),
      limitedPassword: `Nl-${randomBytes(8).toString('base64url')}!7`,
    }
    const sensitiveValues = createBrowserNumberingSensitiveValues(
      databaseUrl,
      secrets,
    )
    const plan = createBrowserNumberingPlan({
      chromeExecutable,
      databaseUrl,
      ports,
      secrets,
      sessionDirectory,
    })

    await runBrowserNumberingE2e({
      plan,
      dependencies: {
        cleanup: () => rm(sessionDirectory, { force: true, recursive: true }),
        prepare: async (step) => {
          throwIfInterrupted()
          await runManagedStep(step, registry, sensitiveValues)
          throwIfInterrupted()
        },
        runRunner: async (runner) => {
          throwIfInterrupted()
          await runManagedRunner(runner, registry, sensitiveValues)
          throwIfInterrupted()
        },
        startService: (definition) => {
          throwIfInterrupted()
          const handle = startManagedProcess(
            definition,
            sensitiveValues,
            { stderr: true, stdout: false },
          )
          registry.addService(handle)
          return handle
        },
        stopService: async (handle) => {
          try {
            await registry.stop(handle)
          }
          finally {
            registry.removeService(handle)
          }
        },
        verify: async (step) => {
          throwIfInterrupted()
          await runManagedStep(step, registry, sensitiveValues)
          throwIfInterrupted()
        },
        waitUntilReady: async (definition, handle) => {
          await waitUntilReady(definition, handle)
          throwIfInterrupted()
        },
      },
    })
    throwIfInterrupted()
  }
  catch (error) {
    primaryError = error
  }
  finally {
    if (listenersRegistered) {
      process.off('SIGINT', handleSigint)
      process.off('SIGTERM', handleSigterm)
    }
    try {
      await rm(sessionDirectory, { force: true, recursive: true })
    }
    catch {
      primaryError ??= fixedError(
        'Browser numbering E2E temporary cleanup failed',
      )
    }
  }
  if (primaryError !== undefined) {
    throw primaryError
  }
}

if (isDirectEntry(import.meta.url)) {
  runProductionBrowserNumberingE2e().catch((error) => {
    process.exitCode = error instanceof BrowserNumberingE2eError
      ? error.exitCode
      : 1
    console.error(
      error instanceof BrowserNumberingE2eError
        ? error.message
        : 'Browser numbering E2E failed unexpectedly',
    )
  })
}
