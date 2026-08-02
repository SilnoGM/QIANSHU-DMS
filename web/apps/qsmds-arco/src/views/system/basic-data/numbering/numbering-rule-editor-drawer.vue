<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type {
  NumberingRuleEditorDrawerExpose,
  NumberingRuleEditorMode,
} from './numbering-editor.logic'
import type { NumberingRuleFormModel } from './numbering-management.logic'
import type { PreviewNumberingRuleResponseDto } from '@/api/generated/types.gen'

import type { QsGenericDrawerCloseReason } from '@/components/business/QsGenericDrawer/logic'

import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import {
  cloneNumberingRuleFormModel,
  createNumberingEditorCloseBypass,
  isNumberingRuleFormDirty,
  resolveNumberingEditorFieldErrors,
} from './numbering-editor.logic'
import { validateNumberingRuleForm } from './numbering-management.logic'
import NumberingRulePreview from './numbering-rule-preview.vue'
import NumberingSegmentEditor from './numbering-segment-editor.vue'

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
  'closeRequest': [context: {
    dirty: true
    reason: QsGenericDrawerCloseReason
  }]
  'closed': []
  'preview': [model: NumberingRuleFormModel]
  'submit': [model: NumberingRuleFormModel]
  'update:formModel': [model: NumberingRuleFormModel]
  'update:modelValue': [value: boolean]
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
const closeBypass = createNumberingEditorCloseBypass()
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

const description = computed(() => ({
  clone: '来源配置由 Server 复制；这里只设置新规则身份。',
  create: '编排编号片段并以 Server 预览确认容量与下一编号。',
  edit: '修改后生成新的草稿版本；已发号规则由 Server 校验版本兼容性。',
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
const submitLabel = computed(() => ({
  clone: '创建副本',
  create: '创建规则',
  edit: '保存草稿',
})[props.mode])
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

function emitPreviewIfValid(model: NumberingRuleFormModel): void {
  if (Object.keys(validateNumberingRuleForm(model)).length === 0) {
    // 节流、AbortController 与乱序保护由持有 preview API 的父页面负责。
    emit('preview', cloneNumberingRuleFormModel(model))
  }
}

async function initialize(): Promise<void> {
  replaceForm(props.formModel)
  baseline.value = cloneNumberingRuleFormModel(props.formModel)
  localErrors.value = {}
  validationAttempted.value = false
  submitRequested.value = false
  closeBypass.reset()
  await nextTick()
  await applyFieldErrors(props.fieldErrors, true)
  emitPreviewIfValid(form)
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

async function handleBeforeClose(
  reason: QsGenericDrawerCloseReason,
): Promise<boolean> {
  if (closeBypass.consume()) {
    return true
  }
  if (submitLocked.value) {
    return false
  }
  if (!dirty.value) {
    return true
  }

  // 父页面收到后展示同级 QsGenericModal；本次关闭保持拒绝，等待显式确认。
  emit('closeRequest', { dirty: true, reason })
  return false
}

function requestClose(): void {
  if (!submitLocked.value) {
    emit('update:modelValue', false)
  }
}

function handleVisibleChange(visible: boolean): void {
  emit('update:modelValue', visible)
}

function handleClosed(): void {
  /*
   * 只在 Drawer 真实完成关闭后清理。dirty 的受控关闭会短暂收到 false，再被
   * QsGenericDrawer 回写 true；若在那个阶段重置 baseline，会错误丢失关闭保护。
   */
  initializedForCurrentOpen = false
  localErrors.value = {}
  validationAttempted.value = false
  submitRequested.value = false
  closeBypass.reset()
  formRef.value?.clearValidate()
  emit('closed')
}

/**
 * 只供两种已确认场景调用：用户确认放弃修改，或 mutation 成功且 submitting 已解除。
 * 方法 arm 一次旁路并在同一调用中请求关闭，下一次 beforeClose 消费后自动失效。
 */
function closeWithoutDirtyGuard(): void {
  if (submitLocked.value) {
    return
  }
  closeBypass.arm()
  emit('update:modelValue', false)
}

/**
 * 身份切换或动态撤权属于安全边界，不得被提交锁或 dirty guard 阻止。
 * mutation 本身不能安全取消，父页面会先废弃其 operation generation；这里只负责
 * arm 一次关闭旁路并立即移除敏感表单上下文。
 */
function closeForAuthorityLoss(): void {
  closeBypass.arm()
  submitRequested.value = false
  emit('update:modelValue', false)
}

defineExpose<NumberingRuleEditorDrawerExpose>({
  closeForAuthorityLoss,
  closeWithoutDirtyGuard,
})

watch(
  form,
  async () => {
    if (replacingForm.value || !props.modelValue) {
      return
    }

    const isolated = cloneNumberingRuleFormModel(form)
    if (validationAttempted.value) {
      localErrors.value = validateNumberingRuleForm(isolated)
      await applyFieldErrors(visibleFieldErrors.value, false)
    }
    emit('update:formModel', isolated)
    emitPreviewIfValid(isolated)
  },
  { deep: true, flush: 'sync' },
)

watch(
  () => props.formModel,
  (next) => {
    if (
      props.modelValue
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
  () => props.modelValue,
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
    if (props.modelValue && initializedForCurrentOpen) {
      void initialize()
    }
  },
)

watch(
  () => props.fieldErrors,
  (errors) => {
    if (props.modelValue) {
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
  <QsGenericDrawer
    :model-value="modelValue"
    :title="title"
    :description="description"
    size="xl"
    :before-close="handleBeforeClose"
    :loading="loading"
    :submitting="submitLocked"
    @update:model-value="handleVisibleChange"
    @closed="handleClosed"
  >
    <template #header-leading>
      <FaIcon :name="mode === 'clone' ? 'i-lucide:copy-plus' : 'i-lucide:binary'" />
    </template>

    <div
      class="gap-6 grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.72fr)] lg:items-start"
    >
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

        <div class="p-4 border border-border rounded-lg bg-muted/25">
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

      <aside class="min-w-0 lg:top-4 lg:sticky">
        <NumberingRulePreview
          :preview="preview"
          :loading="previewLoading"
          :error="previewError"
          :request-id="previewRequestId"
        />
      </aside>
    </div>

    <template #footer>
      <span v-if="dirty" class="qs-type-meta mr-auto" aria-live="polite">
        有未保存修改
      </span>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 md:min-h-9"
        :disabled="submitLocked"
        @click="requestClose"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 md:min-h-9"
        :loading="submitLocked"
        :disabled="submitDisabled"
        @click="submit"
      >
        {{ submitLabel }}
      </FaButton>
    </template>
  </QsGenericDrawer>
</template>
