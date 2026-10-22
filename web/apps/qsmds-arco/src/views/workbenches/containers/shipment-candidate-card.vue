<script setup lang="ts">
import type { ShipmentCandidateView } from './shipment-candidate.logic'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { resolveCandidatePrimaryState } from './shipment-candidate.logic'

defineOptions({ name: 'ShipmentCandidateCard' })

const props = withDefaults(defineProps<{
  candidate: ShipmentCandidateView
  disabled?: boolean
}>(), {
  disabled: false,
})

const emit = defineEmits<{
  select: []
}>()

const { t } = useI18n()

const primaryState = computed(() => resolveCandidatePrimaryState(props.candidate))
const interactive = computed(() => props.candidate.eligible && !props.disabled)
const shipmentLabel = computed(() => props.candidate.shippingMarkText || props.candidate.shipmentNo || '—')
const customerText = computed(() => props.candidate.purchaseType === 'STOCK'
  ? t('containerImport.stockPurchase')
  : props.candidate.customerName || '—')
const lifecycleLabel = computed(() => t(`purchaseShipments.${props.candidate.viewStatus}`))
const reason = computed(() => props.candidate.ineligibleReason
  ?? (props.candidate.ineligibleReasonKey ? t(props.candidate.ineligibleReasonKey) : ''))
const matchFieldLabels = computed(() => props.candidate.matchFields.map(field => t(`containerImport.matchField.${field}`)))

const stateLabel = computed(() => t({
  auto: 'containerImport.autoMatched',
  selected: 'containerImport.currentSelected',
  recommended: 'containerImport.recommended',
  available: 'containerImport.available',
  ineligible: 'containerImport.unavailable',
}[primaryState.value]))

const stateClass = computed(() => ({
  auto: 'text-primary border-primary/25 bg-primary/5',
  selected: 'text-primary border-primary/25 bg-primary/5',
  recommended: 'text-primary border-primary/30 bg-primary/[0.03]',
  available: 'text-muted-foreground border-border bg-muted/30',
  ineligible: 'text-destructive border-destructive/25 bg-destructive/5',
}[primaryState.value]))

const customerHintLabel = computed(() => {
  if (props.candidate.customerHint === 'MATCH') {
    return t('containerImport.customerMatch')
  }
  if (props.candidate.customerHint === 'MISMATCH') {
    return t('containerImport.customerMismatch')
  }
  return ''
})
const customerHintClass = computed(() => props.candidate.customerHint === 'MATCH'
  ? 'text-primary border-primary/25 bg-primary/5'
  : 'text-muted-foreground border-border bg-muted/30')

const rootClass = computed(() => {
  if (!props.candidate.eligible) {
    return 'border-border bg-muted/20'
  }
  if (props.candidate.selected) {
    return 'border-primary bg-primary/[0.035] ring-1 ring-primary/20'
  }
  if (props.candidate.recommended) {
    return 'border-primary/40 bg-primary/[0.02] hover:border-primary/60'
  }
  return 'border-border bg-background hover:border-primary/50'
})

const ariaLabel = computed(() => [
  t('containerImport.shipmentLabel'),
  shipmentLabel.value,
  `${t('containerImport.customer')} ${customerText.value}`,
  stateLabel.value,
  reason.value,
].filter(Boolean).join('，'))

function choose() {
  if (!interactive.value) {
    return
  }
  emit('select')
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }
  event.preventDefault()
  choose()
}
</script>

<template>
  <div
    role="radio"
    :aria-checked="candidate.selected"
    :aria-disabled="interactive ? undefined : 'true'"
    :aria-label="ariaLabel"
    :tabindex="interactive ? 0 : -1"
    class="p-3 text-start border rounded-lg flex flex-col gap-3 min-w-0 w-full transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    :class="[rootClass, interactive ? 'cursor-pointer' : 'cursor-not-allowed']"
    @click="choose"
    @keydown="handleKeydown"
  >
    <div class="flex gap-3 min-w-0 items-start justify-between">
      <div class="flex gap-3 min-w-0 items-start">
        <span
          class="mt-1 border-2 rounded-full flex shrink-0 size-4 items-center justify-center"
          :class="candidate.selected ? 'border-primary' : 'border-muted-foreground/50'"
          aria-hidden="true"
        >
          <span v-if="candidate.selected" class="rounded-full bg-primary size-2" />
        </span>
        <div class="min-w-0">
          <p class="qs-type-data-emphasis font-mono m-0 [overflow-wrap:anywhere]">
            {{ shipmentLabel }}
          </p>
          <div class="qs-type-meta text-muted-foreground mt-1 flex flex-wrap gap-x-2 gap-y-0.5 min-w-0 [overflow-wrap:anywhere]">
            <span v-if="candidate.shipmentNo && candidate.shipmentNo !== shipmentLabel">{{ candidate.shipmentNo }}</span>
            <span v-if="candidate.trackingNo">{{ t('containerImport.tracking') }} <span class="font-mono">{{ candidate.trackingNo }}</span></span>
          </div>
        </div>
      </div>
      <div class="flex shrink-0 flex-col gap-1 items-end">
        <FaTag variant="outline" class="qs-type-status-tag whitespace-nowrap" :class="stateClass">
          {{ stateLabel }}
        </FaTag>
        <FaTag v-if="customerHintLabel" variant="outline" class="qs-type-status-tag whitespace-nowrap" :class="customerHintClass">
          {{ customerHintLabel }}
        </FaTag>
      </div>
    </div>

    <div class="text-sm gap-x-5 gap-y-2 grid min-w-0 sm:grid-cols-2">
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerImport.customer') }}
        </p>
        <p class="qs-type-body-medium m-0 mt-0.5 [overflow-wrap:anywhere]">
          {{ customerText }}
        </p>
      </div>
      <div class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerPage.purchase') }}
        </p>
        <p class="qs-type-data font-mono m-0 mt-0.5 [overflow-wrap:anywhere]">
          {{ candidate.purchaseOrderNo || '—' }}
        </p>
      </div>
      <div v-if="candidate.salesOrderNo" class="min-w-0">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('containerPage.sales') }}
        </p>
        <p class="qs-type-data font-mono m-0 mt-0.5 [overflow-wrap:anywhere]">
          {{ candidate.salesOrderNo }}
        </p>
      </div>
      <div class="min-w-0 sm:col-span-2">
        <p class="qs-type-meta text-muted-foreground m-0">
          {{ t('purchaseShipments.products') }}
        </p>
        <p class="qs-type-body m-0 mt-0.5 [overflow-wrap:anywhere] line-clamp-2" :title="candidate.goodsName">
          {{ candidate.goodsName || '—' }}
        </p>
      </div>
    </div>

    <div class="qs-type-meta text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 min-w-0 items-center">
      <span>{{ lifecycleLabel }}</span>
      <span v-if="candidate.warehouseReceivedAt" class="flex gap-1 items-baseline">
        {{ t('containerImport.receivedAt') }}
        <DateTimeDisplay :value="candidate.warehouseReceivedAt" format="date" />
      </span>
      <span v-if="candidate.matchesThisBatch">{{ t('containerImport.loadedHere') }}</span>
      <span v-else-if="candidate.matchedElsewhere && candidate.containerBatch">
        {{ t('containerImport.loadedElsewhere') }} {{ candidate.containerBatch.containerBatchNo }}
      </span>
      <span v-else-if="candidate.loadedWithoutBatch">{{ t('containerImport.loadedWithoutBatch') }}</span>
    </div>

    <div class="flex flex-wrap gap-3 min-w-0 items-center justify-between">
      <div v-if="matchFieldLabels.length" class="flex flex-wrap gap-1.5 min-w-0 items-center">
        <span class="qs-type-meta text-muted-foreground">{{ t('containerImport.matchFields') }}</span>
        <FaTag
          v-for="label in matchFieldLabels"
          :key="label"
          variant="outline"
          class="text-primary qs-type-status-tag border-primary/25 bg-primary/5"
        >
          {{ label }}
        </FaTag>
      </div>
      <span
        class="qs-type-body-medium px-3 py-1.5 rounded-md shrink-0"
        :class="candidate.eligible ? 'text-primary bg-primary/8' : 'text-muted-foreground bg-muted/40'"
      >
        {{ candidate.eligible ? t('containerImport.select') : t('containerImport.unavailable') }}
      </span>
    </div>

    <p v-if="reason" class="qs-type-meta text-destructive m-0 flex gap-1.5 [overflow-wrap:anywhere] items-start">
      <FaIcon name="i-lucide:circle-alert" class="mt-0.5 shrink-0 size-3.5" aria-hidden="true" />
      {{ reason }}
    </p>
  </div>
</template>
