<script setup lang="ts">
import type { PartConfiguration, PartConfiguratorProduct } from '@/components/business/QsPartConfigurator/types'
import QsPartConfigurator from '@/components/business/QsPartConfigurator/index.vue'

defineProps<{
  products: readonly PartConfiguratorProduct[]
  parts: readonly PartConfiguration[]
  compact?: boolean
}>()

const { t } = useI18n()
</script>

<template>
  <section class="mt-4 pt-4 border-t border-border/70 min-w-0" :aria-label="t('purchaseOrderParts.title')" data-testid="purchase-order-parts-review">
    <div class="mb-3 flex gap-2.5 items-center">
      <span class="rounded-full bg-primary shrink-0 h-4.5 w-1" aria-hidden="true" />
      <h3 class="qs-type-section-title m-0">
        {{ t('purchaseOrderParts.title') }}
      </h3>
      <span class="font-qs-data-mono text-xs text-muted-foreground ml-auto">{{ parts.length }}</span>
    </div>
    <p v-if="parts.length === 0 || compact" class="text-sm text-muted-foreground m-0">
      {{ parts.length === 0 ? t('purchaseOrderParts.empty') : t('purchaseOrderParts.summary', { count: parts.length }) }}
    </p>
    <QsPartConfigurator v-else :products="products" :model-value="parts" readonly />
  </section>
</template>
