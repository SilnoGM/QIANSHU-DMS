import type { PurchaseOrderDetailDto } from '../../src/api/generated/types.gen'
import type { OrderProductLineModel } from '../../src/components/business/QsOrderProductLineEditor/types'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 采购订单详情 ViewModel 映射使用 Node.js 内置 runner。
import test from 'node:test'

import {
  mapPurchaseOrderCreateToDesc,
  mapPurchaseOrderDetailToDesc,
  resolvePurchaseOrderIssuerLabel,
} from '../../src/views/operations/purchase-orders/purchase-order-desc.logic'

const draftLine: OrderProductLineModel = {
  actualUnitPriceAmount: '10.00',
  description: '采购行说明',
  key: 'draft-line-1',
  lineType: 'CATALOG',
  mainImage: {
    contentUrl: '/api/purchase-orders/product-options/product-1/main-image/media-1/content',
    id: 'media-1',
  },
  name: ' 标准采购产品 ',
  productId: 'product-1',
  productNo: ' PROD-001 ',
  quantity: '2',
  standardUnitPriceAmount: '12.50',
}

function createDetail(
  patch: Partial<PurchaseOrderDetailDto> = {},
): PurchaseOrderDetailDto {
  return {
    amounts: {
      balanceDueAmount: '80.0000',
      depositDueAmount: '20.0000',
      lineSubtotalAmount: '100.0000',
      outstandingAmount: '70.0000',
      paidAmount: '30.0000',
      purchaseTotalAmount: '100.0000',
    },
    balanceDueAmount: '80.0000',
    createdAt: '2026-08-28T01:00:00.000Z',
    createdBy: { displayName: '采购员', id: 'actor-1' },
    currencyCode: 'CNY',
    customerName: '客户甲',
    depositDueAmount: '20.0000',
    documents: [],
    fulfillmentStatus: 'PREPARING',
    id: 'purchase-order-1',
    lines: [{
      actualPurchaseUnitPriceAmount: '10.0000',
      description: '正式采购行说明',
      id: 'line-1',
      lineNumber: 1,
      lineTotalAmount: '100.0000',
      lineType: 'CATALOG',
      productAttributes: [],
      productId: 'product-1',
      productName: '标准采购产品',
      productNo: 'PROD-001',
      quantity: 10,
      referencePurchaseUnitPriceAmount: '12.5000',
      sourceSalesOrderLineId: 'sales-line-1',
    }],
    orderDate: '2026-08-28',
    orderNo: 'PO/20260828-00001',
    orderStatus: 'CONFIRMED',
    outstandingAmount: '70.0000',
    paidAmount: '30.0000',
    paymentStatus: 'PARTIALLY_PAID',
    payments: [],
    purchaseTotalAmount: '100.0000',
    purchaseType: 'SALES_LINKED',
    remark: '采购备注',
    salesOrderNo: 'SO/20260827-00008',
    shippingMarkText: '采购唛头',
    sourceSalesOrder: {
      customerName: '客户甲',
      id: 'sales-order-1',
      orderNo: 'SO/20260827-00008',
    },
    statusHistory: [],
    supplier: {
      effectiveEnabled: true,
      known: true,
      label: '供应商甲',
      tone: 'green',
      value: 'SUPPLIER_A',
    },
    updatedAt: '2026-08-28T02:00:00.000Z',
    version: 1,
    ...patch,
  }
}

test('采购创建草稿映射为独立详情模型并保留产品主图', () => {
  const result = mapPurchaseOrderCreateToDesc({
    balanceDueAmount: '20.00',
    depositDueAmount: '0.00',
    issuerName: ' SilnoGM ',
    lines: [draftLine],
    orderDate: '2026-08-28',
    purchaseTotalAmount: '20.00',
    purchaseType: 'SALES_LINKED',
    remark: ' 采购备注 ',
    salesOrder: {
      customerName: '客户甲',
      id: 'sales-order-1',
      orderDate: '2026-08-27',
      orderNo: 'SO/20260827-00008',
      salesTotalAmount: '120.00',
    },
    shippingMarkText: ' 采购唛头 ',
    supplierLabel: ' 供应商甲 ',
  })

  assert.deepEqual(result.amounts, {
    balanceDueAmount: '20.00',
    depositDueAmount: '0.00',
    lineSubtotalAmount: '20.00',
    outstandingAmount: null,
    paidAmount: null,
    purchaseTotalAmount: '20.00',
  })
  assert.deepEqual(result.lines[0], {
    actualPurchaseUnitPriceAmount: '10.00',
    description: '采购行说明',
    key: 'draft-line-1',
    lineSubtotalAmount: '20.00',
    lineType: 'CATALOG',
    mainImage: {
      alt: '标准采购产品',
      src: '/api/purchase-orders/product-options/product-1/main-image/media-1/content',
    },
    productName: '标准采购产品',
    productNo: 'PROD-001',
    quantity: '2',
    referencePurchaseUnitPriceAmount: '12.50',
  })
  assert.deepEqual(result.source, {
    customerName: '客户甲',
    salesOrderNo: 'SO/20260827-00008',
  })
  assert.deepEqual(result.statuses, [
    { key: 'ORDER', label: '订单状态', tone: 'warning', value: '采购审核中' },
    { key: 'FULFILLMENT', label: '履约状态', tone: 'info', value: '已下单' },
    { key: 'PAYMENT', label: '付款状态', tone: 'danger', value: '未付款' },
  ])
  assert.equal(result.orderNo, null)
  assert.equal(result.purchaseTypeLabel, '销售关联采购')
})

test('正式采购详情映射状态、付款进度和采购语义产品字段', () => {
  const result = mapPurchaseOrderDetailToDesc(createDetail(), [{
    lineId: 'line-1',
    mainImage: {
      contentUrl: '/api/purchase-orders/purchase-order-1/lines/line-1/main-image/media-1/content',
      id: 'media-1',
    },
    productName: '标准采购产品',
  }])

  assert.equal(result.orderNo, 'PO/20260828-00001')
  assert.equal(result.supplierLabel, '供应商甲')
  assert.equal(result.amounts.paidAmount, '30.0000')
  assert.equal(result.amounts.outstandingAmount, '70.0000')
  assert.equal(result.lines[0]?.referencePurchaseUnitPriceAmount, '12.5000')
  assert.equal(result.lines[0]?.actualPurchaseUnitPriceAmount, '10.0000')
  assert.deepEqual(result.lines[0]?.mainImage, {
    alt: '标准采购产品',
    src: '/api/purchase-orders/purchase-order-1/lines/line-1/main-image/media-1/content',
  })
  assert.deepEqual(result.statuses, [
    { key: 'ORDER', label: '订单状态', tone: 'success', value: '已确认' },
    { key: 'FULFILLMENT', label: '履约状态', tone: 'warning', value: '备货中' },
    { key: 'PAYMENT', label: '付款状态', tone: 'warning', value: '部分付款' },
  ])
  assert.equal(result.createdAt, '2026-08-28T01:00:00.000Z')
  assert.equal(result.updatedAt, '2026-08-28T02:00:00.000Z')
})

test('采购创建预览按零实付与当前总价派生付款状态，空值和非法金额不当作零', () => {
  for (const [purchaseTotalAmount, expectedValue, expectedTone] of [
    ['0', '已付清', 'success'],
    ['0.00', '已付清', 'success'],
    ['0.0000', '已付清', 'success'],
    ['20.00', '未付款', 'danger'],
    ['0.0001', '未付款', 'danger'],
    [null, '未付款', 'danger'],
    ['invalid', '未付款', 'danger'],
  ] as const) {
    const result = mapPurchaseOrderCreateToDesc({
      balanceDueAmount: purchaseTotalAmount,
      depositDueAmount: '0.00',
      issuerName: '采购员',
      lines: [],
      orderDate: '2026-09-07',
      purchaseTotalAmount,
      purchaseType: 'STOCK',
      remark: '',
      salesOrder: null,
      shippingMarkText: '',
      supplierLabel: '供应商',
    })
    assert.deepEqual(result.statuses.find(status => status.key === 'PAYMENT'), {
      key: 'PAYMENT',
      label: '付款状态',
      tone: expectedTone,
      value: expectedValue,
    }, `总价 ${purchaseTotalAmount}`)
  }
})

test('已完成采购详情使用成功语义展示订单状态', () => {
  const result = mapPurchaseOrderDetailToDesc(createDetail({
    fulfillmentStatus: 'SIGNED',
    orderStatus: 'COMPLETED',
    paymentStatus: 'PAID',
  }))

  assert.deepEqual(result.statuses[0], {
    key: 'ORDER',
    label: '订单状态',
    tone: 'success',
    value: '已完成',
  })
})

test('采购经办人名称优先显示名并回退账号', () => {
  assert.equal(resolvePurchaseOrderIssuerLabel(' SilnoGM ', 'silnogm'), 'SilnoGM')
  assert.equal(resolvePurchaseOrderIssuerLabel(' ', ' silnogm '), 'silnogm')
  assert.equal(resolvePurchaseOrderIssuerLabel(' ', ' '), '当前用户资料不可用')
})
