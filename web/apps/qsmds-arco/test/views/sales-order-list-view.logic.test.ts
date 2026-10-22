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
    '已完成 1 张采购单的本次货件发货，仍有 2 张采购单待发货',
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
    '已完成 2 张采购单的本次货件发货，销售订单已进入陆运中',
  )
  assert.equal(
    formatSalesFactoryShipmentSuccess({
      ...base,
      changedPurchaseOrderCount: 0,
      alreadySatisfiedCount: 1,
      remainingPendingShipmentCount: 0,
    }),
    '所选货件已发货，未重复处理',
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
    purchaseHold: 'AWAITING_PURCHASE_REVIEW',
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
      ['AWAITING_PURCHASE_REVIEW', '采购审核中'],
      ['PREPARING', '待发货'],
      ['LAND_TRANSIT', '待入仓'],
      ['WAREHOUSE_ARRIVED', '待装柜'],
      ['SEA_TRANSIT', '待签收'],
      ['WAITING_PAYMENT', '待收款'],
    ],
  )
  assert.deepEqual(resolveSalesOrderQueryTargets('pending', 'PENDING'), [{
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PENDING',
    purchaseHold: 'EXCLUDE_AWAITING_PURCHASE_REVIEW',
  }])
  assert.deepEqual(resolveSalesOrderQueryTargets('pending', 'AWAITING_PURCHASE_REVIEW'), [{
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PENDING',
    purchaseHold: 'AWAITING_PURCHASE_REVIEW',
  }])
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
  assert.equal(
    normalizeSalesOrderStatusSelection('pending', 'AWAITING_PURCHASE_REVIEW'),
    'AWAITING_PURCHASE_REVIEW',
  )
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
    purchaseHold: null,
  }
  const awaitingReview = {
    fulfillmentStatus: 'PENDING' as const,
    paymentStatus: 'UNPAID' as const,
    purchaseHold: {
      reason: 'AWAITING_PURCHASE_REVIEW' as const,
      pendingReviewOrderCount: 1,
    },
  }
  assert.deepEqual(
    resolvePendingSalesOrderActions('PENDING', pendingAndUnpaid).map(action => action.key),
    ['SUBMIT_PURCHASE'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('PENDING', pendingAndUnpaid).map(action => action.label),
    ['新增采购'],
  )
  // 待采购里若因并发仍出现审核中订单，也不再给出必然失败的入口。
  assert.deepEqual(
    resolvePendingSalesOrderActions('PENDING', awaitingReview).map(action => action.key),
    ['URGE_PURCHASE_REVIEW'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('AWAITING_PURCHASE_REVIEW', awaitingReview)
      .map(action => [action.key, action.label]),
    [['URGE_PURCHASE_REVIEW', '催办']],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('PREPARING', {
      fulfillmentStatus: 'PREPARING',
      paymentStatus: 'PARTIALLY_PAID',
      purchaseHold: null,
    }).map(action => action.key),
    ['FACTORY_SHIPMENT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('LAND_TRANSIT', {
      fulfillmentStatus: 'LAND_TRANSIT',
      paymentStatus: 'PAID',
      purchaseHold: null,
    }).map(action => action.key),
    ['WAREHOUSE_RECEIPT'],
  )
  // 待装柜不提供行内动作：装柜在采运工作台的柜次管理执行，全部货件装柜后订单自动进入海运在途。
  assert.deepEqual(
    resolvePendingSalesOrderActions('WAREHOUSE_ARRIVED', {
      fulfillmentStatus: 'WAREHOUSE_ARRIVED',
      paymentStatus: 'UNPAID',
      purchaseHold: null,
    }).map(action => action.key),
    [],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('SEA_TRANSIT', {
      fulfillmentStatus: 'SEA_TRANSIT',
      paymentStatus: 'UNPAID',
      purchaseHold: null,
    }).map(action => action.key),
    ['DELIVERY_RECEIPT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('WAITING_PAYMENT', {
      fulfillmentStatus: 'SIGNED',
      paymentStatus: 'PARTIALLY_PAID',
      purchaseHold: null,
    }).map(action => action.key),
    ['RECORD_PAYMENT'],
  )
  // 表外收款是与代收（表内）相对的口径；入口文案必须点明，避免又落回泛化的“实际收款”。
  assert.deepEqual(
    resolvePendingSalesOrderActions('WAITING_PAYMENT', {
      fulfillmentStatus: 'SIGNED',
      paymentStatus: 'PARTIALLY_PAID',
      purchaseHold: null,
    }).map(action => action.label),
    ['新增表外收款'],
  )

  assert.deepEqual(
    resolvePendingSalesOrderActions('ALL', {
      fulfillmentStatus: 'SEA_TRANSIT',
      paymentStatus: 'UNPAID',
      purchaseHold: null,
    }).map(action => action.key),
    ['DELIVERY_RECEIPT', 'RECORD_PAYMENT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('ALL', {
      fulfillmentStatus: 'SIGNED',
      paymentStatus: 'UNPAID',
      purchaseHold: null,
    }).map(action => action.key),
    ['RECORD_PAYMENT'],
  )
  assert.deepEqual(
    resolvePendingSalesOrderActions('ALL', {
      fulfillmentStatus: 'PENDING',
      paymentStatus: 'PAID',
      purchaseHold: null,
    }).map(action => action.key),
    ['SUBMIT_PURCHASE'],
  )
  // 全部待办仍按订单事实给出催办，不再给新增采购，收款入口照旧按付款状态派生。
  assert.deepEqual(
    resolvePendingSalesOrderActions('ALL', awaitingReview).map(action => action.key),
    ['URGE_PURCHASE_REVIEW', 'RECORD_PAYMENT'],
  )
})

test('全部待办按订单 ID 去重，并使用去重后的订单精确重算币种汇总', () => {
  const firstOrder = {
    agreedTotalAmount: '100.10',
    balanceDueAmount: '60.06',
    currencyCode: 'TWD' as const,
    depositDueAmount: '40.04',
    id: 'order-1',
    outstandingAmount: '70.07',
    receivedAmount: '30.03',
    standardSubtotalAmount: '120.12',
  }
  const secondOrder = {
    agreedTotalAmount: '0.20',
    balanceDueAmount: '0.12',
    currencyCode: 'TWD' as const,
    depositDueAmount: '0.08',
    id: 'order-2',
    outstandingAmount: '0.14',
    receivedAmount: '0.06',
    standardSubtotalAmount: '0.24',
  }
  const uniqueOrders = deduplicateSalesOrderItems([
    firstOrder,
    { ...firstOrder },
    secondOrder,
  ])

  assert.deepEqual(uniqueOrders.map(order => order.id), ['order-1', 'order-2'])
  assert.deepEqual(summarizeSalesOrderItemsByCurrency(uniqueOrders), [{
    agreedTotalAmount: '100.30',
    balanceDueAmount: '60.18',
    currencyCode: 'TWD',
    depositDueAmount: '40.12',
    orderCount: 2,
    outstandingAmount: '70.21',
    receivedAmount: '30.09',
    standardSubtotalAmount: '120.36',
  }])
})
