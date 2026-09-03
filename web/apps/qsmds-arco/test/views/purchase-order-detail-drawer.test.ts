import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购详情抽屉结构契约使用 Node.js 内置 runner。
import test from 'node:test'

const SOURCE = new URL(
  '../../src/views/operations/purchase-orders/purchase-order-detail-drawer.vue',
  import.meta.url,
)
const ACTIONS_SOURCE = new URL(
  '../../src/views/operations/purchase-orders/purchase-order-detail-actions.vue',
  import.meta.url,
)

test('采购详情抽屉由采购订单详情组件展示订单，并保留付款、凭证和状态历史', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /<QsGenericDrawer/u)
  assert.match(source, /purchaseOrdersApi\.getById/u)
  assert.match(source, /<QsPurchaseOrderDesc/u)
  assert.match(source, /mapPurchaseOrderDetailToDesc/u)
  assert.match(source, /props\.order\?\.lineSummary\.previews \?\? \[\]/u)
  assert.match(source, /实际付款/u)
  assert.match(source, /付款凭证/u)
  assert.match(source, /状态历史/u)
  assert.match(source, /<AmountDisplay/u)
  assert.match(source, /<DateTimeDisplay/u)
})

test('采购详情动作精确受 update、payment 和 document 权限控制', async () => {
  const source = await readFile(ACTIONS_SOURCE, 'utf8')

  assert.match(source, /auth\('purchase-orders:update'\)/u)
  assert.match(source, /auth\('purchase-orders:payment'\)/u)
  assert.match(source, /auth\('purchase-orders:document'\)/u)
  assert.match(source, /purchaseOrdersApi\.updateOrderStatus/u)
  assert.match(source, /purchaseOrdersApi\.updateFulfillmentStatus/u)
  assert.match(source, /purchaseOrdersApi\.recordPayment/u)
  assert.match(source, /purchaseOrdersApi\.voidPayment/u)
  assert.match(source, /purchaseOrdersApi\.uploadTemporaryDocument/u)
  assert.match(source, /purchaseOrdersApi\.detachDocument/u)
  assert.match(source, /purchaseOrdersApi\.getDocumentContent/u)
  assert.match(source, /dictionary-code="payment\.method"/u)
  assert.match(source, /不存在凭证也可记录付款/u)
})

test('采购列表查看使用详情抽屉，取消则独立读取最新详情并直接打开确认弹窗', async () => {
  const source = await readFile(new URL(
    '../../src/views/operations/purchase-orders/index.vue',
    import.meta.url,
  ), 'utf8')

  assert.match(source, /<PurchaseOrderDetailDrawer/u)
  assert.match(source, /<PurchaseOrderDetailActions/u)
  assert.match(source, /:action-column=/u)
  assert.match(source, /<template #actions=/u)
  assert.match(source, /openPurchaseOrderDetail/u)
  assert.match(source, /loadPurchaseOrderForCancellation/u)
  assert.match(source, /purchaseOrdersApi\.getById/u)
  assert.match(source, /cancelActionsRef\.value\?\.openCancelDialog\(\)/u)
  assert.match(source, /@click="openPurchaseOrderCancellation\(row\)"/u)
  assert.doesNotMatch(source, /openPurchaseOrderDetail\(row, 'cancel'\)/u)
  assert.doesNotMatch(source, /:initial-action=/u)
  assert.match(source, /@detail-updated=/u)

  const drawerSource = await readFile(SOURCE, 'utf8')
  assert.doesNotMatch(drawerSource, /PurchaseOrderDetailInitialAction/u)
  assert.doesNotMatch(drawerSource, /initialAction/u)
  assert.doesNotMatch(drawerSource, /<template #footer>/u)
  assert.doesNotMatch(drawerSource, />\s*取消订单\s*</u)
  assert.doesNotMatch(drawerSource, />\s*推进至/u)
})
