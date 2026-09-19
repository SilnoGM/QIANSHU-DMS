<script setup lang="ts">
import purchaseApi from '@/api/modules/purchase-orders'
import shipmentApi from '@/api/modules/purchase-shipments'
import salesApi from '@/api/modules/sales-orders'
import QsPurchaseOrderDrawer from '@/components/business/QsPurchaseOrderDrawer/index.vue'
import QsSalesOrderDrawer from '@/components/business/QsSalesOrderDrawer/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import ShipmentDetailDrawer from '../shipments/shipment-detail-drawer.vue'
import { useContainerResource } from './use-container-resource'

const props = defineProps<{
  kind: 'shipment' | 'purchase' | 'sales' | null
  id: string
  enabled: boolean
}>()
const emit = defineEmits<{
  close: [
  ]
  purchase: [
        id: string,
  ]
}>()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const epoch = computed(() => account.authEpoch)
const currencies = useCurrencyCatalog()
const key = computed(() => props.id)
const shipment = useContainerResource(computed(() => props.enabled && props.kind === 'shipment' && auth('purchase-orders:read')), epoch, key, async signal => (await shipmentApi.getById(props.id, signal)).data)
const purchase = useContainerResource(computed(() => props.enabled && props.kind === 'purchase' && auth('purchase-orders:read')), epoch, key, async signal => (await purchaseApi.getById(props.id, signal)).data)
const sales = useContainerResource(computed(() => props.enabled && props.kind === 'sales' && auth('sales-orders:read')), epoch, key, async signal => (await salesApi.getById(props.id, signal)).data)
</script>

<template>
  <ShipmentDetailDrawer :model-value="kind === 'shipment' && enabled && auth('purchase-orders:read')" :detail="shipment.data.value" :loading="shipment.loading.value" :error="shipment.error.value || null" @update:model-value="!$event && emit('close')" @reload="shipment.reload" @view-order="emit('purchase', $event)" />
  <QsPurchaseOrderDrawer :model-value="kind === 'purchase' && enabled && auth('purchase-orders:read')" :order="null" :detail="purchase.data.value" :loading="purchase.loading.value" :error="purchase.error.value || null" :currencies="currencies.currencies.value" action-error="" :busy="false" :can-attach-document="false" @update:model-value="!$event && emit('close')" @reload="purchase.reload" />
  <QsSalesOrderDrawer :model-value="kind === 'sales' && enabled && auth('sales-orders:read')" :order="null" :detail="sales.data.value" :loading="sales.loading.value" :error="sales.error.value || null" :currencies="currencies.currencies.value" @update:model-value="!$event && emit('close')" @reload="sales.reload" />
</template>
