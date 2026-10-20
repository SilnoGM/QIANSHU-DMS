<script setup lang="ts">
import profileApi from '@/api/modules/profile'
import { compressAvatarFile } from '@/utils/image-compression'
import { validateUploadImage } from '@/utils/image-upload-rules'
import { resolveAvatarPreviewUrl } from '@/utils/user-profile'

defineOptions({ name: 'QsAvatarUploader' })

const props = withDefaults(defineProps<{
  disabled?: boolean
  layout?: 'inline' | 'stacked'
  size?: 64 | 96
}>(), {
  disabled: false,
  layout: 'inline',
  size: 96,
})

const avatarUrl = defineModel<string>({ default: '' })
const uploading = defineModel<boolean>('uploading', { default: false })

const { t } = useI18n()
const account = useAppAccountStore()
const images = ref<string[]>([])
const previewUrl = ref<string | null>(null)
const lastUploadedUrl = ref<string | null>(null)
const pendingFile = ref<File | null>(null)
const error = ref('')
const retryable = ref(false)
let controller: AbortController | null = null
let disposed = false

const displayUrl = computed(() =>
  previewUrl.value ?? resolveAvatarPreviewUrl(avatarUrl.value),
)
const rootClass = computed(() => props.layout === 'stacked'
  ? 'flex flex-col gap-3 items-center text-center'
  : 'flex gap-3 items-center')
const avatarClass = computed(() => props.size === 96 ? 'size-24' : 'size-16')
const fallbackIconClass = computed(() => props.size === 96 ? 'size-12' : 'size-8')
const actionLabel = computed(() => {
  if (uploading.value) {
    return t('accountProfile.avatarUploading')
  }
  return avatarUrl.value === ''
    ? t('accountProfile.avatarUploadHint')
    : t('accountProfile.avatarReplaceHint')
})

function readErrorCode(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined
  }
  if ('code' in value && typeof value.code === 'string') {
    return value.code
  }
  const body = 'body' in value ? value.body : undefined
  if (
    typeof body === 'object'
    && body !== null
    && 'code' in body
    && typeof body.code === 'string'
  ) {
    return body.code
  }
  return undefined
}

function clearError(): void {
  error.value = ''
  retryable.value = false
}

function clearPreview(): void {
  if (previewUrl.value !== null) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
}

function setPreview(file: File): void {
  clearPreview()
  previewUrl.value = URL.createObjectURL(file)
}

function abort(): void {
  controller?.abort()
  controller = null
}

function failureMessage(failure: 'type' | 'empty' | 'too-large'): string {
  if (failure === 'type') {
    return t('accountProfile.avatarInvalidType')
  }
  if (failure === 'empty') {
    return t('accountProfile.avatarEmpty')
  }
  return t('accountProfile.avatarTooLarge')
}

function uploadFailureMessage(failure: unknown): { message: string, retryable: boolean } {
  const code = readErrorCode(failure)
  if (code === 'PROFILE_AVATAR_INVALID') {
    return { message: t('accountProfile.avatarInvalidType'), retryable: false }
  }
  if (code === 'PROFILE_AVATAR_TOO_LARGE') {
    return { message: t('accountProfile.avatarTooLarge'), retryable: false }
  }
  if (code === 'PROFILE_AVATAR_EXPIRED') {
    return { message: t('accountProfile.avatarExpired'), retryable: false }
  }
  if (code === 'PROFILE_AVATAR_UNAVAILABLE') {
    return { message: t('accountProfile.avatarUnavailable'), retryable: false }
  }
  return { message: t('accountProfile.avatarUploadFailed'), retryable: true }
}

/**
 * FaImageUpload 只负责选文件；这里完成压缩、上传、预览与重试。
 * 返回值固定为 null，避免组件把接口响应误当成预览 URL 推入内部列表。
 */
async function uploadAvatarFile({ file }: { file: File }): Promise<null> {
  if (props.disabled || uploading.value) {
    return null
  }

  clearError()
  const failure = validateUploadImage(file)
  if (failure !== null) {
    pendingFile.value = null
    error.value = failureMessage(failure)
    return null
  }

  uploading.value = true
  pendingFile.value = file
  let compressed: File
  try {
    compressed = await compressAvatarFile(file)
  }
  catch {
    compressed = file
  }
  if (disposed || !uploading.value) {
    return null
  }
  setPreview(compressed)

  const request = controller = new AbortController()
  const epoch = account.authEpoch
  try {
    const response = await profileApi.uploadAvatar(compressed, request.signal)
    if (disposed || request.signal.aborted || epoch !== account.authEpoch) {
      return null
    }
    lastUploadedUrl.value = response.data.avatarUrl
    avatarUrl.value = response.data.avatarUrl
    // 上传成功后改用服务端内容地址；UPLOADING 资产对上传者本人可读，
    // 避免长期持有 object URL 或让预览与最终存储内容不一致。
    clearPreview()
    pendingFile.value = null
    clearError()
  }
  catch (uploadFailure) {
    if (disposed || request.signal.aborted || epoch !== account.authEpoch) {
      return null
    }
    const mapped = uploadFailureMessage(uploadFailure)
    error.value = mapped.message
    retryable.value = mapped.retryable
    clearPreview()
  }
  finally {
    if (controller === request) {
      controller = null
    }
    if (!disposed) {
      uploading.value = false
    }
  }
  return null
}

function retryUpload(): void {
  const file = pendingFile.value
  if (file === null || uploading.value || props.disabled) {
    return
  }
  void uploadAvatarFile({ file })
}

function removeAvatar(): void {
  if (uploading.value || props.disabled) {
    return
  }
  abort()
  avatarUrl.value = ''
  lastUploadedUrl.value = null
  pendingFile.value = null
  clearPreview()
  clearError()
}

watch(avatarUrl, (value) => {
  if (value !== lastUploadedUrl.value) {
    abort()
    uploading.value = false
    clearPreview()
    lastUploadedUrl.value = null
    pendingFile.value = null
    clearError()
  }
})

onBeforeUnmount(() => {
  disposed = true
  abort()
  clearPreview()
  uploading.value = false
})
</script>

<template>
  <div :class="rootClass">
    <FaImageUpload
      v-model="images"
      :aria-label="actionLabel"
      :disabled="disabled || uploading"
      :height="size"
      :http-request="uploadAvatarFile"
      :max="1"
      :width="size"
    >
      <span class="group rounded-full block relative" :class="avatarClass">
        <FaAvatar
          :src="displayUrl ?? ''"
          class="border-4 border-background shadow-sm"
          :class="avatarClass"
        >
          <FaIcon
            name="i-carbon:user-avatar-filled"
            class="text-muted-foreground"
            :class="fallbackIconClass"
          />
        </FaAvatar>
        <span
          aria-hidden="true"
          class="text-white rounded-full bg-black/50 opacity-0 flex flex-col gap-1 transition-opacity items-center inset-0 justify-center absolute group-hover:opacity-100"
        >
          <FaIcon
            :name="uploading ? 'i-lucide:loader-circle' : 'i-lucide:camera'"
            :class="{ 'animate-spin motion-reduce:animate-none': uploading }"
            class="size-5"
          />
          <span class="text-[11px] leading-3">
            {{ uploading ? t('accountProfile.avatarUploading') : avatarUrl === '' ? t('accountProfile.avatarUploadHint') : t('accountProfile.avatarReplaceHint') }}
          </span>
        </span>
      </span>
    </FaImageUpload>

    <div class="min-w-0 space-y-1">
      <p class="text-xs text-muted-foreground leading-5">
        {{ actionLabel }}
      </p>
      <p class="text-[11px] text-muted-foreground/70 leading-4">
        {{ t('accountProfile.avatarFormatHint') }}
      </p>
      <div
        v-if="(avatarUrl !== '' && !uploading) || (retryable && pendingFile !== null && !uploading)"
        class="flex flex-wrap gap-x-3 gap-y-1"
        :class="layout === 'stacked' ? 'justify-center' : ''"
      >
        <FaButton
          v-if="avatarUrl !== '' && !uploading"
          type="button"
          variant="link"
          size="sm"
          class="text-muted-foreground p-0 h-auto"
          :disabled="disabled"
          @click="removeAvatar"
        >
          {{ t('accountProfile.avatarRemove') }}
        </FaButton>
        <FaButton
          v-if="retryable && pendingFile !== null && !uploading"
          type="button"
          variant="link"
          size="sm"
          class="p-0 h-auto"
          :disabled="disabled"
          @click="retryUpload"
        >
          {{ t('accountProfile.avatarRetry') }}
        </FaButton>
      </div>
      <p v-if="error" role="alert" class="text-xs text-destructive leading-5">
        {{ error }}
      </p>
    </div>
  </div>
</template>
