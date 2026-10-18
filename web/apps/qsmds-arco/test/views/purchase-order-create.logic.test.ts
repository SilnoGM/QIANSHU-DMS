import type {
  PurchaseOrderDetailDto,
  PurchaseOrderProductOptionDto,
  PurchaseOrderSourceSalesOrderLineDto,
} from '../../src/api/generated/types.gen'
import type { OrderProductLineModel } from '../../src/components/business/QsOrderProductLineEditor/types'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 采购创建纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import { reactive } from 'vue'

import {
  adaptPurchaseOrderProductPage,
  beginPurchaseOrderSubmission,
  buildPurchaseOrderCreateRequest,
  calculatePurchaseOrderDraftTotal,
  createPurchaseOrderEditingState,
  getPurchaseOrderMutationFailure,
  hasPurchasablePurchaseOrderSourceLines,
  parsePurchaseOrderCreateContext,
  parsePurchaseOrderCreateType,
  replayUnknownPurchaseOrderSubmission,
  resolvePurchaseOrderCreateStepForErrors,
  resolvePurchaseOrderCreateStepForField,
  resolvePurchaseOrderSubmissionFailure,
  resolvePurchaseOrderSubmissionSuccess,
  synchronizePurchaseOrderSourceLines,
  validatePurchaseOrderCreateStep,
} from '../../src/views/operations/purchase-orders/purchase-order-create.logic'
import * as purchaseOrderCreateLogic from '../../src/views/operations/purchase-orders/purchase-order-create.logic'

const catalogOption = {
  id: '11111111-1111-4111-8111-111111111111',
  productNo: 'SKU-A',
  name: '采购产品 A',
  categoryName: '农机',
  productHeadName: '微耕机',
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
  purchasedLines: [{
    id: '88888888-8888-4888-8888-888888888888',
    referencePurchaseUnitPriceAmount: '12.5000',
    actualPurchaseUnitPriceAmount: '11.0000',
    quantity: 1,
    lineTotalAmount: '11.0000',
    description: '首批采购备注',
  }],
}

test('创建类型只接受路由单值，备货类型还要求 system-only 权限', () => {
  assert.equal(parsePurchaseOrderCreateType('SALES_LINKED', false), 'SALES_LINKED')
  assert.equal(parsePurchaseOrderCreateType('STOCK', true), 'STOCK')
  assert.equal(parsePurchaseOrderCreateType('STOCK', false), null)
  assert.equal(parsePurchaseOrderCreateType(['STOCK'], true), null)
  assert.equal(parsePurchaseOrderCreateType('OTHER', true), null)
})

test('创建上下文只接受产品类型与供应商来源互斥的完整路由参数', () => {
  assert.deepEqual(parsePurchaseOrderCreateContext({
    canCreateStock: false,
    customSupplierName: undefined,
    productMode: 'CATALOG',
    purchaseType: 'SALES_LINKED',
    salesOrderId: undefined,
    salesOrderNo: undefined,
    supplierValue: ' SUPPLIER_CN_01 ',
  }), {
    customSupplierName: null,
    productMode: 'CATALOG',
    purchaseType: 'SALES_LINKED',
    sourceShortcut: null,
    supplierValue: 'SUPPLIER_CN_01',
  })
  assert.deepEqual(parsePurchaseOrderCreateContext({
    canCreateStock: true,
    customSupplierName: ' 自定义供应商 ',
    productMode: 'CUSTOM',
    purchaseType: 'STOCK',
    salesOrderId: undefined,
    salesOrderNo: undefined,
    supplierValue: undefined,
  }), {
    customSupplierName: '自定义供应商',
    productMode: 'CUSTOM',
    purchaseType: 'STOCK',
    sourceShortcut: null,
    supplierValue: null,
  })
  assert.deepEqual(parsePurchaseOrderCreateContext({
    canCreateStock: false,
    customSupplierName: '临时供应商',
    productMode: 'CUSTOM',
    purchaseType: 'SALES_LINKED',
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    salesOrderNo: 'SO/2026-001',
    supplierValue: undefined,
  })?.sourceShortcut, {
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    salesOrderNo: 'SO/2026-001',
  })

  for (const input of [
    { productMode: undefined, supplierValue: 'SUPPLIER_CN_01' },
    { productMode: 'CATALOG', supplierValue: undefined },
    { productMode: 'CATALOG', supplierValue: ['SUPPLIER_CN_01'] },
    { productMode: 'CATALOG', supplierValue: 'SUPPLIER_CN_01', customSupplierName: '不应同时存在' },
    { productMode: 'CUSTOM', customSupplierName: undefined },
    { productMode: 'CUSTOM', customSupplierName: '供应商', supplierValue: '不应同时存在' },
  ] as const) {
    assert.equal(parsePurchaseOrderCreateContext({
      canCreateStock: false,
      customSupplierName: undefined,
      purchaseType: 'SALES_LINKED',
      salesOrderId: undefined,
      salesOrderNo: undefined,
      supplierValue: undefined,
      ...input,
    }), null)
  }
})

test('销售来源快捷参数只接受销售关联采购的可信单值输入', () => {
  type ShortcutParser = (input: {
    readonly purchaseType: 'SALES_LINKED' | 'STOCK' | null
    readonly salesOrderId: unknown
    readonly salesOrderNo: unknown
  }) => null | { readonly salesOrderId: string, readonly salesOrderNo: string }

  const parseShortcut = Reflect.get(
    purchaseOrderCreateLogic,
    'parsePurchaseOrderSourceShortcut',
  ) as ShortcutParser | undefined

  assert.equal(typeof parseShortcut, 'function', '采购创建逻辑应导出快捷来源参数解析器')
  assert.ok(parseShortcut)
  assert.deepEqual(parseShortcut({
    purchaseType: 'SALES_LINKED',
    salesOrderId: ' 11111111-1111-4111-8111-111111111111 ',
    salesOrderNo: ' ＳＯ／２０２６－００１ ',
  }), {
    salesOrderId: '11111111-1111-4111-8111-111111111111',
    salesOrderNo: 'SO/2026-001',
  })

  for (const input of [
    { purchaseType: 'STOCK', salesOrderId: 'order-id', salesOrderNo: 'SO-001' },
    { purchaseType: null, salesOrderId: 'order-id', salesOrderNo: 'SO-001' },
    { purchaseType: 'SALES_LINKED', salesOrderId: '', salesOrderNo: 'SO-001' },
    { purchaseType: 'SALES_LINKED', salesOrderId: ['order-id'], salesOrderNo: 'SO-001' },
    { purchaseType: 'SALES_LINKED', salesOrderId: 'order-id', salesOrderNo: ['SO-001'] },
    { purchaseType: 'SALES_LINKED', salesOrderId: 'x'.repeat(129), salesOrderNo: 'SO-001' },
    { purchaseType: 'SALES_LINKED', salesOrderId: 'order-id', salesOrderNo: '订'.repeat(129) },
  ] as const) {
    assert.equal(parseShortcut(input), null)
  }
})

test('销售来源只有存在剩余数量时才允许同步', () => {
  assert.equal(hasPurchasablePurchaseOrderSourceLines([]), false)
  assert.equal(hasPurchasablePurchaseOrderSourceLines([{
    ...sourceCatalogLine,
    purchasedQuantity: 3,
    remainingQuantity: 0,
  }]), false)
  assert.equal(hasPurchasablePurchaseOrderSourceLines([{
    ...sourceCatalogLine,
    purchasedQuantity: 2,
    remainingQuantity: 1,
  }]), true)
})

test('销售关联采购字段按基础信息、产品付款、唛头备注归属到前三个填写步骤', () => {
  assert.equal(resolvePurchaseOrderCreateStepForField('orderDate'), 0)
  assert.equal(resolvePurchaseOrderCreateStepForField('supplierValue'), 0)
  assert.equal(resolvePurchaseOrderCreateStepForField('salesOrderId'), 0)
  assert.equal(resolvePurchaseOrderCreateStepForField('lines.0.actualUnitPriceAmount'), 1)
  assert.equal(resolvePurchaseOrderCreateStepForField('depositDueAmount'), 1)
  assert.equal(resolvePurchaseOrderCreateStepForField('balanceDueAmount'), 1)
  assert.equal(resolvePurchaseOrderCreateStepForField('expectedShippingMarkResolution'), 2)
  assert.equal(resolvePurchaseOrderCreateStepForField('parts'), 2)
  assert.equal(resolvePurchaseOrderCreateStepForField('parts.0.items.1.quantity'), 2)
  assert.equal(resolvePurchaseOrderCreateStepForField('remark'), 2)
  assert.equal(resolvePurchaseOrderCreateStepForField('unknown'), null)
  assert.equal(resolvePurchaseOrderCreateStepForErrors({
    balanceDueAmount: '金额错误',
    expectedShippingMarkResolution: '唛头错误',
  }), 1)
})

test('下一步只拦截当前采购填写步骤的领域错误', () => {
  const source = {
    balanceDueAmount: null,
    depositDueAmount: null,
    lines: [],
    parts: [],
    maximumQuantityByKey: {},
    orderDate: '2026-08-28',
    productMode: 'CATALOG',
    purchaseType: 'SALES_LINKED',
    remark: '',
    salesOrderId: null,
    expectedShippingMarkResolution: 'a'.repeat(64),
    sourceSalesOrderLineIdByKey: {},
    supplierValue: '',
    customSupplierName: null,
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

  const packages = validatePurchaseOrderCreateStep(source, 2)
  assert.equal(packages.valid, false)
  if (!packages.valid) {
    assert.ok(packages.fieldErrors.parts)
  }
})

test('采购产品 loader 映射 CNY 采购定价且保持分页身份', () => {
  assert.deepEqual(adaptPurchaseOrderProductPage({
    items: [catalogOption],
    categories: [{ name: '农机', count: 1, productHeads: [{ name: '微耕机', count: 1 }] }],
    unclassifiedCount: 0,
    page: 2,
    pageSize: 20,
    total: 21,
  }), {
    items: [{
      id: catalogOption.id,
      productNo: 'SKU-A',
      name: '采购产品 A',
      categoryName: '农机',
      productHeadName: '微耕机',
      supplierValue: 'SUPPLIER_CN_01',
      attributes: [],
      standardUnitPriceAmount: '12.5000',
      currencyCode: 'CNY',
      mainImage: catalogOption.mainImage,
    }],
    categories: [{ name: '农机', count: 1, productHeads: [{ name: '微耕机', count: 1 }] }],
    unclassifiedCount: 0,
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
      purchasedLines: [{
        ...sourceCatalogLine.purchasedLines[0]!,
        id: '99999999-9999-4999-8999-999999999999',
        description: null,
      }],
    }, {
      ...sourceCatalogLine,
      id: '55555555-5555-4555-8555-555555555555',
      lineNumber: 3,
      lineType: 'CUSTOM',
      productId: null,
      productNo: null,
      productName: '销售临时包装',
      remainingQuantity: 1,
      purchasedLines: [{
        ...sourceCatalogLine.purchasedLines[0]!,
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        referencePurchaseUnitPriceAmount: '8.0000',
        actualPurchaseUnitPriceAmount: '8.0000',
        lineTotalAmount: '8.0000',
        description: '临时产品采购备注',
      }],
    }, {
      ...sourceCatalogLine,
      id: '66666666-6666-4666-8666-666666666666',
      lineNumber: 4,
      purchasedQuantity: 3,
      remainingQuantity: 0,
      purchasedLines: [{
        ...sourceCatalogLine.purchasedLines[0]!,
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      }, {
        ...sourceCatalogLine.purchasedLines[0]!,
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        actualPurchaseUnitPriceAmount: '10.0000',
        quantity: 2,
        lineTotalAmount: '20.0000',
        description: '第二批采购备注',
      }],
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
  assert.deepEqual(result.readOnlyLines.map(line => ({
    actual: line.actualUnitPriceAmount,
    description: line.description,
    key: line.key,
    name: line.name,
    quantity: line.quantity,
    reference: line.standardUnitPriceAmount,
    status: line.statusLabel,
    statusDescription: line.statusDescription,
    subtotal: line.actualSubtotalAmount,
    type: line.lineType,
  })), [{
    actual: '11.0000',
    description: '首批采购备注',
    key: 'purchased-88888888-8888-4888-8888-888888888888',
    name: '采购产品 A',
    quantity: '1',
    reference: '12.5000',
    status: '已采购',
    statusDescription: '该销售订单中的本产品已经存在有效的采购单，已采购数量1件',
    subtotal: '11.0000',
    type: 'CATALOG',
  }, {
    actual: '11.0000',
    description: '',
    key: 'purchased-99999999-9999-4999-8999-999999999999',
    name: '其他供应商产品',
    quantity: '1',
    reference: '12.5000',
    status: '已采购',
    statusDescription: '该销售订单中的本产品已经存在有效的采购单，已采购数量1件',
    subtotal: '11.0000',
    type: 'CATALOG',
  }, {
    actual: '8.0000',
    description: '临时产品采购备注',
    key: 'purchased-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: '销售临时包装',
    quantity: '1',
    reference: '8.0000',
    status: '已采购',
    statusDescription: '该销售订单中的本产品已经存在有效的采购单，已采购数量1件',
    subtotal: '8.0000',
    type: 'CUSTOM',
  }, {
    actual: '11.0000',
    description: '首批采购备注',
    key: 'purchased-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: '采购产品 A',
    quantity: '1',
    reference: '12.5000',
    status: '已采购',
    statusDescription: '该销售订单中的本产品已经存在有效的采购单，已采购数量1件',
    subtotal: '11.0000',
    type: 'CATALOG',
  }, {
    actual: '10.0000',
    description: '第二批采购备注',
    key: 'purchased-cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: '采购产品 A',
    quantity: '2',
    reference: '12.5000',
    status: '已采购',
    statusDescription: '该销售订单中的本产品已经存在有效的采购单，已采购数量2件',
    subtotal: '20.0000',
    type: 'CATALOG',
  }])
})

test('产品库关联采购构造 DTO 时提交互斥供应商来源并校验数量', () => {
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
  const source = {
    balanceDueAmount: '10.00',
    customSupplierName: null,
    depositDueAmount: '10.00',
    lines: [catalogLine],
    parts: [{ key: '33333333-3333-4333-8333-333333333333', items: [{ productKey: catalogLine.key, quantity: 2 }] }],
    maximumQuantityByKey: {
      [catalogLine.key]: 2,
    },
    orderDate: '2026-08-28',
    productMode: 'CATALOG',
    purchaseType: 'SALES_LINKED',
    remark: '  采购说明 ',
    salesOrderId: '77777777-7777-4777-8777-777777777777',
    expectedShippingMarkResolution: 'a'.repeat(64),
    sourceSalesOrderLineIdByKey: {
      [catalogLine.key]: sourceCatalogLine.id,
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
    productMode: 'CATALOG',
    salesOrderId: '77777777-7777-4777-8777-777777777777',
    supplierValue: 'SUPPLIER_CN_01',
    orderDate: '2026-08-28',
    expectedShippingMarkResolution: 'a'.repeat(64),
    lines: [{
      lineType: 'CATALOG',
      productId: catalogOption.id,
      sourceSalesOrderLineId: sourceCatalogLine.id,
      actualPurchaseUnitPriceAmount: '10.00',
      quantity: 2,
    }],
    parts: [{ key: '33333333-3333-4333-8333-333333333333', items: [{ lineNumber: 1, quantity: 2 }] }],
    purchaseTotalAmount: '20.00',
    depositDueAmount: '10.00',
    balanceDueAmount: '10.00',
    remark: '采购说明',
  })

  const invalid = buildPurchaseOrderCreateRequest({
    ...source,
    lines: [{ ...catalogLine, quantity: '3' }],
  })
  assert.equal(invalid.valid, false)
  if (invalid.valid) {
    return
  }
  assert.equal(invalid.fieldErrors['lines.0.quantity'], '采购数量不能超过销售明细剩余可采购数量 2')
})

test('自定义备货采购只提交文本供应商并校验 CUSTOM 双价格', () => {
  const result = buildPurchaseOrderCreateRequest({
    parts: [{ key: '33333333-3333-4333-8333-333333333333', items: [{ productKey: 'stock-custom', quantity: 1 }] }],
    balanceDueAmount: '8.00',
    customSupplierName: ' 临时供应商 ',
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
    productMode: 'CUSTOM',
    paymentAccounts: reactive([{ paymentMethod: 'BANK_TRANSFER' as const, recipientName: '供应商', bankName: '银行', bankAccount: '12345678' }]),
    purchaseType: 'STOCK',
    remark: '',
    salesOrderId: null,
    expectedShippingMarkResolution: 'a'.repeat(64),
    sourceSalesOrderLineIdByKey: {},
    supplierValue: null,
    today: '2026-08-28',
  })

  assert.equal(result.valid, true)
  if (result.valid) {
    assert.equal(result.request.salesOrderId, undefined)
    assert.equal(result.request.productMode, 'CUSTOM')
    assert.equal(result.request.customSupplierName, '临时供应商')
    assert.equal(result.request.supplierValue, undefined)
    assert.equal(result.request.lines[0]?.sourceSalesOrderLineId, undefined)
  }

  const invalid = buildPurchaseOrderCreateRequest({
    balanceDueAmount: '8.01',
    parts: [{ key: '33333333-3333-4333-8333-333333333333', items: [{ productKey: 'stock-custom', quantity: 1 }] }],
    customSupplierName: '临时供应商',
    depositDueAmount: '0.00',
    lines: [{
      actualUnitPriceAmount: '8.01',
      description: '',
      key: 'stock-custom',
      lineType: 'CUSTOM',
      mainImage: null,
      name: '备货临时包装',
      productId: null,
      productNo: null,
      quantity: '1',
      standardUnitPriceAmount: '8.00',
    }],
    maximumQuantityByKey: {},
    orderDate: '2026-08-28',
    productMode: 'CUSTOM',
    paymentAccounts: [{ paymentMethod: 'BANK_TRANSFER', recipientName: '供应商', bankName: '银行', bankAccount: '12345678' }],
    purchaseType: 'STOCK',
    remark: '',
    salesOrderId: null,
    expectedShippingMarkResolution: 'a'.repeat(64),
    sourceSalesOrderLineIdByKey: {},
    supplierValue: null,
    today: '2026-08-28',
  })
  assert.equal(invalid.valid, false)
  if (!invalid.valid) {
    assert.equal(invalid.fieldErrors['lines.0.actualUnitPriceAmount'], '临时产品的采购定价必须与本单采购价相等')
  }
})

test('采购可编辑金额均拒绝超过两位小数，草稿总额与提交金额按分精确计算', () => {
  const line: OrderProductLineModel = {
    key: 'precision-custom',
    lineType: 'CUSTOM',
    productId: null,
    productNo: null,
    name: '精度测试产品',
    description: '',
    standardUnitPriceAmount: '0.1',
    actualUnitPriceAmount: '0.1',
    quantity: '3',
    mainImage: null,
  }
  const source = {
    lines: [line],
    parts: [{ key: '33333333-3333-4333-8333-333333333333', items: [{ productKey: line.key, quantity: 3 }] }],
    balanceDueAmount: '0.2',
    depositDueAmount: '0.1',
    customSupplierName: '精度测试供应商',
    maximumQuantityByKey: {},
    orderDate: '2026-09-16',
    productMode: 'CUSTOM',
    paymentAccounts: [{ paymentMethod: 'BANK_TRANSFER', recipientName: '供应商', bankName: '银行', bankAccount: '12345678' }],
    purchaseType: 'STOCK',
    remark: '',
    salesOrderId: null,
    expectedShippingMarkResolution: 'a'.repeat(64),
    sourceSalesOrderLineIdByKey: {},
    supplierValue: null,
    today: '2026-09-16',
  } as const
  const built = buildPurchaseOrderCreateRequest(source)
  assert.equal(built.valid, true)
  assert.equal(calculatePurchaseOrderDraftTotal(source.lines), '0.30')
  if (built.valid) {
    assert.equal(built.request.purchaseTotalAmount, '0.30')
    assert.equal(built.request.depositDueAmount, '0.10')
    assert.equal(built.request.balanceDueAmount, '0.20')
    assert.equal(built.request.lines[0]?.actualPurchaseUnitPriceAmount, '0.10')
    assert.equal(built.request.lines[0]?.referencePurchaseUnitPriceAmount, '0.10')
  }
  for (const invalidAmount of ['0.001', '0.0001', '1.0000']) {
    for (const field of ['actualUnitPriceAmount', 'standardUnitPriceAmount'] as const) {
      const invalid = buildPurchaseOrderCreateRequest({ ...source, lines: [{ ...line, [field]: invalidAmount }] })
      assert.equal(invalid.valid, false)
      if (!invalid.valid) {
        assert.ok(invalid.fieldErrors[`lines.0.${field}`])
      }
    }
    for (const field of ['depositDueAmount', 'balanceDueAmount'] as const) {
      const invalid = buildPurchaseOrderCreateRequest({ ...source, [field]: invalidAmount })
      assert.equal(invalid.valid, false)
      if (!invalid.valid) {
        assert.ok(invalid.fieldErrors[field])
      }
    }
    assert.equal(calculatePurchaseOrderDraftTotal([{ ...line, actualUnitPriceAmount: invalidAmount }]), null)
  }
  assert.equal(calculatePurchaseOrderDraftTotal([{
    ...line,
    actualUnitPriceAmount: '9007199254740993.01',
    quantity: '2',
  }]), '18014398509481986.02')
})

test('未知创建结果冻结请求并使用原幂等 Key 安全重放', () => {
  const built = buildPurchaseOrderCreateRequest({
    parts: [{ key: '33333333-3333-4333-8333-333333333333', items: [{ productKey: 'stock-custom', quantity: 1 }] }],
    balanceDueAmount: '8.00',
    customSupplierName: '临时供应商',
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
    productMode: 'CUSTOM',
    paymentAccounts: [{ paymentMethod: 'BANK_TRANSFER', recipientName: '供应商', bankName: '银行', bankAccount: '12345678' }],
    purchaseType: 'STOCK',
    remark: '',
    salesOrderId: null,
    expectedShippingMarkResolution: 'a'.repeat(64),
    sourceSalesOrderLineIdByKey: {},
    supplierValue: null,
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
  assert.equal(replay.snapshot.expectedShippingMarkResolution, 'a'.repeat(64))
  assert.equal(Object.isFrozen(replay.snapshot.parts), true)
  assert.equal(Object.isFrozen(replay.snapshot.parts[0]?.items[0]), true)
  assert.deepEqual(replay.snapshot.parts, built.request.parts)
  assert.equal(Object.hasOwn(replay.snapshot, 'shippingMarkText'), false)

  const detail = { id: 'purchase-a' } as PurchaseOrderDetailDto
  assert.deepEqual(resolvePurchaseOrderSubmissionSuccess(replay, detail), {
    phase: 'success',
    purchaseOrder: detail,
  })
})

test('唛头匹配未完成或摘要非法时第三步不能进入核对', () => {
  for (const expectedShippingMarkResolution of [null, '', 'A'.repeat(64), 'a'.repeat(63)]) {
    const result = validatePurchaseOrderCreateStep({
      balanceDueAmount: null,
      customSupplierName: '供应商',
      depositDueAmount: null,
      expectedShippingMarkResolution,
      lines: [],
      parts: [],
      maximumQuantityByKey: {},
      orderDate: '2026-09-07',
      productMode: 'CUSTOM',
      paymentAccounts: [{ paymentMethod: 'BANK_TRANSFER', recipientName: '供应商', bankName: '银行', bankAccount: '12345678' }],
      purchaseType: 'STOCK',
      remark: '',
      salesOrderId: null,
      sourceSalesOrderLineIdByKey: {},
      supplierValue: null,
      today: '2026-09-07',
    }, 2)
    assert.equal(result.valid, false)
    if (!result.valid) {
      assert.equal(result.fieldErrors.expectedShippingMarkResolution, '请先取得可用的采购唛头规则并核对')
      assert.ok(result.fieldErrors.parts)
    }
  }
})

test('唛头上下文变化和不可用均定位第三步，且不属于未知提交', () => {
  for (const code of [
    'PURCHASE_ORDER_SHIPPING_MARK_CONTEXT_CHANGED',
    'PURCHASE_ORDER_SHIPPING_MARK_UNAVAILABLE',
  ]) {
    const failure = getPurchaseOrderMutationFailure({
      kind: 'http',
      status: 409,
      body: { code, message: '唛头规则需要重新核对', requestId: 'request-id' },
    })
    assert.equal(failure.unknownResult, false)
    assert.equal(failure.refreshShippingMarkResolution, true)
    assert.equal(resolvePurchaseOrderCreateStepForErrors(failure.fieldErrors), 2)
  }
})

test('自定义采购基础步骤至少需要一种完整收款资料，错误留在第一步', () => {
  const source: Parameters<typeof buildPurchaseOrderCreateRequest>[0] = {
    balanceDueAmount: null,
    depositDueAmount: null,
    lines: [],
    parts: [],
    maximumQuantityByKey: {},
    orderDate: '2026-09-17',
    productMode: 'CUSTOM',
    purchaseType: 'STOCK',
    remark: '',
    salesOrderId: null,
    expectedShippingMarkResolution: null,
    sourceSalesOrderLineIdByKey: {},
    supplierValue: null,
    customSupplierName: '自定义供应商',
    today: '2026-09-17',
  }
  const missing = validatePurchaseOrderCreateStep(source, 0)
  assert.equal(missing.valid, false)
  if (!missing.valid) {
    assert.ok(missing.fieldErrors.paymentAccounts)
  }
  assert.equal(resolvePurchaseOrderCreateStepForField('paymentAccounts.0.bankName'), 0)
  assert.equal(validatePurchaseOrderCreateStep({ ...source, paymentAccounts: [{ paymentMethod: 'BANK_TRANSFER', recipientName: '收款人', bankName: '银行', bankAccount: '1234' }] }, 0).valid, true)
  assert.equal(validatePurchaseOrderCreateStep({ ...source, paymentAccounts: [{ paymentMethod: 'WECHAT', recipientName: '收款人' }] }, 0).valid, false)
})
