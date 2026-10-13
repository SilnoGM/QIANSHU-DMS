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

test('专用抽屉摘要使用标题字号，详情信息保持紧凑分组且不依赖未定义字体类', async () => {
  const [drawer, information] = await Promise.all([
    readFile(new URL('../../src/components/business/QsSalesOrderDrawer/index.vue', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/business/QsSalesOrderDrawer/OrderInformation.vue', import.meta.url), 'utf8'),
  ])
  // 标题和表格数据的字体角色不能混用，否则表格的 14px 规则会压过标题字号。
  assert.match(drawer, /<h2[^>]*class="[^"]*qs-type-page-title/u)
  assert.doesNotMatch(information, /font-qs-data-mono/u)
  assert.match(information, /data-slot="sales-order-drawer-basic"/u)
  assert.match(information, /data-slot="sales-order-drawer-customer"/u)
  assert.match(information, /line\.actualUnitPriceAmount/u)
  assert.match(information, /line\.lineTotalAmount/u)
  assert.doesNotMatch(information, /standardUnitPriceAmount/u)
})

test('切换页签只重置抽屉正文滚动，避免进入变更记录时停留在半页', async () => {
  const drawer = await readFile(new URL('../../src/components/business/QsSalesOrderDrawer/index.vue', import.meta.url), 'utf8')
  assert.match(drawer, /watch\(activeTab/u)
  assert.match(drawer, /drawerBody\.value\?\.parentElement\?\.scrollTo\(\{ top: 0 \}\)/u)
  assert.doesNotMatch(drawer, /window\.scrollTo/u)
})

test('收款展开区的时间和备注独占一行，凭证备注与上传信息有独立标签', async () => {
  const [records, document] = await Promise.all([
    readFile(new URL('../../src/components/business/QsSalesOrderDrawer/OrderRecords.vue', import.meta.url), 'utf8'),
    readFile(new URL('../../src/components/business/QsSalesOrderDrawer/OrderDocument.vue', import.meta.url), 'utf8'),
  ])
  // 长时间和多行备注不能继续与其他字段争用半行，也不能混淆收款与凭证各自的备注。
  assert.match(records, /data-slot="payment-recorded-at"[^>]*sm:col-span-2/u)
  assert.match(records, /data-slot="payment-remark"[^>]*sm:col-span-2/u)
  assert.match(records, /salesOrderDrawer\.paymentRemark/u)
  assert.match(document, /salesOrderDrawer\.documentRemark/u)
  assert.match(document, /salesOrderDrawer\.uploadedAt/u)
  assert.match(document, /data-slot="order-document-metadata"/u)
  assert.match(document, /<ImageGroup[^>]*:items="images"/u)
  assert.match(document, /v-if="document\.detachedAt"/u)
})

test('两类摘要缩略图随展开状态移除，过渡仅使用透明度和变换且支持减少动态效果', async () => {
  const records = await readFile(new URL('../../src/components/business/QsSalesOrderDrawer/OrderRecords.vue', import.meta.url), 'utf8')
  assert.equal((records.match(/<TransitionGroup name="record-summary"/gu) ?? []).length, 2)
  assert.equal((records.match(/v-if="!open" key="thumbnail"/gu) ?? []).length, 2)
  assert.match(records, /\.record-summary-leave-active\s*\{[^}]*position: absolute/u)
  assert.match(records, /180ms/u)
  assert.match(records, /prefers-reduced-motion: reduce/u)
  assert.match(records, /transition: none/u)
  assert.doesNotMatch(records, /transition:[^;]*(?:width|height|margin|padding)/u)
  // 大图和单展开逻辑仍使用原组件，图片隐藏不能改变收款或凭证的关联。
  // 收款凭证对代收回填为空：无凭证时走「凭证见结算记录」说明，不挂 OrderDocument。
  assert.match(records, /<OrderDocument v-if="payment\.voucher" :document="payment\.voucher"/u)
  assert.match(records, /<OrderDocument :document="document"/u)
  assert.match(records, /salesOrderDrawer\.noPaymentVoucher/u)
})

test('销售详情抽屉按需读取详情并使用 QsSalesOrderDrawer 展示', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /<QsSalesOrderDrawer/u)
  assert.match(source, /salesOrdersApi\.getById/u)
  assert.doesNotMatch(source, /QsSalesOrderDesc/u)
  assert.match(source, /:detail="detail"/u)
  assert.match(source, /:order="order"/u)
  assert.match(source, /:loading="loading"/u)
  assert.match(source, /:error="loadError"/u)
  assert.match(source, /@reload="loadDetail"/u)
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

  const model = mapSalesOrderDetailToDesc(detail, [{
    lineId: 'line-id',
    mainImage: {
      contentUrl: '/api/sales-orders/sales-order-id/lines/line-id/main-image/media-id/content',
      id: 'media-id',
    },
    productName: '测试产品',
  }])

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
    mainImage: {
      alt: '测试产品',
      src: '/api/sales-orders/sales-order-id/lines/line-id/main-image/media-id/content',
    },
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
