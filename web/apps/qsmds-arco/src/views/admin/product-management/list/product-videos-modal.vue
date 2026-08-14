<script setup lang="ts">
import type { ProductListItemViewModel } from './product-list.logic'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import { resolveProductMediaContentUrl } from './product-list.logic'

interface ProductVideoItem {
  readonly id: string
  readonly index: number
  readonly originalFilename: string
  readonly safeUrl: string | null
}

const props = withDefaults(defineProps<{
  contentReadable?: boolean
  modelValue: boolean
  product: ProductListItemViewModel | null
}>(), {
  contentReadable: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
}>()

const activeIndex = ref(0)
const previewFailed = ref(false)
const videoElement = ref<HTMLVideoElement | null>(null)

const title = computed(() => props.product === null
  ? '产品视频'
  : `${props.product.name} · 产品视频`)
const videos = computed<readonly ProductVideoItem[]>(() => {
  if (!props.contentReadable) {
    return []
  }
  const product = props.product
  if (product === null) {
    return []
  }
  return product.media.videos.map((video, index) => ({
    id: video.id,
    index,
    originalFilename: video.originalFilename,
    safeUrl: resolveProductMediaContentUrl(product.id, video),
  }))
})
const selectedVideo = computed(() => videos.value[activeIndex.value] ?? null)

function pauseActiveVideo(): void {
  videoElement.value?.pause()
}

async function selectVideo(index: number): Promise<void> {
  pauseActiveVideo()
  activeIndex.value = index
  previewFailed.value = false
  await nextTick()
  videoElement.value?.load()
}

function updateVisible(value: boolean): void {
  if (!value) {
    pauseActiveVideo()
  }
  emit('update:modelValue', value)
}

function close(): void {
  pauseActiveVideo()
  emit('update:modelValue', false)
}

watch(
  [() => props.modelValue, () => props.product?.id],
  ([visible]) => {
    if (!visible) {
      pauseActiveVideo()
    }
    activeIndex.value = 0
    previewFailed.value = false
  },
)

onBeforeUnmount(pauseActiveVideo)
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="title"
    description="选择一个视频进行预览，也可在新窗口打开受保护的领域内容。"
    size="xl"
    @closed="pauseActiveVideo"
    @update:model-value="updateVisible"
  >
    <FaEmpty
      v-if="!contentReadable"
      icon="i-lucide:shield-alert"
      title="无权读取媒体内容"
      description="当前身份不能加载或打开产品视频。"
      class="py-8"
    />
    <div v-else-if="product && videos.length" class="gap-5 grid lg:grid-cols-[minmax(0,1fr)_16rem]">
      <section aria-label="视频预览" class="min-w-0">
        <div class="border border-border rounded-lg bg-muted/30 overflow-hidden">
          <video
            v-if="selectedVideo?.safeUrl && !previewFailed"
            ref="videoElement"
            :key="selectedVideo.id"
            :src="selectedVideo.safeUrl"
            controls
            preload="metadata"
            class="bg-foreground/5 h-auto w-full aspect-video block"
            @error="previewFailed = true"
          >
            当前浏览器不支持视频播放。
          </video>
          <FaEmpty
            v-else
            icon="i-lucide:video-off"
            title="视频暂不可预览"
            description="内容地址与当前产品不匹配，或媒体加载失败。"
            class="min-h-52 aspect-video justify-center"
          />
        </div>
        <div v-if="selectedVideo" class="mt-3 min-w-0">
          <a
            v-if="selectedVideo.safeUrl"
            :href="selectedVideo.safeUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="text-sm text-primary inline-flex gap-2 max-w-full items-center focus-visible:outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <FaIcon name="i-lucide:external-link" class="shrink-0" />
            <span class="truncate">在新窗口打开当前视频</span>
          </a>
          <p class="qs-type-meta mb-0 mt-2 [overflow-wrap:anywhere]">
            {{ selectedVideo.originalFilename }}
          </p>
        </div>
      </section>

      <nav aria-label="产品视频列表" class="min-w-0">
        <p class="qs-type-compact-label mb-2 mt-0">
          视频列表（{{ videos.length }}）
        </p>
        <div class="pr-1 gap-2 grid max-h-[24rem] overflow-y-auto">
          <FaButton
            v-for="video in videos"
            :key="video.id"
            type="button"
            variant="outline"
            class="px-3 py-2 h-auto min-h-11 w-full justify-start"
            :class="video.index === activeIndex ? 'border-primary bg-primary/5 text-primary' : ''"
            :aria-current="video.index === activeIndex ? 'true' : undefined"
            @click="selectVideo(video.index)"
          >
            <FaIcon name="i-lucide:play" class="shrink-0" />
            <span class="truncate">{{ video.originalFilename }}</span>
          </FaButton>
        </div>
      </nav>
    </div>
    <FaEmpty
      v-else
      icon="i-lucide:video"
      title="暂无产品视频"
      description="当前产品没有可展示的视频。"
      class="py-8"
    />

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        @click="close"
      >
        关闭视频
      </FaButton>
    </template>
  </QsGenericModal>
</template>
