<script setup lang="ts">
import type { FactoryShipmentProductPreview } from './types'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGoodTooltip from '@/components/business/QsGoodTooltip/index.vue'
import QsGoodTooltipContent from '@/components/business/QsGoodTooltip/QsGoodTooltipContent.vue'

defineOptions({ name: 'FactoryShipmentProductSummary' })

const props = defineProps<{
  previews: readonly FactoryShipmentProductPreview[]
}>()

// 卡片只直接展开前三项，保证两张以上采购单仍能在固定滚动区内快速比较。
const visiblePreviews = computed(() => props.previews.slice(0, 3))
const hiddenPreviews = computed(() => props.previews.slice(3))
const hiddenCount = computed(() => hiddenPreviews.value.length)
const productsWithoutImage = computed(() => visiblePreviews.value.filter(
  preview => !preview.mainImage?.contentUrl.trim(),
))
const imageItems = computed<readonly ImageGroupItem[]>(() => visiblePreviews.value.flatMap((preview) => {
  const source = preview.mainImage?.contentUrl.trim()
  if (!source) {
    return []
  }
  return [{
    alt: productDisplayName(preview),
    key: preview.lineId,
    src: source,
    tooltip: productDisplayName(preview),
  }]
}))

function productDisplayName(preview: FactoryShipmentProductPreview | null | undefined): string {
  return preview?.productName.trim() || '未命名产品'
}

function productQuantityLabel(preview: FactoryShipmentProductPreview): string {
  return preview.quantity === undefined ? '' : ` × ${preview.quantity}`
}

function previewByImage(image: ImageGroupItem): FactoryShipmentProductPreview | null {
  return visiblePreviews.value.find(preview => preview.lineId === image.key) ?? null
}
</script>

<template>
  <div
    data-slot="factory-shipment-product-summary"
    class="mt-3 pt-3 border-t border-border/60 flex gap-3 min-w-0 items-center"
  >
    <div class="flex shrink-0 items-center">
      <ImageGroup
        v-if="imageItems.length > 0"
        :items="imageItems"
        :max-count="3"
        :size="36"
        fit="contain"
        :preview="false"
        radius="md"
      >
        <template #tooltip="{ item: image }">
          <QsGoodTooltipContent
            :image-src="image.src"
            :image-alt="image.alt"
            image-fit="contain"
          >
            <div v-if="previewByImage(image)" class="min-w-0">
              <span class="tracking-[0.1em] font-semibold">采购产品</span>
              <p class="text-sm leading-5 font-semibold m-0 mt-2 break-words">
                {{ productDisplayName(previewByImage(image)) }}
              </p>
              <p v-if="previewByImage(image)?.quantity !== undefined" class="text-xs leading-5 m-0 mt-1 opacity-70">
                采购数量 × {{ previewByImage(image)?.quantity }}
              </p>
            </div>
          </QsGoodTooltipContent>
        </template>
      </ImageGroup>
      <span
        v-if="productsWithoutImage.length > 0"
        data-slot="factory-shipment-products-without-image"
        role="img"
        :aria-label="`${productsWithoutImage.length} 项产品暂无主图`"
        class="qs-type-meta text-muted-foreground ml-1 border border-border rounded-md bg-muted/35 flex size-9 items-center justify-center"
      >
        <FaIcon name="i-lucide:image-off" class="size-4" aria-hidden="true" />
      </span>
    </div>

    <div class="flex-1 min-w-0">
      <span class="qs-type-compact-label text-muted-foreground block">采购产品</span>
      <span v-if="visiblePreviews.length > 0" class="qs-type-meta mt-1 flex flex-wrap gap-x-2 gap-y-1 min-w-0">
        <span
          v-for="preview in visiblePreviews"
          :key="preview.lineId"
          class="max-w-full truncate"
          :title="`${productDisplayName(preview)}${productQuantityLabel(preview)}`"
        >
          {{ productDisplayName(preview) }}{{ productQuantityLabel(preview) }}
        </span>
      </span>
      <span v-else class="qs-type-meta text-muted-foreground mt-1 block">产品明细不可用</span>
    </div>

    <QsGoodTooltip
      v-if="hiddenCount > 0"
      :image-src="null"
      image-alt="更多采购产品"
      align="end"
    >
      <span
        class="qs-type-meta text-primary px-2 py-1 border border-primary/25 rounded-md bg-primary/5 whitespace-nowrap"
        tabindex="0"
        @click.stop
        @keydown.stop
      >
        另有 {{ hiddenCount }} 项
      </span>
      <template #content>
        <div class="min-w-0">
          <p class="tracking-[0.1em] font-semibold m-0">
            更多采购产品
          </p>
          <ul class="m-0 mt-2 p-0 list-none space-y-1.5">
            <li
              v-for="preview in hiddenPreviews"
              :key="preview.lineId"
              class="text-sm leading-5 break-words"
            >
              {{ productDisplayName(preview) }}{{ productQuantityLabel(preview) }}
            </li>
          </ul>
        </div>
      </template>
    </QsGoodTooltip>
  </div>
</template>
