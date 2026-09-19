<script setup lang="ts">
import type { ImportDisplayRow, ImportFilter } from './use-container-import'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { formatContainerMeasurement } from '../display.logic'
import ImportMatchSummary from './import-match-summary.vue'

const props = defineProps<{ rows: ImportDisplayRow[], status: ImportFilter, disabled: boolean }>()
const emit = defineEmits<{ choose: [row: ImportDisplayRow], clear: [row: ImportDisplayRow] }>()
const { t } = useI18n()
const { auth } = useAppAuth()
const { currencies, errorMessage: currencyError } = useCurrencyCatalog()
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const filtered = computed(() => props.rows.filter(row => (props.status === 'ALL' || row.displayStatus === props.status) && (!search.value.trim() || [row.goodsName, row.oceanShippingMarkText, row.warehouseReceiptReference, row.selectedShipment?.shippingMarkText, row.selectedShipment?.shipmentNo].some(value => value?.toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase())))))
const visibleRows = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
watch([() => props.status, search, pageSize], () => page.value = 1)
watch(() => filtered.value.length, count => page.value = Math.max(1, Math.min(page.value, Math.ceil(count / pageSize.value))))
const measurement = (value: string | null, places: 0 | 2 = 0) => formatContainerMeasurement(value, places) ?? '—'
const dimensions = (row: ImportDisplayRow) => `${[row.lengthCm, row.widthCm, row.heightCm].map(value => measurement(value)).join(' × ')} cm`
const columns = computed<QsGenericTableColumn<ImportDisplayRow>[]>(() => [
  { id: 'goods', title: t('containerPage.goods'), accessorKey: 'goodsName', width: 250, minWidth: 250, maxWidth: 250, fixed: 'left' },
  { id: 'match', title: t('containerImport.match'), accessorFn: row => row.selectedShipment?.shippingMarkText || row.selectedShipment?.shipmentNo || t(`containerImport.status.${row.displayStatus}`), width: 250, minWidth: 250, maxWidth: 250 },
  { id: 'receipt', title: t('containerPage.receipt'), accessorKey: 'warehouseReceiptReference', width: 260, minWidth: 260, maxWidth: 260, cellClass: 'qs-type-data whitespace-normal [overflow-wrap:anywhere]' },
  { id: 'orders', title: t('containerImport.orders'), accessorFn: row => row.selectedShipment?.purchaseOrderNo, width: 230, minWidth: 230, maxWidth: 230 },
  { id: 'package', title: t('containerPage.packageCount'), accessorFn: row => `${row.packageCount} ${row.packageUnit || ''}`, width: 100, minWidth: 100, maxWidth: 100, cellClass: 'qs-type-data', align: 'right' },
  { id: 'measurements', title: t('containerPage.weightDimensions'), accessorFn: row => `${measurement(row.grossWeightKg)} kg ${dimensions(row)}`, width: 240, minWidth: 240, maxWidth: 240 },
  { id: 'volume', title: t('containerPage.volume'), accessorFn: row => measurement(row.volumeCai, 2), width: 185, minWidth: 185, maxWidth: 185 },
  { id: 'recipient', title: t('containerPage.recipientInfo'), accessorFn: row => [row.recipientName, row.recipientPhone, row.recipientAddress].filter(Boolean).join(' '), width: 380, minWidth: 380, maxWidth: 380 },
  { id: 'cod', title: t('containerPage.cod'), accessorKey: 'codAmountTwd', width: 170, minWidth: 170, maxWidth: 170, align: 'right' },
  { id: 'remark', title: t('containerPage.remark'), accessorKey: 'remark', width: 220, minWidth: 220, maxWidth: 220 },
  { id: 'issues', title: t('containerImport.issues'), accessorFn: row => [...row.errors, ...row.warnings].join('；'), width: 250, minWidth: 250, maxWidth: 250 },
])
</script>

<template>
  <FaAlert v-if="currencyError" class="mb-4" :title="currencyError" />
  <QsGenericTable v-model:page="page" v-model:page-size="pageSize" v-model:search="search" row-key="rowKey" :columns="columns" :data="visibleRows" :total="filtered.length" :addable="false" :show-row-number="false" :page-size-options="[20, 50, 100]" :search-placeholder="t('containerImport.search')" :action-column="{ width: 104, minWidth: 104, maxWidth: 104, fixed: 'right' }" table-class="w-max min-w-full">
    <template #cell-goods="{ row }">
      <QsTableStackedCell class="w-full whitespace-normal">
        <QsTableStackedLine weight="medium" content-class="[overflow-wrap:anywhere]">
          {{ row.original.goodsName || '—' }}
        </QsTableStackedLine>
        <QsTableStackedLine :tone="row.original.oceanShippingMarkText ? 'success' : 'muted'" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ row.original.oceanShippingMarkText || '—' }}
        </QsTableStackedLine>
        <QsTableStackedLine tone="muted" content-class="qs-type-meta [overflow-wrap:anywhere]">
          {{ t('containerImport.sheetRow', { sheet: row.original.sourceSheetName, row: row.original.sourceRowNumber }) }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-match="{ row }">
      <ImportMatchSummary :row="row.original" />
    </template>
    <template #cell-orders="{ row }">
      <QsTableStackedCell class="w-full whitespace-normal">
        <QsTableStackedLine :label="t('containerPage.purchase')" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ row.original.selectedShipment?.purchaseOrderNo || '—' }}
        </QsTableStackedLine>
        <QsTableStackedLine v-if="auth('sales-orders:read')" :label="t('containerPage.sales')" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ row.original.selectedShipment?.salesOrderNo || '—' }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-measurements="{ row }">
      <QsTableStackedCell class="w-full whitespace-normal">
        <QsTableStackedLine :label="t('containerPage.weightLabel')" content-class="qs-type-data">
          {{ measurement(row.original.grossWeightKg) }} kg
        </QsTableStackedLine>
        <QsTableStackedLine :label="t('containerPage.dimensionsLabel')" content-class="qs-type-data">
          {{ dimensions(row.original) }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-volume="{ row }">
      <QsTableStackedCell class="w-full whitespace-normal">
        <QsTableStackedLine :label="t('containerImport.systemVolume')" content-class="qs-type-data">
          {{ measurement(row.original.volumeCai, 2) }} {{ t('containerManagement.volumeUnit') }}
        </QsTableStackedLine>
        <QsTableStackedLine :label="t('containerImport.sourceVolume')" content-class="qs-type-data">
          {{ measurement(row.original.reportedVolumeCai, 2) }} {{ t('containerManagement.volumeUnit') }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-recipient="{ row }">
      <QsTableStackedCell class="w-full whitespace-normal">
        <QsTableStackedLine>{{ [row.original.recipientName, row.original.recipientPhone].filter(Boolean).join(' · ') || '—' }}</QsTableStackedLine>
        <QsTableStackedLine tone="muted" content-class="[overflow-wrap:anywhere]">
          {{ row.original.recipientAddress || '—' }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-cod="{ row }">
      <AmountDisplay v-if="row.original.codAmountTwd !== null" :value="row.original.codAmountTwd" currency="TWD" :currencies="currencies" class="text-primary" />
      <span v-else class="qs-type-meta text-muted-foreground">{{ t('containerPage.none') }}</span>
    </template>
    <template #cell-remark="{ row }">
      <span class="whitespace-pre-wrap [overflow-wrap:anywhere] line-clamp-2" :title="row.original.remark || ''">{{ row.original.remark || '—' }}</span>
    </template>
    <template #cell-issues="{ row }">
      <p v-for="(issue, index) in row.original.errors" :key="`error-${index}`" class="m-0 whitespace-normal [overflow-wrap:anywhere]" :class="row.original.displayStatus === 'SKIPPED' ? 'text-muted-foreground' : 'text-destructive'">
        {{ issue }}
      </p>
      <p v-for="(issue, index) in row.original.warnings" :key="`warning-${index}`" class="text-muted-foreground m-0 whitespace-normal [overflow-wrap:anywhere]">
        {{ issue }}
      </p>
      <span v-if="!row.original.errors.length && !row.original.warnings.length">—</span>
    </template>
    <template #mobile-row="{ row }">
      <div class="min-w-0 [overflow-wrap:anywhere] space-y-3">
        <div>
          <strong>{{ row.goodsName || '—' }}</strong><p class="qs-type-data m-0 mt-1" :class="row.oceanShippingMarkText ? 'text-primary' : 'text-muted-foreground'">
            {{ row.oceanShippingMarkText || '—' }}
          </p><p class="qs-type-meta text-muted-foreground m-0 mt-1">
            {{ t('containerImport.sheetRow', { sheet: row.sourceSheetName, row: row.sourceRowNumber }) }}
          </p>
        </div>
        <ImportMatchSummary :row="row" />
        <QsTableStackedCell class="w-full whitespace-normal">
          <QsTableStackedLine :label="t('containerPage.purchase')" content-class="qs-type-data">
            {{ row.selectedShipment?.purchaseOrderNo || '—' }}
          </QsTableStackedLine>
          <QsTableStackedLine v-if="auth('sales-orders:read')" :label="t('containerPage.sales')" content-class="qs-type-data">
            {{ row.selectedShipment?.salesOrderNo || '—' }}
          </QsTableStackedLine>
          <QsTableStackedLine :label="t('containerPage.receipt')" content-class="qs-type-data">
            {{ row.warehouseReceiptReference || '—' }}
          </QsTableStackedLine>
          <QsTableStackedLine :label="t('containerPage.packageCount')" content-class="qs-type-data">
            {{ row.packageCount }} {{ row.packageUnit }}
          </QsTableStackedLine>
          <QsTableStackedLine :label="t('containerPage.weightLabel')" content-class="qs-type-data">
            {{ measurement(row.grossWeightKg) }} kg
          </QsTableStackedLine>
          <QsTableStackedLine :label="t('containerPage.dimensionsLabel')" content-class="qs-type-data">
            {{ dimensions(row) }}
          </QsTableStackedLine>
          <QsTableStackedLine :label="t('containerImport.systemVolume')" content-class="qs-type-data">
            {{ measurement(row.volumeCai, 2) }} {{ t('containerManagement.volumeUnit') }}
          </QsTableStackedLine>
          <QsTableStackedLine :label="t('containerImport.sourceVolume')" content-class="qs-type-data">
            {{ measurement(row.reportedVolumeCai, 2) }} {{ t('containerManagement.volumeUnit') }}
          </QsTableStackedLine>
          <QsTableStackedLine :label="t('containerPage.recipientInfo')">
            {{ [row.recipientName, row.recipientPhone, row.recipientAddress].filter(Boolean).join(' · ') || '—' }}
          </QsTableStackedLine>
          <QsTableStackedLine :label="t('containerPage.cod')">
            <AmountDisplay v-if="row.codAmountTwd !== null" :value="row.codAmountTwd" currency="TWD" :currencies="currencies" class="text-primary" />
            <span v-else class="qs-type-meta text-muted-foreground">{{ t('containerPage.none') }}</span>
          </QsTableStackedLine>
          <QsTableStackedLine v-if="row.remark" :label="t('containerPage.remark')" content-class="whitespace-pre-wrap line-clamp-2">
            {{ row.remark }}
          </QsTableStackedLine>
        </QsTableStackedCell>
        <p v-for="(issue, index) in row.errors" :key="`error-${index}`" class="m-0" :class="row.displayStatus === 'SKIPPED' ? 'text-muted-foreground' : 'text-destructive'">
          {{ issue }}
        </p>
        <p v-for="(issue, index) in row.warnings" :key="`warning-${index}`" class="qs-type-meta text-muted-foreground m-0">
          {{ issue }}
        </p>
      </div>
    </template>
    <template #actions="{ row }">
      <div class="flex flex-wrap gap-1">
        <FaButton size="sm" variant="ghost" :disabled="disabled || row.displayStatus === 'INVALID' || row.displayStatus === 'SKIPPED'" @click="emit('choose', row)">
          {{ t(row.selectedShipment ? 'containerImport.change' : 'containerImport.choose') }}
        </FaButton>
        <FaButton v-if="row.selectedShipment" size="sm" variant="ghost" :disabled="disabled || row.displayStatus === 'INVALID' || row.displayStatus === 'SKIPPED'" @click="emit('clear', row)">
          {{ t('containerImport.clear') }}
        </FaButton>
      </div>
    </template>
  </QsGenericTable>
</template>
