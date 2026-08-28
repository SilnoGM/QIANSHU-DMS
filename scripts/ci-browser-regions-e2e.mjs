import { randomBytes } from 'node:crypto'
import { constants as filesystemConstants } from 'node:fs'
import { access, chmod, mkdtemp, rm } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createBrowserAuthPlan } from './ci-browser-auth-e2e.mjs'
import { redactSensitiveText } from './ci-postgres.mjs'
import { isDirectEntry } from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const serviceReadyTimeoutMilliseconds = 90_000
const serviceReadyPollMilliseconds = 250
// 外层 ci-postgres 仅给子 runner 5 秒退出；这里提前升级，给逆序收尾与目录清理留余量。
const gracefulStopTimeoutMilliseconds = 3_000

const databaseVerificationProgram = String.raw`
const { Client } = require('pg')

const expectedEvents = [
  'REGION_CREATED',
  'REGION_UPDATED',
  'REGION_DISABLED',
  'REGION_ENABLED',
]
const expectedMetadata = {
  REGION_CREATED: {
    affectedCount: 1,
    changedFields: 'code,enabled,englishName,name,parentId,sortOrder',
    level: 'COUNTRY_REGION',
  },
  REGION_UPDATED: {
    affectedCount: 1,
    changedFields: 'name',
    level: 'COUNTRY_REGION',
  },
  REGION_DISABLED: {
    affectedCount: 1,
    changedFields: 'enabled',
    level: 'COUNTRY_REGION',
  },
  REGION_ENABLED: {
    affectedCount: 1,
    changedFields: 'enabled',
    level: 'COUNTRY_REGION',
  },
}

;(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const regionResult = await client.query(
      [
        'SELECT id, name, enabled, level, parent_id',
        'FROM regions WHERE code = $1',
      ].join(' '),
      ['E2E-BROWSER-REGION'],
    )
    const region = regionResult.rows[0]
    if (
      regionResult.rowCount !== 1
      || region.name !== '浏览器地区已编辑'
      || region.enabled !== true
      || region.level !== 'COUNTRY_REGION'
      || region.parent_id !== null
    ) {
      throw new Error('region state')
    }

    const actorResult = await client.query(
      [
        'SELECT id FROM users',
        'WHERE username_normalized = $1',
      ].join(' '),
      ['browser_admin'],
    )
    if (actorResult.rowCount !== 1) {
      throw new Error('audit actor')
    }
    const actorId = actorResult.rows[0].id

    const auditResult = await client.query(
      [
        [
          'SELECT event_type, outcome, actor_user_id,',
          'request_id, metadata',
        ].join(' '),
        'FROM audit_events',
        'WHERE target_type = $1 AND target_id = $2',
        'AND event_type = ANY($3::audit_event_type[])',
        'ORDER BY occurred_at ASC, id ASC',
      ].join(' '),
      ['Region', region.id, expectedEvents],
    )
    const actualEvents = auditResult.rows.map((row) => row.event_type)
    if (
      auditResult.rowCount !== expectedEvents.length
      || new Set(actualEvents).size !== expectedEvents.length
      || expectedEvents.some((event) => !actualEvents.includes(event))
      || auditResult.rows.some((row) => {
        const metadata = row.metadata
        const expected = expectedMetadata[row.event_type]
        return row.outcome !== 'SUCCESS'
          || row.actor_user_id !== actorId
          || typeof row.request_id !== 'string'
          || row.request_id.length === 0
          || metadata === null
          || typeof metadata !== 'object'
          || Object.keys(metadata).sort().join(',')
            !== 'affectedCount,changedFields,level'
          || metadata.affectedCount !== expected?.affectedCount
          || metadata.changedFields !== expected?.changedFields
          || metadata.level !== expected?.level
      })
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

class BrowserRegionsE2eError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'BrowserRegionsE2eError'
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0
      ? exitCode
      : 1
  }
}

function fixedError(message, exitCode = 1) {
  return new BrowserRegionsE2eError(message, exitCode)
}

/**
 * 地区 runner 只能接受根级 ci-postgres 动态注入的固定本机数据库边界。
 * 这里不复用开发环境配置，也不允许通过额外 query 参数改变 schema。
 */
export function validateBrowserRegionsDatabaseUrl(rawValue) {
  let parsed
  try {
    parsed = new URL(rawValue)
  }
  catch {
    throw fixedError(
      'Browser regions E2E database URL is outside the isolated boundary',
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
      'Browser regions E2E database URL is outside the isolated boundary',
    )
  }
  return rawValue
}

/**
 * 所有子进程输出统一经过同一遮罩函数。长值先替换，避免先遮罩密码后仍残留
 * 可识别的连接串；调用方只传本次进程实际生成的 secret。
 */
export function redactBrowserRegionsOutput(value, sensitiveValues) {
  return redactSensitiveText(value, sensitiveValues)
}

/**
 * 子进程的 stdout/stderr chunk 边界与 secret 无关。这里为最长 secret 保留有界
 * lookahead，并对所有完整 occurrence 的区间取并集。字符只有在未来输入已不可能
 * 改变其敏感性后才输出，因此自重叠、不同 secret 前后缀重叠和跨 chunk 都不会
 * 把同一个凭据拆成可见片段；不含 secret 字符的完整行仍可立即输出诊断。
 */
export function createBrowserRegionsOutputRelay(
  outputWriter,
  sensitiveValues,
) {
  if (typeof outputWriter !== 'function') {
    throw new TypeError('Browser regions E2E output writer is invalid')
  }
  const secrets = [...new Set(
    sensitiveValues.filter(value =>
      typeof value === 'string' && value.length > 0),
  )]
  const maximumSecretLength = secrets.reduce(
    (maximum, secret) => Math.max(maximum, secret.length),
    0,
  )
  const newlineProtectedSecrets = secrets.filter(
    secret => !secret.includes('\n'),
  )
  const carriageReturnProtectedSecrets = secrets.filter(
    secret => !secret.includes('\r'),
  )
  const newlineIsBoundary = newlineProtectedSecrets.length === secrets.length
  const carriageReturnIsBoundary =
    carriageReturnProtectedSecrets.length === secrets.length
  let pending = ''
  let pendingMask = []
  let maskRunOpen = false
  let flushed = false

  /**
   * 同一个 secret 可能在自身内部重叠，例如 `aba` 在 `ababa` 中出现两次。
   * 搜索游标每次只前进一个 code unit，确保所有 occurrence 都进入遮罩区间并集。
   */
  const markCompleteSecrets = () => {
    for (const secret of secrets) {
      let searchIndex = 0
      while (searchIndex <= pending.length - secret.length) {
        const matchIndex = pending.indexOf(secret, searchIndex)
        if (matchIndex === -1) {
          break
        }
        for (
          let index = matchIndex;
          index < matchIndex + secret.length;
          index += 1
        ) {
          pendingMask[index] = true
        }
        searchIndex = matchIndex + 1
      }
    }
  }

  /**
   * EOF 或已证明不会被 secret 跨越的换行边界，都可能停在凭据前缀中间。
   * 对该边界前的最长非空 proper prefix 做 fail-closed，避免截断日志或自动
   * 换行把连接串、密码的可识别片段直接写入 CI 日志。
   */
  const markProtectedSuffix = (endIndex, protectedSecrets = secrets) => {
    let protectedSuffixLength = 0
    for (const secret of protectedSecrets) {
      const maximum = Math.min(secret.length - 1, endIndex)
      for (
        let length = maximum;
        length > protectedSuffixLength;
        length -= 1
      ) {
        if (pending.endsWith(secret.slice(0, length), endIndex)) {
          protectedSuffixLength = length
          break
        }
      }
    }
    for (
      let index = endIndex - protectedSuffixLength;
      index < endIndex;
      index += 1
    ) {
      pendingMask[index] = true
    }
  }

  /**
   * 连续敏感区间只写一个 `***`。若一个 occurrence 横跨输出边界，保留
   * maskRunOpen 可阻止后半段重复写遮罩，更重要的是绝不会重新写回原始字符。
   */
  const writeSettledPrefix = (length) => {
    if (length <= 0) {
      return
    }
    let output = ''
    for (let index = 0; index < length; index += 1) {
      if (pendingMask[index] === true) {
        if (!maskRunOpen) {
          output += '***'
          maskRunOpen = true
        }
      }
      else {
        maskRunOpen = false
        output += pending[index]
      }
    }
    pending = pending.slice(length)
    pendingMask = pendingMask.slice(length)
    if (output.length > 0) {
      outputWriter(output)
    }
  }

  const markLineSuffixesAndGetBoundary = () => {
    let boundary = 0
    for (let index = 0; index < pending.length; index += 1) {
      const character = pending[index]
      if (character === '\n') {
        // 即使另一个 secret 自身含 LF、导致整行不能提前结算，也必须对所有
        // 不含 LF 的 secret 独立保护行尾前缀；CR 同理。
        markProtectedSuffix(index, newlineProtectedSecrets)
        if (newlineIsBoundary) {
          boundary = index + 1
        }
      }
      else if (character === '\r') {
        markProtectedSuffix(index, carriageReturnProtectedSecrets)
        if (carriageReturnIsBoundary) {
          boundary = index + 1
        }
      }
    }
    return boundary
  }

  return Object.freeze({
    flush() {
      if (flushed) {
        return
      }
      flushed = true
      markCompleteSecrets()

      // 进程可能恰好在任意 secret 的非空 proper prefix 处退出。此时无法证明
      // 尾串是普通文本，必须与完整 occurrence 一并 fail-closed。
      markProtectedSuffix(pending.length)
      writeSettledPrefix(pending.length)
    },
    push(value) {
      if (flushed) {
        return
      }
      const chunk = String(value)
      pending += chunk
      for (let index = 0; index < chunk.length; index += 1) {
        pendingMask.push(false)
      }

      if (maximumSecretLength === 0) {
        writeSettledPrefix(pending.length)
        return
      }

      markCompleteSecrets()
      const lookaheadBoundary = Math.max(
        0,
        pending.length - maximumSecretLength + 1,
      )
      writeSettledPrefix(Math.max(
        lookaheadBoundary,
        markLineSuffixesAndGetBoundary(),
      ))
    },
  })
}

/**
 * 统一登记当前 prepare/runner/probe 与全部 detached service。signal 到达时并发
 * 停止所有已拥有进程；若 handle 恰好在中断竞态后才登记，也会立即进入同一 stop。
 */
export function createBrowserRegionsProcessRegistry(stopProcess) {
  if (typeof stopProcess !== 'function') {
    throw new TypeError('Browser regions E2E process stopper is invalid')
  }
  const services = new Set()
  const stopPromises = new Map()
  let active
  let stopping = false

  const stopOnce = (handle) => {
    if (handle === undefined || handle === null) {
      return Promise.resolve()
    }
    let promise = stopPromises.get(handle)
    if (promise === undefined) {
      promise = Promise.resolve().then(() => stopProcess(handle))
      stopPromises.set(handle, promise)
    }
    return promise
  }

  return Object.freeze({
    addService(handle) {
      services.add(handle)
      if (stopping) {
        void stopOnce(handle).catch(() => undefined)
      }
    },
    clearActive(handle) {
      if (active === handle) {
        active = undefined
      }
    },
    removeService(handle) {
      services.delete(handle)
    },
    setActive(handle) {
      active = handle
      if (stopping) {
        void stopOnce(handle).catch(() => undefined)
      }
    },
    stop(handle) {
      return stopOnce(handle)
    },
    async stopAll() {
      stopping = true
      await Promise.allSettled(
        [...new Set([...services, active].filter(Boolean))]
          .map(handle => stopOnce(handle)),
      )
    },
  })
}

/**
 * 复用已经验证的认证 Browser E2E 构建、fixture、双 Server 和同源代理计划，
 * 只把最终 runner 收窄为地区场景文件。地区测试继续使用相同认证配置变量，
 * 不再维护第二套登录契约。
 */
export function createBrowserRegionsPlan(input) {
  /**
   * 外层 ci-postgres 会把 DATABASE_URL 注入当前进程；复用认证计划前必须先从
   * sourceEnv 删除它。认证计划会把参数中的受控 URL 显式放回 migration、Server
   * 与 fixture，Web build、静态服务、代理和浏览器 runner 则始终看不到数据库。
   */
  const databaseIsolatedSourceEnv = {
    ...(input.sourceEnv ?? process.env),
  }
  delete databaseIsolatedSourceEnv.DATABASE_URL
  const authPlan = createBrowserAuthPlan({
    ...input,
    sourceEnv: databaseIsolatedSourceEnv,
  })
  // 固定主图文件只服务认证综合套件中的采购场景；地区及其派生套件不读取产品
  // 媒体，因此保持原有最小准备面，不向这些隔离任务写入无消费方的媒体夹具。
  const prepare = Object.freeze(authPlan.prepare
    .filter(step => step.name !== 'media-fixture')
    .map((step) => {
      if (step.name !== 'web-build') {
        return step
      }
      return Object.freeze({
        ...step,
        args: Object.freeze([
          '-C', 'web',
          '--filter', 'qsmds-arco',
          'run', 'build:test',
        ]),
        env: Object.freeze({
          ...step.env,
          // test mode 只提供独立 outDir/sourcemap；Browser E2E 仍必须访问真实同源 API。
          VITE_APP_API_BASEURL: '/api',
          VITE_BUILD_FAKE: 'false',
          VITE_ENABLE_COMPONENT_LIBRARY: 'true',
        }),
      })
    }))
  const services = Object.freeze(authPlan.services.map((definition) => {
    if (definition.name !== 'web') {
      return definition
    }
    return Object.freeze({
      ...definition,
      env: Object.freeze({
        ...definition.env,
        QIANSHU_BROWSER_AUTH_WEB_ROOT: path.join(
          repositoryRoot,
          'web/apps/qsmds-arco/dist-test',
        ),
      }),
    })
  }))
  const runner = Object.freeze({
    ...authPlan.runner,
    command: 'pnpm',
    args: Object.freeze(['-C', 'web', 'test:browser:regions']),
    env: Object.freeze({ ...authPlan.runner.env }),
  })
  const verify = Object.freeze([
    Object.freeze({
      name: 'database-verification',
      command: 'pnpm',
      args: Object.freeze([
        '-C', 'server', 'exec', 'node',
        '--input-type=commonjs',
        '--eval',
        databaseVerificationProgram,
      ]),
      env: authPlan.prepare[0].env,
    }),
  ])
  return Object.freeze({
    prepare,
    runner,
    services,
    verify,
  })
}

/**
 * 任何准备、服务 ready 或浏览器 runner 失败都保留首个失败，并逆序停止本次
 * 已拥有服务。清理失败不能覆盖原始 runner 退出码。
 */
export async function runBrowserRegionsE2e({ plan, dependencies }) {
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
          'Browser regions E2E service cleanup failed',
        )
      }
    }
    try {
      await dependencies.cleanup()
    }
    catch {
      primaryError ??= fixedError(
        'Browser regions E2E temporary cleanup failed',
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
          reject(fixedError('Browser regions E2E port allocation failed'))
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
  const configured = environment.QIANSHU_CHROME_EXECUTABLE
  const candidates = [
    configured,
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
      // 继续检查固定候选；真实路径和底层权限信息不进入最终错误。
    }
  }
  throw fixedError('Browser regions E2E Chrome executable is unavailable')
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

function startManagedProcess(
  definition,
  sensitiveValues,
  relay = {},
) {
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
      `Browser regions E2E process failed to start: ${definition.name}`,
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
    // close 在 stdout/stderr 全部关闭后触发，保证最后一个 chunk 也进入统一遮罩。
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

function isServiceReadyStatus(status) {
  return status === 200
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
        `Browser regions E2E service exited early: ${definition.name}`,
      )
    }
    if (isServiceReadyStatus(outcome.status)) {
      return
    }
    await new Promise(
      resolve => setTimeout(resolve, serviceReadyPollMilliseconds),
    )
  }
  throw fixedError(
    `Browser regions E2E service readiness timed out: ${definition.name}`,
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
      `Browser regions E2E preparation failed: ${definition.name}`,
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
      'Browser regions E2E Web runner failed',
      exitCodeFromResult(result.code, result.signal),
    )
  }
}

export async function runProductionBrowserRegionsE2e() {
  const databaseUrl = validateBrowserRegionsDatabaseUrl(
    process.env.DATABASE_URL,
  )
  const sessionDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'qianshu-browser-regions-e2e-'),
  )
  const registry = createBrowserRegionsProcessRegistry(stopManagedProcess)
  let listenersRegistered = false
  let primaryError
  let requestedSignal

  const interruptedError = () => fixedError(
    'Browser regions E2E interrupted',
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
      adminPassword: `Br-${randomBytes(9).toString('base64url')}!7`,
      hmacKeys: [0, 1, 2]
        .map(() => randomBytes(32).toString('base64url')),
    }
    const sensitiveValues = [
      databaseUrl,
      new URL(databaseUrl).password,
      secrets.adminPassword,
      ...secrets.hmacKeys,
    ]
    const plan = createBrowserRegionsPlan({
      chromeExecutable,
      databaseUrl,
      ports,
      secrets,
      sessionDirectory,
    })

    await runBrowserRegionsE2e({
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
        verify: async (step) => {
          throwIfInterrupted()
          await runManagedStep(step, registry, sensitiveValues)
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
      // lifecycle 正常路径已经清理；force 使这里同时成为前置失败的兜底。
      await rm(sessionDirectory, { force: true, recursive: true })
    }
    catch {
      primaryError ??= fixedError(
        'Browser regions E2E temporary cleanup failed',
      )
    }
  }
  if (primaryError !== undefined) {
    throw primaryError
  }
}

if (isDirectEntry(import.meta.url)) {
  runProductionBrowserRegionsE2e().catch((error) => {
    process.exitCode = error instanceof BrowserRegionsE2eError
      ? error.exitCode
      : 1
    console.error(
      error instanceof BrowserRegionsE2eError
        ? error.message
        : 'Browser regions E2E failed unexpectedly',
    )
  })
}
