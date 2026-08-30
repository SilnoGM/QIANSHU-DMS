import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// eslint-disable-next-line test/no-import-node-test -- 业务组件结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../src/components/business/QsSalesOrderSelectorModal/index.vue',
  import.meta.url,
)
const TYPES = new URL(
  '../../src/components/business/QsSalesOrderSelectorModal/types.ts',
  import.meta.url,
)
const PRODUCT_PREVIEW = new URL(
  '../../src/components/business/QsSalesOrderSelectorModal/SalesOrderProductPreview.vue',
  import.meta.url,
)

function readSlotUtilities(source: string, slot: string): ReadonlySet<string> {
  const match = source.match(new RegExp(
    `data-slot="${slot}"[\\s\\S]*?class="([^"]+)"`,
    'u',
  ))
  assert.ok(match, `缺少 ${slot} 的 class 契约`)
  return new Set(match[1].split(/\s+/u))
}

test('销售订单选择弹窗复用 QsGenericModal 且不读取 API、Store 或采购域', async () => {
  const [source, types, productPreview] = await Promise.all([
    readFile(SOURCE, 'utf8'),
    readFile(TYPES, 'utf8'),
    readFile(PRODUCT_PREVIEW, 'utf8'),
  ])

  assert.match(source, /defineOptions\(\{ name: 'QsSalesOrderSelectorModal' \}\)/u)
  assert.match(source, /import SalesOrderProductPreview from '\.\/SalesOrderProductPreview\.vue'/u)
  assert.match(source, /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u)
  assert.match(source, /size="xl"/u)
  assert.match(source, /orderStatus === 'CONFIRMED'/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|purchase-order|PurchaseOrder/u)
  assert.match(types, /readonly previews: readonly SalesOrderSelectorLinePreview\[\]/u)
  assert.match(types, /readonly contentUrl: string/u)
  assert.doesNotMatch(types, /agreedTotalAmount|currencyCode/u)
  assert.match(productPreview, /import ImageGroup from '@\/components\/base\/ImageGroup\/index\.vue'/u)
  assert.match(productPreview, /import QsGoodTooltip from '@\/components\/business\/QsGoodTooltip\/index\.vue'/u)
  assert.match(productPreview, /import QsGoodTooltipContent from '@\/components\/business\/QsGoodTooltip\/QsGoodTooltipContent\.vue'/u)
  assert.doesNotMatch(productPreview, /@\/api|useApp\w*Store|purchase-order|PurchaseOrder/u)
})

test('销售订单选择弹窗覆盖搜索、单选确认、分页和五种稳定状态', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /搜索销售订单号或客户名/u)
  assert.match(source, /订单状态：已确认/u)
  assert.equal(source.match(/客户 \/ 出单人/gu)?.length, 2)
  assert.doesNotMatch(source, /客户 \/ 开单人/u)
  assert.match(source, /<span class="text-end">订单状态<\/span>/u)
  assert.doesNotMatch(source, /约定总价|agreedTotalAmount|formatSalesOrderAmount/u)
  assert.doesNotMatch(source, /履约 \/ 付款/u)
  assert.equal(source.match(/flex flex-col gap-1\.5/gu)?.length, 2)
  assert.equal(source.match(/flex flex-col gap-1\.5[^"]*items-end/gu)?.length, 2)
  assert.match(source, /role="radiogroup"/u)
  assert.match(source, /role="radio"/u)
  assert.match(source, /emit\('select'/u)
  assert.match(source, /emit\('confirm'/u)
  assert.match(source, /emit\('search'/u)
  assert.match(source, /emit\('pageChange'/u)
  assert.match(source, /emit\('retry'/u)
  assert.match(source, /没有符合条件的销售订单/u)
  assert.match(source, /销售订单加载失败/u)
  assert.match(source, /正在加载符合条件的销售订单/u)
  assert.match(source, /<FaPagination/u)
  assert.match(source, /:disabled="!selectedOrder \|\| disabled \|\| loading \|\| Boolean\(error\)"/u)
})

test('销售订单选择弹窗桌面使用数据行、移动端使用卡片且仅列表独立滚动', async () => {
  const source = await readFile(SOURCE, 'utf8')
  const bodyUtilities = readSlotUtilities(source, 'sales-order-selector-body')
  const toolbarUtilities = readSlotUtilities(source, 'sales-order-selector-toolbar')
  const listUtilities = readSlotUtilities(source, 'sales-order-selector-list')
  const paginationUtilities = readSlotUtilities(source, 'sales-order-selector-pagination')

  assert.ok(bodyUtilities.has('flex'))
  assert.ok(bodyUtilities.has('flex-col'))
  assert.ok(bodyUtilities.has('min-h-0'))
  assert.ok(bodyUtilities.has('overflow-hidden'))
  assert.ok(toolbarUtilities.has('shrink-0'))
  assert.ok(listUtilities.has('min-h-0'))
  assert.ok(listUtilities.has('flex-1'))
  assert.ok(listUtilities.has('overflow-y-auto'))
  assert.ok(listUtilities.has('overscroll-contain'))
  assert.ok(paginationUtilities.has('shrink-0'))
  assert.equal(source.match(/overflow-y-auto/gu)?.length, 1)
  assert.ok(
    source.indexOf('data-slot="sales-order-selector-toolbar"')
    < source.indexOf('data-slot="sales-order-selector-list"'),
  )
  assert.ok(
    source.indexOf('data-slot="sales-order-selector-list"')
    < source.indexOf('data-slot="sales-order-selector-pagination"'),
  )
  assert.match(source, /hidden sm:block/u)
  assert.match(source, /sm:hidden/u)
  const productPreview = await readFile(PRODUCT_PREVIEW, 'utf8')
  assert.equal(source.match(/<SalesOrderProductPreview/gu)?.length, 2)
  assert.equal(productPreview.match(/<ImageGroup/gu)?.length, 1)
  assert.equal(productPreview.match(/#tooltip="\{ item: image, index, total: productTotal \}"/gu)?.length, 1)
  assert.equal(productPreview.match(/<QsGoodTooltipContent/gu)?.length, 1)
  assert.equal(productPreview.match(/<QsGoodTooltip/gu)?.length, 2)
  assert.match(source, /grid-cols-\[1\.35fr_1fr_1\.1fr_0\.9fr\]/u)
  assert.match(source, /@keydown\.enter\.self\.prevent="selectOrder\(item\)"/u)
  assert.match(source, /min-w-0/u)
  assert.match(source, /overflow-x-hidden/u)
  assert.match(source, /size-11/u)
  assert.match(source, /h-11 sm:h-9 sm:order-1/u)
  assert.match(source, /h-11 sm:h-9 sm:order-2/u)
  assert.match(source, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/u)
})
