import type { SlhBillFindingDto, SlhBillReportedDto, SlhBillTotalsDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与其它账单用例保持一致，直接断言纯函数。
import test from 'node:test'
import { buildSlhBillComparison, collectSlhBillFlaggedRowNumbers, countSlhBillFindings, groupSlhBillFindings, pageForSlhBillLine } from '../../src/views/workbenches/slh-bills/comparison.logic'

// 真实 1 月账单的数值：876 项对比里两侧应完全一致。
const totals: SlhBillTotalsDto = {
  freightTotalAmountCny: '84072.50',
  codHandlingTotalAmountCny: '810.00',
  surchargeTotalAmountCny: '2600.00',
  payableTotalAmountCny: '87482.50',
  codTotalAmountTwd: '1903850.00',
  ntdSurchargeTotalAmountTwd: '33271.00',
  reportedNetAmountTwd: '1870579.00',
}
const reported: SlhBillReportedDto = {
  subtotalPayableAmountCny: '87482.50',
  subtotalCodAmountTwd: '1903850.00',
  subtotalNtdSurchargeAmountTwd: '33271.00',
  payableAmountCny: '-87482.50',
  netAmountTwd: '389703.96',
  netAmountFormula: '(V58-W58)/4.8',
  embeddedForeignUnitsPerCny: '4.800000000000',
  reportedNetAmountTwd: '1870579.00',
}

test('明细累加与账单小计逐项对齐，四项都判为一致', () => {
  const comparison = buildSlhBillComparison({ totals, reported, embeddedForeignUnitsPerCny: '4.800000000000' })
  assert.deepEqual(comparison.rows.map(row => [row.key, row.status, row.difference]), [
    ['payable', 'match', '0.00'],
    ['codTwd', 'match', '0.00'],
    ['ntdSurchargeTwd', 'match', '0.00'],
    ['netTwd', 'match', '0.00'],
  ])
  // 应付行用「小计」行对比，不用相反数的那一行。
  assert.equal(comparison.rows[0]?.reported, '87482.50')
})

test('台币净额在账单已折算时折回同一口径再比，并标注折回值', () => {
  const comparison = buildSlhBillComparison({ totals, reported, embeddedForeignUnitsPerCny: '4.800000000000' })
  const net = comparison.rows.find(row => row.key === 'netTwd')!
  assert.equal(net.computed, '1870579.00')
  // 1,870,579 ÷ 4.8 = 389,703.96，与账单原值在同精度下相等。
  assert.equal(net.comparableComputed, '389703.96')
  assert.equal(net.reported, '389703.96')
  assert.equal(net.currency, 'TWD')
  assert.equal(net.reportedCurrency, 'CNY')
})

test('账单没有内嵌汇率时不做折算，直接按台币比', () => {
  const comparison = buildSlhBillComparison({
    totals,
    reported: { ...reported, netAmountTwd: '1870579.00', netAmountFormula: 'V58-W58', embeddedForeignUnitsPerCny: null },
    embeddedForeignUnitsPerCny: null,
  })
  const net = comparison.rows.find(row => row.key === 'netTwd')!
  assert.equal(net.comparableComputed, null)
  assert.equal(net.reportedCurrency, 'TWD')
  assert.equal(net.status, 'match')
})

test('对不上时报出方向与差额，账单没写的项标为无法对比', () => {
  const comparison = buildSlhBillComparison({
    totals: { ...totals, payableTotalAmountCny: '87400.00' },
    reported,
    embeddedForeignUnitsPerCny: '4.800000000000',
  })
  const payable = comparison.rows[0]!
  assert.equal(payable.status, 'mismatch')
  // 差额为正表示账单写得比明细累加多。
  assert.equal(payable.difference, '82.50')

  const missing = buildSlhBillComparison({
    totals,
    reported: { ...reported, subtotalCodAmountTwd: null },
    embeddedForeignUnitsPerCny: null,
  }).rows.find(row => row.key === 'codTwd')!
  assert.equal(missing.status, 'unavailable')
  assert.equal(missing.reported, null)
  assert.equal(missing.difference, null)
})

test('支持项列出账单不提供小计的三项', () => {
  const comparison = buildSlhBillComparison({ totals, reported, embeddedForeignUnitsPerCny: null })
  assert.deepEqual(comparison.supportTotals, [
    { key: 'freight', value: '84072.50' },
    { key: 'codHandling', value: '810.00' },
    { key: 'surcharge', value: '2600.00' },
  ])
})

function finding(
  kind: SlhBillFindingDto['kind'],
  severity: SlhBillFindingDto['severity'],
  lineNumber: number | null,
  message: string,
  sourceRowNumber: number | null = lineNumber === null ? null : lineNumber + 13,
): SlhBillFindingDto {
  return { kind, lineNumber, message, severity, sourceRowNumber }
}

test('差异按类型分组，组内按行号排序且账单级排最前', () => {
  const groups = groupSlhBillFindings([
    finding('FREIGHT_MISMATCH', 'difference', 7, 'b'),
    finding('FREIGHT_MISMATCH', 'difference', 2, 'a'),
    finding('SUBTOTAL_MISMATCH', 'difference', null, 'bill level'),
    finding('RATE_MISSING', 'warning', null, 'no rate'),
  ])
  // 组内按原表行号排序，同时保留内部序号用于跳页。
  assert.deepEqual(groups.map(group => [group.kind, group.severity, group.items.map(item => [item.lineNumber, item.sourceRowNumber])]), [
    ['FREIGHT_MISMATCH', 'difference', [[2, 15], [7, 20]]],
    ['SUBTOTAL_MISMATCH', 'difference', [[null, null]]],
    ['RATE_MISSING', 'warning', [[null, null]]],
  ])
})

test('差异与告警分别计数', () => {
  assert.deepEqual(countSlhBillFindings([
    finding('FREIGHT_MISMATCH', 'difference', 1, 'x'),
    finding('VOLUME_MISMATCH', 'difference', 2, 'y'),
    finding('RATE_MISSING', 'warning', null, 'z'),
  ]), { difference: 2, warning: 1 })
  assert.deepEqual(countSlhBillFindings([]), { difference: 0, warning: 0 })
})

test('行号换算成明细页码，非法输入退回第一页', () => {
  assert.equal(pageForSlhBillLine(1, 20), 1)
  assert.equal(pageForSlhBillLine(20, 20), 1)
  assert.equal(pageForSlhBillLine(21, 20), 2)
  assert.equal(pageForSlhBillLine(44, 20), 3)
  assert.equal(pageForSlhBillLine(0, 20), 1)
  assert.equal(pageForSlhBillLine(5, 0), 1)
})

test('问题行号按原表行号汇总，账单级差异不参与标黄', () => {
  const flagged = collectSlhBillFlaggedRowNumbers([
    finding('FREIGHT_MISMATCH', 'difference', 1, 'a'),
    finding('RATE_MISSING', 'warning', null, 'bill level'),
    finding('VOLUME_MISMATCH', 'difference', 3, 'c', 16),
    finding('FREIGHT_MISMATCH', 'difference', 1, 'again'),
  ])
  // 账单内序号 1 对应原表第 14 行；同行的多条问题只算一次。
  assert.deepEqual([...flagged].sort((left, right) => left - right), [14, 16])
  assert.deepEqual([...collectSlhBillFlaggedRowNumbers([])], [])
})
