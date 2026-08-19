<script setup lang="ts">
import type {
  CreateFundManualAdjustmentRequestDto,
  FundAccountDto,
} from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'

import {
  buildFundManualAdjustmentRequest,
  calculateFundAdjustmentPreview,
} from '../shared/fund-money.logic'
import { formatFundShareRate } from './fund-account-list.logic'

defineOptions({ name: 'FundManualAdjustmentModal' })

const props = withDefaults(defineProps<{
  account: FundAccountDto | null
  companyAccount: FundAccountDto | null
  currencies: readonly CurrencyDescriptor[]
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
  'submit': [payload: CreateFundManualAdjustmentRequestDto]
  'update:modelValue': [value: boolean]
}>()

type AdjustmentMode = CreateFundManualAdjustmentRequestDto['adjustmentMode']

const adjustmentMode = ref<AdjustmentMode>('USER_ONLY')
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
const modeOptions = computed(() => [
  {
    label: '只调整选定用户账户',
    value: 'USER_ONLY',
  },
  {
    disabled: props.companyAccount === null,
    label: '按当前比例一同调整用户与公司账户',
    value: 'USER_AND_COMPANY_BY_SHARE',
  },
])
const preview = computed(() => {
  if (
    props.account?.ownerType !== 'USER'
    || props.account.userShareRate === null
    || amount.value === null
    || (
      adjustmentMode.value === 'USER_AND_COMPANY_BY_SHARE'
      && props.companyAccount === null
    )
  ) {
    return null
  }
  try {
    return calculateFundAdjustmentPreview({
      adjustmentMode: adjustmentMode.value,
      amount: amount.value,
      companyBalance: props.companyAccount?.balance ?? '0.00',
      userBalance: props.account.balance,
      userShareRate: props.account.userShareRate,
    })
  }
  catch {
    return null
  }
})

function resetForm(): void {
  adjustmentMode.value = 'USER_ONLY'
  amount.value = null
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

function updateVisible(visible: boolean): void {
  if (visible) {
    emit('update:modelValue', true)
  }
  else {
    close()
  }
}

function updateMode(value: unknown): void {
  if (
    value === 'USER_ONLY'
    || (
      value === 'USER_AND_COMPANY_BY_SHARE'
      && props.companyAccount !== null
    )
  ) {
    adjustmentMode.value = value
    localError.value = ''
  }
}

async function submit(): Promise<void> {
  if (
    locked.value
    || !currencyReady.value
    || props.account?.ownerType !== 'USER'
    || amount.value === null
  ) {
    return
  }
  try {
    const payload = buildFundManualAdjustmentRequest(
      amount.value,
      adjustmentMode.value,
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
      : '调账信息无效，请检查后重试'
  }
}

watch(
  [() => props.modelValue, () => props.account?.id],
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
    title="管理员手动调账"
    :description="account?.user === null ? '用户账户不可用' : `${account?.user?.displayName}（${account?.user?.username}）`"
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
      description="请求快照和幂等键已冻结。请使用同一请求重试，或明确放弃后刷新账户核对；不要修改表单后另发请求。"
      class="mb-4"
      role="alert"
    />

    <FaAlert
      v-if="error || localError"
      variant="destructive"
      icon="i-lucide:circle-alert"
      title="调账失败"
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
      description="金额精度无法确认，暂不能提交调账。"
      class="mb-4"
    />

    <FaAlert
      v-if="companyAccount === null"
      icon="i-lucide:info"
      title="公司账户暂不可用"
      description="仍可只调整用户账户；按比例共同调整需要先成功读取公司账户。"
      class="mb-4"
    />

    <FaForm :model="{ adjustmentMode, amount, reason }" :disabled="locked" @submit="submit">
      <FaFormItem name="adjustmentMode" label="调账范围" required>
        <FaSelect
          :model-value="adjustmentMode"
          :options="modeOptions"
          :disabled="locked"
          class="min-h-11 w-full sm:min-h-9"
          @update:model-value="updateMode"
        />
      </FaFormItem>

      <FaFormItem
        name="amount"
        label="业务调账金额"
        required
        description="正数为调增，负数为调减；最多两位小数且不能为零。"
      >
        <MoneyInput
          v-model="amount"
          v-model:currency="currency"
          allow-negative
          :currencies="currencies"
          :disabled="locked || !currencyReady"
          autocomplete="off"
          aria-label="业务调账金额"
          placeholder="例如 -100.00"
          @update:model-value="localError = ''"
        />
      </FaFormItem>

      <FaFormItem name="reason" label="调账原因" required>
        <FaTextarea
          v-model="reason"
          class="w-full"
          input-class="min-h-24 max-h-44"
          maxlength="500"
          placeholder="说明为什么需要进行本次独立调账"
          @update:model-value="localError = ''"
        />
      </FaFormItem>
    </FaForm>

    <section class="mt-5 p-4 border border-border rounded-lg bg-muted/25" aria-labelledby="fund-adjustment-preview-title">
      <div class="mb-4 flex gap-3 items-center justify-between">
        <h3 id="fund-adjustment-preview-title" class="text-sm font-medium m-0">
          预计影响
        </h3>
        <span class="qs-type-meta">仅供确认，最终结果以服务端入账为准</span>
      </div>

      <dl class="m-0 gap-x-5 gap-y-4 grid grid-cols-2 max-[479px]:grid-cols-1">
        <div>
          <dt class="qs-type-compact-label mb-1">
            用户当前余额
          </dt>
          <dd class="m-0">
            <AmountDisplay
              :value="account?.balance ?? null"
              currency="CNY"
              :currencies="currencies"
            />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            公司当前余额
          </dt>
          <dd class="m-0">
            <AmountDisplay
              :value="companyAccount?.balance ?? null"
              currency="CNY"
              :currencies="currencies"
            />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            当前用户比例
          </dt>
          <dd class="qs-type-data m-0">
            {{ formatFundShareRate(account?.userShareRate ?? null) }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            当前公司比例
          </dt>
          <dd class="qs-type-data m-0">
            {{ formatFundShareRate(account?.companyShareRate ?? null) }}
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            用户动账金额
          </dt>
          <dd class="m-0">
            <AmountDisplay :value="preview?.userAmount ?? null" currency="CNY" :currencies="currencies" />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            公司动账金额
          </dt>
          <dd class="m-0">
            <AmountDisplay :value="preview?.companyAmount ?? null" currency="CNY" :currencies="currencies" />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            用户预计余额
          </dt>
          <dd class="m-0">
            <AmountDisplay :value="preview?.userBalanceAfter ?? null" currency="CNY" :currencies="currencies" />
          </dd>
        </div>
        <div>
          <dt class="qs-type-compact-label mb-1">
            公司预计余额
          </dt>
          <dd class="m-0">
            <AmountDisplay
              :value="companyAccount === null ? null : (preview?.companyBalanceAfter ?? null)"
              currency="CNY"
              :currencies="currencies"
            />
          </dd>
        </div>
      </dl>
    </section>

    <template #footer>
      <template v-if="unknownResult">
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          :disabled="submitting"
          @click="emit('abandon')"
        >
          放弃重放并刷新
        </FaButton>
        <FaButton
          type="button"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          :loading="submitting"
          :disabled="submitting"
          @click="emit('retry')"
        >
          使用同一请求重试
        </FaButton>
      </template>
      <template v-else>
        <FaButton
          type="button"
          variant="outline"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          :disabled="locked"
          @click="close"
        >
          取消
        </FaButton>
        <FaButton
          type="button"
          class="min-h-11 w-full sm:min-h-9 sm:w-auto"
          :loading="locked"
          :disabled="locked || !currencyReady || preview === null"
          @click="submit"
        >
          确认调账
        </FaButton>
      </template>
    </template>
  </QsGenericModal>
</template>
