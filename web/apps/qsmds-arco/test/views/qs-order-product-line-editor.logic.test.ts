import type { OrderProductLineModel } from '../../src/components/business/QsOrderProductLineEditor/types'
import type { ProductSelectorItem } from '../../src/components/business/QsProductSelector/types'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import {
  applyProductSelectionChanges,
  calculateOrderProductLineTotals,
  createTemporaryOrderProductLine,
  validateMatchingCustomUnitPrices,
} from '../../src/components/business/QsOrderProductLineEditor/logic'

const catalogProduct: ProductSelectorItem = {
  id: 'product-a',
  productNo: 'SKU-A',
  name: '城市旅行收纳包',
  supplierValue: 'SUPPLIER_A',
  attributes: [],
  standardUnitPriceAmount: '12.5000',
  currencyCode: 'TWD',
  mainImage: null,
}

const catalogLine: OrderProductLineModel = {
  key: 'line-a',
  lineType: 'CATALOG',
  productId: 'product-a',
  productNo: 'SKU-A',
  name: '城市旅行收纳包',
  description: '保留本单备注',
  standardUnitPriceAmount: '12.5000',
  actualUnitPriceAmount: '10.2500',
  quantity: '2',
  mainImage: null,
}

test('ADD 与可累计 INCREMENT 一次性应用，增量保持售价和备注', () => {
  const result = applyProductSelectionChanges([catalogLine], [{
    kind: 'INCREMENT',
    lineKey: 'line-a',
    productId: 'product-a',
    delta: 2,
  }, {
    kind: 'ADD',
    product: { ...catalogProduct, id: 'product-b', productNo: 'SKU-B' },
    quantity: 2,
  }])

  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.deepEqual(result.lines.map(line => [line.productId, line.quantity]), [
    ['product-a', '4'],
    ['product-b', '2'],
  ])
  assert.equal(result.lines[0]!.actualUnitPriceAmount, '10.2500')
  assert.equal(result.lines[0]!.description, '保留本单备注')
  assert.equal(result.lines[1]!.actualUnitPriceAmount, '0.00')
})

test('数据库产品与临时产品新行的本单售价统一从零开始，不复制标准价', () => {
  const temporary = createTemporaryOrderProductLine('temp-default-price')
  const applied = applyProductSelectionChanges([], [{
    kind: 'ADD',
    product: catalogProduct,
    quantity: 1,
  }])

  assert.equal(temporary.actualUnitPriceAmount, '0.00')
  assert.equal(applied.ok, true)
  if (!applied.ok) {
    return
  }
  assert.equal(applied.lines[0]!.standardUnitPriceAmount, '12.5000')
  assert.equal(applied.lines[0]!.actualUnitPriceAmount, '0.00')
})

test('采购临时产品可从双价格空值开始，并要求规范金额完全相等', () => {
  const temporary = createTemporaryOrderProductLine('purchase-custom', null)

  assert.equal(temporary.standardUnitPriceAmount, null)
  assert.equal(temporary.actualUnitPriceAmount, null)
  assert.deepEqual(validateMatchingCustomUnitPrices(temporary), {
    ok: false,
    code: 'REQUIRED',
  })
  assert.deepEqual(validateMatchingCustomUnitPrices({
    ...temporary,
    standardUnitPriceAmount: '12.50',
    actualUnitPriceAmount: '12.5000',
  }), { ok: true })
  assert.deepEqual(validateMatchingCustomUnitPrices({
    ...temporary,
    standardUnitPriceAmount: '12.50',
    actualUnitPriceAmount: '12.51',
  }), {
    ok: false,
    code: 'MISMATCH',
  })
})

test('任一变更不可信时整批失败，不部分写入原数组', () => {
  const result = applyProductSelectionChanges([catalogLine], [{
    kind: 'INCREMENT',
    lineKey: 'missing',
    productId: 'product-a',
    delta: 1,
  }, {
    kind: 'ADD',
    product: { ...catalogProduct, id: 'product-b' },
    quantity: 1,
  }])

  assert.deepEqual(result, {
    ok: false,
    code: 'STALE_SELECTION',
    message: '产品明细已变化，请重新选择产品',
  })
  assert.equal(catalogLine.quantity, '2')
})

test('REMOVE 只删除对应数据库产品并保留临时产品', () => {
  const temporary = {
    ...createTemporaryOrderProductLine('temp-a'),
    name: '本单临时包装',
    actualUnitPriceAmount: '3.0000',
  }
  const result = applyProductSelectionChanges([catalogLine, temporary], [{
    kind: 'REMOVE',
    lineKey: 'line-a',
    productId: 'product-a',
  }])

  assert.equal(result.ok, true)
  if (!result.ok) {
    return
  }
  assert.deepEqual(result.lines.map(line => line.key), ['temp-a'])
})

test('临时产品不伪造标准价，汇总使用四位十进制定点计算', () => {
  const temporary = {
    ...createTemporaryOrderProductLine('temp-a'),
    name: '本单临时包装',
    actualUnitPriceAmount: '3.3333',
    quantity: '3',
  }
  assert.equal(temporary.productNo, null)
  assert.equal(temporary.standardUnitPriceAmount, null)

  assert.deepEqual(calculateOrderProductLineTotals([
    catalogLine,
    temporary,
  ], 4), {
    standardTotal: '25.0000',
    actualTotal: '30.4999',
    missingStandardPriceCount: 0,
  })
})

test('临时产品手工填写采购定价后按数量计入采购定价汇总', () => {
  const temporary = {
    ...createTemporaryOrderProductLine('purchase-custom-total', null),
    name: '手工采购包装服务',
    standardUnitPriceAmount: '15.00',
    actualUnitPriceAmount: '15.00',
    quantity: '2',
  }

  assert.deepEqual(calculateOrderProductLineTotals([
    catalogLine,
    temporary,
  ], 2), {
    standardTotal: '55.00',
    actualTotal: '50.50',
    missingStandardPriceCount: 0,
  })
})

test('无当前币种标准价的产品可加入明细，本单售价仍从零开始且不计入标准价汇总', () => {
  const unpricedProduct: ProductSelectorItem = {
    ...catalogProduct,
    id: 'product-unpriced',
    productNo: 'SKU-UNPRICED',
    standardUnitPriceAmount: null,
  }
  const applied = applyProductSelectionChanges([], [{
    kind: 'ADD',
    product: unpricedProduct,
    quantity: 2,
  }])

  assert.equal(applied.ok, true)
  if (!applied.ok) {
    return
  }
  assert.equal(applied.lines[0]!.standardUnitPriceAmount, null)
  assert.equal(applied.lines[0]!.actualUnitPriceAmount, '0.00')
  assert.deepEqual(calculateOrderProductLineTotals([
    catalogLine,
    applied.lines[0]!,
  ], 4), {
    standardTotal: '25.0000',
    actualTotal: '20.5000',
    missingStandardPriceCount: 1,
  })
})
