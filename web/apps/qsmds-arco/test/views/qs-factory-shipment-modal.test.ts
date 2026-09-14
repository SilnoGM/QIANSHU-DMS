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

test('两个入口以货件选择，选择与展开独立并保留动画', async () => {
  const source = await readFile(SOURCE, 'utf8')
  const parts = await readFile(new URL('../../src/components/business/QsFactoryShipmentModal/ShipmentParts.vue', import.meta.url), 'utf8')
  assert.match(source, /defaultShipmentSelection/u)
  assert.match(source, /全选未发货/u)
  assert.match(source, /<ShipmentParts/u)
  assert.match(source, /impact.selectedCount/u)
  assert.match(parts, /type="checkbox"/u)
  assert.match(parts, /@change="emit\('toggle', part.id\)"/u)
  assert.match(parts, /const expandedId = ref<string \| null>\(null\)/u)
  assert.match(parts, /:disabled="disabled \|\| !isPendingShipmentPart\(part\)"/u)
  assert.match(parts, /<FaCollapsible/u)
  assert.match(parts, /:max-count="3"/u)
  assert.match(parts, /transition-opacity duration-150/u)
  assert.match(parts, /shippedBy\?\.displayName/u)
})

test('采购发货使用最新详情核对基础唛头与货件，详情加载期间禁止提交', async () => {
  const source = await readFile(SOURCE, 'utf8')
  const page = await readFile(new URL('../../src/views/operations/purchase-orders/index.vue', import.meta.url), 'utf8')
  assert.match(source, /<slot name="purchase-content"/u)
  assert.match(page, /purchaseOrdersApi.getById\(targetId, controller.signal\)/u)
  assert.match(page, /<PurchaseShipmentSummary v-if="shipmentDetail" :detail="shipmentDetail"/u)
  assert.match(page, /epoch !== appAccountStore.authEpoch/u)
})

test('详情读取隔离过期响应，失败不留下可提交上下文，使用最新详情版本', async () => {
  const source = await readFile(new URL('../../src/views/operations/purchase-orders/index.vue', import.meta.url), 'utf8')
  const start = source.indexOf('async function retryPurchaseFactoryShipment():')
  const end = source.indexOf('function handlePendingAction(', start)
  assert.ok(start >= 0 && end > start)
  const body = source.slice(start, end)
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
