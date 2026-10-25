import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售订单收款弹窗纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildSalesOrderDeliveryReceiptRequest,
  buildSalesOrderPaymentRequest,
  countPendingReceiptRequests,
  countTotalReceiptRequests,
  countValidSalesOrderPayments,
  formatSalesOrderLocalDateTime,
  resolveSalesOrderModalCancelAction,
  resolveSalesOrderModalInitialState,
  splitSalesOrderPaymentStatusReason,
  toSalesOrderPaymentReceivedAt,
} from '../../src/views/operations/sales-orders/sales-order-records-modal.logic'

const VOUCHER_ID = '11111111-1111-4111-8111-111111111111'

test('实际收款请求包含五类收款、精确金额与唯一凭证且不包含交易流水号', () => {
  const now = new Date(2026, 7, 25, 14, 30, 0)
  const receivedAt = formatSalesOrderLocalDateTime(new Date(2026, 7, 25, 13, 20, 0))
  const result = buildSalesOrderPaymentRequest({
    amount: '100.5',
    paymentMethod: ' BANK_TRANSFER ',
    paymentType: 'INVOICE_TAX',
    receivedAt,
    remark: ' 含税总价内开票税金 ',
    voucherMediaAssetId: VOUCHER_ID,
  }, 2, now)

  assert.equal(result.valid, true)
  if (result.valid) {
    assert.deepEqual(result.request, {
      amount: '100.50',
      paymentMethod: 'BANK_TRANSFER',
      paymentType: 'INVOICE_TAX',
      receivedAt: new Date(2026, 7, 25, 13, 20, 0).toISOString(),
      remark: '含税总价内开票税金',
      voucher: { mediaAssetId: VOUCHER_ID },
    })
    assert.equal('referenceNo' in result.request, false)
  }
})

test('实际收款硬拦截零金额、未来时间和缺失凭证', () => {
  const now = new Date(2026, 7, 25, 14, 30, 0)
  const result = buildSalesOrderPaymentRequest({
    amount: '0',
    paymentMethod: '',
    paymentType: 'DEPOSIT',
    receivedAt: formatSalesOrderLocalDateTime(new Date(2026, 7, 25, 14, 31, 0)),
    remark: '',
    voucherMediaAssetId: null,
  }, 2, now)

  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.equal(result.fieldErrors.amount, '金额不能小于 0.01')
    assert.equal(result.fieldErrors.paymentMethod, '请选择收款方式')
    assert.equal(result.fieldErrors.receivedAt, '请选择不晚于当前时间的有效收款时间')
    assert.equal(result.fieldErrors.voucher, '每笔收款必须上传且只能上传一份凭证')
  }
  assert.equal(toSalesOrderPaymentReceivedAt('', now), null)
})

test('销售订单操作先确定唯一弹窗视图，并按来源决定取消行为', () => {
  assert.deepEqual(resolveSalesOrderModalInitialState(null), {
    origin: 'records',
    view: 'records',
  })
  assert.deepEqual(resolveSalesOrderModalInitialState('payment'), {
    origin: 'table-action',
    view: 'create-payment',
  })
  assert.deepEqual(resolveSalesOrderModalInitialState('receipt'), {
    origin: 'table-action',
    view: 'create-receipt',
  })
  assert.equal(resolveSalesOrderModalCancelAction({
    origin: 'records',
    view: 'create-payment',
  }), 'records')
  assert.equal(resolveSalesOrderModalCancelAction({
    origin: 'table-action',
    view: 'create-receipt',
  }), 'close')
})

test('收款页签按有效实际收款与待审申请统计', () => {
  assert.equal(countValidSalesOrderPayments([
    { voidedAt: null },
    { voidedAt: '2026-10-22T10:00:00.000Z' },
  ]), 1)
  assert.equal(countValidSalesOrderPayments([]), 0)

  const counts = { PENDING_REVIEW: 1, APPROVED: 2, REJECTED: 1, VOIDED: 1 }
  assert.equal(countPendingReceiptRequests(counts), 1)
  assert.equal(countTotalReceiptRequests(counts), 5)
})

test('货物签收请求接收一个有效签收单媒体 ID 与选填备注', () => {
  assert.deepEqual(buildSalesOrderDeliveryReceiptRequest(VOUCHER_ID, '  外箱完好  '), {
    valid: true,
    request: { mediaAssetId: VOUCHER_ID, remark: '外箱完好' },
  })
  assert.deepEqual(buildSalesOrderDeliveryReceiptRequest(VOUCHER_ID, ''), {
    valid: true,
    request: { mediaAssetId: VOUCHER_ID, remark: null },
  })
  assert.deepEqual(buildSalesOrderDeliveryReceiptRequest(null, ''), {
    valid: false,
    fieldErrors: { receipt: '货物签收必须上传且只能上传一份签收单' },
  })
  assert.deepEqual(buildSalesOrderDeliveryReceiptRequest(VOUCHER_ID, '签'.repeat(501)), {
    valid: false,
    fieldErrors: { remark: '备注最多 500 个字符' },
  })
})

test('付款状态原因将本次收款和剩余未收金额拆分为独立语义片段', () => {
  assert.deepEqual(
    splitSalesOrderPaymentStatusReason(
      '用户添加实际收款 RM1,000.00 MYR，剩余 RM74,000.00 MYR 未收',
    ),
    [
      { text: '用户添加实际收款 ', tone: 'default' },
      { text: 'RM1,000.00 MYR', tone: 'received' },
      { text: '，剩余 ', tone: 'default' },
      { text: 'RM74,000.00 MYR', tone: 'outstanding' },
      { text: ' 未收', tone: 'default' },
    ],
  )
  assert.deepEqual(
    splitSalesOrderPaymentStatusReason(
      '用户添加实际收款 NT$100.00 TWD，剩余 NT$0.00 TWD，订单已付清',
    ),
    [
      { text: '用户添加实际收款 ', tone: 'default' },
      { text: 'NT$100.00 TWD', tone: 'received' },
      { text: '，剩余 ', tone: 'default' },
      { text: 'NT$0.00 TWD', tone: 'outstanding' },
      { text: '，订单已付清', tone: 'default' },
    ],
  )
})

test('非系统付款原因保持完整普通文本', () => {
  assert.deepEqual(splitSalesOrderPaymentStatusReason('客户要求调整状态'), [
    { text: '客户要求调整状态', tone: 'default' },
  ])
})
