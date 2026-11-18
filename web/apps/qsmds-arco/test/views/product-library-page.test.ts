import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 产品库页面结构使用 Node.js 内置 runner。
import test from 'node:test'

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
}

const page = source('../../src/views/operations/product-library/index.vue')
const card = source('../../src/views/operations/product-library/product-library-card.vue')
const drawer = source('../../src/views/operations/product-library/product-library-detail-drawer.vue')
const modal = source('../../src/views/operations/product-library/product-library-alias-modal.vue')

test('产品库是图片优先卡片库，不使用管理员表格或管理工具栏', () => {
  assert.match(page, /<FaPageHeader[^>]*title="产品库"/u)
  assert.match(page, /<FaPageMain/u)
  assert.match(page, /<ProductLibraryCard/u)
  assert.match(page, /grid/u)
  assert.match(page, /sm:grid-cols-2/u)
  assert.match(page, /lg:grid-cols-3/u)
  assert.match(page, /2xl:grid-cols-4/u)
  assert.match(page, /<FaPagination/u)
  assert.match(page, /:sizes="\[\.\.\.PRODUCT_LIBRARY_PAGE_SIZES\]"/u)
  assert.doesNotMatch(page, /<QsGenericTable/u)
  assert.doesNotMatch(page, />新增产品/u)
  assert.doesNotMatch(page, /产品分类树/u)
})

test('卡片使用 1:1 contain 主图、thumb 变体、占位和始终可见的别名入口', () => {
  assert.match(card, /aspect-square/u)
  assert.match(card, /object-contain/u)
  assert.match(card, /buildProductLibraryThumbnailUrl/u)
  assert.match(card, /loading="lazy"/u)
  assert.match(card, /qs-products/u)
  assert.match(card, /productLibraryAliasLabel/u)
  assert.match(card, /canManageAlias/u)
  assert.match(card, /@click\.stop="emit\('editAlias'\)"/u)
  assert.match(card, /查看详情/u)
})

test('详情抽屉展示完整资料、价格、媒体、审计和设置别名，不提供编辑产品', () => {
  assert.match(drawer, /<QsGenericDrawer/u)
  assert.match(drawer, /size="xl"/u)
  assert.match(drawer, /采购成本价/u)
  assert.match(drawer, /产品图片/u)
  assert.match(drawer, /审计信息/u)
  assert.match(drawer, /设置别名/u)
  assert.doesNotMatch(drawer, /编辑产品/u)
})

test('别名弹窗限制 36 字符、支持清除并提示历史影响', () => {
  assert.match(modal, /title="设置产品别名"/u)
  assert.match(modal, /:maxlength="36"/u)
  assert.match(modal, /清除别名/u)
  assert.match(modal, /包括历史单据/u)
  assert.match(modal, /validateProductLibraryAlias/u)
})
