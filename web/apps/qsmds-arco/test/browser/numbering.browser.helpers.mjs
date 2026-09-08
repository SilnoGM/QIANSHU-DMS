import { Buffer } from 'node:buffer'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import {
  authStoreExpression,
  pressKey,
  requestPathname,
} from './regions.browser.helpers.mjs'

const visibleDialogSelector = '[role="dialog"]'

function dialogExpression(title, body) {
  // 新增表单已迁为独立页面；字段操作共用定位器，但不把页面伪装为 dialog。
  if (title === '新增编号规则') {
    return `(() => {
      const dialog = document.querySelector('[data-testid="numbering-create-page"]')
      if (!dialog || !dialog.getClientRects().length) throw new Error('numbering create page unavailable')
      ${body}
    })()`
  }
  return `(() => {
    const dialog = [...document.querySelectorAll(${JSON.stringify(
      visibleDialogSelector,
    )})]
      .filter(candidate => candidate.getClientRects().length > 0)
      .reverse()
      .find(candidate => candidate.textContent?.includes(${JSON.stringify(title)}))
    if (!dialog) throw new Error('numbering dialog unavailable')
    ${body}
  })()`
}

function controlFromLabelSource(labelVariable) {
  return `(() => {
    const direct = ${labelVariable}.querySelector(
      'input, textarea, [role="combobox"]',
    )
    if (direct) return direct
    const htmlFor = ${labelVariable}.getAttribute('for')
    if (htmlFor) {
      const linked = dialog.querySelector(
        '#' + CSS.escape(htmlFor),
      )
      if (linked) return linked
    }
    let parent = ${labelVariable}.parentElement
    for (let depth = 0; depth < 4 && parent; depth += 1) {
      const nested = parent.querySelector(
        'input, textarea, [role="combobox"]',
      )
      if (nested) return nested
      parent = parent.parentElement
    }
    return null
  })()`
}

/**
 * Browser 日志只写步骤名，不打印 DTO、Cookie、密码或 HTTP body。失败时保留步骤
 * 名与原始 cause，既能定位场景，又不会把测试凭据带进 CI 输出。
 */
export async function runNumberingBrowserStep(label, action) {
  process.stdout.write(`[numbering-browser] ${label}\n`)
  try {
    return await action()
  }
  catch (error) {
    throw new Error(`Numbering browser step failed: ${label}`, {
      cause: error,
    })
  }
}

/** 动态路由注册会 replace 当前 document，因此只在认证稳定边界重试探针。 */
export async function waitForAfterAuthentication(page, expression) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    try {
      if (await page.evaluate(expression)) {
        return
      }
    }
    catch {
      // Router replace 销毁旧 execution context；下一轮在新 document 中重试。
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  const diagnostic = await page.evaluate(`(() => {
    const app = document.querySelector('#app')?.__vue_app__
    const stores = app?.config?.globalProperties?.$pinia?._s
    const account = stores?.get('appAccount')
    const route = stores?.get('appRoute')
    return {
      accountStoreReady: Boolean(account),
      appMounted: Boolean(app),
      authState: account?.authState ?? null,
      documentReadyState: document.readyState,
      hasForbiddenPage: document.body.innerText.includes('403'),
      hasLoadingMask: document.querySelector('.qianshu-loading') !== null,
      hasLoginPage: document.querySelector(
        'input[autocomplete="username"]',
      ) !== null,
      routeGenerated: route?.isGenerate ?? null,
      routeStoreReady: Boolean(route),
    }
  })()`).catch(() => ({ diagnosticUnavailable: true }))
  throw new Error(
    `Numbering route did not settle after authentication: ${JSON.stringify(
      diagnostic,
    )}`,
  )
}

/**
 * 证明 mutation 失败后的 GET 是页面自身发起，而不是测试端随后补做的探针。
 * Network request/response 通过 requestId 配对，只返回固定状态，不把 URL、DTO
 * 或请求头带进失败日志；异常路径显式取消 waiter，避免 CDP timer 悬挂。
 */
export async function observeSuccessfulPageGet(page, pathname, action) {
  const controller = new AbortController()
  const requestIds = new Set()
  const removeRequestListener = page.on(
    'Network.requestWillBeSent',
    (event) => {
      if (
        event.request?.method === 'GET'
        && requestPathname(event) === pathname
      ) {
        requestIds.add(event.requestId)
      }
    },
  )
  const response = page.waitForEvent(
    'Network.responseReceived',
    event => requestIds.has(event.requestId)
      && Number(event.response?.status) >= 200
      && Number(event.response?.status) < 300,
    20_000,
    { signal: controller.signal },
  )
  try {
    const actionResult = await action()
    const event = await response
    return {
      actionResult,
      status: Number(event.response.status),
    }
  }
  finally {
    controller.abort()
    await response.catch(() => undefined)
    removeRequestListener()
  }
}

export async function waitForNumberingTable(page) {
  await page.waitFor(`(() => {
    const table = document.querySelector('[data-testid="numbering-rule-table"]')
    return table?.getClientRects().length > 0
      && table.querySelector('[aria-busy="false"]') !== null
      && document.body.innerText.includes('编号管理')
      && document.querySelector('.qianshu-loading') === null
  })()`)
}

export async function waitForVisibleDialog(page, title) {
  await page.waitFor(`(() => [...document.querySelectorAll(
    ${JSON.stringify(visibleDialogSelector)},
  )].some(dialog => (
    dialog.getClientRects().length > 0
    && dialog.textContent?.includes(${JSON.stringify(title)})
  )))()`)
}

export async function waitForNumberingCreatePage(page) {
  await page.waitFor(`document.querySelector('[data-testid="numbering-create-page"]')?.getClientRects().length > 0`)
}

export async function openNumberingCreatePage(page, purpose) {
  process.stdout.write(`[numbering-browser] select purpose and open create page: ${purpose}\n`)
  await clickVisibleButton(page, '新建规则')
  await waitForVisibleDialog(page, '选择编码用途')
  await page.evaluate(`(() => {
    const input = document.querySelector('input[type="radio"][value="${purpose}"]')
    if (!input) throw new Error('numbering purpose radio unavailable')
    input.focus()
    input.click()
  })()`)
  await clickDialogButton(page, '选择编码用途', '进入新增规则')
  await waitForNumberingCreatePage(page)
}

/** 只截取隔离 fixture 的业务画面；截图落临时目录，不写仓库或采集登录页面。 */
export async function saveNumberingScreenshot(page, label) {
  // 只等当前可见页面的淡入和预览，不受背景 Toast / 持续动画或隐藏抽屉影响。
  await page.waitFor(`(() => {
    const editor = document.querySelector('[data-testid="numbering-create-page"]')
    if (!editor) return true
    for (let element = editor; element; element = element.parentElement) {
      if (Number(getComputedStyle(element).opacity) < 1) return false
    }
    const preview = editor.querySelector('#numbering-preview-title')?.closest('section')
    return !preview || preview.getAttribute('aria-busy') === 'false'
  })()`)
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
  const directory = await mkdtemp(path.join(os.tmpdir(), 'numbering-purpose-ui-'))
  const target = path.join(directory, `${label}.png`)
  const screenshot = await page.connection.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(target, Buffer.from(screenshot.data, 'base64'))
  process.stdout.write(`[numbering-browser] screenshot: ${target}\n`)
}

export async function waitForNoVisibleDialog(page, title) {
  await page.waitFor(`(() => ![...document.querySelectorAll(
    ${JSON.stringify(visibleDialogSelector)},
  )].some(dialog => (
    dialog.getClientRects().length > 0
    && dialog.textContent?.includes(${JSON.stringify(title)})
  )))()`)
}

export async function clickDialogButton(page, title, text) {
  await page.waitFor(dialogExpression(title, `
    return [...dialog.querySelectorAll('button')].some(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim() === ${JSON.stringify(text)}
      && !candidate.disabled
    ))
  `))
  const expression = dialogExpression(title, `
    const button = [...dialog.querySelectorAll('button')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim() === ${JSON.stringify(text)}
      && !candidate.disabled
    ))
    if (!button) throw new Error('numbering dialog button unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  `)
  await page.evaluate(expression)
}

export async function clickDialogAriaButton(page, title, accessibleName) {
  await page.waitFor(dialogExpression(title, `
    return [...dialog.querySelectorAll('button')].some(candidate => (
      candidate.getClientRects().length > 0
      && candidate.getAttribute('aria-label') === ${JSON.stringify(
        accessibleName,
      )}
      && !candidate.disabled
    ))
  `))
  const expression = dialogExpression(title, `
    const button = [...dialog.querySelectorAll('button')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.getAttribute('aria-label') === ${JSON.stringify(
        accessibleName,
      )}
      && !candidate.disabled
    ))
    if (!button) throw new Error('numbering aria button unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  `)
  await page.evaluate(expression)
}

export async function fillDialogControl(
  page,
  title,
  labelText,
  value,
  occurrence = 0,
) {
  const labelLookup = `
    const labels = [...dialog.querySelectorAll('label')].filter(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim().startsWith(${JSON.stringify(labelText)})
    ))
    const label = labels[${JSON.stringify(occurrence)}]
    if (!label) throw new Error('numbering field label unavailable')
    const control = ${controlFromLabelSource('label')}
  `
  const expression = dialogExpression(title, `
    ${labelLookup}
    if (!(control instanceof HTMLInputElement)
      && !(control instanceof HTMLTextAreaElement)) {
      throw new Error('numbering text control unavailable')
    }
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')
      .set.call(control, ${JSON.stringify(value)})
    control.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
    }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  `)
  try {
    await page.waitFor(dialogExpression(title, `
      try {
        ${labelLookup}
        return (control instanceof HTMLInputElement
          || control instanceof HTMLTextAreaElement)
          && control.getClientRects().length > 0
          && !control.disabled
      }
      catch {
        return false
      }
    `))
  }
  catch (cause) {
    // 诊断仅记录结构与可用状态，不读取输入值，避免 CI 日志泄露表单内容。
    const diagnostic = await page.evaluate(`(() => ({
      dialogs: [...document.querySelectorAll('[role="dialog"]')]
        .filter(dialog => dialog.getClientRects().length > 0)
        .map(dialog => ({
          disabledControlCount: [...dialog.querySelectorAll(
            'input, textarea, [role="combobox"]',
          )].filter(control => control.disabled).length,
          labels: [...dialog.querySelectorAll('label')]
            .map(label => label.textContent?.trim().slice(0, 32) ?? ''),
          title: dialog.querySelector('h1, h2, h3')?.textContent?.trim() ?? '',
        })),
      drawerCount: document.querySelectorAll('[data-drawer-id]').length,
    }))()`)
    throw new Error(
      `Numbering text control unavailable for ${labelText}: ${JSON.stringify(
        diagnostic,
      )}`,
      { cause },
    )
  }
  await page.evaluate(expression)
}

/** 异步详情装入 edit/clone Drawer 后再允许 E2E 写值，避免覆盖竞态假阴性。 */
export async function waitForDialogControlValue(
  page,
  title,
  labelText,
  expectedValue,
  occurrence = 0,
) {
  const labelLookup = `
    const labels = [...dialog.querySelectorAll('label')].filter(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim().startsWith(${JSON.stringify(labelText)})
    ))
    const label = labels[${JSON.stringify(occurrence)}]
    if (!label) throw new Error('numbering field label unavailable')
    const control = ${controlFromLabelSource('label')}
  `
  await page.waitFor(dialogExpression(title, `
    try {
      ${labelLookup}
      return (control instanceof HTMLInputElement
        || control instanceof HTMLTextAreaElement)
        && control.value === ${JSON.stringify(expectedValue)}
    }
    catch {
      return false
    }
  `))
}

export async function selectDialogOption(
  page,
  title,
  labelText,
  optionText,
  occurrence = 0,
) {
  const labelLookup = `
    const labels = [...dialog.querySelectorAll('label')].filter(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim().startsWith(${JSON.stringify(labelText)})
    ))
    const label = labels[${JSON.stringify(occurrence)}]
    if (!label) throw new Error('numbering select label unavailable')
    const control = ${controlFromLabelSource('label')}
  `
  await page.waitFor(dialogExpression(title, `
    try {
      ${labelLookup}
      return control?.getAttribute('role') === 'combobox'
        && control.getClientRects().length > 0
        && !control.disabled
    }
    catch {
      return false
    }
  `))
  await page.evaluate(dialogExpression(title, `
    ${labelLookup}
    if (control?.getAttribute('role') !== 'combobox') {
      throw new Error('numbering combobox unavailable')
    }
    control.focus({ preventScroll: true })
    return true
  `))
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="option"]')]
    .some(option => (
      option.getClientRects().length > 0
      && option.getAttribute('aria-disabled') !== 'true'
      && option.textContent?.trim() === ${JSON.stringify(optionText)}
    )))()`)
  await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')]
      .find(candidate => (
        candidate.getClientRects().length > 0
        && candidate.getAttribute('aria-disabled') !== 'true'
        && candidate.textContent?.trim() === ${JSON.stringify(optionText)}
      ))
    if (!option) throw new Error('numbering option unavailable')
    option.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
}

export async function clickSegmentMove(
  page,
  title,
  segmentIndex,
  accessibleName,
) {
  await page.evaluate(dialogExpression(title, `
    const segment = [...dialog.querySelectorAll(
      '[data-slot="qs-generic-drawer-body"] ol > li',
    )][${JSON.stringify(segmentIndex)}]
      ?? [...dialog.querySelectorAll('ol > li')][${JSON.stringify(segmentIndex)}]
    const button = [...(segment?.querySelectorAll('button') ?? [])]
      .find(candidate => (
        candidate.getAttribute('aria-label') === ${JSON.stringify(
          accessibleName,
        )}
        && candidate.getClientRects().length > 0
        && !candidate.disabled
      ))
    if (!button) throw new Error('numbering segment move unavailable')
    button.click()
    return true
  `))
}

function visibleRuleContainerSource(marker) {
  return `[
    ...document.querySelectorAll(
      '[data-testid="numbering-rule-table"] tbody tr',
    ),
    ...[...document.querySelectorAll('[data-testid="numbering-mobile-row"]')]
      .map(row => row.parentElement)
      .filter(Boolean),
  ].find(candidate => (
    candidate.getClientRects().length > 0
    && candidate.textContent?.includes(${JSON.stringify(marker)})
  ))`
}

export async function clickRuleAction(page, marker, actionText) {
  const rowSource = visibleRuleContainerSource(marker)
  const serializedAction = JSON.stringify(actionText)
  await page.waitFor(`(() => {
    const row = ${rowSource}
    return [...(row?.querySelectorAll('button') ?? [])].some(button => (
      button.getClientRects().length > 0 && !button.disabled
    ))
  })()`)
  const clickedDirectly = await page.evaluate(`(() => {
    const row = ${rowSource}
    const direct = [...(row?.querySelectorAll('button') ?? [])].find(button => (
      button.getClientRects().length > 0
      && !button.disabled
      && (
        button.textContent?.trim() === ${serializedAction}
        || button.getAttribute('aria-label')?.startsWith(
          ${serializedAction} + ' ·',
        )
      )
    ))
    if (!direct) return false
    direct.focus({ preventScroll: true })
    direct.click()
    return true
  })()`)
  if (clickedDirectly) {
    return
  }

  await page.evaluate(`(() => {
    const row = ${rowSource}
    const trigger = [...(row?.querySelectorAll('button') ?? [])].find(button => (
      button.getClientRects().length > 0
      && !button.disabled
      && (
        ['更多', '操作'].includes(button.textContent?.trim())
        || button.getAttribute('aria-label')?.includes('操作')
      )
    ))
    if (!trigger) throw new Error('numbering action trigger unavailable')
    trigger.focus({ preventScroll: true })
    trigger.click()
    return true
  })()`)
  await page.waitFor(`(() => [
    ...document.querySelectorAll('[role="menuitem"]'),
    ...document.querySelectorAll(
      '[data-testid="numbering-actions-drawer"] button',
    ),
  ].some(item => (
    item.getClientRects().length > 0
    && item.textContent?.trim() === ${serializedAction}
    && item.getAttribute('aria-disabled') !== 'true'
    && !item.disabled
  )))()`)
  await page.evaluate(`(() => {
    const item = [
      ...document.querySelectorAll('[role="menuitem"]'),
      ...document.querySelectorAll(
        '[data-testid="numbering-actions-drawer"] button',
      ),
    ].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim() === ${serializedAction}
      && candidate.getAttribute('aria-disabled') !== 'true'
      && !candidate.disabled
    ))
    if (!item) throw new Error('numbering action unavailable')
    item.focus({ preventScroll: true })
    item.click()
    return true
  })()`)
}

export async function readRuleMenuItems(page, marker) {
  const rowSource = visibleRuleContainerSource(marker)
  await page.waitFor(`(${rowSource}) !== undefined`)
  const direct = await page.evaluate(`(() => {
    const row = ${rowSource}
    return [...(row?.querySelectorAll('button') ?? [])]
      .filter(button => (
        button.getClientRects().length > 0
        && !button.disabled
        && ['查看详情', '编辑'].includes(button.textContent?.trim())
      ))
      .map(button => button.textContent?.trim() ?? '')
  })()`)
  const opened = await page.evaluate(`(() => {
    const row = ${rowSource}
    const trigger = [...(row?.querySelectorAll('button') ?? [])].find(button => (
      button.getClientRects().length > 0
      && !button.disabled
      && (
        ['更多', '操作'].includes(button.textContent?.trim())
        || button.getAttribute('aria-label')?.includes('操作')
      )
    ))
    if (!trigger) return false
    trigger.focus({ preventScroll: true })
    trigger.click()
    return true
  })()`)
  if (!opened) {
    return [...new Set(direct)]
  }
  await page.waitFor(`(() => [
    ...document.querySelectorAll('[role="menuitem"]'),
    ...document.querySelectorAll(
      '[data-testid="numbering-actions-drawer"] button',
    ),
  ].some(item => item.getClientRects().length > 0))()`)
  const nested = await page.evaluate(`(() => [
    ...document.querySelectorAll('[role="menuitem"]'),
    ...document.querySelectorAll(
      '[data-testid="numbering-actions-drawer"] button',
    ),
  ].filter(item => item.getClientRects().length > 0)
    .map(item => item.textContent?.trim() ?? '')
    .filter(Boolean))()`)
  await pressKey(page, 'Escape')
  return [...new Set([...direct, ...nested])]
}

export async function clickVisibleButton(page, text) {
  const serialized = JSON.stringify(text)
  await page.waitFor(`(() => [...document.querySelectorAll('button')].some(button => (
    button.getClientRects().length > 0
    && button.textContent?.trim() === ${serialized}
    && !button.disabled
  )))()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim() === ${serialized}
      && !candidate.disabled
    ))
    if (!button) throw new Error('numbering visible button unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`)
}

/** 真实鼠标点击 Drawer overlay，避免 DOM click 绕过 Reka 的 outside-pointer 契约。 */
export async function clickVisibleDrawerOverlay(page) {
  // Reka 为避免“打开 Drawer 的同一次 pointerdown 又触发 outside”会延迟注册监听器；
  // 等待两帧确保真实 outside-pointer 契约已经生效，再执行 CDP 鼠标事件。
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  ))`)
  const point = await page.evaluate(`(() => {
    const overlays = [...document.querySelectorAll('[data-drawer-id]')]
      .filter((candidate) => {
        const rect = candidate.getBoundingClientRect()
        return candidate.getClientRects().length > 0
          && getComputedStyle(candidate).pointerEvents !== 'none'
          && rect.width >= window.innerWidth - 1
          && rect.height >= window.innerHeight - 1
      })
    if (overlays.length === 0) {
      throw new Error('numbering drawer overlay unavailable')
    }
    const rect = overlays[0].getBoundingClientRect()
    const xStep = Math.max(16, rect.width / 24)
    const yStep = Math.max(16, rect.height / 16)
    const obstructionKinds = new Set()
    let point = null
    for (let y = rect.top + yStep / 2; y < rect.bottom; y += yStep) {
      for (let x = rect.left + xStep / 2; x < rect.right; x += xStep) {
        const hit = document.elementFromPoint(x, y)
        if (overlays.includes(hit)) {
          point = { x, y }
          break
        }
        if (hit instanceof HTMLElement) {
          obstructionKinds.add([
            hit.tagName.toLowerCase(),
            hit.dataset.slot ?? 'none',
            hit.getAttribute('role') ?? 'none',
            hit.dataset.drawerId === undefined ? 'plain' : 'drawer',
            getComputedStyle(hit).zIndex || 'auto',
          ].join(':'))
        }
      }
      if (point !== null) break
    }
    if (point === null) {
      return {
        obstructionKinds: [...obstructionKinds].sort(),
        point: null,
      }
    }
    window.__numberingDrawerOverlayEvents = []
    window.__numberingDrawerOverlayListener = (event) => {
      window.__numberingDrawerOverlayEvents.push({
        targetHasDrawerId: event.target instanceof HTMLElement
          && event.target.dataset.drawerId !== undefined,
        type: event.type,
      })
    }
    for (const type of ['mousedown', 'pointerdown']) {
      document.addEventListener(
        type,
        window.__numberingDrawerOverlayListener,
      )
    }
    return { obstructionKinds: [], point }
  })()`)
  if (point.point === null) {
    return {
      discardConfirmationVisible: false,
      editorVisible: true,
      mouseDownTargetWasOverlay: false,
      obstructionKinds: point.obstructionKinds,
      pointerDownTargetWasOverlay: false,
    }
  }
  // 先移动真实指针再按下；Chrome 的 PointerEvent 命中测试以当前鼠标位置为准。
  await page.connection.send('Input.dispatchMouseEvent', {
    button: 'none',
    buttons: 0,
    pointerType: 'mouse',
    type: 'mouseMoved',
    x: point.point.x,
    y: point.point.y,
  })
  await page.connection.send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 1,
    clickCount: 1,
    pointerType: 'mouse',
    type: 'mousePressed',
    x: point.point.x,
    y: point.point.y,
  })
  await page.connection.send('Input.dispatchMouseEvent', {
    button: 'left',
    buttons: 0,
    clickCount: 1,
    pointerType: 'mouse',
    type: 'mouseReleased',
    x: point.point.x,
    y: point.point.y,
  })
  await page.evaluate(`new Promise(resolve => setTimeout(resolve, 200))`)
  return page.evaluate(`(() => {
    const events = window.__numberingDrawerOverlayEvents ?? []
    const listener = window.__numberingDrawerOverlayListener
    if (listener) {
      for (const type of ['mousedown', 'pointerdown']) {
        document.removeEventListener(type, listener)
      }
    }
    delete window.__numberingDrawerOverlayEvents
    delete window.__numberingDrawerOverlayListener
    const visibleDialogs = [...document.querySelectorAll('[role="dialog"]')]
      .filter(dialog => dialog.getClientRects().length > 0)
    return {
      discardConfirmationVisible: visibleDialogs.some(dialog => (
        dialog.textContent?.includes('放弃未保存修改')
      )),
      editorVisible: visibleDialogs.some(dialog => (
        dialog.textContent?.includes('新建编号规则')
      )),
      mouseDownTargetWasOverlay: events.some(event => (
        event.type === 'mousedown' && event.targetHasDrawerId
      )),
      pointerDownTargetWasOverlay: events.some(event => (
        event.type === 'pointerdown' && event.targetHasDrawerId
      )),
    }
  })()`)
}

/**
 * 两个 preview 都走真实 Server，只暂停成功响应并按“新后旧”顺序释放。旧请求即使
 * 已被 AbortController 取消也会在 finally 尝试释放，绝不伪造 response body。
 */
export async function releaseTwoPreviewResponsesNewestFirst({
  afterNewest,
  afterStale,
  baseUrl,
  beforeRelease,
  firstAction,
  page,
  secondAction,
}) {
  await page.enableRequestInterception([{
    requestStage: 'Response',
    urlPattern: `${baseUrl}/api/numbering-rules/preview`,
  }])
  const held = new Map()
  const isPreview = event => event.request?.method === 'POST'
    && requestPathname(event) === '/api/numbering-rules/preview'
    && Number(event.responseStatusCode) >= 200
    && Number(event.responseStatusCode) < 300
  const removeListener = page.on('Fetch.requestPaused', (event) => {
    if (isPreview(event)) {
      held.set(event.requestId, event)
      return
    }
    void page.continueInterceptedRequest(event.requestId).catch(() => undefined)
  })
  const cancellationController = new AbortController()
  let firstCancellation
  let first
  let second
  try {
    const firstPaused = page.waitForEvent('Fetch.requestPaused', isPreview, 20_000)
    await firstAction()
    first = await firstPaused
    const secondPaused = page.waitForEvent(
      'Fetch.requestPaused',
      event => isPreview(event) && event.requestId !== first.requestId,
      20_000,
    )
    const firstNetworkId = first.networkId ?? first.requestId
    firstCancellation = page.waitForEvent(
      'Network.loadingFailed',
      event => event.requestId === firstNetworkId,
      20_000,
      { signal: cancellationController.signal },
    )
    await secondAction()
    second = await secondPaused
    await beforeRelease({ first, second })

    await page.continueInterceptedRequest(second.requestId)
    held.delete(second.requestId)
    await afterNewest()

    await page.continueInterceptedRequest(first.requestId).catch(() => undefined)
    held.delete(first.requestId)
    const cancelled = await firstCancellation
    await afterStale()
    return { firstRequestCancelled: cancelled.canceled === true }
  }
  finally {
    cancellationController.abort()
    await firstCancellation?.catch(() => undefined)
    await Promise.allSettled(
      [...held.keys()].map(requestId => (
        page.continueInterceptedRequest(requestId)
      )),
    )
    removeListener()
    await page.disableRequestInterception()
  }
}

/** 只改变本页 Store 展示，用于动态撤权；Server 403 由独立普通身份真实请求证明。 */
export function patchNumberingPermissionsExpression(permissions) {
  return authStoreExpression(`
    globalThis.__numberingOriginalAuthContext ??= JSON.parse(
      JSON.stringify(store.authContext),
    )
    store.$patch({
      authContext: {
        ...store.authContext,
        permissions: ${JSON.stringify(permissions)},
      },
    })
    return [...store.permissions]
  `)
}

export function restoreNumberingPermissionsExpression() {
  return authStoreExpression(`
    if (!globalThis.__numberingOriginalAuthContext) {
      throw new Error('numbering original auth context unavailable')
    }
    store.$patch({
      authContext: JSON.parse(JSON.stringify(
        globalThis.__numberingOriginalAuthContext,
      )),
    })
    return [...store.permissions]
  `)
}
