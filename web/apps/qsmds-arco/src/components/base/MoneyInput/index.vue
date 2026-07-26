<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { CurrencyCode } from '../AmountDisplay/format'
import type {
  MoneyAmount,
  MoneyValidationOptions,
  MoneyValidationResult,
} from './logic'
import { CURRENCY_SYMBOLS } from '../AmountDisplay/format'
import {
  DEFAULT_MONEY_PRECISION,
  normalizeMoneyString,
  validateMoneyString,
} from './logic'

defineOptions({
  name: 'MoneyInput',
  inheritAttrs: false,
})

const props = withDefaults(defineProps<{
  allowNegative?: boolean
  clearable?: boolean
  currency: CurrencyCode
  disabled?: boolean
  inputClass?: HTMLAttributes['class']
  max?: string
  min?: string
  placeholder?: string
  precision?: number
  readonly?: boolean
}>(), {
  allowNegative: false,
  clearable: true,
  disabled: false,
  precision: DEFAULT_MONEY_PRECISION,
  readonly: false,
})

const emits = defineEmits<{
  blur: [event: Event]
  validation: [result: MoneyValidationResult]
}>()

const modelValue = defineModel<MoneyAmount>({
  default: null,
})

const attrs = useAttrs()
const draftValue = ref(modelValue.value ?? '')
// draftValue 为空时需要区分“用户清空后的 null”和调用方错误传入的空字符串。
const emptyDraftMeansNull = ref(modelValue.value === null)
const touched = ref(false)

const validationOptions = computed<MoneyValidationOptions>(() => ({
  allowNegative: props.allowNegative,
  max: props.max,
  min: props.min,
  precision: props.precision,
}))
const currentMoneyValue = computed<MoneyAmount>(() => (
  draftValue.value === '' && emptyDraftMeansNull.value
    ? null
    : draftValue.value
))
const validationResult = computed(() => validateMoneyString(
  currentMoneyValue.value,
  validationOptions.value,
))
const validationCode = computed(() => (
  touched.value && !validationResult.value.valid
    ? validationResult.value.code
    : undefined
))
const ariaInvalid = computed(() => (
  attrs['aria-invalid'] === true
  || attrs['aria-invalid'] === 'true'
  || Boolean(validationCode.value)
))
const resolvedPlaceholder = computed(() => props.placeholder ?? (
  props.precision === 0
    ? '0'
    : `0.${'0'.repeat(props.precision)}`
))

watch(modelValue, (value) => {
  const nextDraftValue = value ?? ''
  emptyDraftMeansNull.value = value === null
  if (nextDraftValue !== draftValue.value) {
    draftValue.value = nextDraftValue
  }
})

function emitValidation(result = validationResult.value): MoneyValidationResult {
  emits('validation', result)
  return result
}

function handleDraftUpdate(value: number | string | undefined): void {
  const nextDraftValue = value === undefined ? '' : String(value)
  draftValue.value = nextDraftValue
  emptyDraftMeansNull.value = nextDraftValue === ''
  modelValue.value = nextDraftValue === '' ? null : nextDraftValue

  if (touched.value) {
    emitValidation()
  }
}

/**
 * 失焦时才把合法草稿补齐到固定精度；非法草稿原样保留，便于用户定位并修正。
 * 规范化结果仍通过 v-model 发出，所以 FaFormItem 能获得最终持久化字符串。
 */
function handleBlur(event: Event): void {
  touched.value = true
  const result = validationResult.value

  if (result.valid) {
    const normalizedValue = normalizeMoneyString(
      currentMoneyValue.value,
      validationOptions.value,
    )
    draftValue.value = normalizedValue ?? ''
    emptyDraftMeansNull.value = normalizedValue === null
    modelValue.value = normalizedValue
  }

  emitValidation(result.valid
    ? validateMoneyString(modelValue.value, validationOptions.value)
    : result)
  emits('blur', event)
}

function validate(): MoneyValidationResult {
  touched.value = true
  return emitValidation()
}

function resetValidation(): void {
  touched.value = false
}

defineExpose({
  resetValidation,
  validate,
})
</script>

<template>
  <FaInput
    v-bind="$attrs"
    :model-value="draftValue"
    :aria-invalid="ariaInvalid"
    :clearable="clearable && !readonly"
    :data-currency="currency"
    :data-validation-code="validationCode"
    :disabled="disabled"
    :input-class="['font-mono tabular-nums text-right', inputClass]"
    :placeholder="resolvedPlaceholder"
    :readonly="readonly"
    class="w-full"
    inputmode="decimal"
    type="text"
    @blur="handleBlur"
    @update:model-value="handleDraftUpdate"
  >
    <template #start>
      <span aria-hidden="true" class="text-muted-foreground font-medium">
        {{ CURRENCY_SYMBOLS[currency] }}
      </span>
    </template>
    <template #end>
      <span class="text-xs text-muted-foreground font-mono">
        {{ currency }}
      </span>
    </template>
  </FaInput>
</template>
