<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '../../../api/generated/types.gen'
import type { CurrencyDescriptor } from '../../base/currency'
import type { PurchaseAmountRevisionPreview } from './logic'

import purchaseOrdersApi from '../../../api/modules/purchase-orders'
import { getPurchaseOrderApiFailure } from '../../../views/operations/purchase-orders/purchase-order-list.logic'
import AmountDisplay from '../../base/AmountDisplay/index.vue'
import DateTimeDisplay from '../../base/DateTimeDisplay/index.vue'
import MoneyInput from '../../base/MoneyInput/index.vue'
import {
  normalizeMoneyString,
  sumMoneyValues,
} from '../../base/MoneyInput/logic'
import { useQsToast } from '../../base/QsToast/useQsToast'
import QsGenericModal from '../QsGenericModal/index.vue'
import {
  buildPurchaseAmountRevisionRequest,
  calculatePurchaseAmountRevisionPreview,
  PURCHASE_AMOUNT_REVISION_MODAL_Z_INDEX,
} from './logic'

defineOptions({ name: 'QsPurchaseOrderAmountRevisionModal' })

const props = withDefaults(defineProps<{
  currencies: readonly CurrencyDescriptor[]
  detail?: PurchaseOrderDetailDto | null
  modelValue: boolean
  orderId?: string | null
}>(), {
  detail: null,
  orderId: null,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'updated': [detail: PurchaseOrderDetailDto]
}>()

const MONEY_OPTIONS = { precision: 2 } as const

const { t } = useI18n()
const toast = useQsToast()
const currency = ref<string | null>('CNY')
const linePrices = reactive<Record<string, string | null>>({})
const deposit = ref<string | null>(null)
const reason = ref('')
const localError = ref('')
const failure = ref<null | string>(null)
const submitting = ref(false)
const fetchedDetail = shallowRef<PurchaseOrderDetailDto | null>(null)
const loading = ref(false)
const loadError = ref('')
let controller: AbortController | null = null
let loadController: AbortController | null = null

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const activeDetail = computed(() => props.detail ?? fetchedDetail.value)
const activePayments = computed(() => (
  activeDetail.value?.payments.filter(payment => payment.voidedAt === null) ?? []
))
const blockingPayments = computed(() => (
  activePayments.value.filter(payment => payment.paymentType !== 'DEPOSIT')
))
const hasBlockingPayments = computed(() => blockingPayments.value.length > 0)
const depositLocked = computed(() => (
  activePayments.value.some(payment => payment.paymentType === 'DEPOSIT')
))
const paidDepositAmount = computed(() => sumMoneyValues(
  activePayments.value
    .filter(payment => payment.paymentType === 'DEPOSIT')
    .map(payment => payment.amount),
  MONEY_OPTIONS,
))
const effectiveDeposit = computed<string | null>(() => {
  const detail = activeDetail.value
  if (detail === null) {
    return null
  }
  return depositLocked.value
    ? normalizeMoneyString(detail.amounts.depositDueAmount, MONEY_OPTIONS)
    : deposit.value
})
const shipped = computed(() => (
  activeDetail.value?.fulfillmentStatus === 'SHIPPED'
  || activeDetail.value?.fulfillmentStatus === 'SIGNED'
))
interface PreviewState {
  readonly error: string
  readonly value: PurchaseAmountRevisionPreview | null
}
const previewState = computed<PreviewState>(() => {
  const detail = activeDetail.value
  if (detail === null) {
    return { error: '', value: null }
  }
  try {
    return {
      error: '',
      value: calculatePurchaseAmountRevisionPreview(
        detail,
        linePrices,
        effectiveDeposit.value,
        { depositLocked: depositLocked.value },
      ),
    }
  }
  catch (error) {
    return {
      error: error instanceof RangeError
        ? error.message
        : t('purchaseOrderAmountRevision.invalid'),
      value: null,
    }
  }
})
const preview = computed(() => previewState.value.value)
const previewError = computed(() => previewState.value.error)
const orderAmountsChanged = computed(() => {
  const detail = activeDetail.value
  const current = preview.value
  if (detail === null || current === null) {
    return false
  }
  return current.purchaseTotalAmount
    !== normalizeMoneyString(detail.amounts.purchaseTotalAmount, MONEY_OPTIONS)
    || current.depositDueAmount
    !== normalizeMoneyString(detail.amounts.depositDueAmount, MONEY_OPTIONS)
})
const canSubmit = computed(() => (
  activeDetail.value !== null
  && !loading.value
  && !submitting.value
  && !hasBlockingPayments.value
  && preview.value !== null
  && preview.value.changed
  && reason.value.trim().length > 0
  && previewError.value === ''
))
const reasonLength = computed(() => [...reason.value].length)
/** 禁用提交时给出唯一原因，避免用户只看到灰按钮却不知道下一步该做什么。 */
const submitHint = computed(() => {
  if (loading.value || submitting.value || activeDetail.value === null) {
    return ''
  }
  if (hasBlockingPayments.value) {
    return t('purchaseOrderAmountRevision.submitHintPayments')
  }
  if (previewError.value !== '') {
    return t('purchaseOrderAmountRevision.submitHintError')
  }
  if (preview.value === null || !preview.value.changed) {
    return t('purchaseOrderAmountRevision.submitHintNoChange')
  }
  if (reason.value.trim().length === 0) {
    return t('purchaseOrderAmountRevision.submitHintReason')
  }
  return ''
})

function resetForm(): void {
  const detail = activeDetail.value
  for (const line of detail?.lines ?? []) {
    linePrices[line.id] = line.actualPurchaseUnitPriceAmount
  }
  deposit.value = detail?.amounts.depositDueAmount ?? null
  reason.value = ''
  localError.value = ''
  failure.value = null
  submitting.value = false
}

function cancelLoad(): void {
  loadController?.abort()
  loadController = null
  loading.value = false
}

/** 全部采购列表只有摘要，弹窗按订单号自行取详情；审核页直接传入详情。 */
async function loadDetail(): Promise<void> {
  const orderId = props.orderId
  if (orderId === null || props.detail !== null) {
    return
  }
  cancelLoad()
  const request = new AbortController()
  loadController = request
  loading.value = true
  loadError.value = ''
  fetchedDetail.value = null
  try {
    const response = await purchaseOrdersApi.getById(orderId, request.signal)
    if (!request.signal.aborted && props.modelValue && props.orderId === orderId) {
      fetchedDetail.value = response.data
    }
  }
  catch (error) {
    if (!request.signal.aborted) {
      loadError.value = getPurchaseOrderApiFailure(error).message
    }
  }
  finally {
    if (loadController === request) {
      loadController = null
      loading.value = false
    }
  }
}

watch(
  [() => props.modelValue, () => props.orderId, () => props.detail],
  ([open, orderId, detail]) => {
    if (!open) {
      cancelLoad()
      cancelSubmit()
      return
    }
    if (detail === null && orderId !== null) {
      void loadDetail()
    }
  },
  { immediate: true },
)

watch(
  () => activeDetail.value,
  (detail) => {
    if (props.modelValue && detail !== null) {
      resetForm()
    }
  },
  { immediate: true },
)

function cancelSubmit(): void {
  controller?.abort()
  controller = null
  submitting.value = false
}

function updateVisible(value: boolean): void {
  if (!value && submitting.value) {
    return
  }
  visible.value = value
}

async function submit(): Promise<void> {
  const detail = activeDetail.value
  if (detail === null || !canSubmit.value) {
    return
  }
  const result = buildPurchaseAmountRevisionRequest(
    detail,
    linePrices,
    effectiveDeposit.value,
    reason.value,
    { depositLocked: depositLocked.value },
  )
  if (!result.valid || result.request === undefined) {
    localError.value = result.fieldError ?? t('purchaseOrderAmountRevision.invalid')
    return
  }
  localError.value = ''
  failure.value = null
  submitting.value = true
  const request = new AbortController()
  controller = request
  try {
    const response = await purchaseOrdersApi.reviseAmount(
      detail.id,
      result.request,
      request.signal,
    )
    if (request.signal.aborted) {
      return
    }
    fetchedDetail.value = response.data
    toast.success(t('purchaseOrderAmountRevision.success'))
    emit('updated', response.data)
    visible.value = false
  }
  catch (error) {
    if (!request.signal.aborted) {
      failure.value = getPurchaseOrderApiFailure(error).message
    }
  }
  finally {
    if (controller === request) {
      controller = null
      submitting.value = false
    }
  }
}
</script>

<template>
  <QsGenericModal
    :model-value="modelValue"
    :title="t('purchaseOrderAmountRevision.title')"
    :description="activeDetail ? `${activeDetail.orderNo} · ${t('purchaseOrderAmountRevision.description')}` : undefined"
    size="lg"
    :z-index="PURCHASE_AMOUNT_REVISION_MODAL_Z_INDEX"
    :closable="!submitting"
    :dismiss-on-escape="!submitting"
    :dismiss-on-overlay="!submitting"
    :submitting="submitting"
    :loading="loading"
    :error="loadError || null"
    :error-title="t('purchaseOrderAmountRevision.loadFailed')"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="failure"
      variant="destructive"
      icon="i-lucide:circle-alert"
      :title="t('purchaseOrderAmountRevision.failed')"
      :description="failure"
      class="mb-4"
      role="alert"
    />
    <FaAlert
      v-if="hasBlockingPayments"
      variant="destructive"
      icon="i-lucide:shield-alert"
      :title="t('purchaseOrderAmountRevision.hasPaymentsTitle')"
      class="mb-4"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ t('purchaseOrderAmountRevision.hasPayments', { count: blockingPayments.length }) }}</span>
          <ul class="m-0 pl-5">
            <li v-for="payment in blockingPayments" :key="payment.id">
              {{ t(`purchasePayment.types.${payment.paymentType}`) }} · {{ payment.amount }} CNY ·
              <DateTimeDisplay :value="payment.paidAt" />
            </li>
          </ul>
        </div>
      </template>
    </FaAlert>
    <FaAlert
      v-else-if="depositLocked"
      icon="i-lucide:lock"
      :title="t('purchaseOrderAmountRevision.depositLockedTitle')"
      class="mb-4"
    >
      <template #description>
        {{ t('purchaseOrderAmountRevision.depositLocked', { amount: paidDepositAmount }) }}
      </template>
    </FaAlert>
    <FaAlert
      v-if="shipped"
      icon="i-lucide:info"
      :title="t('purchaseOrderAmountRevision.shippedTitle')"
      :description="t('purchaseOrderAmountRevision.shipped')"
      class="mb-4"
    />

    <template v-if="activeDetail">
      <section aria-labelledby="purchase-amount-revision-lines" class="border border-border/70 bg-card">
        <header class="p-4 border-b border-border/70">
          <h2 id="purchase-amount-revision-lines" class="text-sm font-semibold m-0">
            {{ t('purchaseOrderAmountRevision.lines') }}
          </h2>
          <p class="qs-type-meta m-0 mt-1">
            {{ t('purchaseOrderAmountRevision.linesHint') }}
          </p>
        </header>
        <div class="divide-border/70 divide-y">
          <div
            v-for="line in activeDetail.lines"
            :key="line.id"
            class="p-4 gap-3 grid"
          >
            <div class="min-w-0">
              <div class="flex flex-wrap gap-x-2 gap-y-1 items-baseline">
                <p class="font-medium m-0 break-words">
                  {{ line.productName }}
                </p>
                <span class="qs-type-meta text-muted-foreground">× {{ line.quantity }}</span>
              </div>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                {{ line.productNo ?? t('purchaseOrderAmountRevision.temporaryProduct') }}
              </p>
            </div>
            <div class="gap-3 grid sm:grid-cols-3">
              <div class="min-w-0">
                <p class="qs-type-compact-label m-0">
                  {{ t('purchaseOrderAmountRevision.currentPrice') }}
                </p>
                <p class="m-0 mt-1">
                  <AmountDisplay
                    :value="line.actualPurchaseUnitPriceAmount"
                    currency="CNY"
                    :currencies="currencies"
                    class="max-w-full overflow-x-auto"
                  />
                </p>
              </div>
              <div class="min-w-0">
                <p class="qs-type-compact-label mb-1">
                  {{ t('purchaseOrderAmountRevision.newPrice') }}
                </p>
                <MoneyInput
                  v-model="linePrices[line.id]"
                  v-model:currency="currency"
                  :currencies="currencies"
                  :currency-selectable="false"
                  :disabled="submitting || hasBlockingPayments"
                  placeholder="0.00"
                />
              </div>
              <div class="min-w-0">
                <p class="qs-type-compact-label m-0">
                  {{ t('purchaseOrderAmountRevision.lineTotal') }}
                </p>
                <p class="m-0 mt-1">
                  <AmountDisplay
                    :value="preview?.lineTotals[line.id] ?? '0.00'"
                    currency="CNY"
                    :currencies="currencies"
                    class="max-w-full overflow-x-auto"
                  />
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section class="mt-4 p-4 border border-border/70 bg-muted/20">
        <dl class="m-0 gap-4 grid sm:grid-cols-3">
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1">
              {{ t('purchaseOrderAmountRevision.purchaseTotal') }}
            </dt>
            <dd class="m-0">
              <AmountDisplay
                :value="preview?.purchaseTotalAmount ?? activeDetail.amounts.purchaseTotalAmount"
                currency="CNY"
                :currencies="currencies"
                class="qs-type-data-emphasis max-w-full overflow-x-auto"
              />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1">
              {{ t('purchaseOrderAmountRevision.deposit') }}
            </dt>
            <dd class="m-0">
              <MoneyInput
                v-model="deposit"
                v-model:currency="currency"
                :currencies="currencies"
                :currency-selectable="false"
                :disabled="submitting || hasBlockingPayments || depositLocked"
                placeholder="0.00"
              />
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1">
              {{ t('purchaseOrderAmountRevision.balance') }}
            </dt>
            <dd class="m-0">
              <AmountDisplay
                :value="preview?.balanceDueAmount ?? activeDetail.amounts.balanceDueAmount"
                currency="CNY"
                :currencies="currencies"
                class="qs-type-data-emphasis max-w-full overflow-x-auto"
              />
            </dd>
          </div>
        </dl>
        <p class="qs-type-meta text-muted-foreground m-0 mt-3">
          {{ depositLocked
            ? t('purchaseOrderAmountRevision.depositLockedHint')
            : t('purchaseOrderAmountRevision.depositHint') }}
        </p>
      </section>

      <p
        v-if="preview && preview.changedLineCount > 0 && !orderAmountsChanged"
        class="qs-type-meta text-muted-foreground m-0 mt-2"
      >
        {{ t('purchaseOrderAmountRevision.lineOnlyHint') }}
      </p>
      <p v-if="previewError" class="text-xs text-destructive m-0 mt-2">
        {{ previewError }}
      </p>
      <p v-if="localError" class="text-xs text-destructive m-0 mt-2">
        {{ localError }}
      </p>

      <div class="mb-1 mt-4 flex gap-3 items-center justify-between">
        <label class="qs-type-compact-label" for="purchase-amount-revision-reason">
          {{ t('purchaseOrderAmountRevision.reason') }}
        </label>
        <span class="qs-type-meta text-muted-foreground tabular-nums">{{ reasonLength }}/500</span>
      </div>
      <FaTextarea
        id="purchase-amount-revision-reason"
        v-model="reason"
        :disabled="submitting"
        :maxlength="500"
        :placeholder="t('purchaseOrderAmountRevision.reasonPlaceholder')"
        input-class="min-h-20"
      />
      <p class="qs-type-meta text-muted-foreground m-0 mt-2">
        {{ t('purchaseOrderAmountRevision.note') }}
      </p>
    </template>

    <template #footer>
      <span v-if="submitHint" class="qs-type-meta text-muted-foreground sm:mr-auto">
        {{ submitHint }}
      </span>
      <FaButton
        type="button"
        variant="outline"
        :disabled="submitting"
        @click="updateVisible(false)"
      >
        {{ t('purchaseOrderAmountRevision.cancel') }}
      </FaButton>
      <FaButton
        type="button"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ t('purchaseOrderAmountRevision.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
