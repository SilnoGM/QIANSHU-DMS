import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售订单视图状态契约使用 Node.js 内置 runner。
import test from 'node:test'

import {
  getSalesOrderStatusItems,
  mergeSalesOrderCurrencySummaries,
  normalizeSalesOrderStatusSelection,
  resolveSalesOrderQueryTargets,
} from '../../src/views/operations/sales-orders/sales-order-list-view.logic'

test('待办视图仅包含四个可操作履约阶段，不混入海运中与已签收', () => {
  assert.deepEqual(
    getSalesOrderStatusItems('pending').map(item => [item.value, item.label]),
    [
      ['ALL', '全部待办'],
      ['PENDING', '待采购'],
      ['PREPARING', '待发货'],
      ['LAND_TRANSIT', '待入仓'],
      ['WAREHOUSE_ARRIVED', '待装柜'],
    ],
  )
  assert.deepEqual(resolveSalesOrderQueryTargets('pending', 'ALL'), [
    { orderStatus: 'CONFIRMED', fulfillmentStatus: 'PENDING' },
    { orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING' },
    { orderStatus: 'CONFIRMED', fulfillmentStatus: 'LAND_TRANSIT' },
    { orderStatus: 'CONFIRMED', fulfillmentStatus: 'WAREHOUSE_ARRIVED' },
  ])
  assert.deepEqual(resolveSalesOrderQueryTargets('pending', 'PREPARING'), [
    { orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING' },
  ])
})

test('全部订单视图排除草稿，并为尚未进入接口契约的状态保留入口', () => {
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
    { orderStatus: 'CANCELLED' },
  ])
  assert.deepEqual(resolveSalesOrderQueryTargets('all', 'PENDING_RECONCILIATION'), [])
  assert.deepEqual(resolveSalesOrderQueryTargets('all', 'COMPLETED'), [])
})

test('URL 中非法或跨视图状态回退到当前视图的全部状态', () => {
  assert.equal(normalizeSalesOrderStatusSelection('pending', 'PREPARING'), 'PREPARING')
  assert.equal(normalizeSalesOrderStatusSelection('pending', 'CANCELLED'), 'ALL')
  assert.equal(normalizeSalesOrderStatusSelection('all', ['CONFIRMED']), 'ALL')
  assert.equal(normalizeSalesOrderStatusSelection('all', undefined), 'ALL')
})

test('多状态查询的币种汇总使用精确四位小数相加', () => {
  const merged = mergeSalesOrderCurrencySummaries([
    [{
      agreedTotalAmount: '100.1000',
      balanceDueAmount: '60.0600',
      currencyCode: 'TWD',
      depositDueAmount: '40.0400',
      orderCount: 1,
      outstandingAmount: '70.0700',
      receivedAmount: '30.0300',
      standardSubtotalAmount: '120.1200',
    }],
    [{
      agreedTotalAmount: '0.2000',
      balanceDueAmount: '0.1200',
      currencyCode: 'TWD',
      depositDueAmount: '0.0800',
      orderCount: 2,
      outstandingAmount: '0.1400',
      receivedAmount: '0.0600',
      standardSubtotalAmount: '0.2400',
    }],
  ])

  assert.deepEqual(merged, [{
    agreedTotalAmount: '100.3000',
    balanceDueAmount: '60.1800',
    currencyCode: 'TWD',
    depositDueAmount: '40.1200',
    orderCount: 3,
    outstandingAmount: '70.2100',
    receivedAmount: '30.0900',
    standardSubtotalAmount: '120.3600',
  }])
})
