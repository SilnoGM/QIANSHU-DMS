import type { OrderProductLineModel } from '../../src/components/business/QsOrderProductLineEditor/types'
import type { PriceQuotationSheetSource } from '../../src/views/operations/purchase-orders/purchase-order-create.logic'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 核价单请求构造是纯逻辑，使用 Node.js 内置 runner。
import test from 'node:test'

import { buildPriceQuotationSheetRequest } from '../../src/views/operations/purchase-orders/purchase-order-create.logic'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'

function line(overrides: Partial<OrderProductLineModel> = {}): OrderProductLineModel {
  return {
    key: 'line-1',
    lineType: 'CATALOG',
    productId: PRODUCT_ID,
    productNo: 'SKU-A',
    name: '采购产品 A',
    description: '',
    standardUnitPriceAmount: '9300',
    actualUnitPriceAmount: '9300',
    quantity: '2',
    mainImage: null,
    ...overrides,
  }
}

function source(overrides: Partial<PriceQuotationSheetSource> = {}): PriceQuotationSheetSource {
  return {
    productMode: 'CATALOG',
    supplierValue: ' supplier-a ',
    customSupplierName: null,
    orderDate: '2026-11-21',
    today: '2026-11-22',
    lines: [line()],
    ...overrides,
  }
}

test('CATALOG 核价单只提交产品、数量和两种价格，不要求定金/尾款/唛头/货件', () => {
  const result = buildPriceQuotationSheetRequest(source({
    lines: [line({ description: ' 请附带说明书 ' })],
  }))

  assert.equal(result.valid, true)
  if (!result.valid) {
    return
  }
  assert.deepEqual(result.request, {
    productMode: 'CATALOG',
    supplierValue: 'supplier-a',
    orderDate: '2026-11-21',
    lines: [{
      lineType: 'CATALOG',
      productId: PRODUCT_ID,
      expectedReferencePurchaseUnitPriceAmount: '9300.00',
      actualPurchaseUnitPriceAmount: '9300.00',
      quantity: 2,
      description: '请附带说明书',
    }],
  })
})

test('CUSTOM 核价单接受写法不同的相等价格并保留手工名称', () => {
  const result = buildPriceQuotationSheetRequest(source({
    productMode: 'CUSTOM',
    supplierValue: null,
    customSupplierName: ' 张三加工厂 ',
    lines: [line({
      lineType: 'CUSTOM',
      productId: null,
      productNo: null,
      name: ' 定制托盘 ',
      standardUnitPriceAmount: '1200',
      actualUnitPriceAmount: '1200.00',
      quantity: '3',
      description: '',
    })],
  }))

  assert.equal(result.valid, true)
  if (!result.valid) {
    return
  }
  assert.deepEqual(result.request, {
    productMode: 'CUSTOM',
    customSupplierName: '张三加工厂',
    orderDate: '2026-11-21',
    lines: [{
      lineType: 'CUSTOM',
      name: '定制托盘',
      referencePurchaseUnitPriceAmount: '1200.00',
      actualPurchaseUnitPriceAmount: '1200.00',
      quantity: 3,
      description: null,
    }],
  })
})

test('CUSTOM 行采购定价必须与本单采购价相等', () => {
  const result = buildPriceQuotationSheetRequest(source({
    productMode: 'CUSTOM',
    supplierValue: null,
    customSupplierName: '张三加工厂',
    lines: [line({
      lineType: 'CUSTOM',
      productId: null,
      name: '定制托盘',
      standardUnitPriceAmount: '1200',
      actualUnitPriceAmount: '1201',
    })],
  }))

  assert.equal(result.valid, false)
  if (result.valid) {
    return
  }
  assert.equal(result.fieldErrors['lines.0.actualUnitPriceAmount'], '临时产品的采购定价必须与本单采购价相等')
})

test('缺少供应商、无效日期、空明细和超限行数阻止生成', () => {
  assert.deepEqual(
    buildPriceQuotationSheetRequest(source({ supplierValue: '   ' })),
    { valid: false, fieldErrors: { supplierValue: '请选择供应商' } },
  )
  assert.deepEqual(
    buildPriceQuotationSheetRequest(source({ orderDate: '2026-11-23' })),
    { valid: false, fieldErrors: { orderDate: '采购日期不能为空且不能晚于今天' } },
  )
  assert.deepEqual(
    buildPriceQuotationSheetRequest(source({ lines: [] })),
    { valid: false, fieldErrors: { lines: '请至少添加一条采购产品明细' } },
  )
  assert.deepEqual(
    buildPriceQuotationSheetRequest(source({ lines: Array.from({ length: 101 }, (_, index) => line({ key: `line-${index}` })) })),
    { valid: false, fieldErrors: { lines: '采购产品明细最多 100 行' } },
  )
})

test('无效数量、价格、产品和行类型定位到具体行字段', () => {
  const result = buildPriceQuotationSheetRequest(source({
    lines: [line({
      productId: null,
      standardUnitPriceAmount: null,
      actualUnitPriceAmount: '1.234',
      quantity: '0',
    })],
  }))

  assert.equal(result.valid, false)
  if (result.valid) {
    return
  }
  assert.deepEqual(result.fieldErrors, {
    'lines.0.quantity': '采购数量必须是正整数',
    'lines.0.actualUnitPriceAmount': '本单采购价必须是非负且最多两位小数的金额',
    'lines.0.productId': '请选择有效的数据库产品',
    'lines.0.standardUnitPriceAmount': '数据库产品缺少采购定价',
  })
})

test('行备注压平后超过显示上限时截断到 80 个字符', () => {
  const result = buildPriceQuotationSheetRequest(source({
    lines: [line({ description: ` ${'备'.repeat(100)} ` })],
  }))

  assert.equal(result.valid, true)
  if (!result.valid) {
    return
  }
  assert.equal(Array.from(result.request.lines[0]?.description ?? '').length, 80)
})

test('产品明细类型与采购模式不一致时拒绝生成', () => {
  const result = buildPriceQuotationSheetRequest(source({
    productMode: 'CUSTOM',
    supplierValue: null,
    customSupplierName: '张三加工厂',
    lines: [line()],
  }))

  assert.equal(result.valid, false)
  if (result.valid) {
    return
  }
  assert.equal(result.fieldErrors['lines.0.lineType'], '产品明细与采购产品类型不匹配')
})
