import type {
  FactoryShipmentResultDto,
  PurchaseOrderListItemDto,
} from '../../src/api/generated/types.gen'
import type { CurrencyDescriptor } from '../../src/components/base/currency'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 采购列表纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildPurchaseOrderListQuery,
  buildPurchaseOrderStatusCountsQuery,
  calculatePurchaseOrderPaymentProgress,
  canCancelPurchaseOrderFromList,
  formatPurchaseFactoryShipmentSuccess,
  formatPurchaseOrderSummaryAmount,
  fulfillmentStatusLabel,
  getPurchaseOrderStatusItems,
  nextPurchaseOrderFulfillmentStatus,
  normalizePurchaseOrderStatusSelection,
  orderStatusLabel,
  orderStatusTagClass,
  paymentStatusLabel,
  purchaseTypeLabel,
  resolvePurchaseOrderPendingActions,
} from '../../src/views/operations/purchase-orders/purchase-order-list.logic'

const currencies: readonly CurrencyDescriptor[] = [
  { code: 'CNY', enabled: true, minorUnit: 2, name: '人民币', symbol: '¥' },
]

test('采购汇总矩阵保留精确金额与人民币符号但不重复币种代码', () => {
  assert.equal(formatPurchaseOrderSummaryAmount('31000', 'CNY', currencies), '¥31,000.00')
  assert.equal(formatPurchaseOrderSummaryAmount('15000.005', 'CNY', currencies), '¥15,000.01')
  assert.equal(formatPurchaseOrderSummaryAmount(null, 'CNY', currencies), '—')
})

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
    statusSelection: 'AWAITING_PAYMENT',
    viewMode: 'pending',
  }), {
    view: 'pending',
    page: 2,
    pageSize: 50,
    keyword: 'PO-001',
    pendingTask: 'AWAITING_PAYMENT',
    supplierValue: 'SUPPLIER_CN_01',
    purchaseType: 'SALES_LINKED',
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
    statusSelection: 'ALL',
    viewMode: 'all',
  }), { view: 'all', page: 1, pageSize: 20 })

  assert.deepEqual(buildPurchaseOrderListQuery({
    dateRange: {},
    filters: { orderStatus: 'COMPLETED' },
    page: 1,
    pageSize: 20,
    searchKeyword: '',
    statusSelection: 'COMPLETED',
    viewMode: 'all',
  }), {
    view: 'all',
    page: 1,
    pageSize: 20,
    orderStatus: 'COMPLETED',
  })
})

test('采购状态计数查询排除分页、订单状态和待办任务', () => {
  assert.deepEqual(buildPurchaseOrderStatusCountsQuery({
    view: 'pending',
    page: 3,
    pageSize: 50,
    keyword: 'PO-001',
    supplierValue: 'SUPPLIER_CN_01',
    purchaseType: 'SALES_LINKED',
    pendingTask: 'AWAITING_PAYMENT',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
  }), {
    view: 'pending',
    keyword: 'PO-001',
    supplierValue: 'SUPPLIER_CN_01',
    purchaseType: 'SALES_LINKED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
  })
})

test('采购列表标签完整覆盖类型、订单、履约与付款状态', () => {
  assert.equal(purchaseTypeLabel('SALES_LINKED'), '销售关联采购')
  assert.equal(purchaseTypeLabel('STOCK'), '备货采购')
  assert.equal(orderStatusLabel('CONFIRMED'), '已确认')
  assert.equal(orderStatusLabel('COMPLETED'), '已完成')
  assert.equal(orderStatusLabel('CANCELLED'), '已取消')
  assert.match(orderStatusTagClass('COMPLETED'), /text-primary/u)
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
  assert.equal(nextPurchaseOrderFulfillmentStatus({
    ...base,
    fulfillmentStatus: 'SHIPPED',
    orderStatus: 'COMPLETED',
  }), null)
})

test('全部与待办采购使用稳定状态顺序并规范化 URL', () => {
  assert.deepEqual(getPurchaseOrderStatusItems('all'), [
    { label: '全部采购', value: 'ALL' },
    { label: '已确认', value: 'CONFIRMED' },
    { label: '已完成', value: 'COMPLETED' },
    { label: '已取消', value: 'CANCELLED' },
  ])
  assert.deepEqual(getPurchaseOrderStatusItems('pending'), [
    { label: '待发货', value: 'AWAITING_SHIPMENT' },
    { label: '待入仓', value: 'AWAITING_WAREHOUSE' },
    { label: '待付款', value: 'AWAITING_PAYMENT' },
  ])
  assert.equal(normalizePurchaseOrderStatusSelection('all', 'COMPLETED'), 'COMPLETED')
  assert.equal(normalizePurchaseOrderStatusSelection('all', 'UNKNOWN'), 'ALL')
  assert.equal(
    normalizePurchaseOrderStatusSelection('pending', 'AWAITING_WAREHOUSE'),
    'AWAITING_WAREHOUSE',
  )
  assert.equal(
    normalizePurchaseOrderStatusSelection('pending', undefined),
    'AWAITING_SHIPMENT',
  )
})

test('待办采购操作严格只返回当前任务对应的唯一处理动作', () => {
  assert.deepEqual(resolvePurchaseOrderPendingActions('AWAITING_SHIPMENT', {
    paymentStatus: 'UNPAID',
  }).map(item => item.label), ['发货'])
  assert.deepEqual(resolvePurchaseOrderPendingActions('AWAITING_SHIPMENT', {
    paymentStatus: 'PAID',
  }).map(item => item.label), ['发货'])
  assert.deepEqual(resolvePurchaseOrderPendingActions('AWAITING_WAREHOUSE', {
    paymentStatus: 'PARTIALLY_PAID',
  }).map(item => item.label), ['到仓'])
  assert.deepEqual(resolvePurchaseOrderPendingActions('AWAITING_PAYMENT', {
    paymentStatus: 'PARTIALLY_PAID',
  }).map(item => item.label), ['付款'])
  assert.deepEqual(resolvePurchaseOrderPendingActions('AWAITING_PAYMENT', {
    paymentStatus: 'PAID',
  }), [])
})

test('全部采购仅允许已确认订单从操作列进入取消流程', () => {
  assert.equal(canCancelPurchaseOrderFromList({ orderStatus: 'CONFIRMED' }), true)
  assert.equal(canCancelPurchaseOrderFromList({ orderStatus: 'COMPLETED' }), false)
  assert.equal(canCancelPurchaseOrderFromList({ orderStatus: 'CANCELLED' }), false)
})

test('采购发货成功提示完全依据服务端结果区分安全重试和销售联动', () => {
  const base: FactoryShipmentResultDto = {
    purchaseOrders: [{
      id: 'purchase-1',
      orderNo: 'PO/20260904-00001',
      fulfillmentStatus: 'SHIPPED',
      changed: true,
    }],
    changedPurchaseOrderCount: 1,
    alreadySatisfiedCount: 0,
    remainingPendingShipmentCount: 0,
    salesOrder: null,
  }

  assert.equal(formatPurchaseFactoryShipmentSuccess(base), '采购订单已发货')
  assert.equal(formatPurchaseFactoryShipmentSuccess({
    ...base,
    changedPurchaseOrderCount: 0,
    alreadySatisfiedCount: 1,
    purchaseOrders: [{ ...base.purchaseOrders[0]!, changed: false }],
  }), '采购订单已处于已发货状态，未重复处理')
  assert.equal(formatPurchaseFactoryShipmentSuccess({
    ...base,
    remainingPendingShipmentCount: 2,
    salesOrder: {
      id: 'sales-1',
      orderNo: 'SO/20260904-00001',
      fulfillmentStatus: 'PREPARING',
      advancedToLandTransit: false,
    },
  }), '采购订单已发货，关联销售订单仍有 2 张采购单待发货')
  assert.equal(formatPurchaseFactoryShipmentSuccess({
    ...base,
    salesOrder: {
      id: 'sales-1',
      orderNo: 'SO/20260904-00001',
      fulfillmentStatus: 'LAND_TRANSIT',
      advancedToLandTransit: true,
    },
  }), '采购订单已发货，关联销售订单已进入陆运中')
})
