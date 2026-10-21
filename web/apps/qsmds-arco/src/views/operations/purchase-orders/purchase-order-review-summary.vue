<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'

import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'

defineProps<{
  summary: PurchaseOrderDetailDto['reviewSummary']
}>()

const { t } = useI18n()
</script>

<template>
  <section data-slot="purchase-review-summary" :aria-label="t('purchaseReview.summary.title')" class="min-w-0">
    <h3 class="qs-type-component-title m-0 mb-3 flex gap-2 items-center">
      <span class="rounded-full bg-primary shrink-0 h-5 w-1" aria-hidden="true" />
      {{ t('purchaseReview.summary.title') }}
    </h3>
    <dl class="qs-type-body m-0 p-4 border border-border rounded-xl bg-muted/15 gap-x-6 gap-y-4 grid grid-cols-1 sm:grid-cols-2">
      <div class="min-w-0">
        <dt class="qs-type-meta">
          {{ t('purchaseReview.summary.reviewer') }}
        </dt>
        <dd class="m-0 mt-1 min-w-0">
          <QsPersonDisplay v-if="summary" :display-name="summary.reviewedBy.displayName" size="sm" :avatar-url="summary.reviewedBy.avatarUrl" />
          <span v-else class="text-muted-foreground">{{ t('purchaseReview.summary.notRecorded') }}</span>
        </dd>
      </div>
      <div class="min-w-0">
        <dt class="qs-type-meta">
          {{ t('purchaseReview.summary.reviewedAt') }}
        </dt>
        <dd class="m-0 mt-1 min-w-0">
          <DateTimeDisplay v-if="summary" :value="summary.reviewedAt" class="whitespace-normal!" />
          <span v-else class="text-muted-foreground">{{ t('purchaseReview.summary.notRecorded') }}</span>
        </dd>
      </div>
      <div class="min-w-0 sm:col-span-2">
        <dt class="qs-type-meta">
          {{ t('purchaseReview.summary.reason') }}
        </dt>
        <dd class="m-0 mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]" :class="!summary?.reason?.trim() ? 'text-muted-foreground' : ''">
          {{ summary?.reason?.trim() || t('purchaseReview.summary.notRecorded') }}
        </dd>
      </div>
    </dl>
  </section>
</template>
