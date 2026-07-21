<script setup lang="ts">
import type { CurrencyAmountValue, CurrencyCode } from './format'
import { EMPTY_AMOUNT_TEXT, formatCurrencyAmount } from './format'

defineOptions({ name: 'AmountDisplay' })

const props = defineProps<{
  currency: CurrencyCode
  value: CurrencyAmountValue
}>()

const formattedAmount = computed(() => formatCurrencyAmount(props.value, props.currency))
// 有效金额已经包含币种代码，aria-label 直接复用展示文本，避免重复朗读 CNY 等代码。
const ariaLabel = computed(() => formattedAmount.value === EMPTY_AMOUNT_TEXT
  ? `${props.currency} 金额不可用`
  : formattedAmount.value)
</script>

<template>
  <span
    :aria-label="ariaLabel"
    :data-currency="currency"
    :data-empty="formattedAmount === EMPTY_AMOUNT_TEXT"
    class="font-qs-data-mono text-foreground tracking-[0.01em] font-medium text-right inline-flex whitespace-nowrap items-baseline justify-end tabular-nums"
  >
    {{ formattedAmount }}
  </span>
</template>
