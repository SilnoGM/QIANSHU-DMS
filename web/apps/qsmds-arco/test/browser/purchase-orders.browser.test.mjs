/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'
import {
  clickDialogButton,
  runNumberingBrowserStep,
  waitForAfterAuthentication,
  waitForNoVisibleDialog,
  waitForVisibleDialog,
} from './numbering.browser.helpers.mjs'
import {
  apiExpression,
  appRouteUrl,
  clickVisibleButton,
  collectRuntimeIssues,
  loginThroughRealHttp,
  readConfiguration,
} from './regions.browser.helpers.mjs'

const listRoute = '/qs-operations/purchase/purchase-orders'
const pendingRoute = '/qs-operations/purchase/pending-purchase-orders'
const supplierLabel = 'Browser 有效供应商'
const productNo = 'PRODUCT-BROWSER-001'
const salesCustomerName = 'Browser 采购来源客户'
const purchaseCustomName = 'Browser 采购侧临时产品'
const purchaseCustomDescription = 'Browser 采购侧临时说明'

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

async function readPurchaseOrders(page, view = 'all') {
  return page.evaluate(apiExpression(
    `/api/purchase-orders?view=${encodeURIComponent(view)}&page=1&pageSize=20`,
  ))
}

async function waitForPurchaseList(page, expectedText) {
  await waitForAfterAuthentication(page, `(() => {
    const table = document.querySelector('[data-testid="purchase-order-list-table"]')
    return table?.getClientRects().length > 0
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
    const toolbar = document.querySelector(
      '[data-slot="qs-status-switch-toolbar"][aria-label='
        + CSS.escape(${JSON.stringify(ariaLabel)}) + ']',
    )
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

test('真实 Chrome 覆盖销售关联与备货采购创建、详情、付款、履约和响应式主题', {
  timeout: 600_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-purchase-orders`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  await page.setViewport(1440, 900, false)
  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })

  await runPurchaseOrderBrowserStep('real login and empty lists', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(page, configuration)
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    await waitForPurchaseList(page, '暂无采购订单')
    await waitForStatusToolbarCounts(page, '全部采购状态筛选', {
      全部采购: 0,
      已确认: 0,
      已完成: 0,
      已取消: 0,
    })
    const all = await readPurchaseOrders(page)
    assert.equal(all.status, 200)
    assert.equal(all.body?.total, 0)
    await page.navigate(appRouteUrl(configuration.baseUrl, pendingRoute))
    await waitForPurchaseList(page, '暂无待办采购')
    await waitForStatusToolbarCounts(page, '待办采购状态筛选', {
      待发货: 0,
      待付款: 0,
      待入仓: 0,
    })
    const pending = await readPurchaseOrders(page, 'pending')
    assert.equal(pending.status, 200)
    assert.equal(pending.body?.total, 0)
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    await waitForPurchaseList(page, '暂无采购订单')
  })

  const runtime = collectRuntimeIssues(page, {
    sensitiveValues: [configuration.password],
  })
  runtime.start()

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
      const search = document.querySelector('input[placeholder="搜索采购单号、销售单号或客户名"]')
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
    await page.evaluate(`(() => {
      const day = [...document.querySelectorAll('[data-slot="range-calendar-trigger"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && !candidate.disabled
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
    await waitForPurchaseList(page, '暂无采购订单')
  })

  let linkedOrder
  await runPurchaseOrderBrowserStep('sales-linked CUSTOM snapshot and final submission', async () => {
    await clickVisibleButton(page, '新增采购')
    await waitForAfterAuthentication(page, `(() => (
      location.hash.includes('/qs-operations/purchase/purchase-orders/create?type=SALES_LINKED')
      && document.querySelector('[data-testid="purchase-order-step-base"]')
        ?.getClientRects().length > 0
      && document.body.innerText.includes('新增采购订单')
      && document.body.innerText.includes('第 1 步，共 4 步')
    ))()`)

    await clickVisibleButton(page, '下一步')
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="warning"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes('请先完成并修正当前步骤的必填资料'))`)
    assert.equal(await page.evaluate(`document.querySelector('.purchase-order-alert-stack')
      ?.getClientRects().length ?? 0`), 0)
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-base"]')
      ?.getClientRects().length > 0`)

    await selectVisibleComboboxOption(page, '选择采购供应商', supplierLabel)
    await clickVisibleButton(page, '选择销售订单')
    await waitForVisibleDialog(page, '选择销售订单')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择销售订单'))
      return dialog?.textContent?.includes(${JSON.stringify(salesCustomerName)})
    })()`)
    await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择销售订单'))
      const order = [...(dialog?.querySelectorAll('[role="radio"]') ?? [])]
        .find(candidate => candidate.getAttribute('aria-label')
          ?.includes(${JSON.stringify(salesCustomerName)}))
      if (!order) throw new Error('purchase source sales order unavailable')
      order.click()
      return true
    })()`)
    await clickVisibleButton(page, '确认选择')
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
      return image instanceof HTMLImageElement
        && image.src.includes('/api/purchase-orders/product-options/')
        && image.complete
        && image.naturalWidth > 0
    })()`)
    await fillLabelledControl(page, '第 1 行本单采购价', '80')
    await fillLabelledControl(page, '第 2 行产品名称', purchaseCustomName)
    await fillLabelledControl(page, '第 2 行采购定价', '30')
    await fillLabelledControl(page, '第 2 行本单采购价', '30')
    await fillLabelledControl(page, '第 2 行备注', purchaseCustomDescription)
    await fillAriaControl(page, '定金', '20')
    await fillAriaControl(page, '尾款', '170')

    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-step-mark-remark"]')
      ?.getClientRects().length > 0`)
    await fillLabelledControl(page, '采购唛头', 'BROWSER LINKED MARK')
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
        && summary.textContent.includes(${JSON.stringify(purchaseCustomName)})
        && summary.textContent.includes(${JSON.stringify(purchaseCustomDescription)})
        && summary.textContent.includes('真实采购价')
        && !summary.textContent.includes('采购定价')
        && [...summary.querySelectorAll('[data-currency="CNY"]')]
          .some(amount => amount.getAttribute('aria-label')?.includes('160'))
        && summary.textContent.includes('BROWSER LINKED MARK')
        && summary.textContent.includes('BROWSER LINKED REMARK')
    })()`)

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
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('确认提交采购订单？'))
      return dialog?.textContent?.includes('销售关联采购')
        && dialog.textContent.includes(${JSON.stringify(supplierLabel)})
        && dialog.textContent.includes('190')
    })()`)
    await clickDialogButton(page, '确认提交采购订单？', '确认提交订单')
    await waitForPurchaseList(page, salesCustomerName)
    await page.waitFor(`(() => {
      const table = document.querySelector('[data-testid="purchase-order-list-table"]')
      return [...(table?.querySelectorAll('[data-slot="qs-person-display-name"]') ?? [])]
        .some(name => name.textContent?.trim() === 'Browser Auth Admin')
    })()`)

    const response = await readPurchaseOrders(page)
    assert.equal(response.status, 200)
    assert.equal(response.body?.total, 1)
    linkedOrder = response.body?.items?.find(item => item.purchaseType === 'SALES_LINKED')
    assert.match(linkedOrder?.orderNo ?? '', /^PO-BRW-\d{8}$/u)
    assert.equal(linkedOrder?.createdBy?.displayName, 'Browser Auth Admin')
    assert.equal(linkedOrder?.purchaseTotalAmount, '190.0000')
    assert.equal(linkedOrder?.depositDueAmount, '20.0000')
    assert.equal(linkedOrder?.balanceDueAmount, '170.0000')

    const detail = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(linkedOrder.id)}`,
    ))
    assert.equal(detail.status, 200)
    const customLine = detail.body?.lines?.find(line => line.lineType === 'CUSTOM')
    assert.equal(customLine?.productName, purchaseCustomName)
    assert.equal(customLine?.description, purchaseCustomDescription)
  })

  let order
  await runPurchaseOrderBrowserStep('stock creation and validation focus', async () => {
    await clickVisibleButton(page, '新增备货采购')
    await waitForAfterAuthentication(page, `(() => (
      location.hash.includes('/qs-operations/purchase/purchase-orders/create?type=STOCK')
      && document.querySelector('[data-testid="purchase-order-create-page"]')
        ?.getClientRects().length > 0
      && document.body.innerText.includes('PURCHASE_ORDER · AUTO')
      && document.body.innerText.includes('第 1 步，共 4 步')
      && document.querySelector('[data-testid="purchase-order-create-summary-column"]')
        ?.getClientRects().length > 0
      && !document.body.innerText.includes('选择销售订单')
      && !document.body.innerText.includes('同步销售产品明细')
    ))()`)

    await selectVisibleComboboxOption(page, '选择采购供应商', supplierLabel)
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
    await fillLabelledControl(page, '采购唛头', 'BROWSER STOCK MARK')
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-create-review"]')
      ?.getClientRects().length > 0`)
    await page.waitFor(`document.querySelector('[data-testid="purchase-order-create-summary-column"]')
      ?.textContent?.includes('BROWSER STOCK MARK')`)
    await clickVisibleButton(page, '提交订单')
    await waitForVisibleDialog(page, '确认提交采购订单？')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('确认提交采购订单？'))
      return dialog?.textContent?.includes('备货采购')
        && dialog.textContent.includes(${JSON.stringify(supplierLabel)})
        && dialog.textContent.includes('80')
    })()`)
    await clickDialogButton(page, '确认提交采购订单？', '确认提交订单')
    await waitForPurchaseList(page, supplierLabel)

    const response = await readPurchaseOrders(page)
    assert.equal(response.status, 200)
    assert.equal(response.body?.total, 2)
    order = response.body?.items?.find(item => item.purchaseType === 'STOCK')
    assert.match(order?.orderNo ?? '', /^PO-BRW-\d{8}$/u)
    assert.equal(order?.purchaseType, 'STOCK')
    assert.equal(order?.purchaseTotalAmount, '80.0000')
    assert.equal(order?.depositDueAmount, '20.0000')
    assert.equal(order?.balanceDueAmount, '60.0000')
  })

  await runPurchaseOrderBrowserStep('detail and full payment', async () => {
    await clickVisibleAriaButton(page, `${order.orderNo}：查看详情`)
    await page.waitFor(`(() => {
      const drawer = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      return drawer?.textContent?.includes('订单基础信息')
        && drawer.textContent.includes('采购产品与小计')
        && drawer.textContent.includes(${JSON.stringify(productNo)})
        && drawer.textContent.includes('BROWSER STOCK MARK')
        && drawer.textContent.includes('状态历史')
    })()`)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await page.waitFor(`![...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && dialog.textContent?.includes(${JSON.stringify(order.orderNo)}))`)

    await clickVisibleAriaButton(page, `${order.orderNo}：记录付款`)
    await waitForVisibleDialog(page, '记录实际付款')
    await fillLabelledControl(page, '付款金额', '80')
    await selectVisibleComboboxOption(page, '选择付款方式', 'Browser 银行转账')
    await clickDialogButton(page, '记录实际付款', '确认付款')
    await waitForNoVisibleDialog(page, '记录实际付款')
    await page.waitFor(`(() => {
      const drawer = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      return drawer?.textContent?.includes('已付清')
        && drawer.textContent.includes('Browser 银行转账')
    })()`)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await waitForPurchaseList(page, order.orderNo)
  })

  await runPurchaseOrderBrowserStep('sequential fulfillment leaves pending list', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, pendingRoute))
    await waitForPurchaseList(page, order.orderNo)
    await waitForStatusToolbarCounts(page, '待办采购状态筛选', {
      待发货: 2,
      待付款: 1,
      待入仓: 0,
    })
    await clickVisibleAriaButton(page, `${order.orderNo}：发货`)
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="info"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes('发货功能正在建设中'))`)

    // 待办操作首期只能提示，真实履约仍从全部采购详情入口回归。
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    await waitForPurchaseList(page, order.orderNo)

    for (const statusLabel of ['备货中', '已发货', '已签收']) {
      process.stdout.write(`[numbering-browser] purchase orders · fulfillment ${statusLabel}\n`)
      await clickVisibleAriaButton(page, `${order.orderNo}：推进履约`)
      await waitForVisibleDialog(page, '推进采购履约状态？')
      await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
        .some(dialog => dialog.getClientRects().length > 0
          && dialog.textContent?.includes('推进采购履约状态？')
          && dialog.textContent.includes(${JSON.stringify(`下一状态：${statusLabel}`)})))()`)
      await clickDialogButton(page, '推进采购履约状态？', '确认推进')
      await waitForNoVisibleDialog(page, '推进采购履约状态？')
      await page.waitFor(`(() => {
        const drawer = [...document.querySelectorAll('[role="dialog"]')]
          .find(candidate => candidate.getClientRects().length > 0
            && candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
        return drawer?.textContent?.includes(${JSON.stringify(statusLabel)})
      })()`)
      await clickVisibleAriaButton(page, '关闭抽屉')
      await waitForPurchaseList(page, order.orderNo)
    }
    await page.navigate(appRouteUrl(configuration.baseUrl, pendingRoute))
    await waitForPurchaseList(page, linkedOrder.orderNo)
    await waitForStatusToolbarCounts(page, '待办采购状态筛选', {
      待发货: 1,
      待付款: 1,
      待入仓: 0,
    })
    const pending = await readPurchaseOrders(page, 'pending')
    assert.equal(pending.status, 200)
    assert.equal(pending.body?.total, 1)
    assert.equal(pending.body?.items?.[0]?.id, linkedOrder.id)
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
          && button.textContent?.trim() === '查看')
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
