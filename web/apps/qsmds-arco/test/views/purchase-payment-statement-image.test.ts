import type { PurchasePayableOrderDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 对账单金额及边界测试无需 DOM 或真实资金写入。
import test from 'node:test'
import { buildPurchasePaymentStatement, PurchasePaymentStatementError } from '../../src/views/workbenches/purchase-payments/purchase-payment-statement-image'

function order(id = 'a'): PurchasePayableOrderDto {
  return {
    id,
    orderNo: `PO/${id}`,
    orderDate: '2026-09-17',
    supplierName: '供应商',
    salesOrderNo: null,
    purchaseType: 'STOCK',
    currencyCode: 'CNY',
    accountOwnerType: 'COMPANY',
    owner: null,
    purchaseTotalAmount: '10.30',
    paymentRecipientProfile: null,
    shippingMarks: [],
    shippingMarkSuffix: '',
    shippingMarkCount: 0,
    items: [
      { id: `${id}-balance`, paymentType: 'BALANCE', dueAmount: '7.20', paidAmount: '0.10', remainingAmount: '7.10', status: 'PENDING_PAYMENT', version: 1, paidAt: null, paidBy: null, paymentReceipt: null },
      { id: `${id}-deposit`, paymentType: 'DEPOSIT', dueAmount: '3.10', paidAmount: '3.10', remainingAmount: '0.00', status: 'PAID', version: 2, paidAt: null, paidBy: null, paymentReceipt: null },
    ],
  }
}

function invalid(input: PurchasePayableOrderDto[], code = 'INVALID_STATEMENT') {
  assert.throws(() => buildPurchasePaymentStatement(input, '供应商', '2026-09-17 10:00'), (error: unknown) => error instanceof PurchasePaymentStatementError && error.code === code)
}

test('已选采购单按定金尾款完整展示并精确汇总应付、已付、未付', () => {
  const statement = buildPurchasePaymentStatement([order('a'), order('b')], '供应商', '2026-09-17 10:00')
  assert.equal(statement.orderCount, 2)
  assert.deepEqual(statement.totals, { dueAmount: '20.60', paidAmount: '6.40', remainingAmount: '14.20' })
  assert.deepEqual(statement.orders[0].items.map(item => item.paymentType), ['DEPOSIT', 'BALANCE'])
  assert.deepEqual(statement.orders[0].totals, { dueAmount: '10.30', paidAmount: '3.20', remainingAmount: '7.10' })
})

test('大金额连续相加不损失分位，生成结果与输入快照相互独立', () => {
  const source = order()
  source.items[0].dueAmount = '999999999999999999999999.99'
  source.items[0].paidAmount = '0.00'
  source.items[0].remainingAmount = '999999999999999999999999.99'
  source.purchaseTotalAmount = '1000000000000000000000003.09'
  const statement = buildPurchasePaymentStatement([source], '供应商', '2026-09-17')
  assert.equal(statement.totals.dueAmount, '1000000000000000000000003.09')
  source.items[0].remainingAmount = '0.00'
  assert.equal(statement.orders[0].items[1].remainingAmount, '999999999999999999999999.99')
  assert.equal(source.items[0].paymentType, 'BALANCE')
})

test('空选单、重复采购单与重复应付款不生成可误认的对账单', () => {
  invalid([])
  invalid([order(), order()])
  const duplicate = order('b')
  duplicate.items[0].id = 'a-balance'
  invalid([order(), duplicate])
})

test('非法金额、缺失金额、额外精度或负数全部显式失败', () => {
  for (const amount of ['', '1e2', '1,000.00', '0.001', '-1.00', null, 1]) {
    const source = order()
    source.items[0].remainingAmount = amount as string
    invalid([source])
  }
})

test('金额不平、付款状态不符、缺少阶段或取消订单不能继续生成', () => {
  for (const mutate of [
    (source: PurchasePayableOrderDto) => source.items[0].remainingAmount = '7.20',
    (source: PurchasePayableOrderDto) => source.items[0].status = 'PAID',
    (source: PurchasePayableOrderDto) => source.items[0].status = 'CANCELLED',
    (source: PurchasePayableOrderDto) => source.items[0].status = 'NO_PAYMENT',
    (source: PurchasePayableOrderDto) => source.items.pop(),
    (source: PurchasePayableOrderDto) => source.items[0].paymentType = 'DEPOSIT',
    (source: PurchasePayableOrderDto) => source.purchaseTotalAmount = '10.00',
    (source: PurchasePayableOrderDto) => source.currencyCode = 'USD' as 'CNY',
  ]) {
    const source = order()
    mutate(source)
    invalid([source])
  }
})

test('零定金可展示，无待付金额的整单不可加入付款对账单', () => {
  const source = order()
  source.items[1] = { ...source.items[1], dueAmount: '0.00', paidAmount: '0.00', remainingAmount: '0.00', status: 'NO_PAYMENT' }
  source.purchaseTotalAmount = '7.20'
  assert.equal(buildPurchasePaymentStatement([source], '供应商', '2026-09-17').totals.remainingAmount, '7.10')
  source.items[0] = { ...source.items[0], paidAmount: '7.20', remainingAmount: '0.00', status: 'PAID' }
  invalid([source])
})

test('完整保留长供应商和单号，过大选单显式报错而不截断', () => {
  const source = order()
  source.orderNo = 'PO/长单号'.repeat(50)
  const supplier = '供应商名称'.repeat(80)
  const statement = buildPurchasePaymentStatement([source], supplier, '2026-09-17')
  assert.equal(statement.supplierName, supplier)
  assert.equal(statement.orders[0].orderNo, source.orderNo)
  invalid(Array.from({ length: 101 }, (_, index) => order(`${index}`)), 'STATEMENT_TOO_LARGE')
})

test('唛头保留后端成品格式，超出六条裁剪但保留真实件数', () => {
  const source = order()
  source.shippingMarks = Array.from({ length: 8 }, (_, index) => `【QSM-0001/货件-0${index + 1}】李华-赖文寿`)
  source.shippingMarkCount = 8
  const statement = buildPurchasePaymentStatement([source], '供应商', '2026-09-17')
  assert.equal(statement.orders[0].shippingMarks.length, 6)
  assert.equal(statement.orders[0].shippingMarkCount, 8)
  assert.equal(statement.orders[0].shippingMarks[0], '【QSM-0001/货件-01】李华-赖文寿')
  assert.equal(statement.orders[0].shippingMarks[5], '【QSM-0001/货件-06】李华-赖文寿')
})

test('空白唛头直接忽略，但类型、长度和件数异常必须显式失败', () => {
  const source = order()
  source.shippingMarks = ['  ', '【QSM-0001】公司囤货采购']
  source.shippingMarkCount = 1
  assert.deepEqual(buildPurchasePaymentStatement([source], '供应商', '2026-09-17').orders[0].shippingMarks, ['【QSM-0001】公司囤货采购'])
  for (const mutate of [
    (input: PurchasePayableOrderDto) => { input.shippingMarks = 'x' as unknown as string[] },
    (input: PurchasePayableOrderDto) => { input.shippingMarks = [1 as unknown as string] },
    (input: PurchasePayableOrderDto) => { input.shippingMarks = ['x'.repeat(301)] },
    (input: PurchasePayableOrderDto) => { input.shippingMarkCount = -1 },
    (input: PurchasePayableOrderDto) => { input.shippingMarkCount = 1.5 },
    (input: PurchasePayableOrderDto) => {
      input.shippingMarks = ['【QSM-0001】公司囤货采购']
      input.shippingMarkCount = 0
    },
  ]) {
    const changed = order()
    mutate(changed)
    invalid([changed])
  }
})
