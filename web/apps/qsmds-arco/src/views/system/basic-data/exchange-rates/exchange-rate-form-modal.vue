<script setup lang="ts">
import type { ExchangeRateFormSubmission } from './exchange-rates.logic'
import type { ExchangeRateManagementItemDto } from '@/api/generated/types.gen'

import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  buildExchangeRateSubmission,
  formatConversionExample,
  validateForeignUnitsPerCny,
} from './exchange-rates.logic'

defineOptions({ name: 'ExchangeRateFormModal' })

const props = withDefaults(defineProps<{
  error?: null | string
  fieldErrors?: Readonly<Record<string, string>>
  item: ExchangeRateManagementItemDto | null
  modelValue: boolean
  requestId?: null | string
  submitting?: boolean
}>(), {
  error: null,
  fieldErrors: () => ({}),
  requestId: null,
  submitting: false,
})

const emit = defineEmits<{
  cancel: []
  submit: [submission: ExchangeRateFormSubmission]
}>()

const foreignUnitsPerCny = ref('')
const localError = ref('')
const submitRequested = ref(false)

const isEditing = computed(() => props.item?.currentRate !== null)
const submitLocked = computed(() => props.submitting || submitRequested.value)
const visibleError = computed(() => props.error || localError.value)
const fieldError = computed(() =>
  props.fieldErrors.foreignUnitsPerCny
  || validateForeignUnitsPerCny(foreignUnitsPerCny.value))
const conversionExample = computed(() => formatConversionExample(
  props.item?.currency.code ?? '',
  foreignUnitsPerCny.value,
))

function validateRateField(value: unknown): boolean | string {
  if (props.fieldErrors.foreignUnitsPerCny) {
    return props.fieldErrors.foreignUnitsPerCny
  }
  return typeof value === 'string'
    ? validateForeignUnitsPerCny(value) || true
    : '请输入换算比例'
}

function initializeForm(): void {
  /*
   * 未配置记录必须保持空值，不能把需求说明中的示例比例带入生产表单。
   * 编辑时只回填服务端当前字符串，确保输入、保存与 expectedVersion 同源。
   */
  foreignUnitsPerCny.value = props.item?.currentRate?.foreignUnitsPerCny ?? ''
  localError.value = ''
  submitRequested.value = false
}

function cancel(): void {
  if (!submitLocked.value) {
    emit('cancel')
  }
}

function handleVisibleChange(visible: boolean): void {
  if (!visible) {
    cancel()
  }
}

async function submit(): Promise<void> {
  if (submitLocked.value || props.item === null) {
    return
  }
  const validationMessage = validateForeignUnitsPerCny(
    foreignUnitsPerCny.value,
  )
  if (validationMessage !== '') {
    localError.value = validationMessage
    return
  }

  localError.value = ''
  submitRequested.value = true
  emit('submit', buildExchangeRateSubmission({
    currencyId: props.item.currency.id,
    exchangeRateId: props.item.currentRate?.id ?? null,
    foreignUnitsPerCny: foreignUnitsPerCny.value,
    version: props.item.currentRate?.version ?? null,
  }))
  await nextTick()
  if (!props.submitting) {
    submitRequested.value = false
  }
}

watch(
  () => props.modelValue,
  (visible) => {
    if (visible) {
      initializeForm()
      return
    }
    localError.value = ''
    submitRequested.value = false
  },
  { immediate: true },
)

watch(
  () => props.item,
  () => {
    if (props.modelValue) {
      void initializeForm()
    }
  },
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
    :title="isEditing ? '编辑当前汇率' : '新增当前汇率'"
    :description="item === null
      ? '汇率资料不可用'
      : `${item.currency.name}（${item.currency.code}）兑人民币`"
    size="md"
    :submitting="submitLocked"
    @update:model-value="handleVisibleChange"
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

    <div class="mb-5 p-4 border border-border rounded-lg bg-muted/35">
      <dl class="m-0 gap-4 grid grid-cols-1 sm:grid-cols-2">
        <div>
          <dt class="qs-type-compact-label mb-1">
            外币
          </dt>
          <dd class="qs-type-body m-0">
            {{ item?.currency.name ?? '—' }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            Currency Code
          </dt>
          <dd class="qs-type-data-emphasis m-0">
            {{ item?.currency.code ?? '—' }}
          </dd>
        </div>
      </dl>
    </div>

    <FaAlert
      class="mb-5"
      icon="i-lucide:calculator"
      title="比例定义"
      description="统一口径：1 CNY = X CODE；换算公式：外币金额 ÷ 比例 = 人民币。"
    />

    <FaForm
      :model="{ foreignUnitsPerCny }"
      :disabled="submitLocked"
      @submit="submit"
    >
      <FaFormItem
        name="foreignUnitsPerCny"
        label="外币单位数 / 1 CNY"
        required
        :rules="validateRateField"
        :description="conversionExample"
      >
        <FaInput
          v-model="foreignUnitsPerCny"
          autocomplete="off"
          class="w-full"
          inputmode="decimal"
          maxlength="23"
          placeholder="请输入大于 0 的十进制比例"
          spellcheck="false"
          @clear="foreignUnitsPerCny = ''"
          @update:model-value="localError = ''"
        />
      </FaFormItem>
    </FaForm>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitLocked"
        @click="cancel"
      >
        取消
      </FaButton>
      <FaButton
        type="button"
        class="min-h-11 w-full sm:min-h-9 sm:w-auto"
        :disabled="submitLocked || fieldError !== '' || item === null"
        :loading="submitLocked"
        @click="submit"
      >
        {{ isEditing ? '保存当前汇率' : '创建当前汇率' }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
