<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { buildPurchaseOrderTimeline } from './logic'

const props = defineProps<{ detail: PurchaseOrderDetailDto }>()
const { t, te } = useI18n()
const timeline = computed(() => buildPurchaseOrderTimeline(props.detail.statusHistory))
function statusLabel(value: string) {
  const key = `purchaseOrderDrawer.statuses.${value}`
  return te(key) ? t(key) : value
}
</script>

<template>
  <section :aria-label="t('purchaseOrderDrawer.changes')">
    <FaEmpty v-if="!timeline.length" :title="t('purchaseOrderDrawer.noChanges')" class="py-10" />
    <ol v-else class="m-0 p-0 list-none">
      <li v-for="(entry, index) in timeline" :key="entry.id" class="pb-6 gap-3 grid grid-cols-[2rem_minmax(0,1fr)] last:pb-0">
        <div class="relative">
          <span class="text-muted-foreground border border-border rounded-full bg-muted/25 flex size-8 items-center justify-center"><FaIcon name="i-lucide:git-compare-arrows" class="size-4" aria-hidden="true" /></span>
          <span v-if="index < timeline.length - 1" class="bg-border w-px bottom-[-1.25rem] left-4 top-10 absolute" aria-hidden="true" />
        </div>
        <div class="pt-1 min-w-0">
          <div class="flex flex-wrap gap-x-4 gap-y-1 items-center justify-between">
            <h3 class="qs-type-component-title m-0">
              {{ t(`purchaseOrderDrawer.dimensions.${entry.dimension}`) }}
            </h3>
            <DateTimeDisplay :value="entry.changedAt" class="qs-type-meta" />
          </div>
          <p class="m-0 mt-3 flex flex-wrap gap-2 items-center">
            <FaTag variant="outline" class="text-muted-foreground bg-muted/20">
              {{ statusLabel(entry.fromStatus) }}
            </FaTag>
            <FaIcon name="i-lucide:arrow-right" class="text-muted-foreground size-4" aria-hidden="true" />
            <FaTag variant="outline" class="text-primary border-primary/20 bg-primary/5 dark:text-foreground">
              {{ statusLabel(entry.toStatus) }}
            </FaTag>
          </p>
          <p class="qs-type-description m-0 mt-3 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {{ t('purchaseOrderDrawer.reason') }}：{{ entry.reason || '-' }}
          </p>
          <div class="qs-type-meta mt-2 flex gap-1 items-center">
            {{ t('purchaseOrderDrawer.changedBy') }}：<QsPersonDisplay :display-name="entry.changedBy.displayName" size="sm" />
          </div>
        </div>
      </li>
    </ol>
  </section>
</template>
