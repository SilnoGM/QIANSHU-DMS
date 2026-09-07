import type { PurchaseOrderDetailDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 采购详情动作纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildPurchaseOrderCancellationRequest,
  buildPurchaseOrderFulfillmentRequest,
  buildPurchaseOrderPaymentRequest,
  buildPurchaseOrderPaymentVoidRequest,
  buildPurchaseOrderReviewRequest,
  formatPurchaseOrderLocalDateTime,
  purchaseOrderPaymentTypeLabel,
  purchaseOrderStatusHistoryValueLabel,
} from '../../src/views/operations/purchase-orders/purchase-order-detail.logic'

function createDetail(
  patch: Partial<PurchaseOrderDetailDto> = {},
): PurchaseOrderDetailDto {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    orderNo: 'PO-20260828-0001',
    purchaseType: 'SALES_LINKED',
    salesOrderNo: 'SO-20260828-0001',
    customerName: '测试客户',
    supplier: { effectiveEnabled: true, label: '测试供应商', tone: 'blue', value: 'SUPPLIER_01' },
    orderDate: '2026-08-28',
    currencyCode: 'CNY',
    purchaseTotalAmount: '100.0000',
    depositDueAmount: '20.0000',
    balanceDueAmount: '80.0000',
    paidAmount: '20.0000',
    outstandingAmount: '80.0000',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'ORDERED',
    paymentStatus: 'PARTIALLY_PAID',
    remark: null,
    version: 1,
    createdAt: '2026-08-28T01:00:00.000Z',
    updatedAt: '2026-08-28T01:00:00.000Z',
    sourceSalesOrder: {
      id: '22222222-2222-4222-8222-222222222222',
      orderNo: 'SO-20260828-0001',
      customerName: '测试客户',
    },
    shippingMarkText: null,
    shippingMarks: [],
    amounts: {
      lineSubtotalAmount: '100.0000',
      purchaseTotalAmount: '100.0000',
      depositDueAmount: '20.0000',
      balanceDueAmount: '80.0000',
      paidAmount: '20.0000',
      outstandingAmount: '80.0000',
    },
    createdBy: { id: '33333333-3333-4333-8333-333333333333', displayName: '采购员' },
    lines: [],
    parts: [],
    payments: [],
    documents: [],
    statusHistory: [],
    ...patch,
  }
}

test('付款草稿规范化本地时间、两位金额、字典值和可选凭证', () => {
  const result = buildPurchaseOrderPaymentRequest({
    amount: '12.5',
    mediaAssetId: '44444444-4444-4444-8444-444444444444',
    now: new Date('2026-08-28T12:00:00.000Z'),
    outstandingAmount: '80.0000',
    paidAtLocal: '2026-08-28T18:30',
    paymentMethod: 'BANK_TRANSFER',
    paymentType: 'DEPOSIT',
    remark: '  供应商定金 ',
  })

  assert.equal(result.valid, true)
  if (!result.valid) {
    return
  }
  assert.deepEqual(result.request, {
    amount: '12.50',
    paidAt: new Date('2026-08-28T18:30').toISOString(),
    paymentMethod: 'BANK_TRANSFER',
    paymentType: 'DEPOSIT',
    remark: '供应商定金',
    voucher: { mediaAssetId: '44444444-4444-4444-8444-444444444444' },
  })
})

test('付款硬拦截零金额、超额、未来时间和缺失付款方式', () => {
  const result = buildPurchaseOrderPaymentRequest({
    amount: '81.00',
    mediaAssetId: null,
    now: new Date('2026-08-28T12:00:00.000Z'),
    outstandingAmount: '80.0000',
    paidAtLocal: '2026-08-29T18:30',
    paymentMethod: '',
    paymentType: 'OTHER',
    remark: '',
  })

  assert.equal(result.valid, false)
  if (result.valid) {
    return
  }
  assert.equal(result.fieldErrors.amount, '付款金额不能超过未付金额 80.0000')
  assert.equal(result.fieldErrors.paidAt, '付款时间不能为空且不能晚于当前时间')
  assert.equal(result.fieldErrors.paymentMethod, '请选择付款方式')
})

test('履约只能顺序推进，取消必须先作废有效付款', () => {
  assert.deepEqual(buildPurchaseOrderFulfillmentRequest(
    createDetail(),
    'PREPARING',
    '供应商已确认',
  ), {
    valid: true,
    request: { reason: '供应商已确认', toStatus: 'PREPARING' },
  })
  assert.equal(buildPurchaseOrderFulfillmentRequest(
    createDetail(),
    'SHIPPED',
    '',
  ).valid, false)

  assert.deepEqual(buildPurchaseOrderCancellationRequest(createDetail(), ''), {
    fieldError: '存在有效付款，请先作废全部付款记录',
    valid: false,
  })
  assert.deepEqual(buildPurchaseOrderCancellationRequest(createDetail({
    paidAmount: '0.0000',
    paymentStatus: 'UNPAID',
  }), '  客户取消 '), {
    valid: true,
    request: { reason: '客户取消', toStatus: 'CANCELLED' },
  })
})

test('付款作废强制填写原因并固定采购状态中文语义', () => {
  assert.deepEqual(buildPurchaseOrderPaymentVoidRequest('  重复录入 '), {
    valid: true,
    request: { reason: '重复录入' },
  })
  assert.equal(buildPurchaseOrderPaymentVoidRequest('  ').valid, false)
  assert.equal(purchaseOrderPaymentTypeLabel('BALANCE'), '尾款')
  assert.equal(purchaseOrderStatusHistoryValueLabel('ORDERED'), '已下单')
  assert.equal(purchaseOrderStatusHistoryValueLabel('COMPLETED'), '已完成')
  assert.equal(purchaseOrderStatusHistoryValueLabel('UNKNOWN'), 'UNKNOWN')
})

test('本地付款时间格式供 datetime-local 稳定回显', () => {
  assert.equal(
    formatPurchaseOrderLocalDateTime(new Date(2026, 7, 28, 9, 7)),
    '2026-08-28T09:07',
  )
})

test('审核提交绑定最新版本，限定审核中状态并规范化审核说明', () => {
  const detail = createDetail({ orderStatus: 'PENDING_REVIEW', paidAmount: '0.0000', version: 7 })
  assert.deepEqual(buildPurchaseOrderReviewRequest(detail, '  已核对  '), {
    valid: true,
    request: { expectedVersion: 7, reason: '已核对' },
  })
  assert.deepEqual(buildPurchaseOrderReviewRequest(detail, ''), {
    valid: true,
    request: { expectedVersion: 7 },
  })
  assert.equal(buildPurchaseOrderReviewRequest(createDetail(), '').valid, false)
  assert.equal(buildPurchaseOrderReviewRequest(detail, 'x'.repeat(501)).valid, false)
  assert.equal(buildPurchaseOrderReviewRequest({ ...detail, version: 0 }, '').valid, false)
  assert.equal(buildPurchaseOrderCancellationRequest(detail, '').valid, true)
  assert.equal(purchaseOrderStatusHistoryValueLabel('PENDING_REVIEW'), '采购审核中')
})
