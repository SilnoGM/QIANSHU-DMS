<script setup lang="ts">
import type { PurchaseOrderDetailDto } from '@/api/generated/types.gen'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsWarehouseReceiptModal from '@/components/business/QsWarehouseReceiptModal/index.vue'
import { useWarehouseReceipt } from './use-warehouse-receipt'

const props = defineProps<{ active: boolean }>()
const emit = defineEmits<{ detailUpdated: [detail: PurchaseOrderDetailDto], busyChange: [busy: boolean] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const toast = useQsToast()
const enabled = computed(() => props.active && auth('purchase-orders:read') && auth('purchase-orders:update'))
const { visible, detail, scopeIds, loadingOrderId, submitting, error, needsReload, open, reload, submit, reset } = useWarehouseReceipt(enabled, computed(() => account.authEpoch), (updated) => {
  emit('detailUpdated', updated)
  toast.success(t('purchaseWarehouseReceipt.success'))
})
function setVisible(value: boolean): void {
  if (!value && !submitting.value) {
    reset()
  }
}
watch(() => submitting.value || loadingOrderId.value !== null, value => emit('busyChange', value))
onDeactivated(reset)
defineExpose({ open, reset, loadingOrderId })
</script>

<template>
  <QsWarehouseReceiptModal :model-value="visible" :detail="detail" :scope-ids="scopeIds" :loading="loadingOrderId !== null" :submitting="submitting" :error="error" :needs-reload="needsReload" @update:model-value="setVisible" @reload="reload" @submit="submit" />
</template>
