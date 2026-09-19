<script setup lang="ts">
import type { ContainerBatchCreateDto, ContainerBatchDto } from '@/api/generated/types.gen'
import QsDictionarySelect from '@/components/business/QsDictionarySelect/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { buildContainerSubmission, createContainerDraft, previewContainerDate, validateContainerDraft } from './form.logic'

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
  'submit': [data: ContainerBatchCreateDto]
}>()
const { t } = useI18n()
const draft = ref(createContainerDraft())
const loadingDatePreview = computed(() => previewContainerDate(draft.value.containerBatchName, props.batch ? new Date(props.batch.createdAt) : new Date()))
const formRef = useTemplateRef<{ submit: () => Promise<void>, setFieldError: (name: string, message?: string) => void }>('formRef')
const requested = ref(false)
const locked = computed(() => props.submitting || requested.value)
function rule(field: keyof typeof draft.value) {
  return (value: unknown) => {
    // FaForm 的字段校验可能先于父 model 更新，必须使用本次控件值。
    const current = { ...draft.value }
    if (field === 'warehouseValue') {
      current.warehouseValue = typeof value === 'string' ? value : null
    }
    else {
      current[field] = typeof value === 'string' ? value : ''
    }
    const key = validateContainerDraft(current)[field]
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
  if (locked.value || (!props.retryOnly && Object.keys(validateContainerDraft(draft.value)).length)) {
    return
  }
  requested.value = true
  // 来源附件由页面处理；编辑时必须保留现有绑定，不能因表单未展示附件而清空。
  emit('submit', { ...buildContainerSubmission(draft.value), ...(props.batch ? { sourceFileId: props.batch.sourceFileId } : {}) })
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
      <FaFormItem name="containerBatchName" :label="t('containerManagement.batchName')" :description="t('containerManagement.batchNameHint')" :rules="rule('containerBatchName')" required>
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
      <FaFormItem name="remark" :label="t('containerManagement.remark')" :rules="rule('remark')">
        <FaTextarea v-model="draft.remark" :rows="2" maxlength="500" :placeholder="t('containerManagement.remarkHint')" />
      </FaFormItem>
      <slot name="source-file" />
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
