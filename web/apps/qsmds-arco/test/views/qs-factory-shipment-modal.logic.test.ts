import type { FactoryShipmentModalPurchaseOrder } from '../../src/components/business/QsFactoryShipmentModal/types'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 公共弹窗纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import {
  buildFactoryShipmentIntent,
  calculateFactoryShipmentImpact,
  defaultShipmentSelection,
  getPurchaseShipmentStatusMeta,
  sortFactoryShipmentOrders,
  validateDestinationWarehouse,
  validateShipmentTrackingNo,
} from '../../src/components/business/QsFactoryShipmentModal/logic'

function order(
  id: string,
  fulfillmentStatus: FactoryShipmentModalPurchaseOrder['fulfillmentStatus'],
  orderDate = '2026-09-04',
): FactoryShipmentModalPurchaseOrder {
  return {
    id,
    orderNo: `PO-${id}`,
    orderDate,
    supplier: { label: `供应商 ${id}` },
    fulfillmentStatus,
    version: 2,
    shippingMarkText: null,
    parts: [{ id: `${id}-part`, shipmentNo: null, partNumber: 1, status: 'ACTIVE', shippingMarkText: null, shippedAt: fulfillmentStatus === 'SHIPPED' || fulfillmentStatus === 'SIGNED' ? '2026-09-04T00:00:00Z' : null, shippedById: null, shipmentRecordedAt: null, shipmentRemark: null, items: [] }],
    lineSummary: { lineCount: 2, totalQuantity: 3, previews: [] },
  }
}

test('每个选中货件必须指定目的地仓库，仅提交选中货件并保留稳定 value', () => {
  const input = { mode: 'SELECTED' as const, orders: [order('a', 'ORDERED'), order('b', 'ORDERED')], selectedIds: ['a-part'], reason: '' }
  assert.throws(() => buildFactoryShipmentIntent({ ...input, destinationWarehousesByPart: {} }), /warehouseRequired/u)
  assert.deepEqual(buildFactoryShipmentIntent({ ...input, destinationWarehousesByPart: { 'a-part': 'CN-WH-01', 'b-part': 'CN-WH-02' } }).targets[0]?.destinationWarehouses, [{ partId: 'a-part', warehouseValue: 'CN-WH-01' }])
  assert.equal(validateDestinationWarehouse(null, ['CN-WH-01']), 'required')
  assert.equal(validateDestinationWarehouse('CN-WH-01', []), 'unavailable')
  assert.equal(validateDestinationWarehouse('DISABLED', ['CN-WH-01']), 'unavailable')
  assert.equal(validateDestinationWarehouse('CN-WH-01', ['CN-WH-01']), null)
})

function buildValidFactoryShipmentIntent(input: Omit<Parameters<typeof buildFactoryShipmentIntent>[0], 'destinationWarehousesByPart'>) {
  return buildFactoryShipmentIntent({
    ...input,
    destinationWarehousesByPart: Object.fromEntries(input.orders.flatMap(order => order.parts.map(part => [part.id, 'CN-WH-01']))),
  })
}

test('待发货采购单稳定置前且已发货采购单置后', () => {
  const sorted = sortFactoryShipmentOrders([
    order('signed', 'SIGNED', '2026-09-01'),
    order('shipped', 'SHIPPED', '2026-09-02'),
    order('preparing', 'PREPARING', '2026-09-04'),
    order('ordered', 'ORDERED', '2026-09-03'),
  ])
  assert.deepEqual(sorted.map(item => item.id), [
    'ordered',
    'preparing',
    'signed',
    'shipped',
  ])
})

test('指定和全部模式构造稳定目标并规范化说明', () => {
  const orders = [
    order('b', 'PREPARING'),
    order('a', 'ORDERED'),
    order('done', 'SHIPPED'),
  ]
  assert.deepEqual(buildValidFactoryShipmentIntent({
    mode: 'SELECTED',
    orders,
    selectedIds: ['b-part'],
    reason: '  Ａ区发货  ',
  }), {
    mode: 'SELECTED',
    targets: [{ purchaseOrderId: 'b', expectedVersion: 2, partIds: ['b-part'], destinationWarehouses: [{ partId: 'b-part', warehouseValue: 'CN-WH-01' }] }],
    reason: 'A区发货',
  })
  assert.deepEqual(buildValidFactoryShipmentIntent({
    mode: 'ALL_PENDING',
    orders,
    selectedIds: [],
    reason: '   ',
  }), {
    mode: 'ALL_PENDING',
    targets: [
      { purchaseOrderId: 'a', expectedVersion: 2, partIds: ['a-part'], destinationWarehouses: [{ partId: 'a-part', warehouseValue: 'CN-WH-01' }] },
      { purchaseOrderId: 'b', expectedVersion: 2, partIds: ['b-part'], destinationWarehouses: [{ partId: 'b-part', warehouseValue: 'CN-WH-01' }] },
    ],
    reason: null,
  })
})

test('影响摘要只计算待发货目标并给出销售推进预告', () => {
  const orders = [
    order('a', 'ORDERED'),
    order('b', 'PREPARING'),
    order('done', 'SHIPPED'),
  ]
  assert.deepEqual(calculateFactoryShipmentImpact({
    mode: 'SELECTED',
    orders,
    selectedIds: ['a-part'],
  }), {
    selectedCount: 1,
    remainingCount: 1,
    willAdvanceSalesOrder: false,
  })
  assert.deepEqual(calculateFactoryShipmentImpact({
    mode: 'ALL_PENDING',
    orders,
    selectedIds: [],
  }), {
    selectedCount: 2,
    remainingCount: 0,
    willAdvanceSalesOrder: true,
  })
})

test('采购履约状态提供稳定中文和视觉语义', () => {
  assert.equal(getPurchaseShipmentStatusMeta('ORDERED').label, '已下单')
  assert.equal(getPurchaseShipmentStatusMeta('PREPARING').label, '备货中')
  assert.equal(getPurchaseShipmentStatusMeta('SHIPPED').label, '已发货')
  assert.equal(getPurchaseShipmentStatusMeta('SIGNED').label, '已签收')
})

test('部分发货只提交选择的未发货货件，不能重复或提前推进销售', () => {
  const pending = order('a', 'PARTIALLY_SHIPPED')
  const parts = [...pending.parts, { ...pending.parts[0]!, id: 'a-other' }]
  const context = { ...pending, parts }
  const result = buildValidFactoryShipmentIntent({ mode: 'SELECTED', orders: [context], selectedIds: ['a-part'], reason: '' })
  assert.deepEqual(result.targets[0]?.partIds, ['a-part'])
  assert.equal(calculateFactoryShipmentImpact({ mode: 'SELECTED', orders: [context], selectedIds: ['a-part'] }).remainingCount, 1)
})

test('只自动选择唯一未发货件，空货件及已发货件不能生成发货请求', () => {
  const pending = order('single', 'ORDERED')
  assert.deepEqual(defaultShipmentSelection([pending]), ['single-part'])
  assert.deepEqual(defaultShipmentSelection([pending, order('other', 'PREPARING')]), [])
  const shipped = order('done', 'SHIPPED')
  assert.deepEqual(buildValidFactoryShipmentIntent({ mode: 'SELECTED', orders: [shipped], selectedIds: ['done-part'], reason: '' }).targets, [])
  assert.deepEqual(buildValidFactoryShipmentIntent({ mode: 'ALL_PENDING', orders: [{ ...pending, parts: [] }], selectedIds: [], reason: '' }).targets, [])
})

test('物流单号只提交选中待发货件，去除首尾空格但保留大小写和全半角', () => {
  const orders = [order('a', 'ORDERED'), order('b', 'PREPARING'), order('done', 'SHIPPED')]
  const intent = buildValidFactoryShipmentIntent({
    mode: 'SELECTED',
    orders,
    selectedIds: ['a-part', 'done-part', 'missing'],
    reason: '',
    trackingNumbersByPart: { 'a-part': '  ＳＦab-１２3  ', 'b-part': 'UNSELECTED', 'done-part': 'SHIPPED', 'missing': 'UNKNOWN' },
  })
  assert.deepEqual(intent.targets, [{ purchaseOrderId: 'a', expectedVersion: 2, partIds: ['a-part'], destinationWarehouses: [{ partId: 'a-part', warehouseValue: 'CN-WH-01' }], trackingNumbers: [{ partId: 'a-part', trackingNo: 'ＳＦab-１２3' }] }])
})

test('未填写和仅空格的物流单号不进入请求，全选模式保留每个已填货件的独立编号', () => {
  const orders = [order('a', 'ORDERED'), order('b', 'PREPARING'), order('c', 'PREPARING')]
  const intent = buildValidFactoryShipmentIntent({ mode: 'ALL_PENDING', orders, selectedIds: [], reason: '', trackingNumbersByPart: { 'a-part': '  ', 'c-part': 'JD-123' } })
  assert.deepEqual(intent.targets, [
    { purchaseOrderId: 'a', expectedVersion: 2, partIds: ['a-part'], destinationWarehouses: [{ partId: 'a-part', warehouseValue: 'CN-WH-01' }] },
    { purchaseOrderId: 'b', expectedVersion: 2, partIds: ['b-part'], destinationWarehouses: [{ partId: 'b-part', warehouseValue: 'CN-WH-01' }] },
    { purchaseOrderId: 'c', expectedVersion: 2, partIds: ['c-part'], destinationWarehouses: [{ partId: 'c-part', warehouseValue: 'CN-WH-01' }], trackingNumbers: [{ partId: 'c-part', trackingNo: 'JD-123' }] },
  ])
})

test('物流单号限制100字符且拒绝控制字符，未选中错误草稿不影响提交', () => {
  assert.equal(validateShipmentTrackingNo('A'.repeat(100)), null)
  assert.equal(validateShipmentTrackingNo(` ${'A'.repeat(100)} `), null)
  assert.equal(validateShipmentTrackingNo('A'.repeat(101)), 'tooLong')
  for (const value of ['A\nB', 'A\tB', 'A\u0000B', 'A\u007FB', 'A\u0085B']) {
    assert.equal(validateShipmentTrackingNo(value), 'controlCharacters')
  }
  const input = { mode: 'SELECTED' as const, orders: [order('a', 'ORDERED')], selectedIds: ['a-part'], reason: '' }
  assert.throws(() => buildValidFactoryShipmentIntent({ ...input, trackingNumbersByPart: { 'a-part': 'A\nB' } }), /controlCharacters/u)
  assert.doesNotThrow(() => buildValidFactoryShipmentIntent({ ...input, trackingNumbersByPart: { 'not-selected': 'A\nB' } }))
})
