import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// eslint-disable-next-line test/no-import-node-test -- 组件库展示页源码契约使用 Node.js 内置 runner。
import test from 'node:test'

const SHOWCASE = new URL(
  '../../src/views/component_library/business/components/FactoryShipmentModalShowcase.vue',
  import.meta.url,
)
const PAGE = new URL(
  '../../src/views/component_library/business/factory-shipment-modal.vue',
  import.meta.url,
)

test('组件库独立展示销售和采购两种工厂发货模式', async () => {
  const [showcase, page] = await Promise.all([
    readFile(SHOWCASE, 'utf8'),
    readFile(PAGE, 'utf8'),
  ])
  assert.match(showcase, /import QsFactoryShipmentModal/u)
  assert.match(showcase, /'sales', 'purchase', 'loading', 'error'/u)
  assert.match(showcase, /mode="SALES_ORDER"/u)
  assert.match(showcase, /mode="PURCHASE_ORDER"/u)
  assert.match(showcase, /data-testid="factory-shipment-modal-trigger"/u)
  assert.doesNotMatch(showcase, /@\/api|useApp\w*Store/u)
  assert.match(page, /defineOptions\(\{ name: 'ComponentLibraryQsFactoryShipmentModal' \}\)/u)
  assert.match(page, /title="订单工厂发货弹窗"/u)
  assert.match(page, /route-path="\/component-library\/business\/factory-shipment-modal"/u)
})
