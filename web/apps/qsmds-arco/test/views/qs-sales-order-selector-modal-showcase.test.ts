import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// eslint-disable-next-line test/no-import-node-test -- 组件库展示页源码契约使用 Node.js 内置 runner。
import test from 'node:test'

const SHOWCASE = new URL(
  '../../src/views/component_library/business/components/SalesOrderSelectorModalShowcase.vue',
  import.meta.url,
)
const PAGE = new URL(
  '../../src/views/component_library/business/sales-order-selector-modal.vue',
  import.meta.url,
)

test('组件库展示页独立展示销售订单选择弹窗且不读取业务 API 或 Store', async () => {
  const [showcase, page] = await Promise.all([
    readFile(SHOWCASE, 'utf8'),
    readFile(PAGE, 'utf8'),
  ])

  assert.match(showcase, /import QsSalesOrderSelectorModal/u)
  assert.match(showcase, /productFront/u)
  assert.match(showcase, /productSide/u)
  assert.match(showcase, /lineSummary: \{[\s\S]*?previews:/u)
  assert.match(showcase, /'default', 'selected', 'loading', 'empty', 'error'/u)
  assert.match(showcase, /selected: \{/u)
  assert.match(showcase, /state === 'selected'/u)
  assert.match(showcase, /DRAFT/u)
  assert.match(showcase, /PENDING_RECONCILIATION/u)
  assert.match(showcase, /COMPLETED/u)
  assert.match(showcase, /CANCELLED/u)
  assert.match(showcase, /data-testid="sales-order-selector-trigger"/u)
  assert.match(showcase, /:data-testid="`sales-order-selector-state-\$\{state\.value\}`"/u)
  assert.doesNotMatch(showcase, /@\/api|useApp\w*Store/u)

  assert.match(page, /defineOptions\(\{ name: 'ComponentLibraryQsSalesOrderSelectorModal' \}\)/u)
  assert.match(page, /title="销售订单选择弹窗"/u)
  assert.match(page, /route-path="\/component-library\/business\/sales-order-selector-modal"/u)
  assert.match(page, /<SalesOrderSelectorModalShowcase\s*\/>/u)
})
