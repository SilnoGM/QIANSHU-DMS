<script setup lang="ts">
import type { FormExpose } from '@fantastic-admin/components'
import type { CurrencyFormErrors, CurrencyFormMode, CurrencyFormModel } from './currency-management.logic'

import type {
  CreateCurrencyRequestDto,
  CurrencyDto,
  UpdateCurrencyRequestDto,
} from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  buildCreateCurrencyRequest,
  buildUpdateCurrencyRequest,
  createCurrencyFormModel,

  hasCurrencyFormChanges,
  validateCurrencyForm,
} from './currency-management.logic'

defineOptions({ name: 'CurrencyFormModal' })

const props = withDefaults(defineProps<{
  error?: string
  fieldErrors?: Readonly<Record<string, string>>
  mode: CurrencyFormMode
  modelValue: boolean
  requestId?: string
  submitting?: boolean
  currency?: CurrencyDto | null
}>(), {
  error: '',
  fieldErrors: undefined,
  requestId: undefined,
  submitting: false,
  currency: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'submit': [payload:
    | { mode: 'create', data: CreateCurrencyRequestDto }
    | { mode: 'edit', currencyId: string, data: UpdateCurrencyRequestDto }]
}>()

const formRef = useTemplateRef<FormExpose<CurrencyFormModel>>('formRef')
const form = reactive<CurrencyFormModel>(createCurrencyFormModel(props.mode, props.currency))
const localErrors = ref<CurrencyFormErrors>({})
const localError = ref('')
const submitRequested = ref(false)

const isEditing = computed(() => props.mode === 'edit')
const submitLocked = computed(() => props.submitting || submitRequested.value)
const changed = computed(() =>
  props.mode === 'create'
  || (props.currency !== null && hasCurrencyFormChanges(form, props.currency)))
const submitDisabled = computed(() =>
  submitLocked.value
  || !changed.value
  || (isEditing.value && props.currency === null))
const visibleError = computed(() => props.error || localError.value)

function replaceForm(next: CurrencyFormModel): void {
  form.code = next.code
  form.englishName = next.englishName
  form.minorUnit = next.minorUnit
  form.name = next.name
  form.sortOrder = next.sortOrder
  form.symbol = next.symbol
}

async function applyFieldErrors(errors: Readonly<Record<string, string>>): Promise<void> {
  formRef.value?.clearValidate()
  for (const [field, message] of Object.entries(errors)) {
    formRef.value?.setFieldError(field as keyof CurrencyFormModel, message)
  }
  if (Object.keys(errors).length > 0) {
    await nextTick()
    formRef.value?.scrollToField(Object.keys(errors)[0] as keyof CurrencyFormModel)
  }
}

async function initialize(): Promise<void> {
  replaceForm(createCurrencyFormModel(props.mode, props.currency))
  localErrors.value = {}
  localError.value = props.mode === 'edit' && props.currency === null
    ? '货币资料不完整，请关闭弹窗后重试'
    : ''
  submitRequested.value = false
  await nextTick()
  await applyFieldErrors(props.fieldErrors ?? {})
}

function close(): void {
  if (submitLocked.value) {
    return
  }
  emit('update:modelValue', false)
}

async function submit(): Promise<void> {
  if (submitDisabled.value) {
    return
  }

  localError.value = ''
  localErrors.value = validateCurrencyForm(form, props.mode)
  await applyFieldErrors({
    ...(props.fieldErrors ?? {}),
    ...localErrors.value,
  })
  if (Object.keys(localErrors.value).length > 0) {
    localError.value = '部分字段未通过校验，请检查后重试'
    return
  }

  submitRequested.value = true
  if (props.mode === 'create') {
    emit('submit', {
      mode: 'create',
      data: buildCreateCurrencyRequest(form),
    })
  }
  else if (props.currency !== null) {
    emit('submit', {
      mode: 'edit',
      currencyId: props.currency.id,
      data: buildUpdateCurrencyRequest(form, props.currency),
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
      void initialize()
      return
    }
    localErrors.value = {}
    localError.value = ''
    submitRequested.value = false
    formRef.value?.clearValidate()
  },
  { immediate: true },
)

watch(
  () => props.currency,
  () => {
    if (props.modelValue) {
      void initialize()
    }
  },
)

watch(
  () => props.fieldErrors,
  (fieldErrors) => {
    if (props.modelValue) {
      void applyFieldErrors(fieldErrors ?? {})
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
    :model-value="modelValue"
    :title="isEditing ? '编辑货币' : '新增货币'"
    :description="isEditing
      ? '货币代码与系统金额小数位创建后不可修改。'
      : '新增货币默认停用；非人民币货币配置当前汇率后才能启用。'"
    size="lg"
    :submitting="submitLocked"
    @update:model-value="visible => visible ? emit('update:modelValue', true) : close()"
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
      title="固定字段"
      description="货币代码与系统金额小数位已被业务金额引用，创建后保持只读。"
    />

    <FaForm
      ref="formRef"
      :model="form"
      :disabled="submitLocked"
      class="gap-x-5 gap-y-4 grid grid-cols-1 sm:grid-cols-2"
      @submit="submit"
    >
      <FaFormItem name="code" label="货币代码" required>
        <FaInput
          v-model="form.code"
          autocomplete="off"
          autocapitalize="characters"
          class="font-mono w-full uppercase"
          :disabled="isEditing || submitLocked"
          maxlength="3"
          placeholder="例如 USD"
          spellcheck="false"
          @clear="form.code = ''"
        />
      </FaFormItem>

      <FaFormItem
        name="minorUnit"
        label="系统金额小数位"
        required
        description="限定金额录入、存储与展示精度，范围 0..4；它不是汇率精度。"
      >
        <FaInput
          v-model="form.minorUnit"
          class="w-full"
          :disabled="isEditing || submitLocked"
          inputmode="numeric"
          min="0"
          max="4"
          step="1"
          type="number"
          placeholder="0 到 4"
          @clear="form.minorUnit = ''"
        />
      </FaFormItem>

      <FaFormItem name="name" label="货币名称" required>
        <FaInput
          v-model="form.name"
          autocomplete="off"
          class="w-full"
          placeholder="例如 美元"
          @clear="form.name = ''"
        />
      </FaFormItem>

      <FaFormItem name="englishName" label="英文名称">
        <FaInput
          v-model="form.englishName"
          autocomplete="off"
          class="w-full"
          placeholder="例如 US Dollar"
          @clear="form.englishName = ''"
        />
      </FaFormItem>

      <FaFormItem name="symbol" label="货币符号" description="仅用于展示，不作为货币唯一标识。">
        <FaInput
          v-model="form.symbol"
          autocomplete="off"
          class="w-full"
          placeholder="例如 $"
          @clear="form.symbol = ''"
        />
      </FaFormItem>

      <FaFormItem name="sortOrder" label="排序" required>
        <FaInput
          v-model="form.sortOrder"
          class="w-full"
          inputmode="numeric"
          min="0"
          max="2147483647"
          step="1"
          type="number"
          placeholder="数值越小越靠前"
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
        {{ isEditing ? '保存修改' : '创建货币' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
