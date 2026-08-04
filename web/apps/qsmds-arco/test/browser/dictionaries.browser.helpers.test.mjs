/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import {
  collectDictionaryRuntimeErrors,
  dictionaryCatalogProviderExpression,
  dictionaryLayoutAuditExpression,
  installDictionaryBroadcastProbeScript,
  readDictionaryBrowserConfiguration,
  waitForDictionaryWorkspace,
} from './dictionaries.browser.helpers.mjs'

const validEnvironment = {
  QIANSHU_BROWSER_AUTH_ADMIN_PASSWORD: 'admin-password',
  QIANSHU_BROWSER_AUTH_ADMIN_USERNAME: 'browser_admin',
  QIANSHU_BROWSER_AUTH_BASE_URL: 'https://127.0.0.1:41003',
  QIANSHU_BROWSER_AUTH_CHROME_EXECUTABLE: '/opt/google/chrome/chrome',
  QIANSHU_BROWSER_AUTH_HTTP_BASE_URL: 'http://127.0.0.1:41001',
  QIANSHU_BROWSER_AUTH_PROFILE_DIRECTORY: '/tmp/qianshu-browser-profile',
  QIANSHU_BROWSER_DICTIONARIES_LIMITED_PASSWORD: 'limited-password',
}

test('字典 Browser 配置复用真实认证边界并单独校验普通用户凭据', () => {
  assert.deepEqual(readDictionaryBrowserConfiguration(validEnvironment), {
    baseUrl: 'https://127.0.0.1:41003',
    chromeExecutable: '/opt/google/chrome/chrome',
    httpBaseUrl: 'http://127.0.0.1:41001',
    limitedPassword: 'limited-password',
    password: 'admin-password',
    profileDirectory: '/tmp/qianshu-browser-profile',
    username: 'browser_admin',
  })

  for (const limitedPassword of [undefined, 'short', 'x'.repeat(21)]) {
    assert.throws(
      () => readDictionaryBrowserConfiguration({
        ...validEnvironment,
        QIANSHU_BROWSER_DICTIONARIES_LIMITED_PASSWORD: limitedPassword,
      }),
      { message: 'Browser dictionaries test configuration is invalid' },
    )
  }
})

test('Provider 探针只匹配字典只读契约且不依赖默认实例私有控制器', () => {
  const expression = dictionaryCatalogProviderExpression(
    'return provider.subscribeInvalidation(() => undefined)',
  )
  assert.match(expression, /typeof value\.get === 'function'/u)
  assert.match(expression, /typeof value\.prefetch === 'function'/u)
  assert.match(expression, /typeof value\.subscribeInvalidation === 'function'/u)
  assert.match(expression, /dictionary provider unavailable/u)
  assert.doesNotMatch(expression, /defaultController|invalidateDictionaryCatalogCache/u)
  assert.throws(
    () => dictionaryCatalogProviderExpression(null),
    { message: 'Dictionary provider expression body is invalid' },
  )
})

test('布局审计脚本固定桌面与 390x844 的溢出、可见表面和 44px 边界', () => {
  const desktop = dictionaryLayoutAuditExpression({ mobile: false })
  assert.match(desktop, /dictionary-management-workspace/u)
  assert.match(desktop, /dictionary-type-panel/u)
  assert.match(desktop, /dictionary-type-summary-panel/u)
  assert.match(desktop, /dictionary-item-table-panel/u)
  assert.match(
    desktop,
    /document\.documentElement\.scrollWidth <= viewportWidth/u,
  )
  assert.match(desktop, /viewportWidth >= 768/u)
  assert.match(desktop, /typePanelWidth/u)
  assert.match(desktop, /typePanel\.getBoundingClientRect\(\)\.width/u)
  assert.match(desktop, /visiblePanelCount/u)
  assert.match(desktop, /horizontalPanelGap/u)
  assert.match(desktop, /verticalPanelGap/u)
  assert.match(desktop, /rightPanelsAligned/u)
  assert.match(desktop, /panelsFitWorkspace/u)
  assert.match(desktop, /dictionary-type-panel-scroll/u)
  assert.match(desktop, /document\.createElement\('div'\)/u)
  assert.match(desktop, /height:2000px/u)
  assert.match(desktop, /setAttribute\('aria-hidden', 'true'\)/u)
  assert.match(desktop, /leftPanelWorkspaceHeightDelta <= 1/u)
  assert.match(desktop, /leftPanelRightStackHeightDelta <= 1/u)
  assert.match(
    desktop,
    /typePanelScroll\.scrollHeight > typePanelScroll\.clientHeight/u,
  )
  assert.match(desktop, /heightProbe\.remove\(\)/u)
  assert.match(
    desktop,
    /typeDrawerTrigger\?\.getClientRects\(\)\.length === 0/u,
  )

  const mobile = dictionaryLayoutAuditExpression({ mobile: true })
  assert.match(mobile, /dictionary-open-type-drawer/u)
  assert.match(mobile, /dictionary-item-card/u)
  assert.match(mobile, /label\[for\]/u)
  assert.match(mobile, /document\.getElementById\(label\.htmlFor\)/u)
  assert.match(mobile, /checkboxLabels/u)
  assert.match(mobile, /label\.getClientRects\(\)\.length > 0/u)
  assert.match(mobile, /getComputedStyle\(label\)\.pointerEvents !== 'none'/u)
  assert.doesNotMatch(mobile, /label:has\(\[role="checkbox"\]\)/u)
  assert.match(mobile, /\[data-slot="select-content"\] \[role="option"\]/u)
  assert.match(mobile, /ownedSelectContentIds/u)
  assert.match(
    mobile,
    /button, input, textarea, \[role="combobox"\], \[role="checkbox"\]/u,
  )
  assert.match(mobile, /const touchTargetTolerance = 0\.001/u)
  assert.match(
    mobile,
    /rect\.width \+ touchTargetTolerance >= 44[\s\S]*rect\.height \+ touchTargetTolerance >= 44/u,
  )
  assert.match(mobile, /if \([\s\S]*!mobile[\s\S]*height:2000px/u)
  assert.match(mobile, /viewportWidth === 390/u)
})

test('Broadcast probe 只记录字典频道并保留 exact plain payload', () => {
  const source = installDictionaryBroadcastProbeScript()

  assert.match(source, /qianshu-dictionary-catalog-v1/u)
  assert.match(source, /__dictionaryBroadcastPayloads/u)
  assert.match(source, /JSON\.parse\(JSON\.stringify\(message\)\)/u)
  assert.match(source, /return super\.postMessage\(message\)/u)
  assert.doesNotMatch(source, /cookie|authorization|localStorage/iu)

  const sent = []
  class FakeBroadcastChannel {
    constructor(name) {
      this.name = name
    }

    postMessage(message) {
      sent.push(message)
      return 'sent'
    }
  }
  const context = { BroadcastChannel: FakeBroadcastChannel }
  runInNewContext(source, context)
  const channel = new context.BroadcastChannel(
    'qianshu-dictionary-catalog-v1',
  )
  const circular = { type: 'structured-clone-only' }
  circular.self = circular
  assert.equal(channel.postMessage(circular), 'sent')
  assert.equal(sent[0], circular)
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.__dictionaryBroadcastPayloads)),
    [],
  )

  const message = {
    code: 'e2e.browser_dictionary',
    type: 'DICTIONARY_CATALOG_CHANGED',
  }
  assert.equal(channel.postMessage(message), 'sent')
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.__dictionaryBroadcastPayloads)),
    [message],
  )
})

function createPageProbe() {
  const listeners = new Map()
  return {
    emit(method, event) {
      for (const listener of listeners.get(method) ?? []) {
        listener(event)
      }
    },
    on(method, listener) {
      const methodListeners = listeners.get(method) ?? new Set()
      methodListeners.add(listener)
      listeners.set(method, methodListeners)
      return () => methodListeners.delete(listener)
    },
  }
}

test('Runtime collector 只拒绝 error/exception、忽略 warning 且遮罩凭据', () => {
  const password = 'Dictionary-P@ss[word]'
  const page = createPageProbe()
  const runtime = collectDictionaryRuntimeErrors(page, {
    sensitiveValues: [password],
  })

  runtime.start()
  page.emit('Runtime.consoleAPICalled', {
    args: [{ value: '[intlify] Not found parent scope' }],
    type: 'warning',
  })
  page.emit('Runtime.consoleAPICalled', {
    args: [{ value: `request failed ${password}` }],
    type: 'error',
  })
  page.emit('Runtime.exceptionThrown', {
    exceptionDetails: {
      exception: { description: `Error: rejected ${password}` },
    },
  })
  runtime.stop()
  page.emit('Runtime.consoleAPICalled', {
    args: [{ value: 'after stop' }],
    type: 'error',
  })

  assert.deepEqual(runtime.issues, [
    'console:error:request failed [REDACTED]',
    'exception:Error: rejected [REDACTED]',
  ])
})

test('workspace 等待器只接受真实字典路由与已挂载受保护工作区', async () => {
  const expressions = []
  await waitForDictionaryWorkspace({
    waitFor: async expression => expressions.push(expression),
  })
  assert.equal(expressions.length, 1)
  assert.match(expressions[0], /#\/system\/basic-data\/dictionaries/u)
  assert.match(expressions[0], /dictionary-management-workspace/u)
})
