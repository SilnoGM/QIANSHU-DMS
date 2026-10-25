import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购审核页面契约使用 Node.js 内置 runner。
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { nextTick, reactive, ref, watch } from 'vue'
import { normalizePurchaseOrderStatusSelection } from '../../src/views/operations/purchase-orders/purchase-order-list.logic'

const ROOT = new URL('../../src/views/operations/purchase-orders/', import.meta.url)
const read = (file: string) => readFile(new URL(file, ROOT), 'utf8')

test('采运工作台独立承担审核，运营全部采购提供取消但待办视图不提供', async () => {
  const source = await read('index.vue')
  const workbench = await readFile(new URL('../../src/views/workbenches/purchase-reviews/index.vue', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /PurchaseOrderReviewModal/u)
  assert.match(source, /auth\('purchase-orders:review'\)/u)
  assert.match(source, /@click="openPurchaseOrderDetail\(row\)"/u)
  assert.match(source, /openPurchaseOrderCancel/u)
  assert.match(
    source,
    /<template v-if="props\.viewMode === 'all'">[\s\S]*?:aria-label="`\$\{row\.orderNo\}：取消采购单`"/u,
  )
  assert.match(workbench, /auth\('purchase-orders:review'\)/u)
  assert.match(workbench, /row\.orderStatus === 'PENDING_REVIEW' && canReview/u)
  assert.match(workbench, /<PurchaseOrderReviewModal[\s\S]*?@detail-updated="refresh"/u)
  assert.match(workbench, /function refresh[\s\S]*?load\(\)[\s\S]*?loadCounts\(\)/u)
})

test('审核先取最新详情，二次确认才提交；失败重查并保留说明，换单或退出取消旧请求', async () => {
  const source = await read('purchase-order-review-modal.vue')
  assert.match(source, /<QsGenericModal/u)
  assert.match(source, /<FaMultiStepLoader[\s\S]*?:steps="image\.steps\.value"[\s\S]*?@error="generationFailed"/u)
  assert.match(source, /canGenerate\.value && image\.ready\.value/u)
  assert.match(source, /<PurchaseOrderReviewImage/u)
  assert.match(source, /purchaseOrdersApi\.getById\(orderId, controller\.signal\)/u)
  assert.match(source, /buildPurchaseOrderReviewRequest\(current, reason\.value, image\.draft\.value\)/u)
  assert.match(source, /purchaseOrdersApi\.review\(current\.id, result\.request, controller\.signal\)/u)
  assert.match(source, /if \(!canConfirm\.value \|\| current === null\)/u)
  assert.match(source, /:disabled="!canConfirm"[\s\S]*?@click="submit"/u)
  assert.match(source, /await loadDetail\(failureMessage\(failure\)\)/u)
  assert.match(source, /loadController\?\.abort\(\)/u)
  assert.match(source, /mutationController\?\.abort\(\)/u)
  assert.match(source, /account\.authEpoch, canReview\.value/u)
  const details = await read('purchase-order-review-details.vue')
  assert.match(source, /<PurchaseOrderReviewDetails[^>]*:detail="detail"/u)
  assert.match(details, /detail\.orderNo/u)
  assert.match(details, /detail\.supplier\.label/u)
  assert.match(details, /purchaseTotalAmount/u)
  assert.match(details, /actualPurchaseUnitPriceAmount/u)
})

test('采购详情不提供付款入口，审核中不能归档凭证，新建成功明确等待审核', async () => {
  const [actions, document, drawer, create] = await Promise.all([
    'purchase-order-detail-actions.vue',
    'purchase-order-document-modal.vue',
    'purchase-order-detail-drawer.vue',
    'create.vue',
  ].map(read))
  assert.doesNotMatch(actions, /openPaymentDialog|canRecordPayment/u)
  assert.match(document, /busy\.value \|\| !visible\.value \|\| props\.detail\.orderStatus === 'PENDING_REVIEW'/u)
  assert.match(drawer, /detail\.value\.orderStatus !== 'PENDING_REVIEW'/u)
  assert.match(create, /创建成功，已进入采购审核中/u)
})

test('采购两视图切换时旧实例不改写目标查询，返回自身路由仍刷新列表及计数', async () => {
  const source = await read('index.vue')
  const start = source.indexOf('watch(\n  () => [\n    props.viewMode,')
  assert.ok(start >= 0)
  const declaration = source.slice(start, source.indexOf('\nonMounted(', start)).trim()
  for (const mode of ['all', 'pending'] as const) {
    const ownName = mode === 'all' ? 'qsOperationsPurchaseOrders' : 'qsOperationsPendingPurchaseOrders'
    const otherName = mode === 'all' ? 'qsOperationsPendingPurchaseOrders' : 'qsOperationsPurchaseOrders'
    const ownQuery = mode === 'all' ? { status: 'PENDING_REVIEW' } : { task: 'AWAITING_REVIEW' }
    const otherQuery = mode === 'all' ? { task: 'AWAITING_REVIEW' } : { status: 'PENDING_REVIEW' }
    const route = reactive({ name: ownName, query: ownQuery })
    const replacements: string[] = []
    let listLoads = 0
    let countLoads = 0
    const stop = runInNewContext(ts.transpileModule(`const stop = ${declaration}; stop`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022 },
    }).outputText, {
      watch,
      props: { viewMode: mode },
      route,
      page: ref(1),
      normalizePurchaseOrderStatusSelection,
      router: { replace: async (value: unknown) => { replacements.push(JSON.stringify(value)) } },
      loadOrders: async () => { listLoads += 1 },
      loadStatusCounts: async () => { countLoads += 1 },
    }) as () => void
    try {
      route.name = otherName
      route.query = otherQuery
      await nextTick()
      assert.deepEqual(replacements, [], `${mode} 离开时不得删除目标视图的查询`)
      assert.equal(listLoads, 0)
      route.name = ownName
      route.query = ownQuery
      await nextTick()
      assert.deepEqual(replacements, [])
      assert.equal(listLoads, 1)
      assert.equal(countLoads, 1)
    }
    finally {
      stop()
    }
  }
})

test('审核弹窗提供驳回原因入口并提交最新版本', async () => {
  const source = await read('purchase-order-review-modal.vue')
  assert.match(source, /buildPurchaseOrderRejectRequest/u)
  assert.match(source, /purchaseOrdersApi\.reject/u)
  assert.match(source, /id="purchase-order-reject-reason"/u)
  assert.match(source, /t\('purchaseReview\.reject\.action'\)/u)
  assert.match(source, /purchaseReview\.recovery\.rejected/u)
  assert.match(source, /detail\.value\?\.rejection/u)
})
