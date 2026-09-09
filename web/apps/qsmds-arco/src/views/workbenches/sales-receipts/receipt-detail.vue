<script setup lang="ts">
import type { SalesReceiptApprovalContextDto, SalesReceiptRequestDetailDto } from '@/api/generated/types.gen'
import salesOrdersApi from '@/api/modules/sales-orders'
import salesReceiptsApi from '@/api/modules/sales-receipts'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { getSalesOrderApiFailure } from '../../operations/sales-orders/sales-order-create.logic'
import ReceiptDetailSection from './receipt-detail-section.vue'
import { formatReceiptDecimal, paymentMethodClass, receiptAmountClass } from './receipt-display'
import ReceiptPostingSummary from './receipt-posting-summary.vue'
import ReceiptVoucher from './receipt-voucher.vue'

const props = defineProps<{ requestId: string | null }>()
const emit = defineEmits<{ close: [], changed: [] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const toast = useQsToast()
const currencyCatalog = useCurrencyCatalog()
const detail = shallowRef<SalesReceiptRequestDetailDto | null>(null)
const context = shallowRef<SalesReceiptApprovalContextDto | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const contextError = ref('')
const reason = ref('')
const actionSection = ref<HTMLElement | null>(null)
const action = ref<'approve' | 'reject' | 'void' | null>(null)
let controller: AbortController | null = null
const visible = computed({ get: () => props.requestId !== null, set: (value) => {
  if (!value && !busy.value) {
    emit('close')
  }
} })
const canRead = computed(() => auth('sales-receipts:read'))
const canReview = computed(() => auth('sales-receipts:review'))
const canVoid = computed(() => auth('sales-receipts:void'))
const receiptStatusClass = computed(() => detail.value?.status === 'REJECTED'
  ? 'border-destructive/30 bg-destructive/10 text-destructive'
  : detail.value?.status === 'APPROVED'
    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300')
const voidPreview = computed(() => {
  const posting = detail.value?.approvedPayment?.posting
  return posting ? { ...posting, entries: posting.entries.map(entry => ({ ...entry, direction: 'DEBIT' })) } : null
})
const traceRows = computed(() => {
  const item = detail.value
  if (!item) {
    return []
  }
  const payment = item.approvedPayment
  return [
    [t('salesReceipt.traceLabel.requestId'), item.id],
    [t('salesReceipt.traceLabel.numberingIssuanceId'), item.numberingIssuanceId],
    [t('salesReceipt.traceLabel.requestVersion'), item.version],
    [t('salesReceipt.traceLabel.salesOrderId'), item.salesOrderId],
    [t('salesReceipt.traceLabel.orderVersion'), item.salesOrder.version],
    [t('salesReceipt.traceLabel.accountOwnerId'), item.accountOwner.id],
    [t('salesReceipt.traceLabel.submittedById'), item.submittedBy.id],
    [t('salesReceipt.traceLabel.reviewedById'), item.reviewedBy?.id],
    [t('salesReceipt.traceLabel.voucherMediaAssetId'), item.voucher.mediaAssetId],
    [t('salesReceipt.traceLabel.resubmittedFromId'), item.resubmittedFromId],
    [t('salesReceipt.traceLabel.paymentId'), payment?.id],
    [t('salesReceipt.traceLabel.paymentOrigin'), payment?.origin],
    [t('salesReceipt.traceLabel.paymentMethodValue'), item.paymentMethod],
    [t('salesReceipt.traceLabel.fundPostingBatchId'), payment?.fundPostingBatchId],
    [t('salesReceipt.traceLabel.fundReversalBatchId'), payment?.fundReversalBatchId],
    [t('salesReceipt.traceLabel.exchangeRateId'), payment?.exchangeRateId],
    [t('salesReceipt.traceLabel.exchangeRateVersion'), payment?.exchangeRateVersionSnapshot],
    [t('salesReceipt.traceLabel.ruleVersionId'), payment?.posting?.ruleVersionId],
    [t('salesReceipt.traceLabel.ruleRevision'), payment?.posting?.ruleRevisionSnapshot],
    [t('salesReceipt.traceLabel.reversalRuleVersionId'), payment?.reversal?.ruleVersionId],
    [t('salesReceipt.traceLabel.reversalRuleRevision'), payment?.reversal?.ruleRevisionSnapshot],
    ...Object.entries(context.value?.expectedContext ?? {}).map(([key, value]) => [t(`salesReceipt.traceLabel.preview.${key}`), value]),
  ].filter(([, value]) => value !== null && value !== undefined)
})
async function load(): Promise<void> {
  controller?.abort()
  detail.value = null
  context.value = null
  action.value = null
  reason.value = ''
  error.value = ''
  contextError.value = ''
  if (props.requestId === null || !canRead.value) {
    return
  }
  const current = new AbortController()
  controller = current
  loading.value = true
  try {
    const response = await salesReceiptsApi.detail(props.requestId, current.signal)
    if (!current.signal.aborted && canRead.value) {
      detail.value = response.data
    }
  }
  catch (failure) {
    if (!current.signal.aborted) {
      error.value = getSalesOrderApiFailure(failure).message
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}
async function prepare(next: 'approve' | 'reject' | 'void'): Promise<void> {
  if (!detail.value || busy.value) {
    return
  }
  action.value = next
  reason.value = ''
  context.value = null
  contextError.value = ''
  // 操作区位于详情末尾，键盘或鼠标触发后将视口与焦点一起带到预览/原因区。
  await nextTick()
  actionSection.value?.scrollIntoView({ block: 'start', behavior: 'instant' })
  actionSection.value?.focus({ preventScroll: true })
  if (next !== 'approve') {
    return
  }
  busy.value = true
  const current = controller ?? new AbortController()
  try {
    const response = await salesReceiptsApi.approvalContext(detail.value.id, current.signal)
    if (!current.signal.aborted) {
      context.value = response.data
    }
  }
  catch (failure) {
    if (!current.signal.aborted) {
      contextError.value = getSalesOrderApiFailure(failure).message
    }
  }
  finally {
    busy.value = false
  }
}
async function submit(): Promise<void> {
  const item = detail.value
  const operation = action.value
  if (!item || !operation || busy.value) {
    return
  }
  if (operation !== 'approve' && !reason.value.trim()) {
    contextError.value = t('salesReceipt.reasonRequired')
    return
  }
  if (operation === 'approve' && !context.value) {
    return
  }
  busy.value = true
  contextError.value = ''
  const current = controller ?? new AbortController()
  try {
    if (operation === 'approve' && context.value) {
      await salesReceiptsApi.approve(item.id, { expectedVersion: item.version, expectedContext: context.value.expectedContext, reason: reason.value.trim() || undefined }, current.signal)
    }
    else if (operation === 'reject') {
      await salesReceiptsApi.reject(item.id, { expectedVersion: item.version, reason: reason.value.trim() }, current.signal)
    }
    else if (operation === 'void' && item.approvedPayment) {
      await salesOrdersApi.voidPayment(item.salesOrderId, item.approvedPayment.id, { expectedOrderVersion: item.salesOrder.version, reason: reason.value.trim() }, current.signal)
    }
    if (current.signal.aborted) {
      return
    }
    toast.success(t('salesReceipt.saved'))
    emit('changed')
    await load()
  }
  catch (failure) {
    if (current.signal.aborted) {
      return
    }
    // 任何失败均撤销旧预览，下一次通过必须重新读取上下文并人工确认。
    context.value = null
    contextError.value = `${getSalesOrderApiFailure(failure).message} ${t('salesReceipt.refreshRequired')}`
  }
  finally {
    busy.value = false
  }
}
watch(() => [props.requestId, canRead.value, accountStore.authEpoch] as const, () => {
  void load()
}, { immediate: true })
watch([canReview, canVoid], () => {
  context.value = null
  action.value = null
})
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <QsGenericModal v-model="visible" :title="t('salesReceipt.detail')" :description="detail ? (detail.collectionNo || t('salesReceipt.unnumbered')) : undefined" size="xl" :loading="loading" :error="error || null" :submitting="busy" :dismiss-on-escape="!busy" :dismiss-on-overlay="!busy">
    <template #header-leading>
      <FaIcon name="i-lucide:hand-coins" class="size-5" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="load">
        {{ t('salesReceipt.refresh') }}
      </FaButton>
    </template>
    <div v-if="detail" class="min-w-0 space-y-4">
      <section class="p-4 border border-border rounded-xl bg-muted/15 min-w-0 space-y-5 sm:p-5">
        <div class="flex flex-wrap gap-3 items-start justify-between">
          <div class="min-w-0 space-y-1">
            <p class="qs-type-compact-label m-0">
              {{ t('salesReceipt.collectionNo') }}
            </p><p class="qs-type-data-emphasis m-0 select-all break-all">
              {{ detail.collectionNo || t('salesReceipt.unnumbered') }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <FaTag variant="outline" class="qs-type-status-tag" :class="receiptStatusClass">
              {{ t(`salesReceipt.status.${detail.status}`) }}
            </FaTag>
            <FaTag v-if="detail.approvedPayment?.voidedAt" variant="outline" class="text-destructive qs-type-status-tag border-destructive/30 bg-destructive/5">
              {{ t('salesReceipt.voided') }}
            </FaTag>
            <FaTag v-if="detail.resubmittedFromId" variant="outline" class="qs-type-status-tag">
              {{ t('salesReceipt.resubmitted') }}
            </FaTag>
          </div>
        </div>
        <div class="min-w-0 space-y-2">
          <p class="qs-type-compact-label m-0">
            {{ t('salesReceipt.amount') }}
          </p>
          <div tabindex="0" :aria-label="t('salesReceipt.amount')" class="max-w-full overflow-x-auto [&_[data-currency]]:text-3xl [&_[data-currency]]:leading-10 [&_[data-currency]]:font-bold">
            <AmountDisplay :class="receiptAmountClass(detail.amount)" :value="detail.amount" :currency="detail.currencyCode" :currencies="currencyCatalog.currencies.value" />
          </div>
          <div class="flex flex-wrap gap-2 items-center">
            <FaTag variant="outline">
              {{ t(`salesReceipt.type.${detail.paymentType}`) }}
            </FaTag><span class="qs-type-meta">{{ detail.currencyCode }}</span>
          </div>
        </div>
        <p v-if="detail.status === 'PENDING_REVIEW'" class="qs-type-meta m-0 flex gap-2 items-start">
          <FaIcon name="i-lucide:info" class="mt-0.5 shrink-0 size-4" aria-hidden="true" />{{ t('salesReceipt.pendingHint') }}
        </p>
      </section>
      <div class="gap-4 grid md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ReceiptDetailSection :title="t('salesReceipt.receiptInfo')" icon="i-lucide:clipboard-list">
          <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('salesReceipt.orderNumber') }}
              </dt><dd class="qs-type-data m-0 break-all">
                {{ detail.salesOrder.orderNo }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('salesReceipt.customer') }}
              </dt><dd class="qs-type-body m-0 break-words">
                {{ detail.salesOrder.customerName }}
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('salesReceipt.owner') }}
              </dt><dd class="m-0 min-w-0">
                <QsPersonDisplay :display-name="detail.accountOwner.name" size="md" class="max-w-full" />
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('salesReceipt.orderStatus') }}
              </dt><dd class="m-0">
                <FaTag variant="outline">
                  {{ t(`salesReceipt.orderState.${detail.salesOrder.orderStatus}`) }}
                </FaTag>
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('salesReceipt.receivedAt') }}
              </dt><dd class="m-0 overflow-x-auto">
                <DateTimeDisplay :value="detail.receivedAt" />
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('salesReceipt.method') }}
              </dt><dd class="m-0">
                <FaTag variant="outline" class="max-w-full whitespace-normal break-words" :class="paymentMethodClass(detail.paymentMethod)">
                  {{ detail.paymentMethodNameSnapshot }}
                </FaTag>
              </dd>
            </div>
            <div class="sm:col-span-2">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('salesReceipt.remark') }}
              </dt><dd class="qs-type-body m-0 whitespace-pre-wrap break-words">
                {{ detail.remark || '—' }}
              </dd>
            </div>
          </dl>
        </ReceiptDetailSection>
        <ReceiptDetailSection :title="t('salesReceipt.voucherTitle')" icon="i-lucide:paperclip">
          <div class="flex flex-wrap gap-3 min-w-0 items-center">
            <ReceiptVoucher :voucher="detail.voucher" :url="`/api/sales-receipt-requests/${encodeURIComponent(detail.id)}/voucher`" />
            <div class="flex-1 min-w-0 space-y-1">
              <p class="qs-type-body m-0 break-all">
                {{ detail.voucher.title }}
              </p><p class="qs-type-meta m-0">
                {{ detail.voucher.mimeType || '—' }}
              </p>
            </div>
          </div>
        </ReceiptDetailSection>
      </div>
      <ReceiptDetailSection :title="t('salesReceipt.reviewInfo')" icon="i-lucide:history">
        <dl class="m-0 gap-4 grid sm:grid-cols-2">
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('salesReceipt.submittedAt') }}
            </dt><dd class="m-0 min-w-0 space-y-2">
              <QsPersonDisplay :display-name="detail.submittedBy.name" size="sm" class="max-w-full" /><div class="overflow-x-auto">
                <DateTimeDisplay :value="detail.submittedAt" />
              </div>
            </dd>
          </div>
          <div class="min-w-0">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('salesReceipt.reviewedAt') }}
            </dt><dd class="m-0 min-w-0 space-y-2">
              <QsPersonDisplay v-if="detail.reviewedBy" :display-name="detail.reviewedBy.name" size="sm" class="max-w-full" /><span v-else class="qs-type-meta">—</span><div v-if="detail.reviewedAt" class="overflow-x-auto">
                <DateTimeDisplay :value="detail.reviewedAt" />
              </div>
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-compact-label mb-1.5">
              {{ t(detail.status === 'REJECTED' ? 'salesReceipt.rejectedReason' : 'salesReceipt.reviewRemark') }}
            </dt><dd class="qs-type-body m-0 whitespace-pre-wrap break-words">
              {{ detail.reviewRemark || '—' }}
            </dd>
          </div>
        </dl>
      </ReceiptDetailSection>
      <ReceiptDetailSection v-if="detail.approvedPayment" :title="t('salesReceipt.posted')" icon="i-lucide:wallet">
        <FaAlert v-if="detail.approvedPayment.origin === 'LEGACY'" :title="t('salesReceipt.legacy')" />
        <template v-else>
          <ReceiptPostingSummary v-if="detail.approvedPayment.posting" :snapshot="detail.approvedPayment.posting" :currencies="currencyCatalog.currencies.value" />
          <dl class="m-0 pt-4 border-t border-border gap-4 grid sm:grid-cols-2">
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('salesReceipt.rate') }}
              </dt><dd class="qs-type-data m-0 break-all" :title="detail.approvedPayment.foreignUnitsPerCnySnapshot ?? undefined">
                {{ formatReceiptDecimal(detail.approvedPayment.foreignUnitsPerCnySnapshot) }} {{ detail.currencyCode }}/CNY
              </dd>
            </div>
            <div class="min-w-0">
              <dt class="qs-type-compact-label mb-1.5">
                {{ t('salesReceipt.rateCapturedAt') }}
              </dt><dd class="m-0 overflow-x-auto">
                <DateTimeDisplay :value="detail.approvedPayment.exchangeRateCapturedAt" />
              </dd>
            </div>
          </dl>
        </template>
      </ReceiptDetailSection>
      <ReceiptDetailSection v-if="detail.approvedPayment?.voidedAt" :title="t('salesReceipt.voided')" icon="i-lucide:circle-slash" class="border-destructive/25">
        <dl class="m-0 space-y-3">
          <div>
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('salesReceipt.voidedAt') }}
            </dt><dd class="m-0 overflow-x-auto">
              <DateTimeDisplay :value="detail.approvedPayment.voidedAt" />
            </dd>
          </div><div>
            <dt class="qs-type-compact-label mb-1.5">
              {{ t('salesReceipt.voidReason') }}
            </dt><dd class="qs-type-body m-0 whitespace-pre-wrap break-words">
              {{ detail.approvedPayment.voidReason }}
            </dd>
          </div>
        </dl>
      </ReceiptDetailSection>
      <ReceiptDetailSection v-if="detail.approvedPayment?.reversal" :title="t('salesReceipt.reversal')" icon="i-lucide:undo-2">
        <ReceiptPostingSummary :snapshot="detail.approvedPayment.reversal" reversal :currencies="currencyCatalog.currencies.value" />
      </ReceiptDetailSection>
      <section v-if="action" ref="actionSection" tabindex="-1" class="p-4 border-2 border-primary/30 rounded-xl bg-background min-w-0 space-y-5 sm:p-5">
        <header class="flex gap-3 items-start">
          <span class="text-primary rounded-lg bg-primary/10 flex shrink-0 size-9 items-center justify-center"><FaIcon :name="action === 'approve' ? 'i-lucide:badge-check' : action === 'reject' ? 'i-lucide:message-square-warning' : 'i-lucide:undo-2'" class="size-5" aria-hidden="true" /></span>
          <div class="min-w-0 space-y-1">
            <h3 class="qs-type-component-title m-0">
              {{ t(`salesReceipt.${action}`) }}
            </h3><p class="qs-type-meta m-0">
              {{ t(action === 'approve' ? 'salesReceipt.previewIntro' : action === 'reject' ? 'salesReceipt.rejectIntro' : 'salesReceipt.voidIntro') }}
            </p>
          </div>
        </header>
        <FaAlert v-if="contextError" variant="destructive" :title="contextError" role="alert" />
        <template v-if="action === 'approve' && context">
          <ReceiptPostingSummary :snapshot="context" :currencies="currencyCatalog.currencies.value" />
          <div class="p-3 border border-border rounded-lg bg-muted/15 space-y-2">
            <div class="qs-type-body flex flex-wrap gap-x-3 gap-y-1 justify-between">
              <span class="text-muted-foreground">{{ t('salesReceipt.rate') }}</span><span class="font-mono break-all" :title="context.foreignUnitsPerCny">{{ formatReceiptDecimal(context.foreignUnitsPerCny) }} {{ detail.currencyCode }}/CNY</span>
            </div>
            <p class="qs-type-meta m-0">
              {{ t('salesReceipt.previewHint') }}
            </p>
          </div>
        </template>
        <template v-if="action === 'void'">
          <FaAlert :title="t(detail.approvedPayment?.origin === 'LEGACY' ? 'salesReceipt.legacy' : 'salesReceipt.voidHint')" />
          <ReceiptPostingSummary v-if="voidPreview" :snapshot="voidPreview" reversal :currencies="currencyCatalog.currencies.value" />
        </template>
        <FaForm :model="{ reason }" :disabled="busy" @submit="submit">
          <FaFormItem name="reason" :label="t(action === 'approve' ? 'salesReceipt.optionalReason' : 'salesReceipt.reason')" :required="action !== 'approve'">
            <FaTextarea v-model="reason" :maxlength="500" :rows="3" :placeholder="t(action === 'approve' ? 'salesReceipt.optionalReasonPlaceholder' : 'salesReceipt.requiredReasonPlaceholder')" :disabled="busy" :aria-label="t('salesReceipt.reason')" />
            <p class="qs-type-meta m-0 mt-1.5 text-right">
              {{ reason.length }} / 500
            </p>
          </FaFormItem>
        </FaForm>
      </section>
      <FaCollapsible class="border border-border rounded-xl bg-background overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full">
        <template #trigger="{ open }">
          <span class="qs-type-compact-label p-4 flex gap-3 min-h-11 items-center justify-between"><span class="flex gap-2 items-center"><FaIcon name="i-lucide:scan-line" class="size-4" aria-hidden="true" />{{ t('salesReceipt.trace') }}</span><FaIcon name="i-lucide:chevron-down" class="size-4" :class="open ? 'rotate-180' : ''" /></span>
        </template>
        <dl class="m-0 p-4 border-t border-border gap-4 grid sm:grid-cols-2">
          <div v-for="[label, value] in traceRows" :key="String(label)" class="min-w-0">
            <dt class="qs-type-compact-label mb-1">
              {{ label }}
            </dt><dd class="qs-type-meta font-mono m-0 select-all break-all">
              {{ value }}
            </dd>
          </div>
        </dl>
      </FaCollapsible>
    </div>
    <template #footer>
      <div class="flex flex-wrap gap-2 w-full items-center justify-end">
        <template v-if="detail && action">
          <FaButton variant="outline" :disabled="busy" @click="action = null">
            {{ t('salesReceipt.cancel') }}
          </FaButton>
          <FaButton v-if="contextError" variant="outline" :disabled="busy" @click="load">
            {{ t('salesReceipt.refresh') }}
          </FaButton>
          <FaButton v-if="action === 'approve' && !context" variant="outline" :loading="busy" @click="prepare('approve')">
            {{ t('salesReceipt.refreshPreview') }}
          </FaButton>
          <FaButton :loading="busy" :disabled="busy || (action === 'approve' && !context)" @click="submit">
            {{ t(`salesReceipt.${action}`) }}
          </FaButton>
        </template>
        <template v-else>
          <FaButton variant="outline" :disabled="busy" @click="visible = false">
            {{ t('salesReceipt.close') }}
          </FaButton>
          <template v-if="detail?.status === 'PENDING_REVIEW' && canReview">
            <FaButton variant="outline" :disabled="busy" @click="prepare('reject')">
              {{ t('salesReceipt.reject') }}
            </FaButton>
            <FaButton :disabled="busy" @click="prepare('approve')">
              {{ t('salesReceipt.prepare') }}
            </FaButton>
          </template>
          <FaButton v-if="detail?.approvedPayment && !detail.approvedPayment.voidedAt && detail.salesOrder.orderStatus !== 'COMPLETED' && canVoid" variant="outline" :disabled="busy" @click="prepare('void')">
            {{ t('salesReceipt.void') }}
          </FaButton>
        </template>
      </div>
    </template>
  </QsGenericModal>
</template>
