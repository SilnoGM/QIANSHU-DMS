<script setup lang="ts">
import { useFaImagePreview } from '@fantastic-admin/components'

/**
 * 产品缩略图：统一卡片与详情抽屉的图片预览、无图和加载失败表现。
 *
 * 加载失败后不再保留 <img>，避免浏览器展示破损图标；失败态与无图共用同一
 * 占位结构，只用红色边框/底色区分。预览仍复用项目统一的图片预览能力。
 */
defineOptions({ name: 'QsProductThumbnail' })

const props = withDefaults(defineProps<{
  src?: string | null
  alt: string
  size?: 'sm' | 'md'
}>(), {
  src: null,
  size: 'sm',
})

const imagePreview = useFaImagePreview()
const failed = ref(false)
const hasImage = computed(() => Boolean(props.src) && !failed.value)
const sizeClass = computed(() => props.size === 'md' ? 'size-14' : 'size-11')
const previewLabel = computed(() => `预览产品图片：${props.alt}`)

watch(() => props.src, () => {
  failed.value = false
})

function markFailed(): void {
  failed.value = true
}

function openPreview(): void {
  if (!props.src || failed.value) {
    return
  }
  imagePreview.open(props.src, 0)
}
</script>

<template>
  <button
    v-if="hasImage"
    type="button"
    data-slot="qs-product-thumbnail"
    class="p-0 border border-border rounded-lg bg-background flex-center shrink-0 cursor-zoom-in overflow-hidden focus-visible:outline-none focus-visible:ring-2 hover:ring-2 focus-visible:ring-primary/40 hover:ring-primary/30"
    :class="sizeClass"
    :aria-label="previewLabel"
    @click="openPreview"
  >
    <img
      :src="src ?? undefined"
      :alt="alt"
      class="h-full w-full object-contain"
      loading="lazy"
      @error="markFailed"
    >
  </button>
  <span
    v-else
    data-slot="qs-product-thumbnail"
    class="border rounded-lg bg-background flex-center shrink-0 overflow-hidden"
    :class="[sizeClass, failed ? 'border-red-500/60 bg-red-500/10' : 'border-border']"
    role="img"
    :aria-label="failed ? '产品图片加载失败' : '暂无产品图片'"
  >
    <FaIcon name="i-lucide:image-off" class="text-muted-foreground size-4" aria-hidden="true" />
  </span>
</template>
