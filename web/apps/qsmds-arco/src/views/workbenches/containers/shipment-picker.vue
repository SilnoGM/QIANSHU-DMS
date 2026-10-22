<script setup lang="ts">
import type { CandidateViewContext, ShipmentCandidateView } from './shipment-candidate.logic'
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import { useDebounceFn } from '@vueuse/core'
import shipmentApi from '@/api/modules/purchase-shipments'
import ShipmentCandidateCard from './shipment-candidate-card.vue'
import { buildSearchCandidateView } from './shipment-candidate.logic'
import { useContainerResource } from './use-container-resource'

defineOptions({ name: 'ShipmentPicker' })

const props = withDefaults(defineProps<{
  warehouseValue: string
  batchId: string
  recipientName?: string | null
  selectedShipmentId?: string | null
  disabled?: boolean
}>(), {
  recipientName: null,
  selectedShipmentId: null,
  disabled: false,
})
const emit = defineEmits<{
  select: [shipment: PurchaseShipmentListItemDto]
  close: []
}>()

const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const enabled = computed(() => auth('purchase-orders:read') && !props.disabled)
const page = ref(1)
const pageSize = 20
const searchDraft = ref('')
const search = ref('')
const query = computed(() => ({
  page: page.value,
  pageSize,
  keyword: search.value || undefined,
  destinationWarehouseValue: props.warehouseValue,
  view: 'ALL' as const,
  sort: 'WAREHOUSE_RECEIVED_DESC' as const,
}))
const resource = useContainerResource(enabled, computed(() => account.authEpoch), query, async signal => (await shipmentApi.list(query.value, signal)).data)
const { data, loading, error } = resource

const context = computed<CandidateViewContext>(() => ({
  batchId: props.batchId,
  warehouseValue: props.warehouseValue,
  recipientName: props.recipientName,
  selectedId: props.selectedShipmentId,
  matchedId: null,
  manuallySelected: false,
  canViewSalesOrder: true,
}))
const cards = computed(() => (data.value?.items ?? []).map(item => buildSearchCandidateView(item, context.value)))
const total = computed(() => data.value?.total ?? 0)

const debouncedSearch = useDebounceFn(() => applySearch(), 250)
watch(searchDraft, () => debouncedSearch())

function applySearch() {
  search.value = searchDraft.value.trim()
  page.value = 1
}

function clearSearch() {
  searchDraft.value = ''
  applySearch()
}

function searchByRecipient() {
  if (!props.recipientName) {
    return
  }
  searchDraft.value = props.recipientName
  applySearch()
}

function changePage(next: number) {
  if (next === page.value) {
    return
  }
  page.value = next
}

function choose(candidate: ShipmentCandidateView) {
  if (!enabled.value || !candidate.eligible) {
    return
  }
  const item = data.value?.items.find(entry => entry.id === candidate.id)
  if (item) {
    emit('select', item)
  }
}
</script>

<template>
  <section class="mt-4 pt-4 border-t border-border min-w-0">
    <div class="mb-3 flex gap-3 items-center justify-between">
      <h3 class="qs-type-component-title m-0">
        {{ t('containerPage.shipmentSelect') }}
      </h3>
      <FaButton type="button" variant="ghost" size="sm" @click="emit('close')">
        {{ t('containerPage.cancelSelect') }}
      </FaButton>
    </div>
    <p class="qs-type-meta text-muted-foreground mb-3">
      {{ t('containerPage.shipmentHint') }}
    </p>
    <FaAlert v-if="!auth('purchase-orders:read')" :title="t('containerPage.shipmentPermission')" />
    <template v-else>
      <div class="flex flex-wrap gap-2 items-center">
        <FaInput
          v-model="searchDraft"
          class="flex-1 min-w-48"
          clearable
          :placeholder="t('containerImport.shipmentSearch')"
          @keyup.enter="applySearch"
          @clear="clearSearch"
        />
        <FaButton type="button" variant="outline" @click="applySearch">
          {{ t('containerImport.searchAction') }}
        </FaButton>
      </div>
      <div v-if="recipientName && !searchDraft" class="mt-2 flex flex-wrap gap-2 items-center">
        <span class="qs-type-meta text-muted-foreground">{{ t('containerImport.searchByRecipientHint') }}</span>
        <FaButton type="button" variant="outline" size="sm" @click="searchByRecipient">
          {{ t('containerImport.searchByRecipient', { name: recipientName }) }}
        </FaButton>
      </div>
      <p v-if="!searchDraft" class="qs-type-meta text-muted-foreground mb-0 mt-2">
        {{ t('containerImport.searchAllHint') }}
      </p>
      <p v-if="total" class="qs-type-meta text-muted-foreground mb-0 mt-2">
        {{ t('containerImport.resultCount', { count: total }) }}
      </p>

      <div v-if="loading" class="mt-3 flex flex-col gap-2" role="status" :aria-label="t('containerImport.loadingCandidates')">
        <div v-for="index in 3" :key="index" class="rounded-lg bg-muted/40 h-24 animate-pulse" aria-hidden="true" />
      </div>
      <div v-else-if="error" class="py-8 flex flex-col gap-3 items-center">
        <FaEmpty icon="i-lucide:circle-alert" :title="t('containerImport.loadFailed')" :description="error" />
        <FaButton type="button" variant="outline" @click="resource.reload">
          {{ t('containerImport.retryLoad') }}
        </FaButton>
      </div>
      <div v-else-if="cards.length" role="radiogroup" :aria-label="t('containerImport.manualSearch')" class="mt-3 flex flex-col gap-2">
        <ShipmentCandidateCard
          v-for="candidate in cards"
          :key="candidate.id"
          :candidate="candidate"
          :disabled="!enabled"
          @select="choose(candidate)"
        />
      </div>
      <FaEmpty
        v-else
        class="py-8"
        :title="t(searchDraft ? 'containerImport.searchEmpty' : 'containerImport.searchNoKeyword')"
        :description="searchDraft ? t('containerImport.searchEmptyHint') : t('containerImport.noSearchResults')"
      />
      <FaPagination
        v-if="total > pageSize"
        class="mt-3"
        :page="page"
        :size="pageSize"
        :total="total"
        layout="total, prev, pager, next"
        :text-templates="{ total: value => t('containerImport.resultCount', { count: value }) }"
        @update:page="changePage"
      />
    </template>
  </section>
</template>
