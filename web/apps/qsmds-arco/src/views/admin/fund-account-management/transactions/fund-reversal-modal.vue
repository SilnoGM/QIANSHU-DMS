<script setup lang="ts">
import type {
  CreateFundReversalRequestDto,
  FundPostingBatchDetailDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import { buildFundReversalRequest } from '../shared/fund-money.logic'
import {
  calculateFundReversalPreview,
  getFundAccountTargetLabel,
  getFundDirectionState,
} from './fund-transaction.logic'

defineOptions({ name: 'FundReversalModal' })

const props = withDefaults(defineProps<{
  currencies: readonly CurrencyDescriptor[]
  detail: FundPostingBatchDetailDto | null
  error?: null | string
  modelValue: boolean
  requestId?: null | string
  submitting?: boolean
  unknownResult?: boolean
}>(), {
  error: null,
  requestId: null,
  submitting: false,
  unknownResult: false,
})

const emit = defineEmits<{
  'abandon': []
  'retry': []
  'submit': [payload: CreateFundReversalRequestDto]
  'update:modelValue': [value: boolean]
}>()

const amount = ref<null | string>(null)
const currency = ref<null | string>('CNY')
const reason = ref('')
const localError = ref('')
const submitRequested = ref(false)

const locked = computed(() => (
  props.submitting || props.unknownResult || submitRequested.value
))
const currencyReady = computed(() => props.currencies.some(item => (
  item.code === 'CNY' && item.enabled
)))
const preview = computed(() => {
  if (props.detail === null || amount.value === null) {
    return null
  }
  try {
    return calculateFundReversalPreview(props.detail, amount.value)
  }
  catch {
    return null
  }
})

function resetForm(): void {
  amount.value = props.detail?.reversalChain.remainingAmount ?? null
  currency.value = 'CNY'
  reason.value = ''
  localError.value = ''
  submitRequested.value = false
}

function close(): void {
  if (!locked.value) {
    emit('update:modelValue', false)
  }
}

function updateVisible(value: boolean): void {
  if (value) {
    emit('update:modelValue', true)
  }
  else {
    close()
  }
}

async function submit(): Promise<void> {
  if (
    locked.value
    || !currencyReady.value
    || props.detail === null
    || amount.value === null
  ) {
    return
  }
  try {
    // 先计算预计分录，确保页面快照仍满足累计目标和金额守恒，再构造传输 DTO。
    calculateFundReversalPreview(props.detail, amount.value)
    const payload = buildFundReversalRequest(
      amount.value,
      props.detail.reversalChain.remainingAmount,
      reason.value,
    )
    localError.value = ''
    submitRequested.value = true
    emit('submit', payload)
    await nextTick()
    if (!props.submitting) {
      submitRequested.value = false
    }
  }
  catch (error) {
    localError.value = error instanceof RangeError
      ? error.message
      : '冲账信息无效，请检查后重试'
  }
}

function retry(): void {
  if (props.unknownResult && !props.submitting) {
    emit('retry')
  }
}

function abandon(): void {
  if (props.unknownResult && !props.submitting) {
    emit('abandon')
  }
}

watch(
  [() => props.modelValue, () => props.detail?.id],
  ([visible]) => {
    if (visible) {
      resetForm()
    }
    else {
      localError.value = ''
      submitRequested.value = false
    }
  },
)

watch(() => props.submitting, (submitting) => {
  if (!submitting) {
    submitRequested.value = false
  }
})
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    title="批次冲账"
    :description="detail === null ? '批次快照不可用' : `${detail.batchNo} · ${detail.postingTypeName}`"
    size="lg"
    :closable="!unknownResult"
    :dismiss-on-escape="!unknownResult"
    :dismiss-on-overlay="!unknownResult"
    :submitting="submitting"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="unknownResult"
      variant="destructive"
      icon="i-lucide:triangle-alert"
      title="提交结果未知"
      description="冲账请求快照和幂等键已冻结。只能使用同一请求重试，或明确放弃后重新读取批次核对；不能修改表单后另发请求。"
      class="mb-4"
      role="alert"
    />

    <FaAlert
      v-if="error || localError"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="冲账失败"
      class="mb-4"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ localError || error }}</span>
          <code v-if="requestId" class="qs-type-meta break-all">requestId: {{ requestId }}</code>
        </div>
      </template>
    </FaAlert>

    <FaAlert
      v-if="!currencyReady"
      icon="i-lucide:triangle-alert"
      title="人民币资料暂不可用"
      description="金额精度无法确认，暂不能提交冲账。"
      class="mb-4"
    />

    <template v-if="detail">
      <dl class="m-0 mb-4 p-4 border border-border/70 bg-muted/20 gap-4 grid grid-cols-3 max-[479px]:grid-cols-1">
        <div>
          <dt class="qs-type-compact-label mb-1">
            原始业务金额
          </dt>
          <dd class="m-0">
            <AmountDisplay :value="detail.reversalChain.originalAmount" :currency="detail.currency" :currencies="currencies" />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            累计已冲
          </dt>
          <dd class="m-0">
            <AmountDisplay :value="detail.reversalChain.reversedAmount" :currency="detail.currency" :currencies="currencies" />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            剩余额度
          </dt>
          <dd class="m-0">
            <AmountDisplay :value="detail.reversalChain.remainingAmount" :currency="detail.currency" :currencies="currencies" />
          </dd>
        </div>
      </dl>

      <FaForm :model="{ amount, reason }" :disabled="locked" @submit="submit">
        <FaFormItem
          name="amount"
          label="本次冲账额度"
          required
          description="必须大于零且不超过剩余额度；默认填入全部剩余额度，可改为部分冲账。"
        >
          <MoneyInput
            v-model="amount"
            v-model:currency="currency"
            :currencies="currencies"
            :disabled="locked || !currencyReady"
            autocomplete="off"
            aria-label="本次冲账额度"
            class="w-full"
          />
        </FaFormItem>

        <FaFormItem
          name="reason"
          label="冲账原因"
          required
          description="说明原业务批次错误及本次冲账依据；原流水不会被修改。"
        >
          <FaTextarea
            v-model="reason"
            :disabled="locked"
            :maxlength="500"
            :rows="3"
            autocomplete="off"
            class="w-full"
            placeholder="请输入明确、可审计的冲账原因"
          />
        </FaFormItem>
      </FaForm>

      <section aria-labelledby="fund-reversal-preview-title" class="mt-5 border border-border/70 bg-card">
        <header class="p-4 border-b border-border/70 flex flex-wrap gap-3 items-start justify-between">
          <div>
            <h3 id="fund-reversal-preview-title" class="text-sm font-semibold m-0">
              预计反向分录
            </h3>
            <p class="qs-type-meta m-0 mt-1">
              依据原比例、原分录与累计已冲额度计算；最终以 Server 锁内结果为准。
            </p>
          </div>
          <FaTag v-if="preview" variant="outline" class="qs-type-status-tag">
            {{ preview.reversalStatus === 'FULL' ? '冲账后全部闭合' : '冲账后仍为部分状态' }}
          </FaTag>
        </header>

        <FaEmpty
          v-if="preview === null"
          icon="i-lucide:calculator"
          title="等待有效冲账额度"
          description="输入大于零且不超过剩余额度的金额后显示预计分录。"
          class="py-8"
        />
        <div v-else class="p-4 gap-3 grid">
          <div
            v-for="entry in preview.entries"
            :key="entry.originalLineNo"
            class="p-3 border border-border/70 flex flex-wrap gap-3 items-center justify-between"
          >
            <div>
              <div class="font-medium">
                {{ getFundAccountTargetLabel(entry.accountTarget) }}
              </div>
              <div class="qs-type-meta mt-1">
                对应原分录第 {{ entry.originalLineNo }} 行
              </div>
            </div>
            <div class="flex flex-wrap gap-2 items-center">
              <span :class="getFundDirectionState(entry.direction).tone === 'debit' ? 'text-destructive' : 'text-primary'" class="font-semibold">
                {{ getFundDirectionState(entry.direction).sign }} {{ getFundDirectionState(entry.direction).label }}
              </span>
              <AmountDisplay :value="entry.amount" :currency="detail.currency" :currencies="currencies" />
            </div>
          </div>
          <div class="pt-3 border-t border-border/70 flex flex-wrap gap-3 items-center justify-between">
            <span class="qs-type-compact-label">冲账业务金额</span>
            <AmountDisplay :value="preview.reversalBusinessAmount" :currency="detail.currency" :currencies="currencies" />
          </div>
        </div>
      </section>
    </template>

    <template #footer>
      <template v-if="unknownResult">
        <FaButton variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="submitting" @click="abandon">
          放弃并重新核对
        </FaButton>
        <FaButton variant="destructive" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" @click="retry">
          使用同一请求重试
        </FaButton>
      </template>
      <template v-else>
        <FaButton variant="outline" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :disabled="locked" @click="close">
          取消
        </FaButton>
        <FaButton variant="destructive" class="min-h-11 w-full sm:min-h-9 sm:w-auto" :loading="submitting" :disabled="locked || !preview || !currencyReady" @click="submit">
          <FaIcon name="i-lucide:rotate-ccw" />确认冲账
        </FaButton>
      </template>
    </template>
  </QsGenericModal>
</template>
