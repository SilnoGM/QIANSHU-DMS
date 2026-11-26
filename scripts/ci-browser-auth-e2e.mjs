import { randomBytes } from 'node:crypto'
import { access, chmod, mkdtemp, rm } from 'node:fs/promises'
import { constants as filesystemConstants } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { isDirectEntry, runCommand } from './run-command.mjs'

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url))
const repositoryRoot = path.resolve(scriptsDirectory, '..')
const serviceReadyTimeoutMilliseconds = 90_000
const serviceReadyPollMilliseconds = 250
const gracefulStopTimeoutMilliseconds = 5_000

class BrowserAuthE2eError extends Error {
  constructor(message, exitCode = 1) {
    super(message)
    this.name = 'BrowserAuthE2eError'
    this.exitCode = Number.isInteger(exitCode) && exitCode > 0
      ? exitCode
      : 1
  }
}

function fixedError(message, exitCode = 1) {
  return new BrowserAuthE2eError(message, exitCode)
}

export function validateBrowserAuthDatabaseUrl(rawValue) {
  let parsed
  try {
    parsed = new URL(rawValue)
  }
  catch {
    throw fixedError(
      'Browser auth E2E database URL is outside the isolated boundary',
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
      'Browser auth E2E database URL is outside the isolated boundary',
    )
  }
  return rawValue
}

const BROWSER_TEST_SHARD_SCRIPTS = Object.freeze({
  '1/2': 'test:browser:auth:shard-1',
  '2/2': 'test:browser:auth:shard-2',
})

export function validateBrowserTestShard(rawValue) {
  if (rawValue === undefined || rawValue === '') {
    return undefined
  }
  if (!Object.hasOwn(BROWSER_TEST_SHARD_SCRIPTS, rawValue)) {
    throw fixedError('Browser auth E2E shard is invalid')
  }
  return rawValue
}

function safeEnvironment(source, overrides = {}) {
  const environment = {
    ...source,
    ...overrides,
    DOTENV_CONFIG_PATH: '/dev/null',
  }
  delete environment.DEBUG
  delete environment.PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION
  return environment
}

function baseUrl(protocol, port) {
  return `${protocol}://127.0.0.1:${port}`
}

function service(name, entrypoint, env, readyUrl) {
  return Object.freeze({
    name,
    command: process.execPath,
    args: Object.freeze([entrypoint]),
    env: Object.freeze(env),
    readyUrl,
  })
}

/**
 * 构造不含密码 argv 的固定编排计划。
 *
 * development 与 production 使用独立 Server，确保浏览器真实观察普通 Cookie
 * 和 `__Host-` Secure Cookie；两套入口都经同源反向代理访问同一正式 Web 构建。
 */
export function createBrowserAuthPlan(input) {
  const {
    browserTestShard,
    chromeExecutable,
    databaseUrl,
    ffprobePath,
    mediaStorageRoot,
    ports,
    secrets,
    sessionDirectory,
    sourceEnv = process.env,
  } = input
  const validatedBrowserTestShard = validateBrowserTestShard(browserTestShard)
  const browserTestScript = validatedBrowserTestShard === undefined
    ? 'test:browser:auth'
    : BROWSER_TEST_SHARD_SCRIPTS[validatedBrowserTestShard]
  const devBaseUrl = baseUrl('http', ports.devProxy)
  const prodBaseUrl = baseUrl('https', ports.prodProxy)
  const webOrigin = baseUrl('http', ports.web)
  const devServerOrigin = baseUrl('http', ports.devServer)
  const prodServerOrigin = baseUrl('http', ports.prodServer)
  const tlsKeyPath = path.join(sessionDirectory, 'tls-key.pem')
  const tlsCertificatePath = path.join(sessionDirectory, 'tls-cert.pem')
  const [usernameHmacKey, userIdHmacKey, ipHmacKey] = secrets.hmacKeys
  const commonAuthEnvironment = {
    AUTH_ARGON2_CONCURRENCY: '2',
    AUTH_ARGON2_QUEUE_LIMIT: '32',
    AUTH_USERNAME_HMAC_KEY: usernameHmacKey,
    AUTH_USER_ID_HMAC_KEY: userIdHmacKey,
    AUTH_IP_HMAC_KEY: ipHmacKey,
    DATABASE_URL: databaseUrl,
    MEDIA_FFPROBE_PATH: ffprobePath,
    MEDIA_STORAGE_DRIVER: 'local',
    MEDIA_STORAGE_ROOT: mediaStorageRoot,
    TRUST_PROXY_HOPS: '0',
  }
  const prepareEnvironment = safeEnvironment(sourceEnv, {
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
  })

  const prepare = Object.freeze([
    Object.freeze({
      name: 'database-migrations',
      command: process.execPath,
      args: Object.freeze(['./scripts/browser-auth/migrate-before-historical-fixtures.mjs']),
      env: prepareEnvironment,
    }),
    Object.freeze({
      name: 'server-build',
      command: 'pnpm',
      args: Object.freeze(['-C', 'server', 'build']),
      env: prepareEnvironment,
    }),
    Object.freeze({
      name: 'web-build',
      command: 'pnpm',
      args: Object.freeze(['-C', 'web', 'build']),
      // 仅隔离浏览器验收构建开放组件库，正式生产构建继续遵循默认关闭策略。
      // 同时必须关闭"禁用开发者工具"：正式生产构建会按模板默认打开它，而该产物由 CDP 驱动，
      // 打开后页面会主动拦截开发者工具，导致 CDP 命令失败、应用根本挂载不起来。
      env: safeEnvironment(sourceEnv, {
        NODE_ENV: 'production',
        VITE_APP_DISABLE_DEVTOOL: 'false',
        VITE_ENABLE_COMPONENT_LIBRARY: 'true',
      }),
    }),
    Object.freeze({
      name: 'admin-fixture',
      command: process.execPath,
      args: Object.freeze(['./scripts/browser-auth/provision-admin.mjs']),
      env: safeEnvironment(sourceEnv, {
        DATABASE_URL: databaseUrl,
        NODE_ENV: 'test',
        QIANSHU_BROWSER_AUTH_ADMIN_DISPLAY_NAME: 'Browser Auth Admin',
        QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD: secrets.adminPassword,
        QIANSHU_BROWSER_AUTH_ADMIN_USERNAME: 'browser_admin',
      }),
    }),
    Object.freeze({
      // admin-fixture 内部完成历史夹具后的真实全量迁移，付款资料只能在其成功后创建。
      name: 'payment-fixture',
      command: process.execPath,
      args: Object.freeze(['./scripts/browser-auth/provision-payment-fixtures.mjs']),
      env: prepareEnvironment,
    }),
    Object.freeze({
      name: 'media-fixture',
      command: process.execPath,
      args: Object.freeze(['./scripts/browser-auth/provision-media-fixtures.mjs']),
      env: safeEnvironment(sourceEnv, {
        QIANSHU_BROWSER_AUTH_MEDIA_STORAGE_ROOT: mediaStorageRoot,
      }),
    }),
    Object.freeze({
      name: 'tls-certificate',
      command: 'openssl',
      args: Object.freeze([
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', tlsKeyPath,
        '-out', tlsCertificatePath,
        '-days', '1', '-subj', '/CN=127.0.0.1',
        '-addext', 'subjectAltName=IP:127.0.0.1',
      ]),
      env: safeEnvironment(sourceEnv),
      stdio: 'ignore',
    }),
  ])

  const services = Object.freeze([
    service(
      'web',
      './scripts/browser-auth/static-server.mjs',
      safeEnvironment(sourceEnv, {
        QIANSHU_BROWSER_AUTH_HOST: '127.0.0.1',
        QIANSHU_BROWSER_AUTH_PORT: String(ports.web),
        QIANSHU_BROWSER_AUTH_WEB_ROOT: path.join(
          repositoryRoot,
          'web/apps/qsmds-arco/dist',
        ),
      }),
      `${webOrigin}/index.html`,
    ),
    service(
      'server-development',
      './scripts/browser-auth/server-entry.mjs',
      safeEnvironment(sourceEnv, {
        ...commonAuthEnvironment,
        APP_ORIGIN: devBaseUrl,
        NODE_ENV: 'development',
        PORT: String(ports.devServer),
      }),
      `${devServerOrigin}/api/health`,
    ),
    service(
      'server-production',
      './scripts/browser-auth/server-entry.mjs',
      safeEnvironment(sourceEnv, {
        ...commonAuthEnvironment,
        APP_ORIGIN: prodBaseUrl,
        NODE_ENV: 'production',
        PORT: String(ports.prodServer),
      }),
      `${prodServerOrigin}/api/health`,
    ),
    service(
      'proxy-development',
      './scripts/browser-auth/reverse-proxy.mjs',
      safeEnvironment(sourceEnv, {
        QIANSHU_BROWSER_AUTH_API_ORIGIN: devServerOrigin,
        QIANSHU_BROWSER_AUTH_HOST: '127.0.0.1',
        QIANSHU_BROWSER_AUTH_PORT: String(ports.devProxy),
        QIANSHU_BROWSER_AUTH_MEDIA_STORAGE_ROOT: mediaStorageRoot,
        QIANSHU_BROWSER_AUTH_WEB_ORIGIN: webOrigin,
      }),
      `${devBaseUrl}/api/health`,
    ),
    service(
      'proxy-production',
      './scripts/browser-auth/reverse-proxy.mjs',
      safeEnvironment(sourceEnv, {
        QIANSHU_BROWSER_AUTH_API_ORIGIN: prodServerOrigin,
        QIANSHU_BROWSER_AUTH_HOST: '127.0.0.1',
        QIANSHU_BROWSER_AUTH_PORT: String(ports.prodProxy),
        QIANSHU_BROWSER_AUTH_MEDIA_STORAGE_ROOT: mediaStorageRoot,
        QIANSHU_BROWSER_AUTH_TLS_CERT: tlsCertificatePath,
        QIANSHU_BROWSER_AUTH_TLS_KEY: tlsKeyPath,
        QIANSHU_BROWSER_AUTH_WEB_ORIGIN: webOrigin,
      }),
      `${prodBaseUrl}/api/health`,
    ),
  ])

  const runner = Object.freeze({
    name: 'browser-runner',
    command: 'pnpm',
    args: Object.freeze(['-C', 'web', browserTestScript]),
    env: safeEnvironment(sourceEnv, {
      QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD: secrets.adminPassword,
      QIANSHU_BROWSER_AUTH_ADMIN_USERNAME: 'browser_admin',
      QIANSHU_BROWSER_AUTH_BASE_URL: prodBaseUrl,
      QIANSHU_BROWSER_AUTH_CHROME_EXECUTABLE: chromeExecutable,
      QIANSHU_BROWSER_AUTH_HTTP_BASE_URL: devBaseUrl,
      QIANSHU_BROWSER_AUTH_FIXTURE_DIRECTORY: path.join(
        sessionDirectory,
        'media-fixtures',
      ),
      QIANSHU_BROWSER_AUTH_PROFILE_DIRECTORY: path.join(
        sessionDirectory,
        'chrome-profile',
      ),
    }),
    relayOutput: true,
  })

  return Object.freeze({ prepare, runner, services })
}

/**
 * 依赖注入的最小生命周期核心。任何准备、启动、ready 或 runner 失败都会先逆序
 * 停止已拥有服务，再清理本次临时目录；清理错误不覆盖首个业务失败。
 */
export async function runBrowserAuthE2e({ plan, dependencies }) {
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
        primaryError ??= fixedError('Browser auth E2E service cleanup failed')
      }
    }
    try {
      await dependencies.cleanup()
    }
    catch {
      primaryError ??= fixedError('Browser auth E2E temporary cleanup failed')
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
          reject(fixedError('Browser auth E2E port allocation failed'))
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
      // 继续检查固定候选；任何真实路径或底层权限信息都不进入最终错误。
    }
  }
  throw fixedError('Browser auth E2E Chrome executable is unavailable')
}

async function resolveFfprobeExecutable(environment = process.env) {
  const configured = environment.MEDIA_FFPROBE_PATH
  const candidates = [
    configured,
    process.platform === 'darwin' ? '/opt/homebrew/bin/ffprobe' : undefined,
    '/usr/bin/ffprobe',
  ].filter(value => typeof value === 'string' && path.isAbsolute(value))
  for (const candidate of candidates) {
    try {
      await access(candidate, filesystemConstants.X_OK)
      return candidate
    }
    catch {
      // 只检查固定候选，不输出主机路径或底层权限错误。
    }
  }
  throw fixedError('Browser auth E2E ffprobe executable is unavailable')
}

function startManagedProcess(definition) {
  let child
  try {
    child = spawn(definition.command, definition.args, {
      cwd: repositoryRoot,
      detached: true,
      env: definition.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  }
  catch {
    throw fixedError(`Browser auth E2E service failed to start: ${definition.name}`)
  }

  const completion = new Promise((resolve) => {
    let settled = false
    const settle = (result) => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    child.stdout?.on('data', (chunk) => {
      if (definition.relayOutput === true) process.stdout.write(String(chunk))
    })
    child.stderr?.on('data', (chunk) => {
      // 子进程错误均由本仓库固定文案边界产生；仍不转发 env 或请求体。
      const text = String(chunk)
      if (text.length > 0) process.stderr.write(text)
    })
    child.once('error', () => settle({ code: 1, signal: null }))
    child.once('exit', (code, signal) => settle({ code, signal }))
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

/** 所有内部 ready endpoint 都必须明确返回 200，错误页或鉴权失败不能冒充就绪。 */
export function isServiceReadyStatus(status) {
  return status === 200
}

async function waitUntilReady(definition, handle) {
  const deadline = Date.now() + serviceReadyTimeoutMilliseconds
  while (Date.now() < deadline) {
    const outcome = await Promise.race([
      handle.completion.then(result => ({ result, type: 'exit' })),
      requestStatus(definition.readyUrl).then(status => ({ status, type: 'status' })),
    ])
    if (outcome.type === 'exit') {
      throw fixedError(`Browser auth E2E service exited early: ${definition.name}`)
    }
    if (isServiceReadyStatus(outcome.status)) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, serviceReadyPollMilliseconds))
  }
  throw fixedError(`Browser auth E2E service readiness timed out: ${definition.name}`)
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
    if (error?.code !== 'ESRCH') throw error
  }
  const stopped = await Promise.race([
    handle.completion.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), gracefulStopTimeoutMilliseconds)),
  ])
  if (!stopped) {
    try {
      process.kill(-child.pid, 'SIGKILL')
    }
    catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
    await handle.completion
  }
}

async function runManagedRunner(definition, state) {
  const handle = startManagedProcess(definition)
  state.runner = handle
  const result = await handle.completion
  state.runner = undefined
  if (result.code !== 0) {
    throw fixedError('Browser auth E2E Web runner failed')
  }
}

async function runProductionBrowserAuthE2e() {
  const databaseUrl = validateBrowserAuthDatabaseUrl(process.env.DATABASE_URL)
  const browserTestShard = validateBrowserTestShard(
    process.env.QIANSHU_BROWSER_AUTH_SHARD,
  )
  const sessionDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'qianshu-browser-auth-e2e-'),
  )
  await chmod(sessionDirectory, 0o700)
  // LocalMediaStorage 主动拒绝系统 tmp 与仓库目录；单独在当前用户目录建立
  // 0700 的一次性媒体根，并在所有成功/失败/信号路径统一清理。
  const mediaStorageRoot = await mkdtemp(
    path.join(os.homedir(), '.qianshu-browser-media-e2e-'),
  )
  await chmod(mediaStorageRoot, 0o700)
  const state = { runner: undefined }
  let requestedSignal
  const signalHandler = (signal) => {
    if (requestedSignal !== undefined) return
    requestedSignal = signal
    if (state.runner !== undefined) {
      void stopManagedProcess(state.runner).catch(() => undefined)
    }
  }
  const handleSigint = () => signalHandler('SIGINT')
  const handleSigterm = () => signalHandler('SIGTERM')
  process.on('SIGINT', handleSigint)
  process.on('SIGTERM', handleSigterm)

  try {
    const chromeExecutable = await resolveChromeExecutable()
    const ffprobePath = await resolveFfprobeExecutable()
    const ports = await allocatePorts()
    const plan = createBrowserAuthPlan({
      browserTestShard,
      chromeExecutable,
      databaseUrl,
      ffprobePath,
      mediaStorageRoot,
      ports,
      secrets: {
        adminPassword: `Br-${randomBytes(9).toString('base64url')}!7`,
        hmacKeys: [0, 1, 2].map(() => randomBytes(32).toString('base64url')),
      },
      sessionDirectory,
    })
    await runBrowserAuthE2e({
      plan,
      dependencies: {
        cleanup: async () => {
          await Promise.all([
            rm(sessionDirectory, { force: true, recursive: true }),
            rm(mediaStorageRoot, { force: true, recursive: true }),
          ])
        },
        prepare: step => runCommand(step.command, step.args, {
          cwd: repositoryRoot,
          env: step.env,
          ...(step.stdio === undefined ? {} : { stdio: step.stdio }),
        }),
        runRunner: runner => runManagedRunner(runner, state),
        startService: startManagedProcess,
        stopService: stopManagedProcess,
        waitUntilReady,
      },
    })
    if (requestedSignal !== undefined) {
      throw fixedError(
        'Browser auth E2E interrupted',
        requestedSignal === 'SIGINT' ? 130 : 143,
      )
    }
  }
  finally {
    process.off('SIGINT', handleSigint)
    process.off('SIGTERM', handleSigterm)
    await Promise.all([
      rm(sessionDirectory, { force: true, recursive: true }),
      rm(mediaStorageRoot, { force: true, recursive: true }),
    ])
  }
}

if (isDirectEntry(import.meta.url)) {
  runProductionBrowserAuthE2e().catch((error) => {
    process.exitCode = error instanceof BrowserAuthE2eError
      ? error.exitCode
      : 1
    console.error(
      error instanceof BrowserAuthE2eError
        ? error.message
        : 'Browser auth E2E failed unexpectedly',
    )
  })
}
