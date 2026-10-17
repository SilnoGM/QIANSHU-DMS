import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑与三语键对齐使用 Node.js 内置 runner 验证。
import test from 'node:test'

import {
  formatMaskedAmount,
  formatUserShareRate,
  isNegativeAmount,
  PERSONAL_FUND_ACCOUNT_AMOUNT_MASK,
  resolvePersonalFundAccountCardState,
  resolvePersonalFundAccountPanelTone,
} from '../../src/components/business/QsPersonalFundAccountCard/logic'
import en from '../../src/locales/lang/qs-personal-fund-account/en.json'
import zhCn from '../../src/locales/lang/qs-personal-fund-account/zh-cn.json'
import zhTw from '../../src/locales/lang/qs-personal-fund-account/zh-tw.json'

test('分成比例只接受服务端两位小数百分比，异常值回落占位符', () => {
  assert.equal(formatUserShareRate('30.00'), '30.00%')
  assert.equal(formatUserShareRate('0.00'), '0.00%')
  assert.equal(formatUserShareRate('100.00'), '100.00%')
  // 服务端不会带空格，但展示层仍然做一次安全的宽松归一化。
  assert.equal(formatUserShareRate(' 5.50 '), '5.50%')

  for (const invalid of [null, undefined, '', '30', '30.000', '101.00', '-1.00', 'abc']) {
    assert.equal(formatUserShareRate(invalid), '—')
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
    'qsPersonalFundAccount.pageDescription',
    'qsPersonalFundAccount.pageTitle',
    'qsPersonalFundAccount.rateEffectiveAt',
    'qsPersonalFundAccount.refresh',
    'qsPersonalFundAccount.retry',
    'qsPersonalFundAccount.shareRate',
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
