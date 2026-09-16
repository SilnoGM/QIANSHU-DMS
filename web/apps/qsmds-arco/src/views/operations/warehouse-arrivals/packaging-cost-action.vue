<script setup lang="ts">
import type { PackagingCostContext } from './packaging-cost.logic'
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import PackagingCostModal from './packaging-cost-modal.vue'
import { usePackagingCostContext } from './use-packaging-cost-context'

const props = defineProps<{ shipment: PurchaseShipmentListItemDto, enabled: boolean }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const account = useAppAccountStore()
const toast = useQsToast()
const visible = ref(true)
const { shipment, owner, loading, error, eligible, unavailableReason, reload } = usePackagingCostContext(
  computed(() => props.enabled && visible.value),
  computed(() => account.authEpoch),
  computed(() => visible.value ? props.shipment.id : null),
)
const context = computed<PackagingCostContext>(() => {
  const current = shipment.value ?? props.shipment
  return {
    shipmentId: current.id,
    shipmentNo: current.shipmentNo,
    shippingMarkText: current.shippingMarkText,
    purchaseOrderNo: current.purchaseOrder.orderNo,
    salesOrderNo: current.salesSource?.orderNo ?? null,
    ownerName: owner.value?.displayName ?? null,
  }
})
const submitDisabledHint = computed(() => !loading.value && !error.value && unavailableReason.value
  ? t(`warehousePackagingCost.${unavailableReason.value}`)
  : '')

function submit(): void {
  if (eligible.value && visible.value) {
    // 本轮仅提供表单交互：文件保留在浏览器，不能写入费用、附件或宣称提交成功。
    toast.info(t('warehousePackagingCost.submitUnavailable'))
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
    :submitting="false" :submit-disabled="!eligible" :submit-disabled-hint="submitDisabledHint"
    @reload="reload" @submit="submit"
  />
</template>
