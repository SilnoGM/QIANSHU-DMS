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

;(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const accounts = await client.query(
      [
        'SELECT u.username_normalized, a.currency,',
        'a.balance::text AS balance,',
        'a.user_share_rate::text AS user_share_rate',
        'FROM fund_accounts a',
        'JOIN users u ON u.id = a.user_id',
        'WHERE u.username_normalized = ANY($1::varchar[])',
        'ORDER BY u.username_normalized ASC',
      ].join(' '),
      [['fund_browser_flow_user', 'fund_browser_ledger_user']],
    )
    if (
      accounts.rowCount !== 2
      || accounts.rows[0]?.username_normalized !== 'fund_browser_flow_user'
      || accounts.rows[0]?.currency !== 'CNY'
      || accounts.rows[0]?.balance !== '82.0000'
      || accounts.rows[0]?.user_share_rate !== '45.0000'
      || accounts.rows[1]?.username_normalized !== 'fund_browser_ledger_user'
      || accounts.rows[1]?.currency !== 'CNY'
      || accounts.rows[1]?.balance !== '3.0000'
      || accounts.rows[1]?.user_share_rate !== '30.0000'
    ) {
      throw new Error('user account state')
    }

    const company = await client.query(
      'SELECT balance::text AS balance, currency FROM fund_accounts WHERE owner_type = $1',
      ['COMPANY'],
    )
    if (
      company.rowCount !== 1
      || company.rows[0]?.currency !== 'CNY'
      || company.rows[0]?.balance !== '-15.0000'
    ) {
      throw new Error('company account state')
    }

    const batches = await client.query(
      [
        'SELECT id, kind, business_no, business_amount::text AS amount,',
        'business_category_snapshot AS category,',
        'user_share_rate_snapshot::text AS user_share_rate',
        'FROM fund_posting_batches',
        'WHERE business_no = ANY($1::varchar[])',
        "AND kind = 'BUSINESS'",
        'ORDER BY business_no ASC',
      ].join(' '),
      [['E2E-ORDER-LOSS', 'E2E-ORDER-PROFIT']],
    )
    const loss = batches.rows.find(
      (row) => row.business_no === 'E2E-ORDER-LOSS',
    )
    const profit = batches.rows.find(
      (row) => row.business_no === 'E2E-ORDER-PROFIT',
    )
    if (
      batches.rowCount !== 2
      || loss?.kind !== 'BUSINESS'
      || loss?.amount !== '-50.0000'
      || loss?.category !== 'REVENUE'
      || loss?.user_share_rate !== '30.0000'
      || profit?.kind !== 'BUSINESS'
      || profit?.amount !== '100.0000'
      || profit?.category !== 'REVENUE'
      || profit?.user_share_rate !== '30.0000'
    ) {
      throw new Error('business batch snapshots')
    }

    const reversals = await client.query(
      [
        'SELECT business_amount::text AS amount,',
        'business_category_snapshot AS category, reversal_reason',
        'FROM fund_posting_batches',
        'WHERE reversal_of_batch_id = $1',
      ].join(' '),
      [profit.id],
    )
    if (
      reversals.rowCount !== 1
      || reversals.rows[0]?.amount !== '-40.0000'
      || reversals.rows[0]?.category !== 'REVENUE'
      || reversals.rows[0]?.reversal_reason !== 'Browser 部分冲账验收'
    ) {
      throw new Error('reversal state')
    }

    const admin = await client.query(
      'SELECT id FROM users WHERE username_normalized = $1',
      ['browser_admin'],
    )
    const audit = await client.query(
      [
        'SELECT event_type, outcome, request_id',
        'FROM audit_events',
        'WHERE actor_user_id = $1',
        'AND event_type = ANY($2::audit_event_type[])',
        'ORDER BY occurred_at ASC, id ASC',
      ].join(' '),
      [admin.rows[0]?.id, [
        'FUND_ACCOUNT_CREATED',
        'FUND_ACCOUNT_SHARE_RATE_UPDATED',
        'FUND_MANUAL_ADJUSTMENT_POSTED',
        'FUND_POSTING_REVERSED',
      ]],
    )
    const eventTypes = audit.rows.map((row) => row.event_type)
    if (
      admin.rowCount !== 1
      || !eventTypes.includes('FUND_ACCOUNT_CREATED')
      || !eventTypes.includes('FUND_ACCOUNT_SHARE_RATE_UPDATED')
      || eventTypes.filter(
        (event) => event === 'FUND_MANUAL_ADJUSTMENT_POSTED',
      ).length !== 2
      || !eventTypes.includes('FUND_POSTING_REVERSED')
      || audit.rows.some((row) => (
        row.outcome !== 'SUCCESS'
        || typeof row.request_id !== 'string'
        || row.request_id.length === 0
      ))
    ) {
      throw new Error('audit state')
    }

    const limitedPermissions = await client.query(
      [
        'SELECT count(*)::integer AS count',
        'FROM users u',
        'JOIN user_roles ur ON ur.user_id = u.id',
        'JOIN role_permissions rp ON rp.role_id = ur.role_id',
        'JOIN permissions p ON p.id = rp.permission_id',
        'WHERE u.username_normalized = $1',
        'AND p.code LIKE $2',
      ].join(' '),
      ['fund_browser_limited', 'fund-%'],
    )
    if (limitedPermissions.rows[0]?.count !== 0) {
      throw new Error('limited permissions')
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

class BrowserFundAccountsE2eError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'BrowserFundAccountsE2eError'
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0
      ? exitCode
      : 1
  }
}

function fixedError(message, exitCode = 1) {
  return new BrowserFundAccountsE2eError(message, exitCode)
}

/** 资金账户 Browser 只接受根级 ci-postgres 动态注入的固定本机数据库边界。 */
export function validateBrowserFundAccountsDatabaseUrl(rawValue) {
  let parsed
  try {
    parsed = new URL(rawValue)
  }
  catch {
    throw fixedError(
      'Browser fund accounts E2E database URL is outside the isolated boundary',
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
      'Browser fund accounts E2E database URL is outside the isolated boundary',
    )
  }
  return rawValue
}

/**
 * 复用地区套件已经审计的真实构建、认证 fixture、双 Server、静态站点与 TLS
 * 同源代理，只替换最终 Browser runner 和资金账户专属数据库最终态核验。
 */
export function createBrowserFundAccountsPlan(input) {
  const basePlan = createBrowserRegionsPlan(input)
  const fundFixture = Object.freeze({
    name: 'fund-accounts-fixture',
    command: process.execPath,
    args: Object.freeze([
      './scripts/browser-fund-accounts/provision-fixture.mjs',
    ]),
    env: Object.freeze({
      ...basePlan.prepare[0].env,
      QIANSHU_BROWSER_FUND_LIMITED_PASSWORD:
        input.secrets.limitedPassword,
    }),
  })
  return Object.freeze({
    prepare: Object.freeze([
      ...basePlan.prepare.slice(0, 4),
      fundFixture,
      ...basePlan.prepare.slice(4),
    ]),
    services: basePlan.services,
    runner: Object.freeze({
      ...basePlan.runner,
      args: Object.freeze(['-C', 'web', 'test:browser:fund-accounts']),
      env: Object.freeze({
        ...basePlan.runner.env,
        QIANSHU_BROWSER_FUND_LIMITED_PASSWORD:
          input.secrets.limitedPassword,
      }),
    }),
    verify: Object.freeze([
      Object.freeze({
        name: 'fund-accounts-database-verification',
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
export function createBrowserFundAccountsSensitiveValues(databaseUrl, secrets) {
  return Object.freeze([
    databaseUrl,
    new URL(databaseUrl).password,
    secrets.adminPassword,
    secrets.limitedPassword,
    ...secrets.hmacKeys,
  ])
}

/** 任何阶段失败都保留首错，并逆序停止本次拥有的服务。 */
export async function runBrowserFundAccountsE2e({ plan, dependencies }) {
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
          'Browser fund accounts E2E service cleanup failed',
        )
      }
    }
    try {
      await dependencies.cleanup()
    }
    catch {
      primaryError ??= fixedError(
        'Browser fund accounts E2E temporary cleanup failed',
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
          reject(fixedError('Browser fund accounts E2E port allocation failed'))
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
  throw fixedError('Browser fund accounts E2E Chrome executable is unavailable')
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
      `Browser fund accounts E2E process failed to start: ${definition.name}`,
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
        `Browser fund accounts E2E service exited early: ${definition.name}`,
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
    `Browser fund accounts E2E service readiness timed out: ${definition.name}`,
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
      `Browser fund accounts E2E step failed: ${definition.name}`,
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
      'Browser fund accounts E2E Web runner failed',
      exitCodeFromResult(result.code, result.signal),
    )
  }
}

export async function runProductionBrowserFundAccountsE2e() {
  const databaseUrl = validateBrowserFundAccountsDatabaseUrl(
    process.env.DATABASE_URL,
  )
  const sessionDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'qianshu-browser-fund-accounts-e2e-'),
  )
  const registry = createBrowserRegionsProcessRegistry(stopManagedProcess)
  let listenersRegistered = false
  let primaryError
  let requestedSignal

  const interruptedError = () => fixedError(
    'Browser fund accounts E2E interrupted',
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
      adminPassword: `Bf-${randomBytes(9).toString('base64url')}!8`,
      hmacKeys: [0, 1, 2]
        .map(() => randomBytes(32).toString('base64url')),
      limitedPassword: `Fl-${randomBytes(8).toString('base64url')}!7`,
    }
    const sensitiveValues = createBrowserFundAccountsSensitiveValues(
      databaseUrl,
      secrets,
    )
    const plan = createBrowserFundAccountsPlan({
      chromeExecutable,
      databaseUrl,
      ports,
      secrets,
      sessionDirectory,
    })

    await runBrowserFundAccountsE2e({
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
        'Browser fund accounts E2E temporary cleanup failed',
      )
    }
  }
  if (primaryError !== undefined) {
    throw primaryError
  }
}

if (isDirectEntry(import.meta.url)) {
  runProductionBrowserFundAccountsE2e().catch((error) => {
    process.exitCode = error instanceof BrowserFundAccountsE2eError
      ? error.exitCode
      : 1
    console.error(
      error instanceof BrowserFundAccountsE2eError
        ? error.message
        : 'Browser fund accounts E2E failed unexpectedly',
    )
  })
}
