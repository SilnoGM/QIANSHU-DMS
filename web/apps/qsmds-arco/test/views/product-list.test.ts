import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 产品列表页面契约使用 Node.js 内置 runner。
import test from 'node:test'

const source = readFileSync(new URL(
  '../../src/views/admin/product-management/list/index.vue',
  import.meta.url,
), 'utf8')

test('产品列表使用标准页头、主体和通用表格，并启用服务端搜索', () => {
  assert.match(source, /<FaPageHeader\b/u)
  assert.match(source, /title="产品列表"/u)
  assert.match(source, /<FaPageMain\b/u)
  assert.match(source, /<QsGenericTable\b/u)
  assert.match(source, /:addable="false"/u)
  assert.match(source, /v-model:search="searchKeyword"/u)
  assert.match(source, /:searchable="true"/u)
  assert.match(source, /search-placeholder="搜索产品名称或产品编号"/u)
  assert.match(source, /@search="handleSearch"/u)
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
  assert.match(source, /searchKeyword\.value = ''/u)
  assert.match(source, /v-if="canCreate"/u)
})

test('搜索与供应商筛选都回到第一页并共用单次请求调度', () => {
  assert.match(source, /function handleSearch\(keyword: string\)/u)
  assert.match(source, /searchKeyword\.value = keyword/u)
  assert.match(source, /page\.value = 1/u)
  assert.match(source, /scheduleQueryRefresh\(\)/u)
  assert.match(source, /search: searchKeyword\.value/u)
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
  assert.equal((source.match(/:size="44"/gu) ?? []).length, 2)
})

test('特殊单元格复用 ImageGroup、AmountDisplay、FaTag 与只读弹窗', () => {
  assert.match(source, /<ImageGroup\b[\s\S]*?:max-count="3"/u)
  assert.match(source, /buildProductMainImageItems/u)
  assert.match(source, /buildProductImageItems/u)
  assert.equal((source.match(/<AmountDisplay\b/gu) ?? []).length >= 6, true)
  assert.match(source, /useCurrencyCatalog\(\)/u)
  assert.match(source, /<FaTag\b/u)
  assert.match(source, /草稿/u)
  assert.match(source, /启用/u)
  assert.match(source, /停用/u)
  assert.match(source, /未知/u)
  assert.match(source, /<ProductAttributesModal/u)
  assert.match(source, /<ProductVideosModal/u)
})

test('属性和视频入口可聚焦且占位动作只使用 QsToast info', () => {
  assert.match(source, /项属性/u)
  assert.match(source, /个视频/u)
  assert.match(source, /i-lucide:list-tree/u)
  assert.match(source, /i-lucide:video/u)
  assert.match(source, /toast\.info\('新增产品功能将在后续版本开放'\)/u)
  assert.match(source, /toast\.info\('产品详情功能将在后续版本开放'\)/u)
  assert.match(source, /toast\.info\('产品编辑功能将在后续版本开放'\)/u)
  assert.doesNotMatch(source, /router\.(?:push|replace)|productsApi\.(?:create|update|delete)/u)
})

test('属性弹窗完整有序展示，视频弹窗选择单一预览并保留安全外链', () => {
  const attributesModal = readFileSync(new URL(
    '../../src/views/admin/product-management/list/product-attributes-modal.vue',
    import.meta.url,
  ), 'utf8')
  const videosModal = readFileSync(new URL(
    '../../src/views/admin/product-management/list/product-videos-modal.vue',
    import.meta.url,
  ), 'utf8')

  assert.match(attributesModal, /<QsGenericModal/u)
  assert.match(attributesModal, /v-for="\(attribute, index\) in product\.attributes"/u)
  assert.match(attributesModal, /关闭属性/u)
  assert.match(videosModal, /<QsGenericModal/u)
  assert.match(videosModal, /<video/u)
  assert.match(videosModal, /controls/u)
  assert.match(videosModal, /selectedVideo/u)
  assert.match(videosModal, /target="_blank"/u)
  assert.match(videosModal, /rel="noopener noreferrer"/u)
  assert.match(videosModal, /url\.username === ''/u)
  assert.match(videosModal, /url\.password === ''/u)
  assert.match(videosModal, /pauseActiveVideo/u)
  assert.match(videosModal, /关闭视频/u)
})
