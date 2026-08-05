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
// 外层 ci-postgres 只等待 5 秒；内层提前升级，以便逆序清理服务和临时目录。
const gracefulStopTimeoutMilliseconds = 3_000

const databaseVerificationProgram = String.raw`
const { Client } = require('pg')

// 常量名保留 Browser fixture 的可检索身份；值必须是 Server 规范化后的合法 code。
const E2E_BROWSER_DICTIONARY_CODE = 'e2e.browser_dictionary'
const E2E_PRIMARY = 'E2E_PRIMARY'
const E2E_SECONDARY = 'E2E_SECONDARY'
const expectedEventTypes = [
  'DICTIONARY_TYPE_CREATED',
  'DICTIONARY_TYPE_UPDATED',
  'DICTIONARY_TYPE_ENABLED',
  'DICTIONARY_TYPE_DISABLED',
  'DICTIONARY_ITEM_CREATED',
  'DICTIONARY_ITEM_UPDATED',
  'DICTIONARY_ITEM_ENABLED',
  'DICTIONARY_ITEM_DISABLED',
]

function metadataMatches(actual, expected) {
  if (
    actual === null
    || typeof actual !== 'object'
    || Array.isArray(actual)
  ) {
    return false
  }
  const actualKeys = Object.keys(actual).sort()
  const expectedKeys = Object.keys(expected).sort()
  return JSON.stringify(actualKeys) === JSON.stringify(expectedKeys)
    && expectedKeys.every((key) => actual[key] === expected[key])
}

;(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    const typeResult = await client.query(
      [
        'SELECT id, code, name, description, enabled, sort_order, version',
        'FROM dictionary_types WHERE code = $1',
      ].join(' '),
      [E2E_BROWSER_DICTIONARY_CODE],
    )
    const dictionaryType = typeResult.rows[0]
    if (
      typeResult.rowCount !== 1
      || dictionaryType.code !== E2E_BROWSER_DICTIONARY_CODE
      || dictionaryType.name !== '浏览器字典已编辑'
      || dictionaryType.description !== null
      || dictionaryType.enabled !== false
      || dictionaryType.sort_order !== 9100
      || dictionaryType.version !== 4
    ) {
      throw new Error('dictionary type state')
    }

    const itemResult = await client.query(
      [
        [
          'SELECT id, dictionary_type_id, value, label, description,',
          'tone, enabled, sort_order, version',
        ].join(' '),
        'FROM dictionary_items',
        'WHERE dictionary_type_id = $1',
        'ORDER BY value ASC',
      ].join(' '),
      [dictionaryType.id],
    )
    const itemByValue = new Map(
      itemResult.rows.map((item) => [item.value, item]),
    )
    const primary = itemByValue.get(E2E_PRIMARY)
    const secondary = itemByValue.get(E2E_SECONDARY)
    if (
      itemResult.rowCount !== 2
      || primary?.dictionary_type_id !== dictionaryType.id
      || primary?.label !== '主要条目已编辑'
      || primary?.description !== null
      || primary?.tone !== 'DEFAULT'
      || primary?.enabled !== true
      || primary?.sort_order !== 10
      || primary?.version !== 3
      || secondary?.dictionary_type_id !== dictionaryType.id
      || secondary?.label !== '次要条目'
      || secondary?.description !== null
      || secondary?.tone !== 'DEFAULT'
      || secondary?.enabled !== false
      || secondary?.sort_order !== 20
      || secondary?.version !== 3
      // Type 已停用，因此两个 Item 的最终 effectiveEnabled 均必须为 false。
      || (dictionaryType.enabled && primary.enabled)
      || (dictionaryType.enabled && secondary.enabled)
    ) {
      throw new Error('dictionary item state')
    }

    const actorResult = await client.query(
      'SELECT id FROM users WHERE username_normalized = $1',
      ['browser_admin'],
    )
    if (actorResult.rowCount !== 1) {
      throw new Error('audit actor')
    }
    const actorId = actorResult.rows[0].id

    const expectedEvents = [
      {
        eventType: 'DICTIONARY_TYPE_CREATED',
        targetId: dictionaryType.id,
        targetType: 'DictionaryType',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          changedFields: 'code,enabled,name,sortOrder',
          version: 1,
        },
      },
      {
        eventType: 'DICTIONARY_ITEM_CREATED',
        targetId: primary.id,
        targetType: 'DictionaryItem',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          itemValue: E2E_PRIMARY,
          changedFields:
            'dictionaryTypeId,enabled,label,sortOrder,tone,value',
          version: 1,
        },
      },
      {
        eventType: 'DICTIONARY_ITEM_CREATED',
        targetId: secondary.id,
        targetType: 'DictionaryItem',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          itemValue: E2E_SECONDARY,
          changedFields:
            'dictionaryTypeId,enabled,label,sortOrder,tone,value',
          version: 1,
        },
      },
      {
        eventType: 'DICTIONARY_ITEM_ENABLED',
        targetId: primary.id,
        targetType: 'DictionaryItem',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          itemValue: E2E_PRIMARY,
          changedFields: 'enabled',
          previousVersion: 1,
          version: 2,
        },
      },
      {
        eventType: 'DICTIONARY_ITEM_ENABLED',
        targetId: secondary.id,
        targetType: 'DictionaryItem',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          itemValue: E2E_SECONDARY,
          changedFields: 'enabled',
          previousVersion: 1,
          version: 2,
        },
      },
      {
        eventType: 'DICTIONARY_TYPE_ENABLED',
        targetId: dictionaryType.id,
        targetType: 'DictionaryType',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          changedFields: 'enabled',
          previousVersion: 1,
          version: 2,
        },
      },
      {
        eventType: 'DICTIONARY_TYPE_UPDATED',
        targetId: dictionaryType.id,
        targetType: 'DictionaryType',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          changedFields: 'name',
          previousVersion: 2,
          version: 3,
        },
      },
      {
        eventType: 'DICTIONARY_ITEM_UPDATED',
        targetId: primary.id,
        targetType: 'DictionaryItem',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          itemValue: E2E_PRIMARY,
          changedFields: 'label',
          previousVersion: 2,
          version: 3,
        },
      },
      {
        eventType: 'DICTIONARY_ITEM_DISABLED',
        targetId: secondary.id,
        targetType: 'DictionaryItem',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          itemValue: E2E_SECONDARY,
          changedFields: 'enabled',
          previousVersion: 2,
          version: 3,
        },
      },
      {
        eventType: 'DICTIONARY_TYPE_DISABLED',
        targetId: dictionaryType.id,
        targetType: 'DictionaryType',
        metadata: {
          dictionaryCode: E2E_BROWSER_DICTIONARY_CODE,
          changedFields: 'enabled',
          previousVersion: 3,
          version: 4,
        },
      },
    ]

    const auditResult = await client.query(
      [
        [
          'SELECT event_type, outcome, actor_type, actor_user_id,',
          'target_type, target_id, request_id, metadata',
        ].join(' '),
        'FROM audit_events',
        'WHERE target_id = ANY($1::varchar[])',
        'AND event_type = ANY($2::audit_event_type[])',
      ].join(' '),
      [
        [dictionaryType.id, primary.id, secondary.id],
        expectedEventTypes,
      ],
    )
    const requestIds = new Set()
    const remaining = [...auditResult.rows]
    for (const expected of expectedEvents) {
      const index = remaining.findIndex((event) => (
        event.event_type === expected.eventType
        && event.target_type === expected.targetType
        && event.target_id === expected.targetId
        && metadataMatches(event.metadata, expected.metadata)
      ))
      if (index < 0) {
        throw new Error('audit event')
      }
      const [event] = remaining.splice(index, 1)
      if (
        event.outcome !== 'SUCCESS'
        || event.actor_type !== 'USER'
        || event.actor_user_id !== actorId
        || typeof event.request_id !== 'string'
        || event.request_id.length === 0
      ) {
        throw new Error('audit envelope')
      }
      requestIds.add(event.request_id)
    }
    if (
      auditResult.rowCount !== expectedEvents.length
      || remaining.length !== 0
      || requestIds.size !== expectedEvents.length
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

class BrowserDictionariesE2eError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'BrowserDictionariesE2eError'
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0
      ? exitCode
      : 1
  }
}

function fixedError(message, exitCode = 1) {
  return new BrowserDictionariesE2eError(message, exitCode)
}

/**
 * signal handler 会用 SIGTERM 清理 active 子进程，子进程退出码因此不能代表用户
 * 原始中断。等所有服务与临时目录完成清理后，统一让 SIGINT=130、SIGTERM=143。
 */
export function prioritizeBrowserDictionariesSignalError(
  requestedSignal,
  primaryError,
) {
  if (requestedSignal === undefined) {
    return primaryError
  }
  return fixedError(
    'Browser dictionaries E2E interrupted',
    requestedSignal === 'SIGINT' ? 130 : 143,
  )
}

/** 字典 Browser 只接受根级 ci-postgres 注入的固定本机数据库边界。 */
export function validateBrowserDictionariesDatabaseUrl(rawValue) {
  let parsed
  try {
    parsed = new URL(rawValue)
  }
  catch {
    throw fixedError(
      'Browser dictionaries E2E database URL is outside the isolated boundary',
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
      'Browser dictionaries E2E database URL is outside the isolated boundary',
    )
  }
  return rawValue
}

/**
 * 复用地区套件已审计的真实构建、认证 fixture、双 Server、静态站点与 TLS
 * 同源代理，只替换最终 Browser runner 和字典专属数据库核验。
 */
export function createBrowserDictionariesPlan(input) {
  const sourceEnv = { ...(input.sourceEnv ?? process.env) }
  // 所有认证 secret 必须先从继承环境移除，再由 Auth/Dictionary plan 的受控
  // override 定向注入必要消费者，避免 Web、proxy 或无关 prepare 继承旧值。
  for (const key of [
    'AUTH_IP_HMAC_KEY',
    'AUTH_USER_ID_HMAC_KEY',
    'AUTH_USERNAME_HMAC_KEY',
    'QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD',
    'QIANSHU_BROWSER_DICTIONARIES_LIMITED_PASSWORD',
  ]) {
    delete sourceEnv[key]
  }
  const basePlan = createBrowserRegionsPlan({ ...input, sourceEnv })
  return Object.freeze({
    prepare: basePlan.prepare,
    services: basePlan.services,
    runner: Object.freeze({
      ...basePlan.runner,
      args: Object.freeze(['-C', 'web', 'test:browser:dictionaries']),
      env: Object.freeze({
        ...basePlan.runner.env,
        QIANSHU_BROWSER_DICTIONARIES_LIMITED_PASSWORD:
          input.secrets.limitedPassword,
      }),
    }),
    verify: Object.freeze([
      Object.freeze({
        name: 'dictionaries-database-verification',
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

/** 外层 relay 必须遮罩本次隔离运行创建的全部数据库和登录凭据。 */
export function createBrowserDictionariesSensitiveValues(
  databaseUrl,
  secrets,
) {
  return Object.freeze([
    databaseUrl,
    new URL(databaseUrl).password,
    secrets.adminPassword,
    secrets.limitedPassword,
    ...secrets.hmacKeys,
  ])
}

/** 任何阶段失败都保留首错，并逆序停止本次 runner 拥有的服务。 */
export async function runBrowserDictionariesE2e({ plan, dependencies }) {
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
          'Browser dictionaries E2E service cleanup failed',
        )
      }
    }
    try {
      await dependencies.cleanup()
    }
    catch {
      primaryError ??= fixedError(
        'Browser dictionaries E2E temporary cleanup failed',
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
          reject(fixedError(
            'Browser dictionaries E2E port allocation failed',
          ))
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
  throw fixedError(
    'Browser dictionaries E2E Chrome executable is unavailable',
  )
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
      'Browser dictionaries E2E process failed to start: '
      + definition.name,
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
        'Browser dictionaries E2E service exited early: '
        + definition.name,
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
    'Browser dictionaries E2E service readiness timed out: '
    + definition.name,
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
      'Browser dictionaries E2E step failed: ' + definition.name,
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
      'Browser dictionaries E2E Web runner failed',
      exitCodeFromResult(result.code, result.signal),
    )
  }
}

export async function runProductionBrowserDictionariesE2e(options = {}) {
  const databaseValidator = options.databaseValidator
    ?? validateBrowserDictionariesDatabaseUrl
  const planFactory = options.planFactory ?? createBrowserDictionariesPlan
  const sensitiveValuesFactory = options.sensitiveValuesFactory
    ?? createBrowserDictionariesSensitiveValues
  const sessionPrefix = options.sessionPrefix
    ?? 'qianshu-browser-dictionaries-e2e-'
  const databaseUrl = databaseValidator(
    process.env.DATABASE_URL,
  )
  const sessionDirectory = await mkdtemp(
    path.join(os.tmpdir(), sessionPrefix),
  )
  const registry = createBrowserRegionsProcessRegistry(stopManagedProcess)
  let listenersRegistered = false
  let primaryError
  let requestedSignal

  const interruptedError = () => fixedError(
    'Browser dictionaries E2E interrupted',
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
      adminPassword:
        'Bd-' + randomBytes(9).toString('base64url') + '!8',
      hmacKeys: [0, 1, 2]
        .map(() => randomBytes(32).toString('base64url')),
      limitedPassword:
        'Dl-' + randomBytes(8).toString('base64url') + '!7',
    }
    const sensitiveValues = sensitiveValuesFactory(
      databaseUrl,
      secrets,
    )
    const plan = planFactory({
      chromeExecutable,
      databaseUrl,
      ports,
      secrets,
      sessionDirectory,
    })

    await runBrowserDictionariesE2e({
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
          try {
            await waitUntilReady(definition, handle)
          }
          catch (error) {
            // signal handler 会先停止 service；readiness 因而可能先观察到 early-exit。
            // 中断状态必须优先映射为 130/143，不能被后到的通用退出码 1 覆盖。
            throwIfInterrupted()
            throw error
          }
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
      // lifecycle 正常路径已清理；force 让这里同时覆盖前置失败。
      await rm(sessionDirectory, { force: true, recursive: true })
    }
    catch {
      primaryError ??= fixedError(
        'Browser dictionaries E2E temporary cleanup failed',
      )
    }
  }
  primaryError = prioritizeBrowserDictionariesSignalError(
    requestedSignal,
    primaryError,
  )
  if (primaryError !== undefined) {
    throw primaryError
  }
}

if (isDirectEntry(import.meta.url)) {
  runProductionBrowserDictionariesE2e().catch((error) => {
    process.exitCode = error instanceof BrowserDictionariesE2eError
      ? error.exitCode
      : 1
    console.error(
      error instanceof BrowserDictionariesE2eError
        ? error.message
        : 'Browser dictionaries E2E failed unexpectedly',
    )
  })
}
