<script setup lang="ts">
import type { ShipmentStorageContainerItemDto, ShipmentStorageDetailDto, ShipmentStorageListItemDto } from '@/api/generated/types.gen'
import type { StorageScopeFilter, StorageStatusTab } from '@/views/workbenches/shipment-storage/logic'
import shipmentStorageApi from '@/api/modules/shipment-storage'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsProductThumbnail from '@/components/business/QsProductThumbnail/index.vue'
import QsShipmentStorageCard from '@/components/business/QsShipmentStorageCard/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { useDictionaryCatalog } from '@/dictionary-catalog/use-dictionary-catalog'
import { buildStorageQuery, claimRequestDisabledReason, DEFAULT_STORAGE_STATUS, locationLabel, STORAGE_SCOPE_OPTIONS, STORAGE_STATUS_TABS, storageFailureMessage, storageStatusClass, storageStatusLabel } from '@/views/workbenches/shipment-storage/logic'

defineOptions({ name: 'QsOperationsGoodsStorage' })

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

function changePageSize(size: number): void {
  pageSize.value = size
  page.value = 1
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

const detailContainerMarkText = computed(() => containerMarkGroups.value
  .map(group => group.mark)
  .filter(mark => mark !== '未记录装柜唛头')
  .join('、'))

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
      <div class="qs-storage-list flex flex-col gap-4">
        <QsStatusSwitchToolbar
          :model-value="status"
          :items="statusTabs"
          aria-label="寄仓状态"
          @update:model-value="selectStatus($event as StorageStatusTab)"
        />

        <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
            <FaSelect
              :model-value="scope"
              :options="[...STORAGE_SCOPE_OPTIONS]"
              class="w-full sm:w-36"
              aria-label="位置范围"
              @update:model-value="changeScope(String($event))"
            />
            <FaSelect
              :model-value="warehouseValue"
              :options="warehouseOptions"
              class="w-full sm:w-52"
              aria-label="仓库"
              @update:model-value="changeWarehouse(String($event))"
            />
          </div>
          <FaInput
            v-model="keyword"
            type="search"
            clearable
            class="w-full sm:w-80"
            placeholder="货件编号、唛头、销售单、采购单或客户"
            aria-label="搜索货件、唛头、销售单、采购单或客户"
          >
            <template #start>
              <FaIcon name="i-lucide:search" />
            </template>
          </FaInput>
        </div>

        <div v-if="error" class="py-12 flex flex-col gap-4 items-center">
          <FaEmpty icon="i-lucide:circle-alert" title="寄仓记录加载失败" :description="error" />
          <FaButton variant="outline" @click="load">
            重试
          </FaButton>
        </div>
        <div v-else-if="loading" class="qs-storage-card-grid" aria-busy="true">
          <div
            v-for="index in 4"
            :key="index"
            aria-hidden="true"
            class="border border-border rounded-xl bg-card h-56 motion-safe:animate-pulse"
          />
        </div>
        <FaEmpty
          v-else-if="!rows.length"
          icon="i-lucide:package-open"
          title="暂无寄仓记录"
          description="释放货件后会在这里显示。"
          class="py-12"
        />
        <template v-else>
          <div class="qs-storage-card-grid" aria-live="polite">
            <QsShipmentStorageCard
              v-for="row in rows"
              :key="row.id"
              :record="row"
              :currencies="currencyCatalog.currencies.value"
              :status-label="storageStatusLabel(row.status)"
              :status-class="storageStatusClass(row.status)"
              :apply-disabled-reason="claimRequestDisabledReason(row)"
              @detail="openDetail(row)"
              @apply="toast.info('申请调货功能开发中')"
            />
          </div>
          <nav v-if="total > 0" class="mt-5 overflow-x-auto" aria-label="寄仓记录分页">
            <FaPagination
              :page="page"
              :size="pageSize"
              :total="total"
              :sizes="[20, 50, 100]"
              layout="total, sizes, ->, pager"
              :text-templates="{ total: value => `共 ${value} 条`, sizes: value => `${value} 条/页` }"
              @update:page="page = $event"
              @update:size="changePageSize"
            />
          </nav>
        </template>
      </div>

      <QsGenericDrawer
        v-model="detailOpen"
        title="寄仓详情"
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
            <section class="p-4 border border-border rounded-xl bg-muted/20 flex flex-col gap-4">
              <dl class="m-0 gap-x-8 gap-y-3 grid sm:grid-cols-2">
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    货件编号
                  </dt>
                  <dd class="qs-type-data-emphasis m-0 mt-1">
                    <QsCopyableText v-if="detail.shipmentNo" label="货件编号" :text="detail.shipmentNo" />
                    <span v-else>—</span>
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    寄仓位置
                  </dt>
                  <dd class="m-0 mt-1">
                    {{ locationLabel(detail) }}
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    原单客户
                  </dt>
                  <dd class="m-0 mt-1">
                    {{ detail.originCustomerName }}
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    转入寄仓
                  </dt>
                  <dd class="m-0 mt-1">
                    <DateTimeDisplay :value="detail.createdAt" />
                  </dd>
                </div>
              </dl>

              <div class="p-3 border border-primary/30 rounded-lg bg-primary/10">
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
            </section>

            <section>
              <h3 class="qs-type-section-title mb-3">
                产品
              </h3>
              <div v-if="detail.lineSummary.previews.length" class="border border-border rounded-xl overflow-hidden divide-border divide-y">
                <div
                  v-for="product in detail.lineSummary.previews"
                  :key="product.lineId"
                  class="p-3 flex gap-3 min-w-0 items-center"
                >
                  <QsProductThumbnail
                    :src="product.mainImage?.contentUrl ?? null"
                    :alt="product.productName"
                    size="md"
                  />
                  <div class="flex flex-1 flex-col gap-1 min-w-0">
                    <span class="text-xs text-emerald-700 font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 self-start">
                      {{ product.productNo || '自定义产品' }}
                    </span>
                    <p class="text-sm m-0 break-words">
                      {{ product.productName }}
                    </p>
                  </div>
                  <span class="text-sm font-mono shrink-0 tabular-nums">×{{ product.quantity }}</span>
                </div>
              </div>
              <p v-else class="text-sm text-muted-foreground m-0">
                暂无产品。
              </p>
            </section>

            <section>
              <h3 class="qs-type-section-title mb-3">
                唛头与来源
              </h3>
              <dl class="m-0 p-4 border border-border rounded-xl gap-x-6 gap-y-4 grid sm:grid-cols-2">
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    货件唛头
                  </dt>
                  <dd class="text-sm m-0 mt-1 break-all">
                    <QsCopyableText v-if="detail.shippingMarkText" label="货件唛头" :text="detail.shippingMarkText" />
                    <span v-else>—</span>
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    装柜唛头
                  </dt>
                  <dd class="text-sm m-0 mt-1 break-all">
                    <QsCopyableText v-if="detailContainerMarkText" label="装柜唛头" :text="detailContainerMarkText" />
                    <span v-else>—</span>
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    来源销售单
                  </dt>
                  <dd class="text-sm m-0 mt-1 flex flex-wrap gap-x-2 gap-y-1 items-center">
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
                  </dd>
                </div>
                <div>
                  <dt class="qs-type-meta text-muted-foreground">
                    来源采购单
                  </dt>
                  <dd class="text-sm m-0 mt-1 flex flex-wrap gap-x-2 gap-y-1 items-center">
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
                  </dd>
                </div>
              </dl>
            </section>

            <section>
              <h3 class="qs-type-section-title mb-3">
                成本快照
              </h3>
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

<style scoped>
.qs-storage-list {
  container-type: inline-size;
}

.qs-storage-card-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1rem;
  align-items: start;
}

@container (min-width: 68rem) {
  .qs-storage-card-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
