import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 组件库结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const SHOWCASE = new URL(
  '../../src/views/component_library/business/components/SalesOrderProductsEditorModalShowcase.vue',
  import.meta.url,
)
const PAGE = new URL(
  '../../src/views/component_library/business/sales-order-products-editor-modal.vue',
  import.meta.url,
)
const ROUTES = new URL('../../src/router/modules/component.library.ts', import.meta.url)

test('组件库独立展示销售产品修改弹窗且不读取业务 API', async () => {
  const [showcase, page, routes] = await Promise.all([
    readFile(SHOWCASE, 'utf8'),
    readFile(PAGE, 'utf8'),
    readFile(ROUTES, 'utf8'),
  ])

  assert.match(showcase, /import QsSalesOrderProductsEditorModal/u)
  assert.match(showcase, /'stable', 'deposit-risk', 'loading', 'error', 'mobile'/u)
  assert.match(showcase, /客户调整产品/u)
  assert.match(showcase, /createOrderProductFixtureLoader/u)
  assert.doesNotMatch(showcase, /@\/api|useApp\w*Store/u)
  assert.match(page, /ComponentLibraryQsSalesOrderProductsEditorModal/u)
  assert.match(page, /route-path="\/component-library\/business\/sales-order-products-editor-modal"/u)
  assert.match(routes, /path: 'sales-order-products-editor-modal'/u)
  assert.match(routes, /name: 'componentLibraryQsSalesOrderProductsEditorModal'/u)
})
