import type { OrderProductLineModel } from '../../src/components/business/QsOrderProductLineEditor/types'
import type { SalesOrderAddOnModalContext } from '../../src/components/business/QsSalesOrderAddOnProductsModal/types'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 纯逻辑测试使用 Node.js 内置 runner。
import test from 'node:test'
import {
  buildSalesOrderAddOnIntent,
  calculateSalesOrderAddOnPreview,
} from '../../src/components/business/QsSalesOrderAddOnProductsModal/logic'

const context: SalesOrderAddOnModalContext = {
  salesOrder: {
    id: '11111111-1111-4111-8111-111111111111',
    orderNo: 'SO/20260902-00001',
    customerName: '测试客户',
    currencyCode: 'TWD',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PAID',
    version: 7,
  },
  amounts: {
    lineSubtotalAmount: '100.00',
    agreedTotalAmount: '100.00',
    depositDueAmount: '20.00',
    balanceDueAmount: '80.00',
    paidAmount: '100.00',
    outstandingAmount: '0.00',
  },
  existingLines: [{
    id: 'existing-line',
    lineNumber: 1,
    lineType: 'CATALOG',
    productNo: 'PROD/00001',
    productName: '历史产品',
    actualUnitPriceAmount: '100.00',
    quantity: 1,
    lineTotalAmount: '100.00',
  }],
  availableLineCapacity: 2,
}

function catalogLine(overrides: Partial<OrderProductLineModel> = {}): OrderProductLineModel {
  return {
    key: 'catalog-line',
    lineType: 'CATALOG',
    productId: '22222222-2222-4222-8222-222222222222',
    productNo: 'PROD/00001',
    name: '历史产品',
    description: '',
    standardUnitPriceAmount: '12.50',
    actualUnitPriceAmount: '12.50',
    quantity: '2',
    mainImage: null,
    ...overrides,
  }
}

test('加购预览只汇总新增行并保持定金不变', () => {
  const preview = calculateSalesOrderAddOnPreview(context, [catalogLine()], 2)

  assert.deepEqual(preview, {
    amountDelta: '25.00',
    lineSubtotalAmount: '125.00',
    agreedTotalAmount: '125.00',
    depositDueAmount: '20.00',
    balanceDueAmount: '105.00',
  })
})

test('加购意图接受与历史产品相同的独立目录行并规范化输入', () => {
  const result = buildSalesOrderAddOnIntent({
    context,
    lines: [catalogLine()],
    precision: 2,
    reason: '  客户追加同款  ',
  })

  assert.equal(result.valid, true)
  if (!result.valid) {
    return
  }
  assert.deepEqual(result.intent, {
    expectedVersion: 7,
    reason: '客户追加同款',
    lines: [{
      lineType: 'CATALOG',
      productId: '22222222-2222-4222-8222-222222222222',
      actualUnitPriceAmount: '12.50',
      quantity: 2,
    }],
  })
})

test('加购意图校验原因、行容量及 CUSTOM 必填字段', () => {
  const result = buildSalesOrderAddOnIntent({
    context: { ...context, availableLineCapacity: 1 },
    lines: [
      catalogLine(),
      catalogLine({
        key: 'custom-line',
        lineType: 'CUSTOM',
        productId: null,
        productNo: null,
        name: '   ',
        actualUnitPriceAmount: null,
        quantity: '0',
      }),
    ],
    precision: 2,
    reason: '   ',
  })

  assert.equal(result.valid, false)
  if (result.valid) {
    return
  }
  assert.equal(result.fieldErrors.reason, '请填写加购原因')
  assert.equal(result.fieldErrors.lines, '本次最多可新增 1 行产品')
  assert.equal(result.fieldErrors['lines.1.name'], '请输入临时产品名称')
  assert.equal(result.fieldErrors['lines.1.actualUnitPriceAmount'], '请输入有效的本单售价')
  assert.equal(result.fieldErrors['lines.1.quantity'], '产品数量必须是正整数')
})

test('没有新增行或销售订单行容量已满时不能进入二次确认', () => {
  const empty = buildSalesOrderAddOnIntent({
    context,
    lines: [],
    precision: 2,
    reason: '客户加购产品',
  })
  const full = buildSalesOrderAddOnIntent({
    context: { ...context, availableLineCapacity: 0 },
    lines: [catalogLine()],
    precision: 2,
    reason: '客户加购产品',
  })

  assert.equal(empty.valid, false)
  assert.equal(full.valid, false)
  if (!empty.valid && !full.valid) {
    assert.equal(empty.fieldErrors.lines, '请至少新增一行产品')
    assert.equal(full.fieldErrors.lines, '销售订单产品明细已达上限')
  }
})
