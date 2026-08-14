import type { ProductPageDto } from '../../src/api/generated/types.gen'
import type { DictionaryCatalog } from '../../src/dictionary-catalog/types'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 产品列表纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  adaptProductPageDto,
  applyProductSupplierFilter,
  buildProductImageItems,
  buildProductListQuery,
  buildProductMainImageItems,
  buildSupplierFilterOptions,
  canApplyProductListResponse,
  isProductListAbortError,
  resolveProductMediaContentUrl,
} from '../../src/views/admin/product-management/list/product-list.logic'

const mainImage = {
  id: 'media-image-main',
  kind: 'IMAGE' as const,
  originalFilename: 'main.webp',
  mimeType: 'image/webp',
  sizeBytes: '1024',
  width: 1200,
  height: 1200,
  durationMs: null,
  sortOrder: 0,
  isPrimary: true,
  contentUrl: '/api/products/product-1/media/media-image-main/content',
  createdAt: '2026-08-12T04:00:00.000Z',
}

const secondaryImage = {
  ...mainImage,
  id: 'media-image-secondary',
  originalFilename: 'detail.webp',
  sortOrder: 1,
  isPrimary: false,
  contentUrl: '/api/products/product-1/media/media-image-secondary/content',
}

const video = {
  ...mainImage,
  id: 'media-video-1',
  kind: 'VIDEO' as const,
  originalFilename: 'overview.mp4',
  mimeType: 'video/mp4',
  sizeBytes: '4096',
  width: 1920,
  height: 1080,
  durationMs: 30_000,
  isPrimary: false,
  contentUrl: '/api/products/product-1/media/media-video-1/content',
}

const productPageDto = {
  items: [{
    id: 'product-1',
    name: '便携收纳包',
    productNo: 'PRODUCT-0001',
    status: 'ACTIVE',
    supplier: {
      value: 'supplier-a',
      label: null,
      tone: null,
      state: 'UNKNOWN',
    },
    media: {
      mainImage,
      images: [mainImage, secondaryImage],
      videos: [video],
    },
    twdSalePrice: { amount: '12345678901234567890.1234', currency: 'TWD' },
    myrSalePrice: { amount: null, currency: 'MYR' },
    purchaseCost: { amount: '10.5', currency: 'CNY' },
    attributes: [
      { title: '颜色', value: '墨黑' },
      { title: '尺寸', value: 'XL' },
    ],
    createdBy: null,
    updatedBy: { id: 'user-1', displayName: '运营人员' },
    version: 1,
    createdAt: '2026-08-10T04:00:00.000Z',
    updatedAt: '2026-08-12T04:00:00.000Z',
  }],
  page: 2,
  pageSize: 50,
  total: 51,
} as unknown as ProductPageDto

test('查询归一化分页并原样保留供应商 stable value', () => {
  assert.deepEqual(buildProductListQuery({
    filters: { supplierValue: ' raw-supplier ' },
    page: 2,
    pageSize: 50,
    search: '  Product-001  ',
  }), {
    keyword: 'Product-001',
    page: 2,
    pageSize: 50,
    supplierValue: ' raw-supplier ',
  })
  assert.deepEqual(buildProductListQuery({
    filters: { supplierValue: '   ' },
    page: 0,
    pageSize: 200,
    search: '   ',
  }), { page: 1, pageSize: 20 })

  assert.deepEqual(applyProductSupplierFilter(
    { supplierValue: 'supplier-a' },
    ' supplier-b ',
  ), {
    filters: { supplierValue: ' supplier-b ' },
    page: 1,
  })
  assert.deepEqual(applyProductSupplierFilter(
    { supplierValue: 'supplier-a' },
    undefined,
  ), { filters: {}, page: 1 })
})

test('generated DTO adapter 保留 Decimal 字符串、顺序、raw 与 nullable actor', () => {
  const adapted = adaptProductPageDto(productPageDto)

  assert.deepEqual(adapted, productPageDto)
  assert.notEqual(adapted, productPageDto)
  assert.notEqual(adapted.items, productPageDto.items)
  assert.notEqual(adapted.items[0]?.media, productPageDto.items[0]?.media)
  assert.notEqual(adapted.items[0]?.media.mainImage, productPageDto.items[0]?.media.mainImage)
  assert.notEqual(adapted.items[0]?.media.images, productPageDto.items[0]?.media.images)
  assert.notEqual(adapted.items[0]?.media.images[0], productPageDto.items[0]?.media.images[0])
  assert.notEqual(adapted.items[0]?.media.videos, productPageDto.items[0]?.media.videos)
  assert.equal(adapted.items[0]?.twdSalePrice.amount, '12345678901234567890.1234')
  assert.deepEqual(adapted.items[0]?.attributes.map(item => item.title), ['颜色', '尺寸'])
  assert.equal(adapted.items[0]?.supplier?.value, 'supplier-a')
  assert.equal(adapted.items[0]?.supplier?.tone, null)
  assert.equal(adapted.items[0]?.createdBy, null)
})

test('供应商筛选使用当前 label 与 stable value，并保留已停用已知项', () => {
  const catalog: DictionaryCatalog = {
    code: 'service_provider.supplier',
    name: '供应商',
    enabled: true,
    items: [
      {
        value: 'supplier-a',
        label: '启用供应商',
        tone: 'SUCCESS',
        enabled: true,
        effectiveEnabled: true,
        sortOrder: 10,
      },
      {
        value: 'supplier-b',
        label: '停用供应商',
        tone: 'WARNING',
        enabled: false,
        effectiveEnabled: false,
        sortOrder: 20,
      },
    ],
  }

  assert.deepEqual(buildSupplierFilterOptions(catalog), [
    { label: '启用供应商', value: 'supplier-a' },
    { label: '停用供应商（已停用）', value: 'supplier-b' },
  ])
  assert.deepEqual(buildSupplierFilterOptions(null), [])
})

test('结构化媒体使用 stable ID 和领域 contentUrl，拒绝不匹配的内容地址且不重排', () => {
  const product = adaptProductPageDto(productPageDto).items[0]!

  assert.deepEqual(buildProductMainImageItems(product, true), [{
    alt: '便携收纳包主图',
    key: 'media-image-main',
    src: '/api/products/product-1/media/media-image-main/content',
    tooltip: '便携收纳包主图',
  }])
  assert.deepEqual(buildProductImageItems(product, true), [
    {
      alt: '便携收纳包图片 1',
      key: 'media-image-main',
      src: '/api/products/product-1/media/media-image-main/content',
      tooltip: '便携收纳包图片 1',
    },
    {
      alt: '便携收纳包图片 2',
      key: 'media-image-secondary',
      src: '/api/products/product-1/media/media-image-secondary/content',
      tooltip: '便携收纳包图片 2',
    },
  ])
  assert.deepEqual(buildProductMainImageItems(product, false), [])
  assert.deepEqual(buildProductImageItems(product, false), [])
  assert.equal(resolveProductMediaContentUrl(product.id, {
    ...product.media.images[0]!,
    contentUrl: 'https://example.test/media.webp',
  }), null)
})

test('迟到响应同时受 Abort、权限、authEpoch 与 requestVersion 约束', () => {
  const current = {
    aborted: false,
    authorized: true,
    authEpoch: 7,
    currentAuthEpoch: 7,
    latestRequestVersion: 3,
    requestVersion: 3,
  }
  assert.equal(canApplyProductListResponse(current), true)
  assert.equal(canApplyProductListResponse({ ...current, aborted: true }), false)
  assert.equal(canApplyProductListResponse({ ...current, authorized: false }), false)
  assert.equal(canApplyProductListResponse({ ...current, currentAuthEpoch: 8 }), false)
  assert.equal(canApplyProductListResponse({ ...current, requestVersion: 2 }), false)
  assert.equal(isProductListAbortError(new DOMException('aborted', 'AbortError')), true)
  assert.equal(isProductListAbortError({ code: 'ERR_CANCELED' }), true)
  assert.equal(isProductListAbortError(new Error('request failed')), false)
})
