<script setup lang="ts">
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'

defineProps<{
  reversal?: boolean
  currencies: readonly CurrencyDescriptor[]
  snapshot: {
    businessAmount: string
    userShareRate: string | null
    companyShareRate: string | null
    entries: { accountTarget: string, direction: string, amount: string }[]
  }
}>()
const { t } = useI18n()
</script>

<template>
  <div class="p-4 border border-border rounded-xl bg-muted/15 space-y-4">
    <dl class="m-0 gap-4 grid sm:grid-cols-2">
      <div>
        <dt class="qs-type-compact-label mb-1">
          {{ t(reversal ? 'salesReceipt.totalReversalCny' : 'salesReceipt.totalCny') }}
        </dt><dd class="m-0">
          <AmountDisplay :value="snapshot.businessAmount" currency="CNY" :currencies="currencies" />
        </dd>
      </div>
      <div>
        <dt class="qs-type-compact-label mb-1">
          {{ t('salesReceipt.share') }}
        </dt><dd class="qs-type-data font-mono m-0">
          {{ snapshot.userShareRate === null ? '—' : `${snapshot.userShareRate}%` }} / {{ snapshot.companyShareRate === null ? '—' : `${snapshot.companyShareRate}%` }}
        </dd>
      </div>
    </dl>
    <dl class="m-0 pt-3 border-t border-border space-y-3">
      <div v-for="(entry, index) in snapshot.entries" :key="index" class="flex flex-wrap gap-2 items-center justify-between">
        <dt class="qs-type-data flex gap-2 items-center">
          {{ t(`salesReceipt.target.${entry.accountTarget}`) }}<FaTag variant="outline" class="qs-type-status-tag">
            {{ t(entry.direction === 'DEBIT' ? 'salesReceipt.debit' : 'salesReceipt.credit') }}
          </FaTag>
        </dt>
        <dd class="m-0">
          <AmountDisplay :value="entry.amount" currency="CNY" :currencies="currencies" />
        </dd>
      </div>
    </dl>
  </div>
</template>
