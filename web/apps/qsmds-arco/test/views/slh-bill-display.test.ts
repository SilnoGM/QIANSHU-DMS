import type { SlhBillLineChargeDto, SlhBillLineDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 与柜次展示测试保持一致的十进制格式化口径。
import test from 'node:test'
import { formatSlhBillDimensions, formatSlhBillRate, formatSlhBillVolume, formatSlhBillWeight, groupSlhBillCharges } from '../../src/views/workbenches/slh-bills/display.logic'
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
  assert.equal(formatSlhBillWeight({ grossWeightKg: '1173.000', weightUnit: 'KGS' }), '1173.000 KGS')
  assert.equal(formatSlhBillWeight({ grossWeightKg: '1173.000' }), '1173.000')
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
  const columns = buildSlhBillLineColumns(key => key)
  for (const id of ['lineNumber', 'loadingDate', 'containerBatchName', 'warehouseReceiptReference', 'shippingMark', 'goodsName', 'packageCount', 'weight', 'dimensions', 'volumeCai', 'reportedVolumeCai', 'volumeDifferenceCai', 'categoryCode', 'unitPriceAmount', 'pricingBasis', 'freightAmountCny', 'codHandlingAmountCny', 'surchargeAmountCny', 'payableAmountCny', 'codAmountTwd', 'ntdSurchargeAmountTwd', 'charges', 'recipientInfo', 'remark']) {
    assert.ok(columns.some(column => column.id === id), id)
  }
  assert.ok(columns.every(column => column.defaultVisible !== false))
  const display = (id: string, row: Partial<SlhBillLineDto>) => columns.find(column => column.id === id)!.accessorFn!(row as SlhBillLineDto, 0)
  assert.equal(display('volumeCai', { volumeCai: '12.88272063' }), '12.88')
  assert.equal(display('reportedVolumeCai', { reportedVolumeCai: '12.885' }), '12.89')
  assert.equal(display('volumeDifferenceCai', { volumeDifferenceCai: '-0.125' }), '-0.13')
  assert.equal(display('reportedVolumeCai', { reportedVolumeCai: null }), 'slhBill.unknown')
  assert.equal(display('weight', { grossWeightKg: '1173.000', weightUnit: 'KGS' }), '1173.000 KGS')
  assert.equal(display('dimensions', { heightCm: '108.00', lengthCm: '240.00', widthCm: '164.00' }), '240.00 × 164.00 × 108.00')
  assert.equal(display('pricingBasis', { pricingBasis: 'VOLUME' }), 'slhBill.pricingBasis.VOLUME')
  assert.equal(display('pricingBasis', { pricingBasis: undefined }), 'slhBill.unknown')
  assert.equal(display('packageCount', { packageCount: 12, packageUnit: '件' }), '12 件')
  assert.equal(display('recipientInfo', { recipientInfoRaw: '' }), 'slhBill.unknown')
  // 费用明细的纯文本兜底同时给出币种与费别名，避免移动端只看到金额。
  assert.equal(display('charges', { charges: [charge('FREIGHT', 'CNY', '100.00'), charge('WAITING', 'TWD', '20.00')] }), 'CNY slhBill.chargeType.FREIGHT 100.00；TWD slhBill.chargeType.WAITING 20.00')
  assert.equal(display('charges', { charges: [] }), '')
})
