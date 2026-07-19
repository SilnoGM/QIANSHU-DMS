import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import process from 'node:process'

const devtoolsReadyTimeoutMilliseconds = 20_000
const commandTimeoutMilliseconds = 15_000

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

function allocateDebuggingPort() {
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
        else if (Number.isInteger(port) && port > 0 && port <= 65_535) {
          resolve(port)
        }
        else {
          reject(new Error('Browser debugging port allocation failed'))
        }
      })
    })
  })
}

function waitForExit(child, timeoutMilliseconds) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true)
  }
  return Promise.race([
    new Promise(resolve => child.once('exit', () => resolve(true))),
    delay(timeoutMilliseconds).then(() => false),
  ])
}

export class CdpConnection {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.listeners = new Map()

    socket.addEventListener('message', event => this.handleMessage(event.data))
    socket.addEventListener('close', () => this.rejectPending())
    socket.addEventListener('error', () => this.rejectPending())
  }

  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl)
    try {
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error('Browser DevTools connection timed out')),
          commandTimeoutMilliseconds,
        )
        socket.addEventListener('open', () => {
          clearTimeout(timeout)
          resolve()
        }, { once: true })
        socket.addEventListener('error', () => {
          clearTimeout(timeout)
          reject(new Error('Browser DevTools connection failed'))
        }, { once: true })
      })
    }
    catch (error) {
      // 尚未建立的 WebSocket 也持有底层句柄；失败时主动关闭，避免测试
      // 进程被悬挂到命令超时。
      socket.close()
      throw error
    }
    return new CdpConnection(socket)
  }

  handleMessage(rawMessage) {
    let message
    try {
      message = JSON.parse(String(rawMessage))
    }
    catch {
      return
    }
    if (Number.isInteger(message.id)) {
      const pending = this.pending.get(message.id)
      if (pending === undefined) {
        return
      }
      this.pending.delete(message.id)
      clearTimeout(pending.timeout)
      if (message.error === undefined) {
        pending.resolve(message.result ?? {})
      }
      else {
        pending.reject(new Error('Browser DevTools command failed'))
      }
      return
    }
    if (typeof message.method === 'string') {
      for (const listener of this.listeners.get(message.method) ?? []) {
        listener(message.params ?? {})
      }
    }
  }

  rejectPending() {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Browser DevTools connection closed'))
    }
    this.pending.clear()
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) ?? new Set()
    listeners.add(listener)
    this.listeners.set(method, listeners)
    return () => listeners.delete(listener)
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('Browser DevTools command timed out'))
      }, commandTimeoutMilliseconds)
      this.pending.set(id, { reject, resolve, timeout })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  waitForEvent(method, predicate = () => true, timeoutMilliseconds = commandTimeoutMilliseconds) {
    return new Promise((resolve, reject) => {
      let unsubscribe = () => {}
      const timeout = setTimeout(() => {
        unsubscribe()
        reject(new Error('Browser DevTools event timed out'))
      }, timeoutMilliseconds)
      unsubscribe = this.on(method, (params) => {
        if (!predicate(params)) {
          return
        }
        clearTimeout(timeout)
        unsubscribe()
        resolve(params)
      })
    })
  }

  close() {
    this.socket.close()
  }
}

export class ChromePage {
  constructor(connection) {
    this.connection = connection
  }

  async initialize() {
    await Promise.all([
      this.connection.send('Page.enable'),
      this.connection.send('Runtime.enable'),
      this.connection.send('Network.enable'),
    ])
  }

  addScriptOnNewDocument(source) {
    return this.connection.send('Page.addScriptToEvaluateOnNewDocument', {
      source,
    })
  }

  async navigate(url) {
    // hash history 只触发同文档导航；同时监听两类事件，才能覆盖首次加载和
    // `/#/path` 路由切换，且不把同文档导航误判为页面加载超时。
    const navigated = Promise.race([
      this.connection.waitForEvent('Page.loadEventFired'),
      this.connection.waitForEvent('Page.navigatedWithinDocument'),
    ])
    await this.connection.send('Page.navigate', { url })
    await navigated
  }

  async evaluate(expression) {
    const result = await this.connection.send('Runtime.evaluate', {
      awaitPromise: true,
      expression,
      returnByValue: true,
      userGesture: true,
    })
    if (result.exceptionDetails !== undefined) {
      throw new Error('Browser evaluation failed')
    }
    return result.result?.value
  }

  async waitFor(expression, timeoutMilliseconds = 20_000) {
    const deadline = Date.now() + timeoutMilliseconds
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) {
        return
      }
      await delay(100)
    }
    throw new Error('Browser condition timed out')
  }

  getCookies() {
    return this.connection.send('Network.getAllCookies')
  }

  enableRequestInterception(patterns) {
    return this.connection.send('Fetch.enable', { patterns })
  }

  disableRequestInterception() {
    return this.connection.send('Fetch.disable')
  }

  continueInterceptedRequest(requestId) {
    return this.connection.send('Fetch.continueRequest', { requestId })
  }

  failInterceptedRequest(requestId) {
    return this.connection.send('Fetch.failRequest', {
      errorReason: 'Failed',
      requestId,
    })
  }

  setViewport(width, height, mobile = false) {
    return this.connection.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height,
      mobile,
      width,
    })
  }

  waitForEvent(method, predicate, timeoutMilliseconds) {
    return this.connection.waitForEvent(
      method,
      predicate,
      timeoutMilliseconds,
    )
  }

  on(method, listener) {
    return this.connection.on(method, listener)
  }

  close() {
    this.connection.close()
  }
}

export class ChromeBrowser {
  constructor(child, browserConnection, debuggingPort, executable, userDataDirectory) {
    this.child = child
    this.browserConnection = browserConnection
    this.debuggingPort = debuggingPort
    this.executable = executable
    this.userDataDirectory = userDataDirectory
  }

  async newPage() {
    const response = await fetch(
      `http://127.0.0.1:${this.debuggingPort}/json/new?about%3Ablank`,
      { method: 'PUT' },
    )
    if (!response.ok) {
      throw new Error('Browser page creation failed')
    }
    const target = await response.json()
    if (typeof target.webSocketDebuggerUrl !== 'string') {
      throw new TypeError('Browser page target is invalid')
    }
    const page = new ChromePage(
      await CdpConnection.connect(target.webSocketDebuggerUrl),
    )
    await page.initialize()
    return page
  }

  async close() {
    try {
      await this.browserConnection.send('Browser.close')
    }
    catch {
      // Browser 可能已在关闭；下方仍会有界等待并升级终止。
    }
    if (!await waitForExit(this.child, 5_000)) {
      stopChromeProcess(this.child, 'SIGTERM')
      if (!await waitForExit(this.child, 3_000)) {
        stopChromeProcess(this.child, 'SIGKILL')
      }
    }
    this.browserConnection.close()
  }
}

function stopChromeProcess(child, signal) {
  try {
    if (process.platform === 'win32') {
      child.kill(signal)
    }
    else {
      process.kill(-child.pid, signal)
    }
  }
  catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error
    }
  }
}

/**
 * Browser endpoint 已就绪后，CDP WebSocket 仍可能失败。此时 launchChrome
 * 尚未把 child handle 交给调用方，必须在本层有界回收完整进程组。
 */
export async function connectBrowserOrStop({
  child,
  connect = CdpConnection.connect,
  stop = stopChromeProcess,
  waitForProcessExit = waitForExit,
  webSocketUrl,
}) {
  try {
    return await connect(webSocketUrl)
  }
  catch (error) {
    stop(child, 'SIGTERM')
    if (!await waitForProcessExit(child, 3_000)) {
      stop(child, 'SIGKILL')
      await waitForProcessExit(child, 3_000)
    }
    throw error
  }
}

export function describeChromeStartupFailure({ exitCode, signalCode, stderr }) {
  const processState = signalCode ?? (
    Number.isInteger(exitCode) ? `EXIT_${exitCode}` : 'RUNNING'
  )
  const normalizedStderr = typeof stderr === 'string'
    ? stderr.toLowerCase()
    : ''
  let stderrState = 'EMPTY'
  if (
    normalizedStderr.includes('operation not permitted')
    || normalizedStderr.includes('permission denied')
  ) {
    stderrState = 'PERMISSION_DENIED'
  }
  else if (normalizedStderr.trim() !== '') {
    stderrState = 'PRESENT_UNCLASSIFIED'
  }
  return `process=${processState}, stderr=${stderrState}`
}

export async function launchChrome({ executable, userDataDirectory }) {
  // Chrome 在部分 macOS 版本不会为 `--remote-debugging-port=0` 写入
  // DevToolsActivePort；先短暂占用 loopback:0 取得端口，再用 HTTP ready
  // endpoint 验证真正监听，避免依赖平台私有文件行为。
  // 持久化 Profile 既用于验证浏览器重启后的 Cookie 恢复，也避免 Chrome
  // 在受限执行环境中自行创建多层目录时提前退出。目录只存于编排器的临时目录，
  // 由根入口在测试结束后统一清理。
  await mkdir(userDataDirectory, { mode: 0o700, recursive: true })
  const debuggingPort = await allocateDebuggingPort()
  const args = [
    '--headless=new',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${userDataDirectory}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--ignore-certificate-errors',
    '--password-store=basic',
    '--use-mock-keychain',
    'about:blank',
  ]
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    args.push('--no-sandbox')
  }
  const child = spawn(executable, args, {
    detached: process.platform !== 'win32',
    shell: false,
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  // 只在内存中保留有界 stderr 用于固定分类，绝不把底层内容原样写入日志。
  let startupStderr = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk) => {
    startupStderr = `${startupStderr}${chunk}`.slice(-16_384)
  })
  const exitPromise = new Promise(resolve => child.once('exit', (code, signal) => {
    resolve({ code, signal })
  }))
  const deadline = Date.now() + devtoolsReadyTimeoutMilliseconds
  let version
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `Browser exited before DevTools became ready (${describeChromeStartupFailure({
          exitCode: child.exitCode,
          signalCode: child.signalCode,
          stderr: startupStderr,
        })})`,
      )
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${debuggingPort}/json/version`,
      )
      if (response.ok) {
        version = await response.json()
        break
      }
    }
    catch {
      // 监听器尚未建立时继续有界轮询。
    }
    await Promise.race([delay(50), exitPromise])
  }
  if (version === undefined) {
    stopChromeProcess(child, 'SIGKILL')
    await waitForExit(child, 3_000)
    throw new Error(
      `Browser DevTools did not become ready (${describeChromeStartupFailure({
        exitCode: child.exitCode,
        signalCode: child.signalCode,
        stderr: startupStderr,
      })})`,
    )
  }
  if (typeof version.webSocketDebuggerUrl !== 'string') {
    stopChromeProcess(child, 'SIGKILL')
    await waitForExit(child, 3_000)
    throw new Error('Browser DevTools endpoint is invalid')
  }
  const browserConnection = await connectBrowserOrStop({
    child,
    webSocketUrl: version.webSocketDebuggerUrl,
  })
  return new ChromeBrowser(
    child,
    browserConnection,
    debuggingPort,
    executable,
    userDataDirectory,
  )
}
