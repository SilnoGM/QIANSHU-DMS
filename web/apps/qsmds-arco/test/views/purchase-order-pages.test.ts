import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
// eslint-disable-next-line test/no-import-node-test -- 采购订单 View 契约使用 Node.js 内置 runner。
import test from 'node:test'

const ROOT = new URL('../../src/views/operations/purchase-orders/', import.meta.url)

test('待办采购复用共享列表且固定 pending 语义', async () => {
  const source = await readFile(new URL('pending.vue', ROOT), 'utf8')

  assert.match(source, /import PurchaseOrderListPage from '.\/index\.vue'/u)
  assert.match(source, /<PurchaseOrderListPage view-mode="pending"/u)
})

test('采购列表接入真实查询、全量筛选、日期范围和双创建入口', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(source, /viewMode\?: PurchaseOrderListViewMode/u)
  assert.match(source, /purchaseOrdersApi\.list/u)
  assert.match(source, /buildPurchaseOrderListQuery/u)
  assert.match(source, /<FaPageHeader/u)
  assert.match(source, /<FaCalendarDateRange/u)
  assert.match(source, /<QsGenericTable/u)
  assert.match(source, /service_provider\.supplier/u)
  assert.match(source, /auth\('purchase-orders:read'\)/u)
  assert.match(source, /auth\('purchase-orders:create'\)/u)
  assert.match(source, /auth\('purchase-orders:create-stock'\)/u)
  assert.match(source, />新增采购/u)
  assert.doesNotMatch(source, />新增销售关联采购/u)
  assert.match(source, /新增备货采购/u)
  assert.match(source, /v-if="canCreate && canCreateStock"/u)
  assert.match(source, /name: 'operationsPurchaseOrderCreate'/u)
  assert.match(source, /@click="navigateCreate\('SALES_LINKED'\)"/u)
  assert.match(source, /@click="navigateCreate\('STOCK'\)"/u)
  assert.match(source, /class="min-h-\[44px\] sm:min-h-9"/u)
  assert.match(source, /query: \{ type \}/u)
  assert.match(source, /<AmountDisplay/u)
  assert.match(source, /<DateTimeDisplay/u)
  assert.match(source, /#mobile-row/u)
  assert.match(source, /订单状态/u)
  assert.match(source, /履约状态/u)
  assert.match(source, /付款状态/u)
})

test('采购创建页作为受保护隐藏路由并保持全部采购菜单激活', async () => {
  const router = await readFile(new URL(
    '../../src/router/modules/operations.workbench.ts',
    import.meta.url,
  ), 'utf8')

  assert.match(router, /path: 'purchase-orders\/create'/u)
  assert.match(router, /name: 'operationsPurchaseOrderCreate'/u)
  assert.match(router, /auth: 'purchase-orders:create'/u)
  assert.match(router, /activeMenu: '\/qs-operations\/purchase\/purchase-orders'/u)
  assert.match(router, /menu: false/u)
})

test('采购创建页按类型限制来源同步和手工新增，并固定 CNY 与幂等确认', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')
  const paymentSource = await readFile(new URL('purchase-order-payment-terms.vue', ROOT), 'utf8')

  assert.match(source, /const purchaseOrderSteps: StepsItem\[\]/u)
  assert.match(source, /title: '采购基础信息'/u)
  assert.match(source, /title: '采购产品与付款'/u)
  assert.match(source, /title: '唛头与备注'/u)
  assert.match(source, /title: '订单详情核对'/u)
  assert.match(source, /title = purchaseType === 'STOCK' \? '新增备货采购' : '新增采购订单'/u)
  assert.doesNotMatch(source, /新增销售关联采购/u)
  assert.match(source, /<FaSteps/u)
  assert.match(source, /aria-label="新增采购订单填写步骤"/u)
  assert.match(source, /data-testid="purchase-order-step-base"/u)
  assert.match(source, /data-testid="purchase-order-step-products-payment"/u)
  assert.match(source, /data-testid="purchase-order-step-mark-remark"/u)
  assert.match(source, /validatePurchaseOrderCreateStep/u)
  assert.match(source, /@click="previousStep"/u)
  assert.match(source, /@click="nextStep"/u)
  assert.match(source, /<PurchaseOrderCreateReview/u)
  assert.match(source, /data-testid="purchase-order-create-review"/u)
  assert.match(source, /purchase-order-create-layout--review/u)
  assert.match(source, /@click="returnToPurchaseOrderForm"/u)
  assert.match(source, /<QsGenericDrawer/u)
  assert.match(source, /title="已填采购订单详情"/u)
  assert.match(source, /parsePurchaseOrderCreateType\(route\.query\.type/u)
  assert.match(source, /auth\('purchase-orders:create-stock'\)/u)
  assert.match(source, /<PurchaseSourceSalesOrderSelector/u)
  assert.match(source, /purchaseOrdersApi\.sourceSalesOrderLines/u)
  assert.match(source, /synchronizePurchaseOrderSourceLines/u)
  assert.match(source, /同步销售产品明细/u)
  assert.match(source, /<QsDictionarySelect/u)
  assert.match(source, /dictionary-code="service_provider\.supplier"/u)
  assert.match(source, /supplierCatalog\.resolve\(formModel\.supplierValue\)/u)
  assert.match(source, /\{\{ selectedSupplierDisplayLabel \}\}/u)
  assert.match(source, /<QsOrderProductLineEditor/u)
  assert.match(source, /currency="CNY"/u)
  assert.match(source, /:catalog-product-addable="purchaseType === 'STOCK'"/u)
  assert.match(source, /:custom-product-addable="purchaseType === 'STOCK'"/u)
  assert.match(source, /custom-reference-unit-price-editable/u)
  assert.match(source, /采购定价/u)
  assert.match(source, /本单采购价/u)
  assert.match(source, /<PurchaseOrderPaymentTerms/u)
  assert.match(source, /采购总价/u)
  assert.match(source, /定金/u)
  assert.match(source, /尾款/u)
  assert.match(source, /采购唛头/u)
  assert.match(source, /beginPurchaseOrderSubmission/u)
  assert.match(source, /purchaseOrdersApi\.create/u)
  assert.match(source, /使用相同请求重新确认/u)
  assert.match(source, /onBeforeRouteLeave/u)
  assert.match(source, /data-testid="purchase-order-create-page"/u)
  assert.match(
    source,
    /<FaPageMain[\s\S]*?main-class="min-w-0 overflow-visible"/u,
    '双栏表单必须允许 FaPageMain 内层 flex item 收缩，超宽产品表只能在自身容器内滚动',
  )
  assert.match(
    source,
    /<FaForm[\s\S]*?class="grid-cols-\[minmax\(0,1fr\)\] min-w-0"/u,
    '表单的隐式 Grid 列必须使用 minmax(0, 1fr)，不能按产品表的最小内容宽度扩张',
  )
  assert.match(
    source,
    /data-testid="purchase-order-step-products-payment"[\s\S]*?<FaCard\s+class="min-w-0"/u,
    '采购产品步骤与产品卡片必须保持可收缩，表格横向滚动不能泄漏到页面布局',
  )
  assert.match(source, /<FaForm[\s\S]*?:model="formModel"/u)
  assert.match(paymentSource, /aria-label="定金"/u)
  assert.match(paymentSource, /aria-label="尾款"/u)
  assert.match(source, /focusFirstInvalidField/u)
})
