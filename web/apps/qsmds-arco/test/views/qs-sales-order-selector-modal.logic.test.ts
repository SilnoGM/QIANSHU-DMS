import type { SalesOrderSelectorItem } from '../../src/components/business/QsSalesOrderSelectorModal/types'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import {
  filterEligibleSalesOrders,
  formatSalesOrderAmount,
  formatSalesOrderLineCount,
  formatSalesOrderQuantity,
  getSalesOrderFulfillmentStatusMeta,
  getSalesOrderPaymentStatusMeta,
  normalizeSalesOrderSelectorKeyword,
  resolveSalesOrderSelection,
  resolveSelectorPagination,
} from '../../src/components/business/QsSalesOrderSelectorModal/logic'

function order(
  id: string,
  orderStatus: SalesOrderSelectorItem['orderStatus'] = 'CONFIRMED',
): SalesOrderSelectorItem {
  return {
    id,
    orderNo: `SO-${id}`,
    orderDate: '2026-08-30',
    issuer: {
      id: `issuer-${id}`,
      displayName: '余树',
    },
    currencyCode: 'TWD',
    customerName: `客户 ${id}`,
    agreedTotalAmount: '120000.0000',
    orderStatus,
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    lineSummary: {
      lineCount: 2,
      totalQuantity: 3,
    },
  }
}

test('选择器只保留已确认销售订单并拒绝解析非候选订单', () => {
  const items = [
    order('confirmed'),
    order('draft', 'DRAFT'),
    order('reconciliation', 'PENDING_RECONCILIATION'),
    order('completed', 'COMPLETED'),
    order('cancelled', 'CANCELLED'),
  ]

  assert.deepEqual(
    filterEligibleSalesOrders(items).map(item => item.id),
    ['confirmed'],
  )
  assert.equal(resolveSalesOrderSelection(items, 'confirmed')?.id, 'confirmed')
  assert.equal(resolveSalesOrderSelection(items, 'cancelled'), null)
  assert.equal(resolveSalesOrderSelection(items, null), null)
})

test('搜索词使用 NFKC 归一化并清理首尾空白', () => {
  assert.equal(normalizeSalesOrderSelectorKeyword('  ＳＯ／０００１  '), 'SO/0001')
  assert.equal(normalizeSalesOrderSelectorKeyword('   '), '')
})

test('分页对异常输入进行约束并生成稳定区间', () => {
  assert.deepEqual(resolveSelectorPagination({
    page: 9,
    pageSize: 20,
    total: 108,
  }), {
    page: 6,
    pageCount: 6,
    pageSize: 20,
    rangeEnd: 108,
    rangeStart: 101,
    total: 108,
  })
  assert.deepEqual(resolveSelectorPagination({
    page: -2,
    pageSize: 0,
    total: -1,
  }), {
    page: 1,
    pageCount: 1,
    pageSize: 20,
    rangeEnd: 0,
    rangeStart: 0,
    total: 0,
  })
})

test('产品汇总和销售状态使用稳定中文语义', () => {
  assert.equal(formatSalesOrderAmount('180000.0000', 'TWD'), 'NT$180,000.00')
  assert.equal(formatSalesOrderAmount('86500.5000', 'MYR'), 'RM86,500.50')
  assert.equal(formatSalesOrderLineCount(2), '2 项产品')
  assert.equal(formatSalesOrderQuantity(3), '共 3 件')
  assert.equal(getSalesOrderFulfillmentStatusMeta('PENDING').label, '待采购')
  assert.equal(getSalesOrderFulfillmentStatusMeta('SIGNED').label, '已签收')
  assert.equal(getSalesOrderPaymentStatusMeta('UNPAID').label, '未付款')
  assert.equal(getSalesOrderPaymentStatusMeta('PAID').label, '已付清')
})
