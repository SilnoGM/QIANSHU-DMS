<script setup lang="ts">
import type { PurchaseOrderRecordCounts, PurchaseOrderRecordsKind } from './purchase-order-records-modal.logic'
import { getPurchaseOrderRecordCount, PURCHASE_ORDER_RECORD_ICONS } from './purchase-order-records-modal.logic'

const props = defineProps<{
  kind: PurchaseOrderRecordsKind
  order: PurchaseOrderRecordCounts
}>()
const emit = defineEmits<{ open: [] }>()
const { t } = useI18n()
const count = computed(() => getPurchaseOrderRecordCount(props.kind, props.order))
</script>

<template>
  <FaButton
    type="button"
    variant="ghost"
    class="font-medium px-2 py-1.5 gap-2 h-auto"
    :aria-label="t('purchaseOrderList.records.open', { count, name: t(`purchaseOrderList.records.${kind}`) })"
    @click="emit('open')"
  >
    <FaIcon :name="PURCHASE_ORDER_RECORD_ICONS[kind]" class="text-primary size-4" aria-hidden="true" />
    {{ t(kind === 'documents' ? 'purchaseOrderList.records.voucherCount' : 'purchaseOrderList.records.recordCount', { count }) }}
  </FaButton>
</template>
