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
  const detailDrawerSource = await readFile(new URL('purchase-order-detail-drawer.vue', ROOT), 'utf8')

  assert.match(source, /const purchaseOrderSteps: StepsItem\[\]/u)
  assert.match(source, /title: '采购基础信息'/u)
  assert.match(source, /title: '采购产品与付款'/u)
  assert.match(source, /title: '唛头与备注'/u)
  assert.match(source, /title: '订单详情核对'/u)
  assert.match(source, /title = purchaseType === 'STOCK' \? '新增备货采购' : '新增采购订单'/u)
  assert.doesNotMatch(source, /新增销售关联采购/u)
  assert.match(source, /<FaSteps/u)
  assert.match(source, /:aria-label="`\$\{title\}填写步骤`"/u)
  assert.match(source, /data-testid="purchase-order-step-base"/u)
  assert.match(source, /data-testid="purchase-order-step-products-payment"/u)
  assert.match(source, /data-testid="purchase-order-step-mark-remark"/u)
  assert.match(source, /validatePurchaseOrderCreateStep/u)
  assert.match(source, /@click="previousStep"/u)
  assert.match(source, /@click="nextStep"/u)
  assert.match(source, /const STEP_VALIDATION_MESSAGE = '请先完成并修正当前步骤的必填资料'/u)
  assert.match(
    source,
    /function nextStep\(\): void \{[\s\S]*?if \(!result\.valid\) \{[\s\S]*?toast\.warning\(STEP_VALIDATION_MESSAGE\)[\s\S]*?focusFirstInvalidField\(result\.fieldErrors\)[\s\S]*?return/u,
  )
  assert.doesNotMatch(source, /formError\.value = '请先完成并修正当前步骤的必填资料'/u)
  assert.match(
    source,
    /function enterPurchaseOrderReview\(\): void \{[\s\S]*?toast\.warning\('部分采购资料未通过校验，请修正后再进入订单详情核对'\)/u,
  )
  assert.match(source, /import QsPurchaseOrderDesc from '@\/components\/business\/QsPurchaseOrderDesc\/index\.vue'/u)
  assert.match(source, /mapPurchaseOrderCreateToDesc/u)
  assert.match(source, /<QsPurchaseOrderDesc/u)
  assert.match(
    source,
    /<QsPurchaseOrderDesc[\s\S]*?class="border-0 rounded-none shadow-none md:rounded-xl"/u,
    '采购订单详情抽屉在桌面端必须沿用新详情组件的 rounded-xl',
  )
  assert.doesNotMatch(source, /<PurchaseOrderCreateReview/u)
  assert.match(detailDrawerSource, /import QsPurchaseOrderDesc from '@\/components\/business\/QsPurchaseOrderDesc\/index\.vue'/u)
  assert.match(detailDrawerSource, /mapPurchaseOrderDetailToDesc/u)
  assert.match(detailDrawerSource, /<QsPurchaseOrderDesc/u)
  assert.match(source, /data-testid="purchase-order-create-review"/u)
  assert.match(source, /purchase-order-create-layout--review/u)
  assert.match(source, /@click="returnToPurchaseOrderForm"/u)
  assert.match(source, /<QsGenericDrawer/u)
  assert.match(source, /title="已填采购订单详情"/u)
  assert.match(source, /parsePurchaseOrderCreateType\(route\.query\.type/u)
  assert.match(source, /auth\('purchase-orders:create-stock'\)/u)
  assert.match(source, /<PurchaseSourceSalesOrderSelector/u)
  assert.match(source, /:selected-order-id="selectedSalesOrder\?\.id \?\? null"/u)
  assert.match(source, /purchaseOrdersApi\.sourceSalesOrderLines/u)
  assert.match(source, /synchronizePurchaseOrderSourceLines/u)
  assert.match(source, /同步销售产品明细/u)
  assert.match(source, /<QsDictionarySelect/u)
  assert.match(source, /dictionary-code="service_provider\.supplier"/u)
  assert.match(source, /supplierCatalog\.resolve\(formModel\.supplierValue\)/u)
  assert.match(source, /\{\{ selectedSupplierDisplayLabel \}\}/u)
  assert.match(source, /<QsOrderProductLineEditor/u)
  assert.match(source, /<QsOrderProductLineEditor[\s\S]*?class="purchase-order-line-editor"/u)
  assert.match(
    source,
    /\.purchase-order-line-editor :deep\(\[data-column="reference-unit-price"\]\) \{[\s\S]*?width: 20rem;[\s\S]*?min-width: 20rem;/u,
    '采购创建页必须为采购定价输入保留金额、币种与下拉图标的完整宽度',
  )
  assert.match(
    source,
    /\.purchase-order-line-editor :deep\(\[data-slot="order-product-line-table"\]\) \{[\s\S]*?min-width: 137rem;/u,
    '加宽采购定价列时必须同步增加产品表最小宽度，不能挤压相邻列',
  )
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
  assert.match(
    paymentSource,
    /<dl class="[^"]*grid-cols-1[^"]*md:grid-cols-2[^"]*"/u,
    '付款约定在桌面端必须将定金与尾款并排展示，并在窄屏回退为单列',
  )
  assert.match(
    paymentSource,
    /采购总价独占整行[\s\S]*?md:col-span-2/u,
    '采购总价必须独占付款约定首行',
  )
  assert.match(source, /focusFirstInvalidField/u)
})

test('备货采购复用四步表单、实时详情与全屏核对，同时隔离销售来源能力', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')

  assert.match(source, /const steppedCreate = computed\(\(\) => purchaseType !== null\)/u)
  assert.match(source, /const salesLinkedCreate = computed\(\(\) => purchaseType === 'SALES_LINKED'\)/u)
  assert.doesNotMatch(source, /guidedCreate/u)
  assert.match(source, /'purchase-order-create-layout--form': steppedCreate && createSurface === 'form'/u)
  assert.match(source, /'purchase-order-create-layout--review': steppedCreate && createSurface === 'review'/u)
  assert.match(source, /<nav\s+v-if="steppedCreate"[\s\S]*?:aria-label="`\$\{title\}填写步骤`"/u)
  assert.match(source, /v-show="activeStep === 0"/u)
  assert.match(source, /:aria-label="salesLinkedCreate \? '采购基础信息与销售订单关联' : '采购基础信息'"/u)
  assert.match(source, /v-show="activeStep === 1"/u)
  assert.match(source, /v-show="activeStep === 2"/u)
  assert.doesNotMatch(source, /v-show="purchaseType === 'STOCK' \|\| activeStep/u)
  assert.match(source, /<FaCard\s+v-if="salesLinkedCreate"\s+title="销售订单关联"/u)
  assert.match(
    source,
    /<FaCard\s+v-if="salesLinkedCreate"[\s\S]*?:class="selectedSalesOrder !== null \? 'border-primary' : undefined"/u,
    '选择销售订单后，整个销售订单关联卡片必须使用主色边框反馈已关联状态',
  )
  assert.match(source, /<div v-if="salesLinkedCreate" class="mb-4/u)
  assert.doesNotMatch(source, /<aside v-if="purchaseType === 'STOCK'"/u)
  assert.match(source, /<aside\s+v-if="steppedCreate"[\s\S]*?data-testid="purchase-order-create-summary-column"/u)
  assert.match(source, /<QsGenericDrawer\s+v-if="steppedCreate"/u)
  assert.match(source, /function nextStep\(\): void \{[\s\S]*?!steppedCreate\.value/u)
  assert.match(source, /function requestSubmit\(\): void \{[\s\S]*?steppedCreate\.value && createSurface\.value !== 'review'/u)
  assert.match(source, /:catalog-product-addable="purchaseType === 'STOCK'"/u)
  assert.match(source, /:custom-product-addable="purchaseType === 'STOCK'"/u)
  assert.match(source, /v-if="salesLinkedCreate"[\s\S]*?同步销售产品明细/u)
})
