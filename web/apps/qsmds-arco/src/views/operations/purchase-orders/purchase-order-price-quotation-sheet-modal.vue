<script setup lang="ts">
import { useFaImagePreview } from '@fantastic-admin/components'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

const props = defineProps<{
  modelValue: boolean
  previewUrl: string | null
  imageLoaded: boolean
  imageFailed: boolean
  generating: boolean
  error: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'download': []
  'copy': []
  'imageLoad': [url: string]
  'imageError': [url: string]
}>()

const canUseImage = computed(() => (
  props.previewUrl !== null && props.imageLoaded && !props.generating
))

function markLoaded(): void {
  if (props.previewUrl !== null) {
    emit('imageLoad', props.previewUrl)
  }
}

function markFailed(): void {
  if (props.previewUrl !== null) {
    emit('imageError', props.previewUrl)
  }
}

const imagePreview = useFaImagePreview()

function openPreview(): void {
  if (props.imageLoaded && props.previewUrl !== null) {
    imagePreview.open(props.previewUrl)
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="核价单预览"
    description="核价单仅包含产品、数量、采购定价与本单采购价，用于发给供应商核对价格。"
    size="2xl"
    :dismiss-on-overlay="!generating"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col gap-3 min-w-0">
      <div
        v-if="generating"
        class="p-8 border border-border/70 rounded-xl bg-muted/15 flex flex-col gap-3 items-center justify-center"
        role="status"
      >
        <FaIcon name="i-lucide:loader-circle" class="text-primary size-6 animate-spin" aria-hidden="true" />
        <p class="text-sm text-muted-foreground m-0">
          正在生成核价单…
        </p>
      </div>
      <FaAlert
        v-else-if="error"
        title="核价单生成失败"
        :description="error"
        variant="destructive"
      />
      <div
        v-else-if="previewUrl"
        class="p-3 border border-border/60 rounded-lg bg-white max-h-[65vh] overflow-auto"
      >
        <img
          :key="previewUrl"
          :src="previewUrl"
          alt="核价单预览"
          aria-label="核价单预览，点击可放大"
          :aria-disabled="!imageLoaded"
          role="button"
          tabindex="0"
          class="h-auto w-full"
          :class="imageLoaded ? 'cursor-zoom-in' : 'opacity-60'"
          @load="markLoaded"
          @error="markFailed"
          @click="openPreview"
          @keydown.enter.prevent="openPreview"
          @keydown.space.prevent="openPreview"
        >
      </div>
      <p v-if="imageFailed" class="text-sm text-destructive m-0" role="alert">
        核价单图片加载失败，请重新生成。
      </p>
      <p class="qs-type-meta text-muted-foreground m-0">
        点击图片可放大查看；下载或复制后发送给供应商。修改产品明细或价格后需要重新生成。
      </p>
    </div>
    <template #footer>
      <FaButton type="button" variant="outline" :disabled="!canUseImage" @click="emit('download')">
        <FaIcon name="i-lucide:download" aria-hidden="true" />下载图片
      </FaButton>
      <FaButton type="button" :disabled="!canUseImage" @click="emit('copy')">
        <FaIcon name="i-lucide:copy" aria-hidden="true" />复制图片
      </FaButton>
      <FaButton type="button" variant="outline" @click="emit('update:modelValue', false)">
        关闭
      </FaButton>
    </template>
  </QsGenericModal>
</template>
