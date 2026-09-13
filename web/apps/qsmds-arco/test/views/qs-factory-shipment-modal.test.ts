import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 业务组件源码契约使用 Node.js 内置 runner。
import test from 'node:test'
import { runInNewContext } from 'node:vm'

import ts from 'typescript'

const SOURCE = new URL(
  '../../src/components/business/QsFactoryShipmentModal/index.vue',
  import.meta.url,
)
const TYPES = new URL(
  '../../src/components/business/QsFactoryShipmentModal/types.ts',
  import.meta.url,
)
const PRODUCT_SUMMARY = new URL(
  '../../src/components/business/QsFactoryShipmentModal/FactoryShipmentProductSummary.vue',
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

test('销售采购两种模式各自滚动内容，固定摘要和底部操作', async () => {
  const source = await readFile(SOURCE, 'utf8')
  assert.match(source, /data-slot="factory-shipment-sales-layout"/u)
  assert.match(source, /lg:grid-cols-\[minmax\(0,2fr\)_minmax\(16rem,1fr\)\]/u)
  assert.match(source, /data-slot="factory-shipment-order-list"/u)
  assert.match(source, /overflow-y-auto/u)
  assert.equal(source.match(/overflow-y-auto/gu)?.length, 2)
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

test('销售采购单默认折叠且选择与产品展开是独立可访问操作', async () => {
  const [source, productSummary, types] = await Promise.all([
    readFile(SOURCE, 'utf8'),
    readFile(PRODUCT_SUMMARY, 'utf8'),
    readFile(TYPES, 'utf8'),
  ])
  assert.match(source, /import FactoryShipmentProductSummary from '.\/FactoryShipmentProductSummary\.vue'/u)
  assert.match(source, /const expandedOrderIds = ref<string\[\]>\(\[\]\)/u)
  assert.match(source, /expandedOrderIds\.value = \[\]/u)
  assert.match(source, /data-slot="factory-shipment-order-card"/u)
  assert.match(source, /data-slot="factory-shipment-order-select"/u)
  assert.match(source, /data-slot="factory-shipment-order-expand"/u)
  assert.match(source, /:aria-expanded="expandedOrderIds\.includes\(order\.id\)"/u)
  assert.match(source, /@click="toggleOrderExpanded\(order\.id\)"/u)
  assert.match(source, /v-if="expandedOrderIds\.includes\(order\.id\)"/u)
  assert.equal(source.match(/<FactoryShipmentProductSummary/gu)?.length, 2)
  assert.match(source, /:previews="order\.lineSummary\.previews"/u)
  assert.match(source, /display-mode="FULL"/u)
  assert.match(source, /:previews="primaryOrder\.lineSummary\.previews"/u)
  assert.match(productSummary, /import ImageGroup from '@\/components\/base\/ImageGroup\/index\.vue'/u)
  assert.match(productSummary, /import QsGoodTooltipContent from '@\/components\/business\/QsGoodTooltip\/QsGoodTooltipContent\.vue'/u)
  assert.match(productSummary, /displayMode: 'SUMMARY'/u)
  assert.match(productSummary, /props\.displayMode === 'FULL'/u)
  assert.match(productSummary, /data-slot="factory-shipment-product-list"/u)
  assert.match(productSummary, /slice\(0, 3\)/u)
  assert.match(productSummary, /:max-count="3"/u)
  assert.match(productSummary, /productDisplayName\(preview\)/u)
  assert.match(productSummary, /preview\.quantity/u)
  assert.match(productSummary, /另有 \{\{ hiddenCount \}\} 项/u)
  assert.match(types, /readonly quantity\?: number/u)
})

test('采购发货使用最新详情核对基础唛头与货件，详情加载期间禁止提交', async () => {
  const source = await readFile(SOURCE, 'utf8')
  const page = await readFile(new URL('../../src/views/operations/purchase-orders/index.vue', import.meta.url), 'utf8')
  assert.match(source, /<slot name="purchase-content">/u)
  assert.match(page, /purchaseOrdersApi.getById\(targetId, controller.signal\)/u)
  assert.match(page, /<PurchaseShipmentSummary v-if="shipmentDetail" :detail="shipmentDetail"/u)
  assert.match(page, /epoch !== appAccountStore.authEpoch/u)
})

test('详情读取隔离过期响应，失败不留下可提交上下文，使用最新详情版本', async () => {
  const source = await readFile(new URL('../../src/views/operations/purchase-orders/index.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function retryPurchaseFactoryShipment():')
  const body = source.slice(start, source.indexOf('/** 发货进入', start))
  const ref = (value: unknown) => ({ value })
  let resolve: (value: unknown) => void = () => {}
  let fail = false
  const state = {
    AbortController,
    shipmentTarget: ref({ id: 'po-1' }),
    shipmentSubmitting: ref(false),
    shipmentVisible: ref(true),
    canUpdate: ref(true),
    appAccountStore: { authEpoch: 1 },
    shipmentContextLoading: ref(false),
    shipmentError: ref(null),
    shipmentDetail: ref(null),
    shipmentContext: ref(null),
    purchaseOrdersApi: { getById: async () => {
      if (fail) {
        throw new Error('offline')
      }
      return await new Promise((done) => {
        resolve = done
      })
    } },
    createPurchaseShipmentContext: (detail: unknown) => detail,
    refreshOrdersAndCounts: () => {},
    isPurchaseOrderAbortError: () => false,
    shipmentFailureMessage: () => 'load failed',
  }
  const load = runInNewContext(ts.transpileModule(`let shipmentAbortController = null; ${body}; retryPurchaseFactoryShipment`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, state) as () => Promise<void>
  const pending = load()
  assert.equal(state.shipmentContextLoading.value, true)
  state.appAccountStore.authEpoch += 1
  resolve({ data: { version: 1 } })
  await pending
  assert.equal(state.shipmentContext.value, null)
  const latest = { id: 'po-1', version: 7, orderStatus: 'CONFIRMED', fulfillmentStatus: 'PREPARING' }
  const success = load()
  resolve({ data: latest })
  await success
  assert.equal(state.shipmentDetail.value, latest)
  assert.equal(state.shipmentContext.value, latest)
  fail = true
  await load()
  assert.equal(state.shipmentContext.value, null)
  assert.equal(state.shipmentDetail.value, null)
  assert.equal(state.shipmentError.value, 'load failed')
  assert.equal(state.shipmentContextLoading.value, false)
})
