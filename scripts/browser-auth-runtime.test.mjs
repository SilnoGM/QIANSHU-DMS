import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  cacheControlForPath,
  resolveStaticRequest,
} from './browser-auth/static-server.mjs'
import {
  createUpstreamRequest,
} from './browser-auth/reverse-proxy.mjs'
import {
  createProvisionCommand,
  readProvisionInput,
} from './browser-auth/provision-admin.mjs'
import { classifyServerStartupError } from './browser-auth/server-entry.mjs'
import {
  CdpConnection,
  ChromePage,
  connectBrowserOrStop,
  describeChromeStartupFailure,
} from '../web/apps/qsmds-arco/test/browser/chrome-driver.mjs'

test('静态入口 HTML 与带 Hash 资源使用不同缓存策略', () => {
  assert.equal(
    cacheControlForPath('/index.html'),
    'no-cache, must-revalidate',
  )
  assert.equal(
    cacheControlForPath('/assets/index-D6n9p2Qf.js'),
    'public, max-age=31536000, immutable',
  )
  assert.equal(cacheControlForPath('/favicon.svg'), 'public, max-age=300')
})

test('静态路径只读取真实 Web 根并为前端路由回退 index.html', () => {
  const root = path.resolve('/tmp/browser-auth-web')
  assert.deepEqual(resolveStaticRequest(root, '/assets/app-ABC123.js'), {
    absolutePath: path.join(root, 'assets/app-ABC123.js'),
    publicPath: '/assets/app-ABC123.js',
  })
  assert.deepEqual(resolveStaticRequest(root, '/system/users?tab=active'), {
    absolutePath: path.join(root, 'index.html'),
    publicPath: '/index.html',
  })
  assert.throws(
    () => resolveStaticRequest(root, '/assets/%2e%2e/%2e%2e/secret'),
    { message: 'Browser auth static request path is invalid' },
  )
})

test('同源代理按 /api 边界路由并保留浏览器 Origin/CSRF Header', () => {
  const request = createUpstreamRequest({
    apiOrigin: 'http://127.0.0.1:41002',
    headers: {
      host: '127.0.0.1:41001',
      origin: 'http://127.0.0.1:41001',
      'x-qianshu-csrf': '1',
    },
    method: 'POST',
    requestUrl: '/api/auth/login?source=browser',
    webOrigin: 'http://127.0.0.1:41005',
  })

  assert.equal(request.origin, 'http://127.0.0.1:41002')
  assert.equal(request.path, '/api/auth/login?source=browser')
  assert.equal(request.headers.origin, 'http://127.0.0.1:41001')
  assert.equal(request.headers['x-qianshu-csrf'], '1')
  assert.equal(request.headers.host, '127.0.0.1:41002')
})

test('管理员 fixture 密码只通过子进程 env 传递且输入严格校验', () => {
  const environment = {
    DATABASE_URL:
      'postgresql://qianshu_ci:db-password@127.0.0.1:54321/qianshu_ci?schema=public',
    QIANSHU_BROWSER_AUTH_ADMIN_DISPLAY_NAME: 'Browser Admin',
    QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD: 'BrowserAuth-secret!7',
    QIANSHU_BROWSER_AUTH_ADMIN_USERNAME: 'browser_admin',
  }
  const input = readProvisionInput(environment)
  const command = createProvisionCommand(input, { PATH: '/usr/bin' })

  assert.deepEqual(command.args.slice(0, 4), [
    '-C', 'server', 'exec', 'node',
  ])
  assert.equal(command.args.includes(input.password), false)
  assert.match(command.args.at(-1), /INSERT INTO user_profiles/u)
  assert.match(command.args.at(-1), /service_provider\.supplier/u)
  assert.match(command.args.at(-1), /BROWSER_SUPPLIER_EFFECTIVE/u)
  assert.match(command.args.at(-1), /INSERT INTO products/u)
  assert.match(command.args.at(-1), /PRODUCT-BROWSER-001/u)
  assert.match(command.args.at(-1), /generate_series\(1, 17\)/u)
  assert.match(command.args.at(-1), /INSERT INTO exchange_rates/u)
  assert.match(command.args.at(-1), /UPDATE currencies SET enabled = true/u)
  assert.match(command.args.at(-1), /INSERT INTO numbering_rules/u)
  assert.match(command.args.at(-1), /VALUES \(\\'PRODUCT\\'/u)
  assert.match(command.args.at(-1), /INSERT INTO numbering_rule_versions/u)
  assert.match(command.args.at(-1), /INSERT INTO numbering_rule_segments/u)
  assert.match(command.args.at(-1), /SET status = \\'ACTIVE\\'/u)
  assert.match(command.args.at(-1), /SET status = \\'ENABLED\\'/u)
  assert.equal(command.env.QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD, input.password)
  assert.equal(command.env.DATABASE_URL, input.databaseUrl)
  assert.throws(
    () => readProvisionInput({
      ...environment,
      QIANSHU_BROWSER_AUTH_ADMIN_USERNAME: '../admin',
    }),
    { message: 'Browser auth admin fixture input is invalid' },
  )
  for (const invalidPassword of ['1234567', 'x'.repeat(21)]) {
    assert.throws(
      () => readProvisionInput({
        ...environment,
        QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD: invalidPassword,
      }),
      { message: 'Browser auth admin fixture input is invalid' },
    )
  }
})

test('Server 启动诊断只输出固定分类且不透传底层敏感消息', () => {
  assert.equal(
    classifyServerStartupError(new Error('Database initialization failed')),
    'DATABASE_INITIALIZATION_FAILED',
  )
  assert.equal(
    classifyServerStartupError({ code: 'EADDRINUSE' }),
    'PORT_UNAVAILABLE',
  )
  assert.equal(
    classifyServerStartupError(new Error('postgresql://user:secret@example/db')),
    'UNKNOWN',
  )

  const dependencyError = new Error('dependency error with secret canary')
  dependencyError.name = 'UnknownDependenciesException'
  assert.equal(
    classifyServerStartupError(dependencyError),
    'NEST_DEPENDENCY_RESOLUTION_FAILED',
  )

  const authModuleError = new Error('authentication error with secret canary')
  Object.defineProperty(authModuleError, 'stack', {
    value: [
      'Error: authentication error with secret canary',
      '    at /workspace/server/dist/modules/auth/providers/example.js:1:1',
    ].join('\n'),
  })
  assert.equal(classifyServerStartupError(authModuleError), 'AUTH_MODULE_FAILED')
})

test('Chrome 启动失败只暴露固定进程与 stderr 分类', () => {
  assert.equal(
    describeChromeStartupFailure({
      exitCode: null,
      signalCode: 'SIGKILL',
      stderr: 'profile=/tmp/secret-canary',
    }),
    'process=SIGKILL, stderr=PRESENT_UNCLASSIFIED',
  )
  assert.equal(
    describeChromeStartupFailure({
      exitCode: null,
      signalCode: null,
      stderr: 'FATAL: Operation not permitted at /tmp/secret-canary',
    }),
    'process=RUNNING, stderr=PERMISSION_DENIED',
  )
})

test('CDP WebSocket 建连失败时关闭未完成的 Socket', async () => {
  const originalWebSocket = globalThis.WebSocket
  let closeCount = 0

  class FailingWebSocket {
    constructor() {
      this.listeners = new Map()
      queueMicrotask(() => this.emit('error'))
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener)
    }

    emit(type) {
      this.listeners.get(type)?.()
    }

    close() {
      closeCount += 1
    }
  }

  globalThis.WebSocket = FailingWebSocket
  try {
    await assert.rejects(
      CdpConnection.connect('ws://127.0.0.1:1/devtools/browser/test'),
      { message: 'Browser DevTools connection failed' },
    )
    assert.equal(closeCount, 1)
  }
  finally {
    globalThis.WebSocket = originalWebSocket
  }
})

test('浏览器级 CDP 建连失败时有界终止 Chrome 进程组', async () => {
  const child = { pid: 12345 }
  const connectionError = new Error('fixed connection failure')
  const signals = []
  const waits = []

  await assert.rejects(
    connectBrowserOrStop({
      child,
      connect: async () => {
        throw connectionError
      },
      stop: (receivedChild, signal) => {
        assert.equal(receivedChild, child)
        signals.push(signal)
      },
      waitForProcessExit: async (receivedChild, timeoutMilliseconds) => {
        assert.equal(receivedChild, child)
        waits.push(timeoutMilliseconds)
        return false
      },
      webSocketUrl: 'ws://127.0.0.1:1/devtools/browser/test',
    }),
    connectionError,
  )

  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL'])
  assert.deepEqual(waits, [3_000, 3_000])
})

test('Chrome 页面导航同时支持完整加载与 hash 内部导航', async () => {
  const waitedEvents = []
  const connection = {
    send: async (method) => {
      assert.equal(method, 'Page.navigate')
      return {}
    },
    waitForAnyEvent: (events) => {
      waitedEvents.push(...events.map(event => event.method))
      assert.equal(events.every(event => event.predicate({}) === true), true)
      return Promise.resolve({})
    },
  }
  const page = new ChromePage(connection)

  await Promise.race([
    page.navigate('https://127.0.0.1/#/system/users'),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('same-document navigation timed out')), 50)
    }),
  ])

  assert.deepEqual(waitedEvents, [
    'Page.loadEventFired',
    'Page.navigatedWithinDocument',
  ])
})
