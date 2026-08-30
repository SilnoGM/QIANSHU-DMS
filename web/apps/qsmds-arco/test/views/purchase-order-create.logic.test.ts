import type {
  PurchaseOrderDetailDto,
  PurchaseOrderProductOptionDto,
  PurchaseOrderSourceSalesOrderLineDto,
} from '../../src/api/generated/types.gen'
import type { OrderProductLineModel } from '../../src/components/business/QsOrderProductLineEditor/types'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 采购创建纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  adaptPurchaseOrderProductPage,
  beginPurchaseOrderSubmission,
  buildPurchaseOrderCreateRequest,
  createPurchaseOrderEditingState,
  parsePurchaseOrderCreateType,
  replayUnknownPurchaseOrderSubmission,
  resolvePurchaseOrderCreateStepForErrors,
  resolvePurchaseOrderCreateStepForField,
  resolvePurchaseOrderSubmissionFailure,
  resolvePurchaseOrderSubmissionSuccess,
  synchronizePurchaseOrderSourceLines,
  validatePurchaseOrderCreateStep,
} from '../../src/views/operations/purchase-orders/purchase-order-create.logic'

const catalogOption = {
  id: '11111111-1111-4111-8111-111111111111',
  productNo: 'SKU-A',
  name: '采购产品 A',
  attributes: [],
  supplierValue: 'SUPPLIER_CN_01',
  referencePurchaseUnitPriceAmount: '12.5000',
  currencyCode: 'CNY',
  mainImage: {
    id: '77777777-7777-4777-8777-777777777777',
    contentUrl: '/api/purchase-orders/product-options/main-image/content',
  },
} as PurchaseOrderProductOptionDto & {
  readonly mainImage: { readonly id: string, readonly contentUrl: string }
}

const sourceCatalogLine: PurchaseOrderSourceSalesOrderLineDto = {
  id: '22222222-2222-4222-8222-222222222222',
  lineNumber: 1,
  lineType: 'CATALOG',
  productId: catalogOption.id,
  productNo: 'SKU-A',
  productName: '采购产品 A',
  productAttributes: [],
  description: '销售来源说明',
  quantity: 3,
  purchasedQuantity: 1,
  remainingQuantity: 2,
}

test('创建类型只接受路由单值，备货类型还要求 system-only 权限', () => {
  assert.equal(parsePurchaseOrderCreateType('SALES_LINKED', false), 'SALES_LINKED')
  assert.equal(parsePurchaseOrderCreateType('STOCK', true), 'STOCK')
  assert.equal(parsePurchaseOrderCreateType('STOCK', false), null)
  assert.equal(parsePurchaseOrderCreateType(['STOCK'], true), null)
  assert.equal(parsePurchaseOrderCreateType('OTHER', true), null)
})

test('销售关联采购字段按基础信息、产品付款、唛头备注归属到前三个填写步骤', () => {
  assert.equal(resolvePurchaseOrderCreateStepForField('orderDate'), 0)
  assert.equal(resolvePurchaseOrderCreateStepForField('supplierValue'), 0)
  assert.equal(resolvePurchaseOrderCreateStepForField('salesOrderId'), 0)
  assert.equal(resolvePurchaseOrderCreateStepForField('lines.0.actualUnitPriceAmount'), 1)
  assert.equal(resolvePurchaseOrderCreateStepForField('depositDueAmount'), 1)
  assert.equal(resolvePurchaseOrderCreateStepForField('balanceDueAmount'), 1)
  assert.equal(resolvePurchaseOrderCreateStepForField('shippingMarkText'), 2)
  assert.equal(resolvePurchaseOrderCreateStepForField('remark'), 2)
  assert.equal(resolvePurchaseOrderCreateStepForField('unknown'), null)
  assert.equal(resolvePurchaseOrderCreateStepForErrors({
    balanceDueAmount: '金额错误',
    shippingMarkText: '唛头错误',
  }), 1)
})

test('下一步只拦截当前采购填写步骤的领域错误', () => {
  const source = {
    balanceDueAmount: null,
    depositDueAmount: null,
    lines: [],
    maximumQuantityByKey: {},
    orderDate: '2026-08-28',
    purchaseType: 'SALES_LINKED',
    remark: '',
    salesOrderId: null,
    shippingMarkText: '',
    sourceSalesOrderLineIdByKey: {},
    supplierValue: '',
    today: '2026-08-28',
  } as const

  const base = validatePurchaseOrderCreateStep(source, 0)
  assert.equal(base.valid, false)
  if (!base.valid) {
    assert.deepEqual(base.fieldErrors, {
      salesOrderId: '请选择关联销售订单',
      supplierValue: '请选择供应商',
    })
  }

  const products = validatePurchaseOrderCreateStep(source, 1)
  assert.equal(products.valid, false)
  if (!products.valid) {
    assert.deepEqual(products.fieldErrors, {
      balanceDueAmount: '尾款必须是非负且最多两位小数的金额',
      depositDueAmount: '定金必须是非负且最多两位小数的金额',
      lines: '请至少添加一条采购产品明细',
    })
  }

  assert.deepEqual(validatePurchaseOrderCreateStep(source, 2), { valid: true })
})

test('采购产品 loader 映射 CNY 采购定价且保持分页身份', () => {
  assert.deepEqual(adaptPurchaseOrderProductPage({
    items: [catalogOption],
    page: 2,
    pageSize: 20,
    total: 21,
  }), {
    items: [{
      id: catalogOption.id,
      productNo: 'SKU-A',
      name: '采购产品 A',
      supplierValue: 'SUPPLIER_CN_01',
      attributes: [],
      standardUnitPriceAmount: '12.5000',
      currencyCode: 'CNY',
      mainImage: catalogOption.mainImage,
    }],
    page: 2,
    pageSize: 20,
    total: 21,
  })
})

test('销售来源同步只加入当前供应商可采购的正式产品和所有临时产品', () => {
  const result = synchronizePurchaseOrderSourceLines({
    productOptions: [catalogOption],
    sourceLines: [sourceCatalogLine, {
      ...sourceCatalogLine,
      id: '33333333-3333-4333-8333-333333333333',
      lineNumber: 2,
      productId: '44444444-4444-4444-8444-444444444444',
      productNo: 'SKU-B',
      productName: '其他供应商产品',
    }, {
      ...sourceCatalogLine,
      id: '55555555-5555-4555-8555-555555555555',
      lineNumber: 3,
      lineType: 'CUSTOM',
      productId: null,
      productNo: null,
      productName: '销售临时包装',
      remainingQuantity: 1,
    }, {
      ...sourceCatalogLine,
      id: '66666666-6666-4666-8666-666666666666',
      lineNumber: 4,
      remainingQuantity: 0,
    }],
  })

  assert.deepEqual(result.lines.map(line => ({
    actual: line.actualUnitPriceAmount,
    key: line.key,
    name: line.name,
    quantity: line.quantity,
    reference: line.standardUnitPriceAmount,
    type: line.lineType,
  })), [{
    actual: null,
    key: `source-${sourceCatalogLine.id}`,
    name: '采购产品 A',
    quantity: '2',
    reference: '12.5000',
    type: 'CATALOG',
  }, {
    actual: null,
    key: 'source-55555555-5555-4555-8555-555555555555',
    name: '销售临时包装',
    quantity: '1',
    reference: null,
    type: 'CUSTOM',
  }])
  assert.deepEqual(result.sourceSalesOrderLineIdByKey, {
    [`source-${sourceCatalogLine.id}`]: sourceCatalogLine.id,
    'source-55555555-5555-4555-8555-555555555555': '55555555-5555-4555-8555-555555555555',
  })
  assert.deepEqual(result.maximumQuantityByKey, {
    [`source-${sourceCatalogLine.id}`]: 2,
    'source-55555555-5555-4555-8555-555555555555': 1,
  })
  assert.equal(result.incompatibleCatalogCount, 1)
  assert.equal(result.exhaustedCount, 1)
  assert.deepEqual(result.lines[0]?.mainImage, catalogOption.mainImage)
})

test('关联采购构造 DTO 时校验来源数量、明细总价和 CUSTOM 双价格', () => {
  const catalogLine: OrderProductLineModel = {
    key: `source-${sourceCatalogLine.id}`,
    lineType: 'CATALOG',
    productId: catalogOption.id,
    productNo: 'SKU-A',
    name: '采购产品 A',
    description: '采购备注',
    standardUnitPriceAmount: '12.5000',
    actualUnitPriceAmount: '10.00',
    quantity: '2',
    mainImage: null,
  }
  const customLine: OrderProductLineModel = {
    key: 'source-55555555-5555-4555-8555-555555555555',
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    name: '销售临时包装',
    description: '',
    standardUnitPriceAmount: '5.00',
    actualUnitPriceAmount: '5.00',
    quantity: '1',
    mainImage: null,
  }
  const source = {
    balanceDueAmount: '15.00',
    depositDueAmount: '10.00',
    lines: [catalogLine, customLine],
    maximumQuantityByKey: {
      [catalogLine.key]: 2,
      [customLine.key]: 1,
    },
    orderDate: '2026-08-28',
    purchaseType: 'SALES_LINKED',
    remark: '  采购说明 ',
    salesOrderId: '77777777-7777-4777-8777-777777777777',
    shippingMarkText: '  唛头 A\n第二行 ',
    sourceSalesOrderLineIdByKey: {
      [catalogLine.key]: sourceCatalogLine.id,
      [customLine.key]: '55555555-5555-4555-8555-555555555555',
    },
    supplierValue: 'SUPPLIER_CN_01',
    today: '2026-08-28',
  } as const
  const result = buildPurchaseOrderCreateRequest(source)

  assert.equal(result.valid, true)
  if (!result.valid) {
    return
  }
  assert.deepEqual(result.request, {
    purchaseType: 'SALES_LINKED',
    salesOrderId: '77777777-7777-4777-8777-777777777777',
    supplierValue: 'SUPPLIER_CN_01',
    orderDate: '2026-08-28',
    shippingMarkText: '唛头 A\n第二行',
    lines: [{
      lineType: 'CATALOG',
      productId: catalogOption.id,
      sourceSalesOrderLineId: sourceCatalogLine.id,
      actualPurchaseUnitPriceAmount: '10.00',
      quantity: 2,
    }, {
      lineType: 'CUSTOM',
      sourceSalesOrderLineId: '55555555-5555-4555-8555-555555555555',
      name: '销售临时包装',
      description: null,
      referencePurchaseUnitPriceAmount: '5.00',
      actualPurchaseUnitPriceAmount: '5.00',
      quantity: 1,
    }],
    purchaseTotalAmount: '25.00',
    depositDueAmount: '10.00',
    balanceDueAmount: '15.00',
    remark: '采购说明',
  })

  const invalid = buildPurchaseOrderCreateRequest({
    ...source,
    lines: [{
      ...customLine,
      standardUnitPriceAmount: '5.00',
      actualUnitPriceAmount: '5.01',
      quantity: '2',
    }],
  })
  assert.equal(invalid.valid, false)
  if (invalid.valid) {
    return
  }
  assert.equal(invalid.fieldErrors['lines.0.actualUnitPriceAmount'], '临时产品的采购定价必须与本单采购价相等')
  assert.equal(invalid.fieldErrors['lines.0.quantity'], '采购数量不能超过销售明细剩余可采购数量 1')
})

test('备货采购允许无销售来源的手工临时产品', () => {
  const result = buildPurchaseOrderCreateRequest({
    balanceDueAmount: '8.00',
    depositDueAmount: '0.00',
    lines: [{
      key: 'stock-custom',
      lineType: 'CUSTOM',
      productId: null,
      productNo: null,
      name: '备货临时包装',
      description: '',
      standardUnitPriceAmount: '8.00',
      actualUnitPriceAmount: '8.00',
      quantity: '1',
      mainImage: null,
    }],
    maximumQuantityByKey: {},
    orderDate: '2026-08-28',
    purchaseType: 'STOCK',
    remark: '',
    salesOrderId: null,
    shippingMarkText: '',
    sourceSalesOrderLineIdByKey: {},
    supplierValue: 'SUPPLIER_CN_01',
    today: '2026-08-28',
  })

  assert.equal(result.valid, true)
  if (result.valid) {
    assert.equal(result.request.salesOrderId, undefined)
    assert.equal(result.request.lines[0]?.sourceSalesOrderLineId, undefined)
  }
})

test('未知创建结果冻结请求并使用原幂等 Key 安全重放', () => {
  const built = buildPurchaseOrderCreateRequest({
    balanceDueAmount: '8.00',
    depositDueAmount: '0.00',
    lines: [{
      key: 'stock-custom',
      lineType: 'CUSTOM',
      productId: null,
      productNo: null,
      name: '备货临时包装',
      description: '',
      standardUnitPriceAmount: '8.00',
      actualUnitPriceAmount: '8.00',
      quantity: '1',
      mainImage: null,
    }],
    maximumQuantityByKey: {},
    orderDate: '2026-08-28',
    purchaseType: 'STOCK',
    remark: '',
    salesOrderId: null,
    shippingMarkText: '',
    sourceSalesOrderLineIdByKey: {},
    supplierValue: 'SUPPLIER_CN_01',
    today: '2026-08-28',
  })
  assert.equal(built.valid, true)
  if (!built.valid) {
    return
  }
  const submitting = beginPurchaseOrderSubmission(
    createPurchaseOrderEditingState(),
    built.request,
    { authEpoch: 3, requestVersion: 4 },
    () => '88888888-8888-4888-8888-888888888888',
  )
  const unknown = resolvePurchaseOrderSubmissionFailure(submitting, {
    fieldErrors: {},
    message: '网络连接失败',
    unknownResult: true,
  })
  assert.equal(unknown.phase, 'unknown')
  if (unknown.phase !== 'unknown') {
    return
  }
  const replay = replayUnknownPurchaseOrderSubmission(unknown, {
    authEpoch: 3,
    requestVersion: 5,
  })
  assert.equal(replay.idempotencyKey, submitting.idempotencyKey)
  assert.equal(replay.snapshot, submitting.snapshot)

  const detail = { id: 'purchase-a' } as PurchaseOrderDetailDto
  assert.deepEqual(resolvePurchaseOrderSubmissionSuccess(replay, detail), {
    phase: 'success',
    purchaseOrder: detail,
  })
})
