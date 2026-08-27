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
  selectRegionOption,
} from './regions.browser.helpers.mjs'

const listRoute = '/qs-operations/sales/sales-orders'
const customerName = 'Browser 销售订单客户'
const customerPhone = '0912000000'
const productOption = 'PRODUCT-BROWSER-001 · Browser 多媒体产品 · 标准价 1234.5678 TWD'
const regionSelectorTestId = 'sales-order-region-selector'

/**
 * 复用编号场景的脱敏步骤日志，但将错误边界收敛到销售订单，日志不输出客户
 * 地址、请求 DTO、Cookie 或幂等键。
 */
async function runSalesOrderBrowserStep(label, action) {
  try {
    return await runNumberingBrowserStep(`sales orders · ${label}`, action)
  }
  catch (error) {
    throw new Error(`Sales order browser step failed: ${label}`, {
      cause: error,
    })
  }
}

function labelledControlSource(labelText) {
  return `(() => {
    const label = [...document.querySelectorAll('label')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim().startsWith(${JSON.stringify(labelText)})
    ))
    if (!label) return null
    const direct = label.querySelector(
      'input, textarea, [role="combobox"], [data-slot="select-trigger"]',
    )
    if (direct) return direct
    const htmlFor = label.getAttribute('for')
    if (htmlFor) {
      const linked = document.getElementById(htmlFor)
      if (linked?.matches(
        'input, textarea, [role="combobox"], [data-slot="select-trigger"]',
      )) return linked
      const linkedControl = linked?.querySelector(
        'input, textarea, [role="combobox"], [data-slot="select-trigger"]',
      )
      if (linkedControl) return linkedControl
    }
    let parent = label.parentElement
    for (let depth = 0; depth < 5 && parent; depth += 1) {
      const nested = parent.querySelector(
        'input, textarea, [role="combobox"], [data-slot="select-trigger"]',
      )
      if (nested) return nested
      parent = parent.parentElement
    }
    return null
  })()`
}

/** 原生 setter + input/change 与正式 FaInput/MoneyInput 的 v-model 契约一致。 */
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
      throw new Error('sales order labelled control unavailable')
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
  // MoneyInput 经内部 draft 与父 formModel 两层 passive v-model 回写，等待两帧。
  await page.evaluate(`new Promise(resolve => requestAnimationFrame(
    () => requestAnimationFrame(resolve),
  ))`)
}

async function openLabelledProductControl(page, labelText) {
  const controlSource = labelledControlSource(labelText)
  await page.waitFor(`(() => {
    const control = ${controlSource}
    return control?.getAttribute('role') === 'combobox'
      && control.getClientRects().length > 0
      && !control.disabled
  })()`)
  await page.evaluate(`(() => {
    const control = ${controlSource}
    if (control?.getAttribute('role') !== 'combobox') {
      throw new Error('sales order product combobox unavailable')
    }
    control.focus({ preventScroll: true })
    return true
  })()`)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="option"]')]
    .some(option => option.getClientRects().length > 0))()`)
}

/** 币种弹窗只有一个选择器，直接在可见 dialog 内解析，避免依赖表单内部层级。 */
async function selectCurrencyOption(page, optionText) {
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => dialog.getClientRects().length > 0
      && dialog.textContent?.includes('选择订单币种')
      && (() => {
        const control = dialog.querySelector('[data-slot="select-trigger"]')
        return control?.getClientRects().length > 0 && !control.disabled
      })()))()`)
  await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('选择订单币种'))
    const control = dialog?.querySelector('[data-slot="select-trigger"]')
    if (!control || control.disabled) {
      throw new Error('sales order currency combobox unavailable')
    }
    control.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="option"]')]
    .some(option => option.getClientRects().length > 0
      && option.getAttribute('aria-disabled') !== 'true'
      && option.textContent?.trim() === ${JSON.stringify(optionText)}))()`)
  await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.getAttribute('aria-disabled') !== 'true'
        && candidate.textContent?.trim() === ${JSON.stringify(optionText)})
    if (!option) throw new Error('sales order currency option unavailable')
    option.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
}

async function readOrders(page) {
  const pathname = `/api/sales-orders?page=1&pageSize=20&keyword=${encodeURIComponent(customerName)}`
  return page.evaluate(apiExpression(pathname))
}

test('真实 Chrome 覆盖销售订单币种、产品、地址与金额硬拦截及正式派号', {
  timeout: 600_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-sales-orders`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  await page.setViewport(1440, 900, false)
  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })

  await runSalesOrderBrowserStep('real login and empty list', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(page, configuration)
    await page.navigate(appRouteUrl(configuration.baseUrl, listRoute))
    await waitForAfterAuthentication(page, `(() => {
      const table = document.querySelector('[data-testid="sales-order-list-table"]')
      return table?.getClientRects().length > 0
        && !table.querySelector('[aria-busy="true"]')
    })()`)
    const response = await readOrders(page)
    assert.equal(response.status, 200)
    assert.equal(response.body?.total, 0)
  })

  const runtime = collectRuntimeIssues(page, {
    sensitiveValues: [configuration.password],
  })
  runtime.start()

  await runSalesOrderBrowserStep('currency gate fixes TWD route', async () => {
    const catalog = await page.evaluate(apiExpression('/api/currency-catalog'))
    assert.equal(catalog.status, 200)
    assert.equal(
      catalog.body?.some(currency => currency.code === 'TWD' && currency.enabled === true),
      true,
    )
    await clickVisibleButton(page, '新增销售订单')
    await waitForVisibleDialog(page, '选择订单币种')
    await selectCurrencyOption(page, 'TWD · 新台币')
    await clickDialogButton(page, '选择订单币种', '进入新增订单')
    await waitForAfterAuthentication(page, `(() => (
      location.hash.includes('/qs-operations/sales/sales-orders/create?currency=TWD')
      && document.querySelector('[data-testid="sales-order-create-page"]')
        ?.getClientRects().length > 0
      && document.body.innerText.includes('订单币种已固定为 TWD')
    ))()`)
    const issuerControlSource = labelledControlSource('出单人')
    await page.waitFor(`${issuerControlSource}?.value === 'Browser Auth Admin'`)
    await page.waitFor(`(() => {
      const summary = document.querySelector(
        '[data-testid="sales-order-create-summary-column"]',
      )
      const desc = summary?.querySelector('[data-slot="qs-sales-order-desc"]')
      return summary?.getClientRects().length > 0
        && desc?.getClientRects().length > 0
        && ![...summary.querySelectorAll('button')]
          .some(button => button.textContent?.trim() === '提交订单')
        && !document.body.innerText.includes('当前币种不可用于新订单')
    })()`)

    await page.setViewport(390, 844, true)
    await clickVisibleButton(page, '查看已填详情')
    await waitForVisibleDialog(page, '已填销售订单详情')
    await page.waitFor(`(() => {
      const drawer = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('已填销售订单详情'))
      return drawer
        && ![...drawer.querySelectorAll('button')]
          .some(button => button.textContent?.trim() === '提交订单')
        && [...drawer.querySelectorAll('button')]
          .some(button => button.textContent?.trim() === '继续填写' && !button.disabled)
    })()`)
    await clickDialogButton(page, '已填销售订单详情', '继续填写')
    await waitForNoVisibleDialog(page, '已填销售订单详情')
    await page.setViewport(1440, 900, false)

    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-step-customer"]',
    )?.getClientRects().length > 0`)
  })

  await runSalesOrderBrowserStep('customer snapshot and duplicate address block', async () => {
    await fillLabelledControl(page, '客户姓名', customerName)
    await fillLabelledControl(page, '客户电话', customerPhone)
    await selectRegionOption(
      page,
      regionSelectorTestId,
      'COUNTRY_REGION',
      '中国台湾',
    )
    await selectRegionOption(
      page,
      regionSelectorTestId,
      'PROVINCE_STATE',
      '台湾',
    )
    await selectRegionOption(
      page,
      regionSelectorTestId,
      'CITY',
      '高雄市',
    )
    await fillLabelledControl(
      page,
      '详细地址',
      '中国台湾 台湾 高雄市 苓雅区 中正一路 100 号 3 楼',
    )
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.body.innerText.includes('详细地址请勿重复填写已选地区')`)
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-step-customer"]',
    )?.getClientRects().length > 0`)
    const blockedResponse = await readOrders(page)
    assert.equal(blockedResponse.status, 200)
    assert.equal(blockedResponse.body?.total, 0)

    await fillLabelledControl(page, '详细地址', '苓雅区 中正一路 100 号 3 楼')
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-step-products-sales"]',
    )?.getClientRects().length > 0`)
  })

  await runSalesOrderBrowserStep('TWD product filter and sales values', async () => {
    await page.waitFor(`document.body.innerText.includes('暂无产品明细')`)
    await clickVisibleButton(page, '添加数据库产品')
    await fillLabelledControl(page, '数据库产品', 'PRODUCT-BROWSER-001')
    await openLabelledProductControl(page, '数据库产品')
    const productControlSource = labelledControlSource('数据库产品')
    const optionLabels = await page.evaluate(`(() => {
      const control = ${productControlSource}
      const listboxId = control?.getAttribute('aria-controls')
      const listbox = listboxId ? document.getElementById(listboxId) : null
      if (!listbox || listbox.getAttribute('role') !== 'listbox') {
        throw new Error('sales order product listbox unavailable')
      }
      return [...listbox.querySelectorAll('[role="option"]')]
        .filter(option => option.getClientRects().length > 0)
        .map(option => option.textContent?.trim() ?? '')
    })()`)
    assert.equal(optionLabels.includes(productOption), true)
    assert.equal(optionLabels.some(label => label.includes(' MYR')), false)
    assert.equal(
      optionLabels
        .filter(label => label !== '请选择数据库产品')
        .every(label => label.includes(' TWD')),
      true,
    )
    await page.evaluate(`(() => {
      const control = ${productControlSource}
      if (control?.getAttribute('role') !== 'combobox') {
        throw new Error('sales order product combobox unavailable')
      }
      control.focus({ preventScroll: true })
      return true
    })()`)
    await pressKey(page, 'ArrowDown', 'ArrowDown')
    await pressKey(page, 'Enter')
    await page.waitFor(`${productControlSource}?.value === ${JSON.stringify(productOption)}`)
    await fillLabelledControl(page, '真实售价', '100')
    await fillLabelledControl(page, '产品数量', '2')
    await fillLabelledControl(page, '手填销售总价', '200')
    await fillLabelledControl(page, '定金', '50')
    await fillLabelledControl(page, '尾款', '150')
  })

  await runSalesOrderBrowserStep('manual total mismatch is a hard block', async () => {
    await fillLabelledControl(page, '手填销售总价', '199')
    await fillLabelledControl(page, '尾款', '149')
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.body.innerText.includes(
      '手填销售总价必须与产品明细汇总一致'
    )`)
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-step-products-sales"]',
    )?.getClientRects().length > 0`)
    const response = await readOrders(page)
    assert.equal(response.status, 200)
    assert.equal(response.body?.total, 0)
  })

  await runSalesOrderBrowserStep('formal save assigns number and persists snapshots', async () => {
    await fillLabelledControl(page, '手填销售总价', '200')
    await fillLabelledControl(page, '尾款', '150')
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`(() => {
      const documents = document.querySelector(
        '[data-testid="sales-order-step-documents"]',
      )
      const summary = document.querySelector(
        '[data-testid="sales-order-create-summary-column"]',
      )
      return documents?.getClientRects().length > 0
        && summary?.textContent?.includes(${JSON.stringify(customerName)})
        && summary?.textContent?.includes('200')
        && ![...summary.querySelectorAll('button')]
          .some(button => button.textContent?.trim() === '提交订单')
    })()`)

    const beforeReview = await readOrders(page)
    assert.equal(beforeReview.status, 200)
    assert.equal(beforeReview.body?.total, 0)
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.body.textContent?.includes('请检查订单信息是否正确')`)
    await page.waitFor(`(() => {
      const formPanel = document.querySelector(
        '[data-testid="sales-order-create-form-column"]',
      )
      const formTrack = formPanel?.closest('.sales-order-form-track')
      const review = document.querySelector(
        '[data-testid="sales-order-create-review"]',
      )
      const layout = document.querySelector(
        '[data-testid="sales-order-create-layout"]',
      )
      const summary = document.querySelector(
        '[data-testid="sales-order-create-summary-column"]',
      )
      const desc = summary?.querySelector('[data-slot="qs-sales-order-desc"]')
      const summaryRegion = summary?.querySelector('.sales-order-summary-region')
      const actions = document.querySelector(
        '[data-testid="sales-order-review-actions"]',
      )
      const submit = [...(actions?.querySelectorAll('button') ?? [])]
        .find(button => button.textContent?.trim() === '提交订单')
      const layoutRect = layout?.getBoundingClientRect()
      const summaryRect = summary?.getBoundingClientRect()
      const summaryRegionRect = summaryRegion?.getBoundingClientRect()
      const actionsRect = actions?.getBoundingClientRect()
      const summaryTop = summary ? getComputedStyle(summary).top : ''
      const actionsPosition = actions ? getComputedStyle(actions).position : ''
      return formTrack?.getAttribute('aria-hidden') === 'true'
        && formTrack.hasAttribute('inert')
        && getComputedStyle(formTrack).opacity === '0'
        && review?.getClientRects().length > 0
        && summary?.getClientRects().length > 0
        && summaryTop === 'auto'
        && Math.abs(summaryRect.top - layoutRect.top) <= 1
        && summaryRect.width >= layoutRect.width - 2
        && desc?.getClientRects().length > 0
        && summary.textContent?.includes(${JSON.stringify(customerName)})
        && summary.textContent?.includes('200')
        && actions?.getClientRects().length > 0
        && actions.parentElement === summaryRegion?.parentElement
        && !['absolute', 'fixed', 'sticky'].includes(actionsPosition)
        && actionsRect.top >= summaryRegionRect.bottom - 1
        && submit?.disabled === false
    })()`)

    await page.evaluate('window.scrollTo(0, document.documentElement.scrollHeight)')
    await page.waitFor(`(() => {
      const actions = document.querySelector(
        '[data-testid="sales-order-review-actions"]',
      )
      const lastContent = document.querySelector(
        '[data-slot="sales-order-desc-documents"]',
      )
      const summaryRegion = document.querySelector('.sales-order-summary-region')
      const actionsRect = actions?.getBoundingClientRect()
      const lastContentRect = lastContent?.getBoundingClientRect()
      return actionsRect
        && lastContentRect
        && actions?.parentElement === summaryRegion?.parentElement
        && actionsRect.top >= 0
        && actionsRect.bottom <= innerHeight + 1
        && lastContentRect.bottom <= actionsRect.top
    })()`)

    await clickVisibleButton(page, '返回修改')
    await page.waitFor(`(() => {
      const formPanel = document.querySelector(
        '[data-testid="sales-order-create-form-column"]',
      )
      const formTrack = formPanel?.closest('.sales-order-form-track')
      const documents = document.querySelector(
        '[data-testid="sales-order-step-documents"]',
      )
      const review = document.querySelector(
        '[data-testid="sales-order-create-review"]',
      )
      return formPanel?.getClientRects().length > 0
        && formTrack?.getAttribute('aria-hidden') !== 'true'
        && !formTrack?.hasAttribute('inert')
        && getComputedStyle(formTrack).opacity === '1'
        && documents?.getClientRects().length > 0
        && (!review || review.getClientRects().length === 0)
        && ![...document.querySelectorAll('button')]
          .some(button => button.getClientRects().length > 0
            && button.textContent?.trim() === '提交订单')
    })()`)

    const afterReturn = await readOrders(page)
    assert.equal(afterReturn.status, 200)
    assert.equal(afterReturn.body?.total, 0)
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-create-review"]',
    )?.getClientRects().length > 0`)
    await clickVisibleButton(page, '提交订单')
    await waitForVisibleDialog(page, '确认提交销售订单？')

    const beforeConfirmation = await readOrders(page)
    assert.equal(beforeConfirmation.status, 200)
    assert.equal(beforeConfirmation.body?.total, 0)
    await clickDialogButton(page, '确认提交销售订单？', '确认提交订单')
    await waitForAfterAuthentication(page, `(() => (
      location.hash === ${JSON.stringify(`#${listRoute}`)}
      && document.querySelector('[data-testid="sales-order-list-table"]')
        ?.textContent?.includes(${JSON.stringify(customerName)})
      && document.body.innerText.includes('草稿')
      && document.body.innerText.includes('待采购')
      && document.body.innerText.includes('未付款')
    ))()`)

    const response = await readOrders(page)
    assert.equal(response.status, 200)
    assert.equal(response.body?.total, 1)
    const order = response.body?.items?.[0]
    assert.match(order?.orderNo ?? '', /^SO-BRW-\d{8}$/u)
    assert.equal(order?.currencyCode, 'TWD')
    assert.equal(order?.agreedTotalAmount, '200.0000')
    assert.equal(order?.receivedAmount, '0.0000')
    assert.equal(order?.outstandingAmount, '200.0000')

    const detail = await page.evaluate(apiExpression(
      `/api/sales-orders/${encodeURIComponent(order.id)}`,
    ))
    assert.equal(detail.status, 200)
    assert.equal(detail.body?.customer?.addressDetail, '苓雅区中正一路100号3楼')
    assert.equal(
      detail.body?.customer?.fullAddress,
      '中国台湾台湾高雄市苓雅区中正一路100号3楼',
    )
    assert.deepEqual(detail.body?.amounts, {
      agreedTotalAmount: '200.0000',
      balanceDueAmount: '150.0000',
      depositDueAmount: '50.0000',
      lineSubtotalAmount: '200.0000',
      outstandingAmount: '200.0000',
      receivedAmount: '0.0000',
    })
    assert.equal(detail.body?.lines?.[0]?.productNo, 'PRODUCT-BROWSER-001')
    assert.equal(detail.body?.lines?.[0]?.actualUnitPriceAmount, '100.0000')
    assert.equal(detail.body?.lines?.[0]?.quantity, 2)
  })

  runtime.stop()
  assert.deepEqual(runtime.issues, [])
})
