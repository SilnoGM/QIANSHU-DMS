<script setup lang="ts">
import type { ContainerLoadingItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import CopyCellButton from '@/components/business/QsGenericTable/CopyCellButton.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import ContainerRemark from './container-remark.vue'
import { formatContainerMeasurement } from './display.logic'

const props = defineProps<{
  rows: ContainerLoadingItemDto[]
  total: number
  loading: boolean
  error: string
  canEdit: boolean
}>()
const emit = defineEmits<{
  edit: [
        item: ContainerLoadingItemDto,
  ]
  retry: [
  ]
  reference: [
        kind: 'shipment' | 'purchase' | 'sales',
        id: string,
  ]
}>()
const page = defineModel<number>('page', { required: true })
const pageSize = defineModel<number>('pageSize', { required: true })
const search = defineModel<string>('search', { required: true })
const { t } = useI18n()
const { auth } = useAppAuth()
const router = useRouter()
const { currencies, errorMessage: currencyError, reload: reloadCurrencies } = useCurrencyCatalog()
const billMenu = (row: ContainerLoadingItemDto) => [row.billReferences.map(bill => ({ label: `${bill.billNo} · ${bill.billName}`, handle: () => router.push({ name: 'qsFinanceShunlianhangOceanBillDetail', params: { id: bill.id } }) }))]
const value = (input: string | number | null) => input ?? t('containerPage.unknown')
const measurement = (input: string | null, places: 0 | 2 = 0) => value(formatContainerMeasurement(input, places))
const weightText = (row: ContainerLoadingItemDto) => row.grossWeightKg === null ? t('containerPage.unknown') : `${measurement(row.grossWeightKg)} kg`
const dimensionsText = (row: ContainerLoadingItemDto) => `${[row.lengthCm, row.widthCm, row.heightCm].map(item => measurement(item)).join(' × ')} cm`
const columns = computed<QsGenericTableColumn<ContainerLoadingItemDto>[]>(() => [
  { id: 'goods', title: t('containerPage.goods'), accessorFn: row => `${row.goodsName} ${row.oceanShippingMarkText ?? ''}`, width: 240, minWidth: 240, maxWidth: 240, fixed: 'left' },
  { id: 'shipment', title: t('containerPage.shipment'), accessorFn: row => row.shippingMark || row.shipmentNo || t('containerPage.unmatched'), width: 250, minWidth: 250, maxWidth: 250 },
  { id: 'source', title: t('containerPage.source'), accessorFn: row => [row.salesOrderNo, row.purchaseOrderNo].filter(Boolean).join(' '), width: 275, minWidth: 275, maxWidth: 275 },
  { id: 'receipt', title: t('containerPage.receipt'), accessorKey: 'warehouseReceiptReference', width: 260, minWidth: 260, maxWidth: 260 },
  { id: 'package', title: t('containerPage.packageCount'), accessorFn: row => `${row.packageCount} ${row.packageUnit ?? ''}`, width: 100, minWidth: 100, maxWidth: 100, align: 'right', cellClass: 'qs-type-data' },
  { id: 'weightDimensions', title: t('containerPage.weightDimensions'), accessorFn: row => `${weightText(row)} ${dimensionsText(row)}`, width: 240, minWidth: 240, maxWidth: 240 },
  { id: 'volumeCai', title: t('containerPage.volume'), accessorFn: row => measurement(row.volumeCai, 2), width: 145, minWidth: 145, maxWidth: 145, align: 'right', cellClass: 'qs-type-data' },
  { id: 'chargeableVolumeCai', title: t('containerPage.chargeable'), accessorFn: row => value(row.chargeableVolumeCai), width: 110, minWidth: 110, maxWidth: 110, align: 'right', cellClass: 'qs-type-data' },
  { id: 'reportedVolumeCai', title: t('containerPage.sourceVolume'), accessorFn: row => measurement(row.reportedVolumeCai, 2), width: 145, minWidth: 145, maxWidth: 145, align: 'right', cellClass: 'qs-type-data' },
  { id: 'volumeDifferenceCai', title: t('containerPage.difference'), accessorFn: row => measurement(row.volumeDifferenceCai, 2), width: 145, minWidth: 145, maxWidth: 145, align: 'right', cellClass: 'qs-type-data' },
  { id: 'recipient', title: t('containerPage.recipientInfo'), accessorFn: row => [row.recipientName, row.recipientPhone, row.recipientAddress].filter(Boolean).join(' '), width: 380, minWidth: 380, maxWidth: 380 },
  { id: 'codAmountTwd', title: t('containerPage.cod'), accessorFn: row => row.codAmountTwd ?? t('containerPage.none'), width: 190, minWidth: 190, maxWidth: 190, align: 'right', cellClass: 'qs-type-data' },
  { id: 'remark', title: t('containerPage.remark'), accessorKey: 'remark', width: 220, minWidth: 220, maxWidth: 220 },
])
</script>

<template>
  <FaAlert v-if="currencyError" class="mb-4">
    <template #description>
      <div class="flex flex-wrap gap-3 items-center justify-between">
        <span>{{ currencyError }}</span>
        <FaButton variant="outline" size="sm" @click="reloadCurrencies()">
          {{ t('containerPage.retry') }}
        </FaButton>
      </div>
    </template>
  </FaAlert>
  <QsGenericTable v-model:page="page" v-model:page-size="pageSize" v-model:search="search" row-key="id" :columns="columns" :data="props.rows" :total="total" :loading="loading" :error="error" :addable="false" :page-size-options="[20, 50, 100]" :search-placeholder="t('containerPage.itemSearch')" :empty-title="t('containerPage.emptyItems')" :empty-description="t('containerPage.emptyItemsDescription')" :action-column="{ width: 220, minWidth: 220, maxWidth: 220 }" table-class="w-max min-w-full" @retry="emit('retry')">
    <template #cell-goods="{ row }">
      <QsTableStackedCell class="max-w-full">
        <QsTableStackedLine weight="medium" content-class="[overflow-wrap:anywhere]">
          {{ row.original.goodsName }}
        </QsTableStackedLine><QsTableStackedLine tone="muted" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ row.original.oceanShippingMarkText || t('containerPage.none') }}
          <template #suffix>
            <CopyCellButton v-if="row.original.oceanShippingMarkText" always-visible :text="row.original.oceanShippingMarkText" :label="t('containerPage.mark')" />
          </template>
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-shipment="{ row }">
      <QsTableStackedCell class="max-w-full">
        <QsTableStackedLine content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ row.original.shippingMark || row.original.shipmentNo || t(row.original.shipmentId ? 'containerPage.referenceRestricted' : 'containerPage.unmatched') }}
        </QsTableStackedLine><QsTableStackedLine tone="muted" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ row.original.shippingMark && row.original.shipmentNo !== row.original.shippingMark ? row.original.shipmentNo : '' }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-source="{ row }">
      <QsTableStackedCell class="max-w-full">
        <QsTableStackedLine :label="t('containerPage.sales')" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ row.original.salesOrderNo || t('containerPage.none') }}
        </QsTableStackedLine>
        <QsTableStackedLine :label="t('containerPage.purchase')" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ row.original.purchaseOrderNo || t('containerPage.none') }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-weightDimensions="{ row }">
      <QsTableStackedCell class="max-w-full">
        <QsTableStackedLine :label="t('containerPage.weightLabel')" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ weightText(row.original) }}
        </QsTableStackedLine>
        <QsTableStackedLine :label="t('containerPage.dimensionsLabel')" content-class="qs-type-data [overflow-wrap:anywhere]">
          {{ dimensionsText(row.original) }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-recipient="{ row }">
      <QsTableStackedCell class="max-w-full">
        <QsTableStackedLine content-class="flex flex-wrap gap-x-3 gap-y-1">
          <span>{{ row.original.recipientName || t('containerPage.none') }}</span>
          <span class="qs-type-data whitespace-nowrap">{{ row.original.recipientPhone || t('containerPage.none') }}</span>
        </QsTableStackedLine>
        <QsTableStackedLine tone="muted" content-class="whitespace-pre-wrap [overflow-wrap:anywhere]">
          {{ row.original.recipientAddress || t('containerPage.none') }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-receipt="{ row }">
      <span class="qs-type-data whitespace-pre-wrap [overflow-wrap:anywhere]">{{ row.original.warehouseReceiptReference || t('containerPage.none') }}</span>
    </template>
    <template #cell-codAmountTwd="{ row }">
      <AmountDisplay v-if="row.original.codAmountTwd !== null" :value="row.original.codAmountTwd" currency="TWD" :currencies="currencies" />
      <span v-else class="qs-type-meta text-muted-foreground">{{ t('containerPage.none') }}</span>
    </template>
    <template #cell-remark="{ row }">
      <ContainerRemark :text="row.original.remark" />
    </template>
    <template #mobile-row="{ row }">
      <div class="min-w-0 [overflow-wrap:anywhere] space-y-3">
        <strong>{{ row.goodsName }}</strong><div class="qs-type-data-emphasis flex gap-2 items-center">
          <span class="min-w-0">{{ row.oceanShippingMarkText || t('containerPage.none') }}</span>
          <CopyCellButton v-if="row.oceanShippingMarkText" always-visible :text="row.oceanShippingMarkText" :label="t('containerPage.mark')" />
        </div>
        <dl class="gap-x-4 gap-y-2 grid grid-cols-2">
          <div v-for="entry in [['packageCount', `${row.packageCount} ${row.packageUnit ?? ''}`], ['volume', measurement(row.volumeCai, 2)], ['chargeable', value(row.chargeableVolumeCai)]]" :key="entry[0]">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t(`containerPage.${entry[0]}`) }}
            </dt><dd class="qs-type-data mt-1">
              {{ entry[1] }}
            </dd>
          </div>
        </dl>
        <p class="qs-type-meta text-muted-foreground">
          {{ row.shippingMark || row.shipmentNo || t(row.shipmentId ? 'containerPage.referenceRestricted' : 'containerPage.unmatched') }}
          <span v-if="row.shippingMark && row.shipmentNo && row.shippingMark !== row.shipmentNo" class="qs-type-data block">{{ row.shipmentNo }}</span>
        </p>
        <section class="pt-3 border-t border-border" :aria-label="t('containerPage.items')">
          <dl class="pb-2 gap-x-4 gap-y-3 grid grid-cols-2">
            <div class="col-span-2">
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('containerPage.weightDimensions') }}
              </dt>
              <dd class="mt-1 space-y-1">
                <QsTableStackedLine :label="t('containerPage.weightLabel')" content-class="qs-type-data [overflow-wrap:anywhere]">
                  {{ weightText(row) }}
                </QsTableStackedLine>
                <QsTableStackedLine :label="t('containerPage.dimensionsLabel')" content-class="qs-type-data [overflow-wrap:anywhere]">
                  {{ dimensionsText(row) }}
                </QsTableStackedLine>
              </dd>
            </div>
            <div v-for="entry in [['receipt', row.warehouseReceiptReference], ['sourceVolume', measurement(row.reportedVolumeCai, 2)], ['difference', measurement(row.volumeDifferenceCai, 2)], ['purchase', row.purchaseOrderNo], ['sales', row.salesOrderNo]]" :key="entry[0] ?? ''" :class="entry[0] === 'receipt' ? 'col-span-2' : ''">
              <dt class="qs-type-meta text-muted-foreground">
                {{ t(`containerPage.${entry[0]}`) }}
              </dt>
              <dd class="qs-type-data mt-1 whitespace-pre-wrap">
                {{ entry[1] ?? t(['sourceVolume', 'difference'].includes(entry[0] ?? '') ? 'containerPage.unknown' : 'containerPage.none') }}
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('containerPage.recipientInfo') }}
              </dt>
              <dd class="mt-1 space-y-1">
                <div class="flex flex-wrap gap-x-3 gap-y-1">
                  <span>{{ row.recipientName || t('containerPage.none') }}</span>
                  <span class="qs-type-data whitespace-nowrap">{{ row.recipientPhone || t('containerPage.none') }}</span>
                </div>
                <p class="text-muted-foreground whitespace-pre-wrap">
                  {{ row.recipientAddress || t('containerPage.none') }}
                </p>
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('containerPage.cod') }}
              </dt>
              <dd class="mt-1">
                <AmountDisplay v-if="row.codAmountTwd !== null" :value="row.codAmountTwd" currency="TWD" :currencies="currencies" />
                <span v-else class="qs-type-meta text-muted-foreground">{{ t('containerPage.none') }}</span>
              </dd>
            </div>
            <div class="col-span-2">
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('containerPage.remark') }}
              </dt>
              <dd class="mt-1">
                <ContainerRemark :text="row.remark" mobile />
              </dd>
            </div>
          </dl>
        </section>
      </div>
    </template>
    <template #actions="{ row }">
      <div class="gap-1.5 grid grid-cols-2">
        <FaButton v-if="canEdit" size="sm" variant="ghost" :disabled="row.isBilled" :title="row.isBilled ? t('containerPage.billed') : undefined" @click="emit('edit', row)">
          {{ t('containerPage.editItem') }}
        </FaButton>
        <FaButton v-if="row.shipmentId && auth('purchase-orders:read')" size="sm" variant="ghost" @click="emit('reference', 'shipment', row.shipmentId)">
          {{ t('containerPage.viewShipment') }}
        </FaButton>
        <FaButton v-if="row.purchaseOrderId && auth('purchase-orders:read')" size="sm" variant="ghost" @click="emit('reference', 'purchase', row.purchaseOrderId)">
          {{ t('containerPage.viewPurchase') }}
        </FaButton>
        <FaButton v-if="row.salesOrderId && auth('sales-orders:read')" size="sm" variant="ghost" @click="emit('reference', 'sales', row.salesOrderId)">
          {{ t('containerPage.viewSales') }}
        </FaButton>
        <span v-if="row.isBilled" class="qs-type-meta text-muted-foreground col-span-2 whitespace-normal">{{ t('containerPage.billed') }}</span>
        <FaDropdown v-if="row.billReferences.length && auth('ocean-freight-bills:read') && auth('purchase-orders:payment')" :items="billMenu(row)" align="end">
          <FaButton size="sm" variant="ghost" class="col-span-2">
            {{ t('containerPage.relatedBills') }} ({{ row.billReferences.length }})
            <FaIcon name="i-lucide:chevron-down" class="size-3.5" />
          </FaButton>
        </FaDropdown>
      </div>
    </template>
  </QsGenericTable>
</template>
