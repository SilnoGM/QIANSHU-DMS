<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type {
  NumberingRuleEditorMode,
} from './numbering-editor.logic'
import type { NumberingRuleFormModel } from './numbering-management.logic'
import type { PreviewNumberingRuleResponseDto } from '@/api/generated/types.gen'

import {
  cloneNumberingRuleFormModel,
  isNumberingRuleFormDirty,
  resolveNumberingEditorFieldErrors,
} from './numbering-editor.logic'
import { validateNumberingRuleForm } from './numbering-management.logic'
import NumberingRulePreview from './numbering-rule-preview.vue'
import NumberingSegmentEditor from './numbering-segment-editor.vue'

defineOptions({ name: 'NumberingRuleForm' })

const props = withDefaults(defineProps<{
  configurationLocked?: boolean
  error?: null | string
  fieldErrors?: Readonly<Record<string, string>>
  formModel: NumberingRuleFormModel
  hasIssuances?: boolean
  loading?: boolean
  mode: NumberingRuleEditorMode
  active?: boolean
  layout?: 'page' | 'drawer'
  preview?: null | PreviewNumberingRuleResponseDto
  previewError?: null | string
  previewLoading?: boolean
  previewRequestId?: null | string
  requestId?: null | string
  submitting?: boolean
}>(), {
  active: true,
  layout: 'drawer',
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
  'preview': [model: NumberingRuleFormModel]
  'submit': [model: NumberingRuleFormModel]
  'update:formModel': [model: NumberingRuleFormModel]
}>()

const formRef = useTemplateRef<FormExpose<NumberingRuleFormModel>>('formRef')
const form = reactive<NumberingRuleFormModel>(
  cloneNumberingRuleFormModel(props.formModel),
)
const baseline = ref(cloneNumberingRuleFormModel(props.formModel))
const localErrors = ref<Readonly<Record<string, string>>>({})
const validationAttempted = ref(false)
const submitRequested = ref(false)
const replacingForm = ref(false)
let initializedForCurrentOpen = false

const RESET_POLICY_OPTIONS: Array<{
  label: string
  value: NumberingRuleFormModel['resetPolicy']
}> = [
  { label: '不重置', value: 'NEVER' },
  { label: '每年重置', value: 'YEARLY' },
  { label: '每月重置', value: 'MONTHLY' },
  { label: '每日重置', value: 'DAILY' },
]

const title = computed(() => ({
  clone: '克隆编号规则',
  create: '新建编号规则',
  edit: '编辑编号规则',
})[props.mode])

const submitLocked = computed(() =>
  props.loading || props.submitting || submitRequested.value)
const effectiveConfigurationLocked = computed(() =>
  props.mode === 'clone' || props.configurationLocked)
const dirty = computed(() => isNumberingRuleFormDirty(form, baseline.value))
const visibleFieldErrors = computed(() => resolveNumberingEditorFieldErrors(
  localErrors.value,
  props.fieldErrors,
))
const visibleError = computed(() => {
  if (typeof props.error === 'string' && props.error.trim() !== '') {
    return props.error
  }
  return Object.keys(visibleFieldErrors.value).length > 0
    ? '部分字段未通过校验，请检查后重试'
    : ''
})
const submitDisabled = computed(() => submitLocked.value || !dirty.value)

function replaceForm(next: Readonly<NumberingRuleFormModel>): void {
  const isolated = cloneNumberingRuleFormModel(next)
  replacingForm.value = true
  form.description = isolated.description
  form.name = isolated.name
  form.resetPolicy = isolated.resetPolicy
  form.ruleCode = isolated.ruleCode
  form.segments = isolated.segments
  replacingForm.value = false
}

function isTopLevelField(
  field: string,
): field is keyof NumberingRuleFormModel {
  return field === 'description'
    || field === 'name'
    || field === 'resetPolicy'
    || field === 'ruleCode'
    || field === 'segments'
}

async function applyFieldErrors(
  errors: Readonly<Record<string, string>>,
  focusFirst: boolean,
): Promise<void> {
  formRef.value?.clearValidate()
  const topLevelErrors = Object.entries(errors)
    .filter(([field]) => isTopLevelField(field))

  for (const [field, message] of topLevelErrors) {
    formRef.value?.setFieldError(field as keyof NumberingRuleFormModel, message)
  }

  if (focusFirst && topLevelErrors[0] !== undefined) {
    await nextTick()
    formRef.value?.scrollToField(
      topLevelErrors[0][0] as keyof NumberingRuleFormModel,
    )
  }
}

async function initialize(): Promise<void> {
  replaceForm(props.formModel)
  baseline.value = cloneNumberingRuleFormModel(props.formModel)
  localErrors.value = {}
  validationAttempted.value = false
  submitRequested.value = false
  await nextTick()
  await applyFieldErrors(props.fieldErrors, true)
  // 父页面统一校验 Preview DTO，并负责清空无效快照及取消旧请求。
  emit('preview', cloneNumberingRuleFormModel(form))
}

function handleResetPolicy(value: unknown): void {
  if (RESET_POLICY_OPTIONS.some(option => option.value === value)) {
    form.resetPolicy = value as NumberingRuleFormModel['resetPolicy']
  }
}

function updateSegments(segments: NumberingRuleFormModel['segments']): void {
  form.segments = segments.map(segment => ({ ...segment }))
}

async function submit(): Promise<void> {
  if (submitDisabled.value) {
    return
  }

  validationAttempted.value = true
  localErrors.value = validateNumberingRuleForm(form)
  await applyFieldErrors(visibleFieldErrors.value, true)
  if (Object.keys(localErrors.value).length > 0) {
    return
  }

  /*
   * 本地锁覆盖父 props 更新前的同步窗口，避免双击造成两个 mutation。父页面成功后
   * 必须先把 submitting 设为 false，await nextTick，再调用 closeWithoutDirtyGuard。
   */
  submitRequested.value = true
  emit('submit', cloneNumberingRuleFormModel(form))
  await nextTick()
  if (!props.submitting) {
    submitRequested.value = false
  }
}

/** 壳组件只在真实关闭后清理，受控关闭被拒绝时不得重置 dirty 基线。 */
function resetAfterClose(): void {
  initializedForCurrentOpen = false
  localErrors.value = {}
  validationAttempted.value = false
  submitRequested.value = false
  formRef.value?.clearValidate()
}

defineExpose({
  dirty,
  submitLocked,
  submit,
  resetAfterClose,
  resetSubmission: () => { submitRequested.value = false },
})

watch(
  form,
  async () => {
    if (replacingForm.value || !props.active) {
      return
    }

    const isolated = cloneNumberingRuleFormModel(form)
    if (validationAttempted.value) {
      localErrors.value = validateNumberingRuleForm(isolated)
      await applyFieldErrors(visibleFieldErrors.value, false)
    }
    emit('update:formModel', isolated)
  },
  { deep: true, flush: 'sync' },
)

watch(
  () => [form.resetPolicy, form.segments] as const,
  () => {
    if (replacingForm.value || !props.active) {
      return
    }

    // Preview DTO 只包含重置周期与片段，身份及说明字段变化不得重复请求。
    emit('preview', cloneNumberingRuleFormModel(form))
  },
  { deep: true, flush: 'sync' },
)

watch(
  () => props.formModel,
  (next) => {
    if (
      props.active
      && isNumberingRuleFormDirty(form, next)
    ) {
      replaceForm(next)
      baseline.value = cloneNumberingRuleFormModel(next)
      localErrors.value = {}
      validationAttempted.value = false
      void nextTick(() => applyFieldErrors(props.fieldErrors, true))
    }
  },
  { deep: true },
)

watch(
  () => props.active,
  (visible) => {
    if (visible && !initializedForCurrentOpen) {
      initializedForCurrentOpen = true
      void initialize()
    }
  },
  { immediate: true },
)

watch(
  () => props.mode,
  () => {
    if (props.active && initializedForCurrentOpen) {
      void initialize()
    }
  },
)

watch(
  () => props.fieldErrors,
  (errors) => {
    if (props.active) {
      void applyFieldErrors(resolveNumberingEditorFieldErrors(
        localErrors.value,
        errors,
      ), true)
    }
  },
  { deep: true },
)

watch(
  () => props.submitting,
  (submitting) => {
    if (!submitting) {
      submitRequested.value = false
    }
  },
)
</script>

<template>
  <div class="gap-6 grid min-w-0" :class="layout === 'page' ? 'xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]' : ''">
    <div class="gap-6 grid min-w-0">
      <FaAlert
        v-if="visibleError"
        icon="i-lucide:circle-alert"
        title="保存失败"
        variant="destructive"
        role="alert"
      >
        <template #description>
          <div class="gap-2 grid">
            <span>{{ visibleError }}</span>
            <code v-if="requestId" class="qs-type-meta break-all">
              requestId: {{ requestId }}
            </code>
          </div>
        </template>
      </FaAlert>

      <FaAlert
        v-if="mode === 'clone'"
        icon="i-lucide:copy-check"
        title="来源配置只读"
        description="来源配置由 Server 复制，只可改 code/name/description。"
      />

      <FaAlert
        v-else-if="mode === 'edit' && configurationLocked"
        icon="i-lucide:lock-keyhole"
        title="配置维护已锁定"
        description="当前规则配置被明确标记为只读；规则编码与结构不可修改，名称与说明仍可修改。"
      />

      <FaAlert
        v-if="mode === 'edit' && hasIssuances"
        icon="i-lucide:shield-check"
        title="Server 将校验版本兼容性"
        description="该规则已有发号记录。Server 只接受名称、说明或自增数字位数扩大；仍可编辑配置，预览与保存时会拒绝不兼容修改。"
      />

      <div v-if="layout === 'drawer'" class="p-4 border border-border rounded-lg bg-muted/25">
        <dl class="m-0 gap-3 grid grid-cols-1 min-[390px]:grid-cols-2">
          <div>
            <dt class="qs-type-compact-label mb-1">
              规则模式
            </dt>
            <dd class="qs-type-body m-0">
              {{ title }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              统计时区
            </dt>
            <dd class="qs-type-data-emphasis m-0">
              Asia/Shanghai
            </dd>
          </div>
        </dl>
      </div>

      <FaForm
        ref="formRef"
        :model="form"
        :disabled="submitLocked"
        class="gap-5 grid"
        @submit="submit"
      >
        <div class="gap-x-4 gap-y-4 grid grid-cols-1 sm:grid-cols-2">
          <FaFormItem
            name="ruleCode"
            label="规则编码"
            description="Rule Code，供后续业务域稳定调用；创建后不可修改。"
            required
          >
            <FaInput
              v-model="form.ruleCode"
              autocapitalize="characters"
              autocomplete="off"
              class="font-mono w-full uppercase"
              :disabled="mode === 'edit' || submitLocked"
              maxlength="64"
              placeholder="例如 SALES_ORDER"
              spellcheck="false"
              @clear="form.ruleCode = ''"
            />
          </FaFormItem>

          <FaFormItem name="name" label="规则名称" required>
            <FaInput
              v-model="form.name"
              autocomplete="off"
              class="w-full"
              :disabled="submitLocked"
              placeholder="例如 销售订单编号"
              @clear="form.name = ''"
            />
          </FaFormItem>

          <FaFormItem
            name="resetPolicy"
            label="重置周期"
            description="周期边界固定按 Asia/Shanghai 计算。"
            required
          >
            <FaSelect
              :model-value="form.resetPolicy"
              :options="RESET_POLICY_OPTIONS"
              :disabled="submitLocked || effectiveConfigurationLocked"
              class="w-full"
              @update:model-value="handleResetPolicy"
            />
          </FaFormItem>

          <FaFormItem name="description" label="说明">
            <FaInput
              v-model="form.description"
              autocomplete="off"
              class="w-full"
              :disabled="submitLocked"
              placeholder="说明适用业务域与调用场景"
              @clear="form.description = ''"
            />
          </FaFormItem>
        </div>

        <!--
            复合片段编辑器内部包含多个原生控件，必须关闭 FormItem 的事件自动绑定；
            否则冒泡的 input/change 会被误判为整个 segments 字段值并覆盖数组。
          -->
        <FaFormItem name="segments" hide-label :auto-bind="false">
          <NumberingSegmentEditor
            :model-value="form.segments"
            :disabled="submitLocked || effectiveConfigurationLocked"
            :errors="visibleFieldErrors"
            @update:model-value="updateSegments"
          />
        </FaFormItem>
      </FaForm>
    </div>

    <aside class="min-w-0" :class="layout === 'page' ? 'numbering-page-preview xl:sticky xl:top-4 xl:self-start' : ''">
      <NumberingRulePreview
        :preview="preview"
        :loading="previewLoading"
        :error="previewError"
        :request-id="previewRequestId"
      />
    </aside>
  </div>
</template>

<style scoped>
/* 新增页右侧只有约三分之一宽度，统计按两列展示，避免沿用视口断点挤成四列。 */
.numbering-page-preview :deep(dl) {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
</style>
