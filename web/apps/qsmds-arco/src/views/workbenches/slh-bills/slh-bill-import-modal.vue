<script setup lang="ts">
import type { DateValue } from '@internationalized/date'
import type { SlhBillArchiveDraft } from './import.logic'
import type { SlhBillImportPreviewDto } from '@/api/generated/types.gen'
import { getLocalTimeZone, parseDate, today } from '@internationalized/date'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { createSlhBillArchiveDraft, validateSlhBillArchiveDraft, withSlhBillNameSuffix } from './import.logic'

const props = withDefaults(defineProps<{
  modelValue: boolean
  preview: SlhBillImportPreviewDto | null
  /** 原件元数据；入库前原件只是暂存文件，无法预览或下载。 */
  attachmentName: string
  attachmentSizeBytes: number
  submitting?: boolean
  error?: string | null
  fieldErrors?: Readonly<Record<string, string>>
  /** 每次递增表示又撞了一次名称冲突：自动把日期后缀补到名称上。 */
  nameConflictNonce?: number
}>(), { submitting: false, error: null, fieldErrors: () => ({}), nameConflictNonce: 0 })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'submit': [archive: SlhBillArchiveDraft]
}>()

const { t } = useI18n()
const draft = ref<SlhBillArchiveDraft>({ billName: '', billMonth: '', remark: '' })
const requested = ref(false)
const formRef = useTemplateRef<{
  submit: () => Promise<void>
  setFieldError: (name: string, message?: string) => void
  setFieldValue: (name: string, value: unknown, shouldValidate?: boolean) => void
}>('formRef')
const locked = computed(() => props.submitting)
// 月份控件的值是日历对象，表单里存的是 YYYY-MM，这里做一层转换。
const monthValue = computed<DateValue>({
  get: () => draft.value.billMonth === '' ? today(getLocalTimeZone()) : parseDate(`${draft.value.billMonth}-01`),
  set: (value) => {
    draft.value.billMonth = `${value.year}-${String(value.month).padStart(2, '0')}`
  },
})
const attachmentSize = computed(() => {
  const bytes = props.attachmentSizeBytes
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(2)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
})
/** 月份触发按钮沿用项目里月份的统一写法（YYYY-MM），避免默认的完整日期串。 */
function formatMonthValue(value: DateValue | DateValue[] | undefined): string {
  if (value === undefined || Array.isArray(value)) {
    return ''
  }
  return `${value.year}-${String(value.month).padStart(2, '0')}`
}
function rule(field: keyof SlhBillArchiveDraft) {
  return (value: unknown) => {
    // FaForm 的字段校验可能先于父 model 更新，必须用本次控件值参与校验。
    const current = { ...draft.value, [field]: typeof value === 'string' ? value : '' }
    const key = validateSlhBillArchiveDraft(current)[field]
    return key ? t(`slhBill.archive.error.${key}`) : true
  }
}
watch(() => props.modelValue, (open) => {
  if (open && props.preview) {
    draft.value = createSlhBillArchiveDraft(props.preview)
  }
  requested.value = false
})
watch(() => props.submitting, (value) => {
  if (!value) {
    requested.value = false
  }
})
watch(() => props.nameConflictNonce, (nonce) => {
  if (nonce <= 0) {
    return
  }
  const corrected = withSlhBillNameSuffix(draft.value.billName, new Date())
  draft.value.billName = corrected
  formRef.value?.setFieldValue('billName', corrected, true)
}, { flush: 'sync' })
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
  if (locked.value || Object.keys(validateSlhBillArchiveDraft(draft.value)).length > 0) {
    return
  }
  requested.value = true
  emit('submit', { ...draft.value, billName: draft.value.billName.trim(), remark: draft.value.remark.trim() })
  await nextTick()
  if (!props.submitting) {
    requested.value = false
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('slhBill.archive.title')"
    :description="t('slhBill.archive.description')"
    size="md"
    :submitting="locked"
    @update:model-value="close"
  >
    <FaAlert v-if="error" variant="destructive" :title="t('slhBill.archive.failed')" :description="error" class="mb-5" role="alert" />
    <FaForm ref="formRef" :model="draft" :disabled="locked" scroll-to-error class="gap-4" @submit="submit">
      <!-- 编号与附件是只读展示，不用 FaFormItem：它要求 name，会把展示行当表单字段。 -->
      <div class="flex flex-wrap gap-x-3 gap-y-1 items-center justify-between">
        <span class="qs-type-body-medium">{{ t('slhBill.archive.billNo') }}</span>
        <span class="flex gap-1.5 items-center">
          <span class="qs-type-meta text-muted-foreground">{{ t('slhBill.archive.billNoPending') }}</span>
          <!-- 编号规则较长，收进提示里按需查看，避免正文被解释文字占满。 -->
          <FaTooltip :text="t('slhBill.archive.billNoHint')">
            <button type="button" class="text-muted-foreground p-0 border-0 bg-transparent cursor-pointer" :aria-label="t('slhBill.archive.billNo')">
              <FaIcon name="i-lucide:info" class="size-3.5" aria-hidden="true" />
            </button>
          </FaTooltip>
        </span>
      </div>
      <FaFormItem name="billName" :label="t('slhBill.archive.billName')" :rules="rule('billName')" required>
        <FaInput v-model="draft.billName" class="w-full" maxlength="200" :placeholder="t('slhBill.archive.billNamePlaceholder')" />
      </FaFormItem>
      <FaFormItem name="billMonth" :label="t('slhBill.archive.billMonth')" :description="t('slhBill.archive.billMonthHint')" :rules="rule('billMonth')" required>
        <!-- 用弹层形态：内联月历会把弹窗撑高一屏，触发按钮与上面的输入框同宽同高。 -->
        <FaCalendarMonth
          v-model="monthValue"
          picker
          :calendar-label="t('slhBill.archive.billMonth')"
          :format-value="formatMonthValue"
          :picker-placeholder="t('slhBill.archive.billMonth')"
          trigger-class="w-full justify-start"
        />
      </FaFormItem>
      <div class="pt-1 border-t border-border" />
      <div class="p-3 border border-border rounded-lg bg-muted/20 flex gap-3 min-w-0 items-center">
        <span class="text-primary rounded-md bg-primary/10 flex shrink-0 size-9 items-center justify-center dark:text-foreground">
          <FaIcon name="i-lucide:file-spreadsheet" class="size-5" aria-hidden="true" />
        </span>
        <div class="min-w-0">
          <p class="qs-type-body m-0 [overflow-wrap:anywhere]">
            {{ attachmentName }}
          </p>
          <p class="qs-type-meta text-muted-foreground m-0 mt-0.5">
            {{ t('slhBill.archive.attachmentHint', { size: attachmentSize }) }}
          </p>
        </div>
      </div>
      <FaFormItem name="remark" :label="t('slhBill.archive.remark')" :rules="rule('remark')">
        <FaTextarea v-model="draft.remark" :rows="2" maxlength="500" :placeholder="t('slhBill.archive.remarkPlaceholder')" />
      </FaFormItem>
    </FaForm>
    <template #footer>
      <FaButton variant="outline" :disabled="locked" class="w-full sm:w-auto" @click="close()">
        {{ t('slhBill.cancel') }}
      </FaButton>
      <FaButton :loading="locked" :disabled="locked" class="w-full sm:w-auto" @click="formRef?.submit()">
        {{ t(locked ? 'slhBill.submitting' : 'slhBill.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
