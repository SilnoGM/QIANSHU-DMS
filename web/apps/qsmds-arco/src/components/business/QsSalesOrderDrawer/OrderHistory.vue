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
    <ol v-else class="m-0 p-0 list-none divide-border divide-y">
      <li v-for="entry in timeline" :key="entry.key" class="py-5 first:pt-0">
        <div class="flex flex-wrap gap-2 items-center justify-between">
          <h3 class="qs-type-section-title m-0">
            {{ entry.kind === 'status' ? t(`salesOrderDrawer.dimensions.${entry.record.dimension}`) : t('salesOrderDrawer.amountChange') }}
          </h3>
          <DateTimeDisplay :value="entry.record.changedAt" class="text-xs text-muted-foreground" />
        </div>
        <p v-if="entry.kind === 'status'" class="m-0 mt-3 flex flex-wrap gap-2 items-center">
          <FaTag variant="outline">
            {{ statusLabel(entry.record.fromStatus) }}
          </FaTag>
          <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" />
          <FaTag variant="outline" class="text-primary">
            {{ statusLabel(entry.record.toStatus) }}
          </FaTag>
        </p>
        <dl v-else class="text-sm m-0 mt-3 space-y-2">
          <div v-for="amount in revisionAmounts(entry.record)" :key="amount.label" class="flex flex-wrap gap-x-3 gap-y-1 items-baseline justify-between">
            <dt class="text-muted-foreground">
              {{ t(`salesOrderDesc.fields.${amount.label}`) }}
            </dt>
            <dd class="m-0 flex flex-wrap gap-2 min-w-0 items-center">
              <AmountDisplay :value="amount.before" :currency="detail.currencyCode" :currencies="currencies" class="max-w-full overflow-x-auto" />
              <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" />
              <AmountDisplay :value="amount.after" :currency="detail.currencyCode" :currencies="currencies" class="text-primary max-w-full overflow-x-auto" />
            </dd>
          </div>
        </dl>
        <p class="text-sm m-0 mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {{ t('salesOrderDrawer.reason') }}：{{ entry.record.reason || '-' }}
        </p>
        <div class="text-xs text-muted-foreground mt-2 flex gap-1 items-center">
          {{ t('salesOrderDrawer.changedBy') }}：<QsPersonDisplay :display-name="entry.record.changedBy.displayName" size="sm" />
        </div>
      </li>
    </ol>
  </section>
</template>
