<script setup lang="ts">
import type { PurchaseBatchItemState } from './batch-review.logic'
import type { CurrencyDescriptor } from '@/components/base/currency'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsCopyableText from '@/components/business/QsGenericTable/QsCopyableText.vue'

defineOptions({ name: 'PurchaseBatchReviewCard' })

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  item: PurchaseBatchItemState
}>()
const emit = defineEmits<{
  previewError: [url: string]
  previewLoad: [url: string]
  retryPreview: []
}>()
const { t } = useI18n()

const statusLabel = computed(() => {
  if (props.item.status === 'idle' && props.item.error !== null) {
    return t('purchaseReview.batch.status.needsRegenerate')
  }
  switch (props.item.status) {
    case 'idle': return t('purchaseReview.batch.status.idle')
    case 'generating': return t('purchaseReview.batch.status.generating')
    case 'ready': return t('purchaseReview.batch.status.ready')
    case 'generate-failed': return t('purchaseReview.batch.status.generateFailed')
    case 'reviewing': return t('purchaseReview.batch.status.reviewing')
    case 'approved': return t('purchaseReview.batch.status.approved')
    case 'review-failed': return t('purchaseReview.batch.status.reviewFailed')
    case 'blocked': return t('purchaseReview.batch.status.blocked')
    default: return t('purchaseReview.batch.status.idle')
  }
})

const statusClass = computed(() => {
  switch (props.item.status) {
    case 'generating':
    case 'ready':
    case 'reviewing':
    case 'approved':
      return 'border-primary/30 bg-primary/5 text-primary'
    case 'generate-failed':
    case 'review-failed':
      return 'border-destructive/30 bg-destructive/5 text-destructive'
    case 'blocked':
      return 'border-amber-500/30 bg-amber-500/5 text-amber-700'
    case 'idle':
      return props.item.error === null
        ? 'border-border bg-muted/30 text-muted-foreground'
        : 'border-amber-500/30 bg-amber-500/5 text-amber-700'
    default:
      return 'border-border bg-muted/30 text-muted-foreground'
  }
})

const amount = computed(() => props.item.detail?.purchaseTotalAmount ?? props.item.order.purchaseTotalAmount)
const imageAlt = computed(() => t('purchaseReview.batch.imageAlt', { orderNo: props.item.order.orderNo }))
const placeholder = computed(() => {
  if (props.item.previewError !== null) {
    return t('purchaseReview.batch.imageLoadFailed')
  }
  if (props.item.status === 'generating') {
    return t('purchaseReview.batch.status.generating')
  }
  if (props.item.status === 'blocked') {
    return t('purchaseReview.batch.status.blocked')
  }
  if (props.item.status === 'idle' && props.item.error !== null) {
    return t('purchaseReview.batch.status.needsRegenerate')
  }
  if (props.item.status === 'ready' || props.item.status === 'review-failed' || props.item.status === 'approved') {
    return t('purchaseReview.batch.imageLoading')
  }
  return t('purchaseReview.batch.status.idle')
})
const placeholderIcon = computed(() => {
  if (props.item.status === 'blocked') {
    return 'i-lucide:shield-x'
  }
  if (props.item.status === 'generate-failed' || props.item.status === 'review-failed') {
    return 'i-lucide:circle-alert'
  }
  return 'i-lucide:image'
})

function handlePreviewLoad() {
  if (props.item.previewUrl !== null) {
    emit('previewLoad', props.item.previewUrl)
  }
}

function handlePreviewError() {
  if (props.item.previewUrl !== null) {
    emit('previewError', props.item.previewUrl)
  }
}
</script>

<template>
  <article data-testid="purchase-batch-card" class="p-3 border border-border/70 rounded-xl flex flex-col gap-3 min-w-0">
    <header class="flex flex-wrap gap-2 items-start justify-between">
      <div class="gap-1 grid min-w-0">
        <div class="qs-type-data-emphasis min-w-0">
          <QsCopyableText :label="t('purchaseReview.orderNo')" :text="item.order.orderNo" />
        </div>
        <div class="qs-type-meta text-muted-foreground flex flex-wrap gap-x-2 gap-y-1 min-w-0 items-center">
          <span class="truncate">{{ item.order.supplier.label }}</span>
          <AmountDisplay :value="amount" currency="CNY" :currencies="currencies" />
        </div>
      </div>
      <FaTag variant="outline" :class="statusClass">
        {{ statusLabel }}
      </FaTag>
    </header>

    <div class="border border-border/60 rounded-lg bg-white aspect-[210/297] relative overflow-hidden">
      <FaImagePreview
        v-if="item.previewUrl"
        :key="item.previewUrl"
        :src="item.previewUrl"
        :aria-label="imageAlt"
        class="h-full w-full object-contain"
        @load="handlePreviewLoad"
        @error="handlePreviewError"
      />
      <div v-else class="p-3 text-center flex-col-center gap-2 h-full">
        <FaIcon :name="placeholderIcon" class="text-muted-foreground size-7" aria-hidden="true" />
        <span class="qs-type-meta text-muted-foreground">{{ placeholder }}</span>
        <FaButton
          v-if="item.previewError"
          type="button"
          variant="outline"
          size="sm"
          class="min-h-11 sm:min-h-8"
          @click="emit('retryPreview')"
        >
          {{ t('purchaseReview.batch.retryPreview') }}
        </FaButton>
      </div>
    </div>

    <p v-if="item.previewUrl && !item.previewLoaded" class="qs-type-meta text-muted-foreground m-0">
      {{ t('purchaseReview.batch.imageLoading') }}
    </p>
    <p v-if="item.previewError" class="qs-type-meta text-destructive m-0">
      {{ item.previewError }}
    </p>
    <p v-if="item.error" class="qs-type-meta text-destructive m-0">
      {{ item.error.message }}
    </p>
    <p v-if="item.error && !item.error.retryable" class="qs-type-meta text-amber-700 m-0">
      {{ t('purchaseReview.batch.error.needsAttention') }}
    </p>
    <p v-if="item.note" class="qs-type-meta text-muted-foreground m-0">
      {{ item.note }}
    </p>
  </article>
</template>
