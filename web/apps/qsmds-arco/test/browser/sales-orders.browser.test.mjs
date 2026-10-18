/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
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
import { clickOrderDrawerTab } from './order-drawer.browser.helpers.mjs'
import { assertRegionSelectFocusLifecycle } from './region-select-focus.browser.helpers.mjs'
import {
  apiExpression,
  appRouteUrl,
  clickVisibleButton,
  clickVisibleRowButton,
  collectRuntimeIssues,
  loginThroughRealHttp,
  pressKey,
  readConfiguration,
  selectRegionOption,
} from './regions.browser.helpers.mjs'

const listRoute = '/qs-operations/sales/sales-orders'
const customerName = 'Browser 销售订单客户'
const customerPhone = '0912000000'
const regionSelectorTestId = 'sales-order-region-selector'
const voucherFixtureBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

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

/** 销售选品必须先选供应商；通过公开 combobox/option 契约完成，不读组件内部状态。 */
async function selectProductSelectorSupplier(page, optionText) {
  const serializedOption = JSON.stringify(optionText)
  const dialogSource = `([...document.querySelectorAll('[role="dialog"]')]
    .find(candidate => candidate.getClientRects().length > 0
      && candidate.textContent?.includes('选择数据库产品')))`
  await page.waitFor(`(() => {
    const dialog = ${dialogSource}
    return [...(dialog?.querySelectorAll('[role="combobox"]') ?? [])]
      .some(combo => (combo.getAttribute('aria-label') === '供应商'
        || combo.textContent?.includes('请选择供应商'))
        && combo.getClientRects().length > 0)
  })()`)
  await page.evaluate(`(() => {
    const dialog = ${dialogSource}
    const combo = [...(dialog?.querySelectorAll('[role="combobox"]') ?? [])]
      .find(candidate => candidate.getAttribute('aria-label') === '供应商'
        || candidate.textContent?.includes('请选择供应商'))
    if (!combo) throw new Error('product selector supplier unavailable')
    combo.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="option"]')]
    .some(option => option.getClientRects().length > 0
      && option.textContent?.trim() === ${serializedOption}))()`)
  await page.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.trim() === ${serializedOption})
    if (!option) throw new Error('product selector supplier option unavailable')
    option.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => {
    const dialog = ${dialogSource}
    return [...(dialog?.querySelectorAll('[role="combobox"]') ?? [])]
      .some(combo => combo.textContent?.trim() === ${serializedOption})
  })()`)
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

/**
 * 币种弹窗使用两个货币卡片。通过卡片上的稳定币种代码选择对应 radio，既覆盖
 * 用户实际点击卡片的交互，也避免重新依赖已经移除的下拉选择器 DOM。
 */
async function selectCurrencyOption(page, currencyCode) {
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => dialog.getClientRects().length > 0
      && dialog.textContent?.includes('选择订单币种')
      && (() => {
        const card = dialog.querySelector(
          '[data-testid="sales-order-currency-card"]'
            + '[data-currency-code=${JSON.stringify(currencyCode)}]',
        )
        const control = card?.closest('label')?.querySelector('input[type="radio"]')
        return card?.getClientRects().length > 0 && !control?.disabled
      })()))()`)
  await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('选择订单币种'))
    const card = dialog?.querySelector(
      '[data-testid="sales-order-currency-card"]'
        + '[data-currency-code=${JSON.stringify(currencyCode)}]',
    )
    const control = card?.closest('label')?.querySelector('input[type="radio"]')
    if (!(control instanceof HTMLInputElement) || control.disabled) {
      throw new Error('sales order currency card unavailable')
    }
    control.click()
    return true
  })()`)
  await page.waitFor(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('选择订单币种'))
    const card = dialog?.querySelector(
      '[data-testid="sales-order-currency-card"]'
        + '[data-currency-code=${JSON.stringify(currencyCode)}]',
    )
    return card?.closest('label')?.querySelector('input[type="radio"]')?.checked === true
  })()`)
}

async function readOrders(page) {
  const pathname = `/api/sales-orders?page=1&pageSize=20&keyword=${encodeURIComponent(customerName)}`
  return page.evaluate(apiExpression(pathname))
}

/**
 * 详情入口依赖订单号拼出的 aria-label；通过可见性与禁用态双重约束，确保
 * 浏览器回归走的是用户可操作按钮，而不是命中抽屉内的隐藏副本。
 */
async function clickVisibleAriaButton(page, label) {
  await page.waitFor(`(() => [...document.querySelectorAll(
    '[aria-label=${JSON.stringify(label)}]'
  )].some(element => element.getClientRects().length > 0
    && !element.disabled))()`)
  await page.evaluate(`(() => {
    const element = [...document.querySelectorAll(
      '[aria-label=${JSON.stringify(label)}]'
    )].find(candidate => candidate.getClientRects().length > 0
      && !candidate.disabled)
    if (!(element instanceof HTMLElement)) {
      throw new Error('sales order aria button unavailable')
    }
    element.click()
    return true
  })()`)
}

test('真实 Chrome 覆盖销售订单币种、产品、地址与金额硬拦截及正式派号', {
  timeout: 600_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const fixtureDirectory = process.env.QIANSHU_BROWSER_AUTH_FIXTURE_DIRECTORY
  assert.equal(typeof fixtureDirectory, 'string')
  assert.equal(path.isAbsolute(fixtureDirectory), true)
  await mkdir(fixtureDirectory, { mode: 0o700, recursive: true })
  const voucherFixture = path.join(fixtureDirectory, 'browser-sales-order-voucher.png')
  await writeFile(voucherFixture, Buffer.from(voucherFixtureBase64, 'base64'), { mode: 0o600 })
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

  await runSalesOrderBrowserStep('region select focus lifecycle regression', async () => {
    await assertRegionSelectFocusLifecycle(page)
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
    await selectCurrencyOption(page, 'TWD')
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
        && getComputedStyle(desc).borderTopLeftRadius === '12px'
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
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="warning"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes('请先完成并修正当前步骤的必填资料'))`)
    assert.equal(await page.evaluate(`document.querySelector('.sales-order-alert-stack')
      ?.getClientRects().length ?? 0`), 0)
    await page.waitFor(`document.body.innerText.includes('详细地址请勿重复填写已选地区')`)
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-step-customer"]',
    )?.getClientRects().length > 0`)
    const blockedResponse = await readOrders(page)
    assert.equal(blockedResponse.status, 200)
    assert.equal(blockedResponse.body?.total, 0)

    await fillLabelledControl(page, '详细地址', '苓雅区 中正一路 100 号 3 楼')
    // 上一次硬拦截会同时写入领域错误与 FaForm 展示状态。必须先等待错误反馈
    // 完整清除，再触发下一步，避免测试在 Vue 连续事件刷新期间提前点击。
    await page.waitFor(`!document.body.innerText.includes('详细地址请勿重复填写已选地区')`)
    await clickVisibleButton(page, '下一步')
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-step-products-sales"]',
    )?.getClientRects().length > 0`)
  })

  await runSalesOrderBrowserStep('TWD product selection and sales values', async () => {
    await page.waitFor(`document.body.innerText.includes('暂无产品明细')`)
    await clickVisibleButton(page, '添加数据库产品')
    await waitForVisibleDialog(page, '选择数据库产品')
    await selectProductSelectorSupplier(page, 'Browser 有效供应商')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择数据库产品'))
      return dialog?.textContent?.includes('PRODUCT-BROWSER-001')
    })()`)
    const selectorText = await page.evaluate(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('选择数据库产品'))?.textContent ?? '')()`)
    assert.equal(selectorText.includes('产品选择不限制币种'), true)
    assert.match(selectorText, /共 \d+ 个产品/u)
    await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择数据库产品'))
      const product = [...(dialog?.querySelectorAll('button') ?? [])]
        .find(button => button.textContent?.includes('PRODUCT-BROWSER-001')
          && button.textContent?.includes('选择产品'))
      if (!product) {
        throw new Error('sales order product card unavailable')
      }
      product.click()
      return true
    })()`)
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('选择数据库产品'))
      const selected = dialog?.querySelector('aside[aria-label="已选择产品"]')
      return selected?.textContent?.includes('PRODUCT-BROWSER-001')
        && selected.textContent.includes('新增产品 · 数量 1')
    })()`)
    await clickDialogButton(page, '选择数据库产品', '确认添加')
    await waitForNoVisibleDialog(page, '选择数据库产品')
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-step-products-sales"]',
    )?.textContent?.includes('PRODUCT-BROWSER-001')`)
    await fillLabelledControl(page, '第 1 行本单售价', '100')
    await fillLabelledControl(page, '第 1 行产品数量', '2')
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
    await page.setFiles('[data-testid="sales-order-issuance-voucher-input"]', [voucherFixture])
    await page.waitFor(`(() => {
      const documents = document.querySelector('[data-testid="sales-order-step-documents"]')
      return documents?.textContent?.includes('browser-sales-order-voucher.png')
        && documents.textContent.includes(${JSON.stringify(`${customerName}-出单凭证-`)})
        && [...documents.querySelectorAll('button')].some(button => (
          button.getAttribute('aria-label')
            === '移除出单凭证 browser-sales-order-voucher.png'
          && !button.disabled
        ))
    })()`)
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
      const actionsPosition = actions ? getComputedStyle(actions).position : ''
      return formTrack?.getAttribute('aria-hidden') === 'true'
        && formTrack.hasAttribute('inert')
        && getComputedStyle(formTrack).opacity === '0'
        && layout?.classList.contains('sales-order-create-layout--review')
        && review?.getClientRects().length > 0
        && summary?.getClientRects().length > 0
        && summary.getAttribute('data-surface') === 'review'
        && desc?.getClientRects().length > 0
        && summary.textContent?.includes(${JSON.stringify(customerName)})
        && summary.textContent?.includes('200')
        && actions?.getClientRects().length > 0
        && !['absolute', 'fixed', 'sticky'].includes(actionsPosition)
        && Boolean(summaryRegion.compareDocumentPosition(actions)
          & Node.DOCUMENT_POSITION_FOLLOWING)
        && submit?.disabled === false
    })()`)

    const salesProductState = await page.evaluate(`(() => {
      const summary = document.querySelector(
        '[data-testid="sales-order-create-summary-column"]',
      )
      const salesLine = summary?.querySelector('[data-slot="sales-order-desc-line"]')
      const salesLineImage = salesLine?.querySelector('[data-slot="image-group"] img')
      return {
        imageAlt: salesLineImage?.alt ?? null,
        imagePath: salesLineImage ? new URL(salesLineImage.src).pathname : null,
        lineHasProductNo: salesLine?.textContent?.includes('PRODUCT-BROWSER-001') ?? false,
        lineHasSubtotal: salesLine?.textContent?.includes('本行小计') ?? false,
        lineHasUnitPrice: salesLine?.textContent?.includes('真实售价') ?? false,
        titleVisible: summary?.textContent?.includes('销售产品与小计（1）') ?? false,
      }
    })()`)
    assert.deepEqual({
      ...salesProductState,
      imagePath: undefined,
    }, {
      imageAlt: 'Browser 多媒体产品',
      imagePath: undefined,
      lineHasProductNo: true,
      lineHasSubtotal: true,
      lineHasUnitPrice: true,
      titleVisible: true,
    })
    assert.match(
      salesProductState.imagePath ?? '',
      /^\/api\/sales-orders\/product-options\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/main-image\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/content$/u,
    )

    await page.waitFor(`(async () => {
      // 核对区仍可能随图片/布局更新变高，滚动位置必须与本轮几何检查对应。
      // 等渲染帧后保留原有完整可见和不遮挡断言，不用一次旧 scrollHeight 判定结果。
      window.scrollTo(0, document.documentElement.scrollHeight)
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
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
      && document.body.innerText.includes('已确认')
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

    await clickVisibleAriaButton(page, `${order.orderNo}：查看详情`)
    await page.waitFor(`(() => {
      const drawer = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      const productImage = drawer?.querySelector(
        'section[aria-label="销售产品列表"] [data-slot="image-group"] img',
      )
      return drawer?.querySelector('[data-testid="sales-order-detail-drawer"]')
        && !drawer.querySelector('[data-slot="qs-sales-order-desc"]')
        && drawer.textContent.includes('订单基础信息')
        && drawer.textContent.includes('销售产品列表')
        && drawer.textContent.includes('实际收款记录')
        && drawer.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent.includes('订单详情信息')
        && drawer.textContent.includes('PRODUCT-BROWSER-001')
        && drawer.textContent.includes(${JSON.stringify(customerName)})
        && productImage instanceof HTMLImageElement
        && productImage.src.includes('/api/sales-orders/${order.id}/lines/')
        && productImage.complete
        && productImage.naturalWidth > 0
    })()`)
    // 专用抽屉的第二页只显示真实变更；打印当前仅是轻提示，不触发系统打印。
    await clickOrderDrawerTab(page, 'sales-order-detail-drawer', '订单变更记录')
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-detail-drawer"] section[aria-label="订单变更记录"]',
    )?.getClientRects().length > 0`)
    await clickOrderDrawerTab(page, 'sales-order-detail-drawer', '订单详情信息')
    await page.waitFor(`document.querySelector(
      '[data-testid="sales-order-detail-drawer"] section[aria-label="销售产品列表"]',
    )?.textContent.includes('PRODUCT-BROWSER-001')`)
    // 留在变更页关闭，下一次打开必须重置为详情页，而非继承上次的页签。
    await clickOrderDrawerTab(page, 'sales-order-detail-drawer', '订单变更记录')
    await clickVisibleButton(page, '打印')
    await page.waitFor(`document.body.innerText.includes(
      '该功能将在后续版本推出，敬请期待',
    )`)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await page.waitFor(`![...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && dialog.textContent?.includes(${JSON.stringify(order.orderNo)}))`)

    // 再次打开同一订单，覆盖抽屉关闭后清理状态并重新请求详情的生命周期。
    await clickVisibleAriaButton(page, `${order.orderNo}：查看详情`)
    await page.waitFor(`(() => {
      const drawer = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes(${JSON.stringify(order.orderNo)}))
      return drawer?.textContent?.includes('销售产品列表')
        && drawer.textContent.includes('PRODUCT-BROWSER-001')
        && drawer.querySelector('[role="tab"][aria-selected="true"]')
          ?.textContent.includes('订单详情信息')
    })()`)
    await clickVisibleAriaButton(page, '关闭抽屉')
    await page.waitFor(`![...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && dialog.textContent?.includes(${JSON.stringify(order.orderNo)}))`)

    // 必须建立真实的已审核采购与发货事实，不能直接跳过采购推进销售履约。
    // 浏览器场景运行在一次性隔离数据库中，不会修改开发环境的业务订单。
    const prematureTransition = await page.evaluate(apiExpression(
      `/api/sales-orders/${encodeURIComponent(order.id)}/fulfillment-status`,
      'PATCH',
      { toStatus: 'PREPARING', reason: 'Browser 未审核采购拦截验收' },
    ))
    assert.equal(prematureTransition.status, 422)
    const markResolution = await page.evaluate(apiExpression(
      '/api/purchase-orders/shipping-mark-resolution?productMode=CATALOG&supplierValue=BROWSER_SUPPLIER_EFFECTIVE',
    ))
    assert.equal(markResolution.status, 200)
    assert.equal(typeof markResolution.body?.resolutionToken, 'string')
    const sourceLine = detail.body.lines[0]
    const purchaseInput = {
      purchaseType: 'SALES_LINKED',
      productMode: 'CATALOG',
      salesOrderId: order.id,
      supplierValue: 'BROWSER_SUPPLIER_EFFECTIVE',
      orderDate: order.orderDate,
      expectedShippingMarkResolution: markResolution.body.resolutionToken,
      lines: [{
        lineType: 'CATALOG',
        productId: sourceLine.productId,
        sourceSalesOrderLineId: sourceLine.id,
        actualPurchaseUnitPriceAmount: '20',
        quantity: sourceLine.quantity,
      }],
      parts: [{ key: randomUUID(), items: [{ lineNumber: 1, quantity: sourceLine.quantity }] }],
      purchaseTotalAmount: '40',
      depositDueAmount: '0',
      balanceDueAmount: '40',
    }
    const purchase = await page.evaluate(`(async () => {
      const response = await fetch('/api/purchase-orders', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Qianshu-CSRF': '1',
          'Idempotency-Key': crypto.randomUUID(),
        },
        body: JSON.stringify(${JSON.stringify(purchaseInput)}),
      })
      return { status: response.status, body: await response.json() }
    })()`)
    assert.equal(purchase.status, 201, `采购前置创建失败：${purchase.body?.error?.code ?? purchase.body?.code ?? 'UNKNOWN_ERROR'}`)
    assert.equal(purchase.body?.shippingMarkText, null)
    assert.deepEqual(purchase.body?.shippingMarks, [])
    assert.equal(purchase.body?.parts.length, 1)
    assert.equal(purchase.body?.parts[0]?.shippingMarkText, null)
    assert.equal(purchase.body?.parts[0]?.items[0]?.quantity, sourceLine.quantity)
    assert.equal(purchase.body?.orderStatus, 'PENDING_REVIEW')
    assert.equal(typeof purchase.body?.parts[0]?.shipmentNo, 'string')
    // 审核现在必须绑定真实生成的采购单图片；先派发唛头，再按最新版本生成草稿。
    const preparedPurchase = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(purchase.body.id)}/prepare-review-shipping-marks`,
      'POST',
      { expectedVersion: purchase.body.version },
    ))
    assert.equal(preparedPurchase.status, 200)
    assert.equal(preparedPurchase.body?.orderStatus, 'PENDING_REVIEW')
    const imageDraft = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(purchase.body.id)}/order-image-drafts`,
      'POST',
      { expectedVersion: preparedPurchase.body.version },
    ))
    assert.equal(imageDraft.status, 200)
    assert.equal(imageDraft.body?.isCurrent, true)
    const reviewedPurchase = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(purchase.body.id)}/review`,
      'POST',
      { expectedVersion: preparedPurchase.body.version, imageDraftId: imageDraft.body.id, reason: 'Browser 签收流程采购审核' },
    ))
    assert.equal(reviewedPurchase.status, 200)
    assert.equal(reviewedPurchase.body?.orderStatus, 'CONFIRMED')
    assert.equal(typeof reviewedPurchase.body?.shippingMarkText, 'string')
    assert.deepEqual(reviewedPurchase.body?.shippingMarks, [reviewedPurchase.body.shippingMarkText])
    assert.equal(reviewedPurchase.body?.parts[0]?.shippingMarkText, reviewedPurchase.body.shippingMarkText)
    const preparedSales = await page.evaluate(apiExpression(
      `/api/sales-orders/${encodeURIComponent(order.id)}`,
    ))
    assert.equal(preparedSales.body?.fulfillmentStatus, 'PREPARING')
    const warehouseCatalog = await page.evaluate(apiExpression('/api/dictionary-catalog/mainland.warehouse'))
    assert.equal(warehouseCatalog.status, 200)
    const warehouse = warehouseCatalog.body?.items?.find(item => item.effectiveEnabled)
    assert.equal(typeof warehouse?.value, 'string')
    const shipment = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(purchase.body.id)}/factory-shipments`,
      'POST',
      {
        expectedVersion: reviewedPurchase.body.version,
        partIds: reviewedPurchase.body.parts.map(part => part.id),
        destinationWarehouses: reviewedPurchase.body.parts.map(part => ({ partId: part.id, warehouseValue: warehouse.value })),
        reason: 'Browser 签收流程采购发货',
      },
    ))
    // 既有发货 POST 使用 Nest 默认的 201；本次不变更该接口响应行为。
    assert.equal(shipment.status, 201)
    assert.equal(shipment.body?.salesOrder?.fulfillmentStatus, 'LAND_TRANSIT')
    const shippedPurchase = await page.evaluate(apiExpression(`/api/purchase-orders/${encodeURIComponent(purchase.body.id)}`))
    assert.equal(shippedPurchase.status, 200)
    // 通过逐货件入仓形成真实事实，并验证销售状态自动推进，不能手工跳到已到仓。
    const receipt = await page.evaluate(apiExpression(
      `/api/purchase-orders/${encodeURIComponent(purchase.body.id)}/warehouse-receipts`,
      'POST',
      { expectedVersion: shippedPurchase.body.version, partIds: shippedPurchase.body.parts.map(part => part.id) },
    ))
    assert.equal(receipt.status, 200)
    assert.equal(receipt.body?.fulfillmentStatus, 'SIGNED')
    const arrivedSales = await page.evaluate(apiExpression(`/api/sales-orders/${encodeURIComponent(order.id)}`))
    assert.equal(arrivedSales.status, 200)
    assert.equal(arrivedSales.body?.fulfillmentStatus, 'WAREHOUSE_ARRIVED')
    const transition = await page.evaluate(apiExpression(
      `/api/sales-orders/${encodeURIComponent(order.id)}/fulfillment-status`,
      'PATCH',
      { toStatus: 'SEA_TRANSIT', reason: 'Browser 签收自动推进验收' },
    ))
    assert.equal(transition.status, 200)
    assert.equal(transition.body?.fulfillmentStatus, 'SEA_TRANSIT')

    await page.navigate(appRouteUrl(
      configuration.baseUrl,
      '/qs-operations/sales/pending-sales-orders?status=SEA_TRANSIT',
    ))
    await waitForAfterAuthentication(page, `(() => {
      const table = document.querySelector('[data-testid="sales-order-list-table"]')
      return table?.getClientRects().length > 0
        && !table.querySelector('[aria-busy="true"]')
        && table.textContent?.includes(${JSON.stringify(order.orderNo)})
    })()`)
    await clickVisibleRowButton(page, order.orderNo, '货物签收')
    await waitForVisibleDialog(page, '货物签收')
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('货物签收'))
      return dialog?.textContent?.includes('自动将订单进度更新为已签收')
    })()`)
    await page.setFiles(
      '[data-testid="sales-order-delivery-receipt-input"]',
      [voucherFixture],
    )
    await page.waitFor(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes('货物签收'))
      return dialog?.textContent?.includes('browser-sales-order-voucher.png')
    })()`)
    await clickDialogButton(page, '货物签收', '确认货物签收')
    await page.waitFor(`[...document.querySelectorAll('[data-qs-toast][data-type="success"]')]
      .some(toast => toast.getClientRects().length > 0
        && toast.textContent?.includes('签收单上传成功，订单已进入已签收'))`)
    await waitForNoVisibleDialog(page, '货物签收')

    const signedDetail = await page.evaluate(apiExpression(
      `/api/sales-orders/${encodeURIComponent(order.id)}`,
    ))
    assert.equal(signedDetail.status, 200)
    assert.equal(signedDetail.body?.fulfillmentStatus, 'SIGNED')
    assert.equal(signedDetail.body?.orderStatus, 'CONFIRMED')
    assert.equal(
      signedDetail.body?.documents?.some(document => (
        document.documentType === 'DELIVERY_RECEIPT'
        && document.detachedAt === null
      )),
      true,
    )
    assert.equal(
      signedDetail.body?.statusHistory?.some(history => (
        history.dimension === 'FULFILLMENT'
        && history.fromStatus === 'SEA_TRANSIT'
        && history.toStatus === 'SIGNED'
        && history.reason === '业务人员上传签收单后自动确认签收'
      )),
      true,
    )
  })

  runtime.stop()
  assert.deepEqual(runtime.issues, [])
})
