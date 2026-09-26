import type { SlhBillLineChargeDto, SlhBillLineDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与柜次展示测试保持一致的十进制格式化口径。
import test from 'node:test'
import {
  formatSlhBillAmount,
  formatSlhBillDimensions,
  formatSlhBillRate,
  formatSlhBillVolume,
  formatSlhBillWeight,
  groupSlhBillCharges,
  resolveSlhBillVolumeDifference,
} from '../../src/views/workbenches/slh-bills/display.logic'
import { buildSlhBillLineColumns } from '../../src/views/workbenches/slh-bills/line-columns.logic'

const charge = (chargeType: SlhBillLineChargeDto['chargeType'], currencyCode: SlhBillLineChargeDto['currencyCode'], amount: string): SlhBillLineChargeDto => ({ amount, chargeType, currencyCode })

test('汇率固定两位小数展示，未知值保持为空且不改变原始精度', () => {
  assert.equal(formatSlhBillRate('4.8'), '4.80')
  assert.equal(formatSlhBillRate('4.800000000000'), '4.80')
  assert.equal(formatSlhBillRate('4.805'), '4.81')
  assert.equal(formatSlhBillRate('0'), '0.00')
  assert.equal(formatSlhBillRate('-0.005'), '-0.01')
  assert.equal(formatSlhBillRate('35.123456789012'), '35.12')
  assert.equal(formatSlhBillRate('999999999999999.999'), '1000000000000000.00')
  assert.equal(formatSlhBillRate(null), null)
  assert.equal(formatSlhBillRate(undefined), null)
  // 材积与汇率共用同一套两位小数口径。
  assert.equal(formatSlhBillVolume('12.88272063'), '12.88')
  assert.equal(formatSlhBillVolume('1.005'), '1.01')
  assert.equal(formatSlhBillVolume(null), null)
})

test('尺寸缺边或单位缺失时不用零或猜测单位补位', () => {
  assert.equal(formatSlhBillDimensions({ heightCm: '108.00', lengthCm: '240.00', widthCm: '164.00' }), '240.00 × 164.00 × 108.00')
  assert.equal(formatSlhBillDimensions({ heightCm: null, lengthCm: '240.00', widthCm: '164.00' }), null)
  assert.equal(formatSlhBillDimensions({}), null)
  // 重量与其它数值列一样收敛到两位小数。
  assert.equal(formatSlhBillWeight({ grossWeightKg: '1173.000', weightUnit: 'KGS' }), '1173.00 KGS')
  assert.equal(formatSlhBillWeight({ grossWeightKg: '1173.456' }), '1173.46')
  assert.equal(formatSlhBillWeight({ grossWeightKg: null, weightUnit: 'KGS' }), null)
})

test('费用明细按币种分组，组内保持来源顺序并且不合并币种', () => {
  const grouped = groupSlhBillCharges([
    charge('STORAGE', 'TWD', '60.00'),
    charge('FREIGHT', 'CNY', '100.00'),
    charge('WAITING', 'TWD', '20.00'),
    charge('OTHER', 'CNY', '5.00'),
  ])
  assert.deepEqual(grouped.map(group => group.currencyCode), ['CNY', 'TWD'])
  assert.deepEqual(grouped[0]?.items.map(item => item.chargeType), ['FREIGHT', 'OTHER'])
  assert.deepEqual(grouped[1]?.items.map(item => item.chargeType), ['STORAGE', 'WAITING'])
  assert.deepEqual(groupSlhBillCharges([]), [])
})

test('明细列覆盖账单全部字段并统一按两位小数与费别名展示', () => {
  const translate = (key: string, params?: Record<string, unknown>) => params === undefined
    ? key
    : `${key}(${Object.values(params).join(',')})`
  const columns = buildSlhBillLineColumns(translate)
  for (const id of ['sequence', 'lineNumber', 'loadingDate', 'containerBatchName', 'warehouseReceiptReference', 'shippingMark', 'goodsName', 'packageCount', 'weight', 'dimensions', 'volumeCai', 'reportedVolumeCai', 'volumeDifferenceCai', 'categoryCode', 'unitPriceAmount', 'pricingBasis', 'freightAmountCny', 'codHandlingAmountCny', 'surchargeAmountCny', 'payableAmountCny', 'codAmountTwd', 'ntdSurchargeAmountTwd', 'charges', 'recipientInfo', 'remark']) {
    assert.ok(columns.some(column => column.id === id), id)
  }
  assert.ok(columns.every(column => column.defaultVisible !== false))
  const display = (id: string, row: Partial<SlhBillLineDto>, index = 0) => columns.find(column => column.id === id)!.accessorFn!(row as SlhBillLineDto, index)
  // 材积两列都带单位，差异由「系统计算 − 账单自报」算出而不是读来源字段。
  assert.equal(display('volumeCai', { volumeCai: '12.88272063' }), '12.88 slhBill.unit.cai')
  assert.equal(display('reportedVolumeCai', { reportedVolumeCai: '12.885' }), '12.89 slhBill.unit.cai')
  assert.equal(display('volumeDifferenceCai', { reportedVolumeCai: '13.00', volumeCai: '12.88' }), '-0.12 slhBill.unit.cai')
  assert.equal(display('volumeDifferenceCai', { reportedVolumeCai: '12.88', volumeCai: '12.88' }), '')
  assert.equal(display('volumeDifferenceCai', { reportedVolumeCai: null, volumeCai: '12.88' }), '')
  assert.equal(display('reportedVolumeCai', { reportedVolumeCai: null }), 'slhBill.valueMissing')
  // 序号是列表自己的计数，行号是原表行号；两者含义不同。
  assert.equal(display('sequence', {}, 4), 5)
  // 行号取原表行号：表头在第 13 行时第一条明细是第 14 行。
  assert.equal(display('lineNumber', { sourceRowNumber: 14 }), 'slhBill.line.lineNumberValue(14)')
  assert.equal(display('weight', { grossWeightKg: '1173.000', weightUnit: 'KGS' }), '1173.00 KGS')
  assert.equal(display('dimensions', { heightCm: '108.00', lengthCm: '240.00', widthCm: '164.00' }), '240.00 × 164.00 × 108.00 slhBill.unit.cm')
  // 金额列统一两位小数：来源字符串会省略小数位。
  assert.equal(display('freightAmountCny', { freightAmountCny: '4425' }), '4425.00')
  assert.equal(display('payableAmountCny', { payableAmountCny: '4555.0' }), '4555.00')
  assert.equal(display('codAmountTwd', { codAmountTwd: null }), 'slhBill.valueMissing')
  assert.equal(display('pricingBasis', { pricingBasis: 'VOLUME' }), 'slhBill.pricingBasis.VOLUME')
  assert.equal(display('pricingBasis', { pricingBasis: undefined }), 'slhBill.valueMissing')
  assert.equal(display('packageCount', { packageCount: 12, packageUnit: '件' }), '12 件')
  assert.equal(display('recipientInfo', { recipientInfoRaw: '' }), 'slhBill.valueMissing')
  // 费用明细的纯文本兜底同时给出币种与费别名，避免移动端只看到金额。
  assert.equal(display('charges', { charges: [charge('FREIGHT', 'CNY', '100.00'), charge('WAITING', 'TWD', '20.00')] }), 'CNY slhBill.chargeType.FREIGHT 100.00；TWD slhBill.chargeType.WAITING 20.00')
  assert.equal(display('charges', { charges: [] }), '')
})

test('序号从 1 开始并按页偏移递推，跨页连续', () => {
  const translate = (key: string) => key
  const firstPage = buildSlhBillLineColumns(translate)
  const thirdPage = buildSlhBillLineColumns(translate, { sequenceOffset: 40 })
  const sequence = (columns: ReturnType<typeof buildSlhBillLineColumns>, index: number) =>
    columns.find(column => column.id === 'sequence')!.accessorFn!({} as SlhBillLineDto, index)
  assert.equal(sequence(firstPage, 0), 1)
  assert.equal(sequence(firstPage, 19), 20)
  assert.equal(sequence(thirdPage, 0), 41)
  // 负偏移按 0 处理，避免出现 0 或负数序号。
  assert.equal(
    sequence(buildSlhBillLineColumns(translate, { sequenceOffset: -10 }), 0),
    1,
  )
})

test('金额统一两位小数，缺值不伪造为零', () => {
  assert.equal(formatSlhBillAmount('4425'), '4425.00')
  assert.equal(formatSlhBillAmount('0'), '0.00')
  assert.equal(formatSlhBillAmount('-87482.5'), '-87482.50')
  assert.equal(formatSlhBillAmount('900.005'), '900.01')
  assert.equal(formatSlhBillAmount(null), null)
  assert.equal(formatSlhBillAmount(''), null)
})

test('材积差异取系统计算减账单自报，正负各自成态', () => {
  // 系统算得更多：红色（账单写少了）。
  assert.deepEqual(
    resolveSlhBillVolumeDifference({ reportedVolumeCai: '12.00', volumeCai: '13.50' }),
    { text: '+1.50', tone: 'over' },
  )
  // 账单写得更多：绿色。
  assert.deepEqual(
    resolveSlhBillVolumeDifference({ reportedVolumeCai: '13.50', volumeCai: '12.00' }),
    { text: '-1.50', tone: 'under' },
  )
  // 一致时不下发数值，由界面显示占位符。
  assert.deepEqual(
    resolveSlhBillVolumeDifference({ reportedVolumeCai: '12.88', volumeCai: '12.880' }),
    { text: '', tone: 'even' },
  )
  // 两位小数下相等也视为一致，避免浮点尾巴造出假差异。
  assert.deepEqual(
    resolveSlhBillVolumeDifference({ reportedVolumeCai: '12.88', volumeCai: '12.8801' }),
    { text: '', tone: 'even' },
  )
  // 任一侧缺失无法判定。
  assert.equal(
    resolveSlhBillVolumeDifference({ reportedVolumeCai: null, volumeCai: '12.88' }),
    null,
  )
  assert.equal(
    resolveSlhBillVolumeDifference({ reportedVolumeCai: '12.88', volumeCai: null }),
    null,
  )
})
