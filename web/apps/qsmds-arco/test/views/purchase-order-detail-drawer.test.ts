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

test('采购列表操作列可打开详情和已确认订单取消上下文', async () => {
  const source = await readFile(new URL(
    '../../src/views/operations/purchase-orders/index.vue',
    import.meta.url,
  ), 'utf8')

  assert.match(source, /<PurchaseOrderDetailDrawer/u)
  assert.match(source, /:action-column=/u)
  assert.match(source, /<template #actions=/u)
  assert.match(source, /openPurchaseOrderDetail/u)
  assert.match(source, /:initial-action="detailInitialAction"/u)
  assert.match(source, /@detail-updated=/u)

  const drawerSource = await readFile(SOURCE, 'utf8')
  assert.match(
    drawerSource,
    /PurchaseOrderDetailInitialAction = 'detail' \| 'fulfillment' \| 'payment' \| 'cancel'/u,
  )
  assert.match(drawerSource, /props\.initialAction === 'cancel'/u)
  assert.match(drawerSource, /detailActionsRef\.value\?\.openCancelDialog\(\)/u)
  assert.match(
    drawerSource,
    /<template #footer>[\s\S]*?<template v-if="detail">[\s\S]*?<FaButton v-if="canCancelOrder"/u,
  )
  assert.doesNotMatch(drawerSource, /<template v-if="detail" #footer>/u)
})
