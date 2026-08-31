import type { SalesOrderDetailDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 销售详情抽屉结构与映射契约使用 Node.js 内置 runner。
import test from 'node:test'

import { mapSalesOrderDetailToDesc } from '../../src/views/operations/sales-orders/sales-order-desc.logic'

const SOURCE = new URL(
  '../../src/views/operations/sales-orders/sales-order-detail-drawer.vue',
  import.meta.url,
)

test('销售详情抽屉按需读取详情并使用 QsSalesOrderDesc 展示', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /<QsGenericDrawer/u)
  assert.match(source, /salesOrdersApi\.getById/u)
  assert.match(source, /<QsSalesOrderDesc/u)
  assert.match(source, /mapSalesOrderDetailToDesc/u)
  assert.match(source, /:loading="loading"/u)
  assert.match(source, /:error="loadError"/u)
  assert.match(source, /@click="loadDetail"/u)
  assert.match(source, /detailAbortController\?\.abort\(\)/u)
  assert.match(source, /detail\.value = null/u)
  assert.match(source, /drawerVisible\.value = false/u)
})

test('销售详情 DTO 映射为独立只读详情模型并忽略已解除附件', () => {
  const detail = {
    amountRevisions: [],
    amounts: {
      agreedTotalAmount: '180000.0000',
      balanceDueAmount: '130000.0000',
      depositDueAmount: '50000.0000',
      lineSubtotalAmount: '180000.0000',
      outstandingAmount: '180000.0000',
      receivedAmount: '0.0000',
    },
    createdAt: '2026-08-31T01:00:00.000Z',
    currencyCode: 'TWD',
    customer: {
      addressDetail: '测试路 1 号',
      city: { code: 'CITY', id: 'city-id', name: '测试市' },
      countryRegion: { code: 'COUNTRY', id: 'country-id', name: '测试国家' },
      fullAddress: '测试国家 测试省 测试市 测试路 1 号',
      name: '测试客户',
      phone: '0912345678',
      provinceState: { code: 'STATE', id: 'state-id', name: '测试省' },
    },
    documents: [{
      contentUrl: '/api/media/active',
      createdAt: '2026-08-31T01:00:00.000Z',
      createdBy: { displayName: '超级管理员', id: 'user-id' },
      detachedAt: null,
      detachedBy: null,
      documentType: 'ORDER_ISSUANCE_VOUCHER',
      id: 'document-active',
      mediaAssetId: 'media-active',
      mediaType: 'IMAGE',
      mimeType: 'image/png',
      originalFilename: 'voucher.png',
      paymentId: null,
      remark: null,
      sizeBytes: '1024',
      title: '出单凭证',
    }, {
      contentUrl: '/api/media/detached',
      createdAt: '2026-08-31T01:00:00.000Z',
      createdBy: { displayName: '超级管理员', id: 'user-id' },
      detachedAt: '2026-08-31T02:00:00.000Z',
      detachedBy: { displayName: '超级管理员', id: 'user-id' },
      documentType: 'DELIVERY_RECEIPT',
      id: 'document-detached',
      mediaAssetId: 'media-detached',
      mediaType: 'DOCUMENT',
      mimeType: 'application/pdf',
      originalFilename: 'detached.pdf',
      paymentId: null,
      remark: null,
      sizeBytes: '2048',
      title: null,
    }],
    fulfillmentStatus: 'PENDING',
    id: 'sales-order-id',
    issuer: { displayName: '超级管理员', id: 'user-id' },
    lines: [{
      actualUnitPriceAmount: '90000.0000',
      description: '备注内容',
      id: 'line-id',
      lineNumber: 1,
      lineTotalAmount: '180000.0000',
      lineType: 'CATALOG',
      productAttributes: [],
      productId: 'product-id',
      productName: '测试产品',
      productNo: 'PROD/00001',
      quantity: 2,
      standardUnitPriceAmount: '100000.0000',
    }],
    orderDate: '2026-08-31',
    orderNo: 'SO/20260831-00001',
    orderStatus: 'CONFIRMED',
    paymentStatus: 'UNPAID',
    payments: [],
    remark: null,
    statusHistory: [],
    updatedAt: '2026-08-31T01:00:00.000Z',
    version: 1,
  } satisfies SalesOrderDetailDto

  const model = mapSalesOrderDetailToDesc(detail)

  assert.deepEqual(model.amounts, {
    agreedTotalAmount: '180000.0000',
    balanceDueAmount: '130000.0000',
    depositDueAmount: '50000.0000',
    lineSubtotalAmount: '180000.0000',
  })
  assert.deepEqual(model.customer.regionNames, ['测试国家', '测试省', '测试市'])
  assert.equal(model.issuerName, '超级管理员')
  assert.deepEqual(model.lines[0], {
    actualUnitPriceAmount: '90000.0000',
    description: '备注内容',
    key: 'line-id',
    lineSubtotalAmount: '180000.0000',
    lineType: 'CATALOG',
    mainImage: null,
    productName: '测试产品',
    productNo: 'PROD/00001',
    quantity: '2',
  })
  assert.deepEqual(model.documents, [{
    documentType: 'ORDER_ISSUANCE_VOUCHER',
    key: 'document-active',
    mediaType: 'IMAGE',
    originalFilename: 'voucher.png',
    previewSrc: '/api/media/active',
    thumbnailSrc: '/api/media/active',
    title: '出单凭证',
  }])
})
