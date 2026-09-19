<script setup lang="ts">
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import shipmentApi from '@/api/modules/purchase-shipments'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useContainerResource } from './use-container-resource'

const props = defineProps<{
  warehouseValue: string
  disabled?: boolean
}>()
const emit = defineEmits<{
  select: [
        shipment: PurchaseShipmentListItemDto,
  ]
  close: [
  ]
}>()
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const enabled = computed(() => auth('purchase-orders:read') && !props.disabled)
const page = ref(1)
const search = ref('')
const query = computed(() => ({ page: page.value, pageSize: 10, keyword: search.value || undefined, destinationWarehouseValue: props.warehouseValue, view: 'ALL' as const }))
const resource = useContainerResource(enabled, computed(() => account.authEpoch), query, async signal => (await shipmentApi.list(query.value, signal)).data)
const { data, loading, error } = resource
function shipmentLabel(row: PurchaseShipmentListItemDto) {
  return row.shippingMarkText || row.shipmentNo || `${t('containerPage.shipment')}-${String(row.partNumber).padStart(2, '0')}`
}
const columns = computed<QsGenericTableColumn<PurchaseShipmentListItemDto>[]>(() => [
  { id: 'shipment', title: t('containerPage.shipment'), accessorFn: shipmentLabel, minWidth: 190 },
  { id: 'purchase', title: t('containerPage.purchase'), accessorFn: row => row.purchaseOrder.orderNo, minWidth: 210 },
  { id: 'goods', title: t('containerPage.goods'), accessorFn: row => row.lineSummary.previews.map(item => item.productName).join('、'), minWidth: 150 },
])
</script>

<template>
  <section class="mt-4 p-3 border border-border rounded-lg bg-muted/20 min-w-0">
    <div class="mb-3 flex gap-3 items-center justify-between">
      <h3 class="qs-type-component-title">
        {{ t('containerPage.shipmentSelect') }}
      </h3><FaButton type="button" variant="ghost" size="sm" @click="emit('close')">
        {{ t('containerPage.cancelSelect') }}
      </FaButton>
    </div>
    <p class="qs-type-meta text-muted-foreground mb-3">
      {{ t('containerPage.shipmentHint') }}
    </p>
    <FaAlert v-if="!auth('purchase-orders:read')" :title="t('containerPage.shipmentPermission')" />
    <QsGenericTable v-else v-model:page="page" v-model:search="search" :page-size="10" :page-size-options="[10]" :columns="columns" :data="data?.items ?? []" :total="data?.total ?? 0" :loading="loading" :error="error" :addable="false" :show-column-settings="false" :show-row-number="false" :search-placeholder="t('containerPage.shipmentSearch')" :action-column="{ width: 115 }" @retry="resource.reload">
      <template #mobile-row="{ row }">
        <div class="[overflow-wrap:anywhere] space-y-1">
          <strong>{{ shipmentLabel(row) }}</strong><div class="qs-type-data">
            {{ row.purchaseOrder.orderNo }}
          </div>
        </div>
      </template>
      <template #actions="{ row }">
        <FaButton type="button" size="sm" variant="outline" :disabled="disabled || row.status !== 'ACTIVE'" @click="emit('select', row)">
          {{ t('containerPage.select') }}
        </FaButton>
      </template>
    </QsGenericTable>
  </section>
</template>
