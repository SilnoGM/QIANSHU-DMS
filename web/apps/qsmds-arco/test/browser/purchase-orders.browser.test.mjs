/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'
import { assertBrowserInputCapabilities } from './chrome-input.browser.helpers.mjs'
import {
  clickDialogButton,
  runNumberingBrowserStep,
  saveNumberingScreenshot,
  waitForAfterAuthentication,
  waitForNoVisibleDialog,
  waitForVisibleDialog,
} from './numbering.browser.helpers.mjs'
import { assertOrderDrawerTabScrolling } from './order-drawer-scroll.browser.helpers.mjs'
import { clickOrderDrawerTab } from './order-drawer.browser.helpers.mjs'
import {
  assertPartConfiguratorMergeShowcase,
  assertPurchasePartConfiguratorAppearance,
  assertPurchasePartDetail,
  assertPurchaseShippingMarksInteraction,
  createFirstProductPart,
  readPurchaseShippingMarkLedger,
  removeFirstPurchasePartItem,
  removePurchasePart,
  waitForPurchasePartCount,
} from './purchase-order-parts.browser.helpers.mjs'
import {
  apiExpression,
  appRouteUrl,
  clickVisibleButton,
  collectRuntimeIssues,
  loginThroughRealHttp,
  pressKey,
  readConfiguration,
} from './regions.browser.helpers.mjs'

const voucherFixtureBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const customBankAccount = { paymentMethod: 'BANK_TRANSFER', recipientName: 'Browser 自定义收款人', bankName: 'Browser 银行', bankAccount: '6222000000000001' }
const listRoute = '/qs-operations/purchase/purchase-orders'
const pendingRoute = '/qs-operations/purchase/pending-purchase-orders'
const supplierLabel = 'Browser 有效供应商'
const productNo = 'PRODUCT-BROWSER-001'
const salesCustomerName = 'Browser 采购来源客户'
const salesOrderNo = 'SO-BRW-PURCHASE-SOURCE'
const customSupplierName = 'Browser 自定义供应商'
const purchaseCustomName = 'Browser 采购侧临时产品'
const purchaseCustomDescription = 'Browser 采购侧临时说明'
const historicalMixedActiveOrderNo = 'PO-BRW-MIXED-ACTIVE'
const historicalMixedCancelableOrderNo = 'PO-BRW-MIXED-CANCEL'
const historicalMixedCatalogProductName = 'Browser 历史混合目录产品'
const historicalMixedCustomProductName = 'Browser 历史混合临时产品'

/** 日志只保留固定步骤名，不输出 Cookie、密码、付款草稿或幂等键。 */
async function runPurchaseOrderBrowserStep(label, action) {
  try {
    return await runNumberingBrowserStep(`purchase orders · ${label}`, action)
  }
  catch (error) {
    throw new Error(`Purchase order browser step failed: ${label}`, {
      cause: error,
    })
  }
}

async function readAvailableShippingMarkSummary(page, productMode) {
  await page.waitFor(`(() => {
    const region = document.querySelector('[data-testid="purchase-order-shipping-mark-resolution"]')
    return region?.getClientRects().length > 0
      && region.getAttribute('data-availability') === 'AVAILABLE'
      && region.getAttribute('aria-busy') === 'false'
      && region.textContent.includes('生成采购单图片时派发 1 个基础唛头')
      && region.textContent.includes(${JSON.stringify(productMode === 'CUSTOM' ? '自定义采购' : '供应商绑定')})
      && region.querySelector('input, textarea') === null
      && region.querySelectorAll('button').length === 1
      && region.querySelector('dl') === null
      && region.querySelector('[data-testid="purchase-order-shipping-mark-status"]')?.textContent.trim() === '可用'
      && region.querySelector('[data-testid="purchase-order-shipping-mark-structure"]')?.textContent.includes('{SEQ:')
      && region.textContent.split('生成采购单图片时派发 1 个基础唛头').length === 2
  })()`)
  await openShippingMarkDetails(page)
  const summary = await page.evaluate(`(() => {
    const region = document.querySelector('[data-testid="purchase-order-shipping-mark-resolution"]')
    const details = document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')
    const fields = Object.fromEntries([...details.querySelectorAll('dt')].map(field => (
      [field.textContent.trim(), field.nextElementSibling.textContent.trim()]
    )))
    return {
      name: region.querySelector('[data-testid="purchase-order-shipping-mark-name"]').textContent.trim(),
      status: '可用',
      structure: region.querySelector('[data-testid="purchase-order-shipping-mark-structure"]').textContent.trim(),
      hint: '生成采购单图片时派发 1 个基础唛头',
      fields,
      detailHint: details.querySelector('[data-testid="purchase-order-shipping-mark-dispatch-detail"]').textContent.trim(),
    }
  })()`)
  await closeShippingMarkDetails(page)
  return summary
}

async function openShippingMarkDetails(page) {
  await page.evaluate(`document.querySelector('button[aria-label="唛头规则详细配置"]').click()`)
  await page.waitFor(`document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')?.getClientRects().length > 0`)
  // FaPopover 的入场动画不参与业务断言；等待稳定帧后直接核对面板可交互性。
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await page.waitFor(`document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')?.closest('[data-state="open"]') !== null`)
}

async function closeShippingMarkDetails(page) {
  await page.connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
  await page.waitFor(`!document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')?.getClientRects().length`)
}

async function assertShippingMarkPanelAppearance(page) {
  await page.waitFor(`[...document.querySelectorAll('[data-qs-toast]')].every(toast => toast.getClientRects().length === 0)`)
  const styles = []
  for (const theme of ['light', 'dark']) {
    await page.evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('appSettings').setColorScheme(${JSON.stringify(theme)})`)
    await page.waitFor(`document.documentElement.classList.contains('dark') === ${theme === 'dark'}`)
    await page.evaluate(`document.querySelector('[data-testid="purchase-order-shipping-mark-resolution"]').scrollIntoView({ block: 'center' })`)
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    styles.push(await page.evaluate(`(() => {
      const panel = document.querySelector('[data-testid="purchase-order-shipping-mark-resolution"]')
      const style = getComputedStyle(panel)
      return { background: style.backgroundColor, color: style.color, height: panel.getBoundingClientRect().height }
    })()`))
    assert.ok(styles.at(-1).height >= 100 && styles.at(-1).height <= 120, `compact desktop height: ${styles.at(-1).height}`)
    await saveNumberingScreenshot(page, `purchase-shipping-mark-${theme}`)
    await openShippingMarkDetails(page)
    await saveNumberingScreenshot(page, `purchase-shipping-mark-details-${theme}`)
    await closeShippingMarkDetails(page)
  }
  assert.notEqual(styles[0].background, styles[1].background)
  assert.notEqual(styles[0].color, styles[1].color)
  await assertShippingMarkDetailsInteraction(page)
  await page.setViewport(390, 844, true)
  await page.waitFor(`innerWidth === 390 && document.querySelector('[data-testid="purchase-order-create-summary-column"]')?.getClientRects().length === 0`)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  await page.evaluate(`document.querySelector('[data-testid="purchase-order-shipping-mark-resolution"]').scrollIntoView({ block: 'center' })`)
  // FaButton 的 transition-all 会过渡响应式尺寸，测量与截图必须等待实际动画结束。
  await page.waitFor(`document.querySelector('[data-testid="purchase-order-shipping-mark-resolution"]')
    .getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')`)
  const mobileSize = await page.evaluate(`(() => {
    const panel = document.querySelector('[data-testid="purchase-order-shipping-mark-resolution"]')
    const rect = panel.getBoundingClientRect()
    return { left: rect.left, right: rect.right, viewport: document.documentElement.clientWidth,
      scrollWidth: panel.scrollWidth, width: panel.clientWidth, buttonWidth: panel.querySelector('button').getBoundingClientRect().width }
  })()`)
  await saveNumberingScreenshot(page, 'purchase-shipping-mark-mobile')
  assert.ok(mobileSize.left >= 0 && mobileSize.right <= mobileSize.viewport
    && mobileSize.scrollWidth <= mobileSize.width && mobileSize.buttonWidth >= 44, JSON.stringify(mobileSize))
  await openShippingMarkDetails(page)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  assert.equal(await page.evaluate(`(() => {
    const details = document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')
    const rect = details.getBoundingClientRect()
    return rect.left >= 0 && rect.right <= innerWidth && details.scrollWidth <= details.clientWidth
  })()`), true)
  await saveNumberingScreenshot(page, 'purchase-shipping-mark-details-mobile')
  await closeShippingMarkDetails(page)
  await page.setViewport(1440, 900, false)
  await page.evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('appSettings').setColorScheme('light')`)
  await page.waitFor(`!document.documentElement.classList.contains('dark')`)
}

async function assertShippingMarkDetailsInteraction(page) {
  await page.evaluate(`document.querySelector('[data-testid="purchase-order-shipping-mark-resolution"]').scrollIntoView({ block: 'center' })`)
  const point = await page.evaluate(`(() => {
    const rect = document.querySelector('button[aria-label="唛头规则详细配置"]').getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })()`)
  assert.equal(await page.evaluate(`document.querySelector('button[aria-label="唛头规则详细配置"]')
    .contains(document.elementFromPoint(${point.x}, ${point.y}))`), true)
  // 真实鼠标悬停和键盘焦点都必须可打开；鼠标可移入浮层阅读，离开后关闭。
  await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0, button: 'none', buttons: 0, pointerType: 'mouse' })
  await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0, pointerType: 'mouse' })
  await page.waitFor(`document.querySelector('button[aria-label="唛头规则详细配置"]')?.matches(':hover')`)
  await page.waitFor(`document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')?.getClientRects().length > 0`)
  await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
  // FaPopover 打开后应立即可交互；只核对 pointer-events，不依赖动画结束状态。
  await page.waitFor(`(() => {
    const popup = document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')?.closest('[data-state="open"]')
    return popup && getComputedStyle(popup).pointerEvents === 'auto'
  })()`)
  const detailsPoint = await page.evaluate(`(() => {
    const rect = document.querySelector('[data-testid="purchase-order-shipping-mark-details"]').getBoundingClientRect()
    return { x: rect.x + 10, y: rect.y + 10 }
  })()`)
  assert.equal(await page.evaluate(`document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')
    .contains(document.elementFromPoint(${detailsPoint.x}, ${detailsPoint.y}))`), true)
  await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...detailsPoint })
  await page.evaluate('new Promise(resolve => setTimeout(resolve, 200))')
  await page.waitFor(`document.querySelector('button[aria-label="唛头规则详细配置"]')?.getAttribute('aria-expanded') === 'true'`)
  await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  await page.waitFor(`!document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')?.getClientRects().length`)
  await page.evaluate(`document.querySelector('button[aria-label="唛头规则详细配置"]').focus()`)
  await page.waitFor(`document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')?.getClientRects().length > 0`)
  await closeShippingMarkDetails(page)
  await page.evaluate(`document.activeElement.blur()`)
  await openShippingMarkDetails(page)
  await page.connection.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, x: 0, y: 0 })
  await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, x: 0, y: 0 })
  await page.waitFor(`!document.querySelector('[data-testid="purchase-order-shipping-mark-details"]')?.getClientRects().length`)
}

async function assertConfirmShippingMarkSummary(page, expected) {
  await assertCompactShippingMarkSummary(page, '[data-testid="purchase-order-confirm-shipping-mark"]', expected)
  assert.equal(await page.evaluate(`document.querySelector('[data-testid="purchase-order-confirm-shipping-mark"]')?.closest('dl') === null`), true, '确认弹窗的唛头摘要须独占全宽区域，不再挤进标签值两列表格')
}

async function assertCompactShippingMarkSummary(page, scope, expected) {
  await page.waitFor(`(() => {
    const scope = [...document.querySelectorAll(${JSON.stringify(scope)})].find(element => element.getClientRects().length > 0)
    const summary = scope?.querySelector('[data-testid="purchase-order-shipping-mark-summary"]')
    if (!summary?.getClientRects().length) return false
    return ${JSON.stringify(['name', 'status', 'structure', 'hint'])}.every(field => (
      summary.querySelector('[data-testid="shipping-mark-summary-' + field + '"]')?.textContent.trim() === ${JSON.stringify(expected)}[field]
    ))
  })()`)
  assert.equal(await page.evaluate(`(() => {
    const scope = [...document.querySelectorAll(${JSON.stringify(scope)})].find(element => element.getClientRects().length > 0)
    const summary = scope.querySelector('[data-testid="purchase-order-shipping-mark-summary"]')
    return summary.querySelector('dl') === null
      && !summary.textContent.includes(${JSON.stringify(expected.detailHint)})
      && !summary.textContent.includes(${JSON.stringify(expected.fields['匹配来源'])})
      && !summary.textContent.includes(${JSON.stringify(expected.fields['规则编码'])})
      && !summary.textContent.includes(${JSON.stringify(expected.fields['生效版本'])})
      && summary.textContent.split('生成采购单图片时派发 1 个基础唛头').length === 2
      && summary.querySelector('button[aria-label="查看唛头规则详情"]')?.getAttribute('aria-haspopup') === 'dialog'
  })()`), true, '核对与提交摘要仅保留名称、状态、规则结构及单行短提示')
}

/** 在真实核对区/确认弹窗分别检验紧凑布局，避免后台隐藏的第三步组件成为断言目标。 */
async function assertCompactShippingMarkAppearance(page, scope, expected, surface) {
  const styles = []
  const summaryExpression = `(() => {
    const scope = [...document.querySelectorAll(${JSON.stringify(scope)})].find(element => element.getClientRects().length > 0)
    return scope?.querySelector('[data-testid="purchase-order-shipping-mark-summary"]')
  })()`
  const visibleDetails = `[...document.querySelectorAll('[data-testid="shipping-mark-summary-details"]')].find(element => element.getClientRects().length > 0)`
  for (const appearance of [
    { label: 'light', theme: 'light', width: 1440, height: 900, mobile: false },
    { label: 'dark', theme: 'dark', width: 1440, height: 900, mobile: false },
    { label: 'mobile', theme: 'light', width: 390, height: 844, mobile: true },
  ]) {
    await page.connection.send('Emulation.setTouchEmulationEnabled', { enabled: appearance.mobile })
    await page.setViewport(appearance.width, appearance.height, appearance.mobile)
    await page.evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('appSettings').setColorScheme(${JSON.stringify(appearance.theme)})`)
    await page.waitFor(`innerWidth === ${appearance.width} && document.documentElement.classList.contains('dark') === ${appearance.theme === 'dark'}`)
    await page.waitFor(`matchMedia('(hover: hover) and (pointer: fine)').matches === ${!appearance.mobile}`)
    await assertCompactShippingMarkSummary(page, scope, expected)
    // 核对页会在 nextTick + RAF 后聚焦标题，并持续过渡列宽；先等页面布局稳定，再滚动目标摘要。
    await page.evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
    await page.waitFor(`(() => {
      const summary = ${summaryExpression}
      const layout = summary.closest('[role="dialog"]') ?? summary.closest('[data-testid="purchase-order-create-layout"]')
      return (layout ?? summary).getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')
    })()`)
    await page.evaluate(`${summaryExpression}.scrollIntoView({ behavior: 'instant', block: 'center' })`)
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    const trigger = `${summaryExpression}.querySelector('button[aria-label="查看唛头规则详情"]')`
    assert.equal(await page.evaluate(`!(${visibleDetails}) && ${trigger}.getAttribute('aria-expanded') === 'false'`), true, `${surface}-${appearance.label}: 默认不展开次要配置，即使模态初始焦点落在详情按钮`)
    const geometryExpression = `(() => {
      const summary = ${summaryExpression}
      const rect = summary.getBoundingClientRect()
      const button = summary.querySelector('button')
      const buttonRect = button.getBoundingClientRect()
      const hit = document.elementFromPoint(buttonRect.x + buttonRect.width / 2, buttonRect.y + buttonRect.height / 2)
      const style = getComputedStyle(summary)
      let surface = summary
      let background = style.backgroundColor
      while (surface.parentElement && ['transparent', 'rgba(0, 0, 0, 0)'].includes(background)) {
        surface = surface.parentElement
        background = getComputedStyle(surface).backgroundColor
      }
      return {
        background, color: style.color,
        fits: rect.left >= 0 && rect.right <= innerWidth + 1 && summary.scrollWidth <= summary.clientWidth + 1,
        compact: rect.height <= ${appearance.mobile ? 180 : 140},
        reachable: buttonRect.width >= ${appearance.mobile ? 44 : 28} && buttonRect.height >= ${appearance.mobile ? 44 : 28}
          && buttonRect.top >= 0 && buttonRect.bottom <= innerHeight && button.contains(hit),
        diagnostic: {
          summary: rect.toJSON(), button: buttonRect.toJSON(), width: innerWidth, height: innerHeight,
          hit: hit ? { tag: hit.tagName, role: hit.getAttribute('role'), testId: hit.getAttribute('data-testid') } : null,
        },
      }
    })()`
    try {
      await page.waitFor(`${geometryExpression}.reachable`)
    }
    catch (error) {
      throw new Error(`Shipping mark summary is not reachable: ${surface}-${appearance.label} ${JSON.stringify(await page.evaluate(geometryExpression))}`, { cause: error })
    }
    const geometry = await page.evaluate(geometryExpression)
    await saveNumberingScreenshot(page, `purchase-shipping-mark-${surface}-${appearance.label}`)
    const { background, color, diagnostic, ...layout } = geometry
    styles.push({ background, color })
    assert.deepEqual(layout, { fits: true, compact: true, reachable: true }, `${surface}-${appearance.label} ${JSON.stringify(diagnostic)}`)
    if (appearance.mobile) {
      const point = await page.evaluate(`(() => { const rect = ${trigger}.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })()`)
      await page.connection.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, radiusX: 1, radiusY: 1 }] })
      await page.connection.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    else if (appearance.label === 'light') {
      const point = await page.evaluate(`(() => { const rect = ${trigger}.getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } })()`)
      await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, button: 'none', buttons: 0 })
    }
    else {
      await page.evaluate(`${trigger}.focus()`)
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      assert.equal(await page.evaluate(`!(${visibleDetails}) && ${trigger}.getAttribute('aria-expanded') === 'false'`), true, '仅键盘聚焦不自动打开详情')
      await page.connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', nativeVirtualKeyCode: 13, windowsVirtualKeyCode: 13, text: '\r', unmodifiedText: '\r' })
      await page.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', nativeVirtualKeyCode: 13, windowsVirtualKeyCode: 13 })
    }
    await page.waitFor(`${trigger}.getAttribute('aria-expanded') === 'true' && Boolean(${visibleDetails})`)
    await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    await page.waitFor(`${visibleDetails}?.closest('[data-state="open"]') !== null`)
    const details = await page.evaluate(`(() => {
      const details = ${visibleDetails}
      const rect = details.getBoundingClientRect()
      return {
        fields: Object.fromEntries([...details.querySelectorAll('dt')].map(field => [field.textContent.trim(), field.nextElementSibling.textContent.trim()])),
        hasHint: details.textContent.includes(${JSON.stringify(expected.detailHint)}),
        dialog: details.getAttribute('role') === 'dialog' && details.getAttribute('aria-label') === '唛头规则详情',
        fits: rect.left >= 0 && rect.right <= innerWidth + 1 && details.scrollWidth <= details.clientWidth + 1,
        reachable: details.contains(document.elementFromPoint(rect.x + 12, rect.y + 12)),
      }
    })()`)
    await saveNumberingScreenshot(page, `purchase-shipping-mark-${surface}-details-${appearance.label}`)
    assert.deepEqual(details, { fields: expected.fields, hasHint: true, dialog: true, fits: true, reachable: true })
    if (appearance.label === 'light') {
      const point = await page.evaluate(`(() => { const rect = ${visibleDetails}.getBoundingClientRect(); return { x: rect.x + 12, y: rect.y + 12 } })()`)
      await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point })
      // 超过组件离开延时仍保持展开，确保鼠标能移入浮层阅读，而不是刚移动就消失。
      await page.evaluate('new Promise(resolve => setTimeout(resolve, 220))')
      await page.waitFor(`${trigger}.getAttribute('aria-expanded') === 'true' && Boolean(${visibleDetails})`)
    }
    await page.connection.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.connection.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
    await page.waitFor(`!(${visibleDetails}) && ${trigger}.getAttribute('aria-expanded') === 'false'`)
    if (surface === 'confirm') {
      await waitForVisibleDialog(page, '确认提交采购订单？')
    }
    await page.evaluate(`document.activeElement?.blur()`)
    await page.connection.send('Emulation.setTouchEmulationEnabled', { enabled: false })
    await page.connection.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 0, y: 0 })
  }
  assert.notEqual(styles[0].background, styles[1].background)
  assert.notEqual(styles[0].color, styles[1].color)
  await page.setViewport(1440, 900, false)
  await page.waitFor(`innerWidth === 1440 && !document.documentElement.classList.contains('dark')`)
}

/** 付款方式在手风琴正文内，先验证默认折叠，再展开并等待真实可见内容。 */
async function expandFirstPaymentRecord(page) {
  const sectionSelector = '[data-testid="purchase-order-detail-drawer"] section[aria-label="实际付款记录"]'
  const triggerSelector = `${sectionSelector} [data-slot="collapsible-trigger"]`
  await page.waitFor(`(() => {
    const trigger = document.querySelector(${JSON.stringify(triggerSelector)})
    return trigger?.getClientRects().length > 0
      && trigger.getAttribute('aria-expanded') === 'false'
  })()`)
  await page.evaluate(`document.querySelector(${JSON.stringify(triggerSelector)}).click()`)
  await page.waitFor(`(() => {
    const trigger = document.querySelector(${JSON.stringify(triggerSelector)})
    const content = document.getElementById(trigger?.getAttribute('aria-controls') ?? '')
    return trigger?.getAttribute('aria-expanded') === 'true'
      && content?.getClientRects().length > 0
      && content.innerText.includes('银行转账')
      && !content.innerText.includes('本次付款未关联凭证')
      && [...content.querySelectorAll('img')].some(image => image.complete && image.naturalWidth > 0)
  })()`)
}

function labelledControlSource(labelText) {
  return `(() => {
    const findControl = container => (
      container?.querySelector('[role="combobox"], [data-slot="select-trigger"]')
      ?? container?.querySelector('input, textarea')
      ?? null
    )
    const label = [...document.querySelectorAll('label')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim().startsWith(${JSON.stringify(labelText)})
    ))
    if (!label) return null
    // 字典组合框内部同时存在搜索 input 与隐藏代理；应优先命中公开的
    // combobox 交互节点，避免把不可见代理误判为当前表单控件。
    const direct = findControl(label)
    if (direct) return direct
    const htmlFor = label.getAttribute('for')
    if (htmlFor) {
      const linked = document.getElementById(htmlFor)
      if (linked?.matches(
        'input, textarea, [role="combobox"], [data-slot="select-trigger"]',
      )) return linked
      const linkedControl = findControl(linked)
      if (linkedControl) return linkedControl
    }
    let parent = label.parentElement
    for (let depth = 0; depth < 5 && parent; depth += 1) {
      const nested = findControl(parent)
      if (nested) return nested
      parent = parent.parentElement
    }
    return null
  })()`
}

/** 原生 setter 驱动公开表单 label，并等待嵌套 passive v-model 两帧回写。 */
async function fillLabelledControl(page, labelText, value) {
  const controlSource = labelledControlSource(labelText)
  await page.waitFor(`(() => {
    const control = ${controlSource}
    return (control instanceof HTMLInputElement
      || control instanceof HTMLTextAreaElement)
      && control.getClientRects().length > 0
      && !control.disabled
  })()`)
  await page.evaluate(`(() => {
    const control = ${controlSource}
    if (!(control instanceof HTMLInputElement)
      && !(control instanceof HTMLTextAreaElement)) {
      throw new Error('purchase order labelled control unavailable')
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
  })()`)
  await page.waitFor(`${controlSource}?.value === ${JSON.stringify(value)}`)
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  ))`)
}

async function fillAriaControl(page, label, value) {
  const selector = `[aria-label=${JSON.stringify(label)}]`
  await page.waitFor(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)})
    return (control instanceof HTMLInputElement
      || control instanceof HTMLTextAreaElement)
      && control.getClientRects().length > 0
      && !control.disabled
  })()`)
  await page.evaluate(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)})
    if (!(control instanceof HTMLInputElement)
      && !(control instanceof HTMLTextAreaElement)) {
      throw new Error('purchase order aria control unavailable')
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
  })()`)
  await page.waitFor(`document.querySelector(${JSON.stringify(selector)})?.value
    === ${JSON.stringify(value)}`)
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  ))`)
}

/** 采购前置弹窗使用原生 radio，Browser 用例通过可访问控件选择真实产品类型。 */
async function selectPurchaseStartMode(page, mode) {
  const serializedMode = JSON.stringify(mode)
  await page.waitFor(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('选择采购产品类型'))
    const input = dialog?.querySelector(
      'input[name="purchase-start-product-mode"][value=' + CSS.escape(${serializedMode}) + ']',
    )
    return input instanceof HTMLInputElement && !input.disabled
  })()`)
  await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('选择采购产品类型'))
    const input = dialog?.querySelector(
      'input[name="purchase-start-product-mode"][value=' + CSS.escape(${serializedMode}) + ']',
    )
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('purchase start product mode unavailable')
    }
    input.focus({ preventScroll: true })
    input.click()
    return true
  })()`)
  await page.waitFor(`document.querySelector(
    'input[name="purchase-start-product-mode"][value=' + CSS.escape(${serializedMode}) + ']',
  )?.checked === true`)
}

/** 自定义供应商没有字典选项，只驱动弹窗公开的 placeholder input。 */
async function fillPurchaseStartCustomSupplier(page, value) {
  const placeholder = '填写本次采购的供应商名称'
  const selector = `input[placeholder=${JSON.stringify(placeholder)}]`
  await page.waitFor(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    return input instanceof HTMLInputElement
      && input.getClientRects().length > 0
      && !input.disabled
  })()`)
  await page.evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)})
    if (!(input instanceof HTMLInputElement)) {
      throw new Error('purchase start custom supplier unavailable')
    }
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
      .set.call(input, ${JSON.stringify(value)})
    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
    }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await page.waitFor(`document.querySelector(${JSON.stringify(selector)})?.value
    === ${JSON.stringify(value)}`)
}

/** 自定义采购必须提供本单收款方式，通过编辑器的公开开关和字段填写。 */
async function fillCustomBankRecipient(page) {
  const section = `(() => [...document.querySelectorAll('[role="dialog"] section')]
    .find(candidate => candidate.getClientRects().length > 0
      && candidate.querySelector('h3')?.textContent.trim() === '银行账户转账'))()`
  await page.waitFor(`${section}?.querySelector('[role="switch"]')?.getAttribute('aria-checked') === 'false'`)
  await page.evaluate(`${section}.querySelector('[role="switch"]').click()`)
  await fillLabelledControl(page, '开户名称', customBankAccount.recipientName)
  await fillLabelledControl(page, '银行名称', customBankAccount.bankName)
  await fillLabelledControl(page, '银行账号', customBankAccount.bankAccount)
}

/** 已选择货件的仓库是必填项；全选后保留先前已选仓库，逐个补齐新增货件。 */
async function selectShipmentWarehouses(page) {
  const inputs = '[data-slot="shipment-destination-warehouse"] input[data-slot="combobox-input"]'
  await page.waitFor(`document.querySelectorAll(${JSON.stringify(inputs)}).length > 0`)
  const count = await page.evaluate(`document.querySelectorAll(${JSON.stringify(inputs)}).length`)
  for (let index = 0; index < count; index++) {
    const input = `document.querySelectorAll(${JSON.stringify(inputs)})[${index}]`
    try {
      await page.waitFor(`${input}?.getClientRects().length > 0 && !${input}.disabled && ${input}.getAttribute('aria-busy') !== 'true'`)
      if (await page.evaluate(`${input}.value === 'Browser 验收仓库'`)) {
        continue
      }
      await page.evaluate(`${input}.parentElement.querySelector('[data-slot="combobox-trigger"]').click()`)
      // Teleport 离场动画期间旧选项仍有尺寸；只选择当前控件公开关联的 listbox。
      const listbox = `document.getElementById(${input}.getAttribute('aria-controls'))`
      await page.waitFor(`${input}.getAttribute('aria-expanded') === 'true' && ${listbox}?.getAttribute('data-state') === 'open'`)
      const option = `([...${listbox}.querySelectorAll('[role="option"]')].find(candidate => candidate.getClientRects().length > 0 && candidate.textContent.trim() === 'Browser 验收仓库'))`
      await page.waitFor(`${option} !== undefined && ${option}.getAttribute('aria-disabled') !== 'true'`)
      await page.evaluate(`${option}.click()`)
      await page.waitFor(`${input}.value === 'Browser 验收仓库' && ${input}.getAttribute('aria-expanded') === 'false'`)
    }
    catch (error) {
      const diagnostic = await page.evaluate(`(() => ({
        inputIndex: ${index},
        inputs: [...document.querySelectorAll(${JSON.stringify(inputs)})].map((input, index) => ({
          index, value: input.value, disabled: input.disabled,
          expanded: input.getAttribute('aria-expanded'), controls: input.getAttribute('aria-controls'),
          busy: input.getAttribute('aria-busy'), invalid: input.getAttribute('aria-invalid'),
        })),
        visibleOptions: [...document.querySelectorAll('[role="option"]')]
          .filter(option => option.getClientRects().length > 0)
          .map(option => ({
            text: option.textContent.trim(), selected: option.getAttribute('aria-selected'),
            state: option.getAttribute('data-state'), disabled: option.getAttribute('aria-disabled'),
            listboxId: option.closest('[role="listbox"]')?.id,
            listboxState: option.closest('[role="listbox"]')?.getAttribute('data-state'),
          })),
      }))()`)
      throw new Error(`Shipment warehouse selection failed: ${JSON.stringify(diagnostic)}`, { cause: error })
    }
  }
  assert.deepEqual(
    await page.evaluate(`[...document.querySelectorAll(${JSON.stringify(inputs)})].map(input => input.value)`),
    Array.from({ length: count }).fill('Browser 验收仓库'),
  )
}

/** 实际付款走独立页面与正式上传接口，每阶段都归档一张截图并验证已付状态。 */
async function payPurchaseInstallments(page, configuration, order, installments, voucherFixture) {
  await page.navigate(appRouteUrl(configuration.baseUrl, `/qs-finance/realtime-payments/purchase-payments/orders/${encodeURIComponent(order.id)}`))
  await waitForAfterAuthentication(page, `document.querySelector('section[aria-label="采购单信息"]')?.textContent.includes(${JSON.stringify(order.orderNo)})`)
  for (const installment of installments) {
    await clickVisibleAriaButton(page, `选择${installment.label}`)
    const payment = `document.querySelector('section[aria-label="付款信息"]')`
    const confirm = `([...${payment}.querySelectorAll('button')].find(button => button.textContent.trim() === '确认已付款'))`
    await page.waitFor(`${payment}?.textContent.includes('本次付款金额') && ${payment}.textContent.includes('${installment.label}') && ${confirm}?.disabled === true`)
    const recipientTrigger = `document.querySelector('section[aria-label="收款资料"] [data-slot="select-trigger"]')`
    // Reka Select 的 DOM click 只聚焦，公开键盘契约由 Enter 打开并选中。
    await page.bringToFront()
    await page.waitFor(`document.hasFocus() && ${recipientTrigger}?.getClientRects().length > 0 && !${recipientTrigger}.disabled`)
    await page.evaluate(`${recipientTrigger}.focus({ preventScroll: true })`)
    await pressKey(page, 'Enter')
    const option = `([...document.querySelectorAll('[role="option"]')].find(candidate => candidate.getClientRects().length > 0 && candidate.textContent.trim() === '银行账户转账'))`
    await page.waitFor(`${recipientTrigger}?.getAttribute('aria-expanded') === 'true' && ${option} !== undefined`)
    await page.evaluate(`${option}.focus({ preventScroll: true })`)
    await pressKey(page, 'Enter')
    await page.waitFor(`${recipientTrigger}?.getAttribute('aria-expanded') === 'false'`)
    await page.waitFor(`document.querySelector('section[aria-label="收款资料"]')?.textContent.includes('Browser 收款人')
      && document.querySelector('section[aria-label="收款资料"]')?.textContent.includes('6222000000000000')`)
    assert.equal(await page.evaluate(`${confirm}.disabled`), true, '选择账户后仍须上传付款截图才能确认')
    await page.setFiles('section[aria-label="付款信息"] input[type="file"]', [voucherFixture])
    await page.waitFor(`${confirm}?.disabled === false`)
    await clickVisibleButton(page, '确认已付款')
    await page.waitFor(`${payment}?.textContent.includes('该笔款项已付清，无需重复付款。')
      && ${payment}.querySelector('input[type="file"]') === null`)
    const payable = await page.evaluate(apiExpression(`/api/purchase-order-payables/orders/${encodeURIComponent(order.id)}`))
    assert.equal(payable.status, 200)
    const item = payable.body.items.find(item => item.paymentType === installment.type)
    assert.equal(item.status, 'PAID')
    assert.equal(item.paidAmount, installment.amount)
    assert.equal(item.remainingAmount, '0.00')
    assert.equal(item.paymentReceipt.recipient.paymentMethod, 'BANK_TRANSFER')
    assert.ok(item.paymentReceipt.voucher.id, '确认付款必须关联已归档的凭证')
  }
  await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
  await waitForPurchaseList(page, order.orderNo)
  await clickVisibleAriaButton(page, `${order.orderNo}：详情`)
  await page.waitFor(`document.querySelector('[data-testid="purchase-order-detail-drawer"]')?.getClientRects().length > 0`)
}

/** 供应商和付款方式均通过公开 placeholder、trigger 与 option 契约选择。 */
async function selectVisibleComboboxOption(page, placeholder, optionText) {
  const serializedPlaceholder = JSON.stringify(placeholder)
  const serializedOption = JSON.stringify(optionText)
  const controlSource = `([...document.querySelectorAll(
    'input[data-slot="combobox-input"]',
  )].find(input => input.placeholder === ${serializedPlaceholder}) ?? null)`
  await page.waitFor(`(() => {
    const control = ${controlSource}
    return control?.getClientRects().length > 0
      && !control.disabled
      && control.getAttribute('aria-busy') !== 'true'
  })()`)
  await page.evaluate(`(() => {
    const control = ${controlSource}
    if (!control) throw new Error('purchase order combobox unavailable')
    // 校验失败可能已经通过领域组件的公开 focus() 展开 Popover。先释放焦点，
    // 再使用相邻公开 trigger 建立确定的“关闭 -> 展开”测试前置状态。
    control.blur()
    return true
  })()`)
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  ))`)
  await page.evaluate(`(() => {
    const control = ${controlSource}
    const trigger = control?.parentElement?.querySelector(
      '[data-slot="combobox-trigger"]',
    )
    if (!(trigger instanceof HTMLButtonElement)) {
      throw new Error('purchase order combobox trigger unavailable')
    }
    trigger.click()
    return true
  })()`)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="option"]')]
    .some(option => option.getClientRects().length > 0
      && option.textContent?.trim() === ${serializedOption}
      && option.getAttribute('aria-disabled') !== 'true'))()`)
  await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.trim() === ${serializedOption}
        && candidate.getAttribute('aria-disabled') !== 'true')
    if (!option) throw new Error('purchase order option unavailable')
    option.click()
    return true
  })()`)
  await page.waitFor(`(() => {
    const control = ${controlSource}
    const display = control instanceof HTMLInputElement
      ? control.value
      : control?.textContent?.trim()
    return display === ${serializedOption}
  })()`)
}

async function clickVisibleAriaButton(page, label) {
  const serialized = JSON.stringify(label)
  await page.waitFor(`(() => [...document.querySelectorAll('button')].some(button => (
    button.getAttribute('aria-label') === ${serialized}
    && button.getClientRects().length > 0
    && !button.disabled
  )))()`)
  await page.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(candidate => (
      candidate.getAttribute('aria-label') === ${serialized}
      && candidate.getClientRects().length > 0
      && !candidate.disabled
    ))
    if (!button) throw new Error('purchase order aria button unavailable')
    button.focus({ preventScroll: true })
    button.click()
    return true
  })()`)
}

/** 路由切换期间可能保留旧表格；仅采集可见表格内当前订单的可见动作。 */
function purchaseOrderActionButtonsSource(orderNo) {
  return `(() => [...document.querySelectorAll('[data-testid="purchase-order-list-table"]')]
    .filter(table => table.getClientRects().length > 0
      && !table.querySelector('[aria-busy="true"]'))
    .flatMap(table => [...table.querySelectorAll('button[aria-label]')])
    .filter(button => button.getClientRects().length > 0
      && getComputedStyle(button).visibility !== 'hidden'
      && button.getAttribute('aria-label').startsWith(${JSON.stringify(`${orderNo}：`)})))()`
}

async function openWorkbenchReview(page, orderNo) {
  const source = `(() => [...document.querySelectorAll('tr')]
    .filter(row => row.getClientRects().length > 0 && row.textContent.includes(${JSON.stringify(orderNo)}))
    .flatMap(row => [...row.querySelectorAll('button')])
    .find(button => button.getClientRects().length > 0 && !button.disabled && button.textContent.trim() === '审核'))()`
  await page.waitFor(`${source} !== undefined`)
  await page.evaluate(`(() => { const button = ${source}; button.focus({ preventScroll: true }); button.click(); return true })()`)
}

/** 销售订单候选项是可访问的 radio 容器，名称还会附带客户和产品汇总。 */
async function clickVisibleSalesOrderCandidate(page, orderNo) {
  const labelPrefix = JSON.stringify(`选择销售订单 ${orderNo}`)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="radio"]')]
    .some(candidate => candidate.getAttribute('aria-label')?.startsWith(${labelPrefix})
      && candidate.getClientRects().length > 0
      && candidate.getAttribute('aria-disabled') !== 'true'))()`)
  await page.evaluate(`(() => {
    const candidate = [...document.querySelectorAll('[role="radio"]')]
      .find(item => item.getAttribute('aria-label')?.startsWith(${labelPrefix})
        && item.getClientRects().length > 0
        && item.getAttribute('aria-disabled') !== 'true')
    if (!(candidate instanceof HTMLElement)) {
      throw new Error('sales order candidate unavailable')
    }
    candidate.focus({ preventScroll: true })
    candidate.click()
    return true
  })()`)
}

async function readPurchaseOrders(page, view = 'all') {
  return page.evaluate(apiExpression(
    `/api/purchase-orders?view=${encodeURIComponent(view)}&page=1&pageSize=20`,
  ))
}

async function waitForPurchaseList(page, expectedText) {
  await waitForAfterAuthentication(page, `(() => {
    const table = [...document.querySelectorAll('[data-testid="purchase-order-list-table"]')]
      .find(candidate => candidate.getClientRects().length > 0)
    return table !== undefined
      && !table.querySelector('[aria-busy="true"]')
      && table.textContent?.includes(${JSON.stringify(expectedText)})
  })()`)
}

/**
 * 状态项的文本节点同时包含业务标签与计数，不能复用只匹配完整按钮文案的帮助函数。
 * 这里按工具栏 aria-label 和首个 span 的稳定标签定位，覆盖真实渲染出来的全量计数。
 */
async function waitForStatusToolbarCounts(page, ariaLabel, expectedCounts) {
  await page.waitFor(`(() => {
    const toolbar = [...document.querySelectorAll(
      '[data-slot="qs-status-switch-toolbar"][aria-label='
        + CSS.escape(${JSON.stringify(ariaLabel)}) + ']',
    )].find(candidate => candidate.getClientRects().length > 0)
    if (!toolbar) return false
    const counts = Object.fromEntries(
      [...toolbar.querySelectorAll('[data-slot="qs-status-switch-item"]')]
        .map((button) => {
          const parts = [...button.querySelectorAll('span')]
            .map(span => span.textContent?.trim() ?? '')
          return [parts[0], Number(parts[1])]
        }),
    )
    return Object.entries(${JSON.stringify(expectedCounts)})
      .every(([label, count]) => counts[label] === count)
  })()`)
}

test('真实 Chrome 覆盖采购创建、双视图审核、审核侧取消、独立付款和响应式主题', {
  timeout: 600_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const fixtureDirectory = process.env.QIANSHU_BROWSER_AUTH_FIXTURE_DIRECTORY
  assert.equal(typeof fixtureDirectory, 'string')
  assert.equal(path.isAbsolute(fixtureDirectory), true)
  await mkdir(fixtureDirectory, { mode: 0o700, recursive: true })
  const voucherFixture = path.join(fixtureDirectory, 'browser-purchase-payment-voucher.png')
  await writeFile(voucherFixture, Buffer.from(voucherFixtureBase64, 'base64'), { mode: 0o600 })
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-purchase-orders`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  const createRequests = []
  const reviewRequests = []
  let resolutionRequests = 0
  const unsubscribeRequests = page.on('Network.requestWillBeSent', ({ request }) => {
    const path = new URL(request.url).pathname
    if (path === '/api/purchase-orders/shipping-mark-resolution') {
      resolutionRequests += 1
    }
    if (path === '/api/purchase-orders' && request.method === 'POST') {
      const body = JSON.parse(request.postData ?? '{}')
      // 只核对创建契约；不记录表单、凭据或完整请求。
      createRequests.push({
        hasManualMark: Object.hasOwn(body, 'shippingMarkText'),
        key: Object.entries(request.headers).find(([name]) => name.toLowerCase() === 'idempotency-key')?.[1],
        token: body.expectedShippingMarkResolution,
        parts: body.parts,
      })
    }
    if (/^\/api\/purchase-orders\/[^/]+\/review$/u.test(path) && request.method === 'POST') {
      reviewRequests.push({ expectedVersion: JSON.parse(request.postData ?? '{}').expectedVersion })
    }
  })
  t.after(unsubscribeRequests)
  await page.setViewport(1440, 900, false)
  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await runPurchaseOrderBrowserStep('desktop and touch input capabilities', async () => {
    await assertBrowserInputCapabilities(page)
  })
  await runPurchaseOrderBrowserStep('drawer scrolling and blocked pointer regression', async () => {
    await assertOrderDrawerTabScrolling(page)
  })

  let historicalMixedActiveOrder
  let historicalMixedCancelableOrder
  let initialShippingMarkLedger
  await runPurchaseOrderBrowserStep('real login and historical mixed lists', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(page, configuration)
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    await waitForPurchaseList(page, historicalMixedActiveOrderNo)
    await waitForStatusToolbarCounts(page, '全部采购状态筛选', {
      全部采购: 2,
      采购审核中: 0,
      已确认: 2,
      已完成: 0,
      已取消: 0,
    })
    const all = await readPurchaseOrders(page)
    initialShippingMarkLedger = await readPurchaseShippingMarkLedger(page)
    assert.equal(all.status, 200)
    assert.equal(all.body?.total, 2)
    historicalMixedActiveOrder = all.body?.items?.find(
      item => item.orderNo === historicalMixedActiveOrderNo,
    )
    historicalMixedCancelableOrder = all.body?.items?.find(
      item => item.orderNo === historicalMixedCancelableOrderNo,
    )
    assert.equal(historicalMixedActiveOrder?.productMode, 'MIXED')
    assert.equal(historicalMixedCancelableOrder?.productMode, 'MIXED')
    assert.equal(historicalMixedActiveOrder?.supplier?.source, 'DICTIONARY')
    assert.equal(historicalMixedActiveOrder?.supplier?.label, supplierLabel)
    assert.deepEqual(historicalMixedActiveOrder?.shippingMarks, [])
    assert.deepEqual(historicalMixedCancelableOrder?.shippingMarks, [])
    const historicalDetail = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(historicalMixedActiveOrder.id)}`))
    assert.equal(historicalDetail.status, 200)
    assert.deepEqual(historicalDetail.body?.parts, [], '历史单不得根据旧唛头推测货件')
    await page.navigate(appRouteUrl(configuration.baseUrl, pendingRoute))
    await waitForPurchaseList(page, historicalMixedCancelableOrderNo)
    await waitForStatusToolbarCounts(page, '待办采购状态筛选', {
      采购审核中: 0,
      待发货: 2,
      待付款: 2,
      待入仓: 0,
    })
    const pending = await readPurchaseOrders(page, 'pending')
    assert.equal(pending.status, 200)
    assert.equal(pending.body?.total, 2)
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    await waitForPurchaseList(page, historicalMixedActiveOrderNo)
  })

  const runtime = collectRuntimeIssues(page, {
    sensitiveValues: [configuration.password],
  })
  runtime.start()

  await runPurchaseOrderBrowserStep('merge distinct products through the real part configurator showcase', async () => {
    const requestsBefore = createRequests.length
    await page.navigate(appRouteUrl(configuration.baseUrl, '/component-library/business/part-configurator'))
    await assertPartConfiguratorMergeShowcase(page)
    assert.equal(createRequests.length, requestsBefore, '组件库合件不应创建采购订单')
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    await waitForPurchaseList(page, historicalMixedActiveOrderNo)
  })

  await runPurchaseOrderBrowserStep('date range precedes search and clears in place', async () => {
    await page.waitFor(`(() => {
      const loading = document.querySelector('.qianshu-loading')
      return loading === null
        || loading.getClientRects().length === 0
        || getComputedStyle(loading).pointerEvents === 'none'
    })()`)
    const layout = await page.evaluate(`(() => {
      const date = [...document.querySelectorAll('button')]
        .find(button => button.getAttribute('aria-label')?.startsWith('打开采购日期范围选择：'))
      const search = document.querySelector(
        'input[placeholder="搜索采购单号、销售单号、客户名或采购唛头"]',
      )
      if (!date || !search) return null
      const dateRect = date.getBoundingClientRect()
      const searchRect = search.getBoundingClientRect()
      return {
        centerDelta: Math.abs(
          dateRect.top + dateRect.height / 2 - (searchRect.top + searchRect.height / 2),
        ),
        dateRight: dateRect.right,
        searchLeft: searchRect.left,
      }
    })()`)
    assert.ok(layout)
    assert.ok(layout.dateRight + 8 <= layout.searchLeft)
    assert.ok(layout.centerDelta <= 1)
    assert.equal(await page.evaluate(`document.querySelectorAll(
      'button[aria-label="清除采购日期范围"]',
    ).length`), 0)

    await page.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find(candidate => candidate.getAttribute('aria-label')?.startsWith('打开采购日期范围选择：'))
      if (!button) throw new Error('purchase date range trigger unavailable')
      button.click()
      return true
    })()`)
    await page.waitFor(`document.querySelector('[data-slot="range-calendar"]')
      ?.getClientRects().length > 0`)
    const initialHeading = await page.evaluate(`document.querySelector(
      '[data-slot="range-calendar-heading"]',
    )?.textContent ?? ''`)
    assert.ok(initialHeading)
    await page.evaluate(`(() => {
      const previous = document.querySelector('[data-slot="range-calendar-prev-button"]')
      if (!previous) throw new Error('purchase date range previous month unavailable')
      previous.click()
      return true
    })()`)
    await page.waitFor(`document.querySelector(
      '[data-slot="range-calendar-heading"]',
    )?.textContent !== ${JSON.stringify(initialHeading)}`)
    await page.evaluate(`(() => {
      const day = [...document.querySelectorAll('[data-slot="range-calendar-trigger"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && !candidate.disabled
          && !candidate.hasAttribute('data-disabled')
          && !candidate.hasAttribute('data-unavailable')
          && !candidate.hasAttribute('data-outside-view'))
      if (!day) throw new Error('purchase date range start unavailable')
      day.click()
      return true
    })()`)
    await page.waitFor(`document.querySelector(
      '[data-slot="range-calendar-trigger"][data-selection-start]',
    )`)
    const rangeEndPoint = await page.evaluate(`(() => {
      const days = [...document.querySelectorAll('[data-slot="range-calendar-trigger"]')]
        .filter(candidate => candidate.getClientRects().length > 0
          && !candidate.disabled
          && !candidate.hasAttribute('data-disabled')
          && !candidate.hasAttribute('data-unavailable')
          && !candidate.hasAttribute('data-outside-view'))
      const startIndex = days.findIndex(candidate => candidate.hasAttribute('data-selection-start'))
      const day = days[startIndex + 1]
      if (!day) return null
      const rect = day.getBoundingClientRect()
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
    })()`)
    assert.ok(rangeEndPoint)
    // 范围终点需要真实 hover 形成高亮区间后再点击；使用上个月合法日期，
    // 避免每月第一天把“今天之后”的禁用日期误当作可选终点。
    await page.connection.send('Input.dispatchMouseEvent', {
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
      type: 'mouseMoved',
      x: rangeEndPoint.x,
      y: rangeEndPoint.y,
    })
    await page.connection.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 1,
      clickCount: 1,
      pointerType: 'mouse',
      type: 'mousePressed',
      x: rangeEndPoint.x,
      y: rangeEndPoint.y,
    })
    await page.connection.send('Input.dispatchMouseEvent', {
      button: 'left',
      buttons: 0,
      clickCount: 1,
      pointerType: 'mouse',
      type: 'mouseReleased',
      x: rangeEndPoint.x,
      y: rangeEndPoint.y,
    })
    await page.waitFor(`(() => {
      const calendar = document.querySelector('[data-slot="range-calendar"]')
      const clear = document.querySelector('button[aria-label="清除采购日期范围"]')
      const trigger = [...document.querySelectorAll('button')]
        .find(candidate => candidate.getAttribute('aria-label')?.startsWith('打开采购日期范围选择：'))
      const label = trigger?.getAttribute('aria-label') ?? ''
      return (calendar?.getClientRects().length ?? 0) === 0
        && clear !== null
        && label.includes(' 至 ')
        && !label.includes('...')
    })()`)
    await page.evaluate(`(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
      return true
    })()`)
    await page.connection.send('Input.dispatchMouseEvent', {
      button: 'none',
      buttons: 0,
      pointerType: 'mouse',
      type: 'mouseMoved',
      x: 0,
      y: 0,
    })
    await page.waitFor(`(() => {
      const clear = document.querySelector('button[aria-label="清除采购日期范围"]')
      return clear !== null
        && getComputedStyle(clear).opacity === '0'
        && getComputedStyle(clear).pointerEvents === 'none'
    })()`)

    const clearState = await page.evaluate(`(() => {
      const clear = document.querySelector('button[aria-label="清除采购日期范围"]')
      const group = clear?.closest('[data-slot="qs-date-range-filter"]')
      if (!clear || !group) return null
      const rect = group.getBoundingClientRect()
      return {
        opacity: getComputedStyle(clear).opacity,
        pointerEvents: getComputedStyle(clear).pointerEvents,
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      }
    })()`)
    assert.ok(clearState)
    assert.equal(clearState.opacity, '0')
    assert.equal(clearState.pointerEvents, 'none')
    await page.connection.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: clearState.x,
      y: clearState.y,
    })
    await page.waitFor(`(() => {
      const clear = document.querySelector('button[aria-label="清除采购日期范围"]')
      return clear && getComputedStyle(clear).opacity === '1'
        && getComputedStyle(clear).pointerEvents !== 'none'
    })()`)
    await clickVisibleAriaButton(page, '清除采购日期范围')
    await page.waitFor(`!document.querySelector('button[aria-label="清除采购日期范围"]')
      && [...document.querySelectorAll('button')].some(button => (
        button.getAttribute('aria-label') === '打开采购日期范围选择：采购日期范围'
      ))`)
    await waitForPurchaseList(page, historicalMixedActiveOrderNo)
  })

  let catalogLinkedOrder
  await runPurchaseOrderBrowserStep('sales-linked CATALOG filter and final submission', async () => {
    await clickVisibleButton(page, '新增采购')
    await waitForVisibleDialog(page, '选择采购产品类型')
    await selectPurchaseStartMode(page, 'CATALOG')
    await selectVisibleComboboxOption(page, '选择供应商', supplierLabel)
    await clickDialogButton(page, '选择采购产品类型', '开始采购')
    await waitForAfterAuthentication(page, `(() => (
      (() => {
        const parameters = new URLSearchParams(location.hash.split('?')[1] ?? '')
        const step = document.querySelector('[data-testid="purchase-order-step-base"]')
        return location.hash.includes('/qs-operations/purchase/purchase-orders/create?')
          && parameters.get('type') === 'SALES_LINKED'
          && parameters.get('productMode') === 'CATALOG'
          && parameters.get('supplierValue') === 'BROWSER_SUPPLIER_EFFECTIVE'
          && parameters.get('customSupplierName') === null
          && step?.getClientRects().length > 0
          && document.body.innerText.includes('新增采购订单')
          && document.body.innerText.includes('第 1 步，共 4 步')
          && step.textContent.includes('产品库产品采购')
      })()
    ))()`)
    // 通用采购入口不预选销售订单，必须先通过筛选后的选择器完成关联。
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="warning"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes('请先完成并修正当前步骤的必填资料'))`)
    assert.equal(await page.evaluate(`document.querySelector('.purchase-order-alert-stack')
      ?.getClientRects().length ?? 0`), 0)
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-base"]')
      ?.getClientRects().length > 0`)

    await clickVisibleButton(page, '选择销售订单')
    await waitForVisibleDialog(page, '选择销售订单')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择销售订单'))
      const candidate = [...(dialog?.querySelectorAll('[role="radio"]') ?? [])]
        .find(item => item.getAttribute('aria-label')
          ?.startsWith(${JSON.stringify(`选择销售订单 ${salesOrderNo}`)}))
      const productImage = candidate?.querySelector(
        '[data-slot="image-group"] img[alt="Browser 多媒体产品"]',
      )
      return dialog?.textContent?.includes(${JSON.stringify(salesCustomerName)})
        && candidate?.getClientRects().length > 0
        && productImage instanceof HTMLImageElement
        && productImage.complete
        && productImage.naturalWidth > 0
        && candidate.querySelector('[data-slot="image-group"]')
          ?.getAttribute('aria-label') === '图片组，共 1 张'
        && candidate.querySelector(
          '[data-slot="sales-order-selector-products-without-image"]',
        ) === null
    })()`)
    await clickVisibleSalesOrderCandidate(page, salesOrderNo)
    await clickDialogButton(page, '选择销售订单', '确认选择')
    await waitForNoVisibleDialog(page, '选择销售订单')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-base"]')
      ?.textContent?.includes(${JSON.stringify(salesCustomerName)})`)

    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-products-payment"]')
      ?.getClientRects().length > 0`)
    const stepTwoLayout = await page.evaluate(`(() => {
      const layout = document.querySelector('[data-testid="purchase-order-create-layout"]')
      const form = document.querySelector('.purchase-order-form-track')
      const step = document.querySelector('[data-testid="purchase-order-step-products-payment"]')
      const summary = document.querySelector('[data-testid="purchase-order-create-summary-column"]')
      const table = step?.querySelector('table')
      const scroller = table?.parentElement
      if (!layout || !form || !step || !summary || !table || !scroller) return null
      const layoutRect = layout.getBoundingClientRect()
      const formRect = form.getBoundingClientRect()
      const stepRect = step.getBoundingClientRect()
      const summaryRect = summary.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      return {
        viewportRight: document.documentElement.clientWidth,
        layoutRight: layoutRect.right,
        formRight: formRect.right,
        stepRight: stepRect.right,
        summaryLeft: summaryRect.left,
        scrollerRight: scrollerRect.right,
        scrollerClientWidth: scroller.clientWidth,
        scrollerScrollWidth: scroller.scrollWidth,
      }
    })()`)
    assert.ok(stepTwoLayout, '采购产品与付款步骤必须渲染完整布局')
    assert.ok(stepTwoLayout.layoutRight <= stepTwoLayout.viewportRight + 1, JSON.stringify(stepTwoLayout))
    assert.ok(stepTwoLayout.stepRight <= stepTwoLayout.formRight + 1, JSON.stringify(stepTwoLayout))
    assert.ok(stepTwoLayout.scrollerRight <= stepTwoLayout.formRight + 1, JSON.stringify(stepTwoLayout))
    assert.ok(stepTwoLayout.summaryLeft >= stepTwoLayout.formRight + 20, JSON.stringify(stepTwoLayout))
    assert.ok(stepTwoLayout.scrollerScrollWidth > stepTwoLayout.scrollerClientWidth, JSON.stringify(stepTwoLayout))
    await clickVisibleButton(page, '同步销售产品明细')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-products-payment"]')
      ?.textContent?.includes(${JSON.stringify(productNo)})`)
    await page.waitFor(`(() => {
      const step = document.querySelector('[data-testid="purchase-order-step-products-payment"]')
      const image = step?.querySelector('tbody img')
      return !step?.textContent?.includes('Browser 销售临时产品')
        && image instanceof HTMLImageElement
        && image.src.includes('/api/purchase-orders/product-options/')
        && image.complete
        && image.naturalWidth > 0
    })()`)
    await fillLabelledControl(page, '第 1 行本单采购价', '80')
    await fillAriaControl(page, '定金', '20')
    await fillAriaControl(page, '尾款', '140')

    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-mark-remark"]')
      ?.getClientRects().length > 0`)
    const shippingMarkSummary = await readAvailableShippingMarkSummary(page, 'CATALOG')
    await assertShippingMarkPanelAppearance(page)
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.activeElement?.getAttribute('aria-label') === '货件配置'`)
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-mark-remark"]')?.getClientRects().length > 0`)
    assert.equal(createRequests.length, 0, '未配置货件的下一步不得创建订单')
    await createFirstProductPart(page, 1)
    await createFirstProductPart(page, 1)
    await waitForPurchasePartCount(page, 2)
    await removePurchasePart(page, 1)
    await removeFirstPurchasePartItem(page)
    await createFirstProductPart(page, 2)
    // 退回更改数量必须撤回超量配置；恢复原数量也不能静默恢复旧箱子。
    await clickVisibleButton(page, '上一步')
    await fillLabelledControl(page, '第 1 行产品数量', '1')
    await waitForPurchasePartCount(page, 0)
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="warning"]')].some(toast => toast.textContent.includes('受影响产品的货件配置已清除'))`)
    await fillLabelledControl(page, '第 1 行产品数量', '2')
    await fillAriaControl(page, '定金', '20')
    await fillAriaControl(page, '尾款', '140')
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-mark-remark"]')?.getClientRects().length > 0`)
    await waitForPurchasePartCount(page, 0)
    await createFirstProductPart(page, 1)
    await createFirstProductPart(page, 1)
    await assertPurchasePartConfiguratorAppearance(page)
    await fillLabelledControl(page, '采购备注', 'BROWSER LINKED REMARK')
    await clickVisibleButton(page, '下一步')

    await page.waitFor(`(() => {
      const form = document.querySelector('.purchase-order-form-track')
      const layout = document.querySelector('[data-testid="purchase-order-create-layout"]')
      const review = document.querySelector('[data-testid="purchase-order-create-review"]')
      const summary = document.querySelector('[data-testid="purchase-order-create-summary-column"]')
      const detail = summary?.querySelector('[data-slot="qs-purchase-order-desc"]')
      const productImage = detail?.querySelector('img')
      return form?.getAttribute('aria-hidden') === 'true'
        && layout?.classList.contains('purchase-order-create-layout--review')
        && review?.getClientRects().length > 0
        && detail?.getClientRects().length > 0
        && getComputedStyle(detail).borderTopLeftRadius === '12px'
        && productImage instanceof HTMLImageElement
        && productImage.complete
        && productImage.naturalWidth > 0
        && summary?.getAttribute('data-surface') === 'review'
        && summary.getBoundingClientRect().width > window.innerWidth * 0.8
        && summary.textContent?.includes(${JSON.stringify(salesCustomerName)})
        && summary.textContent.includes(${JSON.stringify(supplierLabel)})
        && summary.textContent.includes(${JSON.stringify(productNo)})
        && !summary.textContent.includes('Browser 销售临时产品')
        && summary.textContent.includes('真实采购价')
        && !summary.textContent.includes('采购定价')
        && [...summary.querySelectorAll('[data-currency="CNY"]')]
          .some(amount => amount.getAttribute('aria-label')?.includes('160'))
        && summary.textContent.includes('BROWSER LINKED REMARK')
    })()`)
    await assertCompactShippingMarkSummary(page, '[data-testid="purchase-order-create-summary-column"]', shippingMarkSummary)
    await assertCompactShippingMarkAppearance(page, '[data-testid="purchase-order-create-summary-column"]', shippingMarkSummary, 'review')

    await page.setViewport(390, 844, true)
    await page.waitFor(`(() => (
      innerWidth === 390
      && document.querySelector('[data-slot="qs-purchase-order-desc"]')
        ?.getClientRects().length > 0
    ))()`)
    await page.evaluate(`(() => {
      const app = document.querySelector('#app')?.__vue_app__
      app?.config?.globalProperties?.$pinia?._s
        ?.get('appSettings')?.setColorScheme('light')
      return true
    })()`)
    await page.waitFor(`!document.documentElement.classList.contains('dark')`)
    const lightPurchaseDesc = await page.evaluate(`(() => {
      const component = document.querySelector('[data-slot="qs-purchase-order-desc"]')
      const image = component?.querySelector('img')
      const rect = component?.getBoundingClientRect()
      const style = component ? getComputedStyle(component) : null
      return {
        background: style?.backgroundColor,
        color: style?.color,
        componentInside: Boolean(rect && rect.left >= 0
          && rect.right <= document.documentElement.clientWidth),
        documentFits: document.documentElement.scrollWidth
          <= document.documentElement.clientWidth,
        imageDecoded: image instanceof HTMLImageElement
          && image.complete
          && image.naturalWidth > 0,
      }
    })()`)
    assert.deepEqual({
      componentInside: lightPurchaseDesc.componentInside,
      documentFits: lightPurchaseDesc.documentFits,
      imageDecoded: lightPurchaseDesc.imageDecoded,
    }, {
      componentInside: true,
      documentFits: true,
      imageDecoded: true,
    })
    await page.evaluate(`(() => {
      const app = document.querySelector('#app')?.__vue_app__
      app?.config?.globalProperties?.$pinia?._s
        ?.get('appSettings')?.setColorScheme('dark')
      return true
    })()`)
    await page.waitFor(`document.documentElement.classList.contains('dark')`)
    const darkPurchaseDesc = await page.evaluate(`(() => {
      const component = document.querySelector('[data-slot="qs-purchase-order-desc"]')
      const style = component ? getComputedStyle(component) : null
      return { background: style?.backgroundColor, color: style?.color }
    })()`)
    assert.notEqual(darkPurchaseDesc.background, lightPurchaseDesc.background)
    assert.notEqual(darkPurchaseDesc.color, lightPurchaseDesc.color)
    await page.evaluate(`(() => {
      const app = document.querySelector('#app')?.__vue_app__
      app?.config?.globalProperties?.$pinia?._s
        ?.get('appSettings')?.setColorScheme('light')
      return true
    })()`)
    await page.waitFor(`!document.documentElement.classList.contains('dark')`)
    await page.setViewport(1440, 900, true)

    await clickVisibleButton(page, '提交订单')
    await waitForVisibleDialog(page, '确认提交采购订单？')
    await assertConfirmShippingMarkSummary(page, shippingMarkSummary)
    await assertCompactShippingMarkAppearance(page, '[data-testid="purchase-order-confirm-shipping-mark"]', shippingMarkSummary, 'confirm')
    assert.equal(createRequests.length, 0, '读取规则与进入确认不应创建采购订单')
    assert.ok(resolutionRequests > 0)
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('确认提交采购订单？'))
      return dialog?.textContent?.includes('销售关联采购')
        && dialog.textContent.includes(${JSON.stringify(supplierLabel)})
        && dialog.textContent.includes('160')
    })()`)
    await clickDialogButton(page, '确认提交采购订单？', '确认提交订单')
    await waitForPurchaseList(page, salesCustomerName)
    await page.waitFor(`(() => {
      const table = [...document.querySelectorAll('[data-testid="purchase-order-list-table"]')]
        .find(candidate => candidate.getClientRects().length > 0)
      return [...(table?.querySelectorAll('[data-slot="qs-person-display-name"]') ?? [])]
        .some(name => name.textContent?.trim() === 'Browser Auth Admin')
    })()`)

    const response = await readPurchaseOrders(page)
    assert.equal(response.status, 200)
    assert.equal(response.body?.total, 3)
    catalogLinkedOrder = response.body?.items?.find(item => (
      item.purchaseType === 'SALES_LINKED' && item.productMode === 'CATALOG'
    ))
    assert.match(catalogLinkedOrder?.orderNo ?? '', /^PO-BRW-\d{8}$/u)
    assert.equal(catalogLinkedOrder?.createdBy?.displayName, 'Browser Auth Admin')
    assert.equal(catalogLinkedOrder?.purchaseTotalAmount, '160.00')
    assert.equal(catalogLinkedOrder?.orderStatus, 'PENDING_REVIEW')
    assert.equal(catalogLinkedOrder?.fulfillmentStatus, 'ORDERED')
    assert.equal(catalogLinkedOrder?.depositDueAmount, '20.00')
    assert.equal(catalogLinkedOrder?.balanceDueAmount, '140.00')
    assert.equal(catalogLinkedOrder?.shippingMarkText, null)
    assert.deepEqual(catalogLinkedOrder?.shippingMarks, [], '提交后只保存货件，待审核才生成唛头')
    assert.deepEqual(await readPurchaseShippingMarkLedger(page), initialShippingMarkLedger, '创建拆分货件不消耗任何唛头流水')
    assert.deepEqual(createRequests[0]?.parts.map(part => part.items), [
      [{ lineNumber: 1, quantity: 1 }],
      [{ lineNumber: 1, quantity: 1 }],
    ])
    assert.ok(createRequests[0].parts.every(part => /^[a-f0-9-]{36}$/iu.test(part.key)))
    assert.equal(createRequests[0]?.hasManualMark, false)
    assert.match(createRequests[0]?.token ?? '', /^[a-f0-9]{64}$/u)
    const detail = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(catalogLinkedOrder.id)}`))
    assert.equal(detail.status, 200)
    assert.deepEqual(detail.body.parts.map(part => part.shippingMarkText), [null, null])
    assert.deepEqual(detail.body.parts.map(part => part.items.map(item => ({ lineNumber: item.lineNumber, quantity: item.quantity }))), [
      [{ lineNumber: 1, quantity: 1 }],
      [{ lineNumber: 1, quantity: 1 }],
    ])
    assert.equal(detail.body.amounts.lineSubtotalAmount, '160.00', '拆件不得重复计订单金额')
    await clickVisibleAriaButton(page, `${catalogLinkedOrder.orderNo}：详情`)
    await assertPurchasePartDetail(page, detail.body, true)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await page.waitFor(`!document.querySelector('[data-testid="purchase-order-detail-drawer"]')?.getClientRects().length`)
    await waitForPurchaseList(page, catalogLinkedOrder.orderNo)
  })

  let linkedOrder
  await runPurchaseOrderBrowserStep('sales shortcut CUSTOM eligibility and final submission', async () => {
    await page.navigate(appRouteUrl(
      configuration.baseUrl,
      '/qs-operations/sales/pending-sales-orders',
    ))
    await waitForAfterAuthentication(page, `(() => {
      const table = [...document.querySelectorAll('[data-testid="sales-order-list-table"]')]
        .find(candidate => candidate.getClientRects().length > 0)
      const action = [...document.querySelectorAll(
        'button[aria-label=' + CSS.escape(${JSON.stringify(`${salesOrderNo}：新增采购`)}) + ']',
      )].find(candidate => candidate.getClientRects().length > 0)
      return table !== undefined
        && table.textContent?.includes(${JSON.stringify(salesCustomerName)})
        && action !== undefined
    })()`)
    await clickVisibleAriaButton(page, `${salesOrderNo}：新增采购`)
    await waitForVisibleDialog(page, '选择采购产品类型')
    await page.waitFor(`document.querySelector('[aria-label="预选销售订单"]')
      ?.textContent?.includes(${JSON.stringify(salesOrderNo)})`)

    // 目录产品已被上一张采购单全量覆盖；快捷入口必须在弹窗内拒绝
    // 该组合，而不是导航到一张无可同步明细的采购表单。
    await selectPurchaseStartMode(page, 'CATALOG')
    await selectVisibleComboboxOption(page, '选择供应商', supplierLabel)
    await clickDialogButton(page, '选择采购产品类型', '开始采购')
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="warning"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes(
          '该销售订单没有符合当前产品类型和供应商条件的待采购产品',
        ))`)
    await waitForVisibleDialog(page, '选择采购产品类型')

    await selectPurchaseStartMode(page, 'CUSTOM')
    await page.waitFor(`!document.querySelector(
      'input[data-slot="combobox-input"][placeholder="选择供应商"]',
    )`)
    await fillPurchaseStartCustomSupplier(page, customSupplierName)
    await fillCustomBankRecipient(page)

    // 与创建页共用同一窄屏验收基线：弹窗不溢出，双面板收敛为单列，
    // Footer 操作仍保持至少 44px 的可触达高度。
    await page.setViewport(390, 844, true)
    const mobileStartModal = await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择采购产品类型'))
      const group = dialog?.querySelector('[role="radiogroup"]')
      const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
        .filter(button => ['取消', '开始采购'].includes(button.textContent?.trim()))
      const rect = dialog?.getBoundingClientRect()
      return {
        dialogFits: Boolean(rect && rect.left >= 0
          && rect.right <= document.documentElement.clientWidth),
        singleColumn: group ? getComputedStyle(group).gridTemplateColumns.split(' ').length === 1 : false,
        touchTargets: buttons.length === 2 && buttons.every(button => (
          button.getBoundingClientRect().height + 0.001 >= 44
        )),
      }
    })()`)
    assert.deepEqual(mobileStartModal, {
      dialogFits: true,
      singleColumn: true,
      touchTargets: true,
    })
    await page.setViewport(1440, 900, true)

    await clickDialogButton(page, '选择采购产品类型', '开始采购')
    await waitForAfterAuthentication(page, `(() => {
      const parameters = new URLSearchParams(location.hash.split('?')[1] ?? '')
      const step = document.querySelector('[data-testid="purchase-order-step-base"]')
      const supplier = step?.querySelector('input[aria-label="供应商名称"]')
      const source = [...(step?.querySelectorAll('.border-primary') ?? [])]
        .find(candidate => candidate.textContent?.includes(${JSON.stringify(salesOrderNo)})
          && candidate.textContent.includes(${JSON.stringify(salesCustomerName)}))
      return parameters.get('type') === 'SALES_LINKED'
        && parameters.get('productMode') === 'CUSTOM'
        && parameters.get('customSupplierName') === ${JSON.stringify(customSupplierName)}
        && parameters.get('supplierValue') === null
        && step?.textContent?.includes('自定义产品采购')
        && supplier instanceof HTMLInputElement
        && supplier.value === ${JSON.stringify(customSupplierName)}
        && source?.getClientRects().length > 0
    })()`)
    await page.waitFor(`[...document.querySelectorAll('button')].some(button => (
      button.textContent?.trim() === '重选销售订单'
      && button.getClientRects().length > 0
      && !button.disabled
    ))`)
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-products-payment"]')
      ?.getClientRects().length > 0`)
    await clickVisibleButton(page, '同步销售产品明细')
    await page.waitFor(`(() => {
      const step = document.querySelector('[data-testid="purchase-order-step-products-payment"]')
      const productName = step?.querySelector('input[aria-label="第 1 行产品名称"]')
      return productName instanceof HTMLInputElement
        && productName.value === 'Browser 销售临时产品'
        && !step.textContent.includes(${JSON.stringify(productNo)})
    })()`)
    await fillLabelledControl(page, '第 1 行产品名称', purchaseCustomName)
    await fillLabelledControl(page, '第 1 行采购定价', '30')
    await fillLabelledControl(page, '第 1 行本单采购价', '30')
    await fillLabelledControl(page, '第 1 行备注', purchaseCustomDescription)
    await fillAriaControl(page, '定金', '10')
    await fillAriaControl(page, '尾款', '20')
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-mark-remark"]')
      ?.getClientRects().length > 0`)
    const shippingMarkSummary = await readAvailableShippingMarkSummary(page, 'CUSTOM')
    await createFirstProductPart(page, 1)
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`(() => {
      const summary = document.querySelector('[data-testid="purchase-order-create-summary-column"]')
      return summary?.getAttribute('data-surface') === 'review'
        && summary.textContent?.includes(${JSON.stringify(customSupplierName)})
        && summary.textContent.includes(${JSON.stringify(purchaseCustomName)})
        && summary.textContent.includes(${JSON.stringify(purchaseCustomDescription)})
        && !summary.textContent.includes(${JSON.stringify(productNo)})
    })()`)
    await clickVisibleButton(page, '提交订单')
    await waitForVisibleDialog(page, '确认提交采购订单？')
    await assertConfirmShippingMarkSummary(page, shippingMarkSummary)
    await clickDialogButton(page, '确认提交采购订单？', '确认提交订单')
    await waitForPurchaseList(page, customSupplierName)

    const response = await readPurchaseOrders(page)
    assert.equal(response.status, 200)
    assert.equal(response.body?.total, 4)
    linkedOrder = response.body?.items?.find(item => (
      item.purchaseType === 'SALES_LINKED' && item.productMode === 'CUSTOM'
    ))
    assert.match(linkedOrder?.orderNo ?? '', /^PO-BRW-\d{8}$/u)
    assert.equal(linkedOrder?.supplier?.source, 'CUSTOM_TEXT')
    assert.equal(linkedOrder?.supplier?.value, null)
    assert.equal(linkedOrder?.supplier?.label, customSupplierName)
    assert.equal(linkedOrder?.purchaseTotalAmount, '30.00')
    assert.equal(linkedOrder?.orderStatus, 'PENDING_REVIEW')
    assert.equal(linkedOrder?.fulfillmentStatus, 'ORDERED')
    assert.equal(linkedOrder?.shippingMarkText, null)
    assert.deepEqual(linkedOrder?.shippingMarks, [])
    assert.deepEqual(await readPurchaseShippingMarkLedger(page), initialShippingMarkLedger)

    const detail = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(linkedOrder.id)}`,
    ))
    assert.equal(detail.status, 200)
    const customLine = detail.body?.lines?.find(line => line.lineType === 'CUSTOM')
    assert.equal(customLine?.productName, purchaseCustomName)
    assert.equal(customLine?.description, purchaseCustomDescription)
    assert.equal(detail.body.parts.length, 1)
    assert.equal(detail.body.parts[0].shippingMarkText, null)
    assert.deepEqual(detail.body.parts[0].items, [{ purchaseOrderLineId: customLine.id, lineNumber: 1, quantity: 1 }])
  })

  let order
  await runPurchaseOrderBrowserStep('stock creation and validation focus', async () => {
    await clickVisibleButton(page, '新增备货采购')
    await waitForVisibleDialog(page, '选择采购产品类型')
    await selectPurchaseStartMode(page, 'CATALOG')
    await selectVisibleComboboxOption(page, '选择供应商', supplierLabel)
    await page.enableRequestInterception([{ urlPattern: '*/api/purchase-orders/shipping-mark-resolution*', requestStage: 'Request' }])
    const failedResolution = page.waitForEvent('Fetch.requestPaused', event => event.request.method === 'GET')
    await clickDialogButton(page, '选择采购产品类型', '开始采购')
    await page.connection.send('Fetch.failRequest', {
      requestId: (await failedResolution).requestId,
      errorReason: 'ConnectionClosed',
    })
    await page.disableRequestInterception()
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-shipping-mark-resolution"]')?.textContent.includes('可返回上一步后重试')`)
    const resolutionsBeforeRecovery = resolutionRequests
    await waitForAfterAuthentication(page, `(() => (
      (() => {
        const parameters = new URLSearchParams(location.hash.split('?')[1] ?? '')
        return location.hash.includes('/qs-operations/purchase/purchase-orders/create?')
          && parameters.get('type') === 'STOCK'
          && parameters.get('productMode') === 'CATALOG'
          && parameters.get('supplierValue') === 'BROWSER_SUPPLIER_EFFECTIVE'
      })()
      && document.querySelector('[data-testid="purchase-order-create-page"]')
        ?.getClientRects().length > 0
      && document.body.innerText.includes('PURCHASE_ORDER · AUTO')
      && document.body.innerText.includes('第 1 步，共 4 步')
      && document.querySelector('[data-testid="purchase-order-create-summary-column"]')
        ?.getClientRects().length > 0
      && !document.body.innerText.includes('选择销售订单')
      && !document.body.innerText.includes('同步销售产品明细')
    ))()`)

    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-products-payment"]')
      ?.getClientRects().length > 0`)
    await clickVisibleButton(page, '添加数据库产品')
    await waitForVisibleDialog(page, '选择数据库产品')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择数据库产品'))
      return dialog?.textContent?.includes(${JSON.stringify(productNo)})
    })()`)
    await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择数据库产品'))
      const product = [...(dialog?.querySelectorAll('button') ?? [])]
        .find(button => button.textContent?.includes(${JSON.stringify(productNo)})
          && button.textContent?.includes('选择产品'))
      if (!product) throw new Error('purchase product card unavailable')
      product.click()
      return true
    })()`)
    await clickDialogButton(page, '选择数据库产品', '确认添加')
    await waitForNoVisibleDialog(page, '选择数据库产品')
    await fillLabelledControl(page, '第 1 行本单采购价', '80')

    await clickVisibleButton(page, '下一步')
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="warning"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes('请先完成并修正当前步骤的必填资料'))`)
    await page.waitFor(`document.activeElement?.getAttribute('aria-label') === '定金'`)

    await fillAriaControl(page, '定金', '20')
    await fillAriaControl(page, '尾款', '60')
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-mark-remark"]')
      ?.getClientRects().length > 0`)
    const shippingMarkSummary = await readAvailableShippingMarkSummary(page, 'CATALOG')
    assert.ok(resolutionRequests > resolutionsBeforeRecovery, '进入唛头步骤自动恢复失败的只读匹配')
    await createFirstProductPart(page, 1)
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-create-review"]')
      ?.getClientRects().length > 0`)
    await assertCompactShippingMarkSummary(page, '[data-testid="purchase-order-create-summary-column"]', shippingMarkSummary)
    await clickVisibleButton(page, '提交订单')
    await waitForVisibleDialog(page, '确认提交采购订单？')
    await assertConfirmShippingMarkSummary(page, shippingMarkSummary)
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('确认提交采购订单？'))
      return dialog?.textContent?.includes('备货采购')
        && dialog.textContent.includes(${JSON.stringify(supplierLabel)})
        && dialog.textContent.includes('80')
    })()`)
    // 用公开错误契约注入已知冲突，只检验 Web 的回退与重新确认边界。
    const resolutionsBeforeConflict = resolutionRequests
    await page.enableRequestInterception([{ urlPattern: '*/api/purchase-orders', requestStage: 'Request' }])
    const conflictRequest = page.waitForEvent('Fetch.requestPaused', event => event.request.method === 'POST')
    await clickDialogButton(page, '确认提交采购订单？', '确认提交订单')
    await page.connection.send('Fetch.fulfillRequest', {
      requestId: (await conflictRequest).requestId,
      responseCode: 409,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({
        code: 'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED',
        message: '采购唛头规则已变化，请重新核对',
        requestId: 'browser-shipping-mark-conflict',
      })).toString('base64'),
    })
    await page.disableRequestInterception()
    await waitForNoVisibleDialog(page, '确认提交采购订单？')
    await readAvailableShippingMarkSummary(page, 'CATALOG')
    assert.ok(resolutionRequests > resolutionsBeforeConflict)
    await page.waitFor(`document.activeElement?.getAttribute('aria-label') === '采购唛头规则'`)
    assert.equal(await page.evaluate(`Number(document.querySelector('input[aria-label="尾款"]')?.value)`), 60)
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-create-review"]')?.getClientRects().length > 0`)
    await clickVisibleButton(page, '提交订单')
    await waitForVisibleDialog(page, '确认提交采购订单？')
    await assertConfirmShippingMarkSummary(page, shippingMarkSummary)
    // 响应阶段断网意味着服务端已完成创建，验证恢复不会刷新规则或换幂等键。
    await page.enableRequestInterception([{ urlPattern: '*/api/purchase-orders', requestStage: 'Response' }])
    const pausedResponse = page.waitForEvent('Fetch.requestPaused', event => (
      event.request.method === 'POST' && event.responseStatusCode !== undefined
    ))
    await clickDialogButton(page, '确认提交采购订单？', '确认提交订单')
    const paused = await pausedResponse
    assert.equal(paused.responseStatusCode, 201, '丢弃响应前须确认服务端已创建订单')
    await page.failInterceptedRequest(paused.requestId)
    await page.disableRequestInterception()
    await page.waitFor(`[...document.querySelectorAll('button')].some(button => (
      button.getClientRects().length > 0 && button.textContent?.trim() === '使用相同请求重新确认'
    ))`)
    const resolutionCountBeforeReplay = resolutionRequests
    const originalRequest = createRequests.at(-1)
    await assertConfirmShippingMarkSummary(page, shippingMarkSummary)
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(item => item.getClientRects().length > 0 && item.textContent?.includes('确认提交采购订单？'))
      return [...(dialog?.querySelectorAll('button') ?? [])]
        .find(button => button.textContent?.trim() === '返回检查')?.disabled === true
    })()`)
    await clickDialogButton(page, '确认提交采购订单？', '使用相同请求重新确认')
    await waitForPurchaseList(page, supplierLabel)
    assert.equal(resolutionRequests, resolutionCountBeforeReplay)
    assert.equal(Boolean(originalRequest?.key), true)
    assert.equal(createRequests.at(-1)?.key === originalRequest.key, true)
    assert.equal(createRequests.at(-1)?.token === originalRequest.token, true)
    assert.deepEqual(createRequests.at(-1)?.parts, originalRequest.parts, '未知结果重试须保持货件 key 和内容完全一致')

    const response = await readPurchaseOrders(page)
    assert.equal(response.status, 200)
    assert.equal(response.body?.total, 5)
    order = response.body?.items?.find(item => (
      item.purchaseType === 'STOCK' && item.productMode === 'CATALOG'
    ))
    assert.match(order?.orderNo ?? '', /^PO-BRW-\d{8}$/u)
    assert.equal(order?.purchaseType, 'STOCK')
    assert.equal(order?.orderStatus, 'PENDING_REVIEW')
    assert.equal(order?.fulfillmentStatus, 'ORDERED')
    assert.equal(order?.purchaseTotalAmount, '80.00')
    assert.equal(order?.depositDueAmount, '20.00')
    assert.equal(order?.balanceDueAmount, '60.00')
    assert.equal(order?.shippingMarkText, null)
    assert.deepEqual(order?.shippingMarks, [])
    assert.deepEqual(await readPurchaseShippingMarkLedger(page), initialShippingMarkLedger, '未知结果原键恢复仍不申请唛头')
  })

  await runPurchaseOrderBrowserStep('stock CUSTOM exposes only temporary products', async () => {
    await clickVisibleButton(page, '新增备货采购')
    await waitForVisibleDialog(page, '选择采购产品类型')
    await selectPurchaseStartMode(page, 'CUSTOM')
    await fillPurchaseStartCustomSupplier(page, customSupplierName)
    await fillCustomBankRecipient(page)
    await clickDialogButton(page, '选择采购产品类型', '开始采购')
    await waitForAfterAuthentication(page, `(() => {
      const parameters = new URLSearchParams(location.hash.split('?')[1] ?? '')
      const step = document.querySelector('[data-testid="purchase-order-step-base"]')
      const supplier = step?.querySelector('input[aria-label="供应商名称"]')
      return parameters.get('type') === 'STOCK'
        && parameters.get('productMode') === 'CUSTOM'
        && parameters.get('customSupplierName') === ${JSON.stringify(customSupplierName)}
        && parameters.get('supplierValue') === null
        && step?.textContent?.includes('自定义产品采购')
        && supplier instanceof HTMLInputElement
        && supplier.value === ${JSON.stringify(customSupplierName)}
    })()`)
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`(() => {
      const step = document.querySelector('[data-testid="purchase-order-step-products-payment"]')
      const buttons = [...(step?.querySelectorAll('button') ?? [])]
        .filter(button => button.getClientRects().length > 0)
        .map(button => button.textContent?.trim())
      return buttons.includes('添加临时产品')
        && !buttons.includes('添加数据库产品')
    })()`)
    await clickVisibleButton(page, '添加临时产品')
    await page.waitFor(`(() => {
      const step = document.querySelector('[data-testid="purchase-order-step-products-payment"]')
      return step?.querySelector('input[aria-label="第 1 行产品名称"]')
        ?.getClientRects().length > 0
    })()`)
    await clickVisibleButton(page, '取消')
    await waitForVisibleDialog(page, '放弃当前采购订单？')
    await clickDialogButton(page, '放弃当前采购订单？', '确认放弃')
    await waitForNoVisibleDialog(page, '放弃当前采购订单？')
    await waitForPurchaseList(page, order.orderNo)
  })

  await runPurchaseOrderBrowserStep('operations purchase list does not offer cancellation', async () => {
    const actionsSource = purchaseOrderActionButtonsSource(order.orderNo)
    await page.waitFor(`${actionsSource}.length === 1`)
    assert.deepEqual(await page.evaluate(`${actionsSource}.map(button => button.textContent.trim())`), ['详情'])
    assert.equal(await page.evaluate(`(() => [...document.querySelectorAll(
      '[data-slot="qs-generic-drawer"]',
    )].filter(drawer => drawer.getClientRects().length > 0).length)()`), 0)
  })

  await runPurchaseOrderBrowserStep('unreviewed detail is read-only and both review views have counts', async () => {
    await waitForStatusToolbarCounts(page, '全部采购状态筛选', {
      全部采购: 5,
      采购审核中: 3,
      已确认: 2,
      已完成: 0,
      已取消: 0,
    })
    await clickVisibleAriaButton(page, `${order.orderNo}：详情`)
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-detail-drawer"]')?.textContent.includes('采购审核中')`)
    assert.equal(await page.evaluate(`(() => {
      const drawer = document.querySelector('[data-testid="purchase-order-detail-drawer"]')
      return [...drawer.querySelectorAll('button')].some(button => button.getClientRects().length > 0
        && ['记录付款', '添加凭证'].includes(button.textContent.trim()))
    })()`), false)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await page.navigate(appRouteUrl(configuration.baseUrl, `${pendingRoute}?task=AWAITING_REVIEW`))
    await waitForPurchaseList(page, order.orderNo)
    await waitForStatusToolbarCounts(page, '待办采购状态筛选', {
      采购审核中: 3,
      待发货: 2,
      待入仓: 0,
      待付款: 2,
    })
    const pendingActionsSource = purchaseOrderActionButtonsSource(order.orderNo)
    await page.waitFor(`${pendingActionsSource}.length === 1`)
    assert.deepEqual(await page.evaluate(`${pendingActionsSource}.map(button => button.textContent.trim())`), ['详情'])
  })

  await runPurchaseOrderBrowserStep('review requires confirmation, recovers conflict, and refreshes both views', async () => {
    const toReview = [catalogLinkedOrder, linkedOrder, order]
    for (const [index, target] of toReview.entries()) {
      process.stdout.write(`[numbering-browser] purchase review case ${index + 1}/3: opening confirmation\n`)
      const reviewRoute = index === 0 ? `${listRoute}?status=PENDING_REVIEW` : `${pendingRoute}?task=AWAITING_REVIEW`
      await page.navigate(appRouteUrl(configuration.baseUrl, reviewRoute))
      await waitForPurchaseList(page, target.orderNo)
      await page.waitFor(`(() => [...document.querySelectorAll('[data-slot="qs-status-switch-toolbar"]')]
        .some(toolbar => toolbar.getClientRects().length > 0
          && toolbar.getAttribute('aria-label') === ${JSON.stringify(index === 0 ? '全部采购状态筛选' : '待办采购状态筛选')}
          && toolbar.querySelector('[aria-pressed="true"]')?.textContent.includes('采购审核中')))()`)
      if (index === 0) {
        const allActionsSource = purchaseOrderActionButtonsSource(target.orderNo)
        await page.waitFor(`${allActionsSource}.length === 1`)
        assert.deepEqual(await page.evaluate(`${allActionsSource}.map(button => button.textContent.trim())`), ['详情'])
        const rowActionLayout = await page.evaluate(`(() => {
          const buttons = ${allActionsSource}
          const rects = buttons.map(button => button.getBoundingClientRect())
          return {
            singleRow: rects.length === 1 && rects.every(rect => Math.abs(rect.top - rects[0].top) <= 1),
            reachable: buttons.every(button => {
              const rect = button.getBoundingClientRect()
              return rect.left >= 0 && rect.right <= innerWidth && !button.disabled
                && button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
            }),
          }
        })()`)
        assert.deepEqual(rowActionLayout, { singleRow: true, reachable: true })
      }
      await page.navigate(appRouteUrl(configuration.baseUrl, '/qs-purchase-transport/reviews'))
      await waitForStatusToolbarCounts(page, '采购审核', { 待审核: 3 - index, 已通过: 2 + index, 已取消: 0 })
      const before = reviewRequests.length
      const beforeLedger = await readPurchaseShippingMarkLedger(page)
      await openWorkbenchReview(page, target.orderNo)
      await waitForVisibleDialog(page, '审核采购订单？')
      await page.waitFor(`document.querySelector('[data-testid="purchase-order-review-confirmation"]')?.textContent.includes(${JSON.stringify(target.orderNo)})`)
      assert.equal(reviewRequests.length, before, '读取审核摘要不会提交审核')
      await page.waitFor(`document.querySelector('[data-slot="purchase-order-drawer-parts"] button[aria-expanded="false"]') !== null`)
      assert.deepEqual(await readPurchaseShippingMarkLedger(page), beforeLedger, '审核确认弹窗不得预占唛头')
      assert.equal(await page.evaluate(`document.querySelector('[data-testid="purchase-order-review-confirmation"]')?.textContent.includes(${JSON.stringify(target.supplier.label)})`), true)
      assert.equal(await page.evaluate(`[...document.querySelectorAll('button')].find(button => button.getClientRects().length > 0 && button.textContent.trim() === '确认审核')?.disabled`), true, '没有采购单图片不得审核')
      await clickDialogButton(page, '审核采购订单？', '生成采购单图片')
      await page.waitFor(`document.querySelector('[data-slot="purchase-order-review-image"] img')?.naturalWidth > 0
        && [...document.querySelectorAll('button')].find(button => button.getClientRects().length > 0 && button.textContent.trim() === '确认审核')?.disabled === false`)
      const prepared = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(target.id)}`))
      const draftResponse = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(target.id)}/order-image-draft`))
      assert.equal(prepared.body?.orderStatus, 'PENDING_REVIEW')
      assert.equal(prepared.body?.version, target.version + 1)
      assert.equal(draftResponse.body?.draft?.isCurrent, true)
      const imageDraftId = draftResponse.body.draft.id
      const preparedLedger = await readPurchaseShippingMarkLedger(page)
      assert.equal(preparedLedger.length, beforeLedger.length + 1, '生成图片时只派发一个基础唛头')
      if (index === 0) {
        const reviewModalStyles = []
        for (const appearance of [
          { label: 'light', theme: 'light', width: 1440, height: 900, mobile: false },
          { label: 'dark', theme: 'dark', width: 1440, height: 900, mobile: false },
          { label: 'mobile', theme: 'light', width: 390, height: 844, mobile: true },
        ]) {
          await page.setViewport(appearance.width, appearance.height, appearance.mobile)
          await page.evaluate(`document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('appSettings').setColorScheme(${JSON.stringify(appearance.theme)})`)
          await page.waitFor(`innerWidth === ${appearance.width} && document.documentElement.classList.contains('dark') === ${appearance.theme === 'dark'}`)
          // 等字体、两帧布局和弹窗/按钮过渡完成；所有截图均发生在首次审核请求之前。
          await page.evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
          await page.waitFor(`(() => {
            const dialog = document.querySelector('[data-testid="purchase-order-review-confirmation"]')?.closest('[role="dialog"]')
            return dialog?.getAnimations({ subtree: true }).every(animation => animation.playState !== 'running')
          })()`)
          const geometry = await page.evaluate(`(() => {
            const content = document.querySelector('[data-testid="purchase-order-review-confirmation"]')
            const dialog = content.closest('[role="dialog"]')
            const rect = dialog.getBoundingClientRect()
            const style = getComputedStyle(dialog)
            const buttons = [...dialog.querySelectorAll('[data-slot="qs-generic-modal-footer"] button')]
              .filter(button => ['关闭', '确认审核'].includes(button.textContent.trim()))
            return {
              background: style.backgroundColor,
              color: style.color,
              dialogFits: rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1
                && rect.top >= 0 && rect.bottom <= innerHeight + 1,
              contentFits: content.scrollWidth <= content.clientWidth + 1,
              documentFits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
              reachable: buttons.length === 2 && buttons.every(button => {
                const bounds = button.getBoundingClientRect()
                return !button.disabled && bounds.width >= 44 && bounds.height + 0.001 >= ${appearance.mobile ? 44 : 36}
                  && bounds.top >= 0 && bounds.bottom <= innerHeight
                  && button.contains(document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2))
              }),
            }
          })()`)
          await saveNumberingScreenshot(page, `purchase-review-confirmation-${appearance.label}`)
          const { background, color, ...layout } = geometry
          reviewModalStyles.push({ background, color })
          assert.deepEqual(layout, { dialogFits: true, contentFits: true, documentFits: true, reachable: true }, appearance.label)
          assert.equal(reviewRequests.length, before, '切换主题与视口不应提交审核')
        }
        assert.notEqual(reviewModalStyles[0].background, reviewModalStyles[1].background)
        assert.notEqual(reviewModalStyles[0].color, reviewModalStyles[1].color)
        await page.setViewport(1440, 900, false)
        await page.waitFor(`innerWidth === 1440 && !document.documentElement.classList.contains('dark')`)
        await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
        await clickDialogButton(page, '审核采购订单？', '关闭')
        await waitForNoVisibleDialog(page, '审核采购订单？')
        assert.equal(reviewRequests.length, before, '关闭不应提交审核')
        assert.deepEqual(await readPurchaseShippingMarkLedger(page), preparedLedger, '关闭保留已派发的唛头')
        await openWorkbenchReview(page, target.orderNo)
        await waitForVisibleDialog(page, '审核采购订单？')
        await page.waitFor(`document.querySelector('[data-testid="purchase-order-review-confirmation"]')?.textContent.includes(${JSON.stringify(target.orderNo)})`)
      }
      if (index === 1) {
        await fillLabelledControl(page, '审核说明（可选）', 'Browser 审核冲突后保留说明')
        await page.enableRequestInterception([{ urlPattern: '*/api/purchase-orders/*/review', requestStage: 'Request' }])
        const pausedRequest = page.waitForEvent('Fetch.requestPaused', event => event.request.method === 'POST')
        await clickDialogButton(page, '审核采购订单？', '确认审核')
        const paused = await pausedRequest
        // 首次请求暂停期间按钮必须锁定；随后注入公开冲突契约，验证失败后重新取详情。
        assert.equal(await page.evaluate(`(() => {
          const button = [...document.querySelectorAll('button')].find(item => item.getClientRects().length > 0 && item.textContent.trim() === '确认审核')
          return button?.disabled === true
        })()`), true)
        await page.connection.send('Fetch.fulfillRequest', {
          requestId: paused.requestId,
          responseCode: 409,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(JSON.stringify({ code: 'PURCHASE_ORDER_STATE_CHANGED', message: '采购订单已变化或已完成审核，请刷新后重试', requestId: 'browser-review-conflict' })).toString('base64'),
        })
        await page.disableRequestInterception()
        await page.waitFor(`document.querySelector('[data-testid="purchase-order-review-confirmation"]')?.textContent.includes('已重新加载最新订单')`)
        assert.equal(await page.evaluate(`document.querySelector('[data-testid="purchase-order-review-confirmation"] textarea')?.value`), 'Browser 审核冲突后保留说明')
        assert.equal(reviewRequests.length, before + 1, '审核冲突不自动重试 POST')
        const unchanged = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(target.id)}`))
        assert.equal(unchanged.body?.orderStatus, 'PENDING_REVIEW')
        assert.equal(unchanged.body?.shippingMarkText, prepared.body.shippingMarkText)
        assert.deepEqual(await readPurchaseShippingMarkLedger(page), preparedLedger)
      }
      await clickDialogButton(page, '审核采购订单？', '确认审核')
      await waitForNoVisibleDialog(page, '审核采购订单？')
      const reviewed = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(target.id)}`))
      assert.equal(reviewed.status, 200)
      assert.equal(reviewed.body?.orderStatus, 'CONFIRMED')
      assert.equal(reviewed.body?.fulfillmentStatus, 'PREPARING')
      assert.equal(reviewed.body?.version, target.version + 2)
      assert.equal(reviewed.body?.orderNo, target.orderNo)
      assert.match(reviewed.body?.shippingMarkText ?? '', index === 1 ? /^CUSTOM-\d{8}$/u : /^BRW-\d{8}$/u)
      const base = reviewed.body.shippingMarkText
      assert.deepEqual(reviewed.body.shippingMarks, index === 0 ? [`${base}/货件-01`, `${base}/货件-02`] : [base])
      assert.deepEqual(reviewed.body.parts.map(part => part.shippingMarkText), reviewed.body.shippingMarks)
      const afterLedger = await readPurchaseShippingMarkLedger(page)
      const newIssuances = afterLedger.filter(issuance => !beforeLedger.some(previous => previous.id === issuance.id))
      assert.equal(afterLedger.length, beforeLedger.length + 1, '审核不得重复派发已在生成图片时取得的基础唛头')
      assert.equal(reviewed.body.documents.filter(document => document.documentType === 'ORDER_ISSUANCE_VOUCHER' && !document.detachedAt).length, 1, '审核原子归档唯一采购单图片')
      assert.equal(newIssuances.length, 1)
      assert.equal(newIssuances[0].consumerCode, 'PURCHASE_ORDER.REVIEW_SHIPPING_MARK')
      assert.equal(newIssuances[0].generatedNumber, base)
      const staleReview = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(target.id)}/review`, 'POST', { expectedVersion: target.version, imageDraftId }))
      assert.equal(staleReview.status, 409)
      assert.equal(staleReview.body.code, 'PURCHASE_ORDER_STATE_CHANGED')
      assert.deepEqual(await readPurchaseShippingMarkLedger(page), afterLedger, '重复审核不得重派基础号')
      assert.ok(reviewRequests.at(-1)?.expectedVersion >= 1)
      await waitForStatusToolbarCounts(page, '采购审核', { 待审核: 2 - index, 已通过: 3 + index, 已取消: 0 })
      await page.navigate(appRouteUrl(configuration.baseUrl, index === 0 ? listRoute : pendingRoute))
      await waitForStatusToolbarCounts(page, index === 0 ? '全部采购状态筛选' : '待办采购状态筛选', index === 0
        ? { 全部采购: 5, 采购审核中: 2, 已确认: 3, 已完成: 0, 已取消: 0 }
        : { 采购审核中: 2 - index, 待发货: 3 + index, 待入仓: 0, 待付款: 3 + index })
      Object.assign(target, { shippingMarkText: base, shippingMarks: reviewed.body.shippingMarks })
      if (index === 0) {
        const bySecondMark = await page.evaluate(apiExpression(`/api/purchase-orders?view=all&page=1&pageSize=20&keyword=${encodeURIComponent(reviewed.body.shippingMarks[1])}`))
        assert.equal(bySecondMark.status, 200)
        assert.deepEqual(bySecondMark.body.items.map(item => item.id), [target.id])
        await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
        await waitForPurchaseList(page, target.orderNo)
        await assertPurchaseShippingMarksInteraction(page, target)
        await clickVisibleAriaButton(page, `${target.orderNo}：详情`)
        await assertPurchasePartDetail(page, reviewed.body, true)
        await clickVisibleAriaButton(page, '关闭抽屉')
        await page.waitFor(`!document.querySelector('[data-testid="purchase-order-detail-drawer"]')?.getClientRects().length`)
      }
      process.stdout.write(`[numbering-browser] purchase review case ${index + 1}/3: confirmed and counts refreshed\n`)
    }
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    // 两运营页共享表格标识；先等全部页独有工具栏，避免点击仍在离场的待办页。
    await waitForStatusToolbarCounts(page, '全部采购状态筛选', { 全部采购: 5, 采购审核中: 0, 已确认: 5, 已完成: 0, 已取消: 0 })
    await waitForPurchaseList(page, order.orderNo)
  })

  await runPurchaseOrderBrowserStep('detail and full payment', async () => {
    await clickVisibleAriaButton(page, `${order.orderNo}：详情`)
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-detail-drawer"] section[aria-label="采购产品列表"]') !== null`)
    // 产品图片采用懒加载；先滚动至产品区再验证真实图像加载，避免离屏图片尚未请求。
    await page.evaluate(`(() => {
      document.querySelector('[data-testid="purchase-order-detail-drawer"] section[aria-label="采购产品列表"]').scrollIntoView({ block: 'center' })
      return true
    })()`)
    const detailSections = await page.evaluate(`(() => {
      const drawer = document.querySelector('[data-testid="purchase-order-detail-drawer"]')
      return {
        basic: drawer.textContent.includes('订单基础信息'),
        products: drawer.textContent.includes('采购产品列表'),
        payments: drawer.textContent.includes('实际付款记录'),
        documents: drawer.textContent.includes('订单凭证'),
        activeTab: drawer.querySelector('[role="tab"][aria-selected="true"]')?.textContent.includes('订单详情信息'),
        product: drawer.textContent.includes(${JSON.stringify(productNo)}),
        shippingMark: drawer.textContent.includes(${JSON.stringify(order.shippingMarks[0])}),
      }
    })()`)
    assert.deepEqual(detailSections, { basic: true, products: true, payments: true, documents: true, activeTab: true, product: true, shippingMark: true })
    await page.waitFor(`(() => {
      const drawer = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      const productImage = drawer?.querySelector(
        'section[aria-label="采购产品列表"] [data-slot="image-group"] img',
      )
      return drawer?.querySelector('[data-testid="purchase-order-detail-drawer"]')
        && !drawer.querySelector('[data-slot="qs-purchase-order-desc"]')
        && drawer.textContent.includes('订单基础信息')
        && drawer.textContent.includes('采购产品列表')
        && drawer.textContent.includes('实际付款记录')
        && drawer.textContent.includes('订单凭证')
        && drawer.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent.includes('订单详情信息')
        && drawer.textContent.includes(${JSON.stringify(productNo)})
        && drawer.textContent.includes(${JSON.stringify(order.shippingMarks[0])})
        && productImage instanceof HTMLImageElement
        && productImage.src.includes('/api/purchase-orders/${order.id}/lines/')
        && productImage.complete
        && productImage.naturalWidth > 0
    })()`)
    const partsDetail = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(order.id)}`))
    assert.equal(partsDetail.status, 200)
    await assertPurchasePartDetail(page, partsDetail.body)
    await clickOrderDrawerTab(page, 'purchase-order-detail-drawer', '订单变更记录')
    await page.waitFor(`document.querySelector(
      '[data-testid="purchase-order-detail-drawer"] section[aria-label="订单变更记录"]',
    )?.getClientRects().length > 0`)
    await clickOrderDrawerTab(page, 'purchase-order-detail-drawer', '订单详情信息')
    // 全部采购详情只读；财务分别结清定金和尾款，每笔必须上传截图。
    assert.equal(await page.evaluate(`[...document.querySelectorAll('[data-testid="purchase-order-detail-drawer"] button')].some(button => button.textContent.trim() === '记录付款')`), false)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await waitForNoVisibleDialog(page, order.orderNo)
    await payPurchaseInstallments(page, configuration, order, [
      { type: 'DEPOSIT', label: '定金', amount: '20.00' },
      { type: 'BALANCE', label: '尾款', amount: '60.00' },
    ], voucherFixture)
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-detail-drawer"]')?.textContent.includes('已付清')`)
    await expandFirstPaymentRecord(page)
    const paidDetail = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(order.id)}`,
    ))
    assert.equal(paidDetail.status, 200)
    assert.equal(paidDetail.body?.paymentStatus, 'PAID')
    assert.equal(paidDetail.body?.payments?.length, 2)
    assert.deepEqual(paidDetail.body.payments.map(payment => payment.amount).sort(), ['20.00', '60.00'])
    assert.equal(paidDetail.body.documents.filter(document => document.documentType === 'PAYMENT_VOUCHER' && document.detachedAt === null).length, 2)
    await clickOrderDrawerTab(page, 'purchase-order-detail-drawer', '订单变更记录')
    await page.waitFor(`(() => {
      const history = document.querySelector(
        '[data-testid="purchase-order-detail-drawer"] section[aria-label="订单变更记录"]',
      )
      return history?.innerText.includes('付款状态变更')
        && history.innerText.includes('未付款')
        && history.innerText.includes('已付清')
    })()`)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await page.waitFor(`![...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && dialog.textContent?.includes(${JSON.stringify(order.orderNo)}))`)
    // 等待 Vue 把 v-model=false 刷入抽屉子组件，避免同一帧再次打开时
    // false -> true 被批处理成未变化，令子组件 localOpen 停留在 false。
    await page.evaluate(`new Promise(resolve => requestAnimationFrame(
      () => requestAnimationFrame(resolve),
    ))`)
    await waitForPurchaseList(page, order.orderNo)
  })

  await runPurchaseOrderBrowserStep('pending purchase ships through confirmation modal', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, pendingRoute))
    await waitForPurchaseList(page, order.orderNo)
    await waitForStatusToolbarCounts(page, '待办采购状态筛选', {
      待发货: 5,
      待付款: 4,
      待入仓: 0,
    })
    await clickVisibleAriaButton(page, `${order.orderNo}：发货`)
    await waitForVisibleDialog(page, '确认货件发货')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('确认货件发货'))
      return dialog?.textContent?.includes(${JSON.stringify(order.orderNo)})
        && dialog.textContent.includes(${JSON.stringify(supplierLabel)})
        && dialog.textContent.includes('待发货')
        && !dialog.textContent.includes('系统将顺序推进采购履约状态')
    })()`)
    await selectShipmentWarehouses(page)
    await fillLabelledControl(page, '发货说明（可选）', 'Browser 独立备货采购发货')
    // 审核后已经备货中，直接注入公开冲突契约，验证重新加载和二次确认边界。
    await page.enableRequestInterception([{ urlPattern: '*/api/purchase-orders/*/factory-shipments', requestStage: 'Request' }])
    const pausedShipment = page.waitForEvent('Fetch.requestPaused', event => event.request.method === 'POST')
    await clickDialogButton(page, '确认货件发货', '确认发货（1 件）')
    await page.connection.send('Fetch.fulfillRequest', {
      requestId: (await pausedShipment).requestId,
      responseCode: 409,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ code: 'FACTORY_SHIPMENT_STATE_CHANGED', message: '订单状态已变化，请刷新后重新确认发货范围', requestId: 'browser-shipment-conflict' })).toString('base64'),
    })
    await page.disableRequestInterception()
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('确认货件发货'))
      return dialog?.textContent?.includes('订单状态已变化，请刷新后重新确认发货范围')
        && [...dialog.querySelectorAll('button')].some(button => (
          button.getClientRects().length > 0
          && button.textContent?.trim() === '重新加载'
        ))
    })()`)
    await clickDialogButton(page, '确认货件发货', '重新加载')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('确认货件发货'))
      return dialog?.textContent?.includes('待发货')
        && !dialog.textContent.includes('订单状态已变化，请刷新后重新确认发货范围')
        && !dialog.textContent.includes('系统将顺序推进采购履约状态')
    })()`)
    await selectShipmentWarehouses(page)
    await fillLabelledControl(page, '发货说明（可选）', 'Browser 冲突刷新后发货')
    await clickDialogButton(page, '确认货件发货', '确认发货（1 件）')
    await waitForNoVisibleDialog(page, '确认货件发货')
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="success"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes('所选货件已发货'))`)
    await waitForPurchaseList(page, linkedOrder.orderNo)
    await waitForStatusToolbarCounts(page, '待办采购状态筛选', {
      待发货: 4,
      待付款: 4,
      待入仓: 1,
    })
    assert.equal(await page.evaluate(`(() => [...document.querySelectorAll(
      '[data-slot="qs-generic-drawer"]',
    )].filter(drawer => drawer.getClientRects().length > 0).length)()`), 0)
    const pending = await readPurchaseOrders(page, 'pending')
    assert.equal(pending.status, 200)
    assert.equal(pending.body?.total, 5)
    assert.deepEqual(
      new Set(pending.body?.items?.map(item => item.id)),
      new Set([
        catalogLinkedOrder.id,
        linkedOrder.id,
        order.id,
        historicalMixedActiveOrder.id,
        historicalMixedCancelableOrder.id,
      ]),
    )
    const shippedOrder = pending.body?.items?.find(item => item.id === order.id)
    assert.equal(shippedOrder?.fulfillmentStatus, 'SHIPPED')
  })

  await runPurchaseOrderBrowserStep('sales order ships all linked purchases and advances', async () => {
    await page.navigate(appRouteUrl(
      configuration.baseUrl,
      '/qs-operations/sales/pending-sales-orders?status=PREPARING',
    ))
    await waitForAfterAuthentication(page, `(() => {
      const table = document.querySelector('[data-testid="sales-order-list-table"]')
      const action = document.querySelector(
        'button[aria-label=' + CSS.escape(${JSON.stringify(`${salesOrderNo}：工厂发货`)}) + ']',
      )
      return table?.getClientRects().length > 0
        && !table.querySelector('[aria-busy="true"]')
        && table.textContent?.includes(${JSON.stringify(salesOrderNo)})
        && action?.getClientRects().length > 0
    })()`)
    const salesBefore = await page.evaluate(apiExpression(
      `/api/sales-orders?orderStatus=CONFIRMED&fulfillmentStatus=PREPARING&page=1&pageSize=20&keyword=${encodeURIComponent(salesOrderNo)}`,
    ))
    assert.equal(salesBefore.status, 200)
    const salesOrder = salesBefore.body?.items?.find(item => item.orderNo === salesOrderNo)
    assert.ok(salesOrder?.id)

    await clickVisibleAriaButton(page, `${salesOrderNo}：工厂发货`)
    await waitForVisibleDialog(page, '确认工厂发货范围')
    const linkedSection = `(() => [...document.querySelectorAll('[data-slot="factory-shipment-order-list"] > section')]
      .find(section => section.getClientRects().length > 0 && section.textContent.includes(${JSON.stringify(linkedOrder.orderNo)})))()`
    await page.waitFor(`(() => {
      const section = ${linkedSection}
      const dialog = section?.closest('[role="dialog"]')
      const checkboxes = [...(dialog?.querySelectorAll('input[type="checkbox"]') ?? [])]
      return dialog?.textContent.includes(${JSON.stringify(salesOrderNo)})
        && dialog.textContent.includes(${JSON.stringify(salesCustomerName)})
        && checkboxes.length === 3 && checkboxes.every(input => !input.checked)
        && section.querySelector('button[aria-expanded="false"]') !== null
        && getComputedStyle(dialog.querySelector('[data-slot="factory-shipment-order-list"]')).overflowY === 'auto'
    })()`)
    await page.evaluate(`(() => { ${linkedSection}.querySelector('button[aria-expanded="false"]').click(); return true })()`)
    await page.waitFor(`(() => {
      const section = ${linkedSection}
      return section.querySelector('button[aria-expanded="true"]') !== null
        && section.textContent.includes(${JSON.stringify(purchaseCustomName)})
        && section.textContent.includes('本货件数量')
        && !section.querySelector('input[type="checkbox"]').checked
    })()`)
    await page.evaluate(`(() => { ${linkedSection}.querySelector('input[type="checkbox"]').click(); return true })()`)
    await selectShipmentWarehouses(page)
    await page.waitFor(`(() => {
      const section = ${linkedSection}
      const dialog = section.closest('[role="dialog"]')
      return section.querySelector('input[type="checkbox"]').checked
        && section.querySelector('button[aria-expanded="true"]') !== null
        && [...dialog.querySelectorAll('button')].some(button => !button.disabled && button.textContent.includes('确认发货（1 件）'))
    })()`)
    await clickDialogButton(page, '确认工厂发货范围', '全选未发货')
    await selectShipmentWarehouses(page)
    await page.waitFor(`(() => {
      const dialog = ${linkedSection}?.closest('[role="dialog"]')
      const inputs = [...dialog.querySelectorAll('input[type="checkbox"]')]
      return inputs.length === 3 && inputs.every(input => input.checked)
        && [...dialog.querySelectorAll('button')].some(button => !button.disabled && button.textContent.includes('确认发货（3 件）'))
    })()`)
    await fillLabelledControl(page, '发货说明（可选）', 'Browser 销售订单全部工厂发货')
    await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('确认工厂发货范围'))
      const button = [...(dialog?.querySelectorAll('button') ?? [])]
        .find(candidate => candidate.getClientRects().length > 0
          && !candidate.disabled
          && candidate.textContent?.includes('确认发货')
          && !candidate.textContent.includes('全部待发货采购单'))
      if (!(button instanceof HTMLButtonElement)) {
        throw new Error('sales factory-shipment submit is unavailable')
      }
      button.click()
      return true
    })()`)
    await waitForNoVisibleDialog(page, '确认工厂发货范围')
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="success"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes('已完成 2 张采购单的本次货件发货，销售订单已进入陆运中'))`)

    const salesAfter = await page.evaluate(apiExpression(
      `/api/sales-orders/${encodeURIComponent(salesOrder.id)}`,
    ))
    assert.equal(salesAfter.status, 200)
    assert.equal(salesAfter.body?.fulfillmentStatus, 'LAND_TRANSIT')
    const linkedAfter = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(linkedOrder.id)}`,
    ))
    assert.equal(linkedAfter.status, 200)
    assert.equal(linkedAfter.body?.fulfillmentStatus, 'SHIPPED')
    const catalogLinkedAfter = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(catalogLinkedOrder.id)}`,
    ))
    assert.equal(catalogLinkedAfter.status, 200)
    assert.equal(catalogLinkedAfter.body?.fulfillmentStatus, 'SHIPPED')
  })

  await runPurchaseOrderBrowserStep('historical MIXED payment, missing-part shipment guard, and cancellation', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    await waitForPurchaseList(page, historicalMixedActiveOrderNo)
    await clickVisibleAriaButton(page, `${historicalMixedActiveOrderNo}：详情`)
    await page.waitFor(`(() => {
      const drawer = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes(${JSON.stringify(historicalMixedActiveOrderNo)}))
      const catalogImage = drawer?.querySelector(
        'section[aria-label="采购产品列表"] [data-slot="image-group"] img',
      )
      return drawer?.textContent?.includes(${JSON.stringify(historicalMixedCatalogProductName)})
        && drawer.textContent.includes(${JSON.stringify(historicalMixedCustomProductName)})
        && drawer.textContent.includes('真实采购价')
        && drawer.textContent.includes('30.00 CNY')
        && catalogImage instanceof HTMLImageElement
        && catalogImage.complete
        && catalogImage.naturalWidth > 0
    })()`)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await waitForNoVisibleDialog(page, historicalMixedActiveOrderNo)
    await payPurchaseInstallments(page, configuration, historicalMixedActiveOrder, [
      { type: 'DEPOSIT', label: '定金', amount: '10.00' },
    ], voucherFixture)
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-detail-drawer"]')?.textContent.includes('部分付款')`)
    await expandFirstPaymentRecord(page)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await waitForNoVisibleDialog(page, historicalMixedActiveOrderNo)

    await page.navigate(appRouteUrl(configuration.baseUrl, pendingRoute))
    await waitForPurchaseList(page, historicalMixedActiveOrderNo)
    await clickVisibleAriaButton(page, `${historicalMixedActiveOrderNo}：发货`)
    await waitForVisibleDialog(page, '确认货件发货')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')].find(candidate => candidate.getClientRects().length > 0 && candidate.textContent.includes('确认货件发货'))
      return dialog?.textContent.includes('未记录货件，无法发货')
        && [...dialog.querySelectorAll('button')].some(button => button.textContent.includes('确认发货（0 件）') && button.disabled)
    })()`)
    const beforeInvalidShipment = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(historicalMixedActiveOrder.id)}`))
    assert.equal(beforeInvalidShipment.status, 200)
    assert.deepEqual(beforeInvalidShipment.body.parts, [])
    const invalidShipment = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(historicalMixedActiveOrder.id)}/factory-shipments`, 'POST', {
      expectedVersion: beforeInvalidShipment.body.version,
      partIds: ['ffffffff-ffff-4fff-8fff-ffffffffffff'],
      destinationWarehouses: [{ partId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', warehouseValue: 'BROWSER_WAREHOUSE' }],
      reason: 'Browser 无货件禁止发货',
    }))
    assert.equal(invalidShipment.status, 422)
    assert.equal(invalidShipment.body.code, 'FACTORY_SHIPMENT_TARGET_INVALID')
    const afterInvalidShipment = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(historicalMixedActiveOrder.id)}`))
    assert.equal(afterInvalidShipment.body.version, beforeInvalidShipment.body.version)
    assert.equal(afterInvalidShipment.body.fulfillmentStatus, 'ORDERED')
    assert.deepEqual(afterInvalidShipment.body.parts, [])
    await clickDialogButton(page, '确认货件发货', '取消')
    await waitForNoVisibleDialog(page, '确认货件发货')
    await waitForPurchaseList(page, historicalMixedCancelableOrderNo)

    await page.navigate(appRouteUrl(configuration.baseUrl, '/qs-purchase-transport/reviews'))
    const approvedTabSource = `(() => [...document.querySelectorAll('[data-slot="qs-status-switch-toolbar"][aria-label="采购审核"] [data-slot="qs-status-switch-item"]')]
      .find(button => button.getClientRects().length > 0 && button.querySelector('span')?.textContent.trim() === '已通过'))()`
    await page.waitFor(`${approvedTabSource} !== undefined`)
    await page.evaluate(`(() => { const button = ${approvedTabSource}; button.focus({ preventScroll: true }); button.click(); return true })()`)
    // 审核列表没有运营列表的 data-testid，直接等待当前订单的专用取消入口。
    await clickVisibleAriaButton(page, `${historicalMixedCancelableOrderNo}：取消采购单`)
    await waitForVisibleDialog(page, '确认取消采购单？')
    await page.connection.send('Browser.grantPermissions', {
      origin: new URL(configuration.baseUrl).origin,
      permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
    })
    await clickDialogButton(page, '确认取消采购单？', '确认取消并复制')
    await waitForNoVisibleDialog(page, '确认取消采购单？')
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="success"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes('采购单已取消'))`)
    const cancellationText = await page.evaluate('navigator.clipboard.readText()')
    assert.ok(cancellationText.startsWith(`【订单取消：${historicalMixedCancelableOrderNo}】`))
    assert.ok(cancellationText.includes('[采购产品明细]'))

    const activeAfter = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(historicalMixedActiveOrder.id)}`,
    ))
    assert.equal(activeAfter.status, 200)
    assert.equal(activeAfter.body?.productMode, 'MIXED')
    assert.equal(activeAfter.body?.fulfillmentStatus, 'ORDERED')
    assert.equal(activeAfter.body?.paymentStatus, 'PARTIALLY_PAID')
    assert.equal(activeAfter.body?.paidAmount, '10.00')
    assert.deepEqual(
      activeAfter.body?.lines?.map(line => line.lineType),
      ['CATALOG', 'CUSTOM'],
    )

    const cancelledAfter = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(historicalMixedCancelableOrder.id)}`,
    ))
    assert.equal(cancelledAfter.status, 200)
    assert.equal(cancelledAfter.body?.productMode, 'MIXED')
    assert.equal(cancelledAfter.body?.orderStatus, 'CANCELLED')
    assert.equal(cancelledAfter.body?.fulfillmentStatus, 'ORDERED')
    assert.equal(cancelledAfter.body?.paymentStatus, 'UNPAID')
  })

  await runPurchaseOrderBrowserStep('operations cannot cancel an unreviewed purchase or allocate its shipping mark', async () => {
    const beforeLedger = await readPurchaseShippingMarkLedger(page)
    const resolution = await page.evaluate(apiExpression('/api/purchase-orders/shipping-mark-resolution?productMode=CUSTOM'))
    assert.equal(resolution.status, 200)
    const pending = await page.evaluate(`(async () => {
      const response = await fetch('/api/purchase-orders', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Qianshu-CSRF': '1', 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({
          purchaseType: 'STOCK', productMode: 'CUSTOM', customSupplierName: 'Browser 待审核取消供应商',
          paymentAccounts: [${JSON.stringify(customBankAccount)}],
          orderDate: ${JSON.stringify(order.orderDate)}, expectedShippingMarkResolution: ${JSON.stringify(resolution.body.resolutionToken)},
          lines: [{ lineType: 'CUSTOM', name: 'Browser 待审核取消产品', referencePurchaseUnitPriceAmount: '1', actualPurchaseUnitPriceAmount: '1', quantity: 1 }],
          parts: [{ key: crypto.randomUUID(), items: [{ lineNumber: 1, quantity: 1 }] }],
          purchaseTotalAmount: '1', depositDueAmount: '0', balanceDueAmount: '1',
        }),
      })
      return { status: response.status, body: await response.json() }
    })()`)
    assert.equal(pending.status, 201)
    assert.equal(pending.body.shippingMarkText, null)
    assert.deepEqual(pending.body.shippingMarks, [])
    assert.equal(pending.body.parts[0].shippingMarkText, null)
    // 数据由 HTTP 准备；进入审核中视图触发真实查询，确认新订单也没有运营取消入口。
    await page.navigate(appRouteUrl(configuration.baseUrl, `${listRoute}?status=PENDING_REVIEW`))
    await waitForPurchaseList(page, pending.body.orderNo)
    const pendingActionsSource = purchaseOrderActionButtonsSource(pending.body.orderNo)
    await page.waitFor(`${pendingActionsSource}.length === 1`)
    assert.deepEqual(await page.evaluate(`${pendingActionsSource}.map(button => button.textContent.trim())`), ['详情'])
    const unchanged = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(pending.body.id)}`))
    assert.equal(unchanged.status, 200)
    assert.equal(unchanged.body.orderStatus, 'PENDING_REVIEW')
    assert.equal(unchanged.body.shippingMarkText, null)
    assert.deepEqual(unchanged.body.shippingMarks, [])
    assert.equal(unchanged.body.parts[0].shippingMarkText, null)
    assert.deepEqual(await readPurchaseShippingMarkLedger(page), beforeLedger)
  })

  await runPurchaseOrderBrowserStep('390x844 light dark and touch targets', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    await waitForPurchaseList(page, order.orderNo)
    await page.setViewport(390, 844, true)
    await page.navigate(await page.evaluate('location.href'))
    await waitForAfterAuthentication(page, `(() => {
      const card = [...document.querySelectorAll(
        '[data-testid="purchase-order-mobile-summary"]',
      )].find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes(${JSON.stringify(order.orderNo)})
        && candidate.textContent?.includes('采购人')
        && candidate.textContent?.includes('Browser Auth Admin'))
      return innerWidth === 390 && card
    })()`)
    // 页头带入场缩放；必须等视觉尺寸稳定后再验收物理触控目标，避免采到
    // 44px 按钮动画中的约 0.9 倍中间帧。
    await page.waitFor(`(() => {
      const headerButtons = [...document.querySelectorAll('button')]
        .filter(button => button.getClientRects().length > 0
          && ['新增采购', '新增备货采购']
            .includes(button.textContent?.trim()))
      return headerButtons.length === 2 && headerButtons.every(button => (
        button.getBoundingClientRect().height + 0.001 >= 44
      ))
    })()`)
    const mobile = await page.evaluate(`(() => {
      const card = [...document.querySelectorAll(
        '[data-testid="purchase-order-mobile-summary"]',
      )].find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      const headerButtons = [...document.querySelectorAll('button')]
        .filter(button => button.getClientRects().length > 0
          && ['新增采购', '新增备货采购']
            .includes(button.textContent?.trim()))
      const mobileActions = card?.parentElement?.querySelector(
        '[data-slot="qs-generic-table-mobile-actions"]',
      )
      const rowButtons = [...(mobileActions?.querySelectorAll('button') ?? [])]
        .filter(button => button.getClientRects().length > 0
          && button.textContent?.trim() === '详情')
      const buttons = [...headerButtons, ...rowButtons]
      const rect = card?.getBoundingClientRect()
      return {
        cardInside: Boolean(rect && rect.left >= 0
          && rect.right <= document.documentElement.clientWidth),
        documentFits: document.documentElement.scrollWidth
          <= document.documentElement.clientWidth,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
        touchTargetDetails: buttons.map(button => ({
          height: button.getBoundingClientRect().height,
          label: button.textContent?.trim(),
        })),
        touchTargets: buttons.length >= 3 && buttons.every(button => (
          button.getBoundingClientRect().height + 0.001 >= 44
        )),
      }
    })()`)
    const { touchTargetDetails, ...mobileResult } = mobile
    assert.equal(
      mobileResult.touchTargets,
      true,
      `采购移动端触控目标不合格：${JSON.stringify(touchTargetDetails)}`,
    )
    assert.deepEqual(mobileResult, {
      cardInside: true,
      documentFits: true,
      reducedMotion: true,
      touchTargets: true,
    })

    await page.evaluate(`(() => {
      const app = document.querySelector('#app')?.__vue_app__
      app?.config?.globalProperties?.$pinia?._s
        ?.get('appSettings')?.setColorScheme('light')
      return true
    })()`)
    await page.waitFor(`!document.documentElement.classList.contains('dark')`)
    const light = await page.evaluate(`(() => {
      const card = [...document.querySelectorAll(
        '[data-testid="purchase-order-mobile-summary"]',
      )].find(candidate => candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      const cardStyle = card?.parentElement ? getComputedStyle(card.parentElement) : null
      const textStyle = card ? getComputedStyle(card) : null
      return { background: cardStyle?.backgroundColor, color: textStyle?.color }
    })()`)
    await page.evaluate(`(() => {
      const app = document.querySelector('#app')?.__vue_app__
      app?.config?.globalProperties?.$pinia?._s
        ?.get('appSettings')?.setColorScheme('dark')
      return true
    })()`)
    await page.waitFor(`document.documentElement.classList.contains('dark')`)
    const dark = await page.evaluate(`(() => {
      const card = [...document.querySelectorAll(
        '[data-testid="purchase-order-mobile-summary"]',
      )].find(candidate => candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      const cardStyle = card?.parentElement ? getComputedStyle(card.parentElement) : null
      const textStyle = card ? getComputedStyle(card) : null
      return { background: cardStyle?.backgroundColor, color: textStyle?.color }
    })()`)
    assert.notEqual(dark.background, light.background)
    assert.notEqual(dark.color, light.color)
  })

  runtime.stop()
  assert.deepEqual(runtime.issues, [])
})
