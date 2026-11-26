<script setup lang="ts">
import type { MessageDraft } from '../../message-editor.types'
import type { NotificationEventMediaSourceDto } from '@/api/generated/types.gen'

import { computed, ref } from 'vue'
import { getApiClientFailureMessage } from '@/api/errors'
import notificationsApi from '@/api/modules/notifications'

const props = defineProps<{
  modelValue: MessageDraft
  mediaSources: NotificationEventMediaSourceDto[]
  disabled?: boolean
  errors: Record<string, string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: MessageDraft]
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const uploading = ref(false)
const uploadError = ref<string | null>(null)
const selectedSize = ref('')

const fixedAssetId = computed(() => {
  const value = props.modelValue.payload.mediaAssetId
  return typeof value === 'string' ? value : ''
})
const filename = computed(() => {
  const value = props.modelValue.payload.filename
  return typeof value === 'string' && value.length > 0 ? value : fixedAssetId.value
})
const dynamicSourceKeys = computed(() => {
  const value = props.modelValue.mediaPolicy.sourceKeys
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
})
const mode = computed<'FIXED' | 'DYNAMIC'>(() => props.modelValue.mediaPolicy.maxCount === 1 ? 'DYNAMIC' : 'FIXED')
const sourceOptions = computed(() => props.mediaSources.map(source => ({
  label: source.label,
  value: source.key,
})))

function update(next: MessageDraft): void {
  emit('update:modelValue', next)
}

function changeMode(next: 'FIXED' | 'DYNAMIC'): void {
  if (next === 'FIXED') {
    update({ ...props.modelValue, mediaPolicy: {} })
    return
  }
  update({
    ...props.modelValue,
    payload: { ...props.modelValue.payload, mediaAssetId: null, filename: null },
    mediaPolicy: { sourceKeys: [], maxCount: 1 },
  })
}

function chooseFile(): void {
  uploadError.value = null
  fileInput.value?.click()
}

async function onFileSelected(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file === undefined || uploading.value) {
    return
  }
  if (!['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(file.type)) {
    uploadError.value = '仅支持 PDF、DOCX、XLSX 文件'
    return
  }
  if (file.size > 20 * 1024 * 1024) {
    uploadError.value = '文件不得超过 20 MiB'
    return
  }
  uploading.value = true
  uploadError.value = null
  try {
    const response = await notificationsApi.contentMedia.uploadFile(file, new AbortController().signal)
    selectedSize.value = response.data.sizeBytes
    update({
      ...props.modelValue,
      payload: {
        mediaAssetId: response.data.assetId,
        filename: response.data.originalFilename,
      },
      mediaPolicy: {},
    })
  }
  catch (failure) {
    uploadError.value = getApiClientFailureMessage(failure, '文件上传失败')
  }
  finally {
    uploading.value = false
  }
}

function setSource(value: unknown): void {
  const key = typeof value === 'string' ? value.trim() : ''
  update({
    ...props.modelValue,
    mediaPolicy: key.length === 0 ? { sourceKeys: [], maxCount: 1 } : { sourceKeys: [key], maxCount: 1 },
  })
}

function formatSize(value: string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return ''
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div>
      <div class="text-sm font-medium">
        文件来源
      </div>
      <p class="text-xs text-muted-foreground mt-0.5">
        发件时只支持 PDF、DOCX、XLSX，单个文件不超过 20 MiB。
      </p>
    </div>

    <div class="p-1 rounded-lg bg-muted flex gap-1 w-fit">
      <button
        type="button"
        class="text-sm px-3 py-1.5 rounded-md transition-colors"
        :class="mode === 'FIXED' ? 'bg-background text-foreground font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'"
        :disabled="disabled"
        @click="changeMode('FIXED')"
      >
        固定文件
      </button>
      <button
        type="button"
        class="text-sm px-3 py-1.5 rounded-md transition-colors"
        :class="mode === 'DYNAMIC' ? 'bg-background text-foreground font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'"
        :disabled="disabled || mediaSources.length === 0"
        @click="changeMode('DYNAMIC')"
      >
        业务附件
      </button>
    </div>

    <div v-if="mode === 'FIXED'" class="p-3 border border-border rounded-lg bg-muted/20 flex flex-col gap-2">
      <div class="text-sm flex flex-wrap gap-2 items-center">
        <FaIcon name="i-lucide:file-text" class="text-muted-foreground size-4" />
        <span class="break-all">{{ filename || '尚未上传文件' }}</span>
        <span v-if="selectedSize !== ''" class="text-xs text-muted-foreground">{{ formatSize(selectedSize) }}</span>
      </div>
      <div v-if="!disabled" class="flex gap-2">
        <FaButton variant="outline" size="sm" :loading="uploading" @click="chooseFile">
          <FaIcon name="i-lucide:upload" />
          {{ fixedAssetId === '' ? '上传文件' : '更换文件' }}
        </FaButton>
      </div>
      <p v-if="uploadError !== null" class="text-xs text-destructive m-0">
        {{ uploadError }}
      </p>
      <p v-if="errors.mediaAssetId !== undefined" class="text-xs text-destructive m-0">
        {{ errors.mediaAssetId }}
      </p>
    </div>

    <div v-else class="p-3 border border-border rounded-lg bg-muted/20 flex flex-col gap-2">
      <span class="text-sm font-medium">业务附件来源</span>
      <FaSelect
        :model-value="dynamicSourceKeys[0]"
        :options="sourceOptions"
        :disabled="disabled"
        placeholder="选择业务附件来源"
        class="w-full"
        @update:model-value="setSource"
      />
      <p v-if="mediaSources.length === 0" class="text-xs text-muted-foreground m-0">
        当前事件没有可用的业务文件来源。
      </p>
      <p v-else class="text-xs text-muted-foreground m-0">
        发布时从该来源取一个文件；找不到时只跳过本消息，不影响后续消息。
      </p>
      <p v-if="errors.mediaPolicy !== undefined" class="text-xs text-destructive m-0">
        {{ errors.mediaPolicy }}
      </p>
    </div>

    <input
      ref="fileInput"
      class="hidden"
      type="file"
      accept=".pdf,.docx,.xlsx"
      @change="onFileSelected"
    >
  </div>
</template>
