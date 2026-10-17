import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line test/no-import-node-test -- 流水表纯逻辑与三语键对齐使用 Node.js 内置 runner 验证。
import test from 'node:test'
import en from '../../src/locales/lang/personal-finance-ledger/en.json'
import zhCn from '../../src/locales/lang/personal-finance-ledger/zh-cn.json'
import zhTw from '../../src/locales/lang/personal-finance-ledger/zh-tw.json'
import {
  LEDGER_BATCH_KIND_META,
  LEDGER_CATEGORY_META,
  LEDGER_DIRECTION_META,
  LEDGER_REVERSAL_META,
} from '../../src/views/operations/personal-finance/fund-accounts/ledger.logic'

test('流水类型、批次、冲账与方向元数据固定', () => {
  assert.deepEqual(Object.keys(LEDGER_CATEGORY_META), ['REVENUE', 'COST', 'ADJUSTMENT', 'NEUTRAL'])
  assert.equal(LEDGER_CATEGORY_META.REVENUE.icon, 'i-lucide:trending-up')
  assert.equal(LEDGER_CATEGORY_META.COST.icon, 'i-lucide:shopping-cart')
  assert.equal(LEDGER_CATEGORY_META.ADJUSTMENT.icon, 'i-lucide:sliders-horizontal')
  assert.equal(LEDGER_CATEGORY_META.NEUTRAL.icon, 'i-lucide:circle')

  assert.equal(LEDGER_BATCH_KIND_META.BUSINESS, null)
  assert.equal(LEDGER_BATCH_KIND_META.REVERSAL.labelKey, 'personalFinanceLedger.batchKind.REVERSAL')
  assert.equal(LEDGER_BATCH_KIND_META.MANUAL_ADJUSTMENT.labelKey, 'personalFinanceLedger.batchKind.MANUAL_ADJUSTMENT')

  assert.equal(LEDGER_REVERSAL_META.NONE, null)
  assert.equal(LEDGER_REVERSAL_META.NOT_APPLICABLE, null)
  assert.equal(LEDGER_REVERSAL_META.PARTIAL.labelKey, 'personalFinanceLedger.reversal.PARTIAL')
  assert.equal(LEDGER_REVERSAL_META.FULL.labelKey, 'personalFinanceLedger.reversal.FULL')

  assert.equal(LEDGER_DIRECTION_META.CREDIT.labelKey, 'personalFinanceLedger.direction.CREDIT')
  assert.equal(LEDGER_DIRECTION_META.DEBIT.labelKey, 'personalFinanceLedger.direction.DEBIT')
  assert.match(LEDGER_DIRECTION_META.DEBIT.badgeClass, /text-destructive/u)
  assert.match(LEDGER_DIRECTION_META.DEBIT.amountClass, /text-destructive/u)
})

test('流水行不再展示分成比例', () => {
  const source = readFileSync(
    new URL('../../src/views/operations/personal-finance/fund-accounts/index.vue', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(source, /personalFinanceLedger\.shareRate|userShareRateSnapshot/u)
})

function collectKeys(source: Record<string, unknown>): string[] {
  return Object.entries(source).flatMap(([key, value]) => (
    value && typeof value === 'object' && !Array.isArray(value)
      ? collectKeys(value as Record<string, unknown>).map(child => `${key}.${child}`)
      : [key]
  )).sort()
}

test('资金流水三语文案键完全对齐', () => {
  const reference = collectKeys(zhCn as unknown as Record<string, unknown>)
  assert.deepEqual(collectKeys(zhTw as unknown as Record<string, unknown>), reference)
  assert.deepEqual(collectKeys(en as unknown as Record<string, unknown>), reference)
  assert.deepEqual(reference, [
    'personalFinanceLedger.ariaLabel',
    'personalFinanceLedger.batchKind.MANUAL_ADJUSTMENT',
    'personalFinanceLedger.batchKind.REVERSAL',
    'personalFinanceLedger.batchNo',
    'personalFinanceLedger.businessNo',
    'personalFinanceLedger.category.ADJUSTMENT',
    'personalFinanceLedger.category.COST',
    'personalFinanceLedger.category.NEUTRAL',
    'personalFinanceLedger.category.REVENUE',
    'personalFinanceLedger.column.action',
    'personalFinanceLedger.column.amount',
    'personalFinanceLedger.column.balanceAfter',
    'personalFinanceLedger.column.balanceBefore',
    'personalFinanceLedger.column.businessBasis',
    'personalFinanceLedger.column.postedAt',
    'personalFinanceLedger.column.sequence',
    'personalFinanceLedger.column.summary',
    'personalFinanceLedger.column.typeSource',
    'personalFinanceLedger.detailComingSoon',
    'personalFinanceLedger.direction.CREDIT',
    'personalFinanceLedger.direction.DEBIT',
    'personalFinanceLedger.empty',
    'personalFinanceLedger.emptyHint',
    'personalFinanceLedger.loadError',
    'personalFinanceLedger.loading',
    'personalFinanceLedger.noBusinessNo',
    'personalFinanceLedger.reversal.FULL',
    'personalFinanceLedger.reversal.PARTIAL',
    'personalFinanceLedger.title',
    'personalFinanceLedger.total',
    'personalFinanceLedger.viewDetail',
  ])
})
