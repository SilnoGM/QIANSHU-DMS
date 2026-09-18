import type { PurchaseShipmentDetailDto } from '../../src/api/generated/types.gen'
import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 货件详情快照映射使用 Node.js 内置 runner。
import test from 'node:test'
import {
  buildShipmentDetailProducts,
  getShipmentMarkEmptyKey,
  getShipmentSourceEmptyKey,
} from '../../src/views/workbenches/shipments/shipment-detail.logic'

type ShipmentItem = PurchaseShipmentDetailDto['items'][number]

function item(overrides: Partial<ShipmentItem> = {}): ShipmentItem {
  return {
    purchaseOrderLineId: 'line-1',
    lineNumber: 1,
    lineType: 'CATALOG',
    productId: 'product-1',
    productNo: 'PROD/00001',
    productName: '测试产品',
    productAttributes: [{ title: '颜色', value: '黑色' }],
    description: '本货件说明',
    quantity: 3,
    mainImage: { id: 'media-1', contentUrl: '/api/media-assets/media-1/content' },
    ...overrides,
  }
}

test('货件产品按行号展示，保留本货件数量与历史快照，不修改响应', () => {
  const items = [item({ lineNumber: 2, purchaseOrderLineId: 'line-2', quantity: 7 }), item()]
  const before = structuredClone(items)
  const products = buildShipmentDetailProducts(items)
  assert.deepEqual(products.map(product => [product.purchaseOrderLineId, product.quantity]), [['line-1', 3], ['line-2', 7]])
  assert.equal(products[0]?.productName, '测试产品')
  assert.equal(products[0]?.description, '本货件说明')
  assert.deepEqual(products[0]?.images, [{ key: 'line-1', src: '/api/media-assets/media-1/content', alt: '测试产品' }])
  assert.deepEqual(products[0]?.attributes, [{ title: '颜色', value: '黑色' }])
  assert.deepEqual(items, before)
})

test('无图临时产品保留名称和分配数量，不制造图片或产品编号', () => {
  const [product] = buildShipmentDetailProducts([item({ productId: null, productNo: null, productName: '临时产品', mainImage: null, quantity: 2 })])
  assert.deepEqual(product?.images, [])
  assert.equal(product?.productNo, null)
  assert.equal(product?.productName, '临时产品')
  assert.equal(product?.quantity, 2)
  assert.deepEqual(buildShipmentDetailProducts([]), [])
})

test('产品属性兼容历史标量值，零值不当成空值，空白或异常记录不显示为对象字符串', () => {
  const [product] = buildShipmentDetailProducts([item({ productAttributes: [
    { title: ' 功率 ', value: ' 20 kW ' },
    { title: '偏差', value: 0 },
    { title: '开关', value: false },
    { title: '', value: '丢弃' },
    { title: '空值', value: null },
    { title: '异常', value: { value: '嵌套对象' } },
  ] })])
  assert.deepEqual(product?.attributes, [{ title: '功率', value: '20 kW' }, { title: '偏差', value: '0' }, { title: '开关', value: 'false' }])
})

test('唛头空态区分待审核和历史缺失，取消记录不显示待审核生成', () => {
  assert.equal(getShipmentMarkEmptyKey('PENDING_REVIEW'), 'purchaseShipmentDetail.pendingMark')
  assert.equal(getShipmentMarkEmptyKey('ACTIVE'), 'purchaseShipmentDetail.markNotRecorded')
  assert.equal(getShipmentMarkEmptyKey('CANCELLED'), 'purchaseShipmentDetail.markNotRecorded')
})

test('销售来源缺失时仅备货采购显示备货说明，关联采购不伪装为备货', () => {
  assert.equal(getShipmentSourceEmptyKey('STOCK'), 'purchaseShipmentDetail.stockSource')
  assert.equal(getShipmentSourceEmptyKey('SALES_LINKED'), 'purchaseShipmentDetail.sourceNotRecorded')
})
