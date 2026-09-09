<script setup lang="ts">
import type { SalesOrderPendingPurchaseProductDto } from '@/api/generated/types.gen'
import ImageGroup from '@/components/base/ImageGroup/index.vue'

defineProps<{ item: SalesOrderPendingPurchaseProductDto, description: string }>()
const { t } = useI18n()
</script>

<template>
  <ImageGroup
    v-if="item.mainImage"
    :items="[{ key: item.id, src: item.mainImage.contentUrl, alt: item.productName, tooltip: description }]"
    :size="40" radius="md" class="shrink-0"
  >
    <template #tooltip>
      <span class="max-w-64 block whitespace-normal break-words">{{ description }}</span>
    </template>
  </ImageGroup>
  <FaTooltip v-else :text="`${description} · ${t('purchaseStart.noImage')}`">
    <span tabindex="0" :aria-label="`${description} · ${t('purchaseStart.noImage')}`" class="text-muted-foreground border border-border rounded-md bg-muted/25 inline-flex shrink-0 size-10 items-center justify-center focus-visible:outline-primary">
      <FaIcon name="i-lucide:image-off" class="size-5" aria-hidden="true" />
    </span>
  </FaTooltip>
</template>
