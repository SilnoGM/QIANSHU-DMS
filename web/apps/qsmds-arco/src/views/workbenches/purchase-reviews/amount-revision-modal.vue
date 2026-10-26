<script setup lang="ts">
import type { PurchaseAmountRevisionPreview } from './amount-revision.logic'
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import type { CurrencyDescriptor } from '@/components/base/currency'

import purchaseOrdersApi from '@/api/modules/purchase-orders'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import MoneyInput from '@/components/base/MoneyInput/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { getPurchaseOrderApiFailure } from '../../operations/purchase-orders/purchase-order-list.logic'
import {
  buildPurchaseAmountRevisionRequest,
  calculatePurchaseAmountRevisionPreview,
} from './amount-revision.logic'

defineOptions({ name: 'PurchaseAmountRevisionModal' })

const props = withDefaults(defineProps<{
  currencies: readonly CurrencyDescriptor[]
  detail: PurchaseOrderDetailDto | null
  modelValue: boolean
}>(), {})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  'updated': [detail: PurchaseOrderDetailDto]
}>()

const { t } = useI18n()
const toast = useQsToast()
const currency = ref<string | null>('CNY')
const linePrices = reactive<Record<string, string | null>>({})
const deposit = ref<string | null>(null)
const reason = ref('')
const localError = ref('')
const failure = ref<null | string>(null)
const submitting = ref(false)
let controller: AbortController | null = null

const visible = computed({
  get: () => props.modelValue,
  set: value => emit('update:modelValue', value),
})
const activePayments = computed(() => (
  props.detail?.payments.filter(payment => payment.voidedAt === null) ?? []
))
const hasActivePayments = computed(() => activePayments.value.length > 0)
const shipped = computed(() => (
  props.detail?.fulfillmentStatus === 'SHIPPED'
  || props.detail?.fulfillmentStatus === 'SIGNED'
))
interface PreviewState {
  readonly error: string
  readonly value: PurchaseAmountRevisionPreview | null
}
const previewState = computed<PreviewState>(() => {
  if (props.detail === null) {
    return { error: '', value: null }
  }
  try {
    return {
      error: '',
      value: calculatePurchaseAmountRevisionPreview(
        props.detail,
        linePrices,
        deposit.value,
      ),
    }
  }
  catch (error) {
    return {
      error: error instanceof RangeError
        ? error.message
        : '采购金额信息无效，请检查后重试',
      value: null,
    }
  }
})
const preview = computed(() => previewState.value.value)
const previewError = computed(() => previewState.value.error)
const canSubmit = computed(() => (
  props.detail !== null
  && !submitting.value
  && !hasActivePayments.value
  && preview.value !== null
  && preview.value.changed
  && reason.value.trim().length > 0
  && previewError.value === ''
))

function resetForm(): void {
  for (const line of props.detail?.lines ?? []) {
    linePrices[line.id] = line.actualPurchaseUnitPriceAmount
  }
  deposit.value = props.detail?.amounts.depositDueAmount ?? null
  reason.value = ''
  localError.value = ''
  failure.value = null
  submitting.value = false
}

watch(
  [() => props.modelValue, () => props.detail?.id],
  ([open]) => {
    if (open) {
      resetForm()
    }
    else {
      controller?.abort()
      controller = null
    }
  },
)

function updateVisible(value: boolean): void {
  if (!value && submitting.value) {
    return
  }
  visible.value = value
}

async function submit(): Promise<void> {
  const detail = props.detail
  if (detail === null || !canSubmit.value) {
    return
  }
  const result = buildPurchaseAmountRevisionRequest(
    detail,
    linePrices,
    deposit.value,
    reason.value,
  )
  if (!result.valid || result.request === undefined) {
    localError.value = result.fieldError ?? '采购金额信息无效，请检查后重试'
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
    toast.success(t('purchaseReview.amountRevision.success'))
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
    :title="t('purchaseReview.amountRevision.title')"
    :description="detail ? `${detail.orderNo} · ${t('purchaseReview.amountRevision.description')}` : undefined"
    size="lg"
    :closable="!submitting"
    :dismiss-on-escape="!submitting"
    :dismiss-on-overlay="!submitting"
    :submitting="submitting"
    @update:model-value="updateVisible"
  >
    <FaAlert
      v-if="failure"
      variant="destructive"
      icon="i-lucide:circle-alert"
      :title="t('purchaseReview.amountRevision.failed')"
      :description="failure"
      class="mb-4"
      role="alert"
    />
    <FaAlert
      v-if="hasActivePayments"
      variant="destructive"
      icon="i-lucide:shield-alert"
      :title="t('purchaseReview.amountRevision.hasPaymentsTitle')"
      class="mb-4"
      role="alert"
    >
      <template #description>
        <div class="gap-2 grid">
          <span>{{ t('purchaseReview.amountRevision.hasPayments', { count: activePayments.length }) }}</span>
          <ul class="m-0 pl-5">
            <li v-for="payment in activePayments" :key="payment.id">
              {{ t(`purchasePayment.types.${payment.paymentType}`) }} · {{ payment.amount }} CNY ·
              <DateTimeDisplay :value="payment.paidAt" />
            </li>
          </ul>
        </div>
      </template>
    </FaAlert>
    <FaAlert
      v-if="shipped"
      icon="i-lucide:info"
      :title="t('purchaseReview.amountRevision.shippedTitle')"
      :description="t('purchaseReview.amountRevision.shipped')"
      class="mb-4"
    />

    <template v-if="detail">
      <section aria-labelledby="purchase-amount-revision-lines" class="border border-border/70 bg-card">
        <header class="p-4 border-b border-border/70">
          <h2 id="purchase-amount-revision-lines" class="text-sm font-semibold m-0">
            {{ t('purchaseReview.amountRevision.lines') }}
          </h2>
          <p class="qs-type-meta m-0 mt-1">
            {{ t('purchaseReview.amountRevision.linesHint') }}
          </p>
        </header>
        <div class="divide-border/70 divide-y">
          <div
            v-for="line in detail.lines"
            :key="line.id"
            class="p-4 gap-3 grid sm:grid-cols-[minmax(0,1fr)_4rem_8rem_9rem_8rem] sm:items-end"
          >
            <div class="min-w-0">
              <p class="qs-type-compact-label m-0">
                {{ t('purchaseReview.amountRevision.product') }}
              </p>
              <p class="m-0 mt-1 break-words">
                {{ line.productName }}
              </p>
              <p class="qs-type-meta text-muted-foreground m-0">
                {{ line.productNo ?? t('purchaseReview.amountRevision.temporaryProduct') }}
              </p>
            </div>
            <div>
              <p class="qs-type-compact-label m-0">
                {{ t('purchaseReview.amountRevision.quantity') }}
              </p>
              <p class="m-0 mt-1 tabular-nums">
                {{ line.quantity }}
              </p>
            </div>
            <div>
              <p class="qs-type-compact-label m-0">
                {{ t('purchaseReview.amountRevision.currentPrice') }}
              </p>
              <p class="m-0 mt-1">
                <AmountDisplay
                  :value="line.actualPurchaseUnitPriceAmount"
                  currency="CNY"
                  :currencies="currencies"
                />
              </p>
            </div>
            <div>
              <p class="qs-type-compact-label mb-1">
                {{ t('purchaseReview.amountRevision.newPrice') }}
              </p>
              <MoneyInput
                v-model="linePrices[line.id]"
                v-model:currency="currency"
                :currencies="currencies"
                :currency-selectable="false"
                :disabled="submitting || hasActivePayments"
                placeholder="0.00"
              />
            </div>
            <div>
              <p class="qs-type-compact-label m-0">
                {{ t('purchaseReview.amountRevision.lineTotal') }}
              </p>
              <p class="m-0 mt-1">
                <AmountDisplay
                  :value="preview?.lineTotals[line.id] ?? '0.00'"
                  currency="CNY"
                  :currencies="currencies"
                />
              </p>
            </div>
          </div>
        </div>
      </section>

      <section class="mt-4 p-4 border border-border/70 bg-muted/20">
        <dl class="m-0 gap-4 grid sm:grid-cols-2">
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('purchaseReview.amountRevision.purchaseTotal') }}
            </dt>
            <dd class="m-0">
              <AmountDisplay
                :value="preview?.purchaseTotalAmount ?? detail.amounts.purchaseTotalAmount"
                currency="CNY"
                :currencies="currencies"
                class="qs-type-data-emphasis"
              />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('purchaseReview.amountRevision.balance') }}
            </dt>
            <dd class="m-0">
              <AmountDisplay
                :value="preview?.balanceDueAmount ?? detail.amounts.balanceDueAmount"
                currency="CNY"
                :currencies="currencies"
                class="qs-type-data-emphasis"
              />
            </dd>
          </div>
          <div class="sm:col-span-2">
            <p class="qs-type-compact-label mb-1">
              {{ t('purchaseReview.amountRevision.deposit') }}
            </p>
            <MoneyInput
              v-model="deposit"
              v-model:currency="currency"
              :currencies="currencies"
              :currency-selectable="false"
              :disabled="submitting || hasActivePayments"
              placeholder="0.00"
            />
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              {{ t('purchaseReview.amountRevision.depositHint') }}
            </p>
          </div>
        </dl>
      </section>

      <p v-if="previewError" class="text-xs text-destructive m-0 mt-2">
        {{ previewError }}
      </p>
      <p v-if="localError" class="text-xs text-destructive m-0 mt-2">
        {{ localError }}
      </p>

      <label class="qs-type-compact-label mb-1 mt-4 block" for="purchase-amount-revision-reason">
        {{ t('purchaseReview.amountRevision.reason') }}
      </label>
      <FaTextarea
        id="purchase-amount-revision-reason"
        v-model="reason"
        :disabled="submitting"
        :maxlength="500"
        :placeholder="t('purchaseReview.amountRevision.reasonPlaceholder')"
        input-class="min-h-24"
      />
      <p class="qs-type-meta text-muted-foreground m-0 mt-2">
        {{ t('purchaseReview.amountRevision.note') }}
      </p>
    </template>

    <template #footer>
      <FaButton
        type="button"
        variant="outline"
        :disabled="submitting"
        @click="updateVisible(false)"
      >
        {{ t('purchaseReview.amountRevision.cancel') }}
      </FaButton>
      <FaButton
        type="button"
        :loading="submitting"
        :disabled="!canSubmit"
        @click="submit"
      >
        {{ t('purchaseReview.amountRevision.confirm') }}
      </FaButton>
    </template>
  </QsGenericModal>
</template>
