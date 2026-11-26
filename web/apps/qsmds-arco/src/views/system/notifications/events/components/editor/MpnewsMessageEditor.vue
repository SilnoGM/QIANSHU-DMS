<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'
import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'
import RichTextEditor from '../RichTextEditor.vue'

const props = defineProps<{
  modelValue: Record<string, unknown>
  disabled?: boolean
  errors: Record<string, string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: Record<string, unknown>]
}>()

const MAXIMUM_COVER_BYTES = 10 * 1024 * 1024

const richTextRef = ref<{ insertVariable?: (name: string) => void } | null>(null)
const coverFileInput = ref<HTMLInputElement | null>(null)
const coverUploading = ref(false)
const coverUploadError = ref<string | null>(null)
const coverPreviewUrl = ref<string | null>(null)

const coverAssetId = computed(() => {
  const cover = props.modelValue.cover
  if (typeof cover !== 'object' || cover === null || Array.isArray(cover)) {
    return ''
  }
  const assetId = (cover as Record<string, unknown>).mediaAssetId
  return typeof assetId === 'string' ? assetId : ''
})

const coverDisplayUrl = computed(() => {
  if (coverPreviewUrl.value !== null) {
    return coverPreviewUrl.value
  }
  return coverAssetId.value === '' ? '' : notificationsApi.contentMedia.contentUrl(coverAssetId.value)
})

const title = computed(() => typeof props.modelValue.title === 'string' ? props.modelValue.title : '')
const author = computed(() => typeof props.modelValue.author === 'string' ? props.modelValue.author : '')
const digest = computed(() => typeof props.modelValue.digest === 'string' ? props.modelValue.digest : '')
const contentSourceUrl = computed(() => typeof props.modelValue.contentSourceUrl === 'string' ? props.modelValue.contentSourceUrl : '')
const content = computed(() => typeof props.modelValue.content === 'string' ? props.modelValue.content : '')

function update(next: Record<string, unknown>): void {
  emit('update:modelValue', next)
}

function setString(key: string, value: string, nullable = false): void {
  const normalized = value.trim().length === 0 && nullable ? null : value
  update({ ...props.modelValue, [key]: normalized })
}

function chooseCover(): void {
  coverUploadError.value = null
  coverFileInput.value?.click()
}

async function onCoverSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined || coverUploading.value) {
    return
  }
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    coverUploadError.value = '仅支持 JPEG、PNG、WebP 图片'
    return
  }
  if (file.size > MAXIMUM_COVER_BYTES) {
    coverUploadError.value = '封面图片不得超过 10 MiB'
    return
  }
  coverUploading.value = true
  coverUploadError.value = null
  try {
    const response = await notificationsApi.contentMedia.upload(file, new AbortController().signal)
    if (coverPreviewUrl.value !== null) {
      URL.revokeObjectURL(coverPreviewUrl.value)
    }
    coverPreviewUrl.value = URL.createObjectURL(file)
    update({ ...props.modelValue, cover: { mediaAssetId: response.data.assetId } })
  }
  catch (failure) {
    coverUploadError.value = getApiClientFailureMessage(failure, '封面上传失败')
  }
  finally {
    coverUploading.value = false
  }
}

function clearCover(): void {
  if (coverPreviewUrl.value !== null) {
    URL.revokeObjectURL(coverPreviewUrl.value)
    coverPreviewUrl.value = null
  }
  update({ ...props.modelValue, cover: null })
}

function insertVariable(name: string): void {
  richTextRef.value?.insertVariable?.(name)
}

defineExpose({ insertVariable })

onBeforeUnmount(() => {
  if (coverPreviewUrl.value !== null) {
    URL.revokeObjectURL(coverPreviewUrl.value)
  }
})
</script>

<template>
  <div class="flex flex-col gap-4">
    <div class="p-3 border border-border/70 rounded-lg bg-muted/20 flex flex-col gap-2">
      <div class="flex flex-wrap gap-3 items-start">
        <img
          v-if="coverDisplayUrl !== ''"
          :src="coverDisplayUrl"
          alt="mpnews 封面预览"
          class="border border-border rounded-lg bg-background shrink-0 h-20 w-[188px] object-contain"
        >
        <div v-else class="text-xs text-muted-foreground border border-border rounded-lg border-dashed bg-background flex shrink-0 h-20 w-[188px] items-center justify-center">
          未选择封面
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium">
            固定封面
          </div>
          <p class="text-xs text-muted-foreground mt-1">
            建议 1068×455 或等比例倍数，不超过 10 MiB。
          </p>
          <div class="mt-2 flex flex-wrap gap-2">
            <FaButton
              v-if="!disabled"
              variant="outline"
              size="sm"
              :loading="coverUploading"
              @click="chooseCover"
            >
              <FaIcon name="i-lucide:image-up" />
              选择封面
            </FaButton>
            <FaButton
              v-if="!disabled && coverAssetId !== ''"
              variant="ghost"
              size="sm"
              :disabled="coverUploading"
              @click="clearCover"
            >
              <FaIcon name="i-lucide:x" />
              清除
            </FaButton>
          </div>
          <div class="text-[10px] text-muted-foreground font-mono mt-1 break-all">
            {{ coverAssetId || '未配置资产' }}
          </div>
        </div>
      </div>
      <p v-if="coverUploadError !== null" class="text-xs text-destructive m-0">
        {{ coverUploadError }}
      </p>
      <p v-if="errors.cover !== undefined" class="text-xs text-destructive m-0">
        {{ errors.cover }}
      </p>
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-xs text-muted-foreground font-medium">
        文章信息
      </div>
      <div class="gap-3 grid md:grid-cols-2">
        <label class="text-sm flex flex-col gap-1">
          <span class="font-medium">标题</span>
          <FaInput
            :model-value="title"
            :disabled="disabled"
            maxlength="128"
            @update:model-value="value => setString('title', value ?? '')"
          />
          <span v-if="errors.title !== undefined" class="text-xs text-destructive">{{ errors.title }}</span>
        </label>
        <label class="text-sm flex flex-col gap-1">
          <span class="font-medium">作者</span>
          <FaInput
            :model-value="author"
            :disabled="disabled"
            maxlength="64"
            @update:model-value="value => setString('author', value ?? '', true)"
          />
          <span v-if="errors.author !== undefined" class="text-xs text-destructive">{{ errors.author }}</span>
        </label>
        <label class="text-sm flex flex-col gap-1">
          <span class="font-medium">摘要</span>
          <FaInput
            :model-value="digest"
            :disabled="disabled"
            maxlength="512"
            @update:model-value="value => setString('digest', value ?? '', true)"
          />
          <span v-if="errors.digest !== undefined" class="text-xs text-destructive">{{ errors.digest }}</span>
        </label>
        <label class="text-sm flex flex-col gap-1">
          <span class="font-medium">阅读原文</span>
          <FaInput
            :model-value="contentSourceUrl"
            :disabled="disabled"
            placeholder="https://"
            @update:model-value="value => setString('contentSourceUrl', value ?? '', true)"
          />
          <span v-if="errors.contentSourceUrl !== undefined" class="text-xs text-destructive">{{ errors.contentSourceUrl }}</span>
        </label>
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <div class="text-sm font-medium">
        正文
      </div>
      <RichTextEditor
        ref="richTextRef"
        :model-value="content"
        :disabled="disabled"
        @update:model-value="value => setString('content', value)"
      />
      <p v-if="errors.content !== undefined" class="text-xs text-destructive m-0">
        {{ errors.content }}
      </p>
      <p v-else class="text-xs text-muted-foreground m-0">
        正文图片仅允许 DMS 资产，单张不超过 2 MiB；右侧变量会插入到正文光标位置。
      </p>
    </div>

    <input
      ref="coverFileInput"
      class="hidden"
      type="file"
      :accept="IMAGE_ONLY_ACCEPT"
      @change="onCoverSelected"
    >
  </div>
</template>
