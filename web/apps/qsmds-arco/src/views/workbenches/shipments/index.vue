<script setup lang="ts">
import type { CalendarDateRangeValue } from '@fantastic-admin/components'
import type { ShipmentListQuery, ShipmentView } from './logic'
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableFilterDefinition, QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'
import { parseDate } from '@internationalized/date'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsDateRangeFilter from '@/components/business/QsDateRangeFilter/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsPurchaseOrderDrawer from '@/components/business/QsPurchaseOrderDrawer/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import PurchaseWarehouseReceiptAction from '@/views/operations/purchase-orders/purchase-warehouse-receipt-action.vue'
import { buildWarehouseFilterOptions, warehouseFilterFromQuery, warehouseFilterToQuery } from '../../operations/warehouse-arrivals/logic'
import { useWarehouseArrivalData } from '../../operations/warehouse-arrivals/use-warehouse-arrival-data'
import { buildShipmentRouteQuery, formatDestinationWarehouse, formatShipmentNumber, parseShipmentQuery, SHIPMENT_VIEWS, shipmentPlaceholderAction, shipmentStatusClass } from './logic'
import ShipmentDetailDrawer from './shipment-detail-drawer.vue'
import { getShipmentSourceEmptyKey } from './shipment-detail.logic'
import ShipmentProducts from './shipment-products.vue'

defineOptions({ name: 'QsPurchaseTransportShipments' })
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useQsToast()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const supplierCatalog = useDictionaryCatalog('service_provider.supplier')
const warehouseCatalog = useDictionaryCatalog('mainland.warehouse')
const warehouseActionRef = useTemplateRef<InstanceType<typeof PurchaseWarehouseReceiptAction>>('warehouseActionRef')
const canReceive = computed(() => auth('purchase-orders:update'))
const canRead = computed(() => auth('purchase-orders:read'))
const instancePath = route.fullPath
const activated = ref(false)
// Shell 按 fullPath 缓存页面。旧实例离开时立即停止读取，返回时再校验当前身份。
const enabled = computed(() => activated.value && canRead.value && route.name === 'qsPurchaseTransportShipments' && route.fullPath === instancePath)
const query = computed(() => parseShipmentQuery(route.query))
const activeView = computed(() => query.value.view ?? 'AWAITING_SHIPMENT')
const showWarehouseFilter = computed(() => activeView.value === 'WAREHOUSE_RECEIVED')
const activeWarehouse = computed(() => warehouseFilterFromQuery(query.value))
const warehouseOptions = computed(() => buildWarehouseFilterOptions(warehouseCatalog.catalog.value, query.value.destinationWarehouseValue, t))
// 仓库统计只供已到仓视图使用，其他视图继续只读取状态总数。
const warehouseValues = computed(() => showWarehouseFilter.value
  ? warehouseOptions.value.flatMap((item) => {
      const { destinationWarehouseValue } = warehouseFilterToQuery(item.value)
      return destinationWarehouseValue === undefined ? [] : [destinationWarehouseValue]
    })
  : [])
const keyword = ref(query.value.keyword ?? '')
const filters = ref<QsGenericTableFilterValues>({
  supplierValue: query.value.supplierValue,
  supplierSource: query.value.supplierSource,
  createdByUserId: query.value.createdByUserId,
  purchaseType: query.value.purchaseType,
})
const dateRange = shallowRef<CalendarDateRangeValue>({
  start: query.value.orderDateFrom ? parseDate(query.value.orderDateFrom) : undefined,
  end: query.value.orderDateTo ? parseDate(query.value.orderDateTo) : undefined,
})
const page = ref(query.value.page ?? 1)
const pageSize = ref(query.value.pageSize ?? 20)

const {
  rows,
  total,
  loading,
  error,
  counts,
  countsError,
  warehouseCounts,
  warehouseCountsError,
  buyerOptions,
  detail,
  orderDetail,
  detailKind,
  detailLoading,
  detailError,
  refresh,
  loadCounts,
  loadDetail,
  openShipment,
  openOrder,
} = useWarehouseArrivalData(enabled, computed(() => account.authEpoch), query, value => navigate({ ...query.value, page: value }, true), warehouseValues)
function navigate(next: ShipmentListQuery, replace = false): void {
  if (!enabled.value) {
    return
  }
  const location = { query: buildShipmentRouteQuery(next) }
  if (router.resolve(location).fullPath === route.fullPath) {
    refresh()
    return
  }
  if (replace) {
    void router.replace(location)
  }
  else {
    void router.push(location)
  }
}

const tabs = computed(() => SHIPMENT_VIEWS.map(value => ({
  value,
  label: t(`purchaseShipments.${value}`),
  count: countsError.value || counts.value.length === 0 ? undefined : counts.value.find(item => item.value === value)?.count ?? 0,
})))
const warehouseTabs = computed(() => warehouseOptions.value.map((item) => {
  const { destinationWarehouseValue } = warehouseFilterToQuery(item.value)
  const statusCounts = destinationWarehouseValue === undefined
    ? countsError.value || counts.value.length === 0 ? undefined : counts.value
    : warehouseCounts.value.find(warehouse => warehouse.value === destinationWarehouseValue)?.items
  // 请求失败或未完成时保持未知，不能以零冒充当前仓库数量。
  return { ...item, count: statusCounts === undefined ? undefined : statusCounts.find(status => status.value === 'WAREHOUSE_RECEIVED')?.count ?? 0 }
}))
const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => [
  { key: 'supplierValue', label: t('purchaseShipments.supplier'), options: (supplierCatalog.catalog.value?.items ?? []).map(item => ({ value: item.value, label: item.effectiveEnabled ? item.label : `${item.label}（${t('purchaseShipments.disabled')}）` })) },
  { key: 'supplierSource', label: t('purchaseShipments.supplierSource'), options: [{ value: 'DICTIONARY', label: t('purchaseShipments.dictionarySupplier') }, { value: 'CUSTOM_TEXT', label: t('purchaseShipments.customSupplier') }] },
  { key: 'createdByUserId', label: t('purchaseShipments.buyer'), options: buyerOptions.value.map(user => ({ value: user.id, label: user.displayName })) },
  { key: 'purchaseType', label: t('purchaseShipments.purchaseType'), options: ['SALES_LINKED', 'STOCK'].map(value => ({ value, label: t(`purchaseShipments.${value}`) })) },
])
const columns = computed<QsGenericTableColumn<PurchaseShipmentListItemDto>[]>(() => [
  { id: 'shipmentNo', title: t('purchaseShipments.shipmentNo'), accessorKey: 'shipmentNo', fixed: 'left', minWidth: 255 },
  { id: 'part', title: t('purchaseShipments.part'), accessorFn: row => `${row.purchaseOrder.orderNo} / ${formatShipmentNumber(row.partNumber)}`, minWidth: 260 },
  { id: 'mark', title: t('purchaseShipments.mark'), accessorKey: 'shippingMarkText', minWidth: 300 },
  { id: 'baseMark', title: t('purchaseShipments.baseMark'), accessorFn: row => row.purchaseOrder.shippingMarkText, minWidth: 245 },
  { id: 'status', title: t('purchaseShipments.status'), accessorFn: row => t(`purchaseShipments.${row.viewStatus}`), minWidth: 120 },
  { id: 'supplier', title: t('purchaseShipments.supplier'), accessorFn: row => row.supplier.label, minWidth: 160 },
  { id: 'source', title: t('purchaseShipments.source'), accessorFn: row => row.salesSource?.orderNo ?? t(getShipmentSourceEmptyKey(row.purchaseOrder.purchaseType)), minWidth: 250 },
  { id: 'products', title: t('purchaseShipments.products'), accessorFn: row => row.lineSummary.previews.map(item => item.productName).join('、'), minWidth: 200 },
  { id: 'buyer', title: t('purchaseShipments.buyer'), accessorFn: row => row.purchaseOrder.createdBy.displayName, minWidth: 160 },
  { id: 'shipped', title: t('purchaseShipments.shipped'), accessorKey: 'shippedAt', minWidth: 200 },
  { id: 'destinationWarehouse', title: t('purchaseShipments.destinationWarehouse'), accessorFn: row => formatDestinationWarehouse(row, t), minWidth: 180 },
  { id: 'received', title: t('purchaseWarehouseReceipt.receivedAt'), accessorKey: 'warehouseReceivedAt', minWidth: 200 },
  { id: 'loaded', title: t('purchaseShipments.loadedAt'), accessorKey: 'loadedAt', minWidth: 200, defaultVisible: false },
  { id: 'createdAt', title: t('purchaseShipments.createdAt'), accessorKey: 'createdAt', minWidth: 195, defaultVisible: false },
  { id: 'recordedAt', title: t('purchaseShipments.recordedAt'), accessorKey: 'shipmentRecordedAt', minWidth: 195, defaultVisible: false },
  { id: 'remark', title: t('purchaseShipments.remark'), accessorKey: 'shipmentRemark', minWidth: 220, defaultVisible: false },
])

function warehouseUpdated(): void {
  refresh()
  void loadDetail()
}

function handleTransportAction(row: { viewStatus: Exclude<ShipmentView, 'ALL'> }, action: 'loadContainer' | 'seaExpress' | 'sign' | null = shipmentPlaceholderAction(activeView.value, row.viewStatus)): void {
  if (!enabled.value || !canReceive.value) {
    return
  }
  const availableAction = shipmentPlaceholderAction(activeView.value, row.viewStatus)
  if (action && (action === availableAction || (action === 'seaExpress' && availableAction === 'loadContainer'))) {
    toast.info(t(`purchaseShipments.${action}Unavailable`))
  }
}

function selectTab(value: string | number): void {
  if (SHIPMENT_VIEWS.includes(value as typeof SHIPMENT_VIEWS[number])) {
    const { destinationWarehouseValue: _warehouse, ...current } = query.value
    navigate({ ...current, view: value as typeof SHIPMENT_VIEWS[number], page: 1 })
  }
}

function selectWarehouse(value: string): void {
  if (!showWarehouseFilter.value || !warehouseTabs.value.some(item => item.value === value)) {
    return
  }
  const { destinationWarehouseValue: _warehouse, ...current } = query.value
  navigate({ ...current, ...warehouseFilterToQuery(value), page: 1 })
}

function search(): void {
  // 自定义来源优先，避免筛选器保留的字典供应商与来源条件形成互斥请求。
  if (filters.value.supplierSource === 'CUSTOM_TEXT') {
    filters.value = { ...filters.value, supplierValue: undefined }
  }
  navigate({
    ...query.value,
    keyword: keyword.value.trim() || undefined,
    supplierValue: typeof filters.value.supplierValue === 'string' ? filters.value.supplierValue : undefined,
    supplierSource: filters.value.supplierSource as ShipmentListQuery['supplierSource'],
    createdByUserId: typeof filters.value.createdByUserId === 'string' ? filters.value.createdByUserId : undefined,
    purchaseType: filters.value.purchaseType as ShipmentListQuery['purchaseType'],
    orderDateFrom: dateRange.value.start?.toString(),
    orderDateTo: dateRange.value.end?.toString(),
    page: 1,
  })
}

function paginate(value: { page: number, pageSize: number }): void {
  navigate({ ...query.value, ...value })
}

const shipmentVisible = computed({ get: () => detailKind.value === 'shipment', set: (value) => {
  if (!value) {
    detailKind.value = null
  }
} })
const orderVisible = computed({ get: () => detailKind.value === 'order', set: (value) => {
  if (!value) {
    detailKind.value = null
  }
} })
let queuedOrderId: string | null = null
function viewOrderFromShipment(id: string): void {
  queuedOrderId = id
  detailKind.value = null
}
function shipmentClosed(): void {
  const id = queuedOrderId
  queuedOrderId = null
  if (id && enabled.value) {
    void openOrder(id)
  }
}
function emptyMark(row: PurchaseShipmentListItemDto): string {
  return t(row.status === 'PENDING_REVIEW' ? 'purchaseShipments.pendingMark' : 'purchaseShipments.missingMark')
}

// fullPath 缓存会保留导航前由 v-model 修改的草稿；返回时必须与 URL 查询重新对齐。
watch([enabled, query], ([isEnabled]) => {
  if (!isEnabled) {
    return
  }
  const current = query.value
  keyword.value = current.keyword ?? ''
  filters.value = {
    supplierValue: current.supplierValue,
    supplierSource: current.supplierSource,
    createdByUserId: current.createdByUserId,
    purchaseType: current.purchaseType,
  }
  dateRange.value = {
    start: current.orderDateFrom ? parseDate(current.orderDateFrom) : undefined,
    end: current.orderDateTo ? parseDate(current.orderDateTo) : undefined,
  }
  page.value = current.page ?? 1
  pageSize.value = current.pageSize ?? 20
}, { flush: 'sync' })

watch([enabled, () => account.authEpoch], () => {
  queuedOrderId = null
}, { flush: 'sync' })
onMounted(() => {
  activated.value = true
})
onActivated(() => {
  activated.value = true
})
onDeactivated(() => {
  activated.value = false
})
onBeforeUnmount(() => {
  activated.value = false
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.shipments')" :description="t('purchaseShipments.intro')" />
    <FaPageMain class="min-w-0">
      <FaEmpty v-if="!canRead" icon="i-lucide:shield-alert" :title="t('purchaseShipments.noPermission')" :description="t('purchaseShipments.noPermissionDescription')" class="py-12" />
      <template v-else>
        <FaAlert v-if="countsError" :title="t('purchaseShipments.countsError')" :description="t('purchaseShipments.countsErrorDescription')" variant="destructive" class="mb-4">
          <template #actions>
            <FaButton variant="outline" size="sm" @click="loadCounts">
              {{ t('purchaseShipments.retry') }}
            </FaButton>
          </template>
        </FaAlert>
        <FaAlert v-if="supplierCatalog.error.value" :title="t('purchaseShipments.supplierError')" :description="t('purchaseShipments.supplierErrorDescription')" variant="destructive" class="mb-4">
          <template #actions>
            <FaButton variant="outline" size="sm" @click="supplierCatalog.retry()">
              {{ t('purchaseShipments.retry') }}
            </FaButton>
          </template>
        </FaAlert>
        <QsStatusSwitchToolbar :model-value="activeView" :items="tabs" :aria-label="t('workbench.shipments')" class="mb-4" @update:model-value="selectTab" />
        <template v-if="showWarehouseFilter">
          <FaAlert v-if="warehouseCatalog.error.value" :title="t('warehouseArrivals.warehouseError')" variant="destructive" class="mb-4">
            <template #description>
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>{{ t('warehouseArrivals.warehouseErrorDescription') }}</span>
                <FaButton variant="outline" size="sm" class="shrink-0 min-h-11 sm:min-h-8" @click="warehouseCatalog.retry()">
                  {{ t('purchaseShipments.retry') }}
                </FaButton>
              </div>
            </template>
          </FaAlert>
          <FaAlert v-else-if="warehouseCatalog.missing.value" :title="t('warehouseArrivals.warehouseMissing')" :description="t('warehouseArrivals.warehouseMissingDescription')" class="mb-4" />
          <FaAlert v-if="warehouseCountsError" :title="t('warehouseArrivals.warehouseCountsError')" variant="destructive" class="mb-4">
            <template #description>
              <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span>{{ t('warehouseArrivals.warehouseCountsErrorDescription') }}</span>
                <FaButton variant="outline" size="sm" class="shrink-0 min-h-11 sm:min-h-8" @click="loadCounts">
                  {{ t('purchaseShipments.retry') }}
                </FaButton>
              </div>
            </template>
          </FaAlert>
          <QsStatusSwitchToolbar :model-value="activeWarehouse" :items="warehouseTabs" :aria-label="t('purchaseShipments.destinationWarehouse')" class="mb-4" @update:model-value="selectWarehouse" />
        </template>
        <QsGenericTable
          v-model:page="page" v-model:page-size="pageSize" v-model:search="keyword" v-model:filters="filters"
          row-key="id" :show-row-number="false" :columns="columns" :data="rows" :total="total"
          :loading="loading" :error="error" :addable="false" :page-size-options="[20, 50, 100]"
          :filter-definitions="filterDefinitions" :search-placeholder="t('purchaseShipments.search')"
          :empty-title="t('purchaseShipments.empty')" :empty-description="t('purchaseShipments.emptyDescription')"
          :action-column="{ fixed: 'right', minWidth: showWarehouseFilter ? 260 : canReceive ? 350 : 245, width: showWarehouseFilter ? 260 : canReceive ? 350 : 245 }" table-class="w-max min-w-full"
          @search="search" @filter-change="search" @pagination-change="paginate" @retry="refresh"
        >
          <template #query-leading>
            <QsDateRangeFilter v-model="dateRange" :calendar-label="t('purchaseShipments.orderDate')" :placeholder="t('purchaseShipments.orderDate')" @complete="search" @clear="search" />
          </template>
          <template #cell-shipmentNo="{ row }">
            <div class="group flex gap-2 items-center">
              <span class="qs-type-data-emphasis whitespace-nowrap" :class="!row.original.shipmentNo && 'text-muted-foreground'">{{ row.original.shipmentNo || t('purchaseShipments.unnumbered') }}</span>
              <CopyCellButton v-if="row.original.shipmentNo" :text="row.original.shipmentNo" :label="t('purchaseShipments.shipmentNo')" />
            </div>
          </template>
          <template #cell-part="{ row }">
            <QsTableStackedCell class="group">
              <QsTableStackedLine content-class="qs-type-data-emphasis">
                {{ row.original.purchaseOrder.orderNo }}
                <template #suffix>
                  <CopyCellButton :text="row.original.purchaseOrder.orderNo" :label="t('purchaseShipments.orderNo')" />
                </template>
              </QsTableStackedLine>
              <QsTableStackedLine tone="muted">
                {{ formatShipmentNumber(row.original.partNumber) }}
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template v-for="markColumn in ['mark', 'baseMark']" :key="markColumn" #[`cell-${markColumn}`]="{ row }">
            <div class="group flex gap-2 max-w-80 items-center">
              <FaTooltip :text="(markColumn === 'mark' ? row.original.shippingMarkText : row.original.purchaseOrder.shippingMarkText) || emptyMark(row.original)">
                <span tabindex="0" class="qs-type-data min-w-0 block truncate">{{ (markColumn === 'mark' ? row.original.shippingMarkText : row.original.purchaseOrder.shippingMarkText) || emptyMark(row.original) }}</span>
              </FaTooltip>
              <CopyCellButton v-if="markColumn === 'mark' ? row.original.shippingMarkText : row.original.purchaseOrder.shippingMarkText" :text="(markColumn === 'mark' ? row.original.shippingMarkText : row.original.purchaseOrder.shippingMarkText)!" :label="t(`purchaseShipments.${markColumn}`)" />
            </div>
          </template>
          <template #cell-status="{ row }">
            <FaTag variant="outline" :class="shipmentStatusClass(row.original.viewStatus)">
              {{ t(`purchaseShipments.${row.original.viewStatus}`) }}
            </FaTag>
          </template>
          <template #cell-source="{ row }">
            <QsTableStackedCell v-if="row.original.salesSource" class="group">
              <QsTableStackedLine content-class="qs-type-data-emphasis">
                {{ row.original.salesSource.orderNo }}<template #suffix>
                  <CopyCellButton :text="row.original.salesSource.orderNo" :label="t('purchaseShipments.source')" />
                </template>
              </QsTableStackedLine>
              <QsTableStackedLine tone="muted">
                {{ row.original.salesSource.customerName }}
              </QsTableStackedLine>
            </QsTableStackedCell>
            <span v-else class="qs-type-meta">{{ t(getShipmentSourceEmptyKey(row.original.purchaseOrder.purchaseType)) }}</span>
          </template>
          <template #cell-products="{ row }">
            <QsTableStackedCell>
              <ShipmentProducts :summary="row.original.lineSummary" />
              <QsTableStackedLine content-class="qs-type-meta" nowrap tone="muted">
                {{ t('purchaseShipments.quantitySummary', { count: row.original.lineSummary.lineCount, quantity: row.original.lineSummary.totalQuantity }) }}
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-buyer="{ row }">
            <QsPersonDisplay :display-name="row.original.purchaseOrder.createdBy.displayName" size="md" />
          </template>
          <template #cell-shipped="{ row }">
            <QsTableStackedCell v-if="row.original.shippedAt">
              <DateTimeDisplay :value="row.original.shippedAt" />
              <QsPersonDisplay v-if="row.original.shippedBy" :display-name="row.original.shippedBy.displayName" size="md" />
            </QsTableStackedCell>
            <span v-else class="qs-type-meta">{{ t('purchaseShipments.notShipped') }}</span>
          </template>
          <template #cell-destinationWarehouse="{ row }">
            <span class="min-w-0 block [overflow-wrap:anywhere]" :class="row.original.destinationWarehouseValue === null && 'text-muted-foreground'">{{ formatDestinationWarehouse(row.original, t) }}</span>
          </template>
          <template #cell-received="{ row }">
            <QsTableStackedCell v-if="row.original.warehouseReceivedAt">
              <DateTimeDisplay :value="row.original.warehouseReceivedAt" /><QsPersonDisplay v-if="row.original.warehouseReceivedBy" :display-name="row.original.warehouseReceivedBy.displayName" size="md" />
            </QsTableStackedCell><span v-else class="qs-type-meta text-muted-foreground">—</span>
          </template>
          <template #cell-createdAt="{ row }">
            <DateTimeDisplay :value="row.original.createdAt" />
          </template>
          <template #cell-recordedAt="{ row }">
            <DateTimeDisplay :value="row.original.shipmentRecordedAt" />
          </template>
          <template #cell-remark="{ row }">
            <FaTooltip :text="row.original.shipmentRemark || '—'">
              <span tabindex="0" class="max-w-64 block truncate">{{ row.original.shipmentRemark || '—' }}</span>
            </FaTooltip>
          </template>
          <template #actions="{ row }">
            <div :class="showWarehouseFilter ? 'grid grid-cols-2 gap-1' : 'flex flex-wrap items-center gap-1'">
              <FaButton v-if="canReceive && shipmentPlaceholderAction(activeView, row.viewStatus)" variant="ghost" size="sm" class="text-primary min-h-11 sm:min-h-8" @click="handleTransportAction(row)">
                <FaIcon :name="activeView === 'WAREHOUSE_RECEIVED' ? 'i-lucide:container' : 'i-lucide:package-check'" aria-hidden="true" />{{ t(activeView === 'WAREHOUSE_RECEIVED' ? 'purchaseShipments.loadContainer' : 'purchaseShipments.sign') }}
              </FaButton>
              <FaButton v-if="canReceive && showWarehouseFilter && row.viewStatus === 'WAREHOUSE_RECEIVED'" variant="ghost" size="sm" class="text-primary min-h-11 sm:min-h-8" @click="handleTransportAction(row, 'seaExpress')">
                <FaIcon name="i-lucide:truck" aria-hidden="true" />{{ t('purchaseShipments.seaExpress') }}
              </FaButton>
              <FaButton v-if="canReceive && row.viewStatus === 'SHIPPED'" variant="ghost" size="sm" class="text-primary min-h-11 sm:min-h-8" :disabled="!!warehouseActionRef?.loadingOrderId" @click="warehouseActionRef?.open(row.purchaseOrder.id, [row.id])">
                <FaIcon name="i-lucide:warehouse" aria-hidden="true" />{{ t('purchaseWarehouseReceipt.action') }}
              </FaButton>
              <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-8" :aria-label="`${row.purchaseOrder.orderNo} ${formatShipmentNumber(row.partNumber)}：${t('purchaseShipments.view')}`" @click="openShipment(row.id)">
                <FaIcon name="i-lucide:package-search" aria-hidden="true" />{{ t('purchaseShipments.view') }}
              </FaButton>
              <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-8" :aria-label="`${row.purchaseOrder.orderNo}：${t('purchaseShipments.viewOrder')}`" @click="openOrder(row.purchaseOrder.id)">
                <FaIcon name="i-lucide:eye" aria-hidden="true" />{{ t('purchaseShipments.viewOrder') }}
              </FaButton>
            </div>
          </template>
          <template #mobile-row="{ row }">
            <div class="min-w-0 space-y-3">
              <div class="flex gap-2 items-start justify-between">
                <QsTableStackedCell>
                  <QsTableStackedLine content-class="qs-type-data-emphasis [overflow-wrap:anywhere]" :tone="row.shipmentNo ? 'default' : 'muted'">
                    {{ row.shipmentNo || t('purchaseShipments.unnumbered') }}
                    <template v-if="row.shipmentNo" #suffix>
                      <CopyCellButton always-visible :text="row.shipmentNo" :label="t('purchaseShipments.shipmentNo')" />
                    </template>
                  </QsTableStackedLine>
                  <QsTableStackedLine content-class="qs-type-data-emphasis [overflow-wrap:anywhere]">
                    {{ row.purchaseOrder.orderNo }}
                    <template #suffix>
                      <CopyCellButton always-visible :text="row.purchaseOrder.orderNo" :label="t('purchaseShipments.orderNo')" />
                    </template>
                  </QsTableStackedLine>
                  <QsTableStackedLine tone="muted">
                    {{ formatShipmentNumber(row.partNumber) }}
                  </QsTableStackedLine>
                </QsTableStackedCell>
                <FaTag variant="outline" class="shrink-0" :class="shipmentStatusClass(row.viewStatus)">
                  {{ t(`purchaseShipments.${row.viewStatus}`) }}
                </FaTag>
              </div>
              <div v-for="mark in [{ label: 'mark', value: row.shippingMarkText }, { label: 'baseMark', value: row.purchaseOrder.shippingMarkText }]" :key="mark.label">
                <div class="qs-type-meta mb-1">
                  {{ t(`purchaseShipments.${mark.label}`) }}
                </div>
                <div class="flex gap-2 items-start">
                  <span class="qs-type-data min-w-0 [overflow-wrap:anywhere]">{{ mark.value || emptyMark(row) }}</span><CopyCellButton v-if="mark.value" always-visible :text="mark.value" :label="t(`purchaseShipments.${mark.label}`)" />
                </div>
              </div>
              <p class="m-0">
                {{ row.supplier.label }}
              </p>
              <div v-if="row.salesSource" class="qs-type-meta">
                {{ row.salesSource.orderNo }} · {{ row.salesSource.customerName }}
              </div>
              <div v-else class="qs-type-meta">
                {{ t('purchaseShipments.stockSource') }}
              </div>
              <QsTableStackedCell class="grid!">
                <ShipmentProducts :summary="row.lineSummary" />
                <QsTableStackedLine content-class="qs-type-meta" tone="muted">
                  {{ t('purchaseShipments.quantitySummary', { count: row.lineSummary.lineCount, quantity: row.lineSummary.totalQuantity }) }}
                </QsTableStackedLine>
              </QsTableStackedCell>
              <QsPersonDisplay :display-name="row.purchaseOrder.createdBy.displayName" size="md" />
              <div class="qs-type-meta min-w-0">
                <span class="text-muted-foreground">{{ t('purchaseShipments.destinationWarehouse') }}：</span>
                <span class="[overflow-wrap:anywhere]">{{ formatDestinationWarehouse(row, t) }}</span>
              </div>
              <div v-if="row.warehouseReceivedAt" class="flex flex-wrap gap-2 items-center">
                <span class="qs-type-meta text-muted-foreground">{{ t('purchaseWarehouseReceipt.receivedAt') }}</span><DateTimeDisplay :value="row.warehouseReceivedAt" /><QsPersonDisplay v-if="row.warehouseReceivedBy" :display-name="row.warehouseReceivedBy.displayName" size="md" />
              </div>
              <div v-if="row.shippedAt" class="flex flex-wrap gap-2 items-center">
                <DateTimeDisplay :value="row.shippedAt" /><QsPersonDisplay v-if="row.shippedBy" :display-name="row.shippedBy.displayName" size="md" />
              </div>
            </div>
          </template>
        </QsGenericTable>
      </template>
    </FaPageMain>
    <PurchaseWarehouseReceiptAction ref="warehouseActionRef" :active="enabled" @detail-updated="warehouseUpdated" />
    <ShipmentDetailDrawer v-model="shipmentVisible" :detail="detail" :loading="detailLoading" :error="detailError" @reload="loadDetail" @view-order="viewOrderFromShipment" @closed="shipmentClosed" />
    <QsPurchaseOrderDrawer v-model="orderVisible" :order="null" :detail="orderDetail" :currencies="currencyCatalog.currencies.value" :loading="detailLoading" :error="detailError" action-error="" :busy="false" :can-attach-document="false" @reload="loadDetail" />
  </div>
</template>
