import type { PurchaseOrderDetailDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 入仓目标和时间约束使用内置 runner。
import test from 'node:test'
import { buildWarehouseReceiptRequest, eligibleWarehouseParts, minimumWarehouseReceivedAt } from '../../src/components/business/QsWarehouseReceiptModal/logic'

const now = new Date('2026-09-15T06:30:00.123Z')
function order() {
  return { id: 'order-1', version: 3, orderStatus: 'CONFIRMED', parts: [
    { id: 'ready', status: 'ACTIVE', shippedAt: '2026-09-15T06:00:00Z', warehouseReceivedAt: null },
    { id: 'unshipped', status: 'ACTIVE', shippedAt: null, warehouseReceivedAt: null },
    { id: 'received', status: 'ACTIVE', shippedAt: '2026-09-15T06:00:00Z', warehouseReceivedAt: '2026-09-15T06:20:00Z' },
    { id: 'cancelled', status: 'CANCELLED', shippedAt: '2026-09-15T06:00:00Z', warehouseReceivedAt: null },
  ] } as unknown as PurchaseOrderDetailDto
}

test('仅已发未入仓有效货件可选，单货件入口不会包含同订单其他货件', () => {
  assert.deepEqual(eligibleWarehouseParts(order()).map(part => part.id), ['ready'])
  assert.deepEqual(eligibleWarehouseParts(order(), ['received']), [])
  assert.deepEqual(eligibleWarehouseParts({ ...order(), orderStatus: 'CANCELLED' }), [])
})

test('使用最新订单版本和实际选中货件构造POST，不生成库存信息', () => {
  const result = buildWarehouseReceiptRequest({ detail: order(), selectedIds: ['ready'], receivedAt: now.toISOString(), remark: '  到货验收  ', now })
  assert.deepEqual(result, { valid: true, request: { expectedVersion: 3, partIds: ['ready'], receivedAt: now.toISOString(), remark: '到货验收' } })
})

test('禁止空选、重复、已入仓、未发货、已取消与超出单件入口范围的目标', () => {
  for (const selectedIds of [[], ['ready', 'ready'], ['received'], ['unshipped'], ['cancelled'], ['unknown']]) {
    const result = buildWarehouseReceiptRequest({ detail: order(), selectedIds, receivedAt: now.toISOString(), remark: '', now })
    assert.equal(result.valid, false)
  }
  assert.equal(buildWarehouseReceiptRequest({ detail: order(), scopeIds: ['received'], selectedIds: ['ready'], receivedAt: now.toISOString(), remark: '', now }).valid, false)
})

test('入仓时间不得未来、无时区或早于选中货件发货时间，备注按Unicode字符计算', () => {
  for (const receivedAt of ['', '2026-02-30T12:00:00.000Z', '2026-09-15T06:00:00', new Date(now.getTime() + 1).toISOString(), new Date('2026-09-15T05:59:59.999Z').toISOString()]) {
    assert.equal(buildWarehouseReceiptRequest({ detail: order(), selectedIds: ['ready'], receivedAt, remark: '', now }).valid, false)
  }
  assert.equal(buildWarehouseReceiptRequest({ detail: order(), selectedIds: ['ready'], receivedAt: now.toISOString(), remark: '😀'.repeat(500), now }).valid, true)
  assert.equal(buildWarehouseReceiptRequest({ detail: order(), selectedIds: ['ready'], receivedAt: now.toISOString(), remark: '😀'.repeat(501), now }).valid, false)
})

test('入仓时间下限取所选货件最晚发货时间，并向上取整到整秒避免亚毫秒误判', () => {
  const detail = { ...order(), parts: [
    { id: 'early', status: 'ACTIVE', shippedAt: '2026-09-15T05:00:00.000Z', warehouseReceivedAt: null },
    { id: 'late', status: 'ACTIVE', shippedAt: '2026-09-15T06:00:00.812345Z', warehouseReceivedAt: null },
    { id: 'unshipped', status: 'ACTIVE', shippedAt: null, warehouseReceivedAt: null },
  ] } as unknown as PurchaseOrderDetailDto

  // 只选早发货的货件时，下限是它自己（第 0 毫秒无需进位）。
  assert.equal(minimumWarehouseReceivedAt(detail, undefined, ['early']), '2026-09-15T05:00:00.000Z')
  // 多选时取最晚的一件；812 毫秒必须进到下一整秒，否则选择器会给出早于库内发货时间的秒。
  assert.equal(minimumWarehouseReceivedAt(detail, undefined, ['early', 'late']), '2026-09-15T06:00:01.000Z')
  assert.equal(minimumWarehouseReceivedAt(detail, undefined, ['early', 'unshipped']), '2026-09-15T05:00:00.000Z')
  // 未选择或范围不包含可选货件时不设下限。
  assert.equal(minimumWarehouseReceivedAt(detail, undefined, []), undefined)
  assert.equal(minimumWarehouseReceivedAt(detail, ['unshipped'], ['early']), undefined)
})
