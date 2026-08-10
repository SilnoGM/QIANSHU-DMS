/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'
import {
  collectDictionaryRuntimeErrors,
  dictionaryCatalogProviderExpression,
  dictionaryLayoutAuditExpression,
  dictionaryTypeCardStressAuditExpression,
  installDictionaryBroadcastProbeScript,
  readDictionaryBrowserConfiguration,
  waitForDictionaryWorkspace,
} from './dictionaries.browser.helpers.mjs'
import {
  clickDialogButton,
  fillDialogControl,
  waitForAfterAuthentication,
  waitForDialogControlValue,
  waitForNoVisibleDialog,
  waitForVisibleDialog,
} from './numbering.browser.helpers.mjs'
import {
  apiExpression,
  appRouteUrl,
  authStoreExpression,
  loginThroughRealHttp,
  patchPermissionsExpression,
  pressKey,
  requestPathname,
  restorePermissionsExpression,
} from './regions.browser.helpers.mjs'

const managementRoute = '/system/basic-data/dictionaries'
const typeCodeInput = 'E2E.BROWSER_DICTIONARY'
const typeCode = 'e2e.browser_dictionary'
const typeInitialName = '浏览器字典'
const typeFinalName = '浏览器字典已编辑'
const primaryValue = 'E2E_PRIMARY'
const primaryInitialLabel = '主要条目'
const primaryFinalLabel = '主要条目已编辑'
const secondaryValue = 'E2E_SECONDARY'
const secondaryLabel = '次要条目'
let workspaceRemountVersion = 0

async function runDictionaryBrowserStep(label, action) {
  process.stdout.write(`[dictionaries-browser] ${label}\n`)
  try {
    return await action()
  }
  catch (error) {
    throw new Error(`Dictionaries browser step failed: ${label}`, {
      cause: error,
    })
  }
}

const dictionarySelectRoute = '/component-library/business/dictionary-select'

function dictionarySelectRootSelector(testId) {
  return `[data-testid="${testId}"]`
}

function dictionarySelectInputExpression(testId) {
  return `document.querySelector(${JSON.stringify(
    `${dictionarySelectRootSelector(testId)} [data-slot="combobox-input"]`,
  )})`
}

async function readDictionarySelectActionLayout(page, testId) {
  return page.evaluate(`(() => {
    const input = ${dictionarySelectInputExpression(testId)}
    const root = input?.closest(${JSON.stringify(
      dictionarySelectRootSelector(testId),
    )})
    const control = input?.parentElement
    const action = root?.querySelector(
      '[data-slot="combobox-clear"], [data-slot="combobox-trigger"]',
    )
    if (!input || !control || !action) {
      throw new Error('dictionary select action layout unavailable')
    }
    const controlStyle = getComputedStyle(control)
    const controlRect = control.getBoundingClientRect()
    const inputRect = input.getBoundingClientRect()
    const actionRect = action.getBoundingClientRect()
    return {
      actionAtInlineEnd: controlStyle.direction === 'rtl'
        ? actionRect.right <= inputRect.left + 1
        : actionRect.left >= inputRect.right - 1,
      actionInsideControl: actionRect.top >= controlRect.top - 0.001
        && actionRect.bottom <= controlRect.bottom + 0.001
        && actionRect.left >= controlRect.left - 0.001
        && actionRect.right <= controlRect.right + 0.001,
      actionSlot: action.getAttribute('data-slot'),
      controlDisplay: controlStyle.display,
      controlHeight: controlRect.height,
      sameRow: Math.abs(
        (inputRect.top + inputRect.height / 2)
        - (actionRect.top + actionRect.height / 2),
      ) <= 1,
    }
  })()`)
}

async function openDictionarySelectBrowserSession(
  t,
  profileSuffix,
  { height = 800, mobile = false, width = 1280 } = {},
) {
  const configuration = readDictionaryBrowserConfiguration(process.env)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory:
      `${configuration.profileDirectory}-dictionary-select-${profileSuffix}`,
  })
  t.after(async () => browser.close())
  const page = await browser.newPage()
  const runtime = collectDictionaryRuntimeErrors(page, {
    sensitiveValues: [configuration.password, configuration.limitedPassword],
  })
  runtime.start()
  t.after(() => {
    runtime.stop()
    assert.deepEqual(runtime.issues, [])
  })
  await page.setViewport(width, height, mobile)
  await page.navigate(appRouteUrl(configuration.baseUrl, '/login'))
  await loginThroughRealHttp(page, configuration)
  const dictionaryRequests = []
  const removeDictionaryRequestListener = page.on(
    'Network.requestWillBeSent',
    (event) => {
      const pathname = requestPathname(event)
      if (
        pathname.startsWith('/api/dictionary-catalog')
        || pathname.startsWith('/api/dictionary-types')
      ) {
        dictionaryRequests.push({
          method: event.request?.method ?? '',
          pathname,
        })
      }
    },
  )
  t.after(() => removeDictionaryRequestListener())
  await page.navigate(appRouteUrl(configuration.baseUrl, dictionarySelectRoute))
  await waitForAfterAuthentication(page, `(() => {
    const showcase = document.querySelector(
      '[data-testid="dictionary-select-showcase"]',
    )
    const input = ${dictionarySelectInputExpression('dictionary-select-standard')}
    return location.hash === '#${dictionarySelectRoute}'
      && showcase?.getClientRects().length > 0
      && input?.getClientRects().length > 0
      && !input.disabled
      && input.getAttribute('aria-busy') !== 'true'
  })()`)
  // App loading 依赖前台页面的 transitionend 清理。真实鼠标验收开始前必须
  // 激活标签页并等待透明 loading 外层真正移除，不能用 JS click 绕过遮挡。
  await page.bringToFront()
  await page.waitFor(`document.querySelector('[data-app-loading]') === null`)
  return { configuration, dictionaryRequests, page }
}

async function openDictionaryCombobox(page, testId) {
  const input = dictionarySelectInputExpression(testId)
  await page.waitFor(`(() => {
    const target = ${input}
    return target?.getClientRects().length > 0 && !target.disabled
  })()`)
  await page.evaluate(`(() => {
    const target = ${input}
    if (!target) throw new Error('dictionary select input unavailable')
    target.scrollIntoView({ block: 'center', inline: 'nearest' })
    target.focus({ preventScroll: true })
    target.click()
    return true
  })()`)
  await page.waitFor(`(() => {
    const target = ${input}
    const content = target?.getAttribute('aria-controls')
      ? document.getElementById(target.getAttribute('aria-controls'))
      : null
    return target?.getAttribute('aria-expanded') === 'true'
      && content?.getClientRects().length > 0
  })()`)
  await page.waitFor(`(() => {
    const target = ${input}
    const content = target?.getAttribute('aria-controls')
      ? document.getElementById(target.getAttribute('aria-controls'))
      : null
    if (!content || content.getClientRects().length === 0) return false
    const transform = getComputedStyle(content).transform
    if (transform === 'none') return true
    const matrix = new DOMMatrixReadOnly(transform)
    return Math.abs(Math.hypot(matrix.a, matrix.b) - 1) < 0.00001
      && Math.abs(Math.hypot(matrix.c, matrix.d) - 1) < 0.00001
  })()`)
}

async function setDictionaryComboboxSearch(page, testId, value) {
  const input = dictionarySelectInputExpression(testId)
  await openDictionaryCombobox(page, testId)
  await page.evaluate(`(() => {
    const target = ${input}
    if (!target) throw new Error('dictionary select input unavailable')
    target.focus({ preventScroll: true })
    target.select()
    return document.activeElement === target
  })()`)
  if (value !== '') {
    await page.connection.send('Input.insertText', { text: value })
  }
  else {
    await pressKey(page, 'Backspace')
  }
  await page.waitFor(`${input}?.value === ${JSON.stringify(value)}`)
}

async function clickDictionaryComboboxOption(page, testId, text, index = 0) {
  const input = dictionarySelectInputExpression(testId)
  await page.bringToFront()
  const available = `(() => {
    const target = ${input}
    const content = target?.getAttribute('aria-controls')
      ? document.getElementById(target.getAttribute('aria-controls'))
      : null
    return [...(content?.querySelectorAll('[data-slot="combobox-item"]') ?? [])]
      .filter(item => (
        item.getClientRects().length > 0
        && item.getAttribute('data-disabled') === null
        && item.getAttribute('aria-disabled') !== 'true'
        && item.textContent?.trim() === ${JSON.stringify(text)}
      ))
  })()`
  await page.waitFor(`${available}.length > ${index}`)
  const center = await page.evaluate(`(() => {
    const matches = ${available}
    const option = matches[${index}]
    if (!option) throw new Error('dictionary combobox option unavailable')
    const rect = option.getBoundingClientRect()
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    const hit = document.elementFromPoint(x, y)
    return {
      hit: Boolean(hit && option.contains(hit)),
      hitSlot: hit?.closest?.('[data-slot]')?.getAttribute('data-slot') ?? null,
      hitTag: hit?.tagName ?? null,
      hitText: hit?.textContent?.trim().slice(0, 80) ?? null,
      x,
      y,
    }
  })()`)
  assert.equal(
    center.hit,
    true,
    `dictionary option center is obstructed: ${JSON.stringify(center)}`,
  )
  // Chrome 的 PointerEvent 命中测试依赖当前真实指针位置；先移动再按下，
  // 并显式维护 buttons/pointerType，避免只关闭 Popover 却没有激活 option。
  await page.connection.send('Input.dispatchMouseEvent', {
    button: 'none',
    buttons: 0,
    pointerType: 'mouse',
    type: 'mouseMoved',
    x: center.x,
    y: center.y,
  })
  await page.connection.send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'mouse',
    type: 'mousePressed',
    x: center.x,
    y: center.y,
  })
  await page.connection.send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'mouse',
    type: 'mouseReleased',
    x: center.x,
    y: center.y,
  })
  await page.waitFor(`${input}?.getAttribute('aria-expanded') !== 'true'`)
}

async function clickDictionaryShowcaseButton(page, text) {
  await clickScopedButton(
    page,
    '[data-testid="dictionary-select-showcase"]',
    text,
  )
}

function visibleDialogExpression(title, body) {
  return `(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .filter(candidate => candidate.getClientRects().length > 0)
      .reverse()
      .find(candidate => candidate.textContent?.includes(${JSON.stringify(title)}))
    if (!dialog) throw new Error('dictionary dialog unavailable')
    ${body}
  })()`
}

async function clickScopedButton(page, rootSelector, text) {
  const expression = `(() => {
    const root = document.querySelector(${JSON.stringify(rootSelector)})
    const button = [...(root?.querySelectorAll('button') ?? [])].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim() === ${JSON.stringify(text)}
      && !candidate.disabled
    ))
    if (!button) return false
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`
  await page.waitFor(expression.replace('button.click()\n    return true', 'return true'))
  await page.evaluate(expression)
}

async function clickVisibleExactButton(page, text) {
  const expression = `(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim() === ${JSON.stringify(text)}
      && !candidate.disabled
    ))
    if (!button) return false
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`
  await page.waitFor(expression.replace('button.click()\n    return true', 'return true'))
  await page.evaluate(expression)
}

/**
 * fresh migration 现在会预置停用的业务字典 Type，页面按稳定选择语义继续保留
 * 当前 Type。Browser 场景必须像真实用户一样按 exact code 选择测试 Type，不能再
 * 依赖“数据库初始为空，所以新建项自动成为首项”的历史前提。移动端目录位于
 * bottom Drawer；仅以真实可见的 Drawer trigger 判断移动布局，避免把桌面列表的
 * 短暂刷新窗口误判为移动端，再复用同一精确选择路径。
 */
async function selectDictionaryTypeByCode(page, code) {
  const visibleCardExpression = `(() => [...document.querySelectorAll(
    '[data-testid="dictionary-type-card"]',
  )].some(card => (
    card.getClientRects().length > 0
    && !card.disabled
    && card.querySelector('code')?.textContent?.trim() === ${JSON.stringify(code)}
  )))()`
  const mobileDrawerTriggerVisible = await page.evaluate(`(() => {
    const trigger = document.querySelector(
      '[data-testid="dictionary-open-type-drawer"]',
    )
    return trigger?.getClientRects().length > 0 && !trigger.disabled
  })()`)
  if (mobileDrawerTriggerVisible) {
    await clickVisibleExactButton(page, '选择类型')
    await waitForVisibleDialog(page, '选择字典类型')
  }
  await page.waitFor(visibleCardExpression)
  await page.evaluate(`(() => {
    const card = [...document.querySelectorAll(
      '[data-testid="dictionary-type-card"]',
    )].find(candidate => (
      candidate.getClientRects().length > 0
      && !candidate.disabled
      && candidate.querySelector('code')?.textContent?.trim()
        === ${JSON.stringify(code)}
    ))
    if (!card) throw new Error('dictionary type card unavailable')
    card.focus({ preventScroll: true })
    card.click()
    return true
  })()`)
  await page.waitFor(`(() => {
    const title = document.querySelector('#dictionary-item-panel-title')
    const selectedCode = title?.parentElement?.querySelector('code')
    return selectedCode?.textContent?.trim() === ${JSON.stringify(code)}
  })()`)
}

async function clickItemAction(page, value, action) {
  const ariaLabel = `${action}条目 ${value}`
  const expression = `(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.getAttribute('aria-label') === ${JSON.stringify(ariaLabel)}
      && !candidate.disabled
    ))
    if (!button) return false
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`
  await page.waitFor(expression.replace('button.click()\n    return true', 'return true'))
  await page.evaluate(expression)
}

async function waitForItemAction(page, value, action) {
  await page.waitFor(`(() => [...document.querySelectorAll('button')].some(button => (
    button.getClientRects().length > 0
    && button.getAttribute('aria-label') === ${JSON.stringify(`${action}条目 ${value}`)}
    && !button.disabled
  )))()`)
}

async function waitForItemTable(page, marker) {
  await page.waitFor(`(() => {
    const root = document.querySelector('[data-testid="dictionary-item-table"]')
    return root?.getClientRects().length > 0
      && root.querySelector('[aria-busy="true"]') === null
      && root.textContent?.includes(${JSON.stringify(marker)})
  })()`)
}

async function remountDictionaryWorkspace(page, baseUrl, itemMarker) {
  /*
   * 只改变 hash 可能保留旧组件；改变 document 查询串会触发真实整页加载，同时
   * 保留同源 Cookie，使 useMediaQuery 必定按当前 CDP 设备指标重新初始化。
   */
  workspaceRemountVersion += 1
  const url = new URL(`${baseUrl}/`)
  url.searchParams.set(
    'dictionary-e2e-remount',
    String(workspaceRemountVersion),
  )
  url.hash = `#${managementRoute}`
  await page.navigate(url.toString())
  await waitForAfterAuthentication(page, `document.querySelector(
    '[data-testid="dictionary-management-workspace"]',
  ) !== null`)
  await waitForDictionaryWorkspace(page)
  await selectDictionaryTypeByCode(page, typeCode)
  await waitForItemTable(page, itemMarker)
}

async function observeDictionaryResponse(page, { method, pathname }, action) {
  const controller = new AbortController()
  const requestIds = new Set()
  const removeRequestListener = page.on(
    'Network.requestWillBeSent',
    (event) => {
      if (
        event.request?.method === method
        && requestPathname(event) === pathname
      ) {
        requestIds.add(event.requestId)
      }
    },
  )
  const response = page.waitForEvent(
    'Network.responseReceived',
    event => requestIds.has(event.requestId),
    20_000,
    { signal: controller.signal },
  )
  try {
    await action()
    return await response
  }
  finally {
    controller.abort()
    await response.catch(() => undefined)
    removeRequestListener()
  }
}

async function createTypeThroughUi(page) {
  await clickVisibleExactButton(page, '新增类型')
  await waitForVisibleDialog(page, '新增字典类型')
  await fillDialogControl(page, '新增字典类型', '类型编码', typeCodeInput)
  await fillDialogControl(page, '新增字典类型', '类型名称', typeInitialName)
  await fillDialogControl(page, '新增字典类型', '排序', '9100')
  const response = await observeDictionaryResponse(
    page,
    { method: 'POST', pathname: '/api/dictionary-types' },
    () => clickDialogButton(page, '新增字典类型', '创建类型'),
  )
  assert.equal(Number(response.response?.status), 201)
  try {
    await waitForNoVisibleDialog(page, '新增字典类型')
  }
  catch (error) {
    /*
     * 只记录可见 UI 与当前权限，不读取请求体、Cookie 或 Storage。真实 201 后若
     * Modal 没有收口，这组诊断可以区分响应回写失败与 Dialog 选择器误判。
     */
    const diagnostic = await page.evaluate(`(() => {
      const app = document.querySelector('#app')?.__vue_app__
      const account = app?.config?.globalProperties?.$pinia?._s
        ?.get('appAccount')
      const dialogs = [...document.querySelectorAll('[role="dialog"]')]
        .filter(dialog => dialog.getClientRects().length > 0)
        .map(dialog => ({
          buttons: [...dialog.querySelectorAll('button')].map(button => ({
            disabled: button.disabled,
            text: button.textContent?.trim()?.slice(0, 80) ?? '',
          })),
          text: dialog.textContent?.trim()?.replaceAll(/\\s+/gu, ' ')
            .slice(0, 500) ?? '',
        }))
      const summary = document.querySelector(
        '[aria-label="当前字典类型摘要"]',
      )
      return {
        dictionaryPermissions: [...(account?.permissions ?? [])]
          .filter(permission => permission.startsWith('dictionaries:'))
          .sort(),
        dialogs,
        hash: location.hash,
        summary: summary?.textContent?.trim()?.replaceAll(/\\s+/gu, ' ')
          .slice(0, 300) ?? null,
      }
    })()`)
    throw new Error(
      `Dictionary type create UI did not settle: ${JSON.stringify(diagnostic)}`,
      { cause: error },
    )
  }
  await selectDictionaryTypeByCode(page, typeCode)
  await page.waitFor(`(() => {
    const title = document.querySelector('#dictionary-item-panel-title')
    const code = title?.parentElement?.querySelector('code')
    const summary = document.querySelector('[aria-label="当前字典类型摘要"]')
    return title?.textContent?.trim() === ${JSON.stringify(typeInitialName)}
      && code?.textContent?.trim() === ${JSON.stringify(typeCode)}
      && summary?.textContent?.includes('v1')
  })()`)
}

async function createItemThroughUi(page, value, label, sortOrder) {
  await clickScopedButton(page, '[data-testid="dictionary-item-table"]', '新增条目')
  await waitForVisibleDialog(page, '新增字典条目')
  await waitForDialogControlValue(
    page,
    '新增字典条目',
    '所属类型',
    `${typeInitialName} · ${typeCode}`,
  )
  await waitForVisibleDialogGeometry(page, '新增字典条目')
  await page.waitFor(visibleDialogExpression('新增字典条目', `
    const buttons = [...dialog.querySelectorAll('button')]
      .filter(button => ['取消', '创建条目'].includes(button.textContent?.trim()))
    return buttons.length === 2 && buttons.every(button => {
      const height = button.getBoundingClientRect().height
      return height >= 35 && height <= 37
    })
  `))
  await fillDialogControl(page, '新增字典条目', '条目值', value)
  await fillDialogControl(page, '新增字典条目', '条目标签', label)
  await fillDialogControl(page, '新增字典条目', '排序', String(sortOrder))
  await clickDialogButton(page, '新增字典条目', '创建条目')
  await waitForNoVisibleDialog(page, '新增字典条目')
  await waitForItemAction(page, value, '启用')
}

async function changeItemStatusThroughUi(page, value, action) {
  const verb = action === 'enable' ? '启用' : '停用'
  const title = `确认${verb}字典条目`
  await clickItemAction(page, value, verb)
  await waitForVisibleDialog(page, title)
  await clickDialogButton(page, title, `确认${verb}`)
  await waitForNoVisibleDialog(page, title)
  await waitForItemAction(page, value, action === 'enable' ? '停用' : '启用')
}

async function changeTypeStatusThroughUi(page, action) {
  const verb = action === 'enable' ? '启用' : '停用'
  const title = `确认${verb}字典类型`
  await clickScopedButton(
    page,
    '[aria-label="当前字典类型摘要"]',
    `${verb}类型`,
  )
  await waitForVisibleDialog(page, title)
  await clickDialogButton(page, title, `确认${verb}`)
  await waitForNoVisibleDialog(page, title)
  await page.waitFor(`(() => {
    const summary = document.querySelector('[aria-label="当前字典类型摘要"]')
    return [...(summary?.querySelectorAll('button') ?? [])].some(button => (
      button.getClientRects().length > 0
      && button.textContent?.trim() === ${JSON.stringify(
        action === 'enable' ? '停用类型' : '启用类型',
      )}
    ))
  })()`)
}

async function editTypeThroughUi(page) {
  await clickScopedButton(
    page,
    '[aria-label="当前字典类型摘要"]',
    '编辑类型',
  )
  await waitForVisibleDialog(page, '编辑字典类型')
  await waitForDialogControlValue(
    page,
    '编辑字典类型',
    '类型名称',
    typeInitialName,
  )
  await fillDialogControl(page, '编辑字典类型', '类型名称', typeFinalName)
  await clickDialogButton(page, '编辑字典类型', '保存修改')
  await waitForNoVisibleDialog(page, '编辑字典类型')
  await page.waitFor(`document.querySelector('#dictionary-item-panel-title')
    ?.textContent?.trim() === ${JSON.stringify(typeFinalName)}`)
}

async function editPrimaryItemThroughUi(page) {
  await clickItemAction(page, primaryValue, '编辑')
  await waitForVisibleDialog(page, '编辑字典条目')
  await waitForDialogControlValue(
    page,
    '编辑字典条目',
    '条目标签',
    primaryInitialLabel,
  )
  await fillDialogControl(
    page,
    '编辑字典条目',
    '条目标签',
    primaryFinalLabel,
  )
  await clickDialogButton(page, '编辑字典条目', '保存修改')
  await waitForNoVisibleDialog(page, '编辑字典条目')
  await waitForItemTable(page, primaryFinalLabel)
}

function catalogReadExpression(code) {
  return dictionaryCatalogProviderExpression(`
    return provider.get({
      code: ${JSON.stringify(code)},
      signal: new AbortController().signal,
    })
  `)
}

async function subscribeToCatalogInvalidation(page) {
  await page.evaluate(dictionaryCatalogProviderExpression(`
    globalThis.__dictionaryInvalidations = []
    globalThis.__dictionaryUnsubscribe?.()
    globalThis.__dictionaryUnsubscribe = provider.subscribeInvalidation(event => {
      globalThis.__dictionaryInvalidations.push({ code: event.code })
    })
    return true
  `))
}

async function waitForInvalidationCount(page, count) {
  await page.waitFor(`globalThis.__dictionaryInvalidations?.length >= ${count}`)
}

async function openSelectTrigger(page, triggerExpression) {
  await page.waitFor(`(() => {
    const trigger = ${triggerExpression}
    return trigger?.getClientRects().length > 0 && !trigger.disabled
  })()`)
  await page.evaluate(`(() => {
    const trigger = ${triggerExpression}
    if (!trigger) throw new Error('dictionary select trigger unavailable')
    trigger.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => {
    const trigger = ${triggerExpression}
    const contentId = trigger?.getAttribute('aria-controls')
    const content = contentId ? document.getElementById(contentId) : null
    return trigger?.getAttribute('aria-expanded') === 'true'
      && content?.getClientRects().length > 0
  })()`)
  // SelectContent 通过 zoom-in-95 入场。首个可见帧仍缩放为 95%，直接审计会把
  // 声明为 44px 的选项误判成 41.8px。双标签场景会暂停后台页的 rAF，因此用
  // DevTools 轮询最终变换矩阵，避免测试稳定性依赖当前处于前台的标签页。
  await page.waitFor(`(() => {
    const trigger = ${triggerExpression}
    const contentId = trigger?.getAttribute('aria-controls')
    const content = contentId ? document.getElementById(contentId) : null
    if (!content || content.getClientRects().length === 0) return false
    const transform = getComputedStyle(content).transform
    if (transform === 'none') return true
    const matrix = new DOMMatrixReadOnly(transform)
    const scaleX = Math.hypot(matrix.a, matrix.b)
    const scaleY = Math.hypot(matrix.c, matrix.d)
    // 44px 控件的布局审计仅允许 0.001px 数值误差，因此动画缩放误差必须
    // 小于约 1 / 44,000；否则 0.9996 这类尾帧仍会把控件量成 43.98px。
    return Math.abs(scaleX - 1) < 0.00001
      && Math.abs(scaleY - 1) < 0.00001
  })()`)
}

async function closeOpenSelect(page) {
  await pressKey(page, 'Escape')
  await page.waitFor(`![...document.querySelectorAll(
    '[data-slot="select-content"]',
  )].some(content => content.getClientRects().length > 0)`)
}

async function waitForVisibleDialogGeometry(page, title) {
  await page.waitFor(visibleDialogExpression(title, `
    const transform = getComputedStyle(dialog).transform
    if (transform === 'none') return true
    const matrix = new DOMMatrixReadOnly(transform)
    const scaleX = Math.hypot(matrix.a, matrix.b)
    const scaleY = Math.hypot(matrix.c, matrix.d)
    // DialogContent 同样使用 zoom-in-95；44px 审计前必须越过 41.8px 入场帧。
    return Math.abs(scaleX - 1) < 0.00001
      && Math.abs(scaleY - 1) < 0.00001
  `))
}

function assertLayout(layout, { cards, desktopTables, mobile }) {
  assert.equal(layout.workspaceMounted, true)
  assert.equal(layout.modeMatches, true)
  assert.equal(layout.documentFits, true)
  assert.equal(layout.documentWidth <= layout.viewportWidth, true)
  if (cards !== undefined) {
    assert.equal(layout.cards, cards)
  }
  if (desktopTables !== undefined) {
    assert.equal(layout.desktopTables, desktopTables)
  }
  if (mobile) {
    assert.equal(layout.typePanelWidth, null)
    assert.equal(layout.typeCardGeometry, null)
    assert.equal(layout.visiblePanelCount, 2)
    assert.deepEqual(layout.touchTargetViolations, [])
    assert.equal(layout.leftPanelHeightIsolated, null)
    assert.equal(layout.leftPanelRightStackHeightDelta, null)
    assert.equal(layout.leftPanelScrolls, null)
    assert.equal(layout.leftPanelWorkspaceHeightDelta, null)
  }
  else {
    assert.equal(typeof layout.typePanelWidth, 'number')
    // 1280px 桌面视口下左栏采用 22rem（352px），只容忍浏览器亚像素舍入。
    assert.equal(layout.typePanelWidth >= 350, true)
    assert.equal(layout.typePanelWidth <= 354, true)
    assert.equal(typeof layout.typeCardGeometry, 'object')
    assert.equal(layout.typeCardGeometry.metaLeft > layout.typeCardGeometry.identityRight, true)
    assert.equal(layout.typeCardGeometry.horizontalGap >= 8, true)
    assert.equal(layout.typeCardGeometry.rightInset >= 10, true)
    assert.equal(layout.typeCardGeometry.rightInset <= 16, true)
    assert.equal(layout.typeCardGeometry.overlaps, false)
    assert.equal(layout.visiblePanelCount, 3)
    assert.equal(layout.horizontalPanelGap >= 12, true)
    assert.equal(layout.horizontalPanelGap <= 24, true)
    assert.equal(layout.leftPanelHeightIsolated, true)
    assert.equal(layout.leftPanelWorkspaceHeightDelta <= 1, true)
    assert.equal(layout.leftPanelRightStackHeightDelta <= 1, true)
    assert.equal(layout.leftPanelScrolls, true)
  }
  assert.equal(layout.verticalPanelGap >= 12, true)
  assert.equal(layout.verticalPanelGap <= 24, true)
  assert.equal(layout.rightPanelsAligned, true)
  assert.equal(layout.panelsFitWorkspace, true)
}

async function auditMobileLayout(page) {
  const layout = await page.evaluate(
    dictionaryLayoutAuditExpression({ mobile: true }),
  )
  assertLayout(layout, { cards: 2, desktopTables: 0, mobile: true })
  return layout
}

async function prepareLimitedIdentities(page, configuration) {
  const permissionsResponse = await page.evaluate(apiExpression('/api/permissions'))
  assert.equal(permissionsResponse.status, 200)
  const dictionaryPermissions = permissionsResponse.body
    ?.filter(permission => permission.code.startsWith('dictionaries:'))
    .map(permission => [permission.code, permission.id, permission.name])
    .sort((left, right) => left[0].localeCompare(right[0]))
  assert.deepEqual(
    dictionaryPermissions?.map(([code]) => code),
    [
      'dictionaries:create',
      'dictionaries:disable',
      'dictionaries:enable',
      'dictionaries:read',
      'dictionaries:update',
    ],
  )
  assert.equal(
    dictionaryPermissions?.every(([, id, name]) => (
      typeof id === 'string'
      && typeof name === 'string'
      && name.includes('系统字典')
    )),
    true,
  )
  const readPermissionId = dictionaryPermissions
    ?.find(([code]) => code === 'dictionaries:read')?.[1]
  assert.equal(typeof readPermissionId, 'string')

  const readonlyRole = await page.evaluate(apiExpression('/api/roles', 'POST', {
    code: 'browser_dictionary_readonly',
    description: 'Browser dictionary read-only role',
    name: 'Browser Dictionary Read-only',
  }))
  assert.equal(readonlyRole.status, 201)
  const rolePermissions = await page.evaluate(apiExpression(
    `/api/roles/${encodeURIComponent(readonlyRole.body.id)}/permissions`,
    'PUT',
    { permissionIds: [readPermissionId] },
  ))
  assert.equal(rolePermissions.status, 200)

  const readonlyUser = await page.evaluate(apiExpression('/api/users', 'POST', {
    displayName: 'Browser Dictionary Read-only',
    mustChangePassword: false,
    password: configuration.limitedPassword,
    username: 'browser_dictionary_readonly',
  }))
  assert.equal(readonlyUser.status, 201)
  const readonlyAssignment = await page.evaluate(apiExpression(
    `/api/users/${encodeURIComponent(readonlyUser.body.id)}/roles`,
    'PUT',
    { roleIds: [readonlyRole.body.id] },
  ))
  assert.equal(readonlyAssignment.status, 200)

  const noPermissionUser = await page.evaluate(apiExpression('/api/users', 'POST', {
    displayName: 'Browser Dictionary No Permission',
    mustChangePassword: false,
    password: configuration.limitedPassword,
    username: 'browser_dictionary_none',
  }))
  assert.equal(noPermissionUser.status, 201)

  return {
    noPermission: {
      password: configuration.limitedPassword,
      username: noPermissionUser.body.username,
    },
    readonly: {
      password: configuration.limitedPassword,
      username: readonlyUser.body.username,
    },
  }
}

test('真实 Chrome 覆盖系统字典生命周期、双标签失效、权限与响应式无障碍', {
  timeout: 480_000,
}, async (t) => {
  const configuration = readDictionaryBrowserConfiguration(process.env)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-dictionaries-admin`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  const peer = await browser.newPage()
  const runtime = collectDictionaryRuntimeErrors(page, {
    sensitiveValues: [configuration.password, configuration.limitedPassword],
  })
  const peerRuntime = collectDictionaryRuntimeErrors(peer, {
    sensitiveValues: [configuration.password, configuration.limitedPassword],
  })
  // 首次登录、路由注册和空态 Type 请求同样属于被测生命周期，collector 必须在
  // 第一次 navigate 前订阅，避免只捕获已有字典后的重载错误。
  runtime.start()
  peerRuntime.start()
  await Promise.all([
    page.addScriptOnNewDocument(installDictionaryBroadcastProbeScript()),
    peer.addScriptOnNewDocument(installDictionaryBroadcastProbeScript()),
  ])
  await page.setViewport(1280, 800, false)
  await peer.setViewport(1280, 800, false)
  // `/json/new` 会把最后创建的 peer 设为活动标签页。主页面承担真实 UI 与动画
  // 审计，显式前置可避免 Chromium 对后台页 CSS 动画的节流干扰几何测量。
  await page.bringToFront()

  await runDictionaryBrowserStep('admin login route', () =>
    page.navigate(appRouteUrl(configuration.baseUrl, '/login')))
  await runDictionaryBrowserStep('admin real login', () =>
    loginThroughRealHttp(page, configuration))
  await runDictionaryBrowserStep('admin management route', () =>
    page.navigate(appRouteUrl(configuration.baseUrl, managementRoute)))
  await runDictionaryBrowserStep('admin workspace ready', async () => {
    await waitForAfterAuthentication(page, `document.querySelector(
      '[data-testid="dictionary-management-workspace"]',
    ) !== null`)
    await waitForDictionaryWorkspace(page)
  })

  const dictionaryRequests = []
  const removeRequestListener = page.on(
    'Network.requestWillBeSent',
    (event) => {
      const pathname = requestPathname(event)
      if (
        pathname.startsWith('/api/dictionary-types')
        || pathname.startsWith('/api/dictionary-catalog')
      ) {
        dictionaryRequests.push({
          method: event.request?.method ?? '',
          pathname,
        })
      }
    },
  )
  t.after(() => removeRequestListener())

  const limitedIdentities = await runDictionaryBrowserStep(
    'prepare independent permission identities',
    () => prepareLimitedIdentities(page, configuration),
  )

  await runDictionaryBrowserStep('create dictionary type through UI', () =>
    createTypeThroughUi(page))
  await runDictionaryBrowserStep('create primary item through UI', () =>
    createItemThroughUi(page, primaryValue, primaryInitialLabel, 10))
  await runDictionaryBrowserStep('create secondary item through UI', () =>
    createItemThroughUi(page, secondaryValue, secondaryLabel, 20))
  await waitForItemTable(page, secondaryValue)

  const desktopLayout = await page.evaluate(
    dictionaryLayoutAuditExpression({ mobile: false }),
  )
  assertLayout(desktopLayout, {
    cards: 0,
    desktopTables: 1,
    mobile: false,
  })

  await runDictionaryBrowserStep('enable primary item', () =>
    changeItemStatusThroughUi(page, primaryValue, 'enable'))
  await runDictionaryBrowserStep('enable secondary item', () =>
    changeItemStatusThroughUi(page, secondaryValue, 'enable'))
  await runDictionaryBrowserStep('enable dictionary type', () =>
    changeTypeStatusThroughUi(page, 'enable'))

  await runDictionaryBrowserStep('desktop compact action heights', async () => {
    const heights = await page.evaluate(`(() => {
      const visibleButton = (text, root = document) =>
        [...root.querySelectorAll('button')].find(button => (
          button.getClientRects().length > 0
          && button.textContent?.trim() === text
        ))
      const summary = document.querySelector('[aria-label="当前字典类型摘要"]')
      const itemEdit = [...document.querySelectorAll('button')].find(button =>
        button.getAttribute('aria-label') === ${JSON.stringify(`编辑条目 ${primaryValue}`)})
      return {
        createType: visibleButton('新增类型')?.getBoundingClientRect().height,
        editType: visibleButton('编辑类型', summary)?.getBoundingClientRect().height,
        itemEdit: itemEdit?.getBoundingClientRect().height,
      }
    })()`)
    assert.equal(heights.createType >= 35 && heights.createType <= 37, true)
    assert.equal(heights.editType >= 35 && heights.editType <= 37, true)
    assert.equal(heights.itemEdit >= 31 && heights.itemEdit <= 33, true)
  })

  await runDictionaryBrowserStep('peer real admin session', async () => {
    await peer.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(peer, configuration)
    await peer.navigate(appRouteUrl(configuration.baseUrl, '/'))
    await waitForAfterAuthentication(peer, authStoreExpression(
      'return store.authState === \'authenticated\'',
    ))
  })
  await Promise.all([
    subscribeToCatalogInvalidation(page),
    subscribeToCatalogInvalidation(peer),
  ])
  const primedCatalogs = await Promise.all([
    page.evaluate(catalogReadExpression(typeCode)),
    peer.evaluate(catalogReadExpression(typeCode)),
  ])
  for (const catalog of primedCatalogs) {
    assert.equal(catalog?.code, typeCode)
    assert.equal(catalog?.name, typeInitialName)
    assert.equal(catalog?.enabled, true)
    assert.deepEqual(
      catalog?.items.map(item => ({
        effectiveEnabled: item.effectiveEnabled,
        enabled: item.enabled,
        value: item.value,
      })),
      [
        { effectiveEnabled: true, enabled: true, value: primaryValue },
        { effectiveEnabled: true, enabled: true, value: secondaryValue },
      ],
    )
  }

  const beforeTypeUpdate = await Promise.all([
    page.evaluate(`(() => ({
      broadcasts: globalThis.__dictionaryBroadcastPayloads.length,
      invalidations: globalThis.__dictionaryInvalidations.length,
    }))()`),
    peer.evaluate(`(() => ({
      broadcasts: globalThis.__dictionaryBroadcastPayloads.length,
      invalidations: globalThis.__dictionaryInvalidations.length,
    }))()`),
  ])
  await runDictionaryBrowserStep('update type and invalidate both tabs', () =>
    editTypeThroughUi(page))
  await Promise.all([
    waitForInvalidationCount(page, beforeTypeUpdate[0].invalidations + 1),
    waitForInvalidationCount(peer, beforeTypeUpdate[1].invalidations + 1),
  ])
  const typeUpdateSignals = await Promise.all([
    page.evaluate(`(() => ({
      broadcasts: globalThis.__dictionaryBroadcastPayloads.slice(${
        beforeTypeUpdate[0].broadcasts
      }),
      invalidations: globalThis.__dictionaryInvalidations.slice(${
        beforeTypeUpdate[0].invalidations
      }),
    }))()`),
    peer.evaluate(`(() => ({
      broadcasts: globalThis.__dictionaryBroadcastPayloads.slice(${
        beforeTypeUpdate[1].broadcasts
      }),
      invalidations: globalThis.__dictionaryInvalidations.slice(${
        beforeTypeUpdate[1].invalidations
      }),
    }))()`),
  ])
  assert.deepEqual(typeUpdateSignals, [
    {
      broadcasts: [{ code: typeCode, type: 'DICTIONARY_CATALOG_CHANGED' }],
      invalidations: [{ code: typeCode }],
    },
    { broadcasts: [], invalidations: [{ code: typeCode }] },
  ])
  const catalogsAfterTypeUpdate = await Promise.all([
    page.evaluate(catalogReadExpression(typeCode)),
    peer.evaluate(catalogReadExpression(typeCode)),
  ])
  assert.deepEqual(
    catalogsAfterTypeUpdate.map(catalog => catalog?.name),
    [typeFinalName, typeFinalName],
  )

  const beforeItemUpdate = await Promise.all([
    page.evaluate(`(() => ({
      broadcasts: globalThis.__dictionaryBroadcastPayloads.length,
      invalidations: globalThis.__dictionaryInvalidations.length,
    }))()`),
    peer.evaluate(`(() => ({
      broadcasts: globalThis.__dictionaryBroadcastPayloads.length,
      invalidations: globalThis.__dictionaryInvalidations.length,
    }))()`),
  ])
  await runDictionaryBrowserStep('update primary item and invalidate both tabs', () =>
    editPrimaryItemThroughUi(page))
  await Promise.all([
    waitForInvalidationCount(page, beforeItemUpdate[0].invalidations + 1),
    waitForInvalidationCount(peer, beforeItemUpdate[1].invalidations + 1),
  ])
  const itemUpdateSignals = await Promise.all([
    page.evaluate(`(() => ({
      broadcasts: globalThis.__dictionaryBroadcastPayloads.slice(${
        beforeItemUpdate[0].broadcasts
      }),
      invalidations: globalThis.__dictionaryInvalidations.slice(${
        beforeItemUpdate[0].invalidations
      }),
    }))()`),
    peer.evaluate(`(() => ({
      broadcasts: globalThis.__dictionaryBroadcastPayloads.slice(${
        beforeItemUpdate[1].broadcasts
      }),
      invalidations: globalThis.__dictionaryInvalidations.slice(${
        beforeItemUpdate[1].invalidations
      }),
    }))()`),
  ])
  assert.deepEqual(itemUpdateSignals, [
    {
      broadcasts: [{ code: typeCode, type: 'DICTIONARY_CATALOG_CHANGED' }],
      invalidations: [{ code: typeCode }],
    },
    { broadcasts: [], invalidations: [{ code: typeCode }] },
  ])
  const catalogsAfterItemUpdate = await Promise.all([
    page.evaluate(catalogReadExpression(typeCode)),
    peer.evaluate(catalogReadExpression(typeCode)),
  ])
  assert.deepEqual(
    catalogsAfterItemUpdate.map(catalog =>
      catalog?.items.find(item => item.value === primaryValue)?.label),
    [primaryFinalLabel, primaryFinalLabel],
  )

  await runDictionaryBrowserStep('client read-only visibility', async () => {
    const permissions = await page.evaluate(
      patchPermissionsExpression(['dictionaries:read']),
    )
    assert.deepEqual(permissions, ['dictionaries:read'])
    await page.waitFor(`(() => {
      const summary = document.querySelector('[aria-label="当前字典类型摘要"]')
      const table = document.querySelector('[data-testid="dictionary-item-table"]')
      const visibleButtons = [...document.querySelectorAll('button')]
        .filter(button => button.getClientRects().length > 0)
        .map(button => button.textContent?.trim())
      return !visibleButtons.includes('新增类型')
        && !visibleButtons.includes('新增条目')
        && !visibleButtons.includes('编辑类型')
        && !visibleButtons.includes('停用类型')
        && summary?.textContent?.includes('仅查看')
        && table?.textContent?.includes('仅查看')
    })()`)
    await page.evaluate(restorePermissionsExpression())
    await page.waitFor(`(() => {
      const texts = [...document.querySelectorAll('button')]
        .filter(button => button.getClientRects().length > 0)
        .map(button => button.textContent?.trim())
      return texts.includes('新增类型')
        && texts.includes('新增条目')
        && texts.includes('编辑类型')
        && texts.includes('停用类型')
    })()`)
  })

  await runDictionaryBrowserStep('390x844 mobile cards', async () => {
    await page.setViewport(390, 844, true)
    /*
     * CDP 动态设备指标不会稳定派发 MediaQueryList change；按真实移动端首次加载
     * 重新进入路由，使 QsGenericTable 在 390px 真相源下建立响应式状态。
     */
    await remountDictionaryWorkspace(
      page,
      configuration.baseUrl,
      secondaryValue,
    )
    try {
      await page.waitFor(`(() => (
        document.documentElement.clientWidth === 390
        && document.querySelectorAll(
          '[data-testid="dictionary-item-card"]',
        ).length === 2
        && ![...document.querySelectorAll(
          '[data-testid="dictionary-item-table"] table',
        )].some(table => table.getClientRects().length > 0)
      ))()`)
    }
    catch (error) {
      const diagnostic = await page.evaluate(`(() => {
        const cards = [...document.querySelectorAll(
          '[data-testid="dictionary-item-card"]',
        )]
        const tables = [...document.querySelectorAll(
          '[data-testid="dictionary-item-table"] table',
        )]
        return {
          cardCount: cards.length,
          cardTexts: cards.map(card => card.textContent?.trim()
            ?.replaceAll(/\\s+/gu, ' ').slice(0, 160) ?? ''),
          clientWidth: document.documentElement.clientWidth,
          innerWidth: window.innerWidth,
          mobileMediaMatches: matchMedia('(max-width: 767px)').matches,
          tableCount: tables.length,
          visibleCardCount: cards.filter(card =>
            card.getClientRects().length > 0).length,
          visibleTableCount: tables.filter(table =>
            table.getClientRects().length > 0).length,
        }
      })()`)
      throw new Error(
        `Dictionary mobile layout did not settle: ${JSON.stringify(diagnostic)}`,
        { cause: error },
      )
    }
    await auditMobileLayout(page)
  })

  const lightTheme = await page.evaluate(`(() => {
    const card = [...document.querySelectorAll(
      '[data-testid="dictionary-item-card"]',
    )].find(candidate => candidate.textContent?.includes(${JSON.stringify(primaryValue)}))
    const surface = card?.parentElement
    const style = surface ? getComputedStyle(surface) : null
    return {
      background: style?.backgroundColor ?? '',
      color: style?.color ?? '',
      hasStatusText: card?.textContent?.includes('自身状态')
        && card.textContent.includes('有效状态'),
    }
  })()`)
  await page.evaluate(`(() => {
    const app = document.querySelector('#app')?.__vue_app__
    app?.config?.globalProperties?.$pinia?._s
      ?.get('appSettings')?.setColorScheme('dark')
    return true
  })()`)
  await page.waitFor(`document.documentElement.classList.contains('dark')`)
  const darkTheme = await page.evaluate(`(() => {
    const card = [...document.querySelectorAll(
      '[data-testid="dictionary-item-card"]',
    )].find(candidate => candidate.textContent?.includes(${JSON.stringify(primaryValue)}))
    const surface = card?.parentElement
    const style = surface ? getComputedStyle(surface) : null
    return {
      background: style?.backgroundColor ?? '',
      color: style?.color ?? '',
      hasStatusText: card?.textContent?.includes('自身状态')
        && card.textContent.includes('有效状态'),
    }
  })()`)
  assert.equal(lightTheme.hasStatusText, true)
  assert.equal(darkTheme.hasStatusText, true)
  assert.notEqual(darkTheme.background, lightTheme.background)
  assert.notEqual(darkTheme.color, lightTheme.color)

  await runDictionaryBrowserStep('type drawer focus and 44px controls', async () => {
    await page.evaluate(`(() => {
      const trigger = document.querySelector(
        '[data-testid="dictionary-open-type-drawer"]',
      )
      if (!trigger) throw new Error('dictionary type drawer trigger unavailable')
      trigger.focus({ preventScroll: true })
      trigger.click()
      return true
    })()`)
    await waitForVisibleDialog(page, '选择字典类型')
    const typeCardStress = await page.evaluate(
      dictionaryTypeCardStressAuditExpression(),
    )
    assert.equal(typeCardStress.documentFits, true)
    assert.equal(typeCardStress.cardFitsDrawer, true)
    assert.equal(typeCardStress.cardContentFits, true)
    assert.equal(typeCardStress.identityContentFits, true)
    assert.equal(typeCardStress.metaFitsCard, true)
    assert.equal(typeCardStress.horizontalGap >= 8, true)
    assert.equal(typeCardStress.overlaps, false)
    assert.equal(typeCardStress.countText, '123')
    assert.equal(typeCardStress.countFits, true)
    await auditMobileLayout(page)
    await openSelectTrigger(page, `(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择字典类型'))
      return [...(dialog?.querySelectorAll('label') ?? [])]
        .find(label => label.textContent?.includes('筛选字典类型状态'))
        ?.querySelector('[role="combobox"]')
    })()`)
    await auditMobileLayout(page)
    await closeOpenSelect(page)
    await pressKey(page, 'Escape')
    await waitForNoVisibleDialog(page, '选择字典类型')
    await page.waitFor(`(() => {
      const trigger = document.querySelector(
        '[data-testid="dictionary-open-type-drawer"]',
      )
      return document.activeElement === trigger
        && trigger?.getAttribute('aria-expanded') === 'false'
    })()`)
  })

  await runDictionaryBrowserStep('filter drawer and teleported options', async () => {
    await clickScopedButton(page, '[data-testid="dictionary-item-table"]', '筛选')
    await waitForVisibleDialog(page, '筛选数据')
    await openSelectTrigger(page, `(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('筛选数据'))
      return [...(dialog?.querySelectorAll('label') ?? [])]
        .find(label => label.textContent?.includes('自身状态'))
        ?.querySelector('[role="combobox"]')
    })()`)
    await auditMobileLayout(page)
    await closeOpenSelect(page)
    await clickDialogButton(page, '筛选数据', '重置')
    await waitForNoVisibleDialog(page, '筛选数据')
  })

  await runDictionaryBrowserStep('column drawer checkbox labels and controls', async () => {
    await clickScopedButton(page, '[data-testid="dictionary-item-table"]', '列设置')
    await waitForVisibleDialog(page, '列设置')
    await auditMobileLayout(page)
    await pressKey(page, 'Escape')
    await waitForNoVisibleDialog(page, '列设置')
  })

  await runDictionaryBrowserStep('pagination teleported options', async () => {
    await openSelectTrigger(page, `document.querySelector(
      '[data-testid="dictionary-item-table"] [data-slot="pagination"] [role="combobox"]',
    )`)
    await auditMobileLayout(page)
    await closeOpenSelect(page)
  })

  await runDictionaryBrowserStep('mobile modal focus and 44px footer', async () => {
    await clickItemAction(page, primaryValue, '编辑')
    await waitForVisibleDialog(page, '编辑字典条目')
    await waitForDialogControlValue(
      page,
      '编辑字典条目',
      '条目标签',
      primaryFinalLabel,
    )
    await waitForDialogControlValue(
      page,
      '编辑字典条目',
      '所属类型',
      `${typeFinalName} · ${typeCode}`,
    )
    await waitForVisibleDialogGeometry(page, '编辑字典条目')
    await page.waitFor(visibleDialogExpression('编辑字典条目', `
      const buttons = [...dialog.querySelectorAll('button')]
        .filter(button => ['取消', '保存修改'].includes(button.textContent?.trim()))
      return buttons.length === 2 && buttons.every(button => {
        const rect = button.getBoundingClientRect()
        return rect.width + 0.001 >= 44 && rect.height + 0.001 >= 44
      })
    `))
    await openSelectTrigger(page, `(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('编辑字典条目'))
      const label = [...(dialog?.querySelectorAll('label') ?? [])]
        .find(label => label.textContent?.includes('语义色调'))
      // FaSelect 的 injected id 落在无 DOM 的 SelectRoot 上；以 FaFormItem
      // 作为可访问 label 与可见 trigger 的稳定共同边界。
      return label?.closest('[data-slot="form-item"]')
        ?.querySelector('[role="combobox"]')
    })()`)
    await auditMobileLayout(page)
    await closeOpenSelect(page)
    await clickDialogButton(page, '编辑字典条目', '取消')
    await waitForNoVisibleDialog(page, '编辑字典条目')
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')
      === ${JSON.stringify(`编辑条目 ${primaryValue}`)}`)
  })

  await runDictionaryBrowserStep('mobile type modal controls and focus', async () => {
    await clickScopedButton(
      page,
      '[aria-label="当前字典类型摘要"]',
      '编辑类型',
    )
    await waitForVisibleDialog(page, '编辑字典类型')
    await waitForDialogControlValue(
      page,
      '编辑字典类型',
      '类型名称',
      typeFinalName,
    )
    await waitForVisibleDialogGeometry(page, '编辑字典类型')
    await auditMobileLayout(page)
    await clickDialogButton(page, '编辑字典类型', '取消')
    await waitForNoVisibleDialog(page, '编辑字典类型')
    await page.waitFor(`(() => {
      const summary = document.querySelector('[aria-label="当前字典类型摘要"]')
      return document.activeElement?.textContent?.trim() === '编辑类型'
        && summary?.contains(document.activeElement)
    })()`)
  })

  await runDictionaryBrowserStep('mobile status modal focus and 44px footer', async () => {
    await clickItemAction(page, primaryValue, '停用')
    await waitForVisibleDialog(page, '确认停用字典条目')
    await waitForVisibleDialogGeometry(page, '确认停用字典条目')
    await auditMobileLayout(page)
    await clickDialogButton(page, '确认停用字典条目', '取消')
    await waitForNoVisibleDialog(page, '确认停用字典条目')
    await page.waitFor(`document.activeElement?.getAttribute('aria-label')
      === ${JSON.stringify(`停用条目 ${primaryValue}`)}`)
  })

  await page.evaluate(`(() => {
    const app = document.querySelector('#app')?.__vue_app__
    app?.config?.globalProperties?.$pinia?._s
      ?.get('appSettings')?.setColorScheme('light')
    return true
  })()`)
  await page.waitFor(`!document.documentElement.classList.contains('dark')`)
  await page.setViewport(1280, 800, false)
  await remountDictionaryWorkspace(
    page,
    configuration.baseUrl,
    secondaryValue,
  )
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-item-table"] table',
  )?.getClientRects().length > 0`)

  await runDictionaryBrowserStep('disable secondary while primary remains enabled', () =>
    changeItemStatusThroughUi(page, secondaryValue, 'disable'))
  await runDictionaryBrowserStep('blocked action stays inside table column', async () => {
    await page.waitFor(`(() => {
      const table = document.querySelector('[data-testid="dictionary-item-table"]')
      const blocked = [...(table?.querySelectorAll('[role="status"]') ?? [])]
        .find(node => node.textContent?.includes('暂不可停用'))
      const cell = blocked?.closest('[data-slot="table-cell"]')
      const container = table?.querySelector('[data-slot="table-container"]')
      if (!blocked || !cell || !container) return false
      const cellRect = cell.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()
      return blocked.scrollWidth <= blocked.clientWidth + 1
        && cell.scrollWidth <= cell.clientWidth + 1
        && cellRect.right <= containerRect.right + 1
    })()`)
  })
  await runDictionaryBrowserStep('disable dictionary type', () =>
    changeTypeStatusThroughUi(page, 'disable'))

  const typeResponse = await page.evaluate(apiExpression(
    `/api/dictionary-types?query=${encodeURIComponent(typeCode)}&page=1&pageSize=20&sortBy=sortOrder&sortOrder=asc`,
  ))
  assert.equal(typeResponse.status, 200)
  assert.equal(typeResponse.body?.total, 1)
  const dictionaryType = typeResponse.body?.items?.[0]
  assert.deepEqual(
    {
      code: dictionaryType?.code,
      description: dictionaryType?.description,
      enabled: dictionaryType?.enabled,
      name: dictionaryType?.name,
      sortOrder: dictionaryType?.sortOrder,
      version: dictionaryType?.version,
    },
    {
      code: typeCode,
      description: null,
      enabled: false,
      name: typeFinalName,
      sortOrder: 9100,
      version: 4,
    },
  )
  const itemsResponse = await page.evaluate(apiExpression(
    `/api/dictionary-types/${encodeURIComponent(dictionaryType.id)}/items?page=1&pageSize=20&sortBy=sortOrder&sortOrder=asc`,
  ))
  assert.equal(itemsResponse.status, 200)
  assert.deepEqual(
    itemsResponse.body?.items?.map(item => ({
      description: item.description,
      effectiveEnabled: item.effectiveEnabled,
      enabled: item.enabled,
      label: item.label,
      sortOrder: item.sortOrder,
      tone: item.tone,
      value: item.value,
      version: item.version,
    })),
    [
      {
        description: null,
        effectiveEnabled: false,
        enabled: true,
        label: primaryFinalLabel,
        sortOrder: 10,
        tone: 'DEFAULT',
        value: primaryValue,
        version: 3,
      },
      {
        description: null,
        effectiveEnabled: false,
        enabled: false,
        label: secondaryLabel,
        sortOrder: 20,
        tone: 'DEFAULT',
        value: secondaryValue,
        version: 3,
      },
    ],
  )
  const finalCatalog = await page.evaluate(
    apiExpression(`/api/dictionary-catalog/${encodeURIComponent(typeCode)}`),
  )
  assert.equal(finalCatalog.status, 200)
  assert.equal(finalCatalog.cacheControl, 'private, no-store')
  assert.equal(finalCatalog.body?.enabled, false)
  assert.deepEqual(
    finalCatalog.body?.items?.map(item => [
      item.value,
      item.enabled,
      item.effectiveEnabled,
    ]),
    [
      [primaryValue, true, false],
      [secondaryValue, false, false],
    ],
  )

  const auditResponse = await page.evaluate(
    apiExpression('/api/audit-events?page=1&pageSize=100'),
  )
  assert.equal(auditResponse.status, 200)
  const dictionaryAuditTypes = auditResponse.body?.items
    ?.filter(event => [
      dictionaryType.id,
      ...itemsResponse.body.items.map(item => item.id),
    ].includes(event.targetId))
    .map(event => event.eventType)
  assert.deepEqual(dictionaryAuditTypes?.sort(), [
    'DICTIONARY_ITEM_CREATED',
    'DICTIONARY_ITEM_CREATED',
    'DICTIONARY_ITEM_DISABLED',
    'DICTIONARY_ITEM_ENABLED',
    'DICTIONARY_ITEM_ENABLED',
    'DICTIONARY_ITEM_UPDATED',
    'DICTIONARY_TYPE_CREATED',
    'DICTIONARY_TYPE_DISABLED',
    'DICTIONARY_TYPE_ENABLED',
    'DICTIONARY_TYPE_UPDATED',
  ].sort())
  assert.equal(
    dictionaryRequests.some(request => request.method === 'DELETE'),
    false,
  )

  peerRuntime.stop()
  assert.deepEqual(peerRuntime.issues, [])

  const runLimitedSession = async ({ credentials, profile, readonly }) => {
    const limitedBrowser = await launchChrome({
      executable: configuration.chromeExecutable,
      userDataDirectory: `${configuration.profileDirectory}-${profile}`,
    })
    t.after(async () => limitedBrowser.close())
    const limitedPage = await limitedBrowser.newPage()
    const limitedRuntime = collectDictionaryRuntimeErrors(limitedPage, {
      sensitiveValues: [credentials.password],
    })
    limitedRuntime.start()
    await limitedPage.setViewport(1280, 800, false)
    await limitedPage.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(limitedPage, credentials)
    await limitedPage.navigate(appRouteUrl(configuration.baseUrl, '/'))
    await waitForAfterAuthentication(limitedPage, authStoreExpression(
      'return store.authState === \'authenticated\'',
    ))
    const catalog = await limitedPage.evaluate(
      apiExpression(`/api/dictionary-catalog/${encodeURIComponent(typeCode)}`),
    )
    assert.equal(catalog.status, 200)
    assert.equal(catalog.cacheControl, 'private, no-store')
    const management = await limitedPage.evaluate(
      apiExpression('/api/dictionary-types?page=1&pageSize=20'),
    )

    await limitedPage.navigate(appRouteUrl(
      configuration.baseUrl,
      managementRoute,
    ))
    if (readonly) {
      assert.equal(management.status, 200)
      await waitForAfterAuthentication(limitedPage, `document.querySelector(
        '[data-testid="dictionary-management-workspace"]',
      ) !== null`)
      await waitForDictionaryWorkspace(limitedPage)
      await selectDictionaryTypeByCode(limitedPage, typeCode)
      await waitForItemTable(limitedPage, primaryValue)
      const surface = await limitedPage.evaluate(`(() => {
        const visibleButtons = [...document.querySelectorAll('button')]
          .filter(button => button.getClientRects().length > 0)
          .map(button => button.textContent?.trim())
        return {
          hasCreate: visibleButtons.includes('新增类型')
            || visibleButtons.includes('新增条目'),
          hasMutations: visibleButtons.some(text => [
            '编辑类型', '启用类型', '停用类型', '编辑', '启用', '停用',
          ].includes(text)),
          readonlyText: document.querySelector(
            '[data-testid="dictionary-item-table"]',
          )?.textContent?.includes('仅查看'),
        }
      })()`)
      assert.deepEqual(surface, {
        hasCreate: false,
        hasMutations: false,
        readonlyText: true,
      })
      const forbiddenMutation = await limitedPage.evaluate(apiExpression(
        '/api/dictionary-types',
        'POST',
        { code: 'blocked.dictionary', name: '禁止创建', sortOrder: 1 },
      ))
      assert.equal(forbiddenMutation.status, 403)
      assert.equal(forbiddenMutation.body?.code, 'FORBIDDEN')

      /*
       * 动态撤权直接推动正式 AuthContext；Router 应进入统一 403，页面 watch 同时
       * 关闭正在打开的受保护 Drawer、清空 DTO 并卸载 workspace，不能只隐藏写按钮。
      */
      await limitedPage.setViewport(390, 844, true)
      await remountDictionaryWorkspace(
        limitedPage,
        configuration.baseUrl,
        primaryValue,
      )
      await clickVisibleExactButton(limitedPage, '选择类型')
      await waitForVisibleDialog(limitedPage, '选择字典类型')
      assert.equal(await limitedPage.evaluate(`(() => (
        [...document.querySelectorAll('[role="dialog"]')].some(dialog => (
          dialog.getClientRects().length > 0
          && dialog.textContent?.includes('选择字典类型')
        ))
      ))()`), true)
      await limitedPage.evaluate(patchPermissionsExpression([]))
      await limitedPage.waitFor(`(() => (
        document.body.innerText.includes('403')
        && document.body.innerText.includes('无权访问该页面')
        && ![...document.querySelectorAll('[role="dialog"]')].some(dialog => (
          dialog.getClientRects().length > 0
          && dialog.textContent?.includes('选择字典类型')
        ))
        && document.querySelector(
          '[data-testid="dictionary-management-workspace"]',
        ) === null
      ))()`)
    }
    else {
      assert.equal(management.status, 403)
      assert.equal(management.body?.code, 'FORBIDDEN')
      await limitedPage.waitFor(`(() => (
        location.hash === '#/system/basic-data/dictionaries'
        && document.body.innerText.includes('403')
        && document.body.innerText.includes('无权访问该页面')
        && document.querySelector(
          '[data-testid="dictionary-management-workspace"]',
        ) === null
      ))()`)
    }

    limitedRuntime.stop()
    assert.deepEqual(limitedRuntime.issues, [])
  }

  await runDictionaryBrowserStep('independent read-only identity', () =>
    runLimitedSession({
      credentials: limitedIdentities.readonly,
      profile: 'dictionaries-readonly',
      readonly: true,
    }))
  await runDictionaryBrowserStep('independent no-permission identity', () =>
    runLimitedSession({
      credentials: limitedIdentities.noPermission,
      profile: 'dictionaries-none',
      readonly: false,
    }))

  runtime.stop()
  assert.deepEqual(runtime.issues, [])
})

test('真实 Chrome 覆盖字典选择器搜索、重复 Label、清空与错误恢复', {
  timeout: 120_000,
}, async (t) => {
  const { dictionaryRequests, page } = await openDictionarySelectBrowserSession(
    t,
    'interaction',
  )

  const initialUpdateCount = await page.evaluate(`Number(
    document.querySelector(
      '[data-testid="dictionary-select-standard-update-count"]',
    )?.textContent,
  )`)
  assert.equal(initialUpdateCount, 0)

  await setDictionaryComboboxSearch(
    page,
    'dictionary-select-standard',
    'WAIT',
  )
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-standard')}
    const content = input?.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null
    return content?.textContent?.includes('待处理')
      && !content.textContent.includes('无匹配选项')
  })()`)
  await pressKey(page, 'ArrowDown')
  await pressKey(page, 'Enter')
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-standard-value"]',
  )?.textContent?.trim() === 'WAITING'`)

  await openDictionaryCombobox(page, 'dictionary-select-standard')
  await page.waitFor(`(() => {
    const root = document.querySelector(
      '[data-testid="dictionary-select-standard"]',
    )
    return [...(root?.querySelectorAll('button') ?? [])].some(button => (
      button.getClientRects().length > 0
      && button.getAttribute('aria-label') === '清空字典选择'
    ))
  })()`)
  const clearLayout = await readDictionarySelectActionLayout(
    page,
    'dictionary-select-standard',
  )
  assert.equal(clearLayout.actionSlot, 'combobox-clear')
  assert.equal(clearLayout.controlDisplay, 'flex')
  assert.equal(clearLayout.actionInsideControl, true)
  assert.equal(clearLayout.sameRow, true)
  assert.equal(clearLayout.actionAtInlineEnd, true)
  await page.evaluate(`(() => {
    const root = document.querySelector(
      '[data-testid="dictionary-select-standard"]',
    )
    const button = [...(root?.querySelectorAll('button') ?? [])].find(
      candidate => candidate.getAttribute('aria-label') === '清空字典选择',
    )
    if (!button) throw new Error('dictionary clear button unavailable')
    button.click()
    return true
  })()`)
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-standard-value"]',
  )?.textContent?.trim() === 'null'`)
  const updateCountAfterClear = await page.evaluate(`Number(
    document.querySelector(
      '[data-testid="dictionary-select-standard-update-count"]',
    )?.textContent,
  )`)
  assert.equal(updateCountAfterClear, 2)

  await clickDictionaryShowcaseButton(page, '外部设为第二个“处理中”')
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-standard-value"]',
  )?.textContent?.trim() === 'RUNNING_ALTERNATE'`)
  assert.equal(await page.evaluate(`Number(
    document.querySelector(
      '[data-testid="dictionary-select-standard-update-count"]',
    )?.textContent,
  )`), updateCountAfterClear)

  await setDictionaryComboboxSearch(
    page,
    'dictionary-select-standard',
    'NOT_A_DICTIONARY_VALUE',
  )
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-standard')}
    const content = input?.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null
    return content?.textContent?.includes('无匹配选项')
  })()`)
  await pressKey(page, 'Escape')
  await page.waitFor(`${dictionarySelectInputExpression(
    'dictionary-select-standard',
  )}?.getAttribute('aria-expanded') !== 'true'`)
  await openDictionaryCombobox(page, 'dictionary-select-standard')
  await pressKey(page, 'Tab')
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-standard')}
    return document.activeElement !== input
      && document.querySelector(
        '[data-testid="dictionary-select-focus-summary"]',
      )?.textContent?.trim() === 'blur'
  })()`)

  await setDictionaryComboboxSearch(
    page,
    'dictionary-select-duplicate-label',
    '处理中',
  )
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-duplicate-label')}
    const content = input?.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null
    return [...(content?.querySelectorAll('[data-slot="combobox-item"]') ?? [])]
      .filter(item => item.getClientRects().length > 0
        && item.textContent?.trim() === '处理中').length === 2
  })()`)
  await clickDictionaryComboboxOption(
    page,
    'dictionary-select-duplicate-label',
    '处理中',
    0,
  )
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-duplicate-value"]',
  )?.textContent?.trim() === 'RUNNING'`)
  await setDictionaryComboboxSearch(
    page,
    'dictionary-select-duplicate-label',
    '处理中',
  )
  await clickDictionaryComboboxOption(
    page,
    'dictionary-select-duplicate-label',
    '处理中',
    1,
  )
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-duplicate-value"]',
  )?.textContent?.trim() === 'RUNNING_ALTERNATE'`)

  await openDictionaryCombobox(page, 'dictionary-select-empty')
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-empty')}
    const content = input?.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null
    return content?.textContent?.includes('暂无可用选项')
  })()`)
  await pressKey(page, 'Escape')

  await page.waitFor(`(() => {
    const root = document.querySelector('[data-testid="dictionary-select-retry"]')
    return root?.textContent?.includes('字典选项暂时不可用，请稍后重试')
      && root.querySelector('button[aria-label="重试加载字典选项"]')
  })()`)
  await page.evaluate(`document.querySelector(
    '[data-testid="dictionary-select-retry"] button[aria-label="重试加载字典选项"]',
  ).click()`)
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-retry')}
    return input?.getClientRects().length > 0 && !input.disabled
  })()`)
  assert.deepEqual(await page.evaluate(`(() => ({
    invalid: document.querySelector(
      '[data-testid="dictionary-select-invalid"]',
    )?.textContent?.includes('字典编码配置无效'),
    missing: document.querySelector(
      '[data-testid="dictionary-select-missing"]',
    )?.textContent?.includes('未配置该字典类型'),
  }))()`), { invalid: true, missing: true })
  assert.deepEqual(dictionaryRequests, [])
})

test('真实 Chrome 覆盖字典选择器 code session、迟到响应与 invalid 恢复', {
  timeout: 120_000,
}, async (t) => {
  const { page } = await openDictionarySelectBrowserSession(t, 'session')

  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-code-switch"]',
  )?.textContent?.includes('正在加载字典选项')`)
  await clickDictionaryShowcaseButton(page, '切换到 status')
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-code-switch')}
    return !input?.disabled && input?.value === '待处理'
  })()`)
  await setDictionaryComboboxSearch(
    page,
    'dictionary-select-code-switch',
    '处理',
  )
  await page.evaluate(`(() => {
    globalThis.__dictionarySameCodeInput = ${dictionarySelectInputExpression(
      'dictionary-select-code-switch',
    )}
    return true
  })()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.textContent?.trim() === '改为等价 code'
    ))
    if (!button) throw new Error('equivalent code button unavailable')
    button.click()
    return true
  })()`)
  await page.waitFor(`${dictionarySelectInputExpression(
    'dictionary-select-code-switch',
  )}?.value === '处理'`)
  assert.deepEqual(await page.evaluate(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-code-switch')}
    return {
      active: document.activeElement === input,
      expanded: input?.getAttribute('aria-expanded'),
      sameNode: globalThis.__dictionarySameCodeInput === input,
    }
  })()`), { active: true, expanded: 'true', sameNode: true })

  await clickDictionaryShowcaseButton(page, '切换为 invalid')
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-code-switch"]',
  )?.textContent?.includes('字典编码配置无效')`)
  await clickDictionaryShowcaseButton(page, '恢复为 status')
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-code-switch')}
    return !input?.disabled && input?.value === '待处理'
  })()`)
  await clickDictionaryShowcaseButton(page, '释放迟到 phase')
  await openDictionaryCombobox(page, 'dictionary-select-code-switch')
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-code-switch')}
    const content = input?.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null
    return content?.textContent?.includes('待处理')
      && !content.textContent.includes('阶段 Alpha')
  })()`)
})

test('真实 Chrome 覆盖字典选择器原生 FormData 与 FaForm 焦点语义', {
  timeout: 120_000,
}, async (t) => {
  const { page } = await openDictionarySelectBrowserSession(t, 'forms')

  const nativeInput = dictionarySelectInputExpression(
    'dictionary-select-native-form',
  )
  assert.deepEqual(await page.evaluate(`(() => {
    const input = ${nativeInput}
    const form = input?.closest('form')
    return {
      inputName: input?.getAttribute('name'),
      labelled: document.querySelector(
        'label[for="dictionary-select-showcase-native-form"]',
      ) !== null,
      required: input?.getAttribute('aria-required'),
      submissionNames: [...(form?.elements ?? [])]
        .filter(element => element.getAttribute?.('name') === 'workflowStatus')
        .length,
    }
  })()`), {
    inputName: null,
    labelled: true,
    required: 'true',
    submissionNames: 0,
  })

  await clickDictionaryShowcaseButton(page, '读取 FormData')
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-form-data"]',
  )?.textContent?.trim() === '[]'`)
  assert.deepEqual(await page.evaluate(`(() => {
    const input = ${nativeInput}
    const proxy = input?.closest('form')?.querySelector(
      '[data-qs-dictionary-validation-proxy]',
    )
    return {
      disabled: proxy?.disabled,
      exists: proxy !== null,
      required: proxy?.required,
      valid: proxy?.checkValidity(),
      value: proxy?.value,
      willValidate: proxy?.willValidate,
    }
  })()`), {
    disabled: false,
    exists: true,
    required: true,
    valid: false,
    value: '',
    willValidate: true,
  })
  await page.evaluate(`(() => {
    const input = ${nativeInput}
    const form = input?.closest('form')
    if (!form) throw new Error('dictionary native form unavailable')
    form.requestSubmit()
    return true
  })()`)
  await page.waitFor(`(() => {
    const root = document.querySelector(
      '[data-testid="dictionary-select-native-form"]',
    )
    return root?.textContent?.includes('请选择字典选项')
  })()`)
  await page.waitFor(`document.activeElement === ${nativeInput}`)

  await clickDictionaryShowcaseButton(page, '设为空字符串')
  await clickDictionaryShowcaseButton(page, '读取 FormData')
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-form-data"]',
  )?.textContent?.includes('["workflowStatus",""]')`)
  await clickDictionaryShowcaseButton(page, '设为未知 raw')
  await setDictionaryComboboxSearch(
    page,
    'dictionary-select-native-form',
    '待处理',
  )
  await pressKey(page, 'Escape')
  await clickDictionaryShowcaseButton(page, '读取 FormData')
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-form-data"]',
  )?.textContent?.includes('["workflowStatus","LEGACY_UNKNOWN"]')`)
  await clickDictionaryShowcaseButton(page, '切换 caller disabled')
  await clickDictionaryShowcaseButton(page, '读取 FormData')
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-form-data"]',
  )?.textContent?.trim() === '[]'`)

  await clickDictionaryShowcaseButton(page, 'scrollToField(status)')
  await page.waitFor(`document.activeElement === ${dictionarySelectInputExpression(
    'dictionary-select-form-item',
  )}`)
  await clickDictionaryShowcaseButton(page, '提交 FaForm')
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-form-item')}
    return document.activeElement === input
      && input.getAttribute('aria-invalid') === 'true'
  })()`)
  await setDictionaryComboboxSearch(
    page,
    'dictionary-select-form-item',
    'WAIT',
  )
  await pressKey(page, 'ArrowDown')
  await pressKey(page, 'Enter')
  await clickDictionaryShowcaseButton(page, '提交 FaForm')
  await page.waitFor(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-form-item')}
    const result = document.querySelector(
      '[data-testid="dictionary-select-fa-form-result"]',
    )
    return input?.getAttribute('aria-invalid') !== 'true'
      && result?.textContent?.trim() === '{"status":"WAITING"}'
  })()`)
})

test('真实 Chrome 覆盖 FaCombobox primitive、对象、分组与 virtual identity', {
  timeout: 120_000,
}, async (t) => {
  const { page } = await openDictionarySelectBrowserSession(t, 'combobox')
  const duplicateKeyWarnings = []
  const removeWarningListener = page.on(
    'Runtime.consoleAPICalled',
    (event) => {
      if (event.type !== 'warning') {
        return
      }
      const text = (event.args ?? [])
        .map(argument => argument.value ?? argument.description ?? '')
        .join(' ')
      if (text.includes('Duplicate keys found')) {
        duplicateKeyWarnings.push(text)
      }
    },
  )
  t.after(() => removeWarningListener())

  await openDictionaryCombobox(page, 'dictionary-select-primitive-values')
  const primitiveInputContract = await page.evaluate(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-primitive-values')}
    const trigger = input?.parentElement?.querySelector(
      '[data-slot="combobox-trigger"]',
    )
    return {
      autocomplete: input?.getAttribute('aria-autocomplete'),
      controls: Boolean(input?.getAttribute('aria-controls')),
      describedBy: input?.getAttribute('aria-describedby'),
      expanded: input?.getAttribute('aria-expanded'),
      id: input?.id,
      label: input?.getAttribute('aria-label'),
      required: input?.getAttribute('aria-required'),
      triggerLabel: trigger?.getAttribute('aria-label'),
    }
  })()`)
  assert.deepEqual(primitiveInputContract, {
    autocomplete: 'list',
    controls: true,
    describedBy: 'dictionary-select-primitive-description',
    expanded: 'true',
    id: 'dictionary-select-showcase-primitive-values',
    label: 'Primitive value',
    required: 'true',
    triggerLabel: '展开或收起选项',
  })
  await pressKey(page, 'Escape')

  const primitiveCases = [
    ['字符串 1', 'string:1'],
    ['数字 1', 'number:1'],
    ['大整数 1', 'bigint:1'],
    ['空值 null', 'null'],
  ]
  for (const [label, expected] of primitiveCases) {
    await openDictionaryCombobox(page, 'dictionary-select-primitive-values')
    await clickDictionaryComboboxOption(
      page,
      'dictionary-select-primitive-values',
      label,
    )
    await page.waitFor(`document.querySelector(
      '[data-testid="dictionary-select-primitive-summary"]',
    )?.textContent?.trim() === ${JSON.stringify(expected)}`)
  }
  await openDictionaryCombobox(page, 'dictionary-select-primitive-values')
  await page.waitFor(`(() => {
    const root = document.querySelector(
      '[data-testid="dictionary-select-primitive-values"]',
    )
    const clear = root?.querySelector('[data-slot="combobox-clear"]')
    return clear?.getClientRects().length > 0
      && clear.getAttribute('aria-label') === '清空选择'
  })()`)
  await page.evaluate(`document.querySelector(
    '[data-testid="dictionary-select-primitive-values"] [data-slot="combobox-clear"]',
  ).click()`)
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-primitive-summary"]',
  )?.textContent?.trim() === 'undefined'`)
  const primitiveEventCounts = await page.evaluate(`(() => {
    const text = document.querySelector(
      '[data-testid="dictionary-select-primitive-events"]',
    )?.textContent ?? ''
    return Object.fromEntries(text.trim().split(';').map(part => {
      const [key, value] = part.split('=')
      return [key, Number(value)]
    }))
  })()`)
  assert.equal(primitiveEventCounts.change, 5)
  assert.equal(primitiveEventCounts.clear, 1)
  assert.equal(primitiveEventCounts.focus > 0, true)
  assert.equal(primitiveEventCounts.blur > 0, true)

  for (const [label, expected] of [
    ['相同显示名', 'object-a · north'],
    ['相同显示名', 'object-b · south'],
  ]) {
    await openDictionaryCombobox(page, 'dictionary-select-object-values')
    await clickDictionaryComboboxOption(
      page,
      'dictionary-select-object-values',
      label,
      expected.startsWith('object-a') ? 0 : 1,
    )
    await page.waitFor(`document.querySelector(
      '[data-testid="dictionary-select-object-summary"]',
    )?.textContent?.trim() === ${JSON.stringify(expected)}`)
  }

  await openDictionaryCombobox(page, 'dictionary-select-group-values')
  assert.deepEqual(await page.evaluate(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-group-values')}
    const content = input?.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null
    return [...(content?.querySelectorAll('[data-slot="combobox-label"]') ?? [])]
      .map(label => label.textContent?.trim())
  })()`), ['首选分组', '备用分组'])
  await pressKey(page, 'Escape')
  await setDictionaryComboboxSearch(
    page,
    'dictionary-select-group-values',
    '跳过禁用',
  )
  await pressKey(page, 'ArrowDown')
  await pressKey(page, 'Enter')
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-group-summary"]',
  )?.textContent?.trim() === 'GROUP_ENABLED'`)

  await openDictionaryCombobox(page, 'dictionary-select-virtual-values')
  assert.equal(await page.evaluate(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-virtual-values')}
    const content = input?.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null
    return content?.textContent?.includes('虚拟条目 080')
  })()`), false)
  await pressKey(page, 'Escape')
  await setDictionaryComboboxSearch(
    page,
    'dictionary-select-virtual-values',
    '虚拟条目 080',
  )
  await pressKey(page, 'ArrowDown')
  await pressKey(page, 'Enter')
  await page.waitFor(`document.querySelector(
    '[data-testid="dictionary-select-virtual-summary"]',
  )?.textContent?.trim() === 'VIRTUAL_080'`)
  assert.deepEqual(duplicateKeyWarnings, [])
})

test('真实 Chrome 覆盖字典选择器主题、Reduced Motion 与移动触控', {
  timeout: 120_000,
}, async (t) => {
  const { page } = await openDictionarySelectBrowserSession(t, 'responsive')

  const desktopLayout = await readDictionarySelectActionLayout(
    page,
    'dictionary-select-standard',
  )
  assert.equal(desktopLayout.actionSlot, 'combobox-trigger')
  assert.equal(desktopLayout.controlDisplay, 'flex')
  assert.equal(
    desktopLayout.controlHeight >= 35.999
    && desktopLayout.controlHeight <= 36.001,
    true,
  )
  assert.equal(desktopLayout.actionInsideControl, true)
  assert.equal(desktopLayout.sameRow, true)
  assert.equal(desktopLayout.actionAtInlineEnd, true)
  const lightBackground = await page.evaluate(`getComputedStyle(
    ${dictionarySelectInputExpression('dictionary-select-standard')}
      ?.parentElement,
  ).backgroundColor`)
  const darkBackground = await page.evaluate(`(() => {
    document.documentElement.classList.add('dark')
    return getComputedStyle(
      ${dictionarySelectInputExpression('dictionary-select-standard')}
        ?.parentElement,
    ).backgroundColor
  })()`)
  assert.notEqual(darkBackground, lightBackground)

  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await openDictionaryCombobox(page, 'dictionary-select-standard')
  const reducedMotion = await page.evaluate(`(() => {
    const loader = document.querySelector('.qs-dictionary-select__loader')
    const content = document.querySelector(
      '.qs-dictionary-select__content[data-state="open"]',
    )
    return {
      contentAnimationDuration: getComputedStyle(content).animationDuration,
      contentAnimationIterationCount:
        getComputedStyle(content).animationIterationCount,
      loaderAnimationDuration: getComputedStyle(loader).animationDuration,
      loaderAnimationIterationCount:
        getComputedStyle(loader).animationIterationCount,
    }
  })()`)
  const durationMilliseconds = value => value.endsWith('ms')
    ? Number.parseFloat(value)
    : Number.parseFloat(value) * 1000
  assert.equal(
    durationMilliseconds(reducedMotion.contentAnimationDuration) <= 0.011,
    true,
  )
  assert.equal(reducedMotion.contentAnimationIterationCount, '1')
  assert.equal(
    durationMilliseconds(reducedMotion.loaderAnimationDuration) <= 0.011,
    true,
  )
  assert.equal(reducedMotion.loaderAnimationIterationCount, '1')
  await pressKey(page, 'Escape')

  await page.setViewport(390, 844, true)
  await page.waitFor(`document.documentElement.clientWidth === 390`)
  await openDictionaryCombobox(page, 'dictionary-select-standard')
  const mobileLayout = await page.evaluate(`(() => {
    const input = ${dictionarySelectInputExpression('dictionary-select-standard')}
    const root = input?.closest('[data-testid="dictionary-select-standard"]')
    const trigger = root?.querySelector('[data-slot="combobox-trigger"]')
    const content = input?.getAttribute('aria-controls')
      ? document.getElementById(input.getAttribute('aria-controls'))
      : null
    const option = [...(content?.querySelectorAll(
      '[data-slot="combobox-item"]',
    ) ?? [])].find(item => item.getClientRects().length > 0)
    const contentRect = content?.getBoundingClientRect()
    return {
      contentInsideViewport: contentRect.left >= -0.001
        && contentRect.right <= innerWidth + 0.001,
      documentFits: document.documentElement.scrollWidth
        <= document.documentElement.clientWidth,
      inputHeight: input?.getBoundingClientRect().height,
      optionHeight: option?.getBoundingClientRect().height,
      triggerHeight: trigger?.getBoundingClientRect().height,
    }
  })()`)
  assert.equal(mobileLayout.documentFits, true)
  assert.equal(mobileLayout.contentInsideViewport, true)
  assert.equal(mobileLayout.inputHeight >= 43.999, true)
  assert.equal(mobileLayout.optionHeight >= 43.999, true)
  assert.equal(mobileLayout.triggerHeight >= 43.999, true)
})
