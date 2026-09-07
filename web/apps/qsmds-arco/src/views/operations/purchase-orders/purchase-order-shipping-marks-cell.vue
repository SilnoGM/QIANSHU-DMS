<script setup lang="ts">
import type { PurchaseOrderListItemDto } from '@/api/generated/types.gen'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import { getPurchaseOrderShippingMarksSummary } from './purchase-order-shipping-marks-cell.logic'

const props = defineProps<{
  order: Pick<PurchaseOrderListItemDto, 'shippingMarks' | 'shippingMarkText'>
}>()
const { t } = useI18n()
const toast = useQsToast()
const summary = computed(() => getPurchaseOrderShippingMarksSummary(props.order))
async function copyAll(): Promise<void> {
  try {
    await navigator.clipboard.writeText(summary.value.copyText)
    toast.success(t('purchaseOrderList.shippingMarks.copied'))
  }
  catch {
    toast.error(t('purchaseOrderList.shippingMarks.copyFailed'))
  }
}
</script>

<template>
  <FaPopover
    v-if="summary.marks.length > 0"
    align="start"
    :auto-focus="true"
    :collision-padding="12"
    class="max-w-[calc(100vw-1.5rem)] w-96 min-w-0!"
  >
    <FaButton
      type="button"
      variant="ghost"
      size="sm"
      data-testid="purchase-order-shipping-marks-trigger"
      class="px-1 gap-2 h-auto max-w-full min-h-11 min-w-0 sm:min-h-9"
      :aria-label="t('purchaseOrderList.shippingMarks.open', { count: summary.marks.length })"
      @click.stop
    >
      <span class="qs-type-data min-w-0 truncate">{{ summary.firstMark }}</span>
      <span v-if="summary.additionalCount > 0" class="qs-type-meta shrink-0">{{ t('purchaseOrderList.shippingMarks.more', { count: summary.additionalCount }) }}</span>
      <FaIcon name="i-lucide:chevron-down" class="text-muted-foreground shrink-0 size-3.5" aria-hidden="true" />
    </FaButton>
    <template #panel>
      <section data-testid="purchase-order-shipping-marks-panel" :aria-label="t('purchaseOrderList.shippingMarks.title', { count: summary.marks.length })">
        <div class="mb-2 pb-2 border-b border-border flex gap-3 items-center justify-between">
          <span class="qs-type-body-medium">{{ t('purchaseOrderList.shippingMarks.title', { count: summary.marks.length }) }}</span>
          <FaButton type="button" variant="ghost" size="sm" class="shrink-0 min-h-11 sm:min-h-9" @click="copyAll">
            <FaIcon name="i-lucide:copy" class="size-3.5" aria-hidden="true" />
            {{ t('purchaseOrderList.shippingMarks.copyAll') }}
          </FaButton>
        </div>
        <ol class="m-0 p-0 list-none overscroll-contain max-h-[min(24rem,60vh)] overflow-y-auto divide-border/70 divide-y">
          <li v-for="(mark, index) in summary.marks" :key="index" class="py-2 flex gap-3 items-start">
            <span class="qs-type-meta pt-2 shrink-0 tabular-nums">{{ String(index + 1).padStart(2, '0') }}</span>
            <span class="qs-type-data pt-2 flex-1 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ mark }}</span>
            <CopyCellButton always-visible :label="t('purchaseOrderList.shippingMarks.label')" :text="mark" class="[&_button]:size-11 sm:[&_button]:size-9" />
          </li>
        </ol>
      </section>
    </template>
  </FaPopover>
  <div v-else class="flex gap-1 min-w-0 items-start">
    <span class="qs-type-data pt-1 flex-1 min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{{ summary.legacyMark ?? '-' }}</span>
    <CopyCellButton
      v-if="summary.legacyMark"
      always-visible
      :label="t('purchaseOrderList.shippingMarks.label')"
      :text="summary.legacyMark"
    />
  </div>
</template>
