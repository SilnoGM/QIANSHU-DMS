import type { OrderProductLineModel } from '../../src/components/business/QsOrderProductLineEditor/types'
import type { SalesOrderProductEditModalContext } from '../../src/components/business/QsSalesOrderProductsEditorModal/types'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 纯逻辑测试使用 Node.js 内置 runner。
import test from 'node:test'
import {
  buildSalesOrderProductEditIntent,
  calculateSalesOrderProductEditPreview,
  createSalesOrderProductEditLines,
  reconcileSalesOrderProductEditLines,
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
    supplierValue: 'SUPPLIER_A',
    description: null,
    standardUnitPriceAmount: '55.0000',
    actualUnitPriceAmount: '50.0000',
    quantity: 2,
    lineTotalAmount: '100.0000',
    activePurchasedQuantity: 2,
    canDecrease: false,
    mainImage: null,
  }, {
    id: 'existing-line-b',
    lineNumber: 2,
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    productName: '未采购服务',
    supplierValue: null,
    description: null,
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: '200.0000',
    quantity: 1,
    lineTotalAmount: '200.0000',
    activePurchasedQuantity: 0,
    canDecrease: true,
    mainImage: null,
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

test('把当前订单产品完整装载为统一编辑器行', () => {
  assert.deepEqual(createSalesOrderProductEditLines(context), [{
    key: 'existing-line-a',
    lineType: 'CATALOG',
    productId: '22222222-2222-4222-8222-222222222222',
    productNo: 'PROD/00001',
    name: '已采购产品',
    supplierValue: 'SUPPLIER_A',
    description: '',
    standardUnitPriceAmount: '55.0000',
    actualUnitPriceAmount: '50',
    quantity: '2',
    mainImage: null,
  }, {
    key: 'existing-line-b',
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    name: '未采购服务',
    supplierValue: null,
    description: '',
    standardUnitPriceAmount: null,
    actualUnitPriceAmount: '200',
    quantity: '1',
    mainImage: null,
  }])
})

test('重新加载上下文时保留快照草稿、新增行和未采购行删除意图', () => {
  const currentLines = createSalesOrderProductEditLines(context)
  const editedFirstLine = {
    ...currentLines[0]!,
    name: '保留的销售快照名称',
    quantity: '3',
  }
  const result = reconcileSalesOrderProductEditLines({
    previousContext: context,
    nextContext: context,
    previousLines: [editedFirstLine, newCatalogLine()],
  })

  assert.deepEqual(result.map(line => line.key), ['existing-line-a', 'new-catalog'])
  assert.equal(result[0]?.name, '保留的销售快照名称')
  assert.equal(result[0]?.quantity, '3')
})

test('重新加载期间产生有效采购时恢复并锁定原本删除的销售行', () => {
  const nextContext = {
    ...context,
    existingLines: context.existingLines.map(line => (
      line.id === 'existing-line-b'
        ? { ...line, activePurchasedQuantity: 1, canDecrease: false }
        : line
    )),
  }
  const result = reconcileSalesOrderProductEditLines({
    previousContext: context,
    nextContext,
    previousLines: [createSalesOrderProductEditLines(context)[0]!],
  })

  assert.deepEqual(result.map(line => line.key), ['existing-line-a', 'existing-line-b'])
})

test('预览同时计算统一产品行、标准总价和全部付款金额变化', () => {
  const lines = [
    { ...createSalesOrderProductEditLines(context)[0]!, quantity: '3' },
    newCatalogLine(),
  ]
  assert.deepEqual(calculateSalesOrderProductEditPreview({
    context,
    lines,
    precision: 2,
  }), {
    amountDelta: '-90.00',
    standardAmountDelta: '115.00',
    standardSubtotalAmount: '225.00',
    lineSubtotalAmount: '210.00',
    agreedTotalAmount: '210.00',
    depositDueAmount: '180.00',
    balanceDueAmount: '30.00',
    paidAmount: '100.00',
    outstandingAmount: '110.00',
    depositReductionAmount: '0.00',
    requiresDepositReduction: false,
    addedLineCount: 1,
    increasedLineCount: 1,
    decreasedLineCount: 0,
    removedLineCount: 1,
    expectedFulfillmentStatus: 'PENDING',
  })
})

test('已采购行可修改销售快照但数量不能低于有效已采购数量', () => {
  const lines = createSalesOrderProductEditLines(context).map((line, index) => (
    index === 0
      ? {
          ...line,
          name: '修改后的销售快照',
          description: '新备注',
          actualUnitPriceAmount: '60',
          quantity: '1',
        }
      : line
  ))
  const invalid = buildSalesOrderProductEditIntent({
    context,
    lines,
    precision: 2,
    reason: '客户调整产品',
    confirmDepositReduction: false,
  })
  assert.equal(invalid.valid, false)
  if (!invalid.valid) {
    assert.equal(invalid.fieldErrors['lines.0.quantity'], '存在有效采购单，数量不能低于 2')
  }

  const valid = buildSalesOrderProductEditIntent({
    context,
    lines: lines.map((line, index) => index === 0 ? { ...line, quantity: '2' } : line),
    precision: 2,
    reason: '客户调整产品',
    confirmDepositReduction: false,
  })
  assert.equal(valid.valid, true)
  if (valid.valid) {
    assert.deepEqual(valid.intent.existingLines[0], {
      lineId: 'existing-line-a',
      name: '修改后的销售快照',
      description: '新备注',
      actualUnitPriceAmount: '60.00',
      desiredQuantity: 2,
    })
  }
})

test('已采购行不能从统一编辑器删除，未采购行可以删除', () => {
  const onlyUnpurchasedRemoved = createSalesOrderProductEditLines(context).slice(0, 1)
  const allowed = buildSalesOrderProductEditIntent({
    context,
    lines: onlyUnpurchasedRemoved,
    precision: 2,
    reason: '客户取消服务',
    confirmDepositReduction: true,
  })
  assert.equal(allowed.valid, true)
  if (allowed.valid) {
    assert.equal(allowed.intent.existingLines[1]?.desiredQuantity, 0)
  }

  const purchasedRemoved = createSalesOrderProductEditLines(context).slice(1)
  const rejected = buildSalesOrderProductEditIntent({
    context,
    lines: purchasedRemoved,
    precision: 2,
    reason: '错误移除',
    confirmDepositReduction: false,
  })
  assert.equal(rejected.valid, false)
  if (!rejected.valid) {
    assert.equal(rejected.fieldErrors.lines, '存在有效采购单的产品不能删除')
  }
})

test('总价低于原定金时只有加强确认可以产生 true 标记', () => {
  const lines = createSalesOrderProductEditLines(context).slice(0, 1)
  const withoutConfirmation = buildSalesOrderProductEditIntent({
    context,
    lines,
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
    lines,
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

test('统一编辑器必须至少保留一个有效产品', () => {
  const removableContext = {
    ...context,
    existingLines: [context.existingLines[1]!],
    availableLineCapacity: 99,
  }
  const empty = buildSalesOrderProductEditIntent({
    context: removableContext,
    lines: [],
    precision: 2,
    reason: '移除全部',
    confirmDepositReduction: true,
  })
  assert.equal(empty.valid, false)
  if (!empty.valid) {
    assert.equal(empty.fieldErrors.lines, '销售订单必须至少保留一行产品')
  }
})
