<script setup lang="ts">
import type { OceanContainerLine } from './types'

const props = defineProps<{
  line: OceanContainerLine
  canViewSales: boolean
  canViewPurchase: boolean
}>()
const emit = defineEmits<{ view: [kind: 'sales' | 'purchase'] }>()
const { t } = useI18n()
const sources = computed(() => [
  { kind: 'sales' as const, number: props.line.salesOrderNo, available: props.canViewSales && Boolean(props.line.salesOrderId), label: t('qsOceanContainer.salesOrder') },
  { kind: 'purchase' as const, number: props.line.purchaseOrderNo, available: props.canViewPurchase && Boolean(props.line.purchaseOrderId), label: t('qsOceanContainer.purchaseOrder') },
])
</script>

<template>
  <div class="flex flex-col gap-1 min-w-0 items-start">
    <template v-for="source in sources" :key="source.kind">
      <FaButton
        v-if="source.number && source.available" variant="link" size="sm"
        class="ocean-source-link px-0 h-auto max-w-full min-h-6 justify-start"
        :title="source.number" :aria-label="t('qsOceanContainer.viewSource', { type: source.label, number: source.number })"
        @click="emit('view', source.kind)"
      >
        <span class="qs-type-data truncate">{{ source.number }}</span>
      </FaButton>
      <span v-else class="qs-type-data text-muted-foreground max-w-full truncate" :title="source.number || source.label">{{ source.number || '—' }}</span>
    </template>
  </div>
</template>

<style scoped>
.ocean-source-link {
  color: var(--ocean-accent);
}

.ocean-source-link :deep(span) {
  color: inherit;
}
</style>
