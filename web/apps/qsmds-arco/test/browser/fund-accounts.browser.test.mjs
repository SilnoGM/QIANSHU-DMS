/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'
import {
  clickDialogButton,
  fillDialogControl,
  runNumberingBrowserStep,
  selectDialogOption,
  waitForAfterAuthentication,
  waitForNoVisibleDialog,
  waitForVisibleDialog,
} from './numbering.browser.helpers.mjs'
import {
  apiExpression,
  appRouteUrl,
  authStoreExpression,
  clickVisibleButton,
  clickVisibleRowButton,
  collectRuntimeIssues,
  fillVisibleInput,
  loginThroughRealHttp,
  readConfiguration,
} from './regions.browser.helpers.mjs'

const accountListRoute = '/qs-finance/fund-accounts/list'
const transactionRoute = '/qs-finance/fund-accounts/transactions'
const flowDisplayName = '资金浏览器调账用户'
const limitedUsername = 'fund_browser_limited'
const profitBusinessNo = 'E2E-ORDER-PROFIT'

const allFundPermissions = [
  'fund-accounts:create',
  'fund-accounts:manual-adjust',
  'fund-accounts:read',
  // 本人账户读取与提款三条码同为 fund- 前缀：system_admin 持有全量目录；
  // 财务侧全量账户视图的门槛仍是 fund-accounts:read。
  'fund-accounts:read-self',
  'fund-accounts:update-share-rate',
  'fund-business-sources:manage',
  'fund-posting-types:manage',
  'fund-transactions:reverse',
  'fund-withdrawals:create',
  'fund-withdrawals:review',
]

function readLimitedPassword(environment) {
  const password = environment.QIANSHU_BROWSER_FUND_LIMITED_PASSWORD
  const length = typeof password === 'string'
    ? Array.from(password.normalize('NFC')).length
    : 0
  if (length < 8 || length > 20) {
    throw new Error('Browser fund account limited credential is invalid')
  }
  return password
}

/** 复用稳定步骤日志与敏感信息遮罩，但把失败边界改成资金账户语义。 */
async function runFundBrowserStep(label, action) {
  try {
    return await runNumberingBrowserStep(`fund accounts · ${label}`, action)
  }
  catch (error) {
    throw new Error(`Fund account browser step failed: ${label}`, {
      cause: error,
    })
  }
}

async function waitForAccountSurface(page, marker) {
  const serialized = JSON.stringify(marker)
  await waitForAfterAuthentication(page, `(() => {
    const root = document.querySelector('[data-testid="fund-account-list-table"]')
    const records = [
      ...document.querySelectorAll(
        '[data-testid="fund-account-list-table"] tbody tr',
      ),
      ...document.querySelectorAll('[data-testid="fund-account-card"]'),
    ]
    return root?.getClientRects().length > 0
      && !root.querySelector('[aria-busy="true"]')
      && records.some(record => record.getClientRects().length > 0
        && record.textContent?.includes(${serialized}))
  })()`)
}

/** 桌面操作列把「比例」收进更多菜单，移动端才保留直接按钮。 */
async function clickDesktopShareRateAction(page, marker) {
  const serializedMarker = JSON.stringify(marker)
  await page.evaluate(`(() => {
    const row = [...document.querySelectorAll('tr')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.includes(${serializedMarker})
    ))
    const trigger = [...(row?.querySelectorAll('button') ?? [])].find(button => (
      button.getClientRects().length > 0
      && !button.disabled
      && button.getAttribute('aria-label')?.includes('更多操作')
    ))
    if (!trigger) throw new Error('fund share rate trigger unavailable')
    trigger.focus({ preventScroll: true })
    trigger.click()
    return true
  })()`)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="menuitem"]')]
    .some(item => item.getClientRects().length > 0
      && item.textContent?.trim() === '比例'
      && item.getAttribute('aria-disabled') !== 'true'))()`)
  await page.evaluate(`(() => {
    const item = [...document.querySelectorAll('[role="menuitem"]')].find(candidate => (
      candidate.getClientRects().length > 0
      && candidate.textContent?.trim() === '比例'
      && candidate.getAttribute('aria-disabled') !== 'true'
    ))
    if (!item) throw new Error('fund share rate action unavailable')
    item.focus({ preventScroll: true })
    item.click()
    return true
  })()`)
}

async function waitForAccountRowText(page, marker, expected) {
  await page.waitFor(`(() => [
    ...document.querySelectorAll(
      '[data-testid="fund-account-list-table"] tbody tr',
    ),
    ...document.querySelectorAll('[data-testid="fund-account-card"]'),
  ].some(record => record.getClientRects().length > 0
    && record.textContent?.includes(${JSON.stringify(marker)})
    && record.textContent?.includes(${JSON.stringify(expected)})))()`)
}

async function waitForTransactionSurface(page, marker) {
  const serialized = JSON.stringify(marker)
  await waitForAfterAuthentication(page, `(() => {
    const root = document.querySelector('[data-testid="fund-transaction-table"]')
    const records = [
      ...document.querySelectorAll(
        '[data-testid="fund-transaction-table"] tbody tr',
      ),
      ...document.querySelectorAll('[data-testid="fund-transaction-card"]'),
    ]
    return root?.getClientRects().length > 0
      && !root.querySelector('[aria-busy="true"]')
      && records.some(record => record.getClientRects().length > 0
        && record.textContent?.includes(${serialized}))
  })()`)
}

async function fillDialogPlaceholder(page, title, placeholder, value) {
  const serializedTitle = JSON.stringify(title)
  const serializedPlaceholder = JSON.stringify(placeholder)
  const serializedValue = JSON.stringify(value)
  await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
    .some(dialog => dialog.getClientRects().length > 0
      && dialog.textContent?.includes(${serializedTitle})
      && [...dialog.querySelectorAll('input, textarea')].some(control => (
        control.getClientRects().length > 0
        && !control.disabled
        && control.placeholder === ${serializedPlaceholder}
      ))))()`)
  await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .filter(candidate => candidate.getClientRects().length > 0)
      .reverse()
      .find(candidate => candidate.textContent?.includes(${serializedTitle}))
    const control = [...(dialog?.querySelectorAll('input, textarea') ?? [])]
      .find(candidate => candidate.getClientRects().length > 0
        && !candidate.disabled
        && candidate.placeholder === ${serializedPlaceholder})
    if (!(control instanceof HTMLInputElement)
      && !(control instanceof HTMLTextAreaElement)) {
      throw new Error('fund dialog control unavailable')
    }
    const prototype = control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')
      .set.call(control, ${serializedValue})
    control.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
    }))
    control.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
}

async function openManualAdjustment(page) {
  await clickVisibleRowButton(page, flowDisplayName, '调账')
  await waitForVisibleDialog(page, '管理员手动调账')
}

async function submitManualAdjustment(page, { amount, mode, reason }) {
  await openManualAdjustment(page)
  await selectDialogOption(
    page,
    '管理员手动调账',
    '调账范围',
    mode,
  )
  await fillDialogControl(
    page,
    '管理员手动调账',
    '业务调账金额',
    amount,
  )
  await fillDialogPlaceholder(
    page,
    '管理员手动调账',
    '说明为什么需要进行本次独立调账',
    reason,
  )
  await clickDialogButton(page, '管理员手动调账', '确认调账')
  try {
    await waitForNoVisibleDialog(page, '管理员手动调账')
  }
  catch (error) {
    const alertText = await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .filter(candidate => candidate.getClientRects().length > 0)
        .reverse()
        .find(candidate => candidate.textContent?.includes('管理员手动调账'))
      return [...(dialog?.querySelectorAll('[role="alert"]') ?? [])]
        .filter(alert => alert.getClientRects().length > 0)
        .map(alert => alert.innerText)
        .join('\\n')
    })()`)
    throw new Error(
      `Manual adjustment dialog did not close: ${JSON.stringify(alertText)}`,
      { cause: error },
    )
  }
  await waitForAccountSurface(page, flowDisplayName)
}

test('真实 Chrome 覆盖资金账户开户、调账、流水冲账、RBAC 与响应式语义', {
  timeout: 600_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const limitedPassword = readLimitedPassword(process.env)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-fund-accounts-admin`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  await page.setViewport(1440, 900, false)
  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await runFundBrowserStep('system admin real login', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(page, configuration)
    await page.navigate(appRouteUrl(configuration.baseUrl, accountListRoute))
    await waitForAccountSurface(page, '公司资金账户')
  })

  const runtime = collectRuntimeIssues(page, {
    sensitiveValues: [configuration.password, limitedPassword],
  })
  runtime.start()

  await runFundBrowserStep('exclusive admin permission catalog', async () => {
    const permissions = await page.evaluate(authStoreExpression(`
      return [...store.permissions]
        .filter(permission => permission.startsWith('fund-'))
        .sort()
    `))
    assert.deepEqual(permissions, allFundPermissions)
  })

  await runFundBrowserStep('create CNY account with keyboard select', async () => {
    await clickVisibleButton(page, '创建资金账户')
    await waitForVisibleDialog(page, '创建资金账户')
    await selectDialogOption(
      page,
      '创建资金账户',
      '未开户用户',
      '资金浏览器调账用户（fund_browser_flow_user）',
    )
    await fillDialogControl(
      page,
      '创建资金账户',
      '初始用户分成比例',
      '30',
    )
    await clickDialogButton(page, '创建资金账户', '创建账户')
    await waitForNoVisibleDialog(page, '创建资金账户')
    await waitForAccountSurface(page, flowDisplayName)
    await waitForAccountRowText(page, flowDisplayName, '30.00%')
  })

  await runFundBrowserStep('update future share rate', async () => {
    await clickDesktopShareRateAction(page, flowDisplayName)
    await waitForVisibleDialog(page, '修改分成比例')
    await fillDialogControl(
      page,
      '修改分成比例',
      '新用户分成比例',
      '45',
    )
    await fillDialogPlaceholder(
      page,
      '修改分成比例',
      '说明本次比例调整原因',
      'Browser 比例变更验收',
    )
    await clickDialogButton(page, '修改分成比例', '保存新比例')
    await waitForNoVisibleDialog(page, '修改分成比例')
    await waitForAccountRowText(page, flowDisplayName, '45.00%')
  })

  await runFundBrowserStep('positive user-only adjustment', async () => {
    await submitManualAdjustment(page, {
      amount: '100',
      mode: '只调整选定用户账户',
      reason: 'Browser 用户账户正向调账',
    })
    await waitForAccountRowText(page, flowDisplayName, '100.00')
  })

  await runFundBrowserStep('negative shared adjustment', async () => {
    await submitManualAdjustment(page, {
      amount: '-40',
      mode: '按当前比例一同调整用户与公司账户',
      reason: 'Browser 用户公司按比例负向调账',
    })
    await waitForAccountRowText(page, flowDisplayName, '82.00')
    await waitForAccountRowText(page, '公司资金账户', '13.00')
  })

  await runFundBrowserStep('transaction filter and immutable detail', async () => {
    await page.navigate(appRouteUrl(configuration.baseUrl, transactionRoute))
    await waitForTransactionSurface(page, profitBusinessNo)
    await fillVisibleInput(
      page,
      'input[placeholder="输入完整编号或片段"]',
      profitBusinessNo,
    )
    await clickVisibleButton(page, '应用筛选')
    await waitForTransactionSurface(page, profitBusinessNo)
    const filtered = await page.evaluate(`(() => {
      const table = document.querySelector('[data-testid="fund-transaction-table"]')
      const profitRow = [...(table?.querySelectorAll('tbody tr') ?? [])]
        .find(row => row.getClientRects().length > 0
          && row.textContent?.includes(${JSON.stringify(profitBusinessNo)})
          && row.textContent?.includes('入账'))
      const amountLayout = profitRow?.querySelector('div.flex-nowrap')
      const amountParts = [...(amountLayout?.children ?? [])]
        .map(element => element.getBoundingClientRect())
      return {
        amountSingleLine: amountParts.length === 2
          && Math.abs(amountParts[0].top - amountParts[1].top) <= 1,
        hasLoss: table?.textContent?.includes('E2E-ORDER-LOSS') ?? false,
        profitRows: [...(table?.querySelectorAll('tbody tr') ?? [])]
          .filter(row => row.getClientRects().length > 0
            && row.textContent?.includes(${JSON.stringify(profitBusinessNo)}))
          .length,
      }
    })()`)
    assert.deepEqual(filtered, {
      amountSingleLine: true,
      hasLoss: false,
      profitRows: 2,
    })

    await clickVisibleRowButton(page, profitBusinessNo, '详情')
    await waitForVisibleDialog(page, profitBusinessNo)
    const detail = await page.evaluate(`(() => {
      const dialog = [...document.querySelectorAll('[role="dialog"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes(${JSON.stringify(profitBusinessNo)}))
      const text = dialog?.textContent ?? ''
      return {
        hasBusinessNo: text.includes(${JSON.stringify(profitBusinessNo)}),
        hasCategory: text.includes('收益'),
        hasCompanyRate: text.includes('70.00%'),
        hasSource: text.includes('BROWSER_ORDER_DOMAIN'),
        hasUserRate: text.includes('30.00%'),
      }
    })()`)
    assert.deepEqual(detail, {
      hasBusinessNo: true,
      hasCategory: true,
      hasCompanyRate: true,
      hasSource: true,
      hasUserRate: true,
    })
  })

  await runFundBrowserStep('partial reversal preserves original batch', async () => {
    await clickDialogButton(page, profitBusinessNo, '发起冲账')
    await waitForVisibleDialog(page, '批次冲账')
    await fillDialogControl(page, '批次冲账', '本次冲账额度', '40')
    await fillDialogPlaceholder(
      page,
      '批次冲账',
      '请输入明确、可审计的冲账原因',
      'Browser 部分冲账验收',
    )
    await clickDialogButton(page, '批次冲账', '确认冲账')
    await waitForNoVisibleDialog(page, '批次冲账')
    await page.waitFor(`(() => [...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && dialog.textContent?.includes('Browser 部分冲账验收')
        && dialog.textContent?.includes('部分冲账')))()`)
  })

  await runFundBrowserStep('compact account actions stay on one row', async () => {
    await clickDialogButton(page, profitBusinessNo, '关闭')
    await page.navigate(appRouteUrl(configuration.baseUrl, accountListRoute))
    await waitForAccountSurface(page, flowDisplayName)
    const actions = await page.evaluate(`(() => {
      const row = [...document.querySelectorAll(
        '[data-testid="fund-account-list-table"] tbody tr',
      )].find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes(${JSON.stringify(flowDisplayName)}))
      const expectedLabels = ['流水', '调账']
      const visibleButtons = [...(row?.querySelectorAll('button') ?? [])]
        .filter(button => button.getClientRects().length > 0)
      const textButtons = visibleButtons
        .filter(button => expectedLabels.includes(button.textContent?.trim()))
      // 桌面「比例」收进更多菜单，紧凑操作列同时容纳两个文字按钮和一个图标触发器。
      const moreTrigger = visibleButtons
        .find(button => button.getAttribute('aria-label')?.includes('更多操作'))
      const buttons = [...textButtons, ...(moreTrigger ? [moreTrigger] : [])]
      const buttonRects = buttons.map(button => button.getBoundingClientRect())
      const center = rect => rect.top + rect.height / 2
      const actionCell = textButtons[0]?.closest('td')
      return {
        actionCellWidth: actionCell?.getBoundingClientRect().width ?? 0,
        hasMoreTrigger: Boolean(moreTrigger),
        labels: textButtons.map(button => button.textContent?.trim()),
        sameRow: buttons.length === 3
          && buttonRects.every(rect => (
            Math.abs(center(rect) - center(buttonRects[0])) <= 1
          )),
      }
    })()`)
    assert.deepEqual(actions.labels, ['流水', '调账'])
    assert.equal(actions.hasMoreTrigger, true)
    assert.equal(actions.sameRow, true)
    assert.ok(actions.actionCellWidth >= 170 && actions.actionCellWidth <= 182)
  })

  await runFundBrowserStep('390x844, themes, reduced motion and touch targets', async () => {
    await page.setViewport(390, 844, true)
    // 桌面检查已经位于同一个 hash 路由；切换 mobile emulation 后必须重载
    // 当前完整地址，让 Chrome 对新文档重新应用 viewport meta，避免页面缩放。
    await page.navigate(await page.evaluate('location.href'))
    await waitForAccountSurface(page, flowDisplayName)
    await page.waitFor(`window.innerWidth === 390
      && matchMedia('(max-width: 767px)').matches`)
    await page.waitFor(`(() => {
      const actionLabels = ['创建资金账户', '流水', '调账', '比例']
      const targets = [...document.querySelectorAll('button')]
        .filter(button => button.getClientRects().length > 0
          && actionLabels.includes(button.textContent?.trim()))
      return targets.length >= 4 && targets.every(button => (
        button.getBoundingClientRect().height + 0.001 >= 44
      ))
    })()`)
    const mobile = await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="fund-account-card"]')]
        .find(candidate => candidate.getClientRects().length > 0
          && candidate.textContent?.includes(${JSON.stringify(flowDisplayName)}))
      const actionLabels = [
        '创建资金账户', '流水', '调账', '比例',
      ]
      const targets = [...document.querySelectorAll('button')]
        .filter(button => button.getClientRects().length > 0
          && actionLabels.includes(button.textContent?.trim()))
      const animated = [...document.querySelectorAll(
        '.animate-spin, .animate-pulse',
      )].filter(element => element.getClientRects().length > 0)
      const rect = card?.getBoundingClientRect()
      return {
        cardInside: Boolean(rect && rect.left >= 0
          && rect.right <= document.documentElement.clientWidth),
        documentFits: document.documentElement.scrollWidth
          <= document.documentElement.clientWidth,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches
          && animated.every(element => getComputedStyle(element).animationName === 'none'),
        targetCount: targets.length,
        targetHeights: targets.map(button => ({
          height: button.getBoundingClientRect().height,
          label: button.textContent?.trim(),
        })),
        touchTargets: targets.every(button => (
          button.getBoundingClientRect().height + 0.001 >= 44
        )),
      }
    })()`)
    assert.deepEqual({
      cardInside: mobile.cardInside,
      documentFits: mobile.documentFits,
      reducedMotion: mobile.reducedMotion,
    }, {
      cardInside: true,
      documentFits: true,
      reducedMotion: true,
    })
    assert.equal(mobile.touchTargets, true, JSON.stringify(mobile.targetHeights))
    assert.ok(mobile.targetCount >= 4)

    await page.evaluate(`(() => {
      const app = document.querySelector('#app')?.__vue_app__
      app?.config?.globalProperties?.$pinia?._s
        ?.get('appSettings')?.setColorScheme('light')
      return true
    })()`)
    await page.waitFor(`!document.documentElement.classList.contains('dark')`)
    const light = await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="fund-account-card"]')]
        .find(candidate => candidate.textContent?.includes(${JSON.stringify(flowDisplayName)}))
      const style = card?.parentElement ? getComputedStyle(card.parentElement) : null
      return { background: style?.backgroundColor, color: style?.color }
    })()`)
    await page.evaluate(`(() => {
      const app = document.querySelector('#app')?.__vue_app__
      app?.config?.globalProperties?.$pinia?._s
        ?.get('appSettings')?.setColorScheme('dark')
      return true
    })()`)
    await page.waitFor(`document.documentElement.classList.contains('dark')`)
    const dark = await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('[data-testid="fund-account-card"]')]
        .find(candidate => candidate.textContent?.includes(${JSON.stringify(flowDisplayName)}))
      const style = card?.parentElement ? getComputedStyle(card.parentElement) : null
      return { background: style?.backgroundColor, color: style?.color }
    })()`)
    assert.notEqual(dark.background, light.background)
    assert.notEqual(dark.color, light.color)
  })

  runtime.stop()
  assert.deepEqual(runtime.issues, [])

  await runFundBrowserStep('non-admin API and both routes are forbidden', async () => {
    const limitedBrowser = await launchChrome({
      executable: configuration.chromeExecutable,
      userDataDirectory: `${configuration.profileDirectory}-fund-accounts-limited`,
    })
    t.after(async () => limitedBrowser.close())
    const limitedPage = await limitedBrowser.newPage()
    await limitedPage.setViewport(390, 844, true)
    await limitedPage.navigate(appRouteUrl(configuration.baseUrl, '/login'))
    await loginThroughRealHttp(limitedPage, {
      password: limitedPassword,
      username: limitedUsername,
    })
    const response = await limitedPage.evaluate(apiExpression(
      '/api/fund-accounts?page=1&pageSize=20',
    ))
    assert.equal(response.status, 403)
    assert.equal(response.body?.code, 'FORBIDDEN')

    for (const route of [accountListRoute, transactionRoute]) {
      await limitedPage.navigate(appRouteUrl(configuration.baseUrl, route))
      await waitForAfterAuthentication(limitedPage, `(() => (
        document.body.innerText.includes('403')
        && document.body.innerText.includes('无权访问该页面')
        && document.querySelector('[data-testid="fund-account-list-table"]') === null
        && document.querySelector('[data-testid="fund-transaction-table"]') === null
      ))()`)
    }
  })
})
