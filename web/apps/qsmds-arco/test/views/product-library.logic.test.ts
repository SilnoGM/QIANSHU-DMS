import type { ProductTaxonomyTreeDto } from '../../src/api/generated/types.gen'
import type { ProductListItemViewModel } from '../../src/views/admin/product-management/list/product-list.logic'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 产品库纯逻辑使用 Node.js 内置 runner。
import test from 'node:test'

import {
  buildCategoryOptions,
  buildProductHeadOptions,
  buildProductLibraryOriginalImageUrl,
  buildProductLibraryQuery,
  buildProductLibraryThumbnailUrl,
  buildSupplierOptions,
  productLibraryAliasLabel,
  validateProductLibraryAlias,
} from '../../src/views/operations/product-library/product-library.logic'

const tree: ProductTaxonomyTreeDto = {
  suppliers: [{
    supplierValue: 'SUPPLIER-1',
    productCount: 2,
    unclassifiedCount: 0,
    categories: [{
      id: 'category-1',
      name: '机械',
      sortOrder: 0,
      productCount: 2,
      productHeads: [{
        id: 'head-1',
        name: '破碎设备',
        sortOrder: 0,
        productCount: 2,
      }],
    }],
  }],
  totalProducts: 2,
  unclassifiedCount: 0,
}

function productFixture(): ProductListItemViewModel {
  return {
    id: 'product-1',
    name: '破碎机',
    productNo: 'PROD/00001',
    categoryName: '机械',
    productHeadName: '破碎设备',
    status: 'ACTIVE',
    supplier: null,
    media: {
      mainImage: {
        id: 'media-1',
        kind: 'IMAGE',
        originalFilename: 'main.webp',
        mimeType: 'image/webp',
        sizeBytes: '1024',
        width: 800,
        height: 800,
        durationMs: null,
        sortOrder: 0,
        isPrimary: true,
        contentUrl: '/api/products/product-1/media/media-1/content',
        createdAt: '2026-11-17T00:00:00.000Z',
      },
      images: [],
      videos: [],
    },
    twdSalePrice: { amount: '1200.00', currency: 'TWD' },
    myrSalePrice: { amount: '180.00', currency: 'MYR' },
    purchaseCost: { amount: '800.00', currency: 'CNY' },
  } as unknown as ProductListItemViewModel
}

test('产品库查询会去空白、映射状态并忽略 ALL 占位', () => {
  assert.deepEqual(buildProductLibraryQuery({
    keyword: '  破碎机  ',
    status: 'ACTIVE',
    supplierValue: 'SUPPLIER-1',
    categoryId: 'category-1',
    productHeadId: 'head-1',
  }, 2, 24), {
    page: 2,
    pageSize: 24,
    keyword: '破碎机',
    status: 'ACTIVE',
    supplierValue: 'SUPPLIER-1',
    categoryId: 'category-1',
    productHeadId: 'head-1',
  })
  assert.deepEqual(buildProductLibraryQuery({
    keyword: ' ',
    status: 'ALL',
    supplierValue: undefined,
    categoryId: undefined,
    productHeadId: undefined,
  }, 1, 48), { page: 1, pageSize: 48 })
})

test('供应商、分类与产品头选项按当前联动层级生成', () => {
  const supplierOptions = buildSupplierOptions({
    code: 'service_provider.supplier',
    name: '供应商',
    enabled: true,
    items: [
      { value: 'SUPPLIER-1', label: '千树', tone: 'DEFAULT', enabled: true, effectiveEnabled: true, sortOrder: 0 },
      { value: 'SUPPLIER-2', label: '其他', tone: 'DEFAULT', enabled: true, effectiveEnabled: true, sortOrder: 1 },
    ],
  })
  assert.deepEqual(supplierOptions, [
    { value: 'SUPPLIER-1', label: '千树' },
    { value: 'SUPPLIER-2', label: '其他' },
  ])
  const labels = new Map([['SUPPLIER-1', '千树']])
  assert.deepEqual(buildCategoryOptions(tree, 'SUPPLIER-1', labels), [
    { value: 'category-1', label: '千树 · 机械' },
  ])
  assert.deepEqual(buildCategoryOptions(tree, 'SUPPLIER-2', labels), [])
  assert.deepEqual(buildProductHeadOptions(tree, 'category-1'), [
    { value: 'head-1', label: '破碎设备' },
  ])
  assert.deepEqual(buildProductHeadOptions(tree, undefined), [])
})

test('卡片封面优先使用 thumb 变体，并可回退原图', () => {
  const product = productFixture()
  assert.equal(
    buildProductLibraryThumbnailUrl(product),
    '/api/products/product-1/media/media-1/content?variant=thumb',
  )
  assert.equal(
    buildProductLibraryOriginalImageUrl(product),
    '/api/products/product-1/media/media-1/content',
  )
  assert.equal(buildProductLibraryThumbnailUrl({
    ...product,
    media: { ...product.media, mainImage: null },
  }), null)
  assert.equal(buildProductLibraryOriginalImageUrl({
    ...product,
    media: { ...product.media, mainImage: null },
  }), null)
})

test('别名去空白、36 字符上限与 ×/控制字符校验', () => {
  const normalized36 = '产'.repeat(36)
  assert.equal(validateProductLibraryAlias(`  ${normalized36}  `), null)
  assert.match(validateProductLibraryAlias('产'.repeat(37)) ?? '', /最多 36 个字符/u)
  assert.match(validateProductLibraryAlias('破碎机×2') ?? '', /不能包含/u)
  assert.match(validateProductLibraryAlias('破碎\n机') ?? '', /不能包含/u)
  assert.match(validateProductLibraryAlias('   ') ?? '', /请输入别名/u)
  assert.equal(productLibraryAliasLabel('  破碎机 '), '破碎机')
  assert.equal(productLibraryAliasLabel(null), '使用产品名')
})
