/* eslint-disable test/no-import-node-test */
import assert from 'node:assert/strict'
import process from 'node:process'
import test from 'node:test'

import { launchChrome } from './chrome-driver.mjs'
import {
  clickDialogAriaButton,
  clickDialogButton,
  clickRuleAction,
  clickSegmentMove,
  clickVisibleButton,
  clickVisibleDrawerOverlay,
  fillDialogControl,
  observeSuccessfulPageGet,
  patchNumberingPermissionsExpression,
  readRuleMenuItems,
  releaseTwoPreviewResponsesNewestFirst,
  restoreNumberingPermissionsExpression,
  runNumberingBrowserStep,
  selectDialogOption,
  waitForAfterAuthentication,
  waitForDialogControlValue,
  waitForNoVisibleDialog,
  waitForNumberingTable,
  waitForVisibleDialog,
} from './numbering.browser.helpers.mjs'
import {
  apiExpression,
  appRouteUrl,
  authStoreExpression,
  collectRuntimeIssues,
  failNextRequest,
  failResponseAfterServerMutation,
  inspectNextPausedRequest,
  loginThroughRealHttp,
  pressKey,
  readConfiguration,
  requestPathname,
} from './regions.browser.helpers.mjs'

const managementRoute = '/system/basic-data/numbering'
const mainRuleCode = 'E2E_BROWSER_SEQUENCE'
const randomRuleCode = 'E2E_BROWSER_RANDOM'
const mixedRuleCode = 'E2E_BROWSER_MIXED'
const cloneRuleCode = 'E2E_BROWSER_CLONE'
const permissionTargetRuleCode = 'E2E_PERMISSION_TARGET'
const permissionCloneRuleCode = 'E2E_PERMISSION_CLONE'

const allNumberingPermissions = [
  'numbering-rules:create',
  'numbering-rules:disable',
  'numbering-rules:enable',
  'numbering-rules:publish',
  'numbering-rules:read',
  'numbering-rules:read-issuances',
  'numbering-rules:update',
]

function sequenceSegment({ startValue = '1', step = '1', width = 6 } = {}) {
  return { startValue, step, type: 'SEQUENCE', width }
}

function randomSegment({
  digitLength = 2,
  letterLength = 2,
  mode = 'LETTERS_THEN_DIGITS',
} = {}) {
  return { digitLength, letterLength, mode, type: 'RANDOM' }
}

function createRulePayload(ruleCode, name, segments, resetPolicy = 'NEVER') {
  return {
    description: `${name} Browser E2E`,
    name,
    resetPolicy,
    ruleCode,
    segments,
  }
}

function assertApiStatus(response, expectedStatus) {
  assert.equal(
    response?.status,
    expectedStatus,
    JSON.stringify({
      code: response?.body?.code ?? null,
      status: response?.status ?? null,
    }),
  )
}

function expectedSequenceCapacity(width, startValue, step) {
  const maximum = (10n ** BigInt(width)) - 1n
  const start = BigInt(startValue)
  return start > maximum
    ? 0n
    : ((maximum - start) / BigInt(step)) + 1n
}

async function getRuleByCode(page, ruleCode) {
  const list = await page.evaluate(apiExpression(
    `/api/numbering-rules?page=1&pageSize=100&keyword=${encodeURIComponent(
      ruleCode,
    )}`,
  ))
  assertApiStatus(list, 200)
  const item = list.body?.items?.find(rule => rule.ruleCode === ruleCode)
  assert.equal(typeof item?.id, 'string')
  const detail = await page.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(item.id)}`,
  ))
  assertApiStatus(detail, 200)
  return detail.body
}

async function waitForRuleRow(page, marker) {
  await waitForNumberingTable(page)
  await page.waitFor(`(() => [
    ...document.querySelectorAll(
      '[data-testid="numbering-rule-table"] tbody tr',
    ),
    ...document.querySelectorAll('[data-testid="numbering-mobile-row"]'),
  ].some(row => (
    row.getClientRects().length > 0
    && row.textContent?.includes(${JSON.stringify(marker)})
  )))()`)
}

async function closeDirtyEditorIfVisible(page, title) {
  const visible = await page.evaluate(`(() => [...document.querySelectorAll(
    '[role="dialog"]',
  )].some(dialog => (
    dialog.getClientRects().length > 0
    && dialog.textContent?.includes(${JSON.stringify(title)})
  )))()`)
  if (!visible) {
    return
  }
  await clickDialogAriaButton(page, title, '关闭抽屉')
  await page.waitFor(`(() => {
    const editorVisible = [...document.querySelectorAll('[role="dialog"]')]
      .some(dialog => dialog.getClientRects().length > 0
        && dialog.textContent?.includes(${JSON.stringify(title)}))
    const discardVisible = [...document.querySelectorAll('button')]
      .some(button => button.getClientRects().length > 0
        && button.textContent?.trim() === '放弃修改')
    return !editorVisible || discardVisible
  })()`)
  const discardVisible = await page.evaluate(`(() => [...document.querySelectorAll(
    'button',
  )].some(button => (
    button.getClientRects().length > 0
    && button.textContent?.trim() === '放弃修改'
  )))()`)
  if (discardVisible) {
    await clickVisibleButton(page, '放弃修改')
    await waitForNoVisibleDialog(page, '放弃未保存修改')
  }
  try {
    await waitForNoVisibleDialog(page, title)
  }
  catch (cause) {
    const diagnostic = await page.evaluate(`(() => ({
      disabledButtons: [...document.querySelectorAll('button')]
        .filter(button => button.getClientRects().length > 0 && button.disabled)
        .map(button => button.textContent?.trim().slice(0, 48) ?? ''),
      drawerCount: document.querySelectorAll('[data-drawer-id]').length,
      visibleDialogs: [...document.querySelectorAll('[role="dialog"]')]
        .filter(dialog => dialog.getClientRects().length > 0)
        .map(dialog => dialog.querySelector('h1, h2, h3')?.textContent?.trim()
          ?? ''),
    }))()`)
    throw new Error(
      `Dirty numbering editor did not close: ${JSON.stringify(diagnostic)}`,
      { cause },
    )
  }
}

async function readVisiblePreview(page) {
  return page.evaluate(`(() => {
    const title = document.getElementById('numbering-preview-title')
    const section = title?.closest('section')
    const values = Object.fromEntries(
      [...(section?.querySelectorAll('dl > div') ?? [])].map((item) => [
        item.querySelector('dt')?.textContent?.trim() ?? '',
        item.querySelector('dd')?.textContent?.trim() ?? '',
      ]),
    )
    return {
      busy: section?.getAttribute('aria-busy'),
      capacity: values['周期容量'] ?? '',
      nextNumber: [...(section?.querySelectorAll('code') ?? [])]
        .map(code => code.textContent?.trim() ?? '')
        .find(value => value.includes('000000000000000003')) ?? '',
      nextSequenceValue: values['下一序列值'] ?? '',
      text: section?.textContent ?? '',
    }
  })()`)
}

/** FaTabs 由 Reka 管理，使用真实键盘激活并以 aria-selected 作为稳定完成边界。 */
async function activateDetailTab(page, label) {
  const serialized = JSON.stringify(label)
  await page.evaluate(`(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.trim() === ${serialized})
    if (!tab) throw new Error('numbering detail tab unavailable')
    tab.focus({ preventScroll: true })
    return true
  })()`)
  await pressKey(page, 'Enter')
  await page.waitFor(`(() => [...document.querySelectorAll('[role="tab"]')]
    .some(tab => tab.getClientRects().length > 0
      && tab.textContent?.trim() === ${serialized}
      && tab.getAttribute('aria-selected') === 'true'))()`)
}

test('真实 Chrome 覆盖编号规则全生命周期、精确统计、恢复与响应式语义', {
  timeout: 600_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const browser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-numbering-management`,
  })
  t.after(async () => browser.close())

  const page = await browser.newPage()
  const issues = collectRuntimeIssues(page, {
    sensitiveValues: [configuration.password],
  })
  await page.setViewport(1280, 800, false)
  await runNumberingBrowserStep('admin login route', () =>
    page.navigate(appRouteUrl(configuration.baseUrl, '/login')))
  await runNumberingBrowserStep('admin real login', () =>
    loginThroughRealHttp(page, configuration))

  /*
   * 首次列表请求仍访问真实 Server，只在 request stage 暂停。空数据时页面必须
   * 暴露 aria-busy/skeleton，并在 reduce 模式关闭 pulse 动画。
   */
  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await runNumberingBrowserStep('initial reduced-motion list loading', () =>
    inspectNextPausedRequest(
      page,
      [{
        requestStage: 'Request',
        urlPattern: `${configuration.baseUrl}/api/numbering-rules*`,
      }],
      event => event.request?.method === 'GET'
        && requestPathname(event) === '/api/numbering-rules',
      () => page.navigate(appRouteUrl(configuration.baseUrl, managementRoute)),
      async () => {
        await waitForAfterAuthentication(page, `document.querySelector(
          '[data-testid="numbering-rule-table"]',
        ) !== null`)
        await page.waitFor(`document.querySelectorAll(
          '.numbering-management-page .animate-pulse',
        ).length > 0`)
        const loading = await page.evaluate(`(() => {
          const table = document.querySelector(
            '[data-testid="numbering-rule-table"]',
          )
          const pulses = [...document.querySelectorAll(
            '.numbering-management-page .animate-pulse',
          )].filter(element => element.getClientRects().length > 0)
          return {
            busy: [...(table?.querySelectorAll('[aria-busy="true"]') ?? [])]
              .length > 0,
            matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
            names: pulses.map(element => getComputedStyle(element).animationName),
            pulseCount: pulses.length,
          }
        })()`)
        assert.equal(loading.busy, true)
        assert.equal(loading.matches, true)
        assert.ok(loading.pulseCount > 0)
        assert.equal(loading.names.every(name => name === 'none'), true)
      },
    ))
  await waitForNumberingTable(page)
  issues.start()

  const desktop = await page.evaluate(`(() => ({
    documentFits: document.documentElement.scrollWidth
      <= document.documentElement.clientWidth,
    heading: [...document.querySelectorAll('h1, h2')]
      .some(item => item.textContent?.trim() === '编号管理'),
    tableVisible: (document.querySelector(
      '[data-testid="numbering-rule-table"]',
    )?.getClientRects().length ?? 0) > 0,
  }))()`)
  assert.deepEqual(desktop, {
    documentFits: true,
    heading: true,
    tableVisible: true,
  })

  // Escape、overlay、显式关闭、dirty 确认与 opener 焦点恢复共享同一真实 Drawer。
  await clickVisibleButton(page, '新建编号规则')
  await waitForVisibleDialog(page, '新建编号规则')
  await pressKey(page, 'Escape')
  await waitForNoVisibleDialog(page, '新建编号规则')
  await page.waitFor(`document.activeElement?.textContent?.trim()
    === '新建编号规则'`)
  await page.waitFor(`document.querySelectorAll('[data-drawer-id]').length === 0`)

  await clickVisibleButton(page, '新建编号规则')
  await waitForVisibleDialog(page, '新建编号规则')
  await fillDialogControl(page, '新建编号规则', '规则名称', '待放弃修改')
  const overlayProbe = await clickVisibleDrawerOverlay(page)
  assert.deepEqual(overlayProbe, {
    discardConfirmationVisible: true,
    editorVisible: true,
    mouseDownTargetWasOverlay: true,
    pointerDownTargetWasOverlay: true,
  })
  await page.waitFor(`document.body.innerText.includes('放弃修改')`)
  await clickVisibleButton(page, '继续编辑')
  await waitForVisibleDialog(page, '新建编号规则')
  await clickDialogAriaButton(page, '新建编号规则', '关闭抽屉')
  await clickVisibleButton(page, '放弃修改')
  await waitForNoVisibleDialog(page, '新建编号规则')
  await page.waitFor(`document.activeElement?.textContent?.trim()
    === '新建编号规则'`)
  // 等待 Drawer 的离场动画与 closed 生命周期完成，避免立即重开时复用旧表单上下文。
  await page.waitFor(`document.querySelectorAll('[data-drawer-id]').length === 0`)

  // 通过 UI 真实编排五种片段；最后把 RANDOM 上移一位，证明顺序可编辑。
  await clickVisibleButton(page, '新建编号规则')
  await waitForVisibleDialog(page, '新建编号规则')
  await fillDialogControl(page, '新建编号规则', '规则编码', mainRuleCode)
  await fillDialogControl(page, '新建编号规则', '规则名称', '浏览器主编号规则')
  await fillDialogControl(
    page,
    '新建编号规则',
    '说明',
    '全生命周期与精确容量验收',
  )
  await selectDialogOption(page, '新建编号规则', '重置周期', '每日重置')

  // 新建模型已经包含一个 SEQUENCE；直接配置它，避免测试制造第二个非法序列。
  await fillDialogControl(page, '新建编号规则', '位数', '18')
  await fillDialogControl(page, '新建编号规则', '起始值', '1')
  await fillDialogControl(page, '新建编号规则', '步长', '1')
  await selectDialogOption(page, '新建编号规则', '新片段类型', '固定字符')
  await clickDialogButton(page, '新建编号规则', '添加片段')
  await fillDialogControl(page, '新建编号规则', '固定字符', 'SO')
  await selectDialogOption(page, '新建编号规则', '新片段类型', '日期')
  await clickDialogButton(page, '新建编号规则', '添加片段')
  await selectDialogOption(page, '新建编号规则', '日期格式', 'YYYYMMDD')
  await selectDialogOption(page, '新建编号规则', '新片段类型', '分隔符')
  await clickDialogButton(page, '新建编号规则', '添加片段')
  await selectDialogOption(page, '新建编号规则', '分隔符', '-（短横线）')
  await selectDialogOption(page, '新建编号规则', '新片段类型', '随机字符串')
  await clickDialogButton(page, '新建编号规则', '添加片段')
  await fillDialogControl(page, '新建编号规则', '大写字母长度', '2')
  await fillDialogControl(page, '新建编号规则', '数字长度', '2')
  await selectDialogOption(page, '新建编号规则', '组合方式', '字母数字打散')
  await clickSegmentMove(
    page,
    '新建编号规则',
    0,
    '下移第 1 个自增数字片段',
  )
  const orderedTypes = await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('新建编号规则'))
    return [...(dialog?.querySelectorAll('ol > li h4') ?? [])]
      .map(heading => heading.textContent?.trim())
  })()`)
  assert.deepEqual(orderedTypes, [
    '固定字符',
    '自增数字',
    '日期',
    '分隔符',
    '随机字符串',
  ])

  // 清空上一轮 debounce/preview，后续拦截到的两个响应才严格对应 start=2/3。
  await new Promise(resolve => setTimeout(resolve, 350))
  await page.waitFor(`(() => {
    const section = document.getElementById('numbering-preview-title')
      ?.closest('section')
    return section?.getAttribute('aria-busy') === 'false'
      && section.textContent?.includes('周期容量')
  })()`)

  // 两次真实 preview 响应按新后旧释放；旧响应不得覆盖 startValue=3。
  const previewConcurrency = await releaseTwoPreviewResponsesNewestFirst({
    page,
    baseUrl: configuration.baseUrl,
    firstAction: () => fillDialogControl(
      page,
      '新建编号规则',
      '起始值',
      '2',
    ),
    secondAction: () => fillDialogControl(
      page,
      '新建编号规则',
      '起始值',
      '3',
    ),
    beforeRelease: async () => {
      const loading = await page.evaluate(`(() => {
        const section = document.getElementById('numbering-preview-title')
          ?.closest('section')
        return {
          busy: section?.getAttribute('aria-busy'),
          live: section?.querySelector('[role="status"][aria-live="polite"]')
            ?.textContent?.includes('正在计算编号预览') ?? false,
        }
      })()`)
      assert.deepEqual(loading, { busy: 'true', live: true })
    },
    afterNewest: async () => {
      await page.waitFor(`(() => {
        const section = document.getElementById('numbering-preview-title')
          ?.closest('section')
        return section?.getAttribute('aria-busy') === 'false'
          && section.textContent?.includes('000000000000000003')
      })()`)
    },
    afterStale: async () => {
      await new Promise(resolve => setTimeout(resolve, 150))
      const preview = await readVisiblePreview(page)
      assert.match(preview.nextNumber, /000000000000000003/u)
      assert.equal(preview.nextSequenceValue.replaceAll(/\D/gu, ''), '3')
    },
  })
  assert.deepEqual(previewConcurrency, { firstRequestCancelled: true })

  const preview = await readVisiblePreview(page)
  const visibleCapacity = BigInt(preview.capacity.replaceAll(/\D/gu, ''))
  assert.ok(visibleCapacity > BigInt(Number.MAX_SAFE_INTEGER))
  assert.match(preview.text, /Asia\/Shanghai/u)

  // 暂停真实 create 请求，验证提交锁、aria-busy、inert 与关闭入口锁定。
  await inspectNextPausedRequest(
    page,
    [{
      requestStage: 'Request',
      urlPattern: `${configuration.baseUrl}/api/numbering-rules`,
    }],
    event => event.request?.method === 'POST'
      && requestPathname(event) === '/api/numbering-rules',
    () => clickDialogButton(page, '新建编号规则', '创建规则'),
    async () => {
      await page.waitFor(`(() => {
        const dialog = [...document.querySelectorAll('[role="dialog"]')]
          .find(candidate => candidate.getClientRects().length > 0
            && candidate.textContent?.includes('新建编号规则'))
        const drawer = dialog?.querySelector('[data-slot="qs-generic-drawer"]')
        const footer = dialog?.querySelector(
          '[data-slot="qs-generic-drawer-footer"]',
        )
        const close = dialog?.querySelector('button[aria-label="关闭抽屉"]')
        return drawer?.getAttribute('aria-busy') === 'true'
          && footer?.hasAttribute('inert')
          && close?.disabled === true
      })()`)
      await pressKey(page, 'Escape')
      assert.equal(
        await page.evaluate(`(() => [...document.querySelectorAll(
          '[role="dialog"]',
        )].some(dialog => dialog.getClientRects().length > 0
          && dialog.textContent?.includes('新建编号规则')))()`),
        true,
      )
    },
  )
  await waitForNoVisibleDialog(page, '新建编号规则')
  await waitForRuleRow(page, mainRuleCode)

  let mainDetail = await getRuleByCode(page, mainRuleCode)
  assert.equal(mainDetail.status, 'DRAFT')
  assert.deepEqual(
    mainDetail.draftVersion.config.segments.map(segment => segment.type),
    ['FIXED', 'SEQUENCE', 'DATE', 'SEPARATOR', 'RANDOM'],
  )
  assert.equal(mainDetail.statistics.usedCount, '0')
  assert.ok(BigInt(mainDetail.statistics.capacity) > BigInt(Number.MAX_SAFE_INTEGER))
  assert.equal(mainDetail.statistics.nextSequenceValue, '3')

  // 纯 sequence / random / mixed 都由真实 preview 计算精确 decimal string。
  const largeStart = '9007199254740992'
  const pureSequence = await page.evaluate(apiExpression(
    '/api/numbering-rules/preview',
    'POST',
    {
      resetPolicy: 'NEVER',
      segments: [sequenceSegment({
        startValue: largeStart,
        step: '7',
        width: 18,
      })],
    },
  ))
  assertApiStatus(pureSequence, 200)
  assert.equal(pureSequence.body.nextSequenceValue, largeStart)
  assert.equal(
    pureSequence.body.capacity,
    expectedSequenceCapacity(18, largeStart, '7').toString(),
  )
  assert.equal(pureSequence.body.usedCount, '0')
  assert.equal(pureSequence.body.nextNumberDeterministic, true)
  assert.match(pureSequence.body.nextNumberPreview, /^\d{18}$/u)

  const pureRandomPayload = createRulePayload(
    randomRuleCode,
    '浏览器随机编号规则',
    [randomSegment({ digitLength: 2, letterLength: 3 })],
  )
  const pureRandom = await page.evaluate(apiExpression(
    '/api/numbering-rules/preview',
    'POST',
    {
      resetPolicy: pureRandomPayload.resetPolicy,
      segments: pureRandomPayload.segments,
    },
  ))
  assertApiStatus(pureRandom, 200)
  assert.equal(pureRandom.body.capacity, (26n ** 3n * 100n).toString())
  assert.equal(pureRandom.body.usedCount, '0')
  assert.equal(pureRandom.body.nextSequenceValue, null)
  assert.equal(pureRandom.body.nextNumberDeterministic, false)
  assert.equal(pureRandom.body.nextNumberPreview, null)
  assert.equal(pureRandom.body.samples.length, 5)
  assert.equal(pureRandom.body.samples.every(sample => sample.length === 5), true)

  const mixedSegments = [
    { type: 'FIXED', value: 'MX' },
    { format: 'YYYYMM', type: 'DATE' },
    sequenceSegment({ startValue: '10', step: '5', width: 4 }),
    randomSegment({ digitLength: 1, letterLength: 1 }),
  ]
  const mixedPreview = await page.evaluate(apiExpression(
    '/api/numbering-rules/preview',
    'POST',
    { resetPolicy: 'MONTHLY', segments: mixedSegments },
  ))
  assertApiStatus(mixedPreview, 200)
  // 混合规则由唯一 SEQUENCE 决定发号空间；RANDOM 只改变每次渲染内容。
  const mixedCapacity = expectedSequenceCapacity(4, '10', '5')
  assert.equal(mixedPreview.body.capacity, mixedCapacity.toString())
  assert.equal(mixedPreview.body.remainingCount, mixedCapacity.toString())
  assert.equal(mixedPreview.body.usedCount, '0')
  assert.equal(mixedPreview.body.nextSequenceValue, '10')
  assert.equal(mixedPreview.body.normalizedConfig.timezone, 'Asia/Shanghai')

  const randomCreate = await page.evaluate(apiExpression(
    '/api/numbering-rules',
    'POST',
    pureRandomPayload,
  ))
  assertApiStatus(randomCreate, 201)
  assert.equal(randomCreate.body.statistics.capacity, pureRandom.body.capacity)
  assert.equal(randomCreate.body.statistics.usedCount, '0')
  assert.equal(randomCreate.body.statistics.nextSequenceValue, null)
  assert.equal(randomCreate.body.statistics.nextNumberDeterministic, false)
  const mixedCreate = await page.evaluate(apiExpression(
    '/api/numbering-rules',
    'POST',
    createRulePayload(
      mixedRuleCode,
      '浏览器混合编号规则',
      mixedSegments,
      'MONTHLY',
    ),
  ))
  assertApiStatus(mixedCreate, 201)
  assert.equal(mixedCreate.body.statistics.capacity, mixedCapacity.toString())
  assert.equal(mixedCreate.body.statistics.usedCount, '0')
  assert.equal(mixedCreate.body.statistics.nextSequenceValue, '10')

  // 列表请求真实失败一次；表格错误态的“重试”重新访问 Server 并恢复。
  await failNextRequest(
    page,
    [{
      requestStage: 'Request',
      urlPattern: `${configuration.baseUrl}/api/numbering-rules*`,
    }],
    event => event.request?.method === 'GET'
      && requestPathname(event) === '/api/numbering-rules',
    () => clickVisibleButton(page, '刷新'),
  )
  await page.waitFor(`(() => [...document.querySelectorAll('button')]
    .some(button => (
      button.getClientRects().length > 0
      && button.textContent?.trim() === '重试'
    )))()`)
  await clickVisibleButton(page, '重试')
  await waitForRuleRow(page, mixedRuleCode)
  await waitForRuleRow(page, randomRuleCode)

  // clone 首次提交复用既有 Rule Code，真实 409 必须落到字段；纠正后再成功。
  await clickRuleAction(page, mainRuleCode, '克隆')
  await waitForVisibleDialog(page, '克隆编号规则')
  await waitForDialogControlValue(
    page,
    '克隆编号规则',
    '规则名称',
    '浏览器主编号规则副本',
  )
  await fillDialogControl(page, '克隆编号规则', '规则编码', mainRuleCode)
  await fillDialogControl(page, '克隆编号规则', '规则名称', '浏览器主编号规则副本')
  await clickDialogButton(page, '克隆编号规则', '创建副本')
  await page.waitFor(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('克隆编号规则'))
    const code = [...(dialog?.querySelectorAll('label') ?? [])]
      .find(label => label.textContent?.trim().startsWith('规则编码'))
      ?.parentElement?.querySelector('input')
    return dialog?.textContent?.includes('保存失败')
      && code?.getAttribute('aria-invalid') === 'true'
  })()`)
  await fillDialogControl(page, '克隆编号规则', '规则编码', cloneRuleCode)
  await clickDialogButton(page, '克隆编号规则', '创建副本')
  await waitForNoVisibleDialog(page, '克隆编号规则')
  await waitForRuleRow(page, cloneRuleCode)
  const cloneDetail = await getRuleByCode(page, cloneRuleCode)
  assert.equal(cloneDetail.status, 'DRAFT')
  assert.notEqual(cloneDetail.id, mainDetail.id)

  // 详情使用真实 detail / versions / issuances GET，状态与统计不靠列表复述。
  await clickRuleAction(page, mainRuleCode, '查看详情')
  await page.waitFor(`document.querySelector(
    '[data-testid="numbering-detail-drawer"]',
  )?.getClientRects().length > 0`)
  await page.waitFor(`document.querySelector(
    '[data-testid="numbering-detail-drawer"]',
  )?.textContent?.includes(${JSON.stringify(mainRuleCode)})`)
  const detailSemantics = await page.evaluate(`(() => {
    const detail = document.querySelector(
      '[data-testid="numbering-detail-drawer"]',
    )
    return {
      hasCapacity: detail?.textContent?.includes('容量') ?? false,
      hasNext: detail?.textContent?.includes('下一编号') ?? false,
      tabs: [...(detail?.querySelectorAll('[role="tab"]') ?? [])]
        .filter(tab => tab.getClientRects().length > 0)
        .map(tab => tab.textContent?.trim()),
      timezone: detail?.textContent?.includes('Asia/Shanghai') ?? false,
    }
  })()`)
  assert.deepEqual(detailSemantics.tabs, ['概览', '版本', '发号记录'])
  assert.equal(detailSemantics.hasCapacity, true)
  assert.equal(detailSemantics.hasNext, true)
  assert.equal(detailSemantics.timezone, true)
  await activateDetailTab(page, '版本')
  await page.waitFor(`document.querySelector(
    '[data-testid="numbering-detail-drawer"]',
  )?.textContent?.includes('revision')`)
  await activateDetailTab(page, '发号记录')
  try {
    await page.waitFor(`document.querySelector(
      '[data-testid="numbering-detail-drawer"]',
    )?.textContent?.includes('暂无发号记录')`)
  }
  catch (cause) {
    const issuanceDiagnostic = await page.evaluate(`(() => {
      const detail = document.querySelector(
        '[data-testid="numbering-detail-drawer"]',
      )
      return {
        alerts: [...(detail?.querySelectorAll('[role="alert"]') ?? [])]
          .filter(alert => alert.getClientRects().length > 0)
          .map(alert => alert.textContent?.trim().slice(0, 80) ?? ''),
        selectedTabs: [...(detail?.querySelectorAll('[role="tab"]') ?? [])]
          .filter(tab => tab.getAttribute('aria-selected') === 'true')
          .map(tab => tab.textContent?.trim() ?? ''),
        statuses: [...(detail?.querySelectorAll('[role="status"]') ?? [])]
          .filter(status => status.getClientRects().length > 0)
          .map(status => status.textContent?.trim() ?? ''),
        visibleTextMarkers: [
          '暂无发号记录',
          '正在加载发号记录',
          '发号记录加载失败',
        ].filter(marker => detail?.textContent?.includes(marker)),
      }
    })()`)
    throw new Error(
      `Numbering issuances tab did not settle: ${JSON.stringify(
        issuanceDiagnostic,
      )}`,
      { cause },
    )
  }
  await clickDialogAriaButton(page, mainRuleCode, '关闭抽屉')
  await waitForNoVisibleDialog(page, mainRuleCode)

  // Drawer 持有旧 expectedVersion 时，另一个真实 PATCH 先提交，随后 UI 得到 409。
  mainDetail = await getRuleByCode(page, mainRuleCode)
  await clickRuleAction(page, mainRuleCode, '编辑')
  await waitForVisibleDialog(page, '编辑编号规则')
  await waitForDialogControlValue(
    page,
    '编辑编号规则',
    '规则名称',
    '浏览器主编号规则',
  )
  const competingUpdate = await page.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(mainDetail.id)}`,
    'PATCH',
    {
      description: '并发请求已经更新规则',
      expectedVersion: mainDetail.version,
    },
  ))
  assertApiStatus(competingUpdate, 200)
  await fillDialogControl(page, '编辑编号规则', '规则名称', '冲突中的旧编辑')
  const conflictReconciliation = await observeSuccessfulPageGet(
    page,
    `/api/numbering-rules/${encodeURIComponent(mainDetail.id)}`,
    async () => {
      await clickDialogButton(page, '编辑编号规则', '保存草稿')
      await page.waitFor(`document.body.innerText.includes(
        '规则已被其他操作更新',
      )`)
    },
  )
  assert.equal(conflictReconciliation.status, 200)
  // 页面刷新 expectedVersion 的同时必须保留用户尚未提交成功的输入。
  await waitForDialogControlValue(
    page,
    '编辑编号规则',
    '规则名称',
    '冲突中的旧编辑',
  )
  const refreshedAfterConflict = await getRuleByCode(page, mainRuleCode)
  assert.equal(refreshedAfterConflict.description, '并发请求已经更新规则')
  assert.ok(refreshedAfterConflict.version > mainDetail.version)
  // 第二次显式保存使用页面刚对账得到的 expectedVersion，不再重复 409。
  await clickDialogButton(page, '编辑编号规则', '保存草稿')
  await waitForNoVisibleDialog(page, '编辑编号规则')
  await waitForRuleRow(page, '冲突中的旧编辑')

  // 正常 UI edit 成功，随后再让真实 PATCH 成功但丢失 response，验证未知结果对账。
  await clickRuleAction(page, mainRuleCode, '编辑')
  await waitForVisibleDialog(page, '编辑编号规则')
  await waitForDialogControlValue(
    page,
    '编辑编号规则',
    '规则名称',
    '冲突中的旧编辑',
  )
  await fillDialogControl(page, '编辑编号规则', '规则名称', '浏览器主编号规则已编辑')
  await clickDialogButton(page, '编辑编号规则', '保存草稿')
  await waitForNoVisibleDialog(page, '编辑编号规则')
  await waitForRuleRow(page, '浏览器主编号规则已编辑')

  await clickRuleAction(page, mainRuleCode, '编辑')
  await waitForVisibleDialog(page, '编辑编号规则')
  await waitForDialogControlValue(
    page,
    '编辑编号规则',
    '规则名称',
    '浏览器主编号规则已编辑',
  )
  await fillDialogControl(page, '编辑编号规则', '规则名称', '浏览器未知结果已落库')
  const unknownResultReconciliation = await observeSuccessfulPageGet(
    page,
    `/api/numbering-rules/${encodeURIComponent(mainDetail.id)}`,
    async () => {
      await failResponseAfterServerMutation(
        page,
        `${configuration.baseUrl}/api/numbering-rules/*`,
        'PATCH',
        () => clickDialogButton(page, '编辑编号规则', '保存草稿'),
      )
      await page.waitFor(`document.body.innerText.includes('结果未知')`)
    },
  )
  assert.equal(unknownResultReconciliation.status, 200)
  await waitForDialogControlValue(
    page,
    '编辑编号规则',
    '规则名称',
    '浏览器未知结果已落库',
  )
  await waitForRuleRow(page, '浏览器未知结果已落库')
  const reconciled = await getRuleByCode(page, mainRuleCode)
  assert.equal(reconciled.name, '浏览器未知结果已落库')
  await closeDirtyEditorIfVisible(page, '编辑编号规则')
  await clickVisibleButton(page, '刷新')
  await waitForRuleRow(page, '浏览器未知结果已落库')

  // 发布、启用、停用均通过页面确认弹窗，最终状态供独立数据库核验复查。
  await clickRuleAction(page, mainRuleCode, '发布')
  await waitForVisibleDialog(page, '确认发布编号规则')
  await clickDialogButton(page, '确认发布编号规则', '确认发布')
  await waitForNoVisibleDialog(page, '确认发布编号规则')
  await waitForRuleRow(page, mainRuleCode)
  mainDetail = await getRuleByCode(page, mainRuleCode)
  assert.equal(mainDetail.draftVersion, null)
  assert.equal(mainDetail.activeVersion?.status, 'ACTIVE')

  await clickRuleAction(page, mainRuleCode, '启用')
  await waitForVisibleDialog(page, '确认启用编号规则')
  await clickDialogButton(page, '确认启用编号规则', '确认启用')
  await waitForNoVisibleDialog(page, '确认启用编号规则')
  mainDetail = await getRuleByCode(page, mainRuleCode)
  assert.equal(mainDetail.status, 'ENABLED')
  await waitForNumberingTable(page)
  await page.waitFor(`(() => [
    ...document.querySelectorAll(
      '[data-testid="numbering-rule-table"] tbody tr',
    ),
  ].some(row => row.getClientRects().length > 0
    && row.textContent?.includes(${JSON.stringify(mainRuleCode)})
    && row.textContent?.includes('启用')))()`)

  await clickRuleAction(page, mainRuleCode, '停用')
  await waitForVisibleDialog(page, '确认停用编号规则')
  await clickDialogButton(page, '确认停用编号规则', '确认停用')
  await waitForNoVisibleDialog(page, '确认停用编号规则')
  mainDetail = await getRuleByCode(page, mainRuleCode)
  assert.equal(mainDetail.status, 'DISABLED')
  assert.ok(mainDetail.version >= 5)

  // 390x844 下卡片、操作和 Drawer 必须在视口内，触摸目标至少 44px。
  await page.setViewport(390, 844, true)
  await waitForRuleRow(page, mainRuleCode)
  // CDP 先更新布局视口，matchMedia 驱动的操作区会在随后一次 Vue flush 收敛。
  await page.waitFor(`(() => window.innerWidth === 390
    && [...document.querySelectorAll('button')].some(button => (
      button.getClientRects().length > 0
      && button.getAttribute('aria-label')
        ?.startsWith('编号规则操作 · ')
    )))()`)
  const mobile = await page.evaluate(`(() => {
    const row = [...document.querySelectorAll(
      '[data-testid="numbering-mobile-row"]',
    )].find(candidate => candidate.getClientRects().length > 0
      && candidate.textContent?.includes(${JSON.stringify(mainRuleCode)}))
    const card = row?.parentElement
    const buttons = [
      ...document.querySelectorAll('button'),
    ].filter(button => button.getClientRects().length > 0
      && (
        button.textContent?.trim() === '新建编号规则'
        || button.textContent?.trim() === '刷新'
        || button.getAttribute('aria-label')
          ?.startsWith('编号规则操作 · ')
      ))
    return {
      buttonHeights: buttons.map(button => Number(
        button.getBoundingClientRect().height.toFixed(3),
      )),
      buttonKinds: buttons.map(button => (
        button.textContent?.trim() === '新建编号规则'
          ? 'create'
          : button.textContent?.trim() === '刷新'
            ? 'refresh'
            : 'row-action'
      )),
      cardInside: card
        ? card.getBoundingClientRect().left >= 0
          && card.getBoundingClientRect().right
            <= document.documentElement.clientWidth
        : false,
      documentFits: document.documentElement.scrollWidth
        <= document.documentElement.clientWidth,
      hasStatusText: row?.textContent?.includes('停用') ?? false,
      touchTargets: buttons.length >= 3
        && buttons.every(button => button.getBoundingClientRect().height >= 44),
    }
  })()`)
  assert.deepEqual({
    cardInside: mobile.cardInside,
    documentFits: mobile.documentFits,
    hasStatusText: mobile.hasStatusText,
  }, {
    cardInside: true,
    documentFits: true,
    hasStatusText: true,
  })
  assert.equal(
    mobile.touchTargets,
    true,
    `移动端触控目标不足 44px: ${JSON.stringify({
      heights: mobile.buttonHeights,
      kinds: mobile.buttonKinds,
    })}`,
  )

  await page.evaluate(`(() => {
    const app = document.querySelector('#app')?.__vue_app__
    app?.config?.globalProperties?.$pinia?._s
      ?.get('appSettings')?.setColorScheme('light')
    return true
  })()`)
  await page.waitFor(`!document.documentElement.classList.contains('dark')`)
  const lightTheme = await page.evaluate(`(() => {
    const row = [...document.querySelectorAll(
      '[data-testid="numbering-mobile-row"]',
    )].find(candidate => candidate.getClientRects().length > 0
      && candidate.textContent?.includes(${JSON.stringify(mainRuleCode)}))
    const surface = row?.parentElement
    const style = surface ? getComputedStyle(surface) : null
    return { background: style?.backgroundColor, color: style?.color }
  })()`)
  await page.evaluate(`(() => {
    const app = document.querySelector('#app')?.__vue_app__
    app?.config?.globalProperties?.$pinia?._s
      ?.get('appSettings')?.setColorScheme('dark')
    return true
  })()`)
  await page.waitFor(`document.documentElement.classList.contains('dark')`)
  const darkTheme = await page.evaluate(`(() => {
    const row = [...document.querySelectorAll(
      '[data-testid="numbering-mobile-row"]',
    )].find(candidate => candidate.getClientRects().length > 0
      && candidate.textContent?.includes(${JSON.stringify(mainRuleCode)}))
    const surface = row?.parentElement
    const style = surface ? getComputedStyle(surface) : null
    return { background: style?.backgroundColor, color: style?.color }
  })()`)
  assert.notEqual(darkTheme.background, lightTheme.background)
  assert.notEqual(darkTheme.color, lightTheme.color)

  await clickRuleAction(page, mainRuleCode, '查看详情')
  await page.waitFor(`document.querySelector(
    '[data-testid="numbering-detail-drawer"]',
  )?.getClientRects().length > 0`)
  await page.waitFor(`document.querySelector(
    '[data-testid="numbering-detail-drawer"]',
  )?.textContent?.includes(${JSON.stringify(mainRuleCode)})`)
  const mobileDrawer = await page.evaluate(`(() => {
    const detail = document.querySelector(
      '[data-testid="numbering-detail-drawer"]',
    )
    const dialog = detail?.closest('[role="dialog"]')
    const rect = dialog?.getBoundingClientRect()
    const buttons = [...(dialog?.querySelectorAll('button') ?? [])]
      .filter(button => button.getClientRects().length > 0)
    const panel = document.querySelector('.qs-generic-drawer-panel')
    const style = panel ? getComputedStyle(panel) : null
    const seconds = value => value.split(',').map((part) => {
      const text = part.trim()
      return text.endsWith('ms')
        ? Number.parseFloat(text) / 1000
        : Number.parseFloat(text)
    })
    return {
      buttons: buttons.map(button => button.getBoundingClientRect().height),
      inside: Boolean(rect)
        && rect.left >= 0
        && rect.right <= document.documentElement.clientWidth,
      motion: style
        ? [
            ...seconds(style.animationDuration),
            ...seconds(style.transitionDuration),
          ]
        : [],
    }
  })()`)
  assert.equal(mobileDrawer.inside, true)
  assert.ok(mobileDrawer.buttons.length > 0)
  assert.equal(mobileDrawer.buttons.every(height => height >= 44), true)
  assert.ok(mobileDrawer.motion.length > 0)
  assert.equal(
    mobileDrawer.motion.every(value => Number.isFinite(value) && value <= 0.001),
    true,
  )
  await clickDialogAriaButton(page, mainRuleCode, '关闭抽屉')
  await waitForNoVisibleDialog(page, mainRuleCode)

  /*
   * reduced motion 已在列表和详情 Drawer 得到证据；恢复正常动画后再覆盖移动编辑器
   * 的表单/footer、dirty confirm 与 opener 焦点，防止只在 0.01ms 环境下通过。
   */
  await page.connection.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  await page.waitFor(`!matchMedia('(prefers-reduced-motion: reduce)').matches`)
  await clickVisibleButton(page, '新建编号规则')
  await waitForVisibleDialog(page, '新建编号规则')
  await fillDialogControl(page, '新建编号规则', '规则名称', '移动端待放弃修改')
  await page.waitFor(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('新建编号规则'))
    return Boolean(dialog)
      && dialog.getAnimations({ subtree: true })
        .every(animation => animation.playState !== 'running')
  })()`)
  const mobileEditor = await page.evaluate(`(() => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')]
      .find(candidate => candidate.getClientRects().length > 0
        && candidate.textContent?.includes('新建编号规则'))
    const footer = dialog?.querySelector(
      '[data-slot="qs-generic-drawer-footer"]',
    )
    const rect = dialog?.getBoundingClientRect()
    const footerRect = footer?.getBoundingClientRect()
    const buttons = [...(footer?.querySelectorAll('button') ?? [])]
      .filter(button => button.getClientRects().length > 0)
    return {
      documentFits: document.documentElement.scrollWidth
        <= document.documentElement.clientWidth,
      footerButtons: buttons.map(
        button => button.getBoundingClientRect().height,
      ),
      footerInside: Boolean(footerRect)
        && footerRect.left >= 0
        && footerRect.right <= document.documentElement.clientWidth
        && footerRect.bottom <= window.innerHeight,
      formControls: [...(dialog?.querySelectorAll('input, [role="combobox"]')
        ?? [])].filter(control => control.getClientRects().length > 0).length,
      inside: Boolean(rect)
        && rect.left >= 0
        && rect.right <= document.documentElement.clientWidth,
      rect: rect ? {
        left: Number(rect.left.toFixed(3)),
        right: Number(rect.right.toFixed(3)),
        width: Number(rect.width.toFixed(3)),
      } : null,
      viewportWidth: document.documentElement.clientWidth,
    }
  })()`)
  assert.equal(mobileEditor.documentFits, true)
  assert.equal(
    mobileEditor.inside,
    true,
    `移动编辑器超出视口: ${JSON.stringify({
      rect: mobileEditor.rect,
      viewportWidth: mobileEditor.viewportWidth,
    })}`,
  )
  assert.equal(
    mobileEditor.footerInside,
    true,
    '移动编辑器 footer 必须保持在可视区域内',
  )
  assert.ok(mobileEditor.formControls > 0)
  assert.ok(mobileEditor.footerButtons.length >= 2)
  assert.equal(
    mobileEditor.footerButtons.every(height => height >= 44),
    true,
  )
  await clickDialogAriaButton(page, '新建编号规则', '关闭抽屉')
  await waitForVisibleDialog(page, '放弃未保存修改')
  await clickDialogButton(page, '放弃未保存修改', '放弃修改')
  await waitForNoVisibleDialog(page, '放弃未保存修改')
  await waitForNoVisibleDialog(page, '新建编号规则')
  await page.waitFor(`document.activeElement?.textContent?.trim()
    === '新建编号规则'`)
  await page.waitFor(`document.querySelectorAll('[data-drawer-id]').length === 0`)
  assert.equal(
    await page.evaluate(`document.documentElement.scrollWidth
      <= document.documentElement.clientWidth`),
    true,
  )

  issues.stop()
  assert.deepEqual(issues.issues, [])
  assert.equal(
    issues.issues.some(issue => issue.includes(configuration.password)),
    false,
  )
  page.close()
})

test('真实普通用户覆盖编号七权限、组合权限、动态撤权与相邻 Server 403', {
  timeout: 600_000,
}, async (t) => {
  const configuration = readConfiguration(process.env)
  const limitedUsername = 'browser_numbering_limited'
  const limitedPassword = `${
    Array.from(configuration.password.normalize('NFC')).slice(0, 8).join('')
  }-N7`

  const adminBrowser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-numbering-matrix-admin`,
  })
  t.after(async () => adminBrowser.close())
  const adminPage = await adminBrowser.newPage()
  await adminPage.setViewport(1280, 800, false)
  await adminPage.navigate(appRouteUrl(configuration.baseUrl, '/login'))
  await loginThroughRealHttp(adminPage, configuration)
  await adminPage.navigate(appRouteUrl(configuration.baseUrl, '/'))
  await waitForAfterAuthentication(
    adminPage,
    authStoreExpression(`return store.authState === 'authenticated'`),
  )

  // User、Role 与权限目录都来自真实管理 API，不注入 AuthContext fixture。
  const limitedUser = await adminPage.evaluate(apiExpression(
    '/api/users',
    'POST',
    {
      displayName: 'Browser Numbering Limited',
      mustChangePassword: false,
      password: limitedPassword,
      username: limitedUsername,
    },
  ))
  assertApiStatus(limitedUser, 201)
  assert.equal(limitedUser.body?.username, limitedUsername)

  const permissionCatalog = await adminPage.evaluate(
    apiExpression('/api/permissions'),
  )
  assertApiStatus(permissionCatalog, 200)
  const permissionIdByCode = Object.fromEntries(
    permissionCatalog.body
      ?.filter(permission => permission.code.startsWith('numbering-rules:'))
      .map(permission => [permission.code, permission.id]),
  )
  assert.deepEqual(
    Object.keys(permissionIdByCode).sort(),
    allNumberingPermissions,
  )

  const matrixRole = await adminPage.evaluate(apiExpression(
    '/api/roles',
    'POST',
    {
      code: 'browser_numbering_matrix',
      description: 'Browser numbering permission matrix',
      name: 'Browser Numbering Matrix',
    },
  ))
  assertApiStatus(matrixRole, 201)
  const assigned = await adminPage.evaluate(apiExpression(
    `/api/users/${encodeURIComponent(limitedUser.body.id)}/roles`,
    'PUT',
    { roleIds: [matrixRole.body.id] },
  ))
  assertApiStatus(assigned, 200)
  assert.deepEqual(assigned.body?.roleIds, [matrixRole.body.id])

  const limitedBrowser = await launchChrome({
    executable: configuration.chromeExecutable,
    userDataDirectory: `${configuration.profileDirectory}-numbering-matrix-limited`,
  })
  t.after(async () => limitedBrowser.close())
  const limitedPage = await limitedBrowser.newPage()
  await limitedPage.setViewport(1280, 800, false)

  const credentials = {
    password: limitedPassword,
    username: limitedUsername,
  }
  let authenticated = false
  let sessionSequence = 0
  let limitedIssues = collectRuntimeIssues(limitedPage, {
    sensitiveValues: [configuration.password, limitedPassword],
  })
  let limitedIssuesStarted = false

  const setPermissions = async (codes) => {
    const permissionIds = codes.map((code) => {
      const id = permissionIdByCode[code]
      assert.equal(typeof id, 'string')
      return id
    })
    const response = await adminPage.evaluate(apiExpression(
      `/api/roles/${encodeURIComponent(matrixRole.body.id)}/permissions`,
      'PUT',
      { permissionIds },
    ))
    assertApiStatus(response, 200)
    assert.deepEqual(
      [...(response.body?.permissionIds ?? [])].sort(),
      [...permissionIds].sort(),
    )
  }

  const matrixUrl = routePath => `${configuration.baseUrl}/?numbering-matrix=${
    sessionSequence
  }#${routePath}`

  const openSession = async (codes) => {
    if (limitedIssuesStarted) {
      limitedIssues.stop()
      assert.deepEqual(
        limitedIssues.issues,
        [],
        '上一组编号权限页面不得产生 Runtime 异常',
      )
      limitedIssuesStarted = false
    }
    else {
      limitedIssues.stop()
    }
    if (authenticated) {
      const logout = await limitedPage.evaluate(
        apiExpression('/api/auth/logout', 'POST', {}),
      )
      assertApiStatus(logout, 204)
      authenticated = false
    }
    await setPermissions(codes)
    sessionSequence += 1
    await limitedPage.navigate(matrixUrl('/login'))
    await loginThroughRealHttp(limitedPage, credentials)
    authenticated = true
    await limitedPage.navigate(matrixUrl('/'))
    await waitForAfterAuthentication(
      limitedPage,
      authStoreExpression(`
        const routeStore = app?.config?.globalProperties?.$pinia?._s
          ?.get('appRoute')
        return routeStore?.isGenerate === true
      `),
    )
    const actual = await limitedPage.evaluate(authStoreExpression(`
      return [...store.permissions]
        .filter(permission => permission.startsWith('numbering-rules:'))
        .sort()
    `))
    assert.deepEqual(actual, [...codes].sort())
    limitedIssues = collectRuntimeIssues(limitedPage, {
      sensitiveValues: [configuration.password, limitedPassword],
    })
    limitedIssues.start()
    limitedIssuesStarted = true
  }

  const openManagement = async () => {
    await limitedPage.navigate(matrixUrl(managementRoute))
    await waitForNumberingTable(limitedPage)
  }

  const assertForbidden = (...responses) => {
    assert.deepEqual(
      responses.map(response => response?.status),
      responses.map(() => 403),
    )
    assert.deepEqual(
      responses.map(response => response?.body?.code),
      responses.map(() => 'FORBIDDEN'),
    )
  }

  const targetPayload = createRulePayload(
    permissionTargetRuleCode,
    '权限矩阵编号规则',
    [sequenceSegment({ startValue: '1', step: '1', width: 5 })],
  )

  // 零权限：管理路由稳定 403，read/create 两个相邻入口均由 Server 拒绝。
  await openSession([])
  const noPermissionList = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules?page=1&pageSize=20',
  ))
  const noPermissionCreate = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules',
    'POST',
    targetPayload,
  ))
  assertForbidden(noPermissionList, noPermissionCreate)
  await limitedPage.navigate(matrixUrl(managementRoute))
  await limitedPage.waitFor(`document.body.innerText.includes('403')`)
  assert.equal(
    await limitedPage.evaluate(`document.querySelector(
      '.numbering-management-page',
    ) === null`),
    true,
  )

  // create 单权限能创建，但缺 read 时 list/clone/update/publish 都必须 403。
  await openSession(['numbering-rules:create'])
  let targetResponse = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules',
    'POST',
    targetPayload,
  ))
  assertApiStatus(targetResponse, 201)
  let target = targetResponse.body
  const createOnlyList = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules?page=1&pageSize=20',
  ))
  const createOnlyClone = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/clone`,
    'POST',
    {
      expectedVersion: target.version,
      name: '禁止克隆',
      ruleCode: permissionCloneRuleCode,
    },
  ))
  const createOnlyUpdate = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}`,
    'PATCH',
    { expectedVersion: target.version, name: '禁止修改' },
  ))
  const createOnlyPublish = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/publish`,
    'POST',
    {
      draftRevision: target.draftVersion.revision,
      expectedVersion: target.version,
    },
  ))
  assertForbidden(
    createOnlyList,
    createOnlyClone,
    createOnlyUpdate,
    createOnlyPublish,
  )

  // read 单权限：GET/preview/UI 成功；全部 mutation 与敏感发号记录相邻 403。
  await openSession(['numbering-rules:read'])
  const readList = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules?page=1&pageSize=20',
  ))
  const readDetail = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}`,
  ))
  const readPreview = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules/preview',
    'POST',
    { resetPolicy: 'NEVER', segments: targetPayload.segments },
  ))
  assertApiStatus(readList, 200)
  assertApiStatus(readDetail, 200)
  assertApiStatus(readPreview, 200)
  const readOnlyCreate = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules',
    'POST',
    createRulePayload(
      'E2E_PERMISSION_FORBIDDEN',
      '禁止创建编号规则',
      [sequenceSegment()],
    ),
  ))
  const readOnlyUpdate = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}`,
    'PATCH',
    { expectedVersion: target.version, name: '禁止修改' },
  ))
  const readOnlyPublish = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/publish`,
    'POST',
    {
      draftRevision: target.draftVersion.revision,
      expectedVersion: target.version,
    },
  ))
  const readOnlyEnable = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/enable`,
    'POST',
    { expectedVersion: target.version },
  ))
  const readOnlyDisable = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/disable`,
    'POST',
    { expectedVersion: target.version },
  ))
  const readOnlyClone = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/clone`,
    'POST',
    {
      expectedVersion: target.version,
      name: '禁止克隆',
      ruleCode: permissionCloneRuleCode,
    },
  ))
  const readOnlyIssuances = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/issuances?page=1&pageSize=20`,
  ))
  assertForbidden(
    readOnlyCreate,
    readOnlyUpdate,
    readOnlyPublish,
    readOnlyEnable,
    readOnlyDisable,
    readOnlyClone,
    readOnlyIssuances,
  )
  await openManagement()
  const readOnlyItems = await readRuleMenuItems(
    limitedPage,
    permissionTargetRuleCode,
  )
  assert.ok(readOnlyItems.includes('查看详情'))
  assert.equal(
    ['编辑', '克隆', '发布', '启用', '停用']
      .some(item => readOnlyItems.includes(item)),
    false,
  )
  assert.equal(
    await limitedPage.evaluate(`(() => ![...document.querySelectorAll('button')]
      .some(button => button.getClientRects().length > 0
        && button.textContent?.trim() === '新建编号规则'))()`),
    true,
  )

  // read+create：UI 暴露新增/克隆，clone 真成功；update 相邻权限仍 403。
  await openSession([
    'numbering-rules:create',
    'numbering-rules:read',
  ])
  await openManagement()
  await limitedPage.waitFor(`(() => [...document.querySelectorAll('button')]
    .some(button => button.getClientRects().length > 0
      && button.textContent?.trim() === '新建编号规则'))()`)
  const createItems = await readRuleMenuItems(
    limitedPage,
    permissionTargetRuleCode,
  )
  assert.ok(createItems.includes('克隆'))
  const allowedClone = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/clone`,
    'POST',
    {
      description: 'read + create 组合权限验收',
      expectedVersion: target.version,
      name: '权限矩阵克隆规则',
      ruleCode: permissionCloneRuleCode,
    },
  ))
  assertApiStatus(allowedClone, 201)
  const cloneAdjacentUpdate = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}`,
    'PATCH',
    { expectedVersion: target.version, name: '禁止修改' },
  ))
  assertForbidden(cloneAdjacentUpdate)

  // read+update：UI 编辑可见；Store 动态撤去 update 后 Drawer 立即清空。
  await openSession([
    'numbering-rules:read',
    'numbering-rules:update',
  ])
  await openManagement()
  const updateItems = await readRuleMenuItems(
    limitedPage,
    permissionTargetRuleCode,
  )
  assert.ok(updateItems.includes('编辑'))
  await clickRuleAction(limitedPage, permissionTargetRuleCode, '编辑')
  await waitForVisibleDialog(limitedPage, '编辑编号规则')
  await waitForDialogControlValue(
    limitedPage,
    '编辑编号规则',
    '规则名称',
    '权限矩阵编号规则',
  )
  const patched = await limitedPage.evaluate(
    patchNumberingPermissionsExpression(['numbering-rules:read']),
  )
  assert.deepEqual(
    patched.filter(permission => permission.startsWith('numbering-rules:')),
    ['numbering-rules:read'],
  )
  await waitForNoVisibleDialog(limitedPage, '编辑编号规则')
  await limitedPage.evaluate(restoreNumberingPermissionsExpression())

  targetResponse = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}`,
    'PATCH',
    {
      description: 'update permission accepted',
      expectedVersion: target.version,
      name: '权限矩阵编号规则已编辑',
    },
  ))
  assertApiStatus(targetResponse, 200)
  target = targetResponse.body
  const updateAdjacentCreate = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules',
    'POST',
    createRulePayload(
      'E2E_PERMISSION_UPDATE_FORBIDDEN',
      '禁止创建',
      [sequenceSegment()],
    ),
  ))
  const updateAdjacentPublish = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/publish`,
    'POST',
    {
      draftRevision: target.draftVersion.revision,
      expectedVersion: target.version,
    },
  ))
  assertForbidden(updateAdjacentCreate, updateAdjacentPublish)

  // read+publish：草稿可发布；update/enable 仍分别由 Server 拒绝。
  await openSession([
    'numbering-rules:publish',
    'numbering-rules:read',
  ])
  await openManagement()
  const publishItems = await readRuleMenuItems(
    limitedPage,
    permissionTargetRuleCode,
  )
  assert.ok(publishItems.includes('发布'))
  targetResponse = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/publish`,
    'POST',
    {
      draftRevision: target.draftVersion.revision,
      expectedVersion: target.version,
    },
  ))
  assertApiStatus(targetResponse, 200)
  target = targetResponse.body
  const publishAdjacentUpdate = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}`,
    'PATCH',
    { expectedVersion: target.version, name: '禁止修改' },
  ))
  const publishAdjacentEnable = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/enable`,
    'POST',
    { expectedVersion: target.version },
  ))
  assertForbidden(publishAdjacentUpdate, publishAdjacentEnable)

  // read+enable：规则可启用；publish/disable 相邻权限继续 403。
  await openSession([
    'numbering-rules:enable',
    'numbering-rules:read',
  ])
  await openManagement()
  const enableItems = await readRuleMenuItems(
    limitedPage,
    permissionTargetRuleCode,
  )
  assert.ok(enableItems.includes('启用'))
  targetResponse = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/enable`,
    'POST',
    { expectedVersion: target.version },
  ))
  assertApiStatus(targetResponse, 200)
  target = targetResponse.body
  const enableAdjacentPublish = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/publish`,
    'POST',
    { draftRevision: 1, expectedVersion: target.version },
  ))
  const enableAdjacentDisable = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/disable`,
    'POST',
    { expectedVersion: target.version },
  ))
  assertForbidden(enableAdjacentPublish, enableAdjacentDisable)

  // read+disable：规则可停用；enable/update 相邻权限继续 403。
  await openSession([
    'numbering-rules:disable',
    'numbering-rules:read',
  ])
  await openManagement()
  const disableItems = await readRuleMenuItems(
    limitedPage,
    permissionTargetRuleCode,
  )
  assert.ok(disableItems.includes('停用'))
  targetResponse = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/disable`,
    'POST',
    { expectedVersion: target.version },
  ))
  assertApiStatus(targetResponse, 200)
  target = targetResponse.body
  const disableAdjacentEnable = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/enable`,
    'POST',
    { expectedVersion: target.version },
  ))
  const disableAdjacentUpdate = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}`,
    'PATCH',
    { expectedVersion: target.version, name: '禁止修改' },
  ))
  assertForbidden(disableAdjacentEnable, disableAdjacentUpdate)

  // read-issuances 单权限仍不能绕过基础 read；双权限后 API 与 Tab 同时出现。
  await openSession(['numbering-rules:read-issuances'])
  const issuanceWithoutRead = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/issuances?page=1&pageSize=20`,
  ))
  const listWithoutRead = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules?page=1&pageSize=20',
  ))
  assertForbidden(issuanceWithoutRead, listWithoutRead)

  await openSession([
    'numbering-rules:read',
    'numbering-rules:read-issuances',
  ])
  const allowedIssuances = await limitedPage.evaluate(apiExpression(
    `/api/numbering-rules/${encodeURIComponent(target.id)}/issuances?page=1&pageSize=20`,
  ))
  assertApiStatus(allowedIssuances, 200)
  assert.deepEqual(allowedIssuances.body?.items, [])
  const issuanceAdjacentCreate = await limitedPage.evaluate(apiExpression(
    '/api/numbering-rules',
    'POST',
    createRulePayload(
      'E2E_PERMISSION_ISSUANCE_FORBIDDEN',
      '禁止创建',
      [sequenceSegment()],
    ),
  ))
  assertForbidden(issuanceAdjacentCreate)
  await openManagement()
  await clickRuleAction(limitedPage, permissionTargetRuleCode, '查看详情')
  await limitedPage.waitFor(`document.querySelector(
    '[data-testid="numbering-detail-drawer"]',
  )?.getClientRects().length > 0`)
  await limitedPage.waitFor(`document.querySelector(
    '[data-testid="numbering-detail-drawer"]',
  )?.textContent?.includes(${JSON.stringify(permissionTargetRuleCode)})`)
  const detailTabs = await limitedPage.evaluate(`(() => [
    ...document.querySelectorAll(
      '[data-testid="numbering-detail-tabs"] [role="tab"]',
    ),
  ].filter(tab => tab.getClientRects().length > 0)
    .map(tab => tab.textContent?.trim()))()`)
  assert.deepEqual(detailTabs, ['概览', '版本', '发号记录'])
  await clickDialogAriaButton(
    limitedPage,
    permissionTargetRuleCode,
    '关闭抽屉',
  )
  await waitForNoVisibleDialog(limitedPage, permissionTargetRuleCode)

  limitedIssues.stop()
  limitedIssuesStarted = false
  assert.deepEqual(limitedIssues.issues, [])
  assert.equal(
    limitedIssues.issues.some(issue => issue.includes(limitedPassword)),
    false,
  )
  limitedPage.close()
  adminPage.close()
})
