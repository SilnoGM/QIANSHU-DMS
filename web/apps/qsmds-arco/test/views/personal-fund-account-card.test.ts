import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑与三语键对齐使用 Node.js 内置 runner 验证。
import test from 'node:test'

import {
  formatMaskedAmount,
  isNegativeAmount,
  PERSONAL_FUND_ACCOUNT_AMOUNT_MASK,
  resolveOpenedDays,
  resolvePersonalFundAccountCardState,
  resolvePersonalFundAccountPanelTone,
} from '../../src/components/business/QsPersonalFundAccountCard/logic'
import en from '../../src/locales/lang/qs-personal-fund-account/en.json'
import zhCn from '../../src/locales/lang/qs-personal-fund-account/zh-cn.json'
import zhTw from '../../src/locales/lang/qs-personal-fund-account/zh-tw.json'

test('开户天数按上海自然日计算，开户当天算第 1 天', () => {
  // 2026-03-12 16:00（上海）开户，2026-11-02 12:00（上海）查看：跨 235 个自然日。
  assert.equal(
    resolveOpenedDays('2026-03-12T08:00:00.000Z', Date.parse('2026-11-02T04:00:00.000Z')),
    236,
  )
  // 同一天内无论时刻如何都算第 1 天。
  assert.equal(
    resolveOpenedDays('2026-03-12T08:00:00.000Z', Date.parse('2026-03-12T15:59:59.000Z')),
    1,
  )
  // UTC 仍是 3 月 12 日，但上海已跨到 3 月 13 日，必须按上海日期进一天。
  assert.equal(
    resolveOpenedDays('2026-03-12T15:59:59.000Z', Date.parse('2026-03-12T16:00:00.000Z')),
    2,
  )
  // 上海 3 月 13 日开户，UTC 换算回 3 月 12 日也不能提前进天。
  assert.equal(
    resolveOpenedDays('2026-03-12T16:30:00.000Z', Date.parse('2026-03-12T17:00:00.000Z')),
    1,
  )
  // 闰年 2 月 29 日必须计入。
  assert.equal(
    resolveOpenedDays('2024-02-27T16:00:00.000Z', Date.parse('2024-03-01T04:00:00.000Z')),
    3,
  )
})

test('开户天数对缺失、非法与未来时间收敛', () => {
  const now = Date.parse('2026-11-02T04:00:00.000Z')

  for (const invalid of [null, undefined, '', '  ', 'not-a-date', '2026-03-12', '2026-02-30T00:00:00.000Z']) {
    assert.equal(resolveOpenedDays(invalid, now), null)
  }
  assert.equal(resolveOpenedDays('2026-03-12T08:00:00.000Z', Number.NaN), null)
  // 时钟偏差或脏数据导致的未来开户时间不能出现 0 或负数，收敛为第 1 天。
  assert.equal(resolveOpenedDays('2026-11-03T08:00:00.000Z', now), 1)
})

test('资金账户卡片不再展示分成比例，改展示开户天数', () => {
  const source = readFileSync(
    new URL('../../src/components/business/QsPersonalFundAccountCard/index.vue', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /shareRate|rateEffectiveAt|分成比例|share rate/iu)
  assert.match(source, /openedDays/u)
})

test('资金账户三语文案不再提及分成比例', () => {
  for (const locale of [zhCn, zhTw, en]) {
    assert.doesNotMatch(
      JSON.stringify(locale),
      /分成比例|share rate|shareRate/iu,
    )
  }
})

test('金额掩码只依赖币种符号，不把真实金额带进字符串', () => {
  assert.equal(PERSONAL_FUND_ACCOUNT_AMOUNT_MASK, '******')
  assert.equal(formatMaskedAmount('¥'), '¥ ******')
  assert.equal(formatMaskedAmount(''), '******')
  assert.equal(formatMaskedAmount('   '), '******')
  assert.equal(formatMaskedAmount('¥1,170.00'), '¥1,170.00 ******')
})

test('卡片状态按加载、错误、空账户、就绪的顺序收敛', () => {
  const ready = { loading: false, error: null, hasAccount: true }

  // 加载中优先于错误与旧账户，避免骨架期间闪现失败文案。
  assert.equal(
    resolvePersonalFundAccountCardState({
      loading: true,
      error: '网络异常',
      hasAccount: false,
    }),
    'loading',
  )
  assert.equal(
    resolvePersonalFundAccountCardState({ ...ready, error: '网络异常' }),
    'error',
  )
  // 空白错误不构成失败态。
  assert.equal(
    resolvePersonalFundAccountCardState({ ...ready, error: '   ' }),
    'ready',
  )
  assert.equal(
    resolvePersonalFundAccountCardState({ ...ready, hasAccount: false }),
    'empty',
  )
  assert.equal(resolvePersonalFundAccountCardState(ready), 'ready')
})

test('负数金额识别覆盖负零与异常值', () => {
  assert.equal(isNegativeAmount('-0.01'), true)
  assert.equal(isNegativeAmount('-120.00'), true)

  for (const invalid of [null, undefined, '', '   ', '-0.00', '0.00', '120.00', 'abc', '--1.00']) {
    assert.equal(isNegativeAmount(invalid), false)
  }
})

test('余额面板色只在可见负数时变黄，未开户为红，隐藏金额不泄露符号', () => {
  assert.equal(
    resolvePersonalFundAccountPanelTone({ state: 'empty', balance: null, amountVisible: true }),
    'red',
  )
  assert.equal(
    resolvePersonalFundAccountPanelTone({ state: 'ready', balance: '-120.00', amountVisible: true }),
    'yellow',
  )
  // 隐藏金额时保持绿色：颜色不能反向暴露余额正负。
  assert.equal(
    resolvePersonalFundAccountPanelTone({ state: 'ready', balance: '-120.00', amountVisible: false }),
    'green',
  )
  assert.equal(
    resolvePersonalFundAccountPanelTone({ state: 'ready', balance: '0.00', amountVisible: true }),
    'green',
  )
  assert.equal(
    resolvePersonalFundAccountPanelTone({ state: 'ready', balance: '120.00', amountVisible: true }),
    'green',
  )
  assert.equal(
    resolvePersonalFundAccountPanelTone({ state: 'empty', balance: '-120.00', amountVisible: false }),
    'red',
  )
})

function collectKeys(source: Record<string, unknown>): string[] {
  return Object.entries(source).flatMap(([key, value]) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? collectKeys(value as Record<string, unknown>).map(child => `${key}.${child}`)
      : [key]
  )).sort()
}

test('个人资金账户卡片三语文案键完全对齐', () => {
  const reference = collectKeys(zhCn as unknown as Record<string, unknown>)
  assert.deepEqual(collectKeys(zhTw as unknown as Record<string, unknown>), reference)
  assert.deepEqual(collectKeys(en as unknown as Record<string, unknown>), reference)
  // 文案必须落在同一个命名空间，防止后续新增键被悄悄放到别处。
  assert.deepEqual(reference, [
    'qsPersonalFundAccount.accountOpenedAt',
    'qsPersonalFundAccount.amountHidden',
    'qsPersonalFundAccount.applyWithdrawal',
    'qsPersonalFundAccount.ariaLabel',
    'qsPersonalFundAccount.balanceLabel',
    'qsPersonalFundAccount.contactFinanceToOpen',
    'qsPersonalFundAccount.firstActivated',
    'qsPersonalFundAccount.hideAmount',
    'qsPersonalFundAccount.lastAccountUpdate',
    'qsPersonalFundAccount.loadError',
    'qsPersonalFundAccount.loading',
    'qsPersonalFundAccount.openAccountHint',
    'qsPersonalFundAccount.openedDays',
    'qsPersonalFundAccount.openedDaysHint',
    'qsPersonalFundAccount.openedDaysValue',
    'qsPersonalFundAccount.pageDescription',
    'qsPersonalFundAccount.pageTitle',
    'qsPersonalFundAccount.refresh',
    'qsPersonalFundAccount.retry',
    'qsPersonalFundAccount.showAmount',
    'qsPersonalFundAccount.systemSynced',
    'qsPersonalFundAccount.title',
    'qsPersonalFundAccount.withdrawalAmountHint',
    'qsPersonalFundAccount.withdrawalAmountInvalid',
    'qsPersonalFundAccount.withdrawalAmountLabel',
    'qsPersonalFundAccount.withdrawalAmountPlaceholder',
    'qsPersonalFundAccount.withdrawalAmountRequired',
    'qsPersonalFundAccount.withdrawalCancel',
    'qsPersonalFundAccount.withdrawalComingSoon',
    'qsPersonalFundAccount.withdrawalCurrentBalance',
    'qsPersonalFundAccount.withdrawalModalTitle',
    'qsPersonalFundAccount.withdrawalRecords',
    'qsPersonalFundAccount.withdrawalRecordsComingSoon',
    'qsPersonalFundAccount.withdrawalSubmit',
    'qsPersonalFundAccount.withdrawalSubmitted',
  ])
})
