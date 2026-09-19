<script setup lang="ts">
import type { ImportDisplayRow } from './use-container-import'
import type { ContainerImportCandidateDto, PurchaseShipmentListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import shipmentApi from '@/api/modules/purchase-shipments'
import QsGenericDrawer from '@/components/business/QsGenericDrawer/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useContainerResource } from '../use-container-resource'

const props = defineProps<{ row: ImportDisplayRow | null, warehouseValue: string, disabled: boolean, enabled: boolean }>()
const emit = defineEmits<{ select: [rowKey: string, candidate: ContainerImportCandidateDto] }>()
const open = defineModel<boolean>({ required: true })
const { t } = useI18n()
const { auth } = useAppAuth()
const account = useAppAccountStore()
const mode = ref('CANDIDATES')
const search = ref('')
const page = ref(1)
const query = computed(() => ({ page: page.value, pageSize: 10, keyword: search.value.trim() || undefined, destinationWarehouseValue: props.warehouseValue, view: 'ALL' as const }))
const searchEnabled = computed(() => props.enabled && open.value && mode.value === 'SEARCH' && auth('purchase-orders:read'))
const resource = useContainerResource(searchEnabled, computed(() => account.authEpoch), query, async signal => (await shipmentApi.list(query.value, signal)).data)
function toCandidate(row: PurchaseShipmentListItemDto): ContainerImportCandidateDto {
  return { id: row.id, shipmentNo: row.shipmentNo, shippingMarkText: row.shippingMarkText, trackingNo: row.trackingNo, warehouseValue: row.destinationWarehouseValue, goodsName: row.lineSummary.previews.map(item => item.productName).join('、'), purchaseOrderNo: row.purchaseOrder.orderNo, salesOrderNo: auth('sales-orders:read') ? row.salesSource?.orderNo ?? null : null, eligible: row.status === 'ACTIVE' && row.destinationWarehouseValue === props.warehouseValue, ineligibleReason: row.status !== 'ACTIVE' ? t('containerImport.unavailable') : null }
}
const candidates = computed(() => mode.value === 'CANDIDATES' ? (props.row?.candidates ?? []).slice((page.value - 1) * 10, page.value * 10) : (resource.data.value?.items ?? []).map(toCandidate))
const total = computed(() => mode.value === 'CANDIDATES' ? props.row?.candidates.length ?? 0 : resource.data.value?.total ?? 0)
watch([() => props.row?.rowKey, open], () => {
  search.value = ''
  page.value = 1
  mode.value = props.row?.candidates.length ? 'CANDIDATES' : 'SEARCH'
})
watch(mode, () => page.value = 1)
function choose(candidate: ContainerImportCandidateDto) {
  if (!props.enabled || props.disabled || !candidate.eligible || !props.row) {
    return
  }
  emit('select', props.row.rowKey, candidate)
  open.value = false
}
const columns = computed<QsGenericTableColumn<ContainerImportCandidateDto>[]>(() => [
  { id: 'shipment', title: t('containerImport.shipment'), accessorFn: row => row.shippingMarkText || row.shipmentNo, minWidth: 235 },
  { id: 'goods', title: t('purchaseShipments.products'), accessorKey: 'goodsName', minWidth: 145 },
])
</script>

<template>
  <QsGenericDrawer v-model="open" size="xl" :title="t('containerImport.drawerTitle')" :description="t('containerImport.drawerHint')" :submitting="disabled">
    <div v-if="row" class="min-w-0 space-y-4">
      <div class="p-4 border border-border rounded-lg bg-muted/30 space-y-2">
        <p class="qs-type-body-medium m-0 [overflow-wrap:anywhere]">
          {{ row.goodsName }} · {{ row.oceanShippingMarkText || '—' }}
        </p>
        <QsTableStackedLine :label="t('containerPage.receipt')" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ row.warehouseReceiptReference || '—' }}
        </QsTableStackedLine>
      </div>
      <QsStatusSwitchToolbar v-model="mode" :items="[{ value: 'CANDIDATES', label: t('containerImport.candidates'), count: row.candidates.length }, { value: 'SEARCH', label: t('containerImport.manualSearch') }]" />
      <p v-if="mode === 'SEARCH'" class="qs-type-meta text-muted-foreground m-0">
        {{ t('containerImport.searchHint') }}
      </p>
      <QsGenericTable v-model:page="page" v-model:search="search" row-key="id" :columns="columns" :data="candidates" :total="total" :page-size="10" :page-size-options="[10]" :searchable="mode === 'SEARCH'" :loading="mode === 'SEARCH' && resource.loading.value" :error="mode === 'SEARCH' ? resource.error.value : ''" :addable="false" :show-column-settings="false" :show-row-number="false" :action-column="{ width: 130 }" :search-placeholder="t('containerImport.shipmentSearch')" :empty-title="t(mode === 'CANDIDATES' ? 'containerImport.noCandidates' : 'containerImport.noSearchResults')" :empty-description="mode === 'CANDIDATES' ? t('containerImport.noCandidatesHint') : undefined" @retry="resource.reload">
        <template #cell-shipment="{ row: candidateRow }">
          <QsTableStackedCell class="w-full whitespace-normal">
            <QsTableStackedLine content-class="qs-type-data-emphasis [overflow-wrap:anywhere]">
              {{ candidateRow.original.shippingMarkText || candidateRow.original.shipmentNo || '—' }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="candidateRow.original.shippingMarkText && candidateRow.original.shipmentNo" tone="muted" content-class="qs-type-data [overflow-wrap:anywhere]">
              {{ candidateRow.original.shipmentNo }}
            </QsTableStackedLine>
            <QsTableStackedLine :label="t('containerImport.tracking')" tone="muted" content-class="qs-type-data [overflow-wrap:anywhere]">
              {{ candidateRow.original.trackingNo || '—' }}
            </QsTableStackedLine>
            <QsTableStackedLine :label="t('containerPage.purchase')" tone="muted" content-class="qs-type-data [overflow-wrap:anywhere]">
              {{ candidateRow.original.purchaseOrderNo || '—' }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="auth('sales-orders:read') && candidateRow.original.salesOrderNo" :label="t('containerPage.sales')" tone="muted" content-class="qs-type-data [overflow-wrap:anywhere]">
              {{ candidateRow.original.salesOrderNo }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-goods="{ row: candidateRow }">
          <span class="[overflow-wrap:anywhere]">{{ candidateRow.original.goodsName }}</span>
          <p v-if="candidateRow.original.ineligibleReason" class="qs-type-meta text-destructive m-0 mt-2">
            {{ candidateRow.original.ineligibleReason }}
          </p>
        </template>
        <template #mobile-row="{ row: candidateRow }">
          <QsTableStackedCell class="w-full whitespace-normal [overflow-wrap:anywhere]">
            <QsTableStackedLine content-class="qs-type-data-emphasis">
              {{ candidateRow.shippingMarkText || candidateRow.shipmentNo || '—' }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="candidateRow.shippingMarkText && candidateRow.shipmentNo" content-class="qs-type-data">
              {{ candidateRow.shipmentNo }}
            </QsTableStackedLine>
            <QsTableStackedLine>{{ candidateRow.goodsName }}</QsTableStackedLine>
            <QsTableStackedLine :label="t('containerImport.tracking')" tone="muted" content-class="qs-type-data">
              {{ candidateRow.trackingNo || '—' }}
            </QsTableStackedLine>
            <QsTableStackedLine :label="t('containerPage.purchase')" tone="muted" content-class="qs-type-data">
              {{ candidateRow.purchaseOrderNo || '—' }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="auth('sales-orders:read') && candidateRow.salesOrderNo" :label="t('containerPage.sales')" tone="muted" content-class="qs-type-data">
              {{ candidateRow.salesOrderNo }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="candidateRow.ineligibleReason" content-class="text-destructive">
              {{ candidateRow.ineligibleReason }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #actions="{ row: candidateRow }">
          <FaButton size="sm" variant="outline" :disabled="disabled || !candidateRow.eligible" @click="choose(candidateRow)">
            {{ t(candidateRow.eligible ? 'containerImport.select' : 'containerImport.unavailable') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </div>
  </QsGenericDrawer>
</template>
