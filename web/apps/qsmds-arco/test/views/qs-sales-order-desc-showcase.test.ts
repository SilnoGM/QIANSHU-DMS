import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// eslint-disable-next-line test/no-import-node-test -- 销售订单详情 Showcase 使用 Node.js 内置 runner 校验组件库组合契约。
import test from 'node:test'

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

test('销售订单详情拥有独立业务组件页面与响应式预览入口', () => {
  const pageSource = readRelativeSource(
    '../../src/views/component_library/business/sales-order-desc.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/SalesOrderDescShowcase.vue',
  )

  assert.match(
    pageSource,
    /defineOptions\(\{ name: 'ComponentLibraryQsSalesOrderDesc' \}\)/u,
  )
  assert.match(pageSource, /title="销售订单详情"/u)
  assert.match(
    pageSource,
    /route-path="\/component-library\/business\/sales-order-desc"/u,
  )
  assert.match(pageSource, /<SalesOrderDescShowcase\s*\/>/u)

  assert.match(
    showcaseSource,
    /import QsSalesOrderDesc from '@\/components\/business\/QsSalesOrderDesc\/index\.vue'/u,
  )
  assert.match(showcaseSource, /<QsSalesOrderDesc/u)
  assert.match(showcaseSource, /:model="SALES_ORDER_DESC_SHOWCASE_MODEL"/u)
  assert.match(showcaseSource, /:currencies="SHOWCASE_CURRENCIES"/u)
  assert.match(showcaseSource, /aria-pressed/u)
  assert.match(showcaseSource, /侧栏宽度/u)
  assert.match(showcaseSource, /页面宽度/u)
  assert.doesNotMatch(
    showcaseSource,
    /@\/api|useApp\w*Store|fetch\(|axios|linear-gradient|radial-gradient/u,
  )
})

test('销售订单详情 fixture 覆盖两类产品、三段金额和图片附件', () => {
  const fixtureSource = readRelativeSource(
    '../../src/views/component_library/business/fixtures/sales-order-desc.fixture.ts',
  )

  assert.match(fixtureSource, /QsSalesOrderDescViewModel/u)
  assert.match(fixtureSource, /SALES_ORDER_DESC_SHOWCASE_MODEL/u)
  assert.match(fixtureSource, /lineType: 'CATALOG'/u)
  assert.match(fixtureSource, /lineType: 'CUSTOM'/u)
  assert.match(fixtureSource, /agreedTotalAmount:/u)
  assert.match(fixtureSource, /depositDueAmount:/u)
  assert.match(fixtureSource, /balanceDueAmount:/u)
  assert.match(fixtureSource, /documentType: 'DEPOSIT_VOUCHER'/u)
  assert.match(fixtureSource, /documentType: 'DELIVERY_RECEIPT'/u)
  assert.match(fixtureSource, /thumbnailSrc:/u)
  assert.match(fixtureSource, /previewSrc:/u)
  assert.doesNotMatch(
    fixtureSource,
    /@\/api|useApp\w*Store|fetch\(|axios/u,
  )
})
