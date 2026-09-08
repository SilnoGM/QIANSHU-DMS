import type { FactoryShipmentModalPurchaseOrder } from '../../src/components/business/QsFactoryShipmentModal/types'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 公共弹窗纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import {
  buildFactoryShipmentIntent,
  calculateFactoryShipmentImpact,
  getPurchaseShipmentStatusMeta,
  sortFactoryShipmentOrders,
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
    lineSummary: { lineCount: 2, totalQuantity: 3, previews: [] },
  }
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
  assert.deepEqual(buildFactoryShipmentIntent({
    mode: 'SELECTED',
    orders,
    selectedIds: ['b'],
    reason: '  Ａ区发货  ',
  }), {
    mode: 'SELECTED',
    targets: [{ purchaseOrderId: 'b', expectedVersion: 2 }],
    reason: 'A区发货',
  })
  assert.deepEqual(buildFactoryShipmentIntent({
    mode: 'ALL_PENDING',
    orders,
    selectedIds: [],
    reason: '   ',
  }), {
    mode: 'ALL_PENDING',
    targets: [
      { purchaseOrderId: 'a', expectedVersion: 2 },
      { purchaseOrderId: 'b', expectedVersion: 2 },
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
    selectedIds: ['a'],
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
