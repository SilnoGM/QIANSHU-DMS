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

test('采购查看入口使用独立抽屉，保留请求取消和既有操作事件', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /<QsPurchaseOrderDrawer/u)
  assert.match(source, /purchaseOrdersApi\.getById/u)
  assert.doesNotMatch(source, /QsPurchaseOrderDesc|QsGenericDrawer/u)
  assert.match(source, /detailAbortController\?\.abort\(\)/u)
  assert.match(source, /@record-payment="openPaymentDialog"/u)
  assert.match(source, /@void-payment="openVoidDialog"/u)
  assert.match(source, /@detach-document="openDetachDialog"/u)
  assert.match(source, /@download-document="downloadDocument"/u)
})

test('专用采购抽屉继承销售布局及动画，不引入销售业务字段', async () => {
  const read = (file: string) => readFile(new URL(`../../src/components/business/QsPurchaseOrderDrawer/${file}`, import.meta.url), 'utf8')
  const [drawer, information, records, document, history] = await Promise.all(['index.vue', 'OrderInformation.vue', 'OrderRecords.vue', 'OrderDocument.vue', 'OrderHistory.vue'].map(read))
  assert.match(drawer, /<FaDrawer/u)
  assert.match(drawer, /rounded-l-2xl/u)
  assert.match(drawer, /<FaTabs/u)
  assert.match(drawer, /watch\(activeTab/u)
  assert.match(drawer, /printNotice/u)
  assert.doesNotMatch(drawer, /QsSalesOrderDesc|QsPurchaseOrderDesc/u)
  assert.match(information, /actualPurchaseUnitPriceAmount/u)
  assert.match(information, /lineTotalAmount/u)
  assert.match(information, /shippingMarkText/u)
  assert.match(information, /QsPersonDisplay/u)
  assert.match(information, /bg-primary shrink-0 h-5 w-1/u)
  assert.doesNotMatch(information, /referencePurchaseUnitPriceAmount|actualUnitPriceAmount/u)
  assert.equal((records.match(/v-if="!open" key="thumbnail"/gu) ?? []).length, 2)
  assert.match(records, /prefers-reduced-motion: reduce/u)
  assert.match(records, /canManagePayment/u)
  assert.match(document, /detachedAt === null/u)
  assert.match(document, /<ImageGroup/u)
  assert.match(history, /buildPurchaseOrderTimeline/u)
  assert.doesNotMatch(history, /amountRevisions/u)
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
  assert.match(source, /props\.detail\.purchaseType === 'SALES_LINKED'/u)
  assert.match(source, /采购订单已取消，关联销售订单采购覆盖状态已重新计算/u)
  assert.match(source, /采购订单已取消/u)
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
