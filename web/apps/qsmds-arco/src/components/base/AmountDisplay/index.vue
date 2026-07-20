<script setup lang="ts">
import type { CurrencyAmountValue, CurrencyCode } from './format'
import { EMPTY_AMOUNT_TEXT, formatCurrencyAmount } from './format'

defineOptions({ name: 'AmountDisplay' })

const props = defineProps<{
  currency: CurrencyCode
  value: CurrencyAmountValue
}>()

const formattedAmount = computed(() => formatCurrencyAmount(props.value, props.currency))
const ariaLabel = computed(() => formattedAmount.value === EMPTY_AMOUNT_TEXT
  ? `${props.currency} 金额不可用`
  : `${props.currency} ${formattedAmount.value}`)
</script>

<template>
  <span
    :aria-label="ariaLabel"
    :data-currency="currency"
    :data-empty="formattedAmount === EMPTY_AMOUNT_TEXT"
    class="text-foreground tracking-tight font-medium inline-flex whitespace-nowrap items-baseline tabular-nums"
  >
    {{ formattedAmount }}
  </span>
</template>
