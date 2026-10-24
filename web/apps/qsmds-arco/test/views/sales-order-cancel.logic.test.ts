import type { SalesOrderCancelEligibility } from '../../src/views/operations/sales-orders/sales-order-cancel.logic'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Web 业务逻辑测试使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildSalesOrderCancelRequest,
  isSalesOrderCancellable,
} from '../../src/views/operations/sales-orders/sales-order-cancel.logic'

function eligibility(
  overrides: Partial<SalesOrderCancelEligibility> = {},
): SalesOrderCancelEligibility {
  return {
    viewMode: 'all',
    canUpdate: true,
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PENDING',
    paymentStatus: 'UNPAID',
    activePurchaseOrderCount: 0,
    ...overrides,
  }
}

test('全部订单中未签收、未收款且无未取消采购单的已确认订单可取消', () => {
  assert.equal(isSalesOrderCancellable(eligibility()), true)
  assert.equal(isSalesOrderCancellable(eligibility({ fulfillmentStatus: 'SEA_TRANSIT' })), true)
})

test('待办订单、无权限或非已确认状态不提供取消入口', () => {
  assert.equal(isSalesOrderCancellable(eligibility({ viewMode: 'pending' })), false)
  assert.equal(isSalesOrderCancellable(eligibility({ canUpdate: false })), false)
  for (const orderStatus of ['DRAFT', 'PENDING_RECONCILIATION', 'COMPLETED', 'CANCELLED'] as const) {
    assert.equal(isSalesOrderCancellable(eligibility({ orderStatus })), false)
  }
})

test('已签收、已有收款或存在未取消采购单的订单不提供取消入口', () => {
  assert.equal(isSalesOrderCancellable(eligibility({ fulfillmentStatus: 'SIGNED' })), false)
  assert.equal(isSalesOrderCancellable(eligibility({ paymentStatus: 'PARTIALLY_PAID' })), false)
  assert.equal(isSalesOrderCancellable(eligibility({ paymentStatus: 'PAID' })), false)
  assert.equal(isSalesOrderCancellable(eligibility({ activePurchaseOrderCount: 1 })), false)
})

test('取消原因必填并在规范化后按 Unicode code point 限制 500 字', () => {
  assert.deepEqual(buildSalesOrderCancelRequest('   '), {
    valid: false,
    fieldError: '请填写取消原因',
  })
  assert.deepEqual(buildSalesOrderCancelRequest('  客户取消  '), {
    valid: true,
    request: { toStatus: 'CANCELLED', reason: '客户取消' },
  })
  assert.equal(buildSalesOrderCancelRequest('取'.repeat(500)).valid, true)
  assert.deepEqual(buildSalesOrderCancelRequest('取'.repeat(501)), {
    valid: false,
    fieldError: '取消原因最多 500 个字符',
  })
  // 全角字符在 NFKC 规范化后按半角计算长度。
  assert.equal(buildSalesOrderCancelRequest('Ａ'.repeat(500)).valid, true)
})
