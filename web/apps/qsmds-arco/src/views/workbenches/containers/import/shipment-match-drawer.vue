<script setup lang="ts">
import type { CandidateViewContext, RowMatchState, ShipmentCandidateView } from '../shipment-candidate.logic'
import type { ImportDisplayRow } from './use-container-import'
import type { ContainerImportCandidateDto } from '@/api/generated/types.gen'
import { useDebounceFn } from '@vueuse/core'
import shipmentApi from '@/api/modules/purchase-shipments'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import ShipmentCandidateCard from '../shipment-candidate-card.vue'
import {
  buildImportCandidateView,
  buildSearchCandidateView,
  resolveCandidateRecommendation,
  resolveRowMatchState,
  resolveShipmentEligibilityFromFacts,
  sortCandidateViews,
  toImportCandidateFromSearch,
} from '../shipment-candidate.logic'
import { useContainerResource } from '../use-container-resource'
import ShipmentSourceSummary from './shipment-source-summary.vue'

defineOptions({ name: 'ShipmentMatchDrawer' })

const props = defineProps<{
  row: ImportDisplayRow | null
  warehouseValue: string
  batchId: string
  disabled: boolean
  enabled: boolean
}>()
const emit = defineEmits<{
  select: [rowKey: string, candidate: ContainerImportCandidateDto]
}>()
const open = defineModel<boolean>({ required: true })
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()

const mode = ref('CANDIDATES')
const searchDraft = ref('')
const search = ref('')
const page = ref(1)
const pageSize = 20
const canViewSalesOrder = computed(() => auth('sales-orders:read'))
const searchEnabled = computed(() => props.enabled && open.value && mode.value === 'SEARCH' && auth('purchase-orders:read'))
const query = computed(() => ({
  page: page.value,
  pageSize,
  keyword: search.value || undefined,
  destinationWarehouseValue: props.warehouseValue,
  view: 'ALL' as const,
  sort: 'WAREHOUSE_RECEIVED_DESC' as const,
}))
const resource = useContainerResource(searchEnabled, computed(() => account.authEpoch), query, async signal => (await shipmentApi.list(query.value, signal)).data)
const { data: searchData, loading: searchLoading, error: searchError, reload: reloadSearch } = resource

const context = computed<CandidateViewContext>(() => ({
  batchId: props.batchId,
  warehouseValue: props.warehouseValue,
  recipientName: props.row?.recipientName ?? null,
  selectedId: props.row?.selectedShipment?.id ?? null,
  matchedId: props.row?.matchedShipmentId ?? null,
  manuallySelected: props.row?.manuallySelected ?? false,
  canViewSalesOrder: canViewSalesOrder.value,
}))

const rawCandidateViews = computed(() => (props.row?.candidates ?? []).map(candidate => buildImportCandidateView(candidate, context.value)))
const recommendedId = computed(() => resolveCandidateRecommendation(rawCandidateViews.value))
const candidateCards = computed(() => sortCandidateViews(rawCandidateViews.value.map(candidate => ({ ...candidate, recommended: candidate.id === recommendedId.value }))))
const candidateTotal = computed(() => candidateCards.value.length)
const visibleCandidates = computed(() => candidateCards.value.slice((page.value - 1) * pageSize, page.value * pageSize))

const searchItems = computed(() => searchData.value?.items ?? [])
const searchCards = computed(() => searchItems.value.map(item => buildSearchCandidateView(item, context.value)))
const searchTotal = computed(() => searchData.value?.total ?? 0)

const rowState = computed<RowMatchState>(() => props.row ? resolveRowMatchState(props.row) : 'UNMATCHED')
const selectedLabel = computed(() => props.row?.selectedShipment?.shippingMarkText || props.row?.selectedShipment?.shipmentNo || '—')
const firstReason = computed(() => props.row?.candidates.find(candidate => !candidate.eligible)?.ineligibleReason ?? '')
const matchedFieldLabels = computed(() => {
  const selected = props.row?.candidates.find(candidate => candidate.id === props.row?.selectedShipment?.id)
    ?? props.row?.candidates.find(candidate => candidate.id === props.row?.matchedShipmentId)
  return selected?.matchFields.map(field => t(`containerImport.matchField.${field}`)) ?? []
})

type BannerTone = 'primary' | 'warning' | 'danger' | 'muted'
const banner = computed<{ tone: BannerTone, title: string, description: string }>(() => {
  switch (rowState.value) {
    case 'AUTO':
      return {
        tone: 'primary',
        title: t('containerImport.banner.auto', { name: selectedLabel.value }),
        description: matchedFieldLabels.value.length
          ? t('containerImport.banner.autoHint', { fields: matchedFieldLabels.value.join('、') })
          : props.row?.matchReason || '',
      }
    case 'AMBIGUOUS':
      return {
        tone: 'warning',
        title: t('containerImport.banner.ambiguous', { count: props.row?.candidates.length ?? 0 }),
        description: recommendedId.value ? t('containerImport.banner.recommended') : t('containerImport.banner.ambiguousHint'),
      }
    case 'UNAVAILABLE':
      return {
        tone: 'danger',
        title: t('containerImport.banner.unavailable'),
        description: [firstReason.value, t('containerImport.banner.unavailableHint')].filter(Boolean).join('；'),
      }
    case 'MANUAL':
      return {
        tone: 'primary',
        title: t('containerImport.banner.manual', { name: selectedLabel.value }),
        description: props.row?.matchReason || '',
      }
    default:
      return {
        tone: 'muted',
        title: t('containerImport.banner.unmatched'),
        description: t('containerImport.banner.unmatchedHint'),
      }
  }
})
const bannerClass = computed(() => ({
  primary: 'border-primary/25 bg-primary/5 text-primary',
  warning: 'border-amber-500/25 bg-amber-500/5 text-amber-700 dark:text-amber-400',
  danger: 'border-destructive/25 bg-destructive/5 text-destructive',
  muted: 'border-border bg-muted/40 text-muted-foreground',
}[banner.value.tone]))
const bannerIcon = computed(() => ({
  primary: 'i-lucide:circle-check',
  warning: 'i-lucide:triangle-alert',
  danger: 'i-lucide:circle-alert',
  muted: 'i-lucide:search',
}[banner.value.tone]))
const rowTone = computed(() => ({
  MATCHED: 'text-primary border-primary/25 bg-primary/5',
  AMBIGUOUS: 'text-amber-700 dark:text-amber-400 border-amber-500/25 bg-amber-500/5',
  UNMATCHED: 'text-muted-foreground border-border bg-muted/40',
  INVALID: 'text-destructive border-destructive/25 bg-destructive/5',
  SKIPPED: 'text-muted-foreground border-border bg-muted/40',
}[props.row?.displayStatus ?? 'UNMATCHED']))

watch([() => props.row?.rowKey, open], () => {
  searchDraft.value = ''
  search.value = ''
  page.value = 1
  mode.value = props.row?.candidates.length ? 'CANDIDATES' : 'SEARCH'
})
watch(mode, () => {
  page.value = 1
})
watch(candidateTotal, (total) => {
  page.value = Math.max(1, Math.min(page.value, Math.ceil(total / pageSize) || 1))
})

const debouncedSearch = useDebounceFn(() => applySearch(), 250)
watch(searchDraft, () => debouncedSearch())

function applySearch() {
  search.value = searchDraft.value.trim()
  page.value = 1
}

function searchByRecipient() {
  if (!props.row?.recipientName) {
    return
  }
  searchDraft.value = props.row.recipientName
  applySearch()
}

function clearSearch() {
  searchDraft.value = ''
  applySearch()
}

function changePage(next: number) {
  if (next === page.value) {
    return
  }
  page.value = next
}

function chooseCandidate(candidate: ShipmentCandidateView) {
  if (!props.enabled || props.disabled || !props.row || !candidate.eligible) {
    return
  }
  if (mode.value === 'CANDIDATES') {
    const selected = props.row.candidates.find(item => item.id === candidate.id)
    if (!selected) {
      return
    }
    emit('select', props.row.rowKey, selected)
    open.value = false
    return
  }
  const item = searchItems.value.find(entry => entry.id === candidate.id)
  if (!item) {
    return
  }
  const eligibility = resolveShipmentEligibilityFromFacts(item, props.batchId, props.warehouseValue)
  const candidateDto = toImportCandidateFromSearch(item, eligibility, {
    canViewSalesOrder: canViewSalesOrder.value,
    reasonText: eligibility.reasonKey ? t(eligibility.reasonKey) : null,
  })
  emit('select', props.row.rowKey, candidateDto)
  open.value = false
}
</script>

<template>
  <QsGenericDrawer
    v-model="open"
    size="xl"
    :title="t('containerImport.drawerTitle')"
    :description="row ? t('containerImport.drawerRow', { row: row.sourceRowNumber, reference: row.warehouseReceiptReference || '—' }) : t('containerImport.drawerHint')"
    :submitting="disabled"
  >
    <template #header-extra>
      <FaTag v-if="row" variant="outline" class="qs-type-status-tag whitespace-nowrap" :class="rowTone">
        {{ t(`containerImport.status.${row.displayStatus}`) }}
      </FaTag>
    </template>

    <div v-if="row" class="min-w-0 space-y-3">
      <ShipmentSourceSummary :row="row" />

      <div class="p-3 border rounded-lg flex gap-2 min-w-0 items-start" :class="bannerClass">
        <FaIcon :name="bannerIcon" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />
        <div class="min-w-0">
          <p class="qs-type-body-medium m-0">
            {{ banner.title }}
          </p>
          <p v-if="banner.description" class="qs-type-meta m-0 mt-1 [overflow-wrap:anywhere]">
            {{ banner.description }}
          </p>
        </div>
      </div>

      <QsStatusSwitchToolbar
        v-model="mode"
        :items="[
          { value: 'CANDIDATES', label: t('containerImport.candidates'), count: row.candidates.length },
          { value: 'SEARCH', label: t('containerImport.manualSearch') },
        ]"
      />

      <template v-if="mode === 'CANDIDATES'">
        <p v-if="candidateCards.length" class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerImport.clickHint') }}
        </p>
        <div v-if="candidateCards.length" role="radiogroup" :aria-label="t('containerImport.candidates')" class="flex flex-col gap-2">
          <ShipmentCandidateCard
            v-for="candidate in visibleCandidates"
            :key="candidate.id"
            :candidate="candidate"
            :disabled="disabled || !enabled"
            @select="chooseCandidate(candidate)"
          />
        </div>
        <FaEmpty v-else :title="t('containerImport.noCandidates')" :description="t('containerImport.noCandidatesHint')" class="py-8" />
        <FaPagination
          v-if="candidateTotal > pageSize"
          :page="page"
          :size="pageSize"
          :total="candidateTotal"
          layout="total, prev, pager, next"
          :text-templates="{ total: value => t('containerImport.resultCount', { count: value }) }"
          @update:page="changePage"
        />
      </template>

      <template v-else>
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerImport.searchHint') }}
        </p>
        <div class="flex flex-wrap gap-2 items-center">
          <FaInput
            v-model="searchDraft"
            class="flex-1 min-w-48"
            clearable
            :placeholder="t('containerImport.shipmentSearch')"
            @keyup.enter="applySearch"
            @clear="clearSearch"
          />
          <FaButton variant="outline" @click="applySearch">
            {{ t('containerImport.searchAction') }}
          </FaButton>
        </div>
        <div v-if="row.recipientName && !searchDraft" class="flex flex-wrap gap-2 items-center">
          <span class="qs-type-meta text-muted-foreground">{{ t('containerImport.searchByRecipientHint') }}</span>
          <FaButton variant="outline" size="sm" @click="searchByRecipient">
            {{ t('containerImport.searchByRecipient', { name: row.recipientName }) }}
          </FaButton>
        </div>
        <p v-if="!searchDraft" class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerImport.searchAllHint') }}
        </p>
        <p v-if="searchTotal" class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerImport.resultCount', { count: searchTotal }) }}
        </p>

        <div v-if="searchLoading" class="flex flex-col gap-2" role="status" :aria-label="t('containerImport.loadingCandidates')">
          <div v-for="index in 3" :key="index" class="rounded-lg bg-muted/40 h-24 animate-pulse" aria-hidden="true" />
        </div>
        <div v-else-if="searchError" class="py-8 flex flex-col gap-3 items-center">
          <FaEmpty icon="i-lucide:circle-alert" :title="t('containerImport.loadFailed')" :description="searchError" />
          <FaButton variant="outline" @click="reloadSearch">
            {{ t('containerImport.retryLoad') }}
          </FaButton>
        </div>
        <div v-else-if="searchCards.length" role="radiogroup" :aria-label="t('containerImport.manualSearch')" class="flex flex-col gap-2">
          <ShipmentCandidateCard
            v-for="candidate in searchCards"
            :key="candidate.id"
            :candidate="candidate"
            :disabled="disabled || !enabled"
            @select="chooseCandidate(candidate)"
          />
        </div>
        <FaEmpty
          v-else
          :title="t(searchDraft ? 'containerImport.searchEmpty' : 'containerImport.searchNoKeyword')"
          :description="searchDraft ? t('containerImport.searchEmptyHint') : t('containerImport.noSearchResults')"
          class="py-8"
        />
        <FaPagination
          v-if="searchTotal > pageSize"
          :page="page"
          :size="pageSize"
          :total="searchTotal"
          layout="total, prev, pager, next"
          :text-templates="{ total: value => t('containerImport.resultCount', { count: value }) }"
          @update:page="changePage"
        />
      </template>
    </div>
  </QsGenericDrawer>
</template>
