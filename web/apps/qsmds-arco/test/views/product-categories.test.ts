import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 产品分类管理页契约使用 Node.js 内置 runner。
import test from 'node:test'

const PAGE = new URL(
  '../../src/views/admin/product-management/categories/index.vue',
  import.meta.url,
)
const ROUTE = new URL(
  '../../src/router/modules/product.management.ts',
  import.meta.url,
)

test('产品分类页按供应商维护分类与产品头，并显式处理空目录', async () => {
  const source = await readFile(PAGE, 'utf8')

  assert.match(source, /<FaPageHeader/u)
  assert.match(source, /title="产品分类"/u)
  assert.match(source, /<QsDictionarySelect/u)
  assert.match(source, /dictionary-code="service_provider\.supplier"/u)
  assert.match(source, /listCategories/u)
  assert.match(source, /createCategory/u)
  assert.match(source, /renameCategory/u)
  assert.match(source, /deleteCategory/u)
  assert.match(source, /createHead/u)
  assert.match(source, /renameHead/u)
  assert.match(source, /deleteHead/u)
  assert.match(source, /暂无分类/u)
  assert.match(source, /暂无产品头/u)
  assert.match(source, /空分类/u)
  assert.match(source, /productCount/u)
  assert.match(source, /PRODUCT_CATEGORY_IN_USE|deleteBlocked/u)
  assert.match(source, /会同时删除这些产品头/u)
  assert.match(source, /product-categories:read/u)
  assert.match(source, /product-categories:create/u)
  assert.match(source, /product-categories:update/u)
  assert.match(source, /product-categories:delete/u)
  assert.doesNotMatch(source, /全部供应商/u)
})

test('产品分类路由位于管理员产品管理下并声明独立读取权限', async () => {
  const source = await readFile(ROUTE, 'utf8')

  assert.match(source, /name: 'adminProductCategories'/u)
  assert.match(source, /path: 'categories'/u)
  assert.match(source, /title: '产品分类'/u)
  assert.match(source, /auth: 'product-categories:read'/u)
  assert.match(source, /'product-categories:read'/u)
})
