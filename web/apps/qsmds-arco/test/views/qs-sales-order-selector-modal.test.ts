import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// eslint-disable-next-line test/no-import-node-test -- 业务组件结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../src/components/business/QsSalesOrderSelectorModal/index.vue',
  import.meta.url,
)

test('销售订单选择弹窗复用 QsGenericModal 且不读取 API、Store 或采购域', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /defineOptions\(\{ name: 'QsSalesOrderSelectorModal' \}\)/u)
  assert.match(source, /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u)
  assert.match(source, /size="xl"/u)
  assert.match(source, /orderStatus === 'CONFIRMED'/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store|purchase-order|PurchaseOrder/u)
})

test('销售订单选择弹窗覆盖搜索、单选确认、分页和五种稳定状态', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /搜索销售订单号或客户名/u)
  assert.match(source, /订单状态：已确认/u)
  assert.match(source, /<span class="text-end">订单状态<\/span>/u)
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

test('销售订单选择弹窗桌面使用数据行、移动端使用卡片且正文独立滚动', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /data-slot="sales-order-selector-body"/u)
  assert.match(source, /overflow-y-auto/u)
  assert.match(source, /hidden sm:block/u)
  assert.match(source, /sm:hidden/u)
  assert.match(source, /min-w-0/u)
  assert.match(source, /overflow-x-hidden/u)
  assert.match(source, /size-11/u)
  assert.match(source, /h-11 sm:h-9 sm:order-1/u)
  assert.match(source, /h-11 sm:h-9 sm:order-2/u)
  assert.match(source, /pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\]/u)
})
