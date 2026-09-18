<script setup lang="ts">
import type { PackagingCostContext, PackagingCostDraft } from './packaging-cost.logic'
import type { PackagingCostRequestDto, PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import PackagingCostModal from './packaging-cost-modal.vue'
import { buildPackagingPaymentRequestText } from './packaging-cost.logic'
import PackagingHistoryModal from './packaging-history-modal.vue'
import { usePackagingCostContext } from './use-packaging-cost-context'
import { usePackagingCostSubmission } from './use-packaging-cost-submission'

const props = defineProps<{ shipment: PurchaseShipmentListItemDto, enabled: boolean }>()
const emit = defineEmits<{ close: [], submitted: [] }>()
const { t } = useI18n()
const account = useAppAccountStore()
const router = useRouter()
const toast = useQsToast()
const { auth } = useAppAuth()
const canCreate = computed(() => props.enabled && auth('packaging-costs:create'))
const visible = ref(true)
const handlingSubmit = ref(false)
let completed = false
const { context: source, loading, error, eligible, unavailableReason, reload } = usePackagingCostContext(
  computed(() => canCreate.value && visible.value),
  computed(() => account.authEpoch),
  computed(() => visible.value ? props.shipment.id : null),
)
const context = computed<PackagingCostContext>(() => ({
  shipmentId: props.shipment.id,
  shipmentNo: source.value ? source.value.shipmentNo : props.shipment.shipmentNo,
  shippingMarkText: source.value ? source.value.shippingMarkText : props.shipment.shippingMarkText,
  purchaseOrderNo: source.value ? source.value.purchaseOrderNo : props.shipment.purchaseOrder.orderNo,
  salesOrderNo: source.value ? source.value.salesOrderNo : props.shipment.salesSource?.orderNo ?? null,
  ownerName: source.value?.owner?.name ?? null,
}))
const submitDisabledHint = computed(() => !loading.value && !error.value && unavailableReason.value
  ? t(`warehousePackagingCost.${unavailableReason.value}`)
  : '')
const historyConfirmed = ref(false)
const historyChecked = computed(() => source.value !== null && Array.isArray(source.value.existingRequests))
const existingRequests = computed(() => source.value?.existingRequests ?? [])
const historyError = computed(() => error.value || (!loading.value && source.value && !historyChecked.value ? t('warehousePackagingCost.history.checkFailed') : ''))
const formVisible = computed(() => visible.value && canCreate.value && !loading.value && !historyError.value && historyChecked.value && (existingRequests.value.length === 0 || historyConfirmed.value))
function confirmContinue(): void {
  if (visible.value && canCreate.value && eligible.value && !loading.value && !historyError.value && historyChecked.value) {
    historyConfirmed.value = true
  }
}
// 重新查询、换货件或换账号后必须针对新结果确认，不能沿用上一批记录的选择。
watch([source, () => props.shipment.id, () => account.authEpoch, canCreate], () => {
  historyConfirmed.value = false
}, { flush: 'sync' })

const submission = usePackagingCostSubmission(
  computed(() => canCreate.value && visible.value),
  computed(() => account.authEpoch),
  computed(() => props.shipment.id),
)
async function copyPaymentRequest(request: PackagingCostRequestDto, epoch: number): Promise<void> {
  const current = () => account.authEpoch === epoch && auth('packaging-costs:create')
  if (!current()) {
    return
  }
  try {
    const href = router.resolve({ name: 'qsFinanceRealtimePackagingPayment', params: { requestId: request.id } }).href
    await navigator.clipboard.writeText(buildPackagingPaymentRequestText(request, href, window.location.href))
    if (current()) {
      toast.success(t('warehousePackagingCost.submitCopied'))
    }
  }
  catch {
    if (current()) {
      // 提报已经落库，复制失败只能重试剪贴板操作，不能重发提报请求。
      toast.warning(t('warehousePackagingCost.submitCopyFailed'), {
        duration: Number.POSITIVE_INFINITY,
        description: t('warehousePackagingCost.copyRetryHint'),
        action: { label: t('warehousePackagingCost.retryCopy'), onClick: () => { void copyPaymentRequest(request, epoch) } },
      })
    }
  }
}
async function submit(draft?: PackagingCostDraft): Promise<void> {
  if (!eligible.value || !formVisible.value || handlingSubmit.value || completed) {
    return
  }
  const epoch = account.authEpoch
  handlingSubmit.value = true
  try {
    const result = await submission.submit(draft)
    if (result) {
      completed = true
      await copyPaymentRequest(result, epoch)
      emit('submitted')
      visible.value = false
    }
  }
  finally {
    handlingSubmit.value = false
  }
}
watch(visible, (value) => {
  if (!value) {
    emit('close')
  }
}, { flush: 'sync' })
</script>

<template>
  <PackagingHistoryModal
    v-if="!formVisible" v-model="visible" :context="context" :records="existingRequests"
    :loading="loading" :error="historyError || null" :continue-disabled="!eligible || !canCreate || !historyChecked"
    :unavailable-hint="submitDisabledHint" :can-modify="canCreate && historyChecked" @reload="reload" @updated="reload" @continue="confirmContinue"
  />
  <PackagingCostModal
    v-else v-model="visible" :context="context" :loading="loading" :error="error || null"
    :submitting="submission.busy.value || handlingSubmit" :draft-locked="submission.pending.value" :submit-error="submission.error.value" :submit-disabled="!eligible || !canCreate" :submit-disabled-hint="submitDisabledHint"
    @reload="reload" @submit="submit" @retry-submit="submit()"
  />
</template>
