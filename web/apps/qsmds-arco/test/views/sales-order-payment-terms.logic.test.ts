import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 收款约定逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildSalesOrderPaymentTermsRequest,
  salesOrderPaymentTermsBalance,
  salesOrderPaymentTermsDraftChanged,
} from '../../src/views/operations/sales-orders/sales-order-payment-terms.logic'

test('按定金重算尾款并提交三项自洽金额', () => {
  const built = buildSalesOrderPaymentTermsRequest({
    agreedTotalAmount: '1000.00',
    currentDepositDueAmount: '300.00',
    draft: { depositDueAmount: '250', reason: '  客户协商下调定金 ' },
  })
  assert.equal(built.valid, true)
  if (!built.valid) {
    return
  }
  assert.deepEqual(built.request, {
    agreedTotalAmount: '1000.00',
    depositDueAmount: '250.00',
    balanceDueAmount: '750.00',
    reason: '客户协商下调定金',
  })
})

test('定金不能超过约定总价，且金额必须合法', () => {
  const overAgreed = buildSalesOrderPaymentTermsRequest({
    agreedTotalAmount: '1000.00',
    currentDepositDueAmount: '300.00',
    draft: { depositDueAmount: '1000.01', reason: '上调定金' },
  })
  assert.equal(overAgreed.valid, false)
  if (!overAgreed.valid) {
    assert.ok(overAgreed.fieldErrors.depositDueAmount)
  }

  const invalidAmount = buildSalesOrderPaymentTermsRequest({
    agreedTotalAmount: '1000.00',
    currentDepositDueAmount: '300.00',
    draft: { depositDueAmount: '1.234', reason: '上调定金' },
  })
  assert.equal(invalidAmount.valid, false)
  if (!invalidAmount.valid) {
    assert.ok(invalidAmount.fieldErrors.depositDueAmount)
  }

  const empty = buildSalesOrderPaymentTermsRequest({
    agreedTotalAmount: '1000.00',
    currentDepositDueAmount: '300.00',
    draft: { depositDueAmount: null, reason: '上调定金' },
  })
  assert.equal(empty.valid, false)
  if (!empty.valid) {
    assert.equal(empty.fieldErrors.depositDueAmount, '请填写约定定金')
  }
})

test('修改原因必填', () => {
  const built = buildSalesOrderPaymentTermsRequest({
    agreedTotalAmount: '1000.00',
    currentDepositDueAmount: '300.00',
    draft: { depositDueAmount: '400.00', reason: '   ' },
  })
  assert.equal(built.valid, false)
  if (!built.valid) {
    assert.equal(built.fieldErrors.reason, '请填写本次修改原因')
  }
})

test('尾款回显按总价减定金计算，输入不合法时为空', () => {
  assert.equal(salesOrderPaymentTermsBalance('1000.00', '300'), '700.00')
  assert.equal(salesOrderPaymentTermsBalance('1000.00', null), null)
  assert.equal(salesOrderPaymentTermsBalance('1000.00', '1000.01'), null)
  assert.equal(salesOrderPaymentTermsBalance('1000.00', 'abc'), null)
})

test('变更检测只比较定金金额', () => {
  assert.equal(
    salesOrderPaymentTermsDraftChanged('300.00', { depositDueAmount: '300', reason: '只写原因' }),
    false,
  )
  assert.equal(
    salesOrderPaymentTermsDraftChanged('300.00', { depositDueAmount: '301.00', reason: '' }),
    true,
  )
  assert.equal(
    salesOrderPaymentTermsDraftChanged('300.00', { depositDueAmount: null, reason: '' }),
    false,
  )
})
