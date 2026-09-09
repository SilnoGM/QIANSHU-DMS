<script setup lang="ts">
import type { SalesReceiptApprovalContextDto, SalesReceiptRequestDetailDto } from '@/api/generated/types.gen'
import salesOrdersApi from '@/api/modules/sales-orders'
import salesReceiptsApi from '@/api/modules/sales-receipts'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { getSalesOrderApiFailure } from '../../operations/sales-orders/sales-order-create.logic'
import ReceiptPostingSummary from './receipt-posting-summary.vue'

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
const entries = computed(() => action.value === 'approve' ? context.value?.entries ?? [] : detail.value?.approvedPayment?.posting?.entries ?? [])
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
  <QsGenericModal v-model="visible" :title="t('salesReceipt.detail')" :description="detail ? (detail.collectionNo || t('salesReceipt.unnumbered')) : undefined" size="lg" :loading="loading" :error="error || null" :submitting="busy" :dismiss-on-escape="!busy" :dismiss-on-overlay="!busy">
    <template #header-leading>
      <FaIcon name="i-lucide:hand-coins" class="size-5" />
    </template>
    <template #error-actions>
      <FaButton variant="outline" @click="load">
        {{ t('salesReceipt.refresh') }}
      </FaButton>
    </template>
    <div v-if="detail" class="space-y-6">
      <section class="p-4 border border-border rounded-xl bg-muted/15 sm:p-5">
        <div class="mb-4 space-y-1">
          <p class="qs-type-compact-label m-0">
            {{ t('salesReceipt.collectionNo') }}
          </p>
          <p class="qs-type-data-emphasis font-mono m-0 select-all break-all">
            {{ detail.collectionNo || t('salesReceipt.unnumbered') }}
          </p>
        </div>
        <div class="flex flex-wrap gap-3 items-start justify-between">
          <div class="min-w-0 space-y-2">
            <p class="qs-type-compact-label m-0">
              {{ t('salesReceipt.amount') }}
            </p>
            <AmountDisplay :value="detail.amount" :currency="detail.currencyCode" :currencies="currencyCatalog.currencies.value" />
            <p class="qs-type-meta m-0">
              {{ t(`salesReceipt.type.${detail.paymentType}`) }} · {{ detail.currencyCode }}
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <FaTag variant="outline" class="qs-type-status-tag">
              {{ t(`salesReceipt.status.${detail.status}`) }}
            </FaTag>
            <FaTag v-if="detail.approvedPayment?.voidedAt" variant="outline" class="text-destructive qs-type-status-tag">
              {{ t('salesReceipt.voided') }}
            </FaTag>
            <FaTag v-if="detail.resubmittedFromId" variant="outline" class="qs-type-status-tag">
              {{ t('salesReceipt.resubmitted') }}
            </FaTag>
          </div>
        </div>
        <p v-if="detail.status === 'PENDING_REVIEW'" class="qs-type-meta mb-0 mt-4">
          {{ t('salesReceipt.pendingHint') }}
        </p>
      </section>
      <section class="space-y-3">
        <h3 class="qs-type-section-title m-0">
          {{ t('salesReceipt.receiptInfo') }}
        </h3>
        <dl class="m-0 gap-x-6 gap-y-4 grid sm:grid-cols-2">
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.orderNumber') }}
            </dt><dd class="qs-type-body m-0 break-words">
              {{ detail.salesOrder.orderNo }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.customer') }}
            </dt><dd class="qs-type-body m-0 break-words">
              {{ detail.salesOrder.customerName }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.owner') }}
            </dt><dd class="qs-type-body m-0 break-words">
              {{ detail.accountOwner.name }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.orderStatus') }}
            </dt><dd class="qs-type-data m-0">
              {{ t(`salesReceipt.orderState.${detail.salesOrder.orderStatus}`) }}
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.receivedAt') }}
            </dt><dd class="qs-type-data m-0">
              <DateTimeDisplay :value="detail.receivedAt" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.method') }}
            </dt><dd class="qs-type-body m-0 break-words">
              {{ detail.paymentMethodNameSnapshot }}
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.remark') }}
            </dt><dd class="qs-type-body m-0 whitespace-pre-wrap break-words">
              {{ detail.remark || '—' }}
            </dd>
          </div>
        </dl>
      </section>
      <section class="space-y-3">
        <h3 class="qs-type-section-title m-0">
          {{ t('salesReceipt.reviewInfo') }}
        </h3>
        <dl class="m-0 gap-4 grid sm:grid-cols-2">
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.submittedAt') }}
            </dt><dd class="qs-type-body m-0 break-words">
              {{ detail.submittedBy.name }}<div class="qs-type-meta mt-1">
                <DateTimeDisplay :value="detail.submittedAt" />
              </div>
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.reviewedAt') }}
            </dt><dd class="qs-type-body m-0 break-words">
              {{ detail.reviewedBy?.name || '—' }}<div v-if="detail.reviewedAt" class="qs-type-meta mt-1">
                <DateTimeDisplay :value="detail.reviewedAt" />
              </div>
            </dd>
          </div>
          <div class="sm:col-span-2">
            <dt class="qs-type-compact-label mb-1">
              {{ t(detail.status === 'REJECTED' ? 'salesReceipt.rejectedReason' : 'salesReceipt.reviewRemark') }}
            </dt><dd class="qs-type-body m-0 whitespace-pre-wrap break-words">
              {{ detail.reviewRemark || '—' }}
            </dd>
          </div>
        </dl>
      </section>
      <section class="space-y-3">
        <h3 class="qs-type-section-title m-0">
          {{ t('salesReceipt.voucherTitle') }}
        </h3>
        <div class="p-4 border border-border rounded-xl space-y-3">
          <FaImagePreview v-if="detail.voucher.mediaType === 'IMAGE'" :src="`/api/sales-receipt-requests/${encodeURIComponent(detail.id)}/voucher`" :aria-label="detail.voucher.title" class="rounded-lg max-h-56 max-w-full object-contain" />
          <a :href="`/api/sales-receipt-requests/${encodeURIComponent(detail.id)}/voucher`" target="_blank" rel="noopener noreferrer" class="qs-type-data text-primary flex gap-2 min-h-11 break-all items-center"><FaIcon name="i-lucide:external-link" class="shrink-0 size-4" />{{ detail.voucher.title }}</a>
          <p class="qs-type-meta m-0">
            {{ detail.voucher.mimeType }}
          </p>
        </div>
      </section>
      <section v-if="detail.approvedPayment" class="space-y-3">
        <h3 class="qs-type-section-title m-0">
          {{ t('salesReceipt.posted') }}
        </h3>
        <FaAlert v-if="detail.approvedPayment.origin === 'LEGACY'" :title="t('salesReceipt.legacy')" />
        <template v-else>
          <ReceiptPostingSummary v-if="detail.approvedPayment.posting" :snapshot="detail.approvedPayment.posting" :currencies="currencyCatalog.currencies.value" />
          <dl class="m-0 gap-4 grid sm:grid-cols-2">
            <div>
              <dt class="qs-type-compact-label mb-1">
                {{ t('salesReceipt.rate') }}
              </dt><dd class="qs-type-data font-mono m-0 break-words">
                {{ detail.approvedPayment.foreignUnitsPerCnySnapshot }} {{ detail.currencyCode }}/CNY
              </dd>
            </div>
            <div>
              <dt class="qs-type-compact-label mb-1">
                {{ t('salesReceipt.rateCapturedAt') }}
              </dt><dd class="qs-type-data m-0">
                <DateTimeDisplay :value="detail.approvedPayment.exchangeRateCapturedAt" />
              </dd>
            </div>
          </dl>
        </template>
      </section>
      <section v-if="detail.approvedPayment?.voidedAt" class="p-4 border border-destructive/25 rounded-xl bg-destructive/5 space-y-3">
        <h3 class="qs-type-section-title text-destructive m-0">
          {{ t('salesReceipt.voided') }}
        </h3>
        <dl class="m-0 space-y-3">
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.voidedAt') }}
            </dt><dd class="qs-type-data m-0">
              <DateTimeDisplay :value="detail.approvedPayment.voidedAt" />
            </dd>
          </div>
          <div>
            <dt class="qs-type-compact-label mb-1">
              {{ t('salesReceipt.voidReason') }}
            </dt><dd class="qs-type-body m-0 whitespace-pre-wrap break-words">
              {{ detail.approvedPayment.voidReason }}
            </dd>
          </div>
        </dl>
      </section>
      <section v-if="detail.approvedPayment?.reversal" class="space-y-3">
        <h3 class="qs-type-section-title m-0">
          {{ t('salesReceipt.reversal') }}
        </h3>
        <ReceiptPostingSummary :snapshot="detail.approvedPayment.reversal" reversal :currencies="currencyCatalog.currencies.value" />
      </section>
      <FaCollapsible class="border border-border rounded-xl overflow-hidden [&_[data-slot=collapsible-trigger]]:w-full">
        <template #trigger="{ open }">
          <span class="qs-type-compact-label p-4 flex gap-3 min-h-11 items-center justify-between"><span>{{ t('salesReceipt.trace') }}</span><FaIcon name="i-lucide:chevron-down" class="size-4" :class="open ? 'rotate-180' : ''" /></span>
        </template>
        <dl class="m-0 p-4 border-t border-border bg-muted/15 gap-4 grid sm:grid-cols-2">
          <div v-for="[label, value] in traceRows" :key="String(label)" class="min-w-0">
            <dt class="qs-type-compact-label mb-1">
              {{ label }}
            </dt><dd class="qs-type-meta font-mono m-0 select-all break-all">
              {{ value }}
            </dd>
          </div>
        </dl>
      </FaCollapsible>
      <section v-if="action" ref="actionSection" tabindex="-1" class="p-4 border border-primary/30 rounded-xl bg-primary/5 space-y-4">
        <h3 class="qs-type-section-title m-0">
          {{ t(`salesReceipt.${action}`) }}
        </h3>
        <FaAlert v-if="contextError" variant="destructive" :title="contextError" role="alert" />
        <template v-if="action === 'approve' && context">
          <ReceiptPostingSummary :snapshot="context" :currencies="currencyCatalog.currencies.value" />
          <p class="qs-type-data m-0">
            {{ t('salesReceipt.rate') }}: <span class="font-mono">{{ context.foreignUnitsPerCny }} {{ detail.currencyCode }}/CNY</span>
          </p>
          <p class="qs-type-meta m-0">
            {{ t('salesReceipt.previewHint') }}
          </p>
        </template>
        <template v-if="action === 'void'">
          <FaAlert :title="t(detail.approvedPayment?.origin === 'LEGACY' ? 'salesReceipt.legacy' : 'salesReceipt.voidHint')" />
          <div v-for="(entry, index) in entries" :key="index" class="qs-type-data flex flex-wrap gap-2 justify-between">
            <span>{{ t(`salesReceipt.target.${entry.accountTarget}`) }} · {{ t('salesReceipt.debit') }}</span><AmountDisplay :value="entry.amount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
          </div>
        </template>
        <FaForm :model="{ reason }" :disabled="busy" @submit="submit">
          <FaFormItem name="reason" :label="t('salesReceipt.reason')" :required="action !== 'approve'">
            <FaTextarea v-model="reason" :maxlength="500" :disabled="busy" :aria-label="t('salesReceipt.reason')" />
          </FaFormItem>
        </FaForm>
      </section>
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
