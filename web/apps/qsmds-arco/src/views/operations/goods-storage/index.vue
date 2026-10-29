<script setup lang="ts">
import type { ShipmentStorageContainerItemDto, ShipmentStorageDetailDto, ShipmentStorageListItemDto } from '@/api/generated/types.gen'
import type { ActionMenuItem } from '@/components/business/QsGenericTable/action-column-width'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import type { StorageScopeFilter, StorageStatusTab } from '@/views/workbenches/shipment-storage/logic'
import shipmentStorageApi from '@/api/modules/shipment-storage'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import { resolveActionColumnWidth } from '@/components/business/QsGenericTable/action-column-width'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { buildStorageQuery, claimRequestDisabledReason, DEFAULT_STORAGE_STATUS, locationLabel, STORAGE_SCOPE_OPTIONS, STORAGE_STATUS_TABS, storageFailureMessage, storageStatusClass, storageStatusLabel } from '@/views/workbenches/shipment-storage/logic'
import ShipmentProducts from '@/views/workbenches/shipments/shipment-products.vue'

defineOptions({ name: 'QsOperationsGoodsStorage' })

// QsGenericTable 内部使用局部 i18n 作用域；页面显式建立父级作用域，避免回退全局时告警。
useI18n()

const { auth } = useAppAuth()
const route = useRoute()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const mainlandCatalog = useDictionaryCatalog('mainland.warehouse')
const overseasCatalog = useDictionaryCatalog('overseas.warehouse')
const canRead = computed(() => auth('shipment-storage:read'))

const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/iu
const queryStorageId = typeof route.query.storageId === 'string' && UUID_PATTERN.test(route.query.storageId)
  ? route.query.storageId
  : undefined
const queryStatus = typeof route.query.status === 'string'
  && STORAGE_STATUS_TABS.includes(route.query.status as StorageStatusTab)
  ? route.query.status as StorageStatusTab
  : undefined
const storageId = ref<string | undefined>(queryStorageId)
const status = ref<StorageStatusTab>(queryStatus ?? (queryStorageId === undefined ? DEFAULT_STORAGE_STATUS : 'ALL'))
const scope = ref<StorageScopeFilter>('ALL')
const warehouseValue = ref('ALL')
const keyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
const page = ref(1)
const pageSize = ref(20)
const rows = ref<ShipmentStorageListItemDto[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const statusCounts = ref<{ value: string, count: number }[]>([])

const countByValue = computed(() => new Map(statusCounts.value.map(item => [item.value, item.count])))
const statusTabs = computed(() => STORAGE_STATUS_TABS.map(value => ({
  value,
  label: value === 'ALL' ? '全部' : storageStatusLabel(value),
  count: countByValue.value.get(value),
})))

const warehouseOptions = computed(() => {
  const mainland = mainlandCatalog.selectableItems.value
  const overseas = overseasCatalog.selectableItems.value
  const items = scope.value === 'MAINLAND'
    ? mainland
    : scope.value === 'OVERSEAS'
      ? overseas
      : [...mainland, ...overseas]
  return [
    { value: 'ALL', label: '全部仓库' },
    ...items.map(item => ({ value: item.value, label: item.label })),
  ]
})

function hasPositiveAmount(value: string): boolean {
  return Number(value) > 0
}

const columns = computed<QsGenericTableColumn<ShipmentStorageListItemDto>[]>(() => [
  { id: 'shipmentNo', title: '货件编号', accessorKey: 'shipmentNo', fixed: 'left', minWidth: 177 },
  { id: 'products', title: '产品', accessorFn: row => row.lineSummary.previews.map(item => item.productName).join('、'), minWidth: 220 },
  { id: 'mark', title: '唛头', accessorFn: row => [row.shippingMarkText, ...row.containerMarks].filter(value => Boolean(value)).join('、'), minWidth: 260 },
  { id: 'customer', title: '原单客户', accessorFn: row => row.originCustomerName, minWidth: 160 },
  { id: 'location', title: '寄仓位置', accessorFn: row => locationLabel(row), minWidth: 200 },
  { id: 'status', title: '状态', accessorFn: row => storageStatusLabel(row.status), minWidth: 110 },
  { id: 'cost', title: '成本合计', accessorFn: row => row.cost.totalCostCny, minWidth: 140 },
  { id: 'costDetail', title: '成本详情', accessorFn: row => row.cost.purchaseCostCny, minWidth: 230 },
  { id: 'salesOrder', title: '来源销售单', accessorFn: row => row.originSalesOrderNo, minWidth: 230 },
  { id: 'purchaseOrder', title: '来源采购单', accessorFn: row => row.originPurchaseOrderNo, minWidth: 230 },
  { id: 'createdAt', title: '转入寄仓时间', accessorKey: 'createdAt', minWidth: 190 },
])

const actionColumnWidth = computed(() => resolveActionColumnWidth([
  { chars: 4, kind: 'text' },
  { kind: 'icon' },
]))

let controller: AbortController | null = null

function query() {
  return buildStorageQuery({
    page: page.value,
    pageSize: pageSize.value,
    keyword: keyword.value,
    status: status.value,
    locationScope: scope.value,
    warehouseValue: warehouseValue.value,
    storageId: storageId.value,
  })
}

async function load(): Promise<void> {
  if (!canRead.value) {
    return
  }
  controller?.abort()
  const request = new AbortController()
  controller = request
  loading.value = true
  error.value = ''
  void shipmentStorageApi.statusCounts({ ...query(), status: undefined }, request.signal)
    .then((response) => {
      if (!request.signal.aborted) {
        statusCounts.value = response.data.items
      }
    })
    .catch(() => undefined)
  try {
    const response = await shipmentStorageApi.list(query(), request.signal)
    if (!request.signal.aborted) {
      rows.value = response.data.items
      total.value = response.data.total
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = storageFailureMessage(failure, '寄仓记录加载失败')
    }
  }
  finally {
    if (!request.signal.aborted) {
      loading.value = false
    }
  }
}

function selectStatus(value: StorageStatusTab): void {
  status.value = value
  storageId.value = undefined
  page.value = 1
  void load()
}

function changeScope(value: string): void {
  scope.value = value as StorageScopeFilter
  warehouseValue.value = 'ALL'
  storageId.value = undefined
  page.value = 1
  void load()
}

function changeWarehouse(value: string): void {
  warehouseValue.value = value
  storageId.value = undefined
  page.value = 1
  void load()
}

function clearStorageFilter(): void {
  storageId.value = undefined
  page.value = 1
  void load()
}

watch([page, pageSize], load)
watch(keyword, () => {
  storageId.value = undefined
  page.value = 1
  void load()
})

const detailOpen = ref(false)
const detail = ref<ShipmentStorageDetailDto | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const detailView = ref<'basic' | 'container'>('basic')

interface ContainerMarkGroup {
  mark: string
  items: ShipmentStorageContainerItemDto[]
}

const containerMarkGroups = computed<ContainerMarkGroup[]>(() => {
  const groups = new Map<string, ContainerMarkGroup>()
  for (const item of detail.value?.containerLoadingItems ?? []) {
    const mark = item.oceanShippingMarkText?.trim() || '未记录装柜唛头'
    const group = groups.get(mark) ?? { mark, items: [] }
    group.items.push(item)
    groups.set(mark, group)
  }
  return [...groups.values()]
})

const detailViewItems = computed(() => [
  { value: 'basic', label: '基础信息' },
  { value: 'container', label: '装柜信息', count: containerMarkGroups.value.length },
])

function containerQuantity(item: ShipmentStorageContainerItemDto): string {
  return item.packageUnit === null
    ? String(item.packageCount)
    : `${item.packageCount} ${item.packageUnit}`
}

function containerDimensions(item: ShipmentStorageContainerItemDto): string {
  const values = [item.lengthCm, item.widthCm, item.heightCm]
  return values.every(value => value !== null)
    ? `${values.join(' × ')} cm`
    : '—'
}

function containerWeight(item: ShipmentStorageContainerItemDto): string {
  return item.grossWeightKg === null ? '—' : `${item.grossWeightKg} kg`
}

async function openDetail(row: ShipmentStorageListItemDto): Promise<void> {
  detailOpen.value = true
  detail.value = null
  detailLoading.value = true
  detailError.value = ''
  detailView.value = 'basic'
  const request = new AbortController()
  try {
    const response = await shipmentStorageApi.detail(row.id, request.signal)
    detail.value = response.data
  }
  catch (failure) {
    detailError.value = storageFailureMessage(failure, '寄仓详情加载失败')
  }
  finally {
    detailLoading.value = false
  }
}

function openDetailFromMenu(row: ShipmentStorageListItemDto): void {
  void openDetail(row)
}

function detailMenuItems(row: ShipmentStorageListItemDto): ActionMenuItem[][] {
  return [[{ label: '详情', handle: () => openDetailFromMenu(row) }]]
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader title="货物寄仓" description="查看全部寄仓货物并提交调货申请。" />
    <FaPageMain class="min-w-0">
      <div
        v-if="storageId"
        class="mb-4 px-4 py-3 border border-primary/25 rounded-lg bg-primary/5 flex flex-wrap gap-3 items-center justify-between"
      >
        <span class="text-sm">正在查看指定寄仓记录。</span>
        <FaButton size="sm" variant="outline" @click="clearStorageFilter">
          查看全部
        </FaButton>
      </div>
      <QsStatusSwitchToolbar
        :model-value="status"
        :items="statusTabs"
        aria-label="寄仓状态"
        class="mb-4"
        @update:model-value="selectStatus($event as StorageStatusTab)"
      />

      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="keyword"
        :columns="columns"
        :data="rows"
        :total="total"
        :loading="loading"
        :error="error"
        :action-column="{ fixed: 'right', minWidth: actionColumnWidth, title: '操作', width: actionColumnWidth }"
        :addable="false"
        :show-row-number="false"
        row-key="id"
        search-placeholder="货件编号、唛头、销售单、采购单或客户"
        empty-title="暂无寄仓记录"
        empty-description="释放货件后会在这里显示。"
        @retry="load"
      >
        <template #query-leading>
          <div class="flex flex-wrap gap-3 items-center">
            <FaSelect
              :model-value="scope"
              :options="[...STORAGE_SCOPE_OPTIONS]"
              class="w-36"
              aria-label="位置范围"
              @update:model-value="changeScope(String($event))"
            />
            <FaSelect
              :model-value="warehouseValue"
              :options="warehouseOptions"
              class="w-52"
              aria-label="仓库"
              @update:model-value="changeWarehouse(String($event))"
            />
          </div>
        </template>

        <template #cell-status="{ row }">
          <FaTag variant="outline" :class="storageStatusClass(row.original.status)" class="whitespace-nowrap">
            {{ storageStatusLabel(row.original.status) }}
          </FaTag>
        </template>

        <template #cell-shipmentNo="{ row }">
          <span class="qs-type-data-emphasis">
            <QsCopyableText v-if="row.original.shipmentNo" label="货件编号" :text="row.original.shipmentNo" />
            <span v-else>—</span>
          </span>
        </template>

        <template #cell-products="{ row }">
          <ShipmentProducts :summary="row.original.lineSummary" />
        </template>

        <template #cell-mark="{ row }">
          <div class="flex flex-col gap-1 min-w-0">
            <div class="flex gap-1 min-w-0 items-center">
              <span class="qs-type-meta text-muted-foreground shrink-0">货件唛头：</span>
              <span class="min-w-0">
                <QsCopyableText v-if="row.original.shippingMarkText" label="货件唛头" :text="row.original.shippingMarkText" />
                <span v-else>—</span>
              </span>
            </div>
            <div v-if="row.original.containerMarks.length > 0" class="flex gap-1 min-w-0 items-center">
              <span class="qs-type-meta text-muted-foreground shrink-0">装柜唛头：</span>
              <span class="min-w-0 [overflow-wrap:anywhere]">{{ row.original.containerMarks.join('、') }}</span>
              <CopyCellButton
                always-visible
                label="装柜唛头"
                :text="row.original.containerMarks.join('、')"
              />
            </div>
          </div>
        </template>

        <template #cell-salesOrder="{ row }">
          <div class="flex flex-col gap-1 min-w-0">
            <QsPersonDisplay
              v-if="row.original.originIssuer"
              :display-name="row.original.originIssuer.displayName"
              :avatar-url="row.original.originIssuer.avatarUrl"
              size="sm"
            />
            <span v-else class="qs-type-meta text-muted-foreground">—</span>
            <span class="qs-type-data-emphasis">
              <QsCopyableText label="销售单号" :text="row.original.originSalesOrderNo" />
            </span>
          </div>
        </template>

        <template #cell-purchaseOrder="{ row }">
          <div class="flex flex-col gap-1 min-w-0">
            <QsPersonDisplay
              v-if="row.original.originPurchaseCreator"
              :display-name="row.original.originPurchaseCreator.displayName"
              :avatar-url="row.original.originPurchaseCreator.avatarUrl"
              size="sm"
            />
            <span v-else class="qs-type-meta text-muted-foreground">—</span>
            <span class="qs-type-data-emphasis">
              <QsCopyableText label="采购单号" :text="row.original.originPurchaseOrderNo" />
            </span>
          </div>
        </template>

        <template #cell-costDetail="{ row }">
          <div class="flex flex-col gap-1">
            <div class="flex gap-1 items-center">
              <span class="qs-type-meta text-muted-foreground">采购成本：</span>
              <AmountDisplay :value="row.original.cost.purchaseCostCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </div>
            <div class="flex gap-1 items-center">
              <span class="qs-type-meta text-muted-foreground">包装成本：</span>
              <AmountDisplay
                v-if="hasPositiveAmount(row.original.cost.packagingCostCny)"
                :value="row.original.cost.packagingCostCny"
                currency="CNY"
                :currencies="currencyCatalog.currencies.value"
              />
              <span v-else>-</span>
            </div>
          </div>
        </template>

        <template #cell-createdAt="{ row }">
          <DateTimeDisplay :value="row.original.createdAt" />
        </template>

        <template #cell-cost="{ row }">
          <AmountDisplay :value="row.original.cost.totalCostCny" currency="CNY" :currencies="currencyCatalog.currencies.value" />
        </template>

        <template #actions="{ row }">
          <div class="flex gap-1 items-center justify-end">
            <FaTooltip
              :text="claimRequestDisabledReason(row) ?? ''"
              :disabled="claimRequestDisabledReason(row) === null"
            >
              <span class="inline-flex" tabindex="0">
                <FaButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  class="min-h-11 sm:min-h-8"
                  :disabled="claimRequestDisabledReason(row) !== null"
                  :aria-label="`${row.shipmentNo ?? '寄仓记录'}：申请调货`"
                  @click="toast.info('申请调货功能开发中')"
                >
                  申请调货
                </FaButton>
              </span>
            </FaTooltip>
            <FaDropdown :items="detailMenuItems(row)" align="end">
              <FaButton
                type="button"
                variant="ghost"
                size="icon-sm"
                class="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                :aria-label="`${row.shipmentNo ?? '寄仓记录'}：更多操作`"
              >
                <FaIcon name="i-lucide:ellipsis-vertical" class="size-4" aria-hidden="true" />
              </FaButton>
            </FaDropdown>
          </div>
        </template>
      </QsGenericTable>

      <QsGenericDrawer
        v-model="detailOpen"
        title="寄仓详情"
        :description="detail?.shipmentNo ?? ''"
        :loading="detailLoading"
        :error="detailError"
        size="xl"
      >
        <template #header-extra>
          <FaTag
            v-if="detail"
            variant="outline"
            :class="storageStatusClass(detail.status)"
            class="whitespace-nowrap"
          >
            {{ storageStatusLabel(detail.status) }}
          </FaTag>
        </template>

        <div v-if="detail && !detailLoading && !detailError" class="pb-2 flex flex-col gap-6">
          <QsStatusSwitchToolbar
            v-model="detailView"
            :items="detailViewItems"
            stretch
            aria-label="寄仓详情视图切换"
          />
          <div v-if="detailView === 'basic'" class="flex flex-col gap-6">
            <section class="gap-3 grid sm:grid-cols-2">
              <div class="p-4 border border-border rounded-lg">
                <p class="qs-type-meta text-muted-foreground m-0">
                  货件编号
                </p>
                <div class="qs-type-data-emphasis mt-1">
                  <QsCopyableText label="货件编号" :text="detail.shipmentNo" />
                </div>
              </div>
              <div class="p-4 border border-border rounded-lg">
                <p class="qs-type-meta text-muted-foreground m-0">
                  货件唛头
                </p>
                <div class="qs-type-data-emphasis mt-1">
                  <QsCopyableText label="货件唛头" :text="detail.shippingMarkText" />
                </div>
              </div>
              <div class="p-4 border border-border rounded-lg">
                <p class="qs-type-meta text-muted-foreground m-0">
                  来源销售单
                </p>
                <div class="mt-1 flex flex-col gap-1 min-w-0">
                  <QsPersonDisplay
                    v-if="detail.originIssuer"
                    :display-name="detail.originIssuer.displayName"
                    :avatar-url="detail.originIssuer.avatarUrl"
                    size="sm"
                  />
                  <span v-else class="qs-type-meta text-muted-foreground">—</span>
                  <span class="qs-type-data-emphasis">
                    <QsCopyableText label="销售单号" :text="detail.originSalesOrderNo" />
                  </span>
                </div>
              </div>
              <div class="p-4 border border-border rounded-lg">
                <p class="qs-type-meta text-muted-foreground m-0">
                  来源采购单
                </p>
                <div class="mt-1 flex flex-col gap-1 min-w-0">
                  <QsPersonDisplay
                    v-if="detail.originPurchaseCreator"
                    :display-name="detail.originPurchaseCreator.displayName"
                    :avatar-url="detail.originPurchaseCreator.avatarUrl"
                    size="sm"
                  />
                  <span v-else class="qs-type-meta text-muted-foreground">—</span>
                  <span class="qs-type-data-emphasis">
                    <QsCopyableText label="采购单号" :text="detail.originPurchaseOrderNo" />
                  </span>
                </div>
              </div>
              <div class="p-4 border border-border rounded-lg">
                <p class="qs-type-meta text-muted-foreground m-0">
                  原单客户
                </p>
                <p class="mb-0 mt-1">
                  {{ detail.originCustomerName }}
                </p>
              </div>
              <div class="p-4 border border-border rounded-lg">
                <p class="qs-type-meta text-muted-foreground m-0">
                  寄仓位置
                </p>
                <p class="mb-0 mt-1">
                  {{ locationLabel(detail) }}
                </p>
              </div>
            </section>

            <section>
              <h3 class="qs-type-section-title mb-3">
                成本快照
              </h3>
              <div class="flex flex-col gap-3">
                <div class="p-4 border border-primary/30 rounded-xl bg-primary/10">
                  <p class="qs-type-meta text-muted-foreground m-0">
                    成本合计
                  </p>
                  <AmountDisplay
                    :value="detail.cost.totalCostCny"
                    currency="CNY"
                    :currencies="currencyCatalog.currencies.value"
                    class="text-2xl text-primary font-semibold mt-1"
                  />
                </div>
                <div class="gap-3 grid sm:grid-cols-2">
                  <div class="p-4 border border-border rounded-xl">
                    <p class="qs-type-meta text-muted-foreground m-0">
                      采购成本
                    </p>
                    <AmountDisplay
                      :value="detail.cost.purchaseCostCny"
                      currency="CNY"
                      :currencies="currencyCatalog.currencies.value"
                      class="mt-1"
                    />
                  </div>
                  <div class="p-4 border border-border rounded-xl">
                    <p class="qs-type-meta text-muted-foreground m-0">
                      包装成本
                    </p>
                    <AmountDisplay
                      v-if="hasPositiveAmount(detail.cost.packagingCostCny)"
                      :value="detail.cost.packagingCostCny"
                      currency="CNY"
                      :currencies="currencyCatalog.currencies.value"
                      class="mt-1"
                    />
                    <p v-else class="text-muted-foreground mb-0 mt-1">
                      -
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section v-if="detail.costTransfers.length > 0">
              <h3 class="qs-type-section-title mb-3">
                成本转移
              </h3>
              <div class="flex flex-col gap-2">
                <div
                  v-for="transfer in detail.costTransfers"
                  :key="`${transfer.direction}-${transfer.occurredAt}`"
                  class="p-3 border border-border rounded-lg flex flex-wrap gap-2 items-center justify-between"
                >
                  <div>
                    <p class="m-0">
                      {{ transfer.direction === 'RELEASE' ? '释放转出' : '认领转入' }}
                    </p>
                    <p class="qs-type-meta text-muted-foreground m-0">
                      {{ transfer.batchNos.length > 0 ? `资金批次 ${transfer.batchNos.join('、')}` : '未生成资金批次' }}
                    </p>
                  </div>
                  <div class="text-right">
                    <AmountDisplay
                      :value="transfer.amountCny"
                      currency="CNY"
                      :currencies="currencyCatalog.currencies.value"
                      :class="transfer.direction === 'RELEASE' ? 'text-primary' : 'text-destructive'"
                    />
                    <p class="qs-type-meta text-muted-foreground m-0">
                      <DateTimeDisplay :value="transfer.occurredAt" />
                    </p>
                  </div>
                </div>
              </div>
            </section>

            <section>
              <h3 class="qs-type-section-title mb-3">
                位置历史
              </h3>
              <div v-if="detail.locationEvents.length === 0" class="text-sm text-muted-foreground">
                暂无移动记录。
              </div>
              <div v-else class="flex flex-col gap-2">
                <div
                  v-for="event in detail.locationEvents"
                  :key="event.sequence"
                  class="p-3 border border-border rounded-lg flex flex-wrap gap-2 items-center justify-between"
                >
                  <div>
                    <p class="m-0 flex flex-wrap gap-1 items-center">
                      <span class="text-muted-foreground">
                        {{ event.fromWarehouseLabel ?? event.fromWarehouseValue ?? '—' }}
                      </span>
                      <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-3.5" />
                      <span>{{ event.warehouseLabel ?? event.warehouseValue }}</span>
                    </p>
                    <p class="qs-type-meta text-muted-foreground m-0">
                      {{ event.reason }}
                    </p>
                  </div>
                  <DateTimeDisplay :value="event.occurredAt" />
                </div>
              </div>
            </section>
          </div>

          <div v-else class="flex flex-col gap-4">
            <div v-if="containerMarkGroups.length === 0" class="text-sm text-muted-foreground">
              当前未装柜。
            </div>
            <div
              v-else
              class="pr-1 overscroll-contain flex flex-col gap-4 max-h-[75vh] min-h-0 overflow-y-auto"
            >
              <section
                v-for="group in containerMarkGroups"
                :key="group.mark"
                class="p-4 border border-border rounded-xl"
              >
                <div class="mb-3 flex gap-3 items-start justify-between">
                  <div class="min-w-0">
                    <p class="qs-type-meta text-muted-foreground m-0">
                      装柜唛头
                    </p>
                    <div class="mt-1 flex gap-1 min-w-0 items-start">
                      <span class="qs-type-data-emphasis break-all">{{ group.mark }}</span>
                      <CopyCellButton
                        v-if="group.mark !== '未记录装柜唛头'"
                        always-visible
                        label="装柜唛头"
                        :text="group.mark"
                      />
                    </div>
                    <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                      柜次：{{ group.items[0]?.containerBatch.containerBatchName }}
                      / {{ group.items[0]?.containerBatch.containerBatchNo }}
                      · 装柜日期 {{ group.items[0]?.containerBatch.loadingDate }}
                    </p>
                  </div>
                  <span class="qs-type-meta text-muted-foreground shrink-0">
                    {{ group.items.length }} 条明细
                  </span>
                </div>

                <div
                  v-for="(item, itemIndex) in group.items"
                  :key="item.id"
                  :class="itemIndex > 0 ? 'mt-4 pt-4 border-t border-border' : ''"
                >
                  <p class="font-medium mb-3">
                    {{ item.goodsName }} · {{ containerQuantity(item) }}
                  </p>
                  <dl class="m-0 gap-3 grid sm:grid-cols-2">
                    <div>
                      <dt class="qs-type-meta text-muted-foreground">
                        毛重
                      </dt>
                      <dd class="m-0 mt-1">
                        {{ containerWeight(item) }}
                      </dd>
                    </div>
                    <div>
                      <dt class="qs-type-meta text-muted-foreground">
                        尺寸
                      </dt>
                      <dd class="m-0 mt-1">
                        {{ containerDimensions(item) }}
                      </dd>
                    </div>
                    <div>
                      <dt class="qs-type-meta text-muted-foreground">
                        材积
                      </dt>
                      <dd class="m-0 mt-1">
                        {{ item.volumeCai ?? '—' }}
                      </dd>
                    </div>
                    <div>
                      <dt class="qs-type-meta text-muted-foreground">
                        计费材积
                      </dt>
                      <dd class="m-0 mt-1">
                        {{ item.chargeableVolumeCai ?? '—' }}
                      </dd>
                    </div>
                    <div>
                      <dt class="qs-type-meta text-muted-foreground">
                        来源材积
                      </dt>
                      <dd class="m-0 mt-1">
                        {{ item.reportedVolumeCai ?? '—' }}
                      </dd>
                    </div>
                    <div>
                      <dt class="qs-type-meta text-muted-foreground">
                        入仓参考号
                      </dt>
                      <dd class="m-0 mt-1 break-all">
                        {{ item.warehouseReceiptReference ?? '—' }}
                      </dd>
                    </div>
                    <div class="sm:col-span-2">
                      <dt class="qs-type-meta text-muted-foreground">
                        收件人
                      </dt>
                      <dd class="m-0 mt-1">
                        <span>{{ item.recipientName ?? '—' }}</span>
                        <span v-if="item.recipientPhone" class="ml-2">{{ item.recipientPhone }}</span>
                        <p v-if="item.recipientAddress" class="text-muted-foreground mb-0 mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                          {{ item.recipientAddress }}
                        </p>
                      </dd>
                    </div>
                    <div>
                      <dt class="qs-type-meta text-muted-foreground">
                        代收金额
                      </dt>
                      <dd class="m-0 mt-1">
                        <AmountDisplay
                          v-if="item.codAmountTwd !== null"
                          :value="item.codAmountTwd"
                          currency="TWD"
                          :currencies="currencyCatalog.currencies.value"
                        />
                        <span v-else>—</span>
                      </dd>
                    </div>
                    <div class="sm:col-span-2">
                      <dt class="qs-type-meta text-muted-foreground">
                        备注
                      </dt>
                      <dd class="m-0 mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
                        {{ item.remark ?? '—' }}
                      </dd>
                    </div>
                  </dl>
                </div>
              </section>
            </div>
          </div>
        </div>
      </QsGenericDrawer>
    </FaPageMain>
  </div>
</template>
