<script setup lang="ts">
import type { CurrencyDescriptor } from '../currency'
import type { CurrencyAmountValue } from './format'
import { findCurrencyDescriptor } from '../currency'
import { EMPTY_AMOUNT_TEXT, formatCurrencyAmount } from './format'

defineOptions({ name: 'AmountDisplay' })

const props = defineProps<{
  currencies: readonly CurrencyDescriptor[]
  currency: string
  value: CurrencyAmountValue
}>()

const currencyDescriptor = computed(() => findCurrencyDescriptor(
  props.currencies,
  props.currency,
))
const formattedAmount = computed(() => formatCurrencyAmount(
  props.value,
  props.currency,
  props.currencies,
))
// 未解析币种仍保留可审计的原始金额，同时通过 aria-label 明确告知辅助技术。
const ariaLabel = computed(() => formattedAmount.value === EMPTY_AMOUNT_TEXT
  ? `${props.currency} 金额不可用`
  : currencyDescriptor.value
    ? formattedAmount.value
    : `${formattedAmount.value}，货币资料未解析`)
</script>

<template>
  <span
    :aria-label="ariaLabel"
    :data-currency="currency"
    :data-currency-resolved="Boolean(currencyDescriptor)"
    :data-empty="formattedAmount === EMPTY_AMOUNT_TEXT"
    class="qs-type-data-emphasis text-right inline-flex whitespace-nowrap items-baseline justify-end"
  >
    {{ formattedAmount }}
  </span>
</template>
