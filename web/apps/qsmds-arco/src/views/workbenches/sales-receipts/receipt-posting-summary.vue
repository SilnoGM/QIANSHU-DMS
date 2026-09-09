<script setup lang="ts">
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { formatReceiptDecimal } from './receipt-display'

const props = defineProps<{
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
function entryShare(target: string): string | null {
  return target === 'USER' ? props.snapshot.userShareRate : target === 'COMPANY' ? props.snapshot.companyShareRate : null
}
</script>

<template>
  <div class="min-w-0 space-y-4">
    <div class="pb-4 border-b border-border space-y-1.5">
      <p class="qs-type-compact-label m-0">
        {{ t(reversal ? 'salesReceipt.totalReversalCny' : 'salesReceipt.totalCny') }}
      </p>
      <div tabindex="0" :aria-label="t(reversal ? 'salesReceipt.totalReversalCny' : 'salesReceipt.totalCny')" class="max-w-full overflow-x-auto [&_[data-currency]]:text-2xl [&_[data-currency]]:leading-8">
        <AmountDisplay :value="snapshot.businessAmount" currency="CNY" :currencies="currencies" />
      </div>
    </div>
    <p class="qs-type-meta m-0 flex flex-wrap gap-x-4 gap-y-1">
      <span>{{ t('salesReceipt.target.USER') }} · <span class="font-mono" :title="snapshot.userShareRate ?? undefined">{{ snapshot.userShareRate === null ? '—' : `${formatReceiptDecimal(snapshot.userShareRate)}%` }}</span></span>
      <span>{{ t('salesReceipt.target.COMPANY') }} · <span class="font-mono" :title="snapshot.companyShareRate ?? undefined">{{ snapshot.companyShareRate === null ? '—' : `${formatReceiptDecimal(snapshot.companyShareRate)}%` }}</span></span>
    </p>
    <dl class="m-0 gap-3 grid sm:grid-cols-2">
      <div v-for="(entry, index) in snapshot.entries" :key="index" class="p-4 border border-border rounded-xl bg-muted/15 min-w-0 space-y-3">
        <dt class="flex gap-2 min-w-0 items-center">
          <FaIcon :name="entry.accountTarget === 'USER' ? 'i-lucide:user-round' : 'i-lucide:building-2'" class="text-muted-foreground shrink-0 size-4" aria-hidden="true" />
          <span class="qs-type-body-medium flex-1 min-w-0 break-words">{{ t(`salesReceipt.target.${entry.accountTarget}`) }}</span>
          <FaTag variant="outline" class="qs-type-status-tag shrink-0" :class="entry.direction === 'DEBIT' ? 'border-destructive/25 bg-destructive/5 text-destructive' : 'border-emerald-500/25 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300'">
            {{ t(entry.direction === 'DEBIT' ? 'salesReceipt.debit' : 'salesReceipt.credit') }}
          </FaTag>
        </dt>
        <dd class="m-0 min-w-0 space-y-2">
          <div tabindex="0" :aria-label="t(`salesReceipt.target.${entry.accountTarget}`)" class="max-w-full overflow-x-auto [&_[data-currency]]:text-lg [&_[data-currency]]:leading-7">
            <AmountDisplay :value="entry.amount" currency="CNY" :currencies="currencies" />
          </div>
          <div class="qs-type-meta flex flex-wrap gap-1.5 items-center">
            <span>{{ t('salesReceipt.accountShare') }}</span><span class="font-mono" :title="entryShare(entry.accountTarget) ?? undefined">{{ entryShare(entry.accountTarget) === null ? '—' : `${formatReceiptDecimal(entryShare(entry.accountTarget))}%` }}</span>
          </div>
        </dd>
      </div>
    </dl>
  </div>
</template>
