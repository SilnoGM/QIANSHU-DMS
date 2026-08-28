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
  pressKey,
  readConfiguration,
} from './regions.browser.helpers.mjs'

const listRoute = '/qs-operations/purchase/purchase-orders'
const pendingRoute = '/qs-operations/purchase/pending-purchase-orders'
const supplierLabel = 'Browser 有效供应商'
const productNo = 'PRODUCT-BROWSER-001'

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

/** 供应商和付款方式均通过公开 placeholder + combobox 键盘契约选择。 */
async function selectVisibleComboboxOption(page, placeholder, optionText) {
  const serializedPlaceholder = JSON.stringify(placeholder)
  const serializedOption = JSON.stringify(optionText)
  const controlSource = `([...document.querySelectorAll(
    'input[data-slot="combobox-input"]',
  )].find(input => input.placeholder === ${serializedPlaceholder}) ?? null)`
  await page.waitFor(`${controlSource}?.getClientRects().length > 0`)
  await page.evaluate(`(() => {
    const control = ${controlSource}
    if (!control) throw new Error('purchase order combobox unavailable')
    control.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
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
    option.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
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

test('真实 Chrome 覆盖备货采购创建、详情、付款、履约和响应式主题', {
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
    const all = await readPurchaseOrders(page)
    assert.equal(all.status, 200)
    assert.equal(all.body?.total, 0)
    await page.navigate(appRouteUrl(configuration.baseUrl, pendingRoute))
    await waitForPurchaseList(page, '暂无待办采购')
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

  let order
  await runPurchaseOrderBrowserStep('stock creation and validation focus', async () => {
    await clickVisibleButton(page, '新增备货采购')
    await waitForAfterAuthentication(page, `(() => (
      location.hash.includes('/qs-operations/purchase/purchase-orders/create?type=STOCK')
      && document.querySelector('[data-testid="purchase-order-create-page"]')
        ?.getClientRects().length > 0
      && document.body.innerText.includes('PURCHASE_ORDER · AUTO')
    ))()`)

    await selectVisibleComboboxOption(page, '选择采购供应商', supplierLabel)
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

    await clickVisibleButton(page, '核对并确认采购订单')
    await page.waitFor(`document.body.innerText.includes(
      '请修正采购订单中的必填项和金额后再提交'
    )`)
    await page.waitFor(`document.activeElement?.getAttribute('aria-label') === '定金'`)

    await fillAriaControl(page, '定金', '20')
    await fillAriaControl(page, '尾款', '60')
    await fillLabelledControl(page, '采购唛头', 'BROWSER STOCK MARK')
    await clickVisibleButton(page, '核对并确认采购订单')
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
    assert.equal(response.body?.total, 1)
    order = response.body?.items?.[0]
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
      return drawer?.textContent?.includes('订单概览')
        && drawer.textContent.includes('采购产品明细')
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
    await clickVisibleAriaButton(page, `${order.orderNo}：推进履约`)
    await waitForVisibleDialog(page, '推进采购履约状态？')
    await clickDialogButton(page, '推进采购履约状态？', '确认推进')
    await waitForNoVisibleDialog(page, '推进采购履约状态？')
    await page.waitFor(`(() => {
      const drawer = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      return drawer?.textContent?.includes('已下单')
    })()`)
    await clickVisibleAriaButton(page, '关闭抽屉')
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
    await waitForPurchaseList(page, '暂无待办采购')
    const pending = await readPurchaseOrders(page, 'pending')
    assert.equal(pending.status, 200)
    assert.equal(pending.body?.total, 0)
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
        && candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      return innerWidth === 390 && card
    })()`)
    // 页头带入场缩放；必须等视觉尺寸稳定后再验收物理触控目标，避免采到
    // 44px 按钮动画中的约 0.9 倍中间帧。
    await page.waitFor(`(() => {
      const headerButtons = [...document.querySelectorAll('button')]
        .filter(button => button.getClientRects().length > 0
          && ['新增销售关联采购', '新增备货采购']
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
          && ['新增销售关联采购', '新增备货采购']
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
