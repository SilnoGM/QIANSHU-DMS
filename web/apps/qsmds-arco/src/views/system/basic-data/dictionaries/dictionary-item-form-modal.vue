<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type {
  DictionaryItemFormErrors,
  DictionaryItemFormMode,
  DictionaryItemFormModel,
  DictionaryItemFormRebaseConflict,
  DictionaryItemTone,
} from './dictionary-item-form.logic'

import type {
  CreateDictionaryItemRequestDto,
  DictionaryItemDto,
  DictionaryTypeDto,
  UpdateDictionaryItemRequestDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  buildCreateDictionaryItemRequest,
  buildUpdateDictionaryItemRequest,
  createDictionaryItemFormModel,
  DICTIONARY_ITEM_TONES,
  hasDictionaryItemFormChanges,
  rebaseDictionaryItemFormModel,
  validateDictionaryItemForm,
} from './dictionary-item-form.logic'

type ExternalFieldError = readonly string[] | string

defineOptions({ name: 'DictionaryItemFormModal' })

const props = withDefaults(defineProps<{
  dictionaryItem?: DictionaryItemDto | null
  dictionaryType?: DictionaryTypeDto | null
  error?: string | null
  fieldErrors?: Readonly<Record<string, ExternalFieldError>>
  mode: DictionaryItemFormMode
  modelValue: boolean
  requestId?: string | null
  submissionBlocked?: boolean
  submitting?: boolean
}>(), {
  dictionaryItem: null,
  dictionaryType: null,
  error: null,
  fieldErrors: undefined,
  requestId: null,
  submissionBlocked: false,
  submitting: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'submit': [payload:
    | {
      mode: 'create'
      typeId: string
      data: CreateDictionaryItemRequestDto
    }
    | {
      mode: 'edit'
      typeId: string
      itemId: string
      data: UpdateDictionaryItemRequestDto
    }]
}>()

const formRef = useTemplateRef<FormExpose<DictionaryItemFormModel>>('formRef')
const form = reactive<DictionaryItemFormModel>(
  createDictionaryItemFormModel(props.mode, props.dictionaryItem),
)
const localError = ref('')
const localFieldErrors = ref<DictionaryItemFormErrors>({})
const formBase = shallowRef<DictionaryItemDto | null>(null)
const rebaseConflicts = ref<readonly DictionaryItemFormRebaseConflict[]>([])
const submitRequested = ref(false)

const toneOptions: Array<{ label: string, value: DictionaryItemTone }> = [
  { label: '默认', value: 'DEFAULT' },
  { label: '主要', value: 'PRIMARY' },
  { label: '成功', value: 'SUCCESS' },
  { label: '警告', value: 'WARNING' },
  { label: '危险', value: 'DANGER' },
  { label: '信息', value: 'INFO' },
]

const isEditing = computed(() => props.mode === 'edit')
const submitLocked = computed(() => props.submitting || submitRequested.value)
const contextIsValid = computed(() => {
  const dictionaryType = props.dictionaryType
  if (dictionaryType === null) {
    return false
  }
  if (!isEditing.value) {
    return true
  }
  const dictionaryItem = props.dictionaryItem
  return dictionaryItem !== null
    && dictionaryItem.dictionaryTypeId === dictionaryType.id
})
const hasEditChanges = computed(() =>
  isEditing.value
  && props.dictionaryItem !== null
  && hasDictionaryItemFormChanges(form, props.dictionaryItem))
const submitDisabled = computed(() =>
  submitLocked.value
  || props.submissionBlocked
  || !contextIsValid.value
  || (isEditing.value && !hasEditChanges.value))
const resolvedExternalFieldErrors = computed<DictionaryItemFormErrors>(() => {
  const errors: DictionaryItemFormErrors = {}
  const allowedFields = props.mode === 'create'
    ? ['value', 'label', 'description', 'tone', 'sortOrder'] as const
    : ['label', 'description', 'tone', 'sortOrder'] as const

  for (const field of allowedFields) {
    const value = props.fieldErrors?.[field]
    const candidate = Array.isArray(value) ? value[0] : value
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      errors[field] = candidate
    }
  }
  return errors
})
const visibleFieldErrors = computed<DictionaryItemFormErrors>(() => ({
  ...resolvedExternalFieldErrors.value,
  ...localFieldErrors.value,
}))
const visibleError = computed(() => {
  if (typeof props.error === 'string' && props.error.trim() !== '') {
    return props.error
  }
  if (localError.value !== '') {
    return localError.value
  }
  return Object.keys(resolvedExternalFieldErrors.value).length > 0
    ? '部分字段未通过校验，请检查后重试'
    : ''
})
const dictionaryTypeDisplay = computed(() => {
  const dictionaryType = props.dictionaryType
  return dictionaryType === null
    ? ''
    : `${dictionaryType.name} · ${dictionaryType.code}`
})

const rebaseConflictLabels: Readonly<
  Record<DictionaryItemFormRebaseConflict['field'], string>
> = {
  description: '条目说明',
  label: '条目标签',
  sortOrder: '排序',
  tone: '语义色调',
}

function replaceForm(next: DictionaryItemFormModel): void {
  form.value = next.value
  form.label = next.label
  form.description = next.description
  form.tone = next.tone
  form.sortOrder = next.sortOrder
}

function resolveContextError(): string {
  const dictionaryType = props.dictionaryType
  if (dictionaryType === null) {
    return '字典类型资料不完整，请关闭弹窗后重试'
  }
  if (!isEditing.value) {
    return ''
  }

  const dictionaryItem = props.dictionaryItem
  if (dictionaryItem === null) {
    return '字典条目资料不完整，请关闭弹窗后重试'
  }
  if (dictionaryItem.dictionaryTypeId !== dictionaryType.id) {
    return '字典条目不属于当前类型，已禁止保存'
  }
  return ''
}

async function applyFieldErrors(
  errors: DictionaryItemFormErrors,
  focusFirst: boolean,
): Promise<void> {
  formRef.value?.clearValidate()
  const fields = props.mode === 'create'
    ? ['value', 'label', 'description', 'tone', 'sortOrder'] as const
    : ['label', 'description', 'tone', 'sortOrder'] as const

  for (const field of fields) {
    const message = errors[field]
    if (message !== undefined) {
      formRef.value?.setFieldError(field, message)
    }
  }

  if (!focusFirst) {
    return
  }
  const firstField = fields.find(field => errors[field] !== undefined)
  if (firstField !== undefined) {
    // 等待错误节点渲染后再定位，避免 Modal 首帧时真实控件尚未存在。
    await nextTick()
    formRef.value?.scrollToField(firstField)
  }
}

async function initializeForm(): Promise<void> {
  replaceForm(createDictionaryItemFormModel(props.mode, props.dictionaryItem))
  formBase.value = props.mode === 'edit' ? props.dictionaryItem : null
  rebaseConflicts.value = []
  localError.value = resolveContextError()
  localFieldErrors.value = {}
  submitRequested.value = false
  await nextTick()
  await applyFieldErrors(visibleFieldErrors.value, true)
}

function close(): void {
  if (submitLocked.value) {
    return
  }
  emit('update:modelValue', false)
}

function handleModalVisibleChange(visible: boolean): void {
  if (visible) {
    emit('update:modelValue', true)
    return
  }
  close()
}

function handleTone(value: unknown): void {
  if (DICTIONARY_ITEM_TONES.includes(value as DictionaryItemTone)) {
    form.tone = value as DictionaryItemTone
  }
}

async function submit(): Promise<void> {
  if (submitLocked.value || submitDisabled.value) {
    return
  }

  localError.value = resolveContextError()
  if (localError.value !== '') {
    return
  }
  localFieldErrors.value = validateDictionaryItemForm(form, props.mode)
  await applyFieldErrors(visibleFieldErrors.value, true)
  if (Object.keys(localFieldErrors.value).length > 0) {
    localError.value = '部分字段未通过校验，请检查后重试'
    return
  }

  const dictionaryType = props.dictionaryType
  if (dictionaryType === null) {
    localError.value = '字典类型资料不完整，请关闭弹窗后重试'
    return
  }
  const editItem = props.dictionaryItem
  if (
    props.mode === 'edit'
    && (
      editItem === null
      || editItem.dictionaryTypeId !== dictionaryType.id
    )
  ) {
    localError.value = resolveContextError()
    return
  }

  /*
   * 本地锁覆盖 submit emit 到父页面 submitting 回写之间的同步窗口。
   * 归属与稳定 value 都不进入 PATCH；409 刷新后使用最新 version 重建请求。
   */
  submitRequested.value = true
  if (props.mode === 'create') {
    emit('submit', {
      mode: 'create',
      typeId: dictionaryType.id,
      data: buildCreateDictionaryItemRequest(form),
    })
  }
  else if (editItem !== null) {
    emit('submit', {
      mode: 'edit',
      typeId: dictionaryType.id,
      itemId: editItem.id,
      data: buildUpdateDictionaryItemRequest(form, editItem),
    })
  }

  await nextTick()
  if (!props.submitting) {
    submitRequested.value = false
  }
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      void initializeForm()
      return
    }
    localError.value = ''
    localFieldErrors.value = {}
    formBase.value = null
    rebaseConflicts.value = []
    submitRequested.value = false
    formRef.value?.clearValidate()
  },
  { immediate: true },
)

watch(
  [
    () => props.mode,
    () => props.dictionaryType?.id,
    () => props.dictionaryItem?.id,
  ],
  () => {
    if (props.modelValue) {
      void initializeForm()
    }
  },
)

watch(
  () => props.dictionaryItem?.version,
  () => {
    const previous = formBase.value
    const latest = props.dictionaryItem
    const dictionaryType = props.dictionaryType
    if (
      !props.modelValue
      || props.mode !== 'edit'
      || previous === null
      || latest === null
      || dictionaryType === null
      || previous.id !== latest.id
      || latest.dictionaryTypeId !== dictionaryType.id
      || previous.version === latest.version
    ) {
      return
    }

    const rebased = rebaseDictionaryItemFormModel(form, previous, latest)
    replaceForm(rebased.model)
    formBase.value = latest
    rebaseConflicts.value = rebased.conflicts
    localFieldErrors.value = {}
    void nextTick().then(() =>
      applyFieldErrors(visibleFieldErrors.value, false),
    )
  },
)

watch(
  () => props.fieldErrors,
  () => {
    if (props.modelValue) {
      void applyFieldErrors(visibleFieldErrors.value, true)
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
  <QsGenericModal
    v-if="modelValue"
    :model-value="modelValue"
    :title="isEditing ? '编辑字典条目' : '新增字典条目'"
    :description="isEditing
      ? '所属类型与条目值是稳定身份，创建后不可修改。'
      : '新建条目默认停用，请核对展示与语义后再显式启用。'"
    size="lg"
    :submitting="submitLocked"
    @update:model-value="handleModalVisibleChange"
  >
    <FaAlert
      v-if="visibleError"
      class="mb-5"
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
      class="mb-5"
      icon="i-lucide:lock-keyhole"
      title="所属类型已锁定"
      :description="isEditing
        ? '编辑时只能修改标签、说明、语义色调与排序。'
        : '条目创建后不能移动到其他字典类型。'"
    />

    <FaAlert
      v-if="rebaseConflicts.length > 0"
      class="mb-5"
      icon="i-lucide:git-compare-arrows"
      title="并发字段需要核对"
      role="alert"
    >
      <template #description>
        <p class="qs-type-body m-0">
          未编辑字段已采用服务器最新值；以下字段双方都已修改，当前保留你的输入：
        </p>
        <ul class="mb-0 mt-2 pl-5 gap-1 grid">
          <li v-for="conflict in rebaseConflicts" :key="conflict.field">
            <strong>{{ rebaseConflictLabels[conflict.field] }}</strong>
            <span class="text-muted-foreground"> · 服务器最新值：</span>
            <span class="break-all">{{ conflict.latestValue }}</span>
          </li>
        </ul>
      </template>
    </FaAlert>

    <FaForm
      ref="formRef"
      :model="form"
      :disabled="submitLocked"
      class="dictionary-item-form-modal-surface gap-x-5 gap-y-4 grid grid-cols-1 sm:grid-cols-2"
      @submit="submit"
    >
      <FaFormItem
        name="dictionaryType"
        :auto-bind="false"
        label="所属类型"
        description="Type 由当前配置目录确定。"
      >
        <!-- 该字段只展示当前目录上下文，不属于可提交 model，禁止 FormItem 覆盖显式值。 -->
        <FaInput
          :model-value="dictionaryTypeDisplay"
          class="font-mono w-full"
          input-class="min-h-11 sm:min-h-9"
          disabled
          readonly
        />
      </FaFormItem>

      <FaFormItem
        name="value"
        label="条目值"
        required
        description="业务数据持久化的稳定值，创建后不可修改。"
      >
        <FaInput
          v-model="form.value"
          autocomplete="off"
          autocapitalize="characters"
          clearable
          class="font-mono w-full uppercase"
          input-class="min-h-11 sm:min-h-9"
          :disabled="isEditing || submitLocked"
          maxlength="64"
          placeholder="例如 PENDING"
          spellcheck="false"
          @clear="form.value = ''"
        />
      </FaFormItem>

      <FaFormItem name="label" label="条目标签" required>
        <FaInput
          v-model="form.label"
          autocomplete="off"
          clearable
          class="w-full"
          input-class="min-h-11 sm:min-h-9"
          maxlength="256"
          placeholder="例如 待处理"
          @clear="form.label = ''"
        />
      </FaFormItem>

      <FaFormItem
        name="tone"
        label="语义色调"
        required
        description="仅表达当前 UI 语义，不存储任意颜色或样式。"
      >
        <FaSelect
          :model-value="form.tone"
          :options="toneOptions"
          :disabled="submitLocked"
          class="min-h-11 w-full sm:min-h-9"
          @update:model-value="handleTone"
        />
      </FaFormItem>

      <FaFormItem
        name="description"
        label="条目说明"
        description="可选；清空后保存将移除原说明。"
        class="sm:col-span-2"
      >
        <FaTextarea
          v-model="form.description"
          class="w-full"
          input-class="min-h-24 max-h-56"
          maxlength="1000"
          placeholder="说明条目的业务含义与使用边界"
        />
      </FaFormItem>

      <FaFormItem
        name="sortOrder"
        label="排序"
        required
        description="数值越小越靠前。"
      >
        <FaInput
          v-model="form.sortOrder"
          autocomplete="off"
          clearable
          class="w-full"
          input-class="min-h-11 sm:min-h-9"
          inputmode="numeric"
          max="2147483647"
          min="0"
          placeholder="0 到 2147483647"
          step="1"
          type="number"
          @clear="form.sortOrder = ''"
        />
      </FaFormItem>
    </FaForm>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitLocked"
        @click="close"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitDisabled"
        :loading="submitLocked"
        @click="submit"
      >
        {{ isEditing ? '保存修改' : '创建条目' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>

<style scoped>
@media (width <= 767px) {
  /*
   * FaSelect 的选项列表 Teleport 到 body。用本字典条目表单中已展开的 trigger
   * 作为归属条件，只扩大 Tone 选择器的选项，不修改 FaSelect 的公共契约。
   */
  :global(body:has(.dictionary-item-form-modal-surface [data-slot="select-trigger"][aria-expanded="true"]) [data-slot="select-content"] [role="option"]) {
    min-height: 2.75rem;
  }
}
</style>
