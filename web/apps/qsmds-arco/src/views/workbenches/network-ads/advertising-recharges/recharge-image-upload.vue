<script setup lang="ts">
import type { RechargeImageUploadFile } from './use-recharge-image-upload'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { IMAGE_ONLY_ACCEPT } from '@/utils/upload-policy'
import { useRechargeImageUpload } from './use-recharge-image-upload'

const props = withDefaults(defineProps<{
  disabled?: boolean
  enabled: boolean
  height?: number
  hint?: string
  label: string
  modelValue: string | null
  resetKey?: string
  upload: RechargeImageUploadFile
  width?: number
}>(), {
  disabled: false,
  height: 112,
  hint: undefined,
  resetKey: undefined,
  width: 168,
})

const emit = defineEmits<{
  'busyChange': [busy: boolean]
  'update:modelValue': [id: string | null]
}>()

const { t } = useI18n()
const images = ref<string[]>([])
const locked = computed(() => props.disabled)
const enabled = computed(() => props.enabled)
const resetKey = computed(() => props.resetKey ?? '')
const { uploading, previewUrl, filename, error, upload, remove } = useRechargeImageUpload({
  enabled,
  locked,
  resetKey,
  update: id => emit('update:modelValue', id),
  upload: (file, signal) => props.upload(file, signal),
})

async function requestUpload({ file }: { file: File }) {
  await upload(file)
  return null
}

watch(uploading, value => emit('busyChange', value), { immediate: true })
onBeforeUnmount(() => emit('busyChange', false))
</script>

<template>
  <div class="gap-2 grid min-w-0">
    <div class="p-3 border border-border rounded-lg bg-background min-w-0">
      <!-- 已上传态压成横向一行：缩略图 + 文件名 + 单一「重新选择」入口，避免与字段标签重复。 -->
      <div v-if="previewUrl" class="gap-3 grid grid-cols-[72px_minmax(0,1fr)] items-center">
        <ImageGroup :items="[{ src: previewUrl, alt: filename, previewSrc: previewUrl }]" :size="72" :max-count="1" fit="cover" />
        <div class="flex flex-col gap-1.5 min-w-0">
          <p class="qs-type-body-medium m-0 truncate" :title="filename">
            {{ filename }}
          </p>
          <p class="qs-type-meta text-primary m-0 flex gap-1.5 items-center dark:text-emerald-300">
            <FaIcon name="i-lucide:circle-check" class="shrink-0 size-4" aria-hidden="true" />
            {{ t('advertisingRecharge.upload.uploaded') }}
          </p>
          <div>
            <FaButton type="button" variant="ghost" size="sm" :disabled="disabled || uploading || !enabled" class="text-muted-foreground min-h-11 -ml-2 sm:min-h-8" @click="remove">
              <FaIcon name="i-lucide:replace" class="size-4" aria-hidden="true" />
              {{ t('advertisingRecharge.upload.replace') }}
            </FaButton>
          </div>
        </div>
      </div>
      <FaImageUpload
        v-else
        v-model="images"
        :accept="IMAGE_ONLY_ACCEPT"
        :max="1"
        :width="width"
        :height="height"
        :disabled="disabled || uploading || !enabled"
        :http-request="requestUpload"
        :aria-label="label"
      >
        <span class="text-muted-foreground border border-border rounded-lg border-dashed flex flex-col gap-1.5 size-full items-center justify-center">
          <FaIcon :name="uploading ? 'i-lucide:loader-circle' : 'i-lucide:image-plus'" class="size-6" :class="{ 'animate-spin': uploading }" aria-hidden="true" />
          <span class="qs-type-meta">{{ t(uploading ? 'advertisingRecharge.upload.uploading' : 'advertisingRecharge.upload.action') }}</span>
        </span>
      </FaImageUpload>
    </div>
    <p v-if="uploading" role="status" class="qs-type-meta text-muted-foreground m-0">
      {{ t('advertisingRecharge.upload.uploading') }}
    </p>
    <p v-if="error" role="alert" class="qs-type-meta text-destructive m-0">
      {{ error }}
    </p>
    <p v-if="hint" class="qs-type-meta text-muted-foreground m-0">
      {{ hint }}
    </p>
  </div>
</template>
