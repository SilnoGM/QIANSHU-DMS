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
  assert.match(source, /PurchaseOrderCurrencySummaryDto/u)
  assert.match(source, /const summariesByCurrency = ref<PurchaseOrderCurrencySummaryDto\[\]>\(\[\]\)/u)
  assert.match(source, /summariesByCurrency\.value = response\.data\.summariesByCurrency/u)
  assert.match(source, /buildPurchaseOrderListQuery/u)
  assert.match(source, /<FaPageHeader/u)
  assert.match(source, /<QsDateRangeFilter/u)
  assert.match(source, /<QsGenericTable/u)
  assert.match(
    source,
    /search-placeholder="搜索采购单号、销售单号、客户名或采购唛头"/u,
    '采购列表搜索提示应明确支持采购唛头',
  )
  assert.match(source, /service_provider\.supplier/u)
  assert.match(source, /auth\('purchase-orders:read'\)/u)
  assert.match(source, /auth\('purchase-orders:create'\)/u)
  assert.match(source, /auth\('purchase-orders:create-stock'\)/u)
  assert.match(source, />新增采购/u)
  assert.doesNotMatch(source, />新增销售关联采购/u)
  assert.match(source, /新增备货采购/u)
  assert.match(source, /v-if="canCreate && canCreateStock"/u)
  assert.match(source, /name: 'operationsPurchaseOrderCreate'/u)
  assert.match(source, /import QsPurchaseStartModal/u)
  assert.match(source, /@click="openPurchaseStart\('SALES_LINKED'\)"/u)
  assert.match(source, /@click="openPurchaseStart\('STOCK'\)"/u)
  assert.match(source, /class="min-h-\[44px\] sm:min-h-9"/u)
  assert.match(source, /query: buildPurchaseStartRouteQuery\(selection\)/u)
  assert.match(source, /catch \{[\s\S]*?toast\.error\('无法进入新增采购页面，请重试'\)[\s\S]*?purchaseStartVisible\.value = true/u)
  assert.match(source, /<QsPurchaseStartModal[\s\S]*?:purchase-type="purchaseStartType"[\s\S]*?@confirm="enterPurchaseCreate"/u)
  assert.match(source, /<AmountDisplay/u)
  assert.match(source, /<DateTimeDisplay/u)
  assert.match(source, /import QsPersonDisplay from '@\/components\/business\/QsPersonDisplay\/index\.vue'/u)
  assert.match(source, /#mobile-row/u)
  assert.match(
    source,
    /id: 'sourceSummary',\s+minWidth: 260,\s+title: '销售来源'/u,
    '销售来源列应为完整编号和复制按钮保留至少 260px',
  )
  assert.match(
    source,
    /<QsTableStackedLine tone="muted" content-class="qs-type-meta truncate" nowrap>\s+\{\{ row\.original\.customerName \?\? '不关联销售客户' \}\}/u,
    '桌面销售来源的客户名应复用采购订单第二行的弱化元信息样式',
  )
  assert.match(
    source,
    /<div class="qs-type-meta mt-1">\s+\{\{ row\.customerName \?\? '不关联销售客户' \}\}/u,
    '移动采购卡片的客户名应保持相同的弱化元信息样式',
  )
  assert.match(
    source,
    /id: 'supplierSummary',\s+minWidth: 120,\s+title: '供应商'/u,
    '采购列表供应商列最小宽度固定为 120px',
  )
  assert.match(
    source,
    /<template #cell-supplierSummary="\{ row \}">\s+<span class="font-medium">\s+\{\{ row\.original\.supplier\.label \}\}\s+<\/span>\s+<\/template>/u,
    '供应商应直接使用普通文字展示',
  )
  const supplierCell = source.match(
    /<template #cell-supplierSummary="\{ row \}">([\s\S]*?)<\/template>/u,
  )
  assert.ok(supplierCell, '应存在供应商单元格插槽')
  assert.doesNotMatch(supplierCell[1] ?? '', /<FaTag/u, '供应商不应继续使用标签样式')
  assert.match(
    source,
    /id: 'supplierSummary',[\s\S]*?id: 'buyerSummary',\s+minWidth: 140,\s+title: '采购人'[\s\S]*?id: 'productSummary'/u,
    '采购人列必须位于供应商与产品之间，并为头像和姓名保留至少 140px',
  )
  assert.match(
    source,
    /<template #cell-buyerSummary="\{ row \}">[\s\S]*?<QsPersonDisplay[\s\S]*?:display-name="row\.original\.createdBy\.displayName"[\s\S]*?size="md"[\s\S]*?class="max-w-\[9rem\]"/u,
    '桌面采购人列必须使用 QsPersonDisplay 展示 createdBy',
  )
  assert.match(
    source,
    /采购人[\s\S]*?<QsPersonDisplay[\s\S]*?:display-name="row\.createdBy\.displayName"[\s\S]*?size="md"[\s\S]*?class="max-w-full"/u,
    '移动采购卡片必须使用 QsPersonDisplay 展示采购人',
  )
  assert.match(
    source,
    /id: 'amountSummary',\s+minWidth: 200,\s+title: '采购金额'[\s\S]*?id: 'termsSummary',\s+minWidth: 240,\s+title: '付款约定'[\s\S]*?id: 'paymentAmountSummary',\s+minWidth: 240,\s+title: '实际付款'/u,
    '采购金额、付款约定与实际付款列分别保留至少 200px、240px 和 240px',
  )
  assert.match(source, /订单状态/u)
  assert.doesNotMatch(source, /key: 'orderStatus'/u)
  assert.match(source, /履约状态/u)
  assert.match(source, /付款状态/u)
  assert.match(source, /<template #summary>/u)
  assert.match(source, /data-testid="purchase-order-summary-matrix"/u)
  assert.match(source, /data-testid="purchase-order-summary-desktop"/u)
  assert.match(source, /data-testid="purchase-order-summary-mobile"/u)
  assert.match(source, /共 \{\{ total \}\} 张订单/u)
  assert.match(source, />\s*采购价\s*</u)
  assert.match(source, />\s*本单采购\s*</u)
  assert.match(source, />\s*采购定价\s*</u)
  assert.match(source, />\s*付款约定\s*</u)
  assert.match(source, />\s*已付\s*</u)
  assert.match(source, />\s*待付\s*</u)
  assert.match(source, /formatPurchaseOrderSummaryAmount/u)
})

test('采购列表展示可复制唛头、备注和可复制销售来源', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(
    source,
    /id: 'statusSummary',[\s\S]*?id: 'shippingMarkSummary',\s+minWidth: 200,\s+title: '采购唛头'[\s\S]*?id: 'remarkSummary',\s+minWidth: 240,\s+title: '备注'[\s\S]*?id: 'auditSummary'/u,
    '采购唛头与备注应连续位于订单状态和审计信息之间',
  )
  const markRemarkColumns = source.match(
    /id: 'shippingMarkSummary',([\s\S]*?)id: 'auditSummary'/u,
  )
  assert.ok(markRemarkColumns, '应存在采购唛头与备注列定义')
  assert.doesNotMatch(
    markRemarkColumns[1] ?? '',
    /defaultVisible: false/u,
    '采购唛头与备注均应默认显示',
  )

  const sourceCell = source.match(
    /<template #cell-sourceSummary="\{ row \}">([\s\S]*?)<template #cell-supplierSummary/u,
  )
  assert.ok(sourceCell, '应存在销售来源单元格')
  assert.match(sourceCell[1] ?? '', /<QsTableStackedCell class="group">/u)
  assert.match(sourceCell[1] ?? '', /qs-type-data-emphasis font-mono/u)
  assert.match(
    sourceCell[1] ?? '',
    /<CopyCellButton[\s\S]*?label="销售订单号"[\s\S]*?:text="row\.original\.salesOrderNo \?\? ''"/u,
    '销售订单号应复用列表复制按钮',
  )
  assert.match(
    sourceCell[1] ?? '',
    /<QsTableStackedLine tone="muted" content-class="qs-type-meta truncate" nowrap>[\s\S]*?row\.original\.customerName/u,
    '客户名应使用与采购订单第二行一致的弱化元信息样式',
  )

  const markCell = source.match(
    /<template #cell-shippingMarkSummary="\{ row \}">([\s\S]*?)<template #cell-remarkSummary/u,
  )
  assert.ok(markCell, '应存在采购唛头单元格')
  assert.match(markCell[1] ?? '', /<PurchaseOrderShippingMarksCell :order="row\.original"/u)

  const remarkCell = source.match(
    /<template #cell-remarkSummary="\{ row \}">([\s\S]*?)<template #cell-auditSummary/u,
  )
  assert.ok(remarkCell, '应存在备注单元格')
  assert.match(remarkCell[1] ?? '', /\{\{ row\.original\.remark \?\? '-' \}\}/u)

  assert.match(
    source,
    /销售来源[\s\S]*?<CopyCellButton[\s\S]*?always-visible[\s\S]*?label="销售订单号"[\s\S]*?:text="row\.salesOrderNo \?\? ''"[\s\S]*?\{\{ row\.customerName \?\? '不关联销售客户' \}\}/u,
    '移动端销售来源应上下展示订单号、复制按钮和正常客户名',
  )
  assert.match(
    source,
    /采购唛头[\s\S]*?<PurchaseOrderShippingMarksCell :order="row"/u,
    '移动端采购唛头应复用点击查看和复制组件',
  )
  assert.match(source, /备注[\s\S]*?\{\{ row\.remark \?\? '-' \}\}/u)
})

test('全部与待办采购均使用带计数的状态工具栏', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(source, /import QsStatusSwitchToolbar from '@\/components\/business\/QsStatusSwitchToolbar\/index\.vue'/u)
  assert.match(source, /purchaseOrdersApi\.statusCounts/u)
  assert.match(source, /withStatusSwitchCounts/u)
  assert.match(source, /buildPurchaseOrderStatusCountsQuery/u)
  assert.match(source, /let countRequestVersion = 0/u)
  assert.match(source, /countAbortController/u)
  assert.match(source, /import \{ useQsToast \} from '@\/components\/base\/QsToast\/useQsToast'/u)
  assert.match(source, /<QsStatusSwitchToolbar[\s\S]*?v-model="selectedStatus"[\s\S]*?:items="statusItems"/u)
  assert.doesNotMatch(source, /<QsStatusSwitchToolbar[^>]*v-if=/u)
  assert.match(source, /:aria-label="`\$\{pageTitle\}状态筛选`"/u)
  assert.match(source, /props\.viewMode === 'pending'/u)
  assert.match(source, /resolvePurchaseOrderPendingActions/u)
  assert.match(source, /import QsFactoryShipmentModal from '@\/components\/business\/QsFactoryShipmentModal\/index\.vue'/u)
  assert.match(source, /purchaseOrdersApi\.factoryShipment/u)
  assert.match(source, /if \(action\.key === 'SHIPMENT'\)/u)
  assert.match(source, /openPurchaseFactoryShipment\(order\)/u)
  assert.match(source, /@click="handlePendingAction\(action, row\)"/u)
  assert.match(source, /<QsFactoryShipmentModal[\s\S]*?mode="PURCHASE_ORDER"/u)
  assert.match(source, /@submit="submitPurchaseFactoryShipment"/u)
  assert.match(source, /formatPurchaseFactoryShipmentSuccess/u)
  assert.match(
    source,
    /toast\.info\(`\$\{action\.label\}功能正在建设中`\)/u,
    '到仓和付款仍应保持建设中提示',
  )
  assert.match(source, />发货|action\.label/u)
  assert.match(source, /canCancelPurchaseOrderFromList\(row\)/u)
  assert.match(source, /openPurchaseOrderCancellation\(row\)/u)
  assert.match(source, /cancelLoadingOrderId === row\.id/u)
  assert.match(source, /cancelActionsRef/u)
  assert.doesNotMatch(source, /openPurchaseOrderDetail\(row, 'cancel'\)/u)
  assert.match(source, /i-lucide:circle-x/u)
  assert.doesNotMatch(
    source,
    /v-else-if="canUpdate && nextPurchaseOrderFulfillmentStatus\(row\)"/u,
  )
  assert.doesNotMatch(source, /props\.viewMode === 'all' && canManagePayment/u)
})

test('采购日期范围位于搜索框前并以内嵌叉号清除', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')
  const tableStart = source.indexOf('<QsGenericTable')
  const queryLeadingStart = source.indexOf('<template #query-leading>', tableStart)
  const dateFilterStart = source.indexOf('<QsDateRangeFilter', queryLeadingStart)

  assert.match(source, /import QsDateRangeFilter from '@\/components\/business\/QsDateRangeFilter\/index\.vue'/u)
  assert.ok(tableStart >= 0, '应存在采购通用表格')
  assert.ok(queryLeadingStart > tableStart, '采购日期筛选应进入通用表格查询前置插槽')
  assert.ok(dateFilterStart > queryLeadingStart, '查询前置插槽应渲染日期筛选组件')
  assert.match(source, /v-model="dateRange"/u)
  assert.match(source, /calendar-label="采购日期范围"/u)
  assert.match(source, /placeholder="采购日期范围"/u)
  assert.match(source, /@complete="handleDateRangeComplete"/u)
  assert.match(source, /@clear="clearDateRange"/u)
  assert.doesNotMatch(source, /dateRangePickerOpen|dateRangeLabel|purchase-order-date-filter/u)
  assert.doesNotMatch(source, /:deep\(\.qs-generic-table > div:first-child\)/u)
})

test('采购列表使用销售列表同构的三槽产品主图与产品提示', async () => {
  const source = await readFile(new URL('index.vue', ROOT), 'utf8')

  assert.match(source, /PurchaseOrderLinePreviewDto/u)
  assert.match(source, /import type \{ ImageGroupItem \} from '@\/components\/base\/ImageGroup\/types'/u)
  assert.match(source, /import ImageGroup from '@\/components\/base\/ImageGroup\/index\.vue'/u)
  assert.match(source, /import QsGoodTooltipContent from '@\/components\/business\/QsGoodTooltip\/QsGoodTooltipContent\.vue'/u)
  assert.match(
    source,
    /id: 'buyerSummary',[\s\S]*?id: 'productSummary',\s+minWidth: 160,\s+title: '产品'[\s\S]*?id: 'amountSummary'/u,
    '产品列必须位于采购人与采购金额之间，并固定为 160px',
  )
  assert.match(source, /function productImageItems\(row: PurchaseOrderListItemDto\): readonly ImageGroupItem\[\]/u)
  assert.match(source, /row\.lineSummary\.previews\.flatMap/u)
  assert.match(source, /key: preview\.lineId/u)
  assert.match(source, /function resolveProductPreview\([\s\S]*?row\.lineSummary\.previews\.find\(preview => preview\.lineId === item\.key\)/u)
  assert.match(source, /<template #cell-productSummary="\{ row \}">/u)
  assert.equal(
    [...source.matchAll(/<ImageGroup[\s\S]*?:max-count="3"[\s\S]*?:size="40"[\s\S]*?radius="md"/gu)].length,
    2,
    '桌面表格与移动卡片必须各复用一次三槽图片组',
  )
  assert.equal(
    [...source.matchAll(/<QsGoodTooltipContent/gu)].length,
    2,
    '桌面和移动图片均应展示同构产品提示',
  )
  assert.match(source, />采购产品</u)
  assert.match(source, /<dt class="qs-type-compact-label mb-1">\s+产品\s+<\/dt>[\s\S]*?<ImageGroup :items="productImageItems\(row\)"/u)
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
  assert.match(source, /title: '预定义货物件'/u)
  assert.match(source, /<QsPartConfigurator/u)
  assert.match(source, /:products="partProducts"/u)
  assert.match(source, /parts: partConfigurations\.value/u)
  assert.match(source, /reconcilePurchaseOrderParts\(formModel\.lines, partConfigurations\.value\)/u)
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
    /function nextStep\(\): void \{[\s\S]*?if \(!result\.valid\) \{[\s\S]*?toast\.warning\(step === 2 && result\.fieldErrors\.parts \? result\.fieldErrors\.parts : STEP_VALIDATION_MESSAGE\)[\s\S]*?focusFirstInvalidField\(result\.fieldErrors\)[\s\S]*?return/u,
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
  assert.match(detailDrawerSource, /import QsPurchaseOrderDrawer from '@\/components\/business\/QsPurchaseOrderDrawer\/index\.vue'/u)
  assert.match(detailDrawerSource, /<QsPurchaseOrderDrawer/u)
  assert.doesNotMatch(detailDrawerSource, /mapPurchaseOrderDetailToDesc|<QsPurchaseOrderDesc/u)
  assert.match(source, /data-testid="purchase-order-create-review"/u)
  assert.match(source, /purchase-order-create-layout--review/u)
  assert.match(source, /@click="returnToPurchaseOrderForm"/u)
  assert.match(source, /<QsGenericDrawer/u)
  assert.match(source, /title="已填采购订单详情"/u)
  assert.match(source, /parsePurchaseOrderCreateContext\(\{/u)
  assert.match(source, /productMode: route\.query\.productMode/u)
  assert.match(source, /supplierValue: route\.query\.supplierValue/u)
  assert.match(source, /customSupplierName: route\.query\.customSupplierName/u)
  assert.match(source, /toast\.warning\('当前入口无效或缺少创建该类型采购订单的权限'\)/u)
  assert.match(source, /auth\('purchase-orders:create-stock'\)/u)
  assert.match(source, /<PurchaseSourceSalesOrderSelector/u)
  assert.match(source, /:product-mode="productMode \?\? 'CATALOG'"/u)
  assert.match(source, /:supplier-value="formModel\.supplierValue"/u)
  assert.match(source, /:selected-order-id="selectedSalesOrder\?\.id \?\? null"/u)
  assert.match(source, /purchaseOrdersApi\.sourceSalesOrderLines/u)
  assert.match(source, /synchronizePurchaseOrderSourceLines/u)
  assert.match(source, /同步销售产品明细/u)
  assert.match(source, /<QsDictionarySelect/u)
  assert.match(source, /<FaInput[\s\S]*?aria-label="供应商名称"/u)
  assert.match(source, /@blur="requestCustomSupplierChange"/u)
  assert.match(source, /title="确认更换供应商？"/u)
  assert.match(source, /formModel\.depositDueAmount = null/u)
  assert.match(source, /formModel\.balanceDueAmount = null/u)
  assert.match(source, /selectedSalesOrder\.value = null/u)
  assert.match(source, /pendingSupplierChange/u)
  assert.match(source, /dictionary-code="service_provider\.supplier"/u)
  assert.match(source, /supplierCatalog\.resolve\(formModel\.supplierValue\)/u)
  assert.match(source, /\{\{ selectedSupplierDisplayLabel \}\}/u)
  assert.match(source, /<QsOrderProductLineEditor/u)
  assert.match(source, /<QsOrderProductLineEditor[\s\S]*?class="purchase-order-line-editor"/u)
  assert.match(
    source,
    /const purchasedSourceLines = shallowRef<readonly OrderProductLineReadOnlyModel\[\]>\(\[\]\)/u,
    '采购创建页必须独立保存已采购的只读来源行',
  )
  assert.match(source, /purchasedSourceLines\.value = result\.readOnlyLines\.map/u)
  assert.match(source, /:read-only-lines="purchasedSourceLines"/u)
  assert.match(
    source,
    /function buildCurrentSource\(\) \{[\s\S]*?lines: formModel\.lines,/u,
    '已采购历史行不能进入本单校验、金额计算或提交 DTO',
  )
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
  assert.match(source, /:catalog-product-addable="purchaseType === 'STOCK' && productMode === 'CATALOG'"/u)
  assert.match(source, /:custom-product-addable="purchaseType === 'STOCK' && productMode === 'CUSTOM'"/u)
  assert.match(source, /custom-reference-unit-price-editable/u)
  assert.match(source, /采购定价/u)
  assert.match(source, /本单采购价/u)
  assert.match(source, /<PurchaseOrderPaymentTerms/u)
  assert.match(
    source,
    /:maximum-quantity-by-key="maximumQuantityByKey"/u,
    '采购产品编辑器必须接收销售明细剩余可采购数量，备货采购传入空映射时保持无来源上限',
  )
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

test('销售关联采购仅在切换不同订单时重置产品和付款依赖', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')
  const handlerStart = source.indexOf('async function selectSourceSalesOrder(')
  const handlerEnd = source.indexOf('async function loadAllSupplierProducts(', handlerStart)
  const handlerSource = source.slice(handlerStart, handlerEnd)

  assert.match(handlerSource, /const previousSalesOrderId = selectedSalesOrder\.value\?\.id \?\? null/u)
  assert.match(
    handlerSource,
    /const sourceChanged = previousSalesOrderId !== null\s+&& previousSalesOrderId !== item\.id/u,
    '首次选择和重选同一订单不得清空已经填写的下游资料',
  )
  assert.match(
    handlerSource,
    /if \(sourceChanged\) \{[\s\S]*?formModel\.lines = \[\][\s\S]*?formModel\.depositDueAmount = null[\s\S]*?formModel\.balanceDueAmount = null[\s\S]*?sourceSalesOrderLineIdByKey\.value = \{\}[\s\S]*?maximumQuantityByKey\.value = \{\}/u,
    '切换不同销售订单必须原子清空产品、定金、尾款和销售明细映射',
  )
  assert.match(
    handlerSource,
    /toast\.info\('销售订单已更换，请重新同步产品明细并填写付款约定'\)/u,
  )
})

test('采购分步表单不允许 FaForm 回写并删除显式绑定的产品和付款字段', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')
  const formStart = source.indexOf('<FaForm')
  const formEnd = source.indexOf('>', formStart)
  const formTagSource = source.slice(formStart, formEnd + 1)

  assert.doesNotMatch(
    formTagSource,
    /:model="formModel"/u,
    '产品、定金和尾款未注册为 FaFormItem，FaForm 回写外部 model 会把它们删除为 undefined',
  )
})

test('采购基础信息在桌面端按两行两列排列', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')

  assert.match(source, /content-class="gap-4 grid grid-cols-1 md:grid-cols-2"/u)
  assert.doesNotMatch(
    source,
    /<div class="[^"]*md:col-span-2[^"]*">\s*<p[^>]*>\s*采购订单号/u,
    '采购订单号不应独占整行，应与采购产品类型并排',
  )
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
  assert.doesNotMatch(
    source,
    /<FaCard\s+v-if="salesLinkedCreate"[^>]*:class=/u,
    '销售订单已关联状态不能改变外层功能卡片边框',
  )
  assert.match(
    source,
    /class="p-4 border rounded-xl bg-muted\/20[^"]*"\s+:class="selectedSalesOrder !== null \? 'border-primary' : 'border-border'"/u,
    '选择销售订单后，必须仅把内部订单摘要框切换为主色边框',
  )
  assert.match(
    source,
    /variant="default"/u,
    '选择与重选均必须使用实心按钮结构',
  )
  assert.match(
    source,
    /selectedSalesOrder !== null \? 'border-amber-500 bg-amber-500 text-white hover:border-amber-600 hover:bg-amber-600 hover:text-white' : ''/u,
    '已关联的重选按钮必须使用黄色实心状态与白色文字',
  )
  assert.match(
    source,
    /:name="selectedSalesOrder === null \? 'i-lucide:search' : 'i-lucide:arrow-left-right'"/u,
    '首次选择使用搜索图标，重选使用切换销售来源图标',
  )
  assert.match(
    source,
    /\{\{ selectedSalesOrder === null \? '选择销售订单' : '重选销售订单' \}\}/u,
    '销售订单关联按钮必须按是否已关联切换文字',
  )
  assert.match(source, /<div v-if="salesLinkedCreate" class="mb-4/u)
  assert.doesNotMatch(source, /<aside v-if="purchaseType === 'STOCK'"/u)
  assert.match(source, /<aside\s+v-if="steppedCreate"[\s\S]*?data-testid="purchase-order-create-summary-column"/u)
  assert.match(source, /<QsGenericDrawer\s+v-if="steppedCreate"/u)
  assert.match(source, /function nextStep\(\): void \{[\s\S]*?!steppedCreate\.value/u)
  assert.match(source, /function requestSubmit\(\): void \{[\s\S]*?steppedCreate\.value && createSurface\.value !== 'review'/u)
  assert.match(source, /:catalog-product-addable="purchaseType === 'STOCK' && productMode === 'CATALOG'"/u)
  assert.match(source, /:custom-product-addable="purchaseType === 'STOCK' && productMode === 'CUSTOM'"/u)
  assert.match(source, /v-if="salesLinkedCreate"[\s\S]*?同步销售产品明细/u)
})

test('销售快捷入口只在首次挂载时可信绑定且允许手工改选', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')

  assert.match(source, /parsePurchaseOrderCreateContext/u)
  assert.match(source, /const sourceShortcut = createContext\?\.sourceShortcut \?\? null/u)
  assert.match(source, /route\.query\.salesOrderId/u)
  assert.match(source, /route\.query\.salesOrderNo/u)
  assert.match(source, /let shortcutAbortController: AbortController \| null = null/u)
  assert.match(source, /let shortcutLookupStarted = false/u)
  assert.match(
    source,
    /purchaseOrdersApi\.sourceSalesOrders\(\{[\s\S]*?keyword: sourceShortcut\.salesOrderNo[\s\S]*?page: 1[\s\S]*?pageSize: 100/u,
  )
  assert.match(source, /productMode: productMode!/u)
  assert.match(
    source,
    /const shortcutViews = \['UNPURCHASED', 'PARTIALLY_PURCHASED'\] as const[\s\S]*?purchaseOrdersApi\.sourceSalesOrders\(\{[\s\S]*?view,/u,
    '待采购销售订单快捷入口必须依次使用未采购和部分采购的可信服务端筛选',
  )
  assert.match(
    source,
    /item\.id === sourceShortcut\.salesOrderId[\s\S]*?item\.orderNo === sourceShortcut\.salesOrderNo/u,
    '自动来源必须同时精确匹配订单 ID 和订单号',
  )
  assert.match(
    source,
    /selectedSalesOrder\.value !== null[\s\S]*?return[\s\S]*?selectSourceSalesOrder\(candidate\)/u,
    '自动查询不得覆盖用户已经选择的销售订单',
  )
  assert.match(source, /销售订单自动关联失败，请手工选择销售订单/u)
  assert.match(
    source,
    /onMounted\(\(\) => \{[\s\S]*?bindSourceSalesOrderFromShortcut\(\)/u,
    '自动绑定只应由首次挂载触发，不监听步骤或路由变化',
  )
  assert.match(source, /watch\(\(\) => appAccountStore\.authEpoch[\s\S]*?shortcutAbortController\?\.abort\(\)/u)
  assert.match(source, /onBeforeUnmount\(\(\) => \{[\s\S]*?shortcutAbortController\?\.abort\(\)/u)
})

test('销售来源无剩余产品时阻止进入无效同步流程', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')

  assert.match(
    source,
    /const sourceHasPurchasableLines = computed\(\(\) => hasPurchasablePurchaseOrderSourceLines\(sourceSalesOrderLines\.value\)\)/u,
  )
  assert.match(source, /sourceHasPurchasableLines\.value/u)
  assert.match(source, /该销售订单已无剩余可采购产品/u)
  assert.match(
    source,
    /function nextStep\(\): void \{[\s\S]*?activeStep\.value === 0[\s\S]*?salesLinkedCreate\.value[\s\S]*?!sourceHasPurchasableLines\.value[\s\S]*?return/u,
    '第一步必须阻止零剩余来源进入产品同步步骤',
  )
})

test('采购新增页不再提供销售产品修改或第三个来源视图', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')

  assert.doesNotMatch(source, /QsSalesOrderAddOnProductsModal/u)
  assert.doesNotMatch(source, /import salesOrdersApi/u)
  assert.doesNotMatch(source, /COMPLETED_PURCHASE_ADD_ON/u)
  assert.doesNotMatch(source, /salesOrdersApi\.addOnContext/u)
  assert.doesNotMatch(source, /salesOrdersApi\.appendAddOnLines/u)
  assert.doesNotMatch(source, /<FaMultiStepLoader/u)
  assert.doesNotMatch(source, /正在新增销售产品/u)
  assert.doesNotMatch(source, /完成销售订单金额变更/u)
  assert.doesNotMatch(source, /purchase-order-sales-add-on\.logic/u)
  assert.doesNotMatch(source, /can-add-sales-order-products/u)
  assert.match(source, /purchaseOrdersApi\.sourceSalesOrderLines/u)
  assert.match(source, /synchronizeSourceProducts/u)
})

test('销售快捷入口首次视图未命中时只回退部分采购视图', async () => {
  const source = await readFile(new URL('create.vue', ROOT), 'utf8')

  assert.match(source, /const shortcutViews = \['UNPURCHASED', 'PARTIALLY_PURCHASED'\] as const/u)
  assert.match(source, /for \(const view of shortcutViews\)/u)
  assert.doesNotMatch(source, /shortcutViews = \[[^\]]*COMPLETED_PURCHASE_ADD_ON/u)
})
