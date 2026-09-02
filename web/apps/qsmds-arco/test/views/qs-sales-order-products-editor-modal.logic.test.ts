import type { OrderProductLineModel } from '../../src/components/business/QsOrderProductLineEditor/types'
import type { SalesOrderProductEditModalContext } from '../../src/components/business/QsSalesOrderProductsEditorModal/types'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 纯逻辑测试使用 Node.js 内置 runner。
import test from 'node:test'
import {
  buildSalesOrderProductEditIntent,
  calculateSalesOrderProductEditPreview,
  createExistingSalesOrderLineDrafts,
} from '../../src/components/business/QsSalesOrderProductsEditorModal/logic'

const context: SalesOrderProductEditModalContext = {
  salesOrder: {
    id: '11111111-1111-4111-8111-111111111111',
    orderNo: 'SO/20260902-00001',
    customerName: '测试客户',
    currencyCode: 'TWD',
    orderStatus: 'CONFIRMED',
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    version: 7,
  },
  amounts: {
    lineSubtotalAmount: '300.0000',
    agreedTotalAmount: '300.0000',
    depositDueAmount: '180.0000',
    balanceDueAmount: '120.0000',
    paidAmount: '100.0000',
    outstandingAmount: '200.0000',
  },
  existingLines: [{
    id: 'existing-line-a',
    lineNumber: 1,
    lineType: 'CATALOG',
    productId: '22222222-2222-4222-8222-222222222222',
    productNo: 'PROD/00001',
    productName: '已采购产品',
    description: null,
    standardUnitPriceAmount: '55.0000',
    actualUnitPriceAmount: '50.0000',
    quantity: 2,
    lineTotalAmount: '100.0000',
    activePurchasedQuantity: 2,
    canDecrease: false,
  }, {
    id: 'existing-line-b',
    lineNumber: 2,
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    productName: '未采购服务',
    description: null,
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: '200.0000',
    quantity: 1,
    lineTotalAmount: '200.0000',
    activePurchasedQuantity: 0,
    canDecrease: true,
  }],
  availableLineCapacity: 98,
}

function newCatalogLine(): OrderProductLineModel {
  return {
    key: 'new-catalog',
    lineType: 'CATALOG',
    productId: '33333333-3333-4333-8333-333333333333',
    productNo: 'PROD/00002',
    name: '新增产品',
    description: '',
    standardUnitPriceAmount: '30.0000',
    actualUnitPriceAmount: '30.00',
    quantity: '2',
    mainImage: null,
  }
}

test('既有行草稿把采购锁定行最小数量固定为原数量', () => {
  assert.deepEqual(createExistingSalesOrderLineDrafts(context), [{
    lineId: 'existing-line-a',
    originalQuantity: 2,
    desiredQuantity: '2',
    minimumQuantity: 2,
  }, {
    lineId: 'existing-line-b',
    originalQuantity: 1,
    desiredQuantity: '1',
    minimumQuantity: 0,
  }])
})

test('预览同时计算增加、移除、新增、金额差额和履约回退', () => {
  const drafts = createExistingSalesOrderLineDrafts(context).map((draft, index) => ({
    ...draft,
    desiredQuantity: index === 0 ? '3' : '0',
  }))
  assert.deepEqual(calculateSalesOrderProductEditPreview({
    context,
    existingLineDrafts: drafts,
    newLines: [newCatalogLine()],
    precision: 2,
  }), {
    amountDelta: '-90.00',
    lineSubtotalAmount: '210.00',
    agreedTotalAmount: '210.00',
    depositDueAmount: '180.00',
    balanceDueAmount: '30.00',
    depositReductionAmount: '0.00',
    requiresDepositReduction: false,
    addedLineCount: 1,
    increasedLineCount: 1,
    decreasedLineCount: 0,
    removedLineCount: 1,
    expectedFulfillmentStatus: 'PENDING',
  })
})

test('已采购行不允许减少，未采购行可以降为零', () => {
  const drafts = createExistingSalesOrderLineDrafts(context).map((draft, index) => ({
    ...draft,
    desiredQuantity: index === 0 ? '1' : '0',
  }))
  const result = buildSalesOrderProductEditIntent({
    context,
    existingLineDrafts: drafts,
    newLines: [],
    precision: 2,
    reason: '客户减少产品',
    confirmDepositReduction: false,
  })
  assert.equal(result.valid, false)
  if (!result.valid) {
    assert.equal(
      result.fieldErrors['existingLines.0.desiredQuantity'],
      '存在有效采购单，数量不能低于 2',
    )
  }
})

test('总价低于原定金时只有加强确认可以产生 true 标记', () => {
  const drafts = createExistingSalesOrderLineDrafts(context).map((draft, index) => ({
    ...draft,
    desiredQuantity: index === 0 ? '2' : '0',
  }))
  const withoutConfirmation = buildSalesOrderProductEditIntent({
    context,
    existingLineDrafts: drafts,
    newLines: [],
    precision: 2,
    reason: '客户取消服务',
    confirmDepositReduction: false,
  })
  assert.equal(withoutConfirmation.valid, false)
  if (!withoutConfirmation.valid) {
    assert.equal(withoutConfirmation.fieldErrors.confirmation, '定金调整确认状态已变化，请重新核对')
  }

  const confirmed = buildSalesOrderProductEditIntent({
    context,
    existingLineDrafts: drafts,
    newLines: [],
    precision: 2,
    reason: '客户取消服务',
    confirmDepositReduction: true,
  })
  assert.equal(confirmed.valid, true)
  if (confirmed.valid) {
    assert.equal(confirmed.intent.confirmDepositReduction, true)
    assert.equal(confirmed.preview.agreedTotalAmount, '100.00')
    assert.equal(confirmed.preview.depositDueAmount, '100.00')
    assert.equal(confirmed.preview.depositReductionAmount, '80.00')
  }
})

test('请求必须包含全部既有行并至少保留一个有效产品', () => {
  const missing = buildSalesOrderProductEditIntent({
    context,
    existingLineDrafts: [],
    newLines: [newCatalogLine()],
    precision: 2,
    reason: '测试遗漏',
    confirmDepositReduction: false,
  })
  assert.equal(missing.valid, false)
  if (!missing.valid) {
    assert.equal(missing.fieldErrors.existingLines, '产品明细已变化，请重新加载')
  }

  const removableContext = {
    ...context,
    existingLines: [context.existingLines[1]!],
    availableLineCapacity: 99,
  }
  const empty = buildSalesOrderProductEditIntent({
    context: removableContext,
    existingLineDrafts: [{
      lineId: 'existing-line-b',
      originalQuantity: 1,
      desiredQuantity: '0',
      minimumQuantity: 0,
    }],
    newLines: [],
    precision: 2,
    reason: '移除全部',
    confirmDepositReduction: true,
  })
  assert.equal(empty.valid, false)
  if (!empty.valid) {
    assert.equal(empty.fieldErrors.lines, '销售订单必须至少保留一行产品')
  }
})
