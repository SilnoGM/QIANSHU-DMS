<script setup lang="ts">
import type { SalesOrderSelectorLinePreview } from './types'
import type { ImageGroupItem } from '@/components/base/ImageGroup/types'
import type { GoodTooltipAlign } from '@/components/business/QsGoodTooltip/types'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import QsGoodTooltip from '@/components/business/QsGoodTooltip/index.vue'
import QsGoodTooltipContent from '@/components/business/QsGoodTooltip/QsGoodTooltipContent.vue'
import {
  buildSalesOrderProductImageItems,
  filterSalesOrderProductsWithoutImage,
  resolveSalesOrderProductPreview,
} from './logic'

defineOptions({ name: 'SalesOrderProductPreview' })

const props = withDefaults(defineProps<{
  imageSize?: number
  maxCount?: number
  noImageAlign?: GoodTooltipAlign
  previews: readonly SalesOrderSelectorLinePreview[]
}>(), {
  imageSize: 44,
  maxCount: 4,
  noImageAlign: 'start',
})

const imageItems = computed(() => buildSalesOrderProductImageItems(props.previews))
const productsWithoutImage = computed(() => filterSalesOrderProductsWithoutImage(props.previews))
const visibleProductsWithoutImage = computed(() => productsWithoutImage.value.slice(0, 4))

function productDisplayName(preview: SalesOrderSelectorLinePreview | null): string {
  return preview?.productName.trim() || '未命名产品'
}

function productPreviewByImage(image: ImageGroupItem): SalesOrderSelectorLinePreview | null {
  return resolveSalesOrderProductPreview(props.previews, image)
}
</script>

<template>
  <span class="flex gap-2 min-w-0 items-center">
    <ImageGroup
      v-if="imageItems.length > 0"
      :items="imageItems"
      :max-count="maxCount"
      :size="imageSize"
      fit="contain"
      radius="lg"
    >
      <template #tooltip="{ item: image, index, total: productTotal }">
        <QsGoodTooltipContent
          :image-src="image.src"
          :image-alt="image.alt"
          image-fit="contain"
        >
          <div v-if="productPreviewByImage(image)" class="min-w-0">
            <div class="flex gap-3 items-center justify-between">
              <span class="tracking-[0.12em] font-semibold">销售产品</span>
              <span class="opacity-60 tabular-nums">{{ index + 1 }} / {{ productTotal }}</span>
            </div>
            <p class="text-sm leading-5 font-semibold m-0 mt-2 break-words">
              {{ productDisplayName(productPreviewByImage(image)) }}
            </p>
          </div>
        </QsGoodTooltipContent>
      </template>
    </ImageGroup>

    <QsGoodTooltip
      v-if="productsWithoutImage.length > 0"
      :image-alt="`${productsWithoutImage.length} 项产品暂无主图`"
      :image-src="null"
      :align="noImageAlign"
    >
      <span
        data-slot="sales-order-selector-products-without-image"
        role="img"
        :aria-label="`${productsWithoutImage.length} 项产品暂无主图`"
        tabindex="0"
        :style="{ height: `${imageSize}px` }"
        class="qs-type-meta text-muted-foreground px-2 border border-border rounded-lg bg-muted/35 flex shrink-0 gap-1 items-center"
        @click.stop
        @keydown.stop
      >
        <FaIcon name="i-lucide:image-off" class="size-4" aria-hidden="true" />
        {{ productsWithoutImage.length }}
      </span>
      <template #content>
        <div class="min-w-0">
          <p class="tracking-[0.12em] font-semibold m-0">无主图产品</p>
          <ul class="m-0 mt-2 p-0 list-none space-y-1.5">
            <li
              v-for="preview in visibleProductsWithoutImage"
              :key="preview.lineId"
              class="text-sm leading-5 break-words"
            >
              {{ productDisplayName(preview) }}
            </li>
          </ul>
          <p
            v-if="productsWithoutImage.length > visibleProductsWithoutImage.length"
            class="m-0 mt-2 pt-2 border-t border-background/15 opacity-70"
          >
            另有 {{ productsWithoutImage.length - visibleProductsWithoutImage.length }} 项
          </p>
        </div>
      </template>
    </QsGoodTooltip>
  </span>
</template>
