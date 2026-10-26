import type {
  PurchaseOrderDetailDto,
  PurchaseOrderListItemDto,
} from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 采购取消资格与通知模板使用 Node.js 内置 runner。
import test from 'node:test'
import { createI18n } from 'vue-i18n'
import messages from '../../src/locales/lang/purchase-review/zh-cn.json'
import {
  buildPurchaseCancellationText,
  buildPurchaseOrderCancelRequest,
  getPurchaseOrderCancelBlockedReason,
  purchaseOrderCancelBlockedMessage,
} from '../../src/views/operations/purchase-orders/purchase-order-cancel.logic'

const i18n = createI18n({ legacy: false, locale: 'zh-cn', messages: { 'zh-cn': messages } })
const t = (key: string, values: Record<string, string | number> = {}) => i18n.global.t(key, values)

type CancelSource = Pick<
  PurchaseOrderListItemDto,
  'orderStatus' | 'fulfillmentStatus' | 'paidAmount'
>

function source(patch: Partial<CancelSource> = {}): CancelSource {
  return {
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paidAmount: '0.00',
    ...patch,
  }
}

const operationsPolicy = { allowPendingReview: true } as const
const reviewPolicy = { allowPendingReview: false } as const

test('运营取消允许审核中或已确认，但必须未发货且无有效付款', () => {
  assert.equal(getPurchaseOrderCancelBlockedReason(
    source({ orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED' }),
    operationsPolicy,
  ), null)
  assert.equal(getPurchaseOrderCancelBlockedReason(
    source({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'ORDERED' }),
    operationsPolicy,
  ), null)
  assert.equal(getPurchaseOrderCancelBlockedReason(
    source({ orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING' }),
    operationsPolicy,
  ), null)
  for (const fulfillmentStatus of ['PARTIALLY_SHIPPED', 'SHIPPED', 'SIGNED'] as const) {
    assert.equal(getPurchaseOrderCancelBlockedReason(
      source({ fulfillmentStatus }),
      operationsPolicy,
    ), 'shipped')
  }
  for (const orderStatus of ['COMPLETED', 'CANCELLED'] as const) {
    assert.equal(getPurchaseOrderCancelBlockedReason(
      source({ orderStatus }),
      operationsPolicy,
    ), 'status')
  }
  assert.equal(getPurchaseOrderCancelBlockedReason(
    source({ paidAmount: '0.01' }),
    operationsPolicy,
  ), 'paid')
  assert.equal(getPurchaseOrderCancelBlockedReason(
    source({ paidAmount: 'invalid' }),
    operationsPolicy,
  ), 'amount')
})

test('审核工作台保持只允许已确认订单', () => {
  assert.equal(getPurchaseOrderCancelBlockedReason(
    source({ orderStatus: 'PENDING_REVIEW', fulfillmentStatus: 'ORDERED' }),
    reviewPolicy,
  ), 'status')
  assert.equal(getPurchaseOrderCancelBlockedReason(source(), reviewPolicy), null)
})

test('运营按钮与弹窗共用可读的阻塞原因文案', () => {
  assert.equal(purchaseOrderCancelBlockedMessage('status'), '只有审核中或已确认的采购单可以取消')
  assert.equal(purchaseOrderCancelBlockedMessage('shipped'), '采购单已有货件发出，不能整单取消')
  assert.equal(purchaseOrderCancelBlockedMessage('paid'), '采购单已有有效付款，请先作废付款后再取消')
  assert.equal(purchaseOrderCancelBlockedMessage('amount'), '付款金额不可用，请刷新后重试')
})

test('取消原因必填并在规范化后按 Unicode code point 限制 500 字', () => {
  assert.deepEqual(buildPurchaseOrderCancelRequest('   '), {
    valid: false,
    fieldError: '请填写取消原因',
  })
  assert.deepEqual(buildPurchaseOrderCancelRequest('  客户取消 '), {
    valid: true,
    request: { toStatus: 'CANCELLED', reason: '客户取消' },
  })
  assert.equal(buildPurchaseOrderCancelRequest('x'.repeat(500)).valid, true)
  assert.deepEqual(buildPurchaseOrderCancelRequest('x'.repeat(501)), {
    valid: false,
    fieldError: '取消原因最多 500 个字符',
  })
})

function cancellationDetail(): PurchaseOrderDetailDto {
  return {
    id: 'order-1',
    orderNo: 'PO/20260918-00018',
    orderDate: '2026-09-18',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paidAmount: '0.00',
    supplier: { label: '测试供应商' },
    amounts: { purchaseTotalAmount: '15000.0000', paidAmount: '0.0000', outstandingAmount: '15000.0000' },
    lines: [{ lineNumber: 2, productName: '椅子' }, { lineNumber: 1, productName: '桌子' }],
  } as PurchaseOrderDetailDto
}

test('运营取消通知沿用工作台模板，按采购行排序且金额保留两位', () => {
  const detail = cancellationDetail()
  const original = JSON.stringify(detail)
  assert.equal(buildPurchaseCancellationText(detail, t), `【订单取消：PO/20260918-00018】
供应商：测试供应商
采购日期：2026-09-18

[采购产品明细]
产品名：桌子+椅子

总价：15000.00
已支付：0.00
未支付：15000.00`)
  assert.equal(JSON.stringify(detail), original)
})
