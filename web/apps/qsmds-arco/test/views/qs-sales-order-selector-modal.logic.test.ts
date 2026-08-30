import type { SalesOrderSelectorItem } from '../../src/components/business/QsSalesOrderSelectorModal/types'
import assert from 'node:assert/strict'

// eslint-disable-next-line test/no-import-node-test -- 组件纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'
import {
  buildSalesOrderProductImageItems,
  filterEligibleSalesOrders,
  filterSalesOrderProductsWithoutImage,
  formatSalesOrderLineCount,
  formatSalesOrderQuantity,
  getSalesOrderFulfillmentStatusMeta,
  getSalesOrderPaymentStatusMeta,
  normalizeSalesOrderSelectorKeyword,
  resolveSalesOrderProductPreview,
  resolveSalesOrderSelection,
  resolveSelectorPagination,
} from '../../src/components/business/QsSalesOrderSelectorModal/logic'

function order(
  id: string,
  orderStatus: SalesOrderSelectorItem['orderStatus'] = 'CONFIRMED',
): SalesOrderSelectorItem {
  return {
    id,
    orderNo: `SO-${id}`,
    orderDate: '2026-08-30',
    issuer: {
      id: `issuer-${id}`,
      displayName: '余树',
    },
    customerName: `客户 ${id}`,
    orderStatus,
    fulfillmentStatus: 'PREPARING',
    paymentStatus: 'PARTIALLY_PAID',
    lineSummary: {
      lineCount: 2,
      previews: [
        {
          lineId: `line-${id}`,
          productName: `产品 ${id}`,
          mainImage: null,
        },
      ],
      totalQuantity: 3,
    },
  }
}

test('选择器只保留已确认销售订单并拒绝解析非候选订单', () => {
  const items = [
    order('confirmed'),
    order('draft', 'DRAFT'),
    order('reconciliation', 'PENDING_RECONCILIATION'),
    order('completed', 'COMPLETED'),
    order('cancelled', 'CANCELLED'),
  ]

  assert.deepEqual(
    filterEligibleSalesOrders(items).map(item => item.id),
    ['confirmed'],
  )
  assert.equal(resolveSalesOrderSelection(items, 'confirmed')?.id, 'confirmed')
  assert.equal(resolveSalesOrderSelection(items, 'cancelled'), null)
  assert.equal(resolveSalesOrderSelection(items, null), null)
})

test('搜索词使用 NFKC 归一化并清理首尾空白', () => {
  assert.equal(normalizeSalesOrderSelectorKeyword('  ＳＯ／０００１  '), 'SO/0001')
  assert.equal(normalizeSalesOrderSelectorKeyword('   '), '')
})

test('分页对异常输入进行约束并生成稳定区间', () => {
  assert.deepEqual(resolveSelectorPagination({
    page: 9,
    pageSize: 20,
    total: 108,
  }), {
    page: 6,
    pageCount: 6,
    pageSize: 20,
    rangeEnd: 108,
    rangeStart: 101,
    total: 108,
  })
  assert.deepEqual(resolveSelectorPagination({
    page: -2,
    pageSize: 0,
    total: -1,
  }), {
    page: 1,
    pageCount: 1,
    pageSize: 20,
    rangeEnd: 0,
    rangeStart: 0,
    total: 0,
  })
})

test('产品预览按稳定行号映射图片，并识别无主图产品', () => {
  const previews: SalesOrderSelectorItem['lineSummary']['previews'] = [
    {
      lineId: 'line-catalog',
      productName: '千树标准组合柜',
      mainImage: {
        id: 'image-catalog',
        contentUrl: ' /api/products/catalog-main/content ',
      },
    },
    {
      lineId: 'line-custom',
      productName: '本单临时包装服务',
      mainImage: null,
    },
    {
      lineId: 'line-empty-url',
      productName: '无有效主图产品',
      mainImage: {
        id: 'image-empty-url',
        contentUrl: '   ',
      },
    },
  ]

  const images = buildSalesOrderProductImageItems(previews)
  assert.deepEqual(images, [
    {
      alt: '千树标准组合柜',
      key: 'line-catalog',
      src: '/api/products/catalog-main/content',
      tooltip: '千树标准组合柜',
    },
  ])
  assert.deepEqual(
    filterSalesOrderProductsWithoutImage(previews).map(item => item.lineId),
    ['line-custom', 'line-empty-url'],
  )
  assert.equal(resolveSalesOrderProductPreview(previews, images[0])?.lineId, 'line-catalog')
  assert.equal(resolveSalesOrderProductPreview(previews, { src: '/missing' }), null)
})

test('产品汇总和销售状态使用稳定中文语义', () => {
  assert.equal(formatSalesOrderLineCount(2), '2 项产品')
  assert.equal(formatSalesOrderQuantity(3), '共 3 件')
  assert.equal(getSalesOrderFulfillmentStatusMeta('PENDING').label, '待采购')
  assert.equal(getSalesOrderFulfillmentStatusMeta('SIGNED').label, '已签收')
  assert.equal(getSalesOrderPaymentStatusMeta('UNPAID').label, '未付款')
  assert.equal(getSalesOrderPaymentStatusMeta('PAID').label, '已付清')
})
