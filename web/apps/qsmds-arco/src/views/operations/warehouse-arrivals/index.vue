<script setup lang="ts">
import type { WarehouseArrivalAction, WarehouseArrivalView } from './logic'
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import type { PurchaseShipmentListQuery } from '@/api/modules/purchase-shipments'
import type { ActionMenuItem } from '@/components/business/QsGenericTable/action-column-width'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { resolveActionColumnWidth } from '@/components/business/QsGenericTable/action-column-width'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsPurchaseOrderDrawer from '@/components/business/QsPurchaseOrderDrawer/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { formatDestinationWarehouse } from '../../workbenches/shipments/logic'
import ShipmentDetailDrawer from '../../workbenches/shipments/shipment-detail-drawer.vue'
import { getShipmentSourceEmptyKey } from '../../workbenches/shipments/shipment-detail.logic'
import ShipmentProducts from '../../workbenches/shipments/shipment-products.vue'
import ArrivalMobileRow from './arrival-mobile-row.vue'
import { buildWarehouseArrivalRouteQuery, buildWarehouseFilterOptions, createWarehouseArrivalColumns, parseWarehouseArrivalQuery, WAREHOUSE_ARRIVAL_VIEWS, warehouseArrivalActions, warehouseFilterFromQuery, warehouseFilterToQuery } from './logic'
import PackagingCostAction from './packaging-cost-action.vue'
import ShippingInfoModal from './shipping-info-modal.vue'
import { useShippingInfoData } from './use-shipping-info'
import { useWarehouseArrivalData } from './use-warehouse-arrival-data'

defineOptions({ name: 'QsWarehouseArrivals' })
const route = useRoute()
const router = useRouter()
const { t } = useI18n()
const toast = useQsToast()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const warehouseCatalog = useDictionaryCatalog('mainland.warehouse')
const canRead = computed(() => auth('purchase-orders:read'))
const canCreatePackaging = computed(() => auth('packaging-costs:create'))
// 出货信息的客户电话、收货地址与代收尾款属于销售域资料，另有销售查看权限才提供入口。
const canReadShippingInfo = computed(() => auth('sales-orders:read'))
const instancePath = route.fullPath
const activated = ref(false)
// 每个 fullPath 对应独立缓存实例；离开或撤权后立即停止列表、计数和详情读取。
const enabled = computed(() => activated.value && canRead.value && route.name === 'qsOperationsWarehouseArrivals' && route.fullPath === instancePath)
const query = computed(() => parseWarehouseArrivalQuery(route.query))
const activeView = computed<WarehouseArrivalView>(() => query.value.view === 'SHIPPED' ? 'SHIPPED' : 'WAREHOUSE_RECEIVED')
const keyword = ref(query.value.keyword ?? '')
const activeWarehouse = computed(() => warehouseFilterFromQuery(query.value))
const page = ref(query.value.page ?? 1)
const pageSize = ref(query.value.pageSize ?? 20)
const packagingShipment = shallowRef<PurchaseShipmentListItemDto | null>(null)
const warehouseOptions = computed(() => buildWarehouseFilterOptions(warehouseCatalog.catalog.value, query.value.destinationWarehouseValue, t))
const { rows, total, loading, error, counts, countsError, warehouseCounts, warehouseCountsError, detail, orderDetail, detailKind, detailLoading, detailError, refresh, loadCounts, loadDetail, openShipment, openOrder } = useWarehouseArrivalData(enabled, computed(() => account.authEpoch), query, value => navigate({ ...query.value, page: value }, true))
const { shipment: shippingInfoShipment, salesOrder: shippingInfoSalesOrder, loading: shippingInfoLoading, error: shippingInfoError, open: openShippingInfo, load: loadShippingInfo, close: closeShippingInfo } = useShippingInfoData(enabled, computed(() => account.authEpoch))
const shippingInfoVisible = computed({ get: () => shippingInfoShipment.value !== null, set: (value) => {
  if (!value) {
    closeShippingInfo()
  }
} })
const actionColumnWidth = computed(() => {
  if (activeView.value === 'SHIPPED') {
    return resolveActionColumnWidth([{ chars: 2, kind: 'text' }])
  }
  return resolveActionColumnWidth(canReadShippingInfo.value
    ? [{ chars: 2, kind: 'text' }, { chars: 2, kind: 'text' }, { kind: 'icon' }]
    : [{ chars: 2, kind: 'text' }, { chars: 2, kind: 'text' }])
})
const tabs = computed(() => WAREHOUSE_ARRIVAL_VIEWS.map(value => ({ value, label: t(`warehouseArrivals.${value}`), count: countsError.value || counts.value.length === 0 ? undefined : counts.value.find(item => item.value === value)?.count ?? 0 })))
const columns = computed(() => createWarehouseArrivalColumns(activeView.value, t))
const warehouseTabs = computed(() => warehouseOptions.value.map((item) => {
  const { destinationWarehouseValue } = warehouseFilterToQuery(item.value)
  const statusCounts = destinationWarehouseValue === undefined
    ? countsError.value || counts.value.length === 0 ? undefined : counts.value
    : warehouseCounts.value.find(warehouse => warehouse.value === destinationWarehouseValue)?.items
  // 加载中或失败不显示虚假的 0；成功响应中的空分组才代表该仓库没有货件。
  return { ...item, count: statusCounts === undefined ? undefined : statusCounts.find(status => status.value === activeView.value)?.count ?? 0 }
}))

function navigate(next: PurchaseShipmentListQuery, replace = false): void {
  if (!enabled.value) {
    return
  }
  const location = { query: buildWarehouseArrivalRouteQuery(next) }
  if (router.resolve(location).fullPath === route.fullPath) {
    refresh()
  }
  else if (replace) {
    void router.replace(location)
  }
  else {
    void router.push(location)
  }
}
function selectView(value: string | number): void {
  if (WAREHOUSE_ARRIVAL_VIEWS.includes(value as WarehouseArrivalView)) {
    navigate({ ...query.value, view: value as WarehouseArrivalView, page: 1 })
  }
}
function selectWarehouse(value: string): void {
  if (!warehouseTabs.value.some(item => item.value === value)) {
    return
  }
  const { destinationWarehouseValue: _value, ...current } = query.value
  navigate({ ...current, ...warehouseFilterToQuery(value), page: 1 })
}
function search(): void {
  navigate({ ...query.value, keyword: keyword.value.trim() || undefined, page: 1 })
}
function paginate(value: { page: number, pageSize: number }): void {
  navigate({ ...query.value, ...value })
}
function visibleArrivalActions(row: PurchaseShipmentListItemDto): WarehouseArrivalAction[] {
  return warehouseArrivalActions(activeView.value, row.viewStatus, row.destinationWarehouseValue)
    .filter(value => (value !== 'woodenFrame' || canCreatePackaging.value)
      && (value !== 'shippingInfo' || canReadShippingInfo.value))
}

function arrivalBusinessActions(row: PurchaseShipmentListItemDto): WarehouseArrivalAction[] {
  return visibleArrivalActions(row).filter(action => action !== 'view')
}

function shortArrivalActionLabel(action: WarehouseArrivalAction): string {
  switch (action) {
    case 'view': return '详情'
    case 'shippingInfo': return '出货'
    case 'woodenFrame': return '木架'
    case 'seaExpress': return '海快'
  }
}

function arrivalDetailItems(row: PurchaseShipmentListItemDto): ActionMenuItem[][] {
  return [[{ label: '详情', handle: () => handleAction('view', row) }]]
}

function handleAction(action: WarehouseArrivalAction, row: PurchaseShipmentListItemDto): void {
  if (!enabled.value || !warehouseArrivalActions(activeView.value, row.viewStatus, row.destinationWarehouseValue).includes(action)) {
    return
  }
  if (action === 'view') {
    void openShipment(row.id)
  }
  else if (action === 'seaExpress') {
    toast.info(t('warehouseArrivals.seaExpressUnavailable'))
  }
  else if (action === 'shippingInfo') {
    if (canReadShippingInfo.value) {
      void openShippingInfo(row)
    }
  }
  else if (canCreatePackaging.value) {
    packagingShipment.value = row
  }
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
watch([enabled, query], ([isEnabled]) => {
  if (isEnabled) {
    keyword.value = query.value.keyword ?? ''
    page.value = query.value.page ?? 1
    pageSize.value = query.value.pageSize ?? 20
  }
}, { flush: 'sync' })
watch([enabled, canCreatePackaging, canReadShippingInfo, () => account.authEpoch], () => {
  queuedOrderId = null
  packagingShipment.value = null
  closeShippingInfo()
}, { flush: 'sync' })
onMounted(() => activated.value = true)
onActivated(() => activated.value = true)
onDeactivated(() => activated.value = false)
onBeforeUnmount(() => activated.value = false)
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('warehouseArrivals.title')" :description="t('warehouseArrivals.intro')">
      <FaButton v-if="canRead" variant="outline" :loading="loading" @click="refresh">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />{{ t('purchaseShipments.refresh') }}
      </FaButton>
    </FaPageHeader>
    <FaPageMain class="min-w-0">
      <FaEmpty v-if="!canRead" icon="i-lucide:shield-alert" :title="t('purchaseShipments.noPermission')" :description="t('purchaseShipments.noPermissionDescription')" class="py-12" />
      <template v-else>
        <FaAlert v-if="countsError || warehouseCountsError" :title="t(countsError ? 'warehouseArrivals.countsError' : 'warehouseArrivals.warehouseCountsError')" variant="destructive" class="mb-4">
          <template #description>
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <span>{{ t(countsError ? 'warehouseArrivals.countsErrorDescription' : 'warehouseArrivals.warehouseCountsErrorDescription') }}</span>
              <FaButton variant="outline" size="sm" class="shrink-0 min-h-11 sm:min-h-8" @click="loadCounts">
                {{ t('purchaseShipments.retry') }}
              </FaButton>
            </div>
          </template>
        </FaAlert>
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
        <QsStatusSwitchToolbar :model-value="activeView" :items="tabs" :aria-label="t('warehouseArrivals.title')" class="mb-4" @update:model-value="selectView" />
        <QsStatusSwitchToolbar :model-value="activeWarehouse" :items="warehouseTabs" :aria-label="t('purchaseShipments.destinationWarehouse')" class="mb-4" @update:model-value="selectWarehouse" />
        <QsGenericTable
          :key="activeView" v-model:page="page" v-model:page-size="pageSize" v-model:search="keyword"
          row-key="id" :show-row-number="false" :columns="columns" :data="rows" :total="total" :loading="loading" :error="error"
          :addable="false" :page-size-options="[20, 50, 100]" :search-placeholder="t('warehouseArrivals.search')"
          :empty-title="t('warehouseArrivals.empty')" :empty-description="t('warehouseArrivals.emptyDescription')"
          :action-column="{ fixed: 'right', minWidth: actionColumnWidth, width: actionColumnWidth }" table-class="w-max min-w-full"
          @search="search" @pagination-change="paginate" @retry="refresh"
        >
          <template #cell-shipmentNo="{ row }">
            <div class="qs-type-data-emphasis flex gap-2 items-center">
              <QsCopyableText v-if="row.original.shipmentNo" :text="row.original.shipmentNo" :label="t('purchaseShipments.shipmentNo')" />
              <span v-else class="text-muted-foreground whitespace-nowrap">{{ t('purchaseShipments.unnumbered') }}</span>
            </div>
          </template>
          <template #cell-mark="{ row }">
            <div class="group flex gap-2 max-w-80 items-center">
              <FaTooltip :text="row.original.shippingMarkText || t('purchaseShipments.missingMark')">
                <span tabindex="0" class="qs-type-data min-w-0 block truncate">{{ row.original.shippingMarkText || t('purchaseShipments.missingMark') }}</span>
              </FaTooltip>
              <CopyCellButton v-if="row.original.shippingMarkText" :text="row.original.shippingMarkText" :label="t('purchaseShipments.mark')" />
            </div>
          </template>
          <template #cell-destinationWarehouse="{ row }">
            <span class="[overflow-wrap:anywhere]" :class="row.original.destinationWarehouseValue === null && 'text-muted-foreground'">{{ formatDestinationWarehouse(row.original, t) }}</span>
          </template>
          <template #cell-products="{ row }">
            <QsTableStackedCell>
              <ShipmentProducts :summary="row.original.lineSummary" />
              <QsTableStackedLine content-class="qs-type-meta" tone="muted">
                {{ t('purchaseShipments.quantitySummary', { count: row.original.lineSummary.lineCount, quantity: row.original.lineSummary.totalQuantity }) }}
              </QsTableStackedLine>
            </QsTableStackedCell>
          </template>
          <template #cell-source="{ row }">
            <QsTableStackedCell v-if="row.original.salesSource">
              <QsTableStackedLine>{{ row.original.salesSource.customerName }}</QsTableStackedLine>
              <QsTableStackedLine content-class="qs-type-data" tone="muted">
                {{ row.original.salesSource.orderNo }}
              </QsTableStackedLine>
            </QsTableStackedCell>
            <span v-else class="qs-type-meta text-muted-foreground">{{ t(getShipmentSourceEmptyKey(row.original.purchaseOrder.purchaseType)) }}</span>
          </template>
          <template #cell-shippedAt="{ row }">
            <DateTimeDisplay :value="row.original.shippedAt" />
          </template>
          <template #cell-warehouseReceivedAt="{ row }">
            <DateTimeDisplay :value="row.original.warehouseReceivedAt" />
          </template>
          <template #cell-warehouseReceivedBy="{ row }">
            <QsPersonDisplay v-if="row.original.warehouseReceivedBy" :display-name="row.original.warehouseReceivedBy.displayName" size="md" :avatar-url="row.original.warehouseReceivedBy.avatarUrl" /><span v-else>—</span>
          </template>
          <template #actions="{ row }">
            <div class="flex flex-wrap gap-1 items-center">
              <FaButton
                v-for="action in arrivalBusinessActions(row)"
                :key="action"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.shipmentNo || t('purchaseShipments.unnumbered')}：${t(`warehouseArrivals.${action}`)}`"
                @click="handleAction(action, row)"
              >
                {{ shortArrivalActionLabel(action) }}
              </FaButton>
              <FaButton
                v-if="arrivalBusinessActions(row).length <= 1"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8"
                :aria-label="`${row.shipmentNo || t('purchaseShipments.unnumbered')}：详情`"
                @click="handleAction('view', row)"
              >
                详情
              </FaButton>
              <FaButton
                v-if="arrivalBusinessActions(row).length === 2"
                variant="ghost"
                size="sm"
                class="min-h-11 sm:min-h-8 md:hidden"
                :aria-label="`${row.shipmentNo || t('purchaseShipments.unnumbered')}：详情`"
                @click="handleAction('view', row)"
              >
                详情
              </FaButton>
              <FaDropdown
                v-if="arrivalBusinessActions(row).length === 2"
                :items="arrivalDetailItems(row)"
                align="end"
              >
                <FaButton
                  variant="ghost"
                  size="icon-sm"
                  class="min-h-11 min-w-11 hidden md:inline-flex sm:min-h-8 sm:min-w-8"
                  :aria-label="`${row.shipmentNo || t('purchaseShipments.unnumbered')}：更多操作`"
                >
                  <FaIcon name="i-lucide:ellipsis-vertical" class="size-4" aria-hidden="true" />
                </FaButton>
              </FaDropdown>
            </div>
          </template>
          <template #mobile-row="{ row }">
            <ArrivalMobileRow :row="row" :view="activeView" />
          </template>
        </QsGenericTable>
      </template>
    </FaPageMain>
    <ShipmentDetailDrawer v-model="shipmentVisible" :detail="detail" :loading="detailLoading" :error="detailError" @reload="loadDetail" @view-order="viewOrderFromShipment" @closed="shipmentClosed" />
    <QsPurchaseOrderDrawer v-model="orderVisible" :order="null" :detail="orderDetail" :currencies="currencyCatalog.currencies.value" :loading="detailLoading" :error="detailError" action-error="" :busy="false" :can-attach-document="false" @reload="loadDetail" />
    <PackagingCostAction v-if="packagingShipment" :shipment="packagingShipment" :enabled="enabled && canCreatePackaging" @close="packagingShipment = null" @submitted="refresh" />
    <ShippingInfoModal v-model="shippingInfoVisible" :shipment="shippingInfoShipment" :sales-order="shippingInfoSalesOrder" :loading="shippingInfoLoading" :error="shippingInfoError" @retry="loadShippingInfo" />
  </div>
</template>
