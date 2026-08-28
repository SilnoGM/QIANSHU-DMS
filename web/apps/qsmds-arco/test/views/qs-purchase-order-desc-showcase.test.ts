import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 采购订单详情 Showcase 使用 Node.js 内置 runner 校验组件库组合契约。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('采购订单详情拥有独立业务组件页面与响应式预览入口', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/purchase-order-desc.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/PurchaseOrderDescShowcase.vue',
  )
  const routerSource = readRelativeSource(
    '../../src/router/modules/component.library.ts',
  )

  assert.match(pageSource, /defineOptions\(\{ name: 'ComponentLibraryQsPurchaseOrderDesc' \}\)/u)
  assert.match(pageSource, /route-path="\/component-library\/business\/purchase-order-desc"/u)
  assert.match(pageSource, /<PurchaseOrderDescShowcase\s*\/>/u)
  assert.match(showcaseSource, /import QsPurchaseOrderDesc from '@\/components\/business\/QsPurchaseOrderDesc\/index\.vue'/u)
  assert.match(showcaseSource, /<QsPurchaseOrderDesc/u)
  assert.match(showcaseSource, /:model="PURCHASE_ORDER_DESC_SHOWCASE_MODEL"/u)
  assert.match(showcaseSource, /:currencies="SHOWCASE_CURRENCIES"/u)
  assert.match(showcaseSource, /aria-pressed/u)
  assert.match(showcaseSource, /侧栏宽度/u)
  assert.match(showcaseSource, /页面宽度/u)
  assert.match(routerSource, /path: 'purchase-order-desc'/u)
  assert.match(routerSource, /name: 'componentLibraryQsPurchaseOrderDesc'/u)
  assert.doesNotMatch(
    showcaseSource,
    /@\/api|useApp\w*Store|fetch\(|axios|linear-gradient|radial-gradient/u,
  )
})

test('采购订单详情 fixture 覆盖两类产品、产品主图、采购金额和状态', () => {
  const fixtureSource = readRelativeSource(
    '../../src/views/component_library/business/fixtures/purchase-order-desc.fixture.ts',
  )

  assert.match(fixtureSource, /QsPurchaseOrderDescViewModel/u)
  assert.match(fixtureSource, /PURCHASE_ORDER_DESC_SHOWCASE_MODEL/u)
  assert.match(fixtureSource, /lineType: 'CATALOG'/u)
  assert.match(fixtureSource, /lineType: 'CUSTOM'/u)
  assert.match(fixtureSource, /mainImage:/u)
  assert.match(fixtureSource, /referencePurchaseUnitPriceAmount:/u)
  assert.match(fixtureSource, /actualPurchaseUnitPriceAmount:/u)
  assert.match(fixtureSource, /purchaseTotalAmount:/u)
  assert.match(fixtureSource, /depositDueAmount:/u)
  assert.match(fixtureSource, /balanceDueAmount:/u)
  assert.match(fixtureSource, /statuses:/u)
  assert.doesNotMatch(fixtureSource, /@\/api|useApp\w*Store|fetch\(|axios/u)
})
