<script setup lang="ts">
import {
  MAX_PRODUCT_IMAGES,
  MAX_PRODUCT_VIDEOS,
} from './product-media-common.logic'
import { formatProductMediaBytes } from './product-media-view.logic'

interface ProductMediaRulesProps {
  currentImageCount: number
  currentVideoCount: number
  queuedImageCount: number
  queuedVideoCount: number
  totalSizeBytes: string
}

defineOptions({ name: 'ProductMediaRules' })

const props = defineProps<ProductMediaRulesProps>()
const remainingImageCount = computed(() => Math.max(
  0,
  MAX_PRODUCT_IMAGES - props.currentImageCount - props.queuedImageCount,
))
const remainingVideoCount = computed(() => Math.max(
  0,
  MAX_PRODUCT_VIDEOS - props.currentVideoCount - props.queuedVideoCount,
))
</script>

<template>
  <section aria-labelledby="product-media-rules-title" class="min-w-0">
    <div class="mb-3">
      <h3 id="product-media-rules-title" class="text-base font-semibold m-0">
        格式与容量
      </h3>
      <p class="text-sm text-muted-foreground m-0 mt-1">
        浏览器先提供即时反馈，文件内容仍由 Server 完成最终校验。
      </p>
    </div>

    <dl class="m-0 gap-2 grid">
      <div class="p-3 border rounded-lg bg-muted/25">
        <dt class="text-sm font-medium">
          图片
        </dt>
        <dd class="text-sm text-muted-foreground m-0 mt-1">
          JPEG、PNG、WebP；单张不超过 10 MiB；最多 20 张。
        </dd>
        <dd class="qs-type-meta m-0 mt-2">
          已占用 {{ currentImageCount }}，队列 {{ queuedImageCount }}，剩余 {{ remainingImageCount }}
        </dd>
      </div>

      <div class="p-3 border rounded-lg bg-muted/25">
        <dt class="text-sm font-medium">
          视频
        </dt>
        <dd class="text-sm text-muted-foreground m-0 mt-1">
          MP4；单个不超过 500 MiB；最多 5 个。
        </dd>
        <dd class="qs-type-meta m-0 mt-2">
          已占用 {{ currentVideoCount }}，队列 {{ queuedVideoCount }}，剩余 {{ remainingVideoCount }}
        </dd>
      </div>

      <div class="p-3 border rounded-lg bg-muted/25 flex gap-3 items-center justify-between">
        <dt class="text-sm font-medium">
          当前媒体总量
        </dt>
        <dd class="qs-type-meta m-0">
          {{ formatProductMediaBytes(totalSizeBytes) }}
        </dd>
      </div>
    </dl>
  </section>
</template>
