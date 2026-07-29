<script setup lang="ts">
import type { CurrencyDto } from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

defineOptions({ name: 'CurrencyStatusChangeModal' })

const props = withDefaults(defineProps<{
  action: 'disable' | 'enable'
  currency?: CurrencyDto | null
  error?: string
  errorCode?: string
  modelValue: boolean
  requestId?: string
  submitting?: boolean
}>(), {
  currency: null,
  error: '',
  errorCode: undefined,
  requestId: undefined,
  submitting: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'submit': []
}>()

const isDisable = computed(() => props.action === 'disable')
const rateMissing = computed(() =>
  !isDisable.value
  && props.currency !== null
  && !props.currency.exchangeRateConfigured)
const serverRateRequired = computed(() =>
  props.errorCode === 'CURRENCY_EXCHANGE_RATE_REQUIRED')
const submitDisabled = computed(() =>
  props.submitting
  || props.currency === null
  || props.currency.isBase
  || rateMissing.value)

function close(): void {
  if (!props.submitting) {
    emit('update:modelValue', false)
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="isDisable ? '确认停用货币' : '确认启用货币'"
    :description="isDisable
      ? '停用只影响后续业务选择，既有金额仍按原货币展示。'
      : '启用后，金额输入组件将允许业务选择该货币。'"
    size="sm"
    :submitting="submitting"
    @update:model-value="visible => visible ? emit('update:modelValue', true) : close()"
  >
    <FaAlert
      v-if="error"
      class="mb-4"
      icon="i-lucide:circle-alert"
      title="操作失败"
      variant="destructive"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ error }}</span>
          <span
            v-if="errorCode === 'CURRENCY_EXCHANGE_RATE_REQUIRED'"
            class="font-medium"
          >
            请先到“货币汇率”的“当前汇率”标签页配置，再返回启用该货币。
          </span>
          <code v-if="requestId" class="qs-type-meta break-all">
            requestId: {{ requestId }}
          </code>
        </div>
      </template>
    </FaAlert>

    <FaAlert
      v-else-if="rateMissing || serverRateRequired"
      class="mb-4"
      icon="i-lucide:circle-alert"
      title="尚未配置当前汇率"
      description="请先到“货币汇率”的“当前汇率”标签页配置，再返回启用该货币。"
      role="status"
    />

    <p class="leading-6 m-0">
      确认{{ isDisable ? '停用' : '启用' }}
      <strong class="mx-1">{{ currency?.name }}</strong>
      <code class="font-mono">{{ currency?.code }}</code>？
    </p>
    <p v-if="isDisable" class="qs-type-description mb-0 mt-3">
      停用不会修改历史单据，也不会自动换算已有金额。
    </p>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitting"
        @click="close"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        :variant="isDisable ? 'destructive' : 'default'"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :loading="submitting"
        :disabled="submitDisabled"
        @click="emit('submit')"
      >
        确认{{ isDisable ? '停用' : '启用' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
