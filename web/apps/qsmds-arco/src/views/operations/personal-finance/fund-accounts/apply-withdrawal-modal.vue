<script setup lang="ts">
import type { CurrencyDescriptor } from '@/components/base/currency'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import { findCurrencyDescriptor } from '@/components/base/currency'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import {
  minimumWithdrawalAmount,
  validateWithdrawalAmount,
} from './withdrawal.logic'

defineOptions({ name: 'ApplyWithdrawalModal' })

const props = withDefaults(defineProps<{
  balance: string
  currencies: readonly CurrencyDescriptor[]
  currency: string
  error?: null | string
  modelValue: boolean
  submitting?: boolean
}>(), {
  error: null,
  submitting: false,
})

const emit = defineEmits<{
  'submit': [payload: { amount: string, currency: string }]
  'update:modelValue': [value: boolean]
}>()

const { t } = useI18n()
const amount = ref<string | null>(null)
const currency = ref<string | null>(props.currency)
const localError = ref('')
const currencyDescriptor = computed(() => findCurrencyDescriptor(
  props.currencies,
  currency.value,
))
const displayCurrency = computed(() => currency.value ?? props.currency)
const minimumAmount = computed(() => (
  minimumWithdrawalAmount(currencyDescriptor.value?.minorUnit ?? 2)
))
const canSubmit = computed(() => (
  !props.submitting
  && amount.value !== null
  && amount.value.trim().length > 0
))
const visibleError = computed(() => localError.value || props.error || '')

watch(() => props.modelValue, (visible) => {
  if (visible) {
    amount.value = null
    currency.value = props.currency
    localError.value = ''
  }
})

watch(() => props.currency, (value) => {
  if (!props.modelValue) {
    currency.value = value
  }
})

function close(): void {
  if (props.submitting) {
    return
  }
  emit('update:modelValue', false)
}

function updateVisible(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
    return
  }
  close()
}

function submit(): void {
  if (props.submitting) {
    return
  }
  const descriptor = currencyDescriptor.value
  if (descriptor === null) {
    localError.value = t('qsPersonalFundAccount.withdrawalAmountInvalid')
    return
  }

  const result = validateWithdrawalAmount(amount.value, descriptor.minorUnit)
  if (!result.valid) {
    localError.value = t(result.error === 'required'
      ? 'qsPersonalFundAccount.withdrawalAmountRequired'
      : 'qsPersonalFundAccount.withdrawalAmountInvalid')
    return
  }

  localError.value = ''
  emit('submit', { amount: result.amount, currency: descriptor.code })
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('qsPersonalFundAccount.withdrawalModalTitle')"
    size="sm"
    :submitting="submitting"
    :dismiss-on-escape="!submitting"
    :dismiss-on-overlay="!submitting"
    @update:model-value="updateVisible"
  >
    <section
      class="text-primary-foreground mb-5 px-4 py-3.5 rounded-xl bg-primary"
      aria-labelledby="withdrawal-current-balance-label"
    >
      <p
        id="withdrawal-current-balance-label"
        class="text-xs text-primary-foreground/75 font-medium m-0"
      >
        {{ t('qsPersonalFundAccount.withdrawalCurrentBalance') }}
      </p>
      <div class="mt-1">
        <AmountDisplay
          :value="balance"
          :currency="displayCurrency"
          :currencies="currencies"
          class="!text-3xl !text-white !font-semibold"
        />
      </div>
    </section>

    <FaForm :model="{ amount }" @submit="submit">
      <FaFormItem
        name="amount"
        :label="t('qsPersonalFundAccount.withdrawalAmountLabel')"
        required
        :description="t('qsPersonalFundAccount.withdrawalAmountHint')"
      >
        <MoneyInput
          v-model="amount"
          v-model:currency="currency"
          :currencies="currencies"
          :currency-selectable="false"
          :min="minimumAmount"
          autocomplete="off"
          :aria-label="t('qsPersonalFundAccount.withdrawalAmountLabel')"
          :placeholder="t('qsPersonalFundAccount.withdrawalAmountPlaceholder')"
          @update:model-value="localError = ''"
        />
      </FaFormItem>
    </FaForm>

    <p v-if="visibleError" class="qs-type-meta text-destructive m-0 mt-2" role="alert">
      {{ visibleError }}
    </p>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitting"
        @click="close"
      >
        {{ t('qsPersonalFundAccount.withdrawalCancel') }}
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ t('qsPersonalFundAccount.withdrawalSubmit') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
