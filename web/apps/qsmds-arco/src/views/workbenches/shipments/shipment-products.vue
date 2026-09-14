<script setup lang="ts">
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGoodTooltipContent from '@/components/business/QsGoodTooltip/QsGoodTooltipContent.vue'

const props = defineProps<{ summary: PurchaseShipmentListItemDto['lineSummary'] }>()
const { t } = useI18n()
const images = computed(() => props.summary.previews.flatMap(product => product.mainImage
  ? [{ key: product.lineId, src: product.mainImage.contentUrl, alt: product.productName }]
  : []))
const productsById = computed(() => new Map(props.summary.previews.map(product => [product.lineId, product])))
const missing = computed(() => props.summary.previews.filter(product => !product.mainImage))
const missingText = computed(() => missing.value.map(product => `${product.productNo ? `${product.productNo} · ` : ''}${product.productName} · ${t('purchaseShipments.itemQuantity', { quantity: product.quantity })}`).join('\n'))
</script>

<template>
  <div class="flex gap-2 min-w-0 items-center">
    <ImageGroup v-if="images.length" :items="images" :max-count="3" :overlap="0" size="md" fit="contain">
      <template #tooltip="{ item }">
        <QsGoodTooltipContent :image-src="item.src" :image-alt="item.alt" image-fit="contain">
          <template v-if="productsById.get(String(item.key))">
            <p class="font-medium m-0">
              {{ productsById.get(String(item.key))?.productName }}
            </p>
            <p class="qs-type-data m-0 mt-1">
              {{ productsById.get(String(item.key))?.productNo || '—' }}
            </p>
            <p class="m-0 mt-1">
              {{ t('purchaseShipments.itemQuantity', { quantity: productsById.get(String(item.key))?.quantity }) }}
            </p>
          </template>
        </QsGoodTooltipContent>
      </template>
    </ImageGroup>
    <FaTooltip v-if="missing.length" :text="missingText">
      <span tabindex="0" class="text-muted-foreground px-2 py-1 border border-border rounded-md inline-flex gap-1.5 max-w-48 min-h-9 items-center">
        <FaIcon name="i-lucide:image-off" class="shrink-0 size-4" aria-hidden="true" />
        <span class="text-sm truncate">{{ images.length ? t('purchaseShipments.noImageCount', { count: missing.length }) : missing[0]?.productName }}</span>
        <span v-if="!images.length && missing.length > 1" class="qs-type-meta shrink-0">+{{ missing.length - 1 }}</span>
        <span v-if="!images.length" class="sr-only">{{ t('purchaseShipments.noImage') }}</span>
      </span>
    </FaTooltip>
    <span v-if="!summary.previews.length" class="text-muted-foreground">—</span>
  </div>
</template>
