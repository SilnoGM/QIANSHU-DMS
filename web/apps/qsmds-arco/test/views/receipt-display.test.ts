import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 收款快照展示不得通过浮点转换丢失有效数字。
import test from 'node:test'
import { formatReceiptDecimal, paymentMethodClass, receiptAmountClass } from '../../src/views/workbenches/sales-receipts/receipt-display'

test('汇率及比例展示仅移除小数末零，极大值和极小值的有效数字不丢失', () => {
  assert.equal(formatReceiptDecimal('999999999999999999999999.1234000000'), '999999999999999999999999.1234')
  assert.equal(formatReceiptDecimal('0.00000000000000000000000100'), '0.000000000000000000000001')
  assert.equal(formatReceiptDecimal('4.8000000000'), '4.8')
  assert.equal(formatReceiptDecimal('10000'), '10000')
  assert.equal(formatReceiptDecimal('30.0000'), '30')
  assert.equal(formatReceiptDecimal('0.0000'), '0')
  assert.equal(formatReceiptDecimal(null), '—')
})

test('四种收款方式使用独立稳定配色，未知历史方式使用中性回退', () => {
  const known = ['BANK_TRANSFER', 'CASH', 'CHECK', 'LETTER_OF_CREDIT'].map(paymentMethodClass)
  assert.equal(new Set(known).size, 4)
  assert.ok(known.every(value => value.includes('dark:')))
  assert.equal(paymentMethodClass('UNRECOGNIZED'), paymentMethodClass('RETIRED_VALUE'))
  assert.ok(!known.includes(paymentMethodClass('UNRECOGNIZED')))
})

test('金额颜色按正负数区分，零和负零保持正常颜色', () => {
  assert.equal(receiptAmountClass('0.0000'), 'text-foreground')
  assert.equal(receiptAmountClass('-0.00'), 'text-foreground')
  assert.equal(receiptAmountClass('19.23'), 'text-primary')
  assert.equal(receiptAmountClass('-19.23'), 'text-destructive')
  assert.equal(receiptAmountClass(`0.${'0'.repeat(350)}1`), 'text-primary')
})
