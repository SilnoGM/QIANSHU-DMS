import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 产品列表页面契约使用 Node.js 内置 runner。
import test from 'node:test'

const source = readFileSync(new URL(
  '../../src/views/admin/product-management/list/index.vue',
  import.meta.url,
), 'utf8')

test('产品列表使用标准页头、主体和通用表格，关闭未确认的内建新增与搜索', () => {
  assert.match(source, /<FaPageHeader\b/u)
  assert.match(source, /title="产品列表"/u)
  assert.match(source, /<FaPageMain\b/u)
  assert.match(source, /<QsGenericTable\b/u)
  assert.match(source, /:addable="false"/u)
  assert.match(source, /:searchable="false"/u)
  assert.match(source, /:show-column-settings="true"/u)
  assert.doesNotMatch(source, /<Fa(?:Table|Pagination)\b|<A[A-Z]\w*\b/u)
  assert.doesNotMatch(source, /(?:gradient|#[\dA-Fa-f]{3,8}\b|rgba?\()/u)
})

test('全部业务与审计列顺序固定，编号左固定且技术字段不可见', () => {
  const expectedColumnIds = [
    'productNo',
    'name',
    'status',
    'supplier',
    'mainImage',
    'images',
    'videos',
    'twdSalePrice',
    'myrSalePrice',
    'purchaseCost',
    'attributes',
    'createdAt',
    'createdBy',
    'updatedAt',
    'updatedBy',
  ]
  const columnBlock = source.match(
    /const columns:[\s\S]*?\n\]/u,
  )?.[0]
  assert.ok(columnBlock)
  const actualColumnIds = [...columnBlock.matchAll(/\bid: '([^']+)'/gu)]
    .map(match => match[1])
  assert.deepEqual(actualColumnIds, expectedColumnIds)
  assert.match(columnBlock, /id: 'productNo',[\s\S]*?fixed: 'left'/u)
  assert.doesNotMatch(columnBlock, /\bid: '(?:id|version)'/u)
  assert.match(source, /<template #actions=/u)
})

test('产品数据只在可信权限与身份内请求，并清理过期响应', () => {
  assert.match(source, /auth\('products:read'\)/u)
  assert.match(source, /auth\('products:create'\)/u)
  assert.match(source, /productsApi\.list/u)
  assert.match(source, /adaptProductPageDto/u)
  assert.match(source, /new AbortController\(\)/u)
  assert.match(source, /authEpoch/u)
  assert.match(source, /listRequestVersion/u)
  assert.match(source, /canApplyProductListResponse/u)
  assert.match(source, /listAbortController\?\.abort\(\)/u)
  assert.match(source, /rows\.value = \[\]/u)
  assert.match(source, /v-if="canCreate"/u)
})

test('供应商筛选复用 Catalog 与表格筛选，并和列表状态独立', () => {
  assert.match(source, /useDictionaryCatalog\(SUPPLIER_DICTIONARY_CODE\)/u)
  assert.match(source, /buildSupplierFilterOptions/u)
  assert.match(source, /key: 'supplierValue'/u)
  assert.match(source, /v-model:filters="filters"/u)
  assert.match(source, /@filter-change="handleFilterChange"/u)
  assert.match(source, /supplierCatalog\.retry/u)
  assert.match(source, /supplierCatalog\.error/u)
  assert.match(source, /supplierCatalog\.loading/u)
  assert.match(source, /supplierCatalog\.missing/u)
})

test('窄屏复用 QsGenericTable mobile-row 并保留同一行身份和操作', () => {
  assert.match(source, /:row-key="item => item\.id"/u)
  assert.match(source, /<template #mobile-row=/u)
  assert.match(source, /产品编号/u)
  assert.match(source, /供应商/u)
  assert.match(source, /台币销售价/u)
  assert.match(source, /创建时间/u)
  assert.match(source, /查看/u)
  assert.match(source, /编辑/u)
})
