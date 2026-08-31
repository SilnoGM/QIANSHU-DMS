import type { PurchaseOrderListItemDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 采购列表纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildPurchaseOrderListQuery,
  calculatePurchaseOrderPaymentProgress,
  fulfillmentStatusLabel,
  getPurchaseOrderPendingTaskItems,
  nextPurchaseOrderFulfillmentStatus,
  normalizePurchaseOrderPendingTask,
  orderStatusLabel,
  paymentStatusLabel,
  purchaseTypeLabel,
  resolvePurchaseOrderPendingActions,
} from '../../src/views/operations/purchase-orders/purchase-order-list.logic'

test('待办与全部列表严格映射服务端 view 并规范化筛选和日期范围', () => {
  assert.deepEqual(buildPurchaseOrderListQuery({
    dateRange: { orderDateFrom: '2026-08-01', orderDateTo: '2026-08-28' },
    filters: {
      fulfillmentStatus: 'PREPARING',
      orderStatus: 'CONFIRMED',
      paymentStatus: 'PARTIALLY_PAID',
      purchaseType: 'SALES_LINKED',
      supplierValue: 'SUPPLIER_CN_01',
    },
    page: 2,
    pageSize: 50,
    searchKeyword: '  PO-001 ',
    pendingTask: 'AWAITING_PAYMENT',
    viewMode: 'pending',
  }), {
    view: 'pending',
    page: 2,
    pageSize: 50,
    keyword: 'PO-001',
    pendingTask: 'AWAITING_PAYMENT',
    supplierValue: 'SUPPLIER_CN_01',
    purchaseType: 'SALES_LINKED',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    orderDateFrom: '2026-08-01',
    orderDateTo: '2026-08-28',
  })

  assert.deepEqual(buildPurchaseOrderListQuery({
    dateRange: {},
    filters: {
      fulfillmentStatus: 'UNKNOWN',
      purchaseType: 0,
      supplierValue: '',
    },
    page: 1,
    pageSize: 20,
    searchKeyword: '　',
    viewMode: 'all',
  }), { view: 'all', page: 1, pageSize: 20 })
})

test('采购列表标签完整覆盖类型、订单、履约与付款状态', () => {
  assert.equal(purchaseTypeLabel('SALES_LINKED'), '销售关联采购')
  assert.equal(purchaseTypeLabel('STOCK'), '备货采购')
  assert.equal(orderStatusLabel('CONFIRMED'), '已确认')
  assert.equal(orderStatusLabel('CANCELLED'), '已取消')
  assert.equal(fulfillmentStatusLabel('ORDERED'), '已下单')
  assert.equal(fulfillmentStatusLabel('PREPARING'), '备货中')
  assert.equal(fulfillmentStatusLabel('SHIPPED'), '已发货')
  assert.equal(fulfillmentStatusLabel('SIGNED'), '已签收')
  assert.equal(paymentStatusLabel('UNPAID'), '未付款')
  assert.equal(paymentStatusLabel('PARTIALLY_PAID'), '部分付款')
  assert.equal(paymentStatusLabel('PAID'), '已付清')
})

test('付款进度使用精确十进制并将进度条展示值限制在 100', () => {
  assert.deepEqual(calculatePurchaseOrderPaymentProgress('25.0000', '80.0000'), {
    formattedPercentage: '31.25%',
    progressValue: 31.25,
  })
  assert.deepEqual(calculatePurchaseOrderPaymentProgress('120.0000', '100.0000'), {
    formattedPercentage: '120.00%',
    progressValue: 100,
  })
  assert.equal(calculatePurchaseOrderPaymentProgress('0.0000', '0.0000'), null)
})

test('履约状态只按既定顺序推进，取消和签收订单没有下一步', () => {
  const base = {
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'ORDERED',
  } as Pick<PurchaseOrderListItemDto, 'fulfillmentStatus' | 'orderStatus'>

  assert.equal(nextPurchaseOrderFulfillmentStatus(base), 'PREPARING')
  assert.equal(nextPurchaseOrderFulfillmentStatus({ ...base, fulfillmentStatus: 'PREPARING' }), 'SHIPPED')
  assert.equal(nextPurchaseOrderFulfillmentStatus({ ...base, fulfillmentStatus: 'SHIPPED' }), 'SIGNED')
  assert.equal(nextPurchaseOrderFulfillmentStatus({ ...base, fulfillmentStatus: 'SIGNED' }), null)
  assert.equal(nextPurchaseOrderFulfillmentStatus({ ...base, orderStatus: 'CANCELLED' }), null)
})

test('待办采购任务固定三类并把无效 URL 值归一化为待发货', () => {
  assert.deepEqual(getPurchaseOrderPendingTaskItems(), [
    { label: '待发货', value: 'AWAITING_SHIPMENT' },
    { label: '待入仓', value: 'AWAITING_WAREHOUSE' },
    { label: '待付款', value: 'AWAITING_PAYMENT' },
  ])
  assert.equal(normalizePurchaseOrderPendingTask('AWAITING_WAREHOUSE'), 'AWAITING_WAREHOUSE')
  assert.equal(normalizePurchaseOrderPendingTask('UNKNOWN'), 'AWAITING_SHIPMENT')
  assert.equal(normalizePurchaseOrderPendingTask(undefined), 'AWAITING_SHIPMENT')
})

test('待办采购操作与当前任务一致且付款只对未付清订单展示', () => {
  assert.deepEqual(resolvePurchaseOrderPendingActions('AWAITING_SHIPMENT', {
    paymentStatus: 'UNPAID',
  }).map(item => item.label), ['发货', '付款'])
  assert.deepEqual(resolvePurchaseOrderPendingActions('AWAITING_SHIPMENT', {
    paymentStatus: 'PAID',
  }).map(item => item.label), ['发货'])
  assert.deepEqual(resolvePurchaseOrderPendingActions('AWAITING_WAREHOUSE', {
    paymentStatus: 'PARTIALLY_PAID',
  }).map(item => item.label), ['到仓', '付款'])
  assert.deepEqual(resolvePurchaseOrderPendingActions('AWAITING_PAYMENT', {
    paymentStatus: 'PARTIALLY_PAID',
  }).map(item => item.label), ['付款'])
})
