import type { FactoryShipmentResultDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售订单视图状态契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildSalesOrderStatusCountsQuery,
  deduplicateSalesOrderItems,
  formatSalesFactoryShipmentSuccess,
  getSalesOrderStatusItems,
  normalizeSalesOrderStatusSelection,
  resolvePendingSalesOrderActions,
  resolveSalesOrderQueryTargets,
  summarizeSalesOrderItemsByCurrency,
} from '../../src/views/operations/sales-orders/sales-order-list-view.logic'

test('销售工厂发货提示只采用服务端返回的变更与剩余数量', () => {
  const base: FactoryShipmentResultDto = {
    purchaseOrders: [{
      id: 'purchase-1',
      orderNo: 'PO/20260904-00001',
      fulfillmentStatus: 'SHIPPED',
      changed: true,
    }],
    changedPurchaseOrderCount: 1,
    alreadySatisfiedCount: 0,
    remainingPendingShipmentCount: 2,
    salesOrder: {
      id: 'sales-1',
      orderNo: 'SO/20260904-00001',
      fulfillmentStatus: 'PREPARING',
      advancedToLandTransit: false,
    },
  }

  assert.equal(
    formatSalesFactoryShipmentSuccess(base),
    '已确认 1 张采购单发货，仍有 2 张采购单待发货',
  )
  assert.equal(
    formatSalesFactoryShipmentSuccess({
      ...base,
      changedPurchaseOrderCount: 2,
      remainingPendingShipmentCount: 0,
      salesOrder: {
        ...base.salesOrder!,
        fulfillmentStatus: 'LAND_TRANSIT',
        advancedToLandTransit: true,
      },
    }),
    '已确认 2 张采购单发货，销售订单已进入陆运中',
  )
  assert.equal(
    formatSalesFactoryShipmentSuccess({
      ...base,
      changedPurchaseOrderCount: 0,
      alreadySatisfiedCount: 1,
      remainingPendingShipmentCount: 0,
    }),
    '所选采购单均已发货，未重复处理',
  )
})

test('销售状态计数查询只保留视图和非工具栏基础筛选', () => {
  assert.deepEqual(buildSalesOrderStatusCountsQuery({
    currencyCode: 'TWD',
    fulfillmentStatus: 'PREPARING',
    issuerUserId: '11111111-1111-4111-8111-111111111111',
    keyword: 'SO-001',
    orderDateFrom: '2026-08-01',
    orderStatus: 'CONFIRMED',
    page: 2,
    pageSize: 50,
    paymentStatus: 'PARTIALLY_PAID',
  }, 'all'), {
    currencyCode: 'TWD',
    issuerUserId: '11111111-1111-4111-8111-111111111111',
    keyword: 'SO-001',
    orderDateFrom: '2026-08-01',
    paymentStatus: 'PARTIALLY_PAID',
    view: 'all',
  })
})

test('待办视图不展示全部待办，并以待采购作为首个有效分类', () => {
  assert.deepEqual(
    getSalesOrderStatusItems('pending').map(item => [item.value, item.label]),
    [
      ['PENDING', '待采购'],
      ['PREPARING', '待发货'],
      ['LAND_TRANSIT', '待入仓'],
      ['WAREHOUSE_ARRIVED', '待装柜'],
      ['SEA_TRANSIT', '待签收'],
      ['WAITING_PAYMENT', '待收款'],
    ],
  )
  assert.deepEqual(resolveSalesOrderQueryTargets('pending', 'PENDING'), [
    { orderStatus: 'CONFIRMED', fulfillmentStatus: 'PENDING' },
  ])
  assert.deepEqual(resolveSalesOrderQueryTargets('pending', 'SEA_TRANSIT'), [
    { orderStatus: 'CONFIRMED', fulfillmentStatus: 'SEA_TRANSIT' },
  ])
  assert.deepEqual(resolveSalesOrderQueryTargets('pending', 'WAITING_PAYMENT'), [
    { orderStatus: 'CONFIRMED', paymentStatus: 'UNPAID' },
    { orderStatus: 'CONFIRMED', paymentStatus: 'PARTIALLY_PAID' },
  ])
})

test('全部订单视图排除草稿，并把四类正式状态映射到可信服务端查询', () => {
  assert.deepEqual(
    getSalesOrderStatusItems('all').map(item => [item.value, item.label]),
    [
      ['ALL', '全部订单'],
      ['CONFIRMED', '已确认'],
      ['PENDING_RECONCILIATION', '待对账'],
      ['CANCELLED', '已取消'],
      ['COMPLETED', '已完成'],
    ],
  )
  assert.deepEqual(resolveSalesOrderQueryTargets('all', 'ALL'), [
    { orderStatus: 'CONFIRMED' },
    { orderStatus: 'PENDING_RECONCILIATION' },
    { orderStatus: 'CANCELLED' },
    { orderStatus: 'COMPLETED' },
  ])
  assert.deepEqual(resolveSalesOrderQueryTargets('all', 'PENDING_RECONCILIATION'), [
    { orderStatus: 'PENDING_RECONCILIATION' },
  ])
  assert.deepEqual(resolveSalesOrderQueryTargets('all', 'COMPLETED'), [
    { orderStatus: 'COMPLETED' },
  ])
})

test('URL 中缺失、非法或跨视图状态回退到当前视图默认状态', () => {
  assert.equal(normalizeSalesOrderStatusSelection('pending', 'PREPARING'), 'PREPARING')
  assert.equal(normalizeSalesOrderStatusSelection('pending', undefined), 'PENDING')
  assert.equal(normalizeSalesOrderStatusSelection('pending', 'ALL'), 'PENDING')
  assert.equal(normalizeSalesOrderStatusSelection('pending', 'CANCELLED'), 'PENDING')
  assert.equal(normalizeSalesOrderStatusSelection('all', ['CONFIRMED']), 'ALL')
  assert.equal(normalizeSalesOrderStatusSelection('all', undefined), 'ALL')
})

test('待办操作按当前筛选收敛，全部待办允许履约与收款操作并存', () => {
  const pendingAndUnpaid = {
    fulfillmentStatus: 'PENDING' as const,
    paymentStatus: 'UNPAID' as const,
  }
  assert.deepEqual(
    resolvePendingSalesOrderActions('PENDING', pendingAndUnpaid).map(action => action.key),
    ['SUBMIT_PURCHASE'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('PENDING', pendingAndUnpaid).map(action => action.label),
    ['新增采购'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('PREPARING', {
      fulfillmentStatus: 'PREPARING',
      paymentStatus: 'PARTIALLY_PAID',
    }).map(action => action.key),
    ['FACTORY_SHIPMENT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('LAND_TRANSIT', {
      fulfillmentStatus: 'LAND_TRANSIT',
      paymentStatus: 'PAID',
    }).map(action => action.key),
    ['WAREHOUSE_RECEIPT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('WAREHOUSE_ARRIVED', {
      fulfillmentStatus: 'WAREHOUSE_ARRIVED',
      paymentStatus: 'UNPAID',
    }).map(action => action.key),
    ['CONTAINER_SHIPMENT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('SEA_TRANSIT', {
      fulfillmentStatus: 'SEA_TRANSIT',
      paymentStatus: 'UNPAID',
    }).map(action => action.key),
    ['DELIVERY_RECEIPT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('WAITING_PAYMENT', {
      fulfillmentStatus: 'SIGNED',
      paymentStatus: 'PARTIALLY_PAID',
    }).map(action => action.key),
    ['RECORD_PAYMENT'],
  )

  assert.deepEqual(
    resolvePendingSalesOrderActions('ALL', {
      fulfillmentStatus: 'SEA_TRANSIT',
      paymentStatus: 'UNPAID',
    }).map(action => action.key),
    ['DELIVERY_RECEIPT', 'RECORD_PAYMENT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('ALL', {
      fulfillmentStatus: 'SIGNED',
      paymentStatus: 'UNPAID',
    }).map(action => action.key),
    ['RECORD_PAYMENT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('ALL', {
      fulfillmentStatus: 'PENDING',
      paymentStatus: 'PAID',
    }).map(action => action.key),
    ['SUBMIT_PURCHASE'],
  )
})

test('全部待办按订单 ID 去重，并使用去重后的订单精确重算币种汇总', () => {
  const firstOrder = {
    agreedTotalAmount: '100.1000',
    balanceDueAmount: '60.0600',
    currencyCode: 'TWD' as const,
    depositDueAmount: '40.0400',
    id: 'order-1',
    outstandingAmount: '70.0700',
    receivedAmount: '30.0300',
    standardSubtotalAmount: '120.1200',
  }
  const secondOrder = {
    agreedTotalAmount: '0.2000',
    balanceDueAmount: '0.1200',
    currencyCode: 'TWD' as const,
    depositDueAmount: '0.0800',
    id: 'order-2',
    outstandingAmount: '0.1400',
    receivedAmount: '0.0600',
    standardSubtotalAmount: '0.2400',
  }
  const uniqueOrders = deduplicateSalesOrderItems([
    firstOrder,
    { ...firstOrder },
    secondOrder,
  ])

  assert.deepEqual(uniqueOrders.map(order => order.id), ['order-1', 'order-2'])
  assert.deepEqual(summarizeSalesOrderItemsByCurrency(uniqueOrders), [{
    agreedTotalAmount: '100.3000',
    balanceDueAmount: '60.1800',
    currencyCode: 'TWD',
    depositDueAmount: '40.1200',
    orderCount: 2,
    outstandingAmount: '70.2100',
    receivedAmount: '30.0900',
    standardSubtotalAmount: '120.3600',
  }])
})
