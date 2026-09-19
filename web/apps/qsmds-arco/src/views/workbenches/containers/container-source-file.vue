<script setup lang="ts">
import type { FileItem } from '@fantastic-admin/components'
import type { ApiClientError } from '@/api/errors'
import type { ContainerSourceFileDto } from '@/api/generated/types.gen'
import { getApiClientErrorMessage } from '@/api/errors'
import sourceFilesApi from '@/api/modules/container-source-files'

const props = defineProps<{ batchId: string, sourceFileId: string | null, canEdit: boolean, disabled?: boolean, loading?: boolean }>()
const emit = defineEmits<{ uploaded: [mediaAssetId: string], busyChange: [busy: boolean] }>()
const { t } = useI18n()
const account = useAppAccountStore()
const files = ref<FileItem[]>([])
const metadata = ref<ContainerSourceFileDto | null>(null)
const pending = ref<ContainerSourceFileDto | null>(null)
const busy = ref(false)
const error = ref('')
const locked = computed(() => !!props.disabled || !!props.loading || busy.value)
let controller: AbortController | null = null

function errorMessage(value: unknown) {
  return value && typeof value === 'object' && 'kind' in value && ['http', 'http-unparseable', 'network'].includes(String(value.kind))
    ? getApiClientErrorMessage(value as ApiClientError)
    : t('containerSource.failed')
}
function cancel() {
  controller?.abort()
  controller = null
  busy.value = false
}
async function readMetadata() {
  cancel()
  metadata.value = null
  if (!props.sourceFileId) {
    return
  }
  // 父数据已经带来源主键，说明挂载成功；读取名称失败只允许重读，不能再次挂载。
  pending.value = null
  files.value = []
  const request = new AbortController()
  controller = request
  busy.value = true
  error.value = ''
  try {
    const response = await sourceFilesApi.metadata(props.batchId, request.signal)
    if (!request.signal.aborted) {
      metadata.value = response.data
      pending.value = null
      files.value = []
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = errorMessage(failure)
    }
  }
  finally {
    if (controller === request) {
      controller = null
      busy.value = false
    }
  }
}
function validate(file: File) {
  const valid = /\.xlsx$/iu.test(file.name) && file.size > 0 && file.size <= 50 * 1024 * 1024
  error.value = valid ? '' : t('containerSource.invalidFile')
  return valid
}
async function upload({ file }: { file: File }) {
  if (locked.value || !props.canEdit || props.sourceFileId || pending.value || !validate(file)) {
    return null
  }
  const request = new AbortController()
  controller = request
  busy.value = true
  error.value = ''
  try {
    const response = await sourceFilesApi.upload(props.batchId, file, request.signal)
    if (!request.signal.aborted) {
      // 父保存失败仍保留临时文件身份，重试只重发挂载事件，不重复上传。
      pending.value = response.data
      emit('uploaded', response.data.mediaAssetId)
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = errorMessage(failure)
    }
  }
  finally {
    if (controller === request) {
      controller = null
      busy.value = false
    }
  }
  return null
}
async function download() {
  if (!metadata.value || locked.value) {
    return
  }
  const request = new AbortController()
  controller = request
  busy.value = true
  error.value = ''
  try {
    const response = await sourceFilesApi.download(props.batchId, request.signal)
    if (!request.signal.aborted) {
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = metadata.value.originalFilename
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    }
  }
  catch (failure) {
    if (!request.signal.aborted) {
      error.value = errorMessage(failure)
    }
  }
  finally {
    if (controller === request) {
      controller = null
      busy.value = false
    }
  }
}
watch(() => [props.batchId, account.authEpoch], () => {
  cancel()
  pending.value = null
  metadata.value = null
  files.value = []
  error.value = ''
  void readMetadata()
}, { flush: 'sync' })
watch(() => props.sourceFileId, readMetadata, { immediate: true })
watch(busy, value => emit('busyChange', value))
onBeforeUnmount(() => {
  cancel()
  emit('busyChange', false)
})
</script>

<template>
  <section class="min-w-0 space-y-2" :aria-label="t('containerSource.title')">
    <div class="flex flex-col gap-3 sm:flex-row sm:gap-5 sm:items-center">
      <h3 class="qs-type-body-medium m-0 flex shrink-0 gap-2 items-center">
        <FaIcon name="i-lucide:paperclip" class="text-muted-foreground size-4" aria-hidden="true" />
        {{ t('containerSource.title') }}
      </h3>
      <div v-if="metadata || pending" class="p-3 border border-border rounded-lg bg-muted/30 flex flex-1 flex-wrap gap-3 min-w-0 sm:flex-nowrap sm:max-w-2xl sm:items-center">
        <div class="flex flex-1 gap-3 min-w-0 items-center">
          <div class="text-primary rounded-md bg-primary/10 flex shrink-0 size-10 items-center justify-center dark:text-foreground">
            <FaIcon name="i-lucide:file-spreadsheet" class="size-6" aria-hidden="true" />
          </div>
          <div class="flex-1 min-w-0">
            <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
              {{ (metadata || pending)?.originalFilename }}
            </p>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              {{ t(metadata ? 'containerSource.saved' : 'containerSource.pending') }}
            </p>
          </div>
        </div>
        <FaButton v-if="metadata" variant="outline" size="sm" class="shrink-0 w-full sm:w-auto" :disabled="locked" @click="download">
          <FaIcon name="i-lucide:download" aria-hidden="true" />{{ t('containerSource.download') }}
        </FaButton>
        <FaButton v-else-if="pending && canEdit" variant="outline" size="sm" class="shrink-0 w-full sm:w-auto" :disabled="locked" @click="emit('uploaded', pending.mediaAssetId)">
          {{ t('containerSource.retryAttach') }}
        </FaButton>
      </div>
      <FaFileUpload v-else-if="canEdit && !sourceFileId" v-model="files" :max="1" :disabled="locked" :before-upload="validate" :http-request="upload" :description="t('containerSource.upload')" class="flex-1 min-w-0 [&>button]:px-3 [&>button]:py-2 [&>button]:border [&>button]:h-auto [&>button]:min-h-16">
        <div class="flex flex-wrap gap-x-3 gap-y-1 items-center justify-center">
          <span class="qs-type-body-medium flex gap-2 items-center"><FaIcon name="i-lucide:upload" class="size-4" aria-hidden="true" />{{ t('containerSource.upload') }}</span>
          <span class="qs-type-meta text-muted-foreground">{{ t('containerSource.hint') }}</span>
        </div>
      </FaFileUpload>
      <p v-else-if="!sourceFileId" class="qs-type-meta text-muted-foreground m-0">
        {{ t('containerSource.empty') }}
      </p>
    </div>
    <p v-if="busy" role="status" class="qs-type-meta text-muted-foreground m-0">
      {{ t(sourceFileId ? 'containerSource.loading' : 'containerSource.uploading') }}
    </p>
    <div v-if="error" class="gap-2 grid">
      <p role="alert" class="qs-type-meta text-destructive m-0">
        {{ error }}
      </p>
      <FaButton v-if="sourceFileId && !metadata" variant="outline" size="sm" :disabled="locked" @click="readMetadata">
        {{ t('containerSource.retryRead') }}
      </FaButton>
    </div>
  </section>
</template>
