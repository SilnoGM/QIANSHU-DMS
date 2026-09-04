import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

// eslint-disable-next-line test/no-import-node-test -- 业务组件源码契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../src/components/business/QsFactoryShipmentModal/index.vue',
  import.meta.url,
)
const TYPES = new URL(
  '../../src/components/business/QsFactoryShipmentModal/types.ts',
  import.meta.url,
)

test('工厂发货弹窗复用 QsGenericModal 且不读取 API 或 Store', async () => {
  const [source, types] = await Promise.all([
    readFile(SOURCE, 'utf8'),
    readFile(TYPES, 'utf8'),
  ])
  assert.match(source, /defineOptions\(\{ name: 'QsFactoryShipmentModal' \}\)/u)
  assert.match(source, /import QsGenericModal from '@\/components\/business\/QsGenericModal\/index\.vue'/u)
  assert.match(source, /mode: 'PURCHASE_ORDER' \| 'SALES_ORDER'/u)
  assert.match(types, /export interface FactoryShipmentIntent/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
})

test('销售模式固定摘要和底部操作且只让采购单列表滚动', async () => {
  const source = await readFile(SOURCE, 'utf8')
  assert.match(source, /data-slot="factory-shipment-sales-layout"/u)
  assert.match(source, /lg:grid-cols-\[minmax\(0,2fr\)_minmax\(16rem,1fr\)\]/u)
  assert.match(source, /data-slot="factory-shipment-order-list"/u)
  assert.match(source, /overflow-y-auto/u)
  assert.equal(source.match(/overflow-y-auto/gu)?.length, 1)
  assert.match(source, /指定采购单/u)
  assert.match(source, /全部待发货采购单/u)
  assert.match(source, /本次发货/u)
  assert.match(source, /剩余待发货/u)
  assert.match(source, /销售订单将进入陆运中/u)
  assert.match(source, /已发货/u)
  assert.match(source, /确认发货/u)
  assert.match(source, /emit\('submit'/u)
  assert.match(source, /emit\('retry'\)/u)
})

test('采购模式固定当前订单并提示 ORDERED 自动补齐备货状态', async () => {
  const source = await readFile(SOURCE, 'utf8')
  assert.match(source, /确认本采购单已发货/u)
  assert.match(source, /系统将完成备货状态并将本采购单标记为已发货/u)
  assert.match(source, /i-lucide:truck/u)
  assert.match(source, /i-lucide:factory/u)
  assert.match(source, /i-lucide:package-check/u)
  assert.doesNotMatch(source, /[🚚📦🏭]/u)
})
