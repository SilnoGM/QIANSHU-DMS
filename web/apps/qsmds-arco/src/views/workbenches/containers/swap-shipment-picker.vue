<script setup lang="ts">
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import shipmentApi from '@/api/modules/purchase-shipments'
import { containerMarkDisplay, containerMarkTitle } from './container-swap.logic'
import { useContainerResource } from './use-container-resource'

defineOptions({ name: 'SwapShipmentPicker' })

const props = withDefaults(defineProps<{
  title: string
  excludeShipmentId?: string | null
}>(), {
  excludeShipmentId: null,
})

const emit = defineEmits<{
  select: [shipment: PurchaseShipmentListItemDto]
}>()

const { t } = useI18n()
const account = useAppAccountStore()
const enabled = ref(true)
const epoch = computed(() => account.authEpoch)
const page = ref(1)
const pageSize = 10
const searchDraft = ref('')
const search = ref('')
const query = computed(() => ({
  page: page.value,
  pageSize,
  keyword: search.value || undefined,
  view: 'CONTAINER_LOADED' as const,
}))
const resource = useContainerResource(
  enabled,
  epoch,
  query,
  async signal => (await shipmentApi.list(query.value, signal)).data,
)
const { data, loading, error } = resource
const items = computed(() => (data.value?.items ?? []).filter(item => item.id !== props.excludeShipmentId))
const total = computed(() => Math.max(0, (data.value?.total ?? 0) - (items.value.length < (data.value?.items.length ?? 0) ? 1 : 0)))

function applySearch(): void {
  search.value = searchDraft.value.trim()
  page.value = 1
}

function clearSearch(): void {
  searchDraft.value = ''
  applySearch()
}

function changePage(next: number): void {
  if (next !== page.value) {
    page.value = next
  }
}

function choose(shipment: PurchaseShipmentListItemDto): void {
  emit('select', shipment)
}
</script>

<template>
  <section class="min-w-0 space-y-3" :aria-label="title">
    <div class="flex flex-wrap gap-2 items-center justify-between">
      <h3 class="qs-type-component-title m-0">
        {{ title }}
      </h3>
      <span class="qs-type-meta text-muted-foreground">{{ t('containerPage.swapPickerHint') }}</span>
    </div>
    <div class="flex flex-wrap gap-2 items-center">
      <FaInput
        v-model="searchDraft"
        class="flex-1 min-w-48"
        clearable
        :placeholder="t('containerPage.swapSearchPlaceholder')"
        @keyup.enter="applySearch"
        @clear="clearSearch"
      />
      <FaButton type="button" variant="outline" @click="applySearch">
        {{ t('containerPage.swapSearchAction') }}
      </FaButton>
    </div>
    <div v-if="loading" class="flex flex-col gap-2" role="status" :aria-label="t('containerPage.loading')">
      <div v-for="index in 3" :key="index" class="rounded-lg bg-muted/40 h-20 animate-pulse" aria-hidden="true" />
    </div>
    <div v-else-if="error" class="py-6 flex flex-col gap-2 items-center">
      <FaEmpty icon="i-lucide:circle-alert" :title="t('containerPage.retry')" :description="error" />
      <FaButton type="button" variant="outline" @click="resource.reload">
        {{ t('containerPage.retry') }}
      </FaButton>
    </div>
    <div v-else-if="items.length" class="pr-1 flex flex-col gap-2 max-h-72 overflow-y-auto" role="list">
      <button
        v-for="shipment in items"
        :key="shipment.id"
        type="button"
        class="p-3 text-left border border-border rounded-lg bg-background w-full transition-colors focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 hover:border-primary/60 hover:bg-muted/30"
        role="listitem"
        @click="choose(shipment)"
      >
        <div class="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
          <span class="text-foreground font-semibold">
            {{ shipment.containerBatch?.containerBatchName ?? t('containerPage.none') }}
          </span>
          <span class="text-muted-foreground">·</span>
          <span class="text-primary font-semibold max-w-full min-w-0 truncate" :title="containerMarkTitle(shipment)">
            {{ containerMarkDisplay(shipment) }}
          </span>
        </div>
        <div v-if="shipment.shipmentNo" class="qs-type-data mt-1 [overflow-wrap:anywhere]">
          {{ shipment.shipmentNo }}
        </div>
        <div class="qs-type-meta text-muted-foreground mt-1 flex flex-nowrap gap-x-3 min-w-0">
          <span class="shrink-0 whitespace-nowrap">{{ t('containerPage.swapSalesOrder') }}：{{ shipment.salesSource?.orderNo ?? t('containerPage.swapUnassigned') }}</span>
          <span class="flex shrink gap-1 max-w-48 min-w-0 items-baseline overflow-hidden" :title="shipment.salesSource?.customerName ?? ''">
            <span class="shrink-0">{{ t('containerPage.swapCustomer') }}：</span>
            <span class="min-w-0 truncate">{{ shipment.salesSource?.customerName ?? '—' }}</span>
          </span>
          <span class="shrink-0 whitespace-nowrap">{{ t('containerPage.purchase') }}：{{ shipment.purchaseOrder.orderNo }}</span>
          <span class="shrink-0 whitespace-nowrap">{{ shipment.lineSummary.lineCount }} 行 / {{ shipment.lineSummary.totalQuantity }} 件</span>
        </div>
      </button>
    </div>
    <FaEmpty
      v-else
      class="py-6"
      :title="t(search ? 'containerPage.swapSearchEmpty' : 'containerPage.swapSearchHint')"
      :description="t(search ? 'containerPage.swapSearchEmptyHint' : 'containerPage.swapSearchHint')"
    />
    <FaPagination
      v-if="total > pageSize"
      :page="page"
      :size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @update:page="changePage"
    />
  </section>
</template>
