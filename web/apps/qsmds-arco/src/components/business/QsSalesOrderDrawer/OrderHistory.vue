<script setup lang="ts">
import type { SalesOrderDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { buildSalesOrderTimeline, revisionAmounts } from './logic'

const props = defineProps<{ detail: SalesOrderDetailDto, currencies: readonly CurrencyDescriptor[] }>()
const { t, te } = useI18n()
const timeline = computed(() => buildSalesOrderTimeline(props.detail))
function statusLabel(value: string) {
  const key = `salesOrderDrawer.statuses.${value}`
  return te(key) ? t(key) : value
}
</script>

<template>
  <section :aria-label="t('salesOrderDrawer.changes')">
    <FaEmpty v-if="!timeline.length" :title="t('salesOrderDrawer.noChanges')" class="py-10" />
    <ol v-else class="m-0 p-0 list-none">
      <li v-for="(entry, index) in timeline" :key="entry.key" class="pb-6 gap-3 grid grid-cols-[2rem_minmax(0,1fr)] last:pb-0">
        <div class="relative">
          <span class="text-muted-foreground border border-border rounded-full bg-muted/25 flex size-8 items-center justify-center">
            <FaIcon :name="entry.kind === 'amount' ? 'i-lucide:banknote' : 'i-lucide:git-compare-arrows'" class="size-4" aria-hidden="true" />
          </span>
          <span v-if="index < timeline.length - 1" class="bg-border w-px bottom-[-1.25rem] left-4 top-10 absolute" aria-hidden="true" />
        </div>
        <div class="pt-1 min-w-0">
          <div class="flex flex-wrap gap-x-4 gap-y-1 items-center justify-between">
            <h3 class="qs-type-component-title m-0">
              {{ entry.kind === 'status' ? t(`salesOrderDrawer.dimensions.${entry.record.dimension}`) : t('salesOrderDrawer.amountChange') }}
            </h3>
            <DateTimeDisplay :value="entry.record.changedAt" class="qs-type-meta" />
          </div>
          <p v-if="entry.kind === 'status'" class="m-0 mt-3 flex flex-wrap gap-2 items-center">
            <FaTag variant="outline" class="text-muted-foreground bg-muted/20">
              {{ statusLabel(entry.record.fromStatus) }}
            </FaTag>
            <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" />
            <FaTag variant="outline" class="text-primary border-primary/20 bg-primary/5 dark:text-foreground">
              {{ statusLabel(entry.record.toStatus) }}
            </FaTag>
          </p>
          <dl v-else class="text-sm m-0 mt-3 px-3 py-2 rounded-lg bg-muted/25 space-y-2">
            <div v-for="amount in revisionAmounts(entry.record)" :key="amount.label" class="flex flex-wrap gap-x-3 gap-y-1 items-baseline justify-between">
              <dt class="text-muted-foreground">
                {{ t(`salesOrderDesc.fields.${amount.label}`) }}
              </dt>
              <dd class="m-0 flex flex-wrap gap-2 min-w-0 items-center">
                <AmountDisplay :value="amount.before" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto" />
                <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" />
                <AmountDisplay :value="amount.after" :currency="detail.currencyCode" :currencies="currencies" class="text-primary max-w-full overflow-x-auto dark:text-foreground" />
              </dd>
            </div>
          </dl>
          <p class="qs-type-description m-0 mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {{ t('salesOrderDrawer.reason') }}：{{ entry.record.reason || '-' }}
          </p>
          <div class="qs-type-meta mt-2 flex gap-1 items-center">
            {{ t('salesOrderDrawer.changedBy') }}：<QsPersonDisplay :display-name="entry.record.changedBy.displayName" size="sm" />
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>
