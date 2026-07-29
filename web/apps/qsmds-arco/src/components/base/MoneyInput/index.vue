<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { CurrencyDescriptor } from '../currency'
import type {
  MoneyAmount,
  MoneyValidationOptions,
  MoneyValidationResult,
} from './logic'
import { findCurrencyDescriptor } from '../currency'
import {
  createMoneyCurrencyOptions,
  EMPTY_MONEY_CURRENCY_VALUE,
} from './currency'
import {
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
  currencies: readonly CurrencyDescriptor[]
  disabled?: boolean
  inputClass?: HTMLAttributes['class']
  max?: string
  min?: string
  placeholder?: string
  readonly?: boolean
}>(), {
  allowNegative: false,
  clearable: true,
  disabled: false,
  readonly: false,
})

const emits = defineEmits<{
  blur: [event: Event]
  validation: [result: MoneyValidationResult]
}>()

const modelValue = defineModel<MoneyAmount>({
  default: null,
})
const currency = defineModel<string | null>('currency', {
  default: null,
})

const attrs = useAttrs()
const draftValue = ref(modelValue.value ?? '')
// draftValue 为空时需要区分“用户清空后的 null”和调用方错误传入的空字符串。
const emptyDraftMeansNull = ref(modelValue.value === null)
const touched = ref(false)

const currentCurrency = computed(() => findCurrencyDescriptor(
  props.currencies,
  currency.value,
))
const currencyOptions = computed(() => createMoneyCurrencyOptions(
  props.currencies,
  currency.value,
))
const hasEnabledCurrencies = computed(() => props.currencies.some(option => option.enabled))
const validationOptions = computed<MoneyValidationOptions>(() => ({
  allowNegative: props.allowNegative,
  max: props.max,
  min: props.min,
  precision: currentCurrency.value?.minorUnit,
}))
const currentMoneyValue = computed<MoneyAmount>(() => (
  draftValue.value === '' && emptyDraftMeansNull.value
    ? null
    : draftValue.value
))
const validationResult = computed<MoneyValidationResult>(() => {
  if (!currentCurrency.value) {
    return {
      code: 'CURRENCY_REQUIRED',
      message: '请选择有效货币',
      normalizedValue: null,
      valid: false,
    }
  }

  return validateMoneyString(
    currentMoneyValue.value,
    validationOptions.value,
  )
})
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
  currentCurrency.value === null
    ? '请先选择币种'
    : currentCurrency.value.minorUnit === 0
      ? '0'
      : `0.${'0'.repeat(currentCurrency.value.minorUnit)}`
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

function handleCurrencyUpdate(value: unknown): void {
  if (typeof value !== 'string') {
    return
  }

  const nextCurrency = findCurrencyDescriptor(props.currencies, value)
  if (nextCurrency?.enabled) {
    // 切换币种只更新币种模型；金额原文及草稿必须由调用方显式决定是否换算。
    currency.value = nextCurrency.code
  }
}

/**
 * 可编辑状态失焦时才把合法草稿补齐到固定精度；非法草稿原样保留，便于用户定位
 * 并修正。readonly 仅执行校验和 blur 通知，不得产生隐式 v-model 写入。
 */
function handleBlur(event: Event): void {
  touched.value = true
  const result = validationResult.value

  if (result.valid && !props.readonly) {
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
    :data-currency="currency ?? undefined"
    :data-currency-enabled="currentCurrency?.enabled"
    :data-validation-code="validationCode"
    :disabled="disabled"
    end-class="pe-1.5"
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
        {{ currentCurrency?.symbol ?? '' }}
      </span>
    </template>
    <template #end>
      <span
        role="group"
        aria-label="币种选择"
        class="flex shrink-0 items-center"
      >
        <FaSelect
          :model-value="currency ?? EMPTY_MONEY_CURRENCY_VALUE"
          :options="currencyOptions"
          :disabled="disabled || readonly || !hasEnabledCurrencies"
          class="text-xs font-mono px-2 py-0 border-0 bg-transparent shrink-0 w-[5rem] shadow-none dark:bg-transparent data-[size=default]:h-8 dark:hover:bg-transparent"
          position="popper"
          @update:model-value="handleCurrencyUpdate"
        />
      </span>
    </template>
  </FaInput>
</template>
