<script setup lang="ts">
import type { PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import shipmentApi from '@/api/modules/purchase-shipments'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
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
/** 装柜是到仓后的作业：只有已到仓的有效货件可选，与服务端资格校验同一口径。 */
function selectable(row: PurchaseShipmentListItemDto) {
  return row.status === 'ACTIVE' && row.warehouseReceivedAt !== null
}
const columns = computed<QsGenericTableColumn<PurchaseShipmentListItemDto>[]>(() => [
  { id: 'shipment', title: t('containerManagement.shipmentAndSource'), accessorFn: shipmentLabel, minWidth: 255 },
  { id: 'goods', title: t('purchaseShipments.products'), accessorFn: row => row.lineSummary.previews.map(item => item.productName).join('、'), minWidth: 150 },
  { id: 'status', title: t('purchaseShipments.status'), accessorFn: row => t(`purchaseShipments.${row.viewStatus}`), minWidth: 90 },
])
</script>

<template>
  <section class="mt-4 pt-4 border-t border-border min-w-0">
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
    <QsGenericTable v-else v-model:page="page" v-model:search="search" :page-size="10" :page-size-options="[10]" :columns="columns" :data="data?.items ?? []" :total="data?.total ?? 0" :loading="loading" :error="error" :addable="false" :show-column-settings="false" :show-row-number="false" :search-placeholder="t('containerPage.shipmentSearch')" :action-column="{ width: 100 }" @retry="resource.reload">
      <template #cell-shipment="{ row }">
        <QsTableStackedCell>
          <QsTableStackedLine content-class="qs-type-data-emphasis [overflow-wrap:anywhere]">
            {{ shipmentLabel(row.original) }}
          </QsTableStackedLine>
          <QsTableStackedLine v-if="row.original.shipmentNo && row.original.shipmentNo !== shipmentLabel(row.original)" tone="muted" content-class="qs-type-data">
            {{ row.original.shipmentNo }}
          </QsTableStackedLine>
          <QsTableStackedLine :label="t('containerManagement.purchaseSource')" tone="muted" content-class="qs-type-data">
            {{ row.original.purchaseOrder.orderNo }}
          </QsTableStackedLine>
          <QsTableStackedLine v-if="row.original.salesSource" :label="t('containerManagement.salesSource')" tone="muted" content-class="qs-type-data">
            {{ row.original.salesSource.orderNo }}
          </QsTableStackedLine>
        </QsTableStackedCell>
      </template>
      <template #cell-goods="{ row }">
        <span class="[overflow-wrap:anywhere] line-clamp-2" :title="row.original.lineSummary.previews.map(item => item.productName).join('、')">{{ row.original.lineSummary.previews.map(item => item.productName).join('、') || '—' }}</span>
      </template>
      <template #cell-status="{ row }">
        <FaTag variant="outline" class="qs-type-status-tag whitespace-nowrap" :class="row.original.status === 'ACTIVE' ? 'text-primary border-primary/25 bg-primary/5' : 'text-muted-foreground'">
          {{ t(`purchaseShipments.${row.original.viewStatus}`) }}
        </FaTag>
      </template>
      <template #mobile-row="{ row }">
        <div class="[overflow-wrap:anywhere] space-y-2">
          <div class="flex gap-3 items-start justify-between">
            <strong class="qs-type-data-emphasis min-w-0">{{ shipmentLabel(row) }}</strong>
            <FaTag variant="outline" class="qs-type-status-tag shrink-0">
              {{ t(`purchaseShipments.${row.viewStatus}`) }}
            </FaTag>
          </div>
          <p class="qs-type-body m-0">
            {{ row.lineSummary.previews.map(item => item.productName).join('、') || '—' }}
          </p>
          <QsTableStackedCell>
            <QsTableStackedLine :label="t('containerManagement.purchaseSource')" tone="muted" content-class="qs-type-data">
              {{ row.purchaseOrder.orderNo }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="row.salesSource" :label="t('containerManagement.salesSource')" tone="muted" content-class="qs-type-data">
              {{ row.salesSource.orderNo }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </div>
      </template>
      <template #actions="{ row }">
        <FaButton type="button" size="sm" variant="outline" :disabled="disabled || !selectable(row)" @click="emit('select', row)">
          {{ t(selectable(row) ? 'containerPage.select' : row.status === 'ACTIVE' ? 'containerManagement.shipmentNotReceived' : 'containerManagement.shipmentUnavailable') }}
        </FaButton>
      </template>
    </QsGenericTable>
  </section>
</template>
