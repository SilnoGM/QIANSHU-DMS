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

test('采购查看入口使用独立抽屉，保留请求取消且不提供付款入口', async () => {
  const source = await readFile(SOURCE, 'utf8')

  assert.match(source, /<QsPurchaseOrderDrawer/u)
  assert.match(source, /purchaseOrdersApi\.getById/u)
  assert.doesNotMatch(source, /QsPurchaseOrderDesc|QsGenericDrawer/u)
  assert.match(source, /detailAbortController\?\.abort\(\)/u)
  assert.doesNotMatch(source, /record-payment|openPaymentDialog|canManagePayment/u)
  assert.doesNotMatch(source, /openVoidDialog|openDetachDialog|downloadDocument/u)
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
  assert.equal((records.match(/v-if="!open" key="thumbnail"/gu) ?? []).length, 1)
  assert.match(records, /prefers-reduced-motion: reduce/u)
  assert.doesNotMatch(records, /canManagePayment|recordPayment/u)
  assert.match(document, /detachedAt === null/u)
  assert.match(document, /<ImageGroup/u)
  assert.match(history, /buildPurchaseOrderTimeline/u)
  assert.match(history, /revisionAmounts\(entry\.record\)/u)
  assert.match(history, /reasonNotRecorded/u)
})

test('付款记录展示对应凭证，保留未上传的历史空态', async () => {
  const records = await readFile(new URL('../../src/components/business/QsPurchaseOrderDrawer/OrderRecords.vue', import.meta.url), 'utf8')

  assert.doesNotMatch(records, /<section :aria-label="t\('purchaseOrderDrawer\.documents'\)"/u)
  assert.doesNotMatch(records, /expandedDocument/u)
  assert.match(records, /getPaymentDocuments\(props\.detail\.documents, payment\.id\)/u)
  assert.match(records, /v-if="!vouchers\.length" :title="t\('purchaseOrderDrawer\.noVoucher'\)"/u)
  assert.equal((records.match(/<OrderDocument\b/gu) ?? []).length, 1)
  assert.match(records, /<OrderDocument v-for="voucher in vouchers" :key="voucher\.id" :document="voucher" \/>/u)
})

test('订单凭证独立过滤，保留展开小图退场动画与权限控制的归档入口', async () => {
  const source = await readFile(new URL('../../src/components/business/QsPurchaseOrderDrawer/OrderDocuments.vue', import.meta.url), 'utf8')
  assert.match(source, /getOrderDocuments\(props\.detail\.documents\)/u)
  assert.match(source, /bg-primary shrink-0 h-5 w-1/u)
  assert.match(source, /v-if="!open" key="thumbnail"/u)
  assert.match(source, /prefers-reduced-motion: reduce/u)
  assert.match(source, /v-if="canAttachDocument && detail\.orderStatus !== 'PENDING_REVIEW'"/u)
  assert.match(source, /DELIVERY_RECEIPT/u)
  assert.doesNotMatch(source, /voidPayment|downloadDocument|detachDocument/u)
})

test('凭证弹窗限定归档类型，换单与退出登录取消请求、释放预览资源', async () => {
  const source = await readFile(new URL('../../src/views/operations/purchase-orders/purchase-order-document-modal.vue', import.meta.url), 'utf8')
  assert.match(source, /auth\('purchase-orders:document'\)/u)
  assert.match(source, /hasIssuance/u)
  assert.match(source, /purchaseOrdersApi\.attachDocument/u)
  assert.match(source, /controller\?\.abort\(\)/u)
  assert.match(source, /URL\.revokeObjectURL/u)
  assert.match(source, /account\.authEpoch/u)
  assert.match(source, /onBeforeUnmount\(reset\)/u)
  assert.match(source, /:submitting="busy"/u)
  assert.doesNotMatch(source, /updateFulfillmentStatus|recordPayment|paymentId/u)
})

test('采购抽屉移除作废、下载和解除入口，保留图片预览及历史状态', async () => {
  const read = (file: string) => readFile(new URL(`../../src/components/business/QsPurchaseOrderDrawer/${file}`, import.meta.url), 'utf8')
  const [drawer, records, document] = await Promise.all(['index.vue', 'OrderRecords.vue', 'OrderDocument.vue'].map(read))

  for (const source of [drawer, records, document]) {
    assert.doesNotMatch(source, /voidPayment|downloadDocument|detachDocument|canManageDocument/u)
  }
  assert.doesNotMatch(document, /<FaButton/u)
  assert.match(document, /previewSrc: props\.document\.contentUrl/u)
  assert.match(document, /<ImageGroup v-if="images\.length" :items="images"/u)
  assert.match(document, /v-if="document\.detachedAt"/u)
  assert.match(records, /v-if="payment\.voidedAt"/u)
  assert.match(records, /payment\.voidReason/u)
  assert.doesNotMatch(records, /recordPayment/u)
})

test('采购详情动作精确受 update、payment 和 document 权限控制', async () => {
  const source = await readFile(ACTIONS_SOURCE, 'utf8')

  assert.match(source, /auth\('purchase-orders:update'\)/u)
  assert.match(source, /auth\('purchase-orders:payment'\)/u)
  assert.match(source, /auth\('purchase-orders:document'\)/u)
  assert.match(source, /purchaseOrdersApi\.updateOrderStatus/u)
  assert.match(source, /purchaseOrdersApi\.updateFulfillmentStatus/u)
  assert.doesNotMatch(source, /purchaseOrdersApi\.recordPayment|submitPayment\(|activeDialog === 'payment'/u)
  assert.doesNotMatch(source, /openPaymentDialog|qsFinanceRealtimePurchasePayments/u)
  assert.match(source, /purchaseOrdersApi\.voidPayment/u)
  assert.match(source, /purchaseOrdersApi\.detachDocument/u)
  assert.match(source, /purchaseOrdersApi\.getDocumentContent/u)
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
