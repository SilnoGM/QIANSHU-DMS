<script setup lang="ts">
import type { SalesReceiptApprovalContextDto, SalesReceiptRequestDetailDto } from '@/api/generated/types.gen'
import salesOrdersApi from '@/api/modules/sales-orders'
import salesReceiptsApi from '@/api/modules/sales-receipts'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericModal from '@/components/business/QsGenericModal/index.vue'
import { getSalesOrderApiFailure } from '../../operations/sales-orders/sales-order-create.logic'

const props = defineProps<{ requestId: string | null }>()
const emit = defineEmits<{ close: [], changed: [] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const toast = useQsToast()
const detail = shallowRef<SalesReceiptRequestDetailDto | null>(null)
const context = shallowRef<SalesReceiptApprovalContextDto | null>(null)
const loading = ref(false)
const busy = ref(false)
const error = ref('')
const contextError = ref('')
const reason = ref('')
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
  <QsGenericModal v-model="visible" :title="t('salesReceipt.detail')" :description="detail?.salesOrder.orderNo" size="lg" :loading="loading" :error="error || null" :submitting="busy" :dismiss-on-escape="!busy" :dismiss-on-overlay="!busy">
    <template #error-actions>
      <FaButton variant="outline" @click="load">
        {{ t('salesReceipt.refresh') }}
      </FaButton>
    </template>
    <div v-if="detail" class="space-y-5">
      <div class="flex flex-wrap gap-2 items-center">
        <FaTag variant="outline">
          {{ t(`salesReceipt.status.${detail.status}`) }}
        </FaTag><FaTag v-if="detail.approvedPayment?.voidedAt" variant="outline">
          {{ t('salesReceipt.voided') }}
        </FaTag><strong class="font-mono">{{ detail.amount }} {{ detail.currencyCode }}</strong>
      </div>
      <dl class="m-0 gap-4 grid sm:grid-cols-2">
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesReceipt.order') }}
          </dt><dd class="m-0 break-words">
            {{ detail.salesOrder.orderNo }} · {{ detail.salesOrder.customerName }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesReceipt.owner') }}
          </dt><dd class="m-0">
            {{ detail.accountOwner.name }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesReceipt.receivedAt') }}
          </dt><dd class="m-0">
            <DateTimeDisplay :value="detail.receivedAt" />
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesReceipt.method') }}
          </dt><dd class="m-0">
            {{ detail.paymentMethodNameSnapshot }}
          </dd>
        </div>
        <div>
          <dt class="text-muted-foreground">
            {{ t('salesReceipt.submittedAt') }}
          </dt><dd class="m-0">
            {{ detail.submittedBy.name }} · <DateTimeDisplay :value="detail.submittedAt" />
          </dd>
        </div>
        <div v-if="detail.reviewedAt">
          <dt class="text-muted-foreground">
            {{ t('salesReceipt.reviewedAt') }}
          </dt><dd class="m-0">
            {{ detail.reviewedBy?.name }} · <DateTimeDisplay :value="detail.reviewedAt" />
          </dd>
        </div>
      </dl>
      <p v-if="detail.remark" class="break-words">
        {{ t('salesReceipt.remark') }}: {{ detail.remark }}
      </p>
      <p v-if="detail.reviewRemark" class="break-words">
        {{ t('salesReceipt.reviewRemark') }}: {{ detail.reviewRemark }}
      </p>
      <FaImagePreview v-if="detail.voucher.mediaType === 'IMAGE'" :src="`/api/sales-receipt-requests/${encodeURIComponent(detail.id)}/voucher`" :aria-label="detail.voucher.title" class="rounded-lg max-h-60 max-w-full object-contain" />
      <a :href="`/api/sales-receipt-requests/${encodeURIComponent(detail.id)}/voucher`" target="_blank" rel="noopener noreferrer" class="text-primary underline inline-flex min-h-11 items-center">{{ t('salesReceipt.voucher') }}: {{ detail.voucher.title }}</a>
      <section v-if="detail.approvedPayment" class="p-4 border border-border rounded-lg space-y-2">
        <h3 class="font-semibold m-0">
          {{ t('salesReceipt.posted') }}
        </h3>
        <p v-if="detail.approvedPayment.origin === 'LEGACY'">
          {{ t('salesReceipt.legacy') }}
        </p>
        <template v-else>
          <p class="font-mono">
            {{ t('salesReceipt.rate') }}: {{ detail.approvedPayment.foreignUnitsPerCnySnapshot }} {{ detail.currencyCode }}/CNY
          </p>
          <p>{{ t('salesReceipt.totalCny') }}: <span class="font-mono">{{ detail.approvedPayment.posting?.businessAmount }} CNY</span></p>
          <p>{{ t('salesReceipt.share') }}: {{ detail.approvedPayment.posting?.userShareRate }}% / {{ detail.approvedPayment.posting?.companyShareRate }}%</p>
          <p v-for="(entry, index) in detail.approvedPayment.posting?.entries" :key="index">
            {{ t(`salesReceipt.target.${entry.accountTarget}`) }}: <span class="font-mono">{{ entry.amount }} CNY</span>
          </p>
          <p class="text-xs text-muted-foreground break-all">
            {{ t('salesReceipt.batch') }}: {{ detail.approvedPayment.fundPostingBatchId }}
          </p>
          <p class="text-xs text-muted-foreground break-all">
            {{ t('salesReceipt.rateVersion') }}: {{ detail.approvedPayment.exchangeRateId }} · v{{ detail.approvedPayment.exchangeRateVersionSnapshot }}
          </p>
          <p class="text-xs text-muted-foreground break-all">
            {{ t('salesReceipt.ruleVersion') }}: {{ detail.approvedPayment.posting?.ruleVersionId }} · v{{ detail.approvedPayment.posting?.ruleRevisionSnapshot }}
          </p>
        </template>
        <p v-if="detail.approvedPayment.voidedAt" class="break-words">
          {{ t('salesReceipt.voided') }}: <DateTimeDisplay :value="detail.approvedPayment.voidedAt" /> · {{ detail.approvedPayment.voidReason }}
        </p>
      </section>
      <section v-if="detail.approvedPayment?.reversal" class="p-4 border border-border rounded-lg space-y-2">
        <h3 class="font-semibold m-0">
          {{ t('salesReceipt.reversal') }}
        </h3>
        <p class="text-xs text-muted-foreground break-all">
          {{ t('salesReceipt.batch') }}: {{ detail.approvedPayment.reversal.batchId }}
        </p>
        <p v-for="(entry, index) in detail.approvedPayment.reversal.entries" :key="index">
          {{ t(`salesReceipt.target.${entry.accountTarget}`) }} · {{ t('salesReceipt.debit') }} <span class="font-mono">{{ entry.amount }} CNY</span>
        </p>
      </section>
      <div v-if="action === null" class="flex flex-wrap gap-3">
        <template v-if="detail.status === 'PENDING_REVIEW' && canReview">
          <FaButton @click="prepare('approve')">
            {{ t('salesReceipt.prepare') }}
          </FaButton><FaButton variant="outline" @click="prepare('reject')">
            {{ t('salesReceipt.reject') }}
          </FaButton>
        </template>
        <FaButton v-if="detail.approvedPayment && !detail.approvedPayment.voidedAt && detail.salesOrder.orderStatus !== 'COMPLETED' && canVoid" variant="outline" @click="prepare('void')">
          {{ t('salesReceipt.void') }}
        </FaButton>
      </div>
      <section v-else class="p-4 border border-border rounded-lg space-y-4">
        <h3 class="font-semibold m-0">
          {{ t(`salesReceipt.${action}`) }}
        </h3>
        <FaAlert v-if="contextError" variant="destructive" :title="contextError" role="alert" />
        <template v-if="action === 'approve' && context">
          <p>{{ t('salesReceipt.rate') }}: <span class="font-mono">{{ context.foreignUnitsPerCny }} {{ detail.currencyCode }}/CNY</span></p>
          <p>{{ t('salesReceipt.totalCny') }}: <span class="font-mono">{{ context.businessAmount }} CNY</span></p>
          <p>{{ t('salesReceipt.share') }}: {{ context.userShareRate }}% / {{ context.companyShareRate }}%</p>
          <p class="text-sm text-muted-foreground">
            {{ t('salesReceipt.previewHint') }}
          </p>
        </template>
        <p v-if="action === 'void'" class="text-sm text-destructive">
          {{ t('salesReceipt.voidHint') }}
        </p>
        <ul v-if="action !== 'reject'" class="space-y-2">
          <li v-for="(entry, index) in entries" :key="index">
            {{ t(`salesReceipt.target.${entry.accountTarget}`) }} · {{ action === 'void' ? t('salesReceipt.debit') : t('salesReceipt.credit') }} <span class="font-mono">{{ entry.amount }} CNY</span>
          </li>
        </ul>
        <label class="block space-y-2"><span>{{ t('salesReceipt.reason') }}{{ action !== 'approve' ? ' *' : '' }}</span><FaTextarea v-model="reason" :maxlength="500" :disabled="busy" :aria-label="t('salesReceipt.reason')" /></label>
        <div class="flex flex-wrap gap-3">
          <FaButton variant="outline" :disabled="busy" @click="action = null">
            {{ t('salesReceipt.cancel') }}
          </FaButton>
          <FaButton v-if="action === 'approve' && !context" variant="outline" :loading="busy" @click="prepare('approve')">
            {{ t('salesReceipt.refreshPreview') }}
          </FaButton>
          <FaButton :loading="busy" :disabled="busy || (action === 'approve' && !context)" @click="submit">
            {{ t('salesReceipt.confirm') }}
          </FaButton>
          <FaButton v-if="contextError" variant="outline" :disabled="busy" @click="load">
            {{ t('salesReceipt.refresh') }}
          </FaButton>
        </div>
      </section>
    </div>
  </QsGenericModal>
</template>
