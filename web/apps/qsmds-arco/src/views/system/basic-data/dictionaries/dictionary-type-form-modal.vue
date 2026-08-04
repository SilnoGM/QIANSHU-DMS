<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type {
  DictionaryTypeFormErrors,
  DictionaryTypeFormMode,
  DictionaryTypeFormModel,
  DictionaryTypeFormRebaseConflict,
} from './dictionary-type-form.logic'

import type {
  CreateDictionaryTypeRequestDto,
  DictionaryTypeDto,
  UpdateDictionaryTypeRequestDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  buildCreateDictionaryTypeRequest,
  buildUpdateDictionaryTypeRequest,
  createDictionaryTypeFormModel,
  hasDictionaryTypeFormChanges,
  rebaseDictionaryTypeFormModel,
  validateDictionaryTypeForm,
} from './dictionary-type-form.logic'

type ExternalFieldError = readonly string[] | string

defineOptions({ name: 'DictionaryTypeFormModal' })

const props = withDefaults(defineProps<{
  dictionaryType?: DictionaryTypeDto | null
  error?: string | null
  fieldErrors?: Readonly<Record<string, ExternalFieldError>>
  mode: DictionaryTypeFormMode
  modelValue: boolean
  requestId?: string | null
  submissionBlocked?: boolean
  submitting?: boolean
}>(), {
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
    | { mode: 'create', data: CreateDictionaryTypeRequestDto }
    | { mode: 'edit', typeId: string, data: UpdateDictionaryTypeRequestDto }]
}>()

const formRef = useTemplateRef<FormExpose<DictionaryTypeFormModel>>('formRef')
const form = reactive<DictionaryTypeFormModel>(
  createDictionaryTypeFormModel(props.mode, props.dictionaryType),
)
const localError = ref('')
const localFieldErrors = ref<DictionaryTypeFormErrors>({})
const formBase = shallowRef<DictionaryTypeDto | null>(null)
const rebaseConflicts = ref<readonly DictionaryTypeFormRebaseConflict[]>([])
const submitRequested = ref(false)

const isEditing = computed(() => props.mode === 'edit')
const submitLocked = computed(() => props.submitting || submitRequested.value)
const hasEditChanges = computed(() =>
  isEditing.value
  && props.dictionaryType !== null
  && hasDictionaryTypeFormChanges(form, props.dictionaryType))
const submitDisabled = computed(() =>
  submitLocked.value
  || props.submissionBlocked
  || (isEditing.value && props.dictionaryType === null)
  || (isEditing.value && !hasEditChanges.value))
const resolvedExternalFieldErrors = computed<DictionaryTypeFormErrors>(() => {
  const errors: DictionaryTypeFormErrors = {}
  const allowedFields = props.mode === 'create'
    ? ['code', 'description', 'name', 'sortOrder'] as const
    : ['description', 'name', 'sortOrder'] as const

  for (const field of allowedFields) {
    const value = props.fieldErrors?.[field]
    const candidate = Array.isArray(value) ? value[0] : value
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      errors[field] = candidate
    }
  }
  return errors
})
const visibleFieldErrors = computed<DictionaryTypeFormErrors>(() => ({
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

const rebaseConflictLabels: Readonly<
  Record<DictionaryTypeFormRebaseConflict['field'], string>
> = {
  description: '类型说明',
  name: '类型名称',
  sortOrder: '排序',
}

function replaceForm(next: DictionaryTypeFormModel): void {
  form.code = next.code
  form.description = next.description
  form.name = next.name
  form.sortOrder = next.sortOrder
}

async function applyFieldErrors(
  errors: DictionaryTypeFormErrors,
  focusFirst: boolean,
): Promise<void> {
  formRef.value?.clearValidate()
  const fields = props.mode === 'create'
    ? ['code', 'name', 'description', 'sortOrder'] as const
    : ['name', 'description', 'sortOrder'] as const

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
    // 等待错误节点完成渲染后再滚动并聚焦，避免 Modal 首帧找不到真实输入控件。
    await nextTick()
    formRef.value?.scrollToField(firstField)
  }
}

async function initializeForm(): Promise<void> {
  replaceForm(createDictionaryTypeFormModel(props.mode, props.dictionaryType))
  formBase.value = props.mode === 'edit' ? props.dictionaryType : null
  rebaseConflicts.value = []
  localError.value = isEditing.value && props.dictionaryType === null
    ? '字典类型资料不完整，请关闭弹窗后重试'
    : ''
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

async function submit(): Promise<void> {
  if (submitLocked.value || submitDisabled.value) {
    return
  }

  localError.value = ''
  localFieldErrors.value = validateDictionaryTypeForm(form, props.mode)
  await applyFieldErrors(visibleFieldErrors.value, true)
  if (Object.keys(localFieldErrors.value).length > 0) {
    localError.value = '部分字段未通过校验，请检查后重试'
    return
  }

  const editType = props.dictionaryType
  if (props.mode === 'edit' && editType === null) {
    localError.value = '字典类型资料不完整，请关闭弹窗后重试'
    return
  }

  /*
   * 本地锁覆盖 submit emit 到父页面 submitting 回写之间的同步窗口。编辑请求由
   * 当前 props.dictionaryType 构造，因此 409 刷新后会使用最新 expectedVersion，
   * 同时不重置用户仍在修正的字段。
   */
  submitRequested.value = true
  if (props.mode === 'create') {
    emit('submit', {
      mode: 'create',
      data: buildCreateDictionaryTypeRequest(form),
    })
  }
  else if (editType !== null) {
    emit('submit', {
      mode: 'edit',
      typeId: editType.id,
      data: buildUpdateDictionaryTypeRequest(form, editType),
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
  [() => props.mode, () => props.dictionaryType?.id],
  () => {
    if (props.modelValue) {
      void initializeForm()
    }
  },
)

watch(
  () => props.dictionaryType?.version,
  () => {
    const previous = formBase.value
    const latest = props.dictionaryType
    if (
      !props.modelValue
      || props.mode !== 'edit'
      || previous === null
      || latest === null
      || previous.id !== latest.id
      || previous.version === latest.version
    ) {
      return
    }

    const rebased = rebaseDictionaryTypeFormModel(form, previous, latest)
    replaceForm(rebased.model)
    formBase.value = latest
    rebaseConflicts.value = rebased.conflicts
    localFieldErrors.value = {}
    void nextTick(() => applyFieldErrors(visibleFieldErrors.value, false))
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
    :title="isEditing ? '编辑字典类型' : '新增字典类型'"
    :description="isEditing
      ? '类型编码是稳定身份，创建后不可修改。'
      : '新建类型默认停用，需配置可用条目后再显式启用。'"
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
      v-if="isEditing"
      class="mb-5"
      icon="i-lucide:lock-keyhole"
      title="类型编码已锁定"
      description="业务数据按 code 引用字典，编辑时只能修改名称、说明与排序。"
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
      class="gap-x-5 gap-y-4 grid grid-cols-1 sm:grid-cols-2"
      @submit="submit"
    >
      <FaFormItem
        name="code"
        label="类型编码"
        required
        description="使用带点的 ASCII namespace，例如 order.status。"
      >
        <FaInput
          v-model="form.code"
          autocomplete="off"
          autocapitalize="none"
          clearable
          class="font-mono w-full"
          input-class="min-h-11 sm:min-h-9"
          :disabled="isEditing || submitLocked"
          maxlength="64"
          placeholder="例如 order.status"
          spellcheck="false"
          @clear="form.code = ''"
        />
      </FaFormItem>

      <FaFormItem name="name" label="类型名称" required>
        <FaInput
          v-model="form.name"
          autocomplete="off"
          clearable
          class="w-full"
          input-class="min-h-11 sm:min-h-9"
          maxlength="256"
          placeholder="例如 订单状态"
          @clear="form.name = ''"
        />
      </FaFormItem>

      <FaFormItem
        name="description"
        label="类型说明"
        description="可选；清空后保存将移除原说明。"
        class="sm:col-span-2"
      >
        <FaTextarea
          v-model="form.description"
          class="w-full"
          input-class="min-h-24 max-h-56"
          maxlength="1000"
          placeholder="说明该字典类型的用途与维护边界"
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
        class="min-h-11 w-full sm:w-auto"
        :disabled="submitLocked"
        @click="close"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:w-auto"
        :disabled="submitDisabled"
        :loading="submitLocked"
        @click="submit"
      >
        {{ isEditing ? '保存修改' : '创建类型' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
