import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 销售订单展示模型 mapper 使用 Node.js 内置 runner。
import test from 'node:test'

import { mapSalesOrderCreateFormToDesc } from '../../src/views/operations/sales-orders/sales-order-create-view.logic'
import {
  createCatalogSalesOrderLine,
  createCustomSalesOrderLine,
  createSalesOrderFormModel,
} from '../../src/views/operations/sales-orders/sales-order-create.logic'

test('创建表单映射为独立订单详情模型并按行计算小计', () => {
  const model = createSalesOrderFormModel('TWD')
  model.orderDate = '2026-08-21'
  model.customerName = ' 林晓芳 '
  model.customerPhone = ' +886 912 345 678 '
  model.regionNames = ['中国台湾', '台湾', '高雄市']
  model.addressDetail = '苓雅区中正一路100号3楼'
  model.lines = [
    {
      ...createCatalogSalesOrderLine('line-catalog'),
      actualUnitPriceAmount: '12.34',
      description: ' 展示说明 ',
      mainImage: {
        contentUrl: '/api/product-media/catalog-main/content',
        id: '33333333-3333-4333-8333-333333333333',
      },
      name: ' 标准组合柜 ',
      productId: '11111111-1111-4111-8111-111111111111',
      productNo: ' PRD-001 ',
      quantity: '2',
      standardUnitPriceAmount: '15.00',
    },
    {
      ...createCustomSalesOrderLine('line-custom'),
      actualUnitPriceAmount: '5',
      description: ' 上门安装与调试 ',
      name: ' 订单安装服务 ',
      quantity: '3',
    },
  ]
  model.agreedTotalAmount = '39.68'
  model.depositDueAmount = '10'
  model.balanceDueAmount = '29.68'
  model.issuanceVoucher = {
    autoTitleTimestamp: '20260821153045123',
    key: 'document-image',
    mediaAssetId: '22222222-2222-4222-8222-222222222222',
    mediaType: 'IMAGE',
    mimeType: 'image/png',
    originalFilename: 'issuance.png',
    sizeBytes: '128',
    title: ' 林晓芳-出单凭证-20260821153045123 ',
  }
  const originalModel = structuredClone(model)
  const documentPreviewByKey = new Map([
    ['document-image', 'blob:https://example.test/image-preview'],
  ])

  const result = mapSalesOrderCreateFormToDesc(model, {
    amountPrecision: 2,
    documentPreviewByKey,
    fullAddress: '中国台湾台湾高雄市苓雅区中正一路100号3楼',
    issuerName: ' SilnoGM ',
    lineSubtotalAmount: '39.68',
  })

  assert.deepEqual(result, {
    amounts: {
      agreedTotalAmount: '39.68',
      balanceDueAmount: '29.68',
      depositDueAmount: '10',
      lineSubtotalAmount: '39.68',
    },
    currencyCode: 'TWD',
    customer: {
      fullAddress: '中国台湾台湾高雄市苓雅区中正一路100号3楼',
      name: '林晓芳',
      phone: '+886 912 345 678',
      regionNames: ['中国台湾', '台湾', '高雄市'],
    },
    documents: [
      {
        documentType: 'ORDER_ISSUANCE_VOUCHER',
        key: 'document-image',
        mediaType: 'IMAGE',
        originalFilename: 'issuance.png',
        previewSrc: 'blob:https://example.test/image-preview',
        thumbnailSrc: 'blob:https://example.test/image-preview',
        title: '林晓芳-出单凭证-20260821153045123',
      },
    ],
    issuerName: 'SilnoGM',
    lines: [
      {
        actualUnitPriceAmount: '12.34',
        description: '展示说明',
        key: 'line-catalog',
        lineSubtotalAmount: '24.68',
        lineType: 'CATALOG',
        mainImage: {
          alt: '标准组合柜',
          src: '/api/product-media/catalog-main/content',
        },
        productName: '标准组合柜',
        productNo: 'PRD-001',
        quantity: '2',
      },
      {
        actualUnitPriceAmount: '5',
        description: '上门安装与调试',
        key: 'line-custom',
        lineSubtotalAmount: '15.00',
        lineType: 'CUSTOM',
        mainImage: null,
        productName: '订单安装服务',
        productNo: null,
        quantity: '3',
      },
    ],
    orderDate: '2026-08-21',
    orderNo: null,
  })
  assert.deepEqual(model, originalModel)
  assert.deepEqual([...documentPreviewByKey], [
    ['document-image', 'blob:https://example.test/image-preview'],
  ])
  assert.notEqual(result.customer.regionNames, model.regionNames)
})

test('空白表单映射为稳定空态且不伪造产品行或小计', () => {
  const model = createSalesOrderFormModel('MYR')
  model.orderDate = '   '
  model.regionNames = [' ', '马来西亚']

  const result = mapSalesOrderCreateFormToDesc(model, {
    amountPrecision: 2,
    documentPreviewByKey: new Map(),
    fullAddress: '   ',
    issuerName: '   ',
    lineSubtotalAmount: null,
  })

  assert.deepEqual(result, {
    amounts: {
      agreedTotalAmount: null,
      balanceDueAmount: null,
      depositDueAmount: null,
      lineSubtotalAmount: null,
    },
    currencyCode: 'MYR',
    customer: {
      fullAddress: null,
      name: null,
      phone: null,
      regionNames: ['马来西亚'],
    },
    documents: [],
    issuerName: null,
    lines: [],
    orderDate: null,
    orderNo: null,
  })
})
