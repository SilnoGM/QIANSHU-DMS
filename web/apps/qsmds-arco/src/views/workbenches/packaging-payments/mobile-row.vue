<script setup lang="ts">
import type { PackagingCostRequestDto } from '@/api/generated/types.gen'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import PackagingProof from './packaging-proof.vue'

defineProps<{ record: PackagingCostRequestDto }>()
const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
</script>

<template>
  <article class="min-w-0 space-y-4">
    <div class="flex flex-wrap gap-2 items-start justify-between">
      <strong class="qs-type-data-emphasis break-all">{{ record.shipmentNo || '—' }}</strong>
      <FaTag variant="outline" class="qs-type-status-tag shrink-0" :class="record.status === 'PAID' ? 'text-primary border-primary/30 bg-primary/10' : 'text-muted-foreground'">
        {{ t(`packagingPayment.status.${record.status}`) }}
      </FaTag>
    </div>
    <p class="qs-type-data m-0 break-all">
      {{ record.shippingMarkText || '—' }}
    </p>
    <div class="p-3 rounded-lg bg-muted/25 flex flex-wrap gap-2 items-center justify-between">
      <span>{{ record.packagingTypeName }}</span>
      <AmountDisplay :value="record.amount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
    </div>
    <dl class="m-0 gap-3 grid">
      <div v-for="field in ['purchaseOrderNo', 'salesOrderNo'] as const" :key="field">
        <dt class="qs-type-meta text-muted-foreground">
          {{ t(`packagingPayment.${field}`) }}
        </dt>
        <dd class="qs-type-data m-0 mt-1 break-all">
          {{ record[field] }}
        </dd>
      </div>
      <div>
        <dt class="qs-type-meta text-muted-foreground">
          {{ t('packagingPayment.vendorLabel') }}
        </dt>
        <dd class="m-0 mt-1">
          {{ t(`packagingPayment.vendor.${record.packagingVendor}`) }}
        </dd>
      </div>
      <div>
        <dt class="qs-type-meta text-muted-foreground">
          {{ t('packagingPayment.owner') }}
        </dt>
        <dd class="m-0 mt-1">
          <QsPersonDisplay :display-name="record.owner.name" size="sm" />
        </dd>
      </div>
      <div>
        <dt class="qs-type-meta text-muted-foreground">
          {{ t('packagingPayment.submitted') }}
        </dt>
        <dd class="m-0 mt-1 flex flex-wrap gap-2 items-center">
          <QsPersonDisplay :display-name="record.submittedBy.name" size="sm" /><DateTimeDisplay :value="record.submittedAt" />
        </dd>
      </div>
      <div v-if="record.status === 'PAID'">
        <dt class="qs-type-meta text-muted-foreground">
          {{ t('packagingPayment.paid') }}
        </dt>
        <dd class="m-0 mt-1 flex flex-wrap gap-2 items-center">
          <QsPersonDisplay v-if="record.paidBy" :display-name="record.paidBy.name" size="sm" /><DateTimeDisplay :value="record.paidAt" />
        </dd>
      </div>
      <div v-if="record.remark">
        <dt class="qs-type-meta text-muted-foreground">
          {{ t('packagingPayment.remark') }}
        </dt>
        <dd class="m-0 mt-1 whitespace-pre-wrap break-words">
          {{ record.remark }}
        </dd>
      </div>
    </dl>
    <PackagingProof :record="record" />
  </article>
</template>
