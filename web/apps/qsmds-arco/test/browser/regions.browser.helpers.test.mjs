/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import test from 'node:test'

import {
  collectRuntimeIssues,
  regionManagementLayoutAuditExpression,
} from './regions.browser.helpers.mjs'

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

test('地区管理布局审计固定三面板、间距、对齐与窄屏抽屉边界', () => {
  const desktop = regionManagementLayoutAuditExpression({ mobile: false })
  assert.match(desktop, /region-management-workspace/u)
  assert.match(desktop, /region-scope-panel/u)
  assert.match(desktop, /region-scope-summary-panel/u)
  assert.match(desktop, /region-table-panel/u)
  assert.match(desktop, /region-open-scope-drawer/u)
  assert.match(desktop, /visiblePanelCount/u)
  assert.match(desktop, /horizontalPanelGap/u)
  assert.match(desktop, /verticalPanelGap/u)
  assert.match(desktop, /rightPanelsAligned/u)
  assert.match(desktop, /scopeSpansRightStack/u)
  assert.match(desktop, /panelsFitWorkspace/u)
  assert.match(desktop, /region-scope-panel-scroll/u)
  assert.match(desktop, /height: 2000px/u)
  assert.match(desktop, /aria-hidden/u)
  assert.match(desktop, /workspaceHeightDelta/u)
  assert.match(desktop, /rightStackHeightDelta/u)
  assert.match(desktop, /leftPanelHeightIsolated/u)
  assert.match(desktop, /leftPanelScrolls/u)
  assert.match(desktop, /stressProbe\.remove\(\)/u)
  assert.match(desktop, /document\.documentElement\.scrollWidth <= viewportWidth/u)

  const mobile = regionManagementLayoutAuditExpression({ mobile: true })
  assert.match(mobile, /if \([\s\S]*!mobile[\s\S]*height: 2000px/u)
  assert.match(mobile, /viewportWidth === 390/u)
  assert.match(mobile, /scopePanelWidth/u)
  assert.throws(
    () => regionManagementLayoutAuditExpression({ mobile: 'yes' }),
    { message: 'Region management layout audit mode is invalid' },
  )
})

test('Browser runtime issue 在记录和断言失败时都会遮罩全部敏感值', () => {
  const password = 'P@ss[word]?2026'
  const accessToken = 'runtime-access-token'
  const page = createPageProbe()
  const runtimeIssues = collectRuntimeIssues(page, {
    sensitiveValues: [password, '', undefined, accessToken],
  })

  runtimeIssues.start()
  page.emit('Runtime.consoleAPICalled', {
    args: [{
      value: `login failed: ${password}; retry=${password}; token=${accessToken}`,
    }],
    type: 'error',
  })
  page.emit('Runtime.exceptionThrown', {
    exceptionDetails: {
      exception: {
        description: `Error: rejected ${password}\ncaused by ${accessToken}`,
      },
    },
  })
  runtimeIssues.stop()

  assert.deepEqual(runtimeIssues.issues, [
    'console:error:login failed: [REDACTED]; retry=[REDACTED]; token=[REDACTED]',
    'exception:Error: rejected [REDACTED] caused by [REDACTED]',
  ])

  // 最终 Browser 断言会展示 issues；这里故意制造失败，证明错误消息也无明文凭据。
  let assertionFailure
  try {
    assert.deepEqual(runtimeIssues.issues, [])
  }
  catch (error) {
    assertionFailure = error
  }
  assert.ok(assertionFailure instanceof Error)
  assert.equal(assertionFailure.message.includes(password), false)
  assert.equal(assertionFailure.message.includes(accessToken), false)
  assert.match(assertionFailure.message, /\[REDACTED\]/u)
})

test('Browser runtime issue 保持无遮罩参数的既有调用兼容', () => {
  const page = createPageProbe()
  const runtimeIssues = collectRuntimeIssues(page)

  page.emit('Runtime.consoleAPICalled', {
    args: [{ value: 'before start' }],
    type: 'warning',
  })
  runtimeIssues.start()
  page.emit('Runtime.consoleAPICalled', {
    args: [{ description: 'visible warning' }],
    type: 'warning',
  })
  runtimeIssues.stop()
  page.emit('Runtime.exceptionThrown', {
    exceptionDetails: { text: 'after stop' },
  })

  assert.deepEqual(runtimeIssues.issues, ['console:warning:visible warning'])
})
