<script setup lang="ts">
import type { NumberingRuleEditorDrawerExpose, NumberingRuleEditorMode } from './numbering-editor.logic'
import type { NumberingRuleFormModel } from './numbering-management.logic'
import type { PreviewNumberingRuleResponseDto } from '@/api/generated/types.gen'
import type { QsGenericDrawerCloseReason } from '@/components/business/QsGenericDrawer/logic'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import { createNumberingEditorCloseBypass } from './numbering-editor.logic'
import NumberingRuleForm from './numbering-rule-form.vue'

defineOptions({ name: 'NumberingRuleEditorDrawer' })

const props = withDefaults(defineProps<{
  configurationLocked?: boolean
  error?: null | string
  fieldErrors?: Readonly<Record<string, string>>
  formModel: NumberingRuleFormModel
  hasIssuances?: boolean
  loading?: boolean
  mode: NumberingRuleEditorMode
  modelValue: boolean
  preview?: null | PreviewNumberingRuleResponseDto
  previewError?: null | string
  previewLoading?: boolean
  previewRequestId?: null | string
  requestId?: null | string
  submitting?: boolean
}>(), {
  configurationLocked: false,
  error: null,
  fieldErrors: () => ({}),
  hasIssuances: false,
  loading: false,
  preview: null,
  previewError: null,
  previewLoading: false,
  previewRequestId: null,
  requestId: null,
  submitting: false,
})

const emit = defineEmits<{
  'closeRequest': [context: { dirty: true, reason: QsGenericDrawerCloseReason }]
  'closed': []
  'preview': [model: NumberingRuleFormModel]
  'submit': [model: NumberingRuleFormModel]
  'update:formModel': [model: NumberingRuleFormModel]
  'update:modelValue': [value: boolean]
}>()
const formRef = useTemplateRef<InstanceType<typeof NumberingRuleForm>>('formRef')
const formProps = computed(() => {
  const { modelValue, ...rest } = props
  return { ...rest, active: modelValue }
})
const closeBypass = createNumberingEditorCloseBypass()
const dirty = computed(() => formRef.value?.dirty ?? false)
const submitLocked = computed(() => props.loading || props.submitting || (formRef.value?.submitLocked ?? false))
const title = computed(() => ({ clone: '克隆编号规则', create: '新建编号规则', edit: '编辑编号规则' })[props.mode])
const description = computed(() => ({
  clone: '来源配置由 Server 复制；这里只设置新规则身份。',
  create: '编排编号片段并以 Server 预览确认容量与下一编号。',
  edit: '修改后生成新的草稿版本；已发号规则由 Server 校验版本兼容性。',
})[props.mode])
const submitLabel = computed(() => ({ clone: '创建副本', create: '创建规则', edit: '保存草稿' })[props.mode])

function handleBeforeClose(reason: QsGenericDrawerCloseReason): boolean {
  if (closeBypass.consume()) {
    return true
  }
  if (submitLocked.value) {
    return false
  }
  if (!dirty.value) {
    return true
  }
  emit('closeRequest', { dirty: true, reason })
  return false
}
function requestClose(): void {
  if (!submitLocked.value) {
    emit('update:modelValue', false)
  }
}
function handleClosed(): void {
  formRef.value?.resetAfterClose()
  closeBypass.reset()
  emit('closed')
}
/** 放弃或保存成功时仅放行一次关闭；请求中的普通关闭仍然拒绝。 */
function closeWithoutDirtyGuard(): void {
  if (submitLocked.value) {
    return
  }
  closeBypass.arm()
  emit('update:modelValue', false)
}
/** 撤权优先于 dirty 和提交锁，不能把敏感表单留在原身份下。 */
function closeForAuthorityLoss(): void {
  closeBypass.arm()
  formRef.value?.resetSubmission()
  emit('update:modelValue', false)
}
defineExpose<NumberingRuleEditorDrawerExpose>({ closeForAuthorityLoss, closeWithoutDirtyGuard })
</script>

<template>
  <QsGenericDrawer
    :model-value="modelValue" :title="title" :description="description" size="xl"
    :before-close="handleBeforeClose" :submitting="submitLocked"
    @update:model-value="emit('update:modelValue', $event)" @closed="handleClosed"
  >
    <template #header-leading>
      <FaIcon :name="mode === 'clone' ? 'i-lucide:copy-plus' : 'i-lucide:binary'" />
    </template>
    <!-- 重读详情只隐藏表单，不能使用外壳 loading 分支卸载它，否则会丢失 dirty 基线。 -->
    <div v-if="loading" class="text-muted-foreground py-8 flex gap-2 items-center justify-center" role="status">
      <FaIcon name="i-lucide:loader-circle" class="size-4 animate-spin motion-reduce:animate-none" />
      正在读取编号规则
    </div>
    <NumberingRuleForm
      v-show="!loading"
      ref="formRef" v-bind="formProps"
      @update:form-model="emit('update:formModel', $event)"
      @preview="emit('preview', $event)" @submit="emit('submit', $event)"
    />
    <template #footer>
      <span v-if="dirty" class="qs-type-meta mr-auto" aria-live="polite">有未保存修改</span>
      <FaButton type="button" variant="outline" class="min-h-11 md:min-h-9" :disabled="submitLocked" @click="requestClose">
        取消
      </FaButton>
      <FaButton type="button" class="min-h-11 md:min-h-9" :loading="submitLocked" :disabled="submitLocked || !dirty" @click="formRef?.submit()">
        {{ submitLabel }}
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
