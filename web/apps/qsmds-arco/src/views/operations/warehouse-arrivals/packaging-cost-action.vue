<script setup lang="ts">
import type { PackagingCostContext, PackagingCostDraft } from './packaging-cost.logic'
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import PackagingCostModal from './packaging-cost-modal.vue'
import { usePackagingCostContext } from './use-packaging-cost-context'
import { usePackagingCostSubmission } from './use-packaging-cost-submission'

const props = defineProps<{ shipment: PurchaseShipmentListItemDto, enabled: boolean }>()
const emit = defineEmits<{ close: [], submitted: [] }>()
const { t } = useI18n()
const account = useAppAccountStore()
const toast = useQsToast()
const { auth } = useAppAuth()
const canCreate = computed(() => props.enabled && auth('packaging-costs:create'))
const visible = ref(true)
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

const submission = usePackagingCostSubmission(
  computed(() => canCreate.value && visible.value),
  computed(() => account.authEpoch),
  computed(() => props.shipment.id),
)
async function submit(draft?: PackagingCostDraft): Promise<void> {
  if (!eligible.value || !visible.value || !canCreate.value) {
    return
  }
  const result = await submission.submit(draft)
  if (result) {
    toast.success(t('warehousePackagingCost.submitSuccess'))
    emit('submitted')
    visible.value = false
  }
}
watch(visible, (value) => {
  if (!value) {
    emit('close')
  }
}, { flush: 'sync' })
</script>

<template>
  <PackagingCostModal
    v-model="visible" :context="context" :loading="loading" :error="error || null"
    :submitting="submission.busy.value" :draft-locked="submission.pending.value" :submit-error="submission.error.value" :submit-disabled="!eligible || !canCreate" :submit-disabled-hint="submitDisabledHint"
    @reload="reload" @submit="submit" @retry-submit="submit()"
  />
</template>
