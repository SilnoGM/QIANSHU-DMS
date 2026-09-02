import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 组件库结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const SHOWCASE = new URL(
  '../../src/views/component_library/business/components/SalesOrderAddOnProductsModalShowcase.vue',
  import.meta.url,
)
const PAGE = new URL(
  '../../src/views/component_library/business/sales-order-add-on-products-modal.vue',
  import.meta.url,
)
const ROUTES = new URL(
  '../../src/router/modules/component.library.ts',
  import.meta.url,
)

test('组件库独立展示销售加购弹窗的稳定状态且不读取业务 API', async () => {
  const [showcase, page, routes] = await Promise.all([
    readFile(SHOWCASE, 'utf8'),
    readFile(PAGE, 'utf8'),
    readFile(ROUTES, 'utf8'),
  ])

  assert.match(showcase, /import QsSalesOrderAddOnProductsModal/u)
  assert.match(showcase, /'stable', 'empty', 'loading', 'error', 'full', 'mobile'/u)
  assert.match(showcase, /客户加购产品/u)
  assert.match(showcase, /createOrderProductFixtureLoader/u)
  assert.doesNotMatch(showcase, /@\/api|useApp\w*Store/u)
  assert.match(page, /ComponentLibraryQsSalesOrderAddOnProductsModal/u)
  assert.match(page, /route-path="\/component-library\/business\/sales-order-add-on-products-modal"/u)
  assert.match(routes, /path: 'sales-order-add-on-products-modal'/u)
  assert.match(routes, /name: 'componentLibraryQsSalesOrderAddOnProductsModal'/u)
})
