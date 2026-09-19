<script setup lang="ts">
import type { FileItem } from '@fantastic-admin/components'
import type { ContainerSubmission } from './form.logic'
import type { ContainerBatchDto } from '@/api/generated/types.gen'
import sourceFilesApi from '@/api/modules/container-source-files'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { buildContainerSubmission, createContainerDraft, inferContainerNameFromFilename, previewContainerDate, validateContainerDraft } from './form.logic'
import { useContainerCreateSource } from './use-container-create-source'

const props = withDefaults(defineProps<{
  modelValue: boolean
  batch?: ContainerBatchDto | null
  submitting?: boolean
  retryOnly?: boolean
  error?: string | null
  fieldErrors?: Readonly<Record<string, string>>
}>(), { batch: null, submitting: false, retryOnly: false, error: null, fieldErrors: () => ({}) })
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'submit': [data: ContainerSubmission]
}>()
const { t } = useI18n()
const draft = ref(createContainerDraft())
const loadingDatePreview = computed(() => previewContainerDate(draft.value.containerBatchName, props.batch ? new Date(props.batch.createdAt) : new Date()))
const formRef = useTemplateRef<{ submit: () => Promise<void>, setFieldError: (name: string, message?: string) => void, setFieldValue: (name: string, value: unknown, shouldValidate?: boolean) => void }>('formRef')
const requested = ref(false)
const account = useAppAccountStore()
const uploadFiles = ref<FileItem[]>([])
const source = useContainerCreateSource(
  computed(() => props.modelValue && !props.batch),
  computed(() => props.submitting || requested.value || props.retryOnly),
  computed(() => account.authEpoch),
  async (file, signal) => (await sourceFilesApi.uploadForCreate(file, signal)).data,
  t,
)
const { selectedFile, sourceFile, uploading, error: sourceError } = source
const locked = computed(() => props.submitting || requested.value || uploading.value)
watch(sourceFile, (file) => {
  if (!props.batch) {
    draft.value.sourceFileId = file?.mediaAssetId ?? null
    // 上传控件不自动绑定 UUID；主动同步字段并重验，清除此前的必填错误。
    if (props.modelValue) {
      formRef.value?.setFieldValue('sourceFileId', file?.mediaAssetId ?? null, true)
    }
  }
}, { flush: 'sync' })
watch(selectedFile, (file) => {
  if (!file || props.batch || !props.modelValue || props.retryOnly || draft.value.containerBatchName.trim()) {
    return
  }
  const name = inferContainerNameFromFilename(file.name)
  if (name) {
    draft.value.containerBatchName = name
    formRef.value?.setFieldValue('containerBatchName', name, true)
  }
}, { flush: 'sync' })
function rule(field: keyof typeof draft.value) {
  return (value: unknown) => {
    // FaForm 的字段校验可能先于父 model 更新，必须使用本次控件值。
    const current = { ...draft.value }
    if (field === 'warehouseValue' || field === 'sourceFileId') {
      current[field] = typeof value === 'string' ? value : null
    }
    else {
      current[field] = typeof value === 'string' ? value : ''
    }
    const key = validateContainerDraft(current, !props.batch)[field]
    return key ? t(`containerManagement.${key}`) : true
  }
}
watch(() => [props.modelValue, props.batch] as const, ([open]) => {
  if (open) {
    draft.value = createContainerDraft(props.batch)
  }
  requested.value = false
}, { immediate: true })
watch(() => props.submitting, (value) => {
  if (!value) {
    requested.value = false
  }
})
watch(() => props.fieldErrors, (errors) => {
  for (const [field, message] of Object.entries(errors)) {
    formRef.value?.setFieldError(field, message)
  }
}, { deep: true })
function close(value = false) {
  if (!locked.value) {
    emit('update:modelValue', value)
  }
}
async function submit() {
  if (locked.value || (!props.retryOnly && Object.keys(validateContainerDraft(draft.value, !props.batch)).length)) {
    return
  }
  requested.value = true
  // 创建绑定已上传附件；编辑保留既有绑定；结果未知时仍由父页面重放冻结请求。
  emit('submit', buildContainerSubmission(draft.value))
  await nextTick()
  if (!props.submitting) {
    requested.value = false
  }
}
</script>

<template>
  <QsGenericModal :model-value="modelValue" :title="t(batch ? 'containerManagement.editBatch' : 'containerManagement.createBatch')" :description="t('containerManagement.batchDescription')" size="md" :submitting="locked" @update:model-value="close">
    <template #header-leading>
      <FaIcon name="i-lucide:container" class="text-primary size-5" />
    </template>
    <FaAlert v-if="error" variant="destructive" :title="t('containerManagement.saveFailed')" :description="error" class="mb-5" role="alert" />
    <FaAlert v-if="retryOnly" :title="t('containerManagement.retryHint')" class="mb-5" />
    <FaForm ref="formRef" :model="draft" :disabled="locked || retryOnly" scroll-to-error class="gap-3" @submit="submit">
      <FaFormItem name="containerBatchName" :label="t('containerManagement.batchName')" :description="t(batch ? 'containerManagement.batchNameHint' : 'containerManagement.batchNameCreateHint')" :rules="rule('containerBatchName')" required>
        <FaInput v-model="draft.containerBatchName" class="w-full" maxlength="32" :placeholder="t('containerManagement.batchNamePlaceholder')" />
      </FaFormItem>
      <div class="mb-1 px-3 py-2.5 rounded-md bg-muted/40 flex gap-3 items-center justify-between" aria-live="polite" aria-atomic="true">
        <span class="qs-type-meta text-muted-foreground flex gap-2 items-center">
          <FaIcon name="i-lucide:calendar-days" class="size-4" aria-hidden="true" />
          {{ t('containerManagement.loadingDate') }}
        </span>
        <span class="qs-type-data-emphasis">{{ loadingDatePreview ?? '—' }}</span>
      </div>
      <FaFormItem name="warehouseValue" :label="t('containerManagement.warehouse')" :rules="rule('warehouseValue')" required>
        <QsDictionarySelect v-model="draft.warehouseValue" dictionary-code="mainland.warehouse" :disabled="locked || retryOnly" :placeholder="t('containerManagement.selectWarehouse')" />
      </FaFormItem>
      <FaFormItem v-if="!batch" name="sourceFileId" :label="t('containerSource.title')" :description="t('containerSource.createHint')" :rules="rule('sourceFileId')" :auto-bind="false" required>
        <div class="min-w-0 space-y-2" :aria-busy="uploading">
          <FaFileUpload v-if="!selectedFile" v-model="uploadFiles" :max="1" :disabled="locked || retryOnly" :before-upload="source.selectFile" :description="t('containerSource.upload')" class="[&>button]:px-3 [&>button]:py-4 [&>button]:h-auto [&>button]:min-h-20">
            <span class="qs-type-body-medium flex gap-2 items-center justify-center">
              <FaIcon name="i-lucide:upload" class="size-5" aria-hidden="true" />{{ t('containerSource.upload') }}
            </span>
          </FaFileUpload>
          <div v-else class="p-3 border border-border rounded-lg bg-muted/30 flex flex-wrap gap-3 items-center">
            <FaIcon name="i-lucide:file-spreadsheet" class="text-primary shrink-0 size-7 dark:text-foreground" aria-hidden="true" />
            <div class="flex-1 min-w-0">
              <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
                {{ selectedFile.name }}
              </p>
              <p role="status" class="qs-type-meta text-muted-foreground m-0 mt-1">
                {{ t(uploading ? 'containerSource.uploading' : sourceFile ? 'containerSource.readyForCreate' : 'containerSource.uploadFailed') }}
              </p>
            </div>
            <div class="flex gap-1">
              <FaButton v-if="!sourceFile && !uploading" variant="outline" size="sm" :disabled="locked || retryOnly" @click="source.retry">
                {{ t('containerSource.retryUpload') }}
              </FaButton>
              <FaButton variant="ghost" size="sm" :disabled="locked || retryOnly" @click="source.remove">
                {{ t('containerSource.remove') }}
              </FaButton>
            </div>
          </div>
          <p v-if="sourceError" role="alert" class="qs-type-meta text-destructive m-0">
            {{ sourceError }}
          </p>
        </div>
      </FaFormItem>
      <FaFormItem name="remark" :label="t('containerManagement.remark')" :rules="rule('remark')">
        <FaTextarea v-model="draft.remark" :rows="2" maxlength="500" :placeholder="t('containerManagement.remarkHint')" />
      </FaFormItem>
    </FaForm>
    <template #footer>
      <FaButton variant="outline" :disabled="locked" class="w-full sm:w-auto" @click="close()">
        {{ t('containerManagement.cancel') }}
      </FaButton>
      <FaButton :loading="locked" :disabled="locked" class="w-full sm:w-auto" @click="retryOnly ? submit() : formRef?.submit()">
        {{ t(retryOnly ? 'containerManagement.retryConfirm' : batch ? 'containerManagement.save' : 'containerManagement.create') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
