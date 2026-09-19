<script setup lang="ts">
import type { ContainerLoadingItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'

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
const value = (input: string | number | null) => input ?? t('containerPage.unknown')
const columns = computed<QsGenericTableColumn<ContainerLoadingItemDto>[]>(() => [
  { id: 'goods', title: t('containerPage.goods'), accessorFn: row => `${row.goodsName} ${row.oceanShippingMarkText ?? ''}`, minWidth: 245, fixed: 'left' },
  { id: 'shipment', title: t('containerPage.shipment'), accessorFn: row => row.shippingMark || row.shipmentNo || t('containerPage.unmatched'), minWidth: 245 },
  { id: 'receipt', title: t('containerPage.receipt'), accessorKey: 'warehouseReceiptReference', minWidth: 200 },
  { id: 'package', title: t('containerPage.packageCount'), accessorFn: row => `${row.packageCount} ${row.packageUnit ?? ''}`, minWidth: 110, align: 'right', cellClass: 'qs-type-data' },
  { id: 'grossWeightKg', title: t('containerPage.weight'), accessorFn: row => value(row.grossWeightKg), minWidth: 140, align: 'right', cellClass: 'qs-type-data' },
  { id: 'dimensions', title: t('containerPage.measurement'), accessorFn: row => [row.lengthCm, row.widthCm, row.heightCm].map(value).join(' × '), minWidth: 230, cellClass: 'qs-type-data' },
  { id: 'volumeCai', title: t('containerPage.volume'), accessorFn: row => value(row.volumeCai), minWidth: 165, align: 'right', cellClass: 'qs-type-data' },
  { id: 'chargeableVolumeCai', title: t('containerPage.chargeable'), accessorFn: row => value(row.chargeableVolumeCai), minWidth: 115, align: 'right', cellClass: 'qs-type-data' },
  { id: 'reportedVolumeCai', title: t('containerPage.sourceVolume'), accessorFn: row => value(row.reportedVolumeCai), minWidth: 160, align: 'right', defaultVisible: false, cellClass: 'qs-type-data' },
  { id: 'volumeDifferenceCai', title: t('containerPage.difference'), accessorFn: row => value(row.volumeDifferenceCai), minWidth: 160, align: 'right', defaultVisible: false, cellClass: 'qs-type-data' },
  { id: 'recipientName', title: t('containerPage.recipientName'), accessorKey: 'recipientName', minWidth: 130, defaultVisible: false },
  { id: 'recipientPhone', title: t('containerPage.recipientPhone'), accessorKey: 'recipientPhone', minWidth: 160, defaultVisible: false },
  { id: 'recipientAddress', title: t('containerPage.recipientAddress'), accessorKey: 'recipientAddress', minWidth: 260, defaultVisible: false },
  { id: 'codAmountTwd', title: t('containerPage.cod'), accessorFn: row => value(row.codAmountTwd), minWidth: 175, align: 'right', defaultVisible: false, cellClass: 'qs-type-data' },
  { id: 'remark', title: t('containerPage.remark'), accessorKey: 'remark', minWidth: 220, defaultVisible: false },
])
</script>

<template>
  <QsGenericTable v-model:page="page" v-model:page-size="pageSize" v-model:search="search" row-key="id" :columns="columns" :data="props.rows" :total="total" :loading="loading" :error="error" :addable="false" :page-size-options="[20, 50, 100]" :search-placeholder="t('containerPage.itemSearch')" :empty-title="t('containerPage.emptyItems')" :empty-description="t('containerPage.emptyItemsDescription')" :action-column="{ width: 220 }" @retry="emit('retry')">
    <template #cell-goods="{ row }">
      <QsTableStackedCell>
        <QsTableStackedLine weight="medium">
          {{ row.original.goodsName }}
        </QsTableStackedLine><QsTableStackedLine tone="muted" content-class="qs-type-data">
          {{ row.original.oceanShippingMarkText || t('containerPage.none') }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #cell-shipment="{ row }">
      <QsTableStackedCell>
        <QsTableStackedLine content-class="qs-type-data">
          {{ row.original.shippingMark || row.original.shipmentNo || t(row.original.shipmentId ? 'containerPage.referenceRestricted' : 'containerPage.unmatched') }}
        </QsTableStackedLine><QsTableStackedLine tone="muted" content-class="qs-type-data">
          {{ row.original.purchaseOrderNo || '' }}
        </QsTableStackedLine>
      </QsTableStackedCell>
    </template>
    <template #mobile-row="{ row }">
      <div class="min-w-0 [overflow-wrap:anywhere] space-y-3">
        <strong>{{ row.goodsName }}</strong><div class="qs-type-data-emphasis">
          {{ row.oceanShippingMarkText || t('containerPage.none') }}
        </div>
        <dl class="gap-x-4 gap-y-2 grid grid-cols-2">
          <div v-for="entry in [['packageCount', `${row.packageCount} ${row.packageUnit ?? ''}`], ['weight', value(row.grossWeightKg)], ['volume', value(row.volumeCai)], ['chargeable', value(row.chargeableVolumeCai)]]" :key="entry[0]">
            <dt class="qs-type-meta text-muted-foreground">
              {{ t(`containerPage.${entry[0]}`) }}
            </dt><dd class="qs-type-data mt-1">
              {{ entry[1] }}
            </dd>
          </div>
        </dl>
        <p class="qs-type-meta text-muted-foreground">
          {{ row.shippingMark || row.shipmentNo || t(row.shipmentId ? 'containerPage.referenceRestricted' : 'containerPage.unmatched') }}
        </p>
        <details class="pt-2 border-t border-border">
          <summary class="text-sm text-primary py-3 min-h-11 cursor-pointer focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline">
            {{ t('containerPage.view') }}
          </summary>
          <dl class="pb-2 gap-x-4 gap-y-3 grid grid-cols-2">
            <div class="col-span-2">
              <dt class="qs-type-meta text-muted-foreground">
                {{ t('containerPage.measurement') }}
              </dt>
              <dd class="qs-type-data mt-1">
                {{ [row.lengthCm, row.widthCm, row.heightCm].map(value).join(' × ') }}
              </dd>
            </div>
            <div v-for="entry in [['receipt', row.warehouseReceiptReference], ['sourceVolume', row.reportedVolumeCai], ['difference', row.volumeDifferenceCai], ['recipientName', row.recipientName], ['recipientPhone', row.recipientPhone], ['recipientAddress', row.recipientAddress], ['cod', row.codAmountTwd], ['purchase', row.purchaseOrderNo], ['sales', row.salesOrderNo], ['remark', row.remark]]" :key="entry[0] ?? ''" :class="['receipt', 'recipientAddress', 'remark'].includes(entry[0] ?? '') ? 'col-span-2' : ''">
              <dt class="qs-type-meta text-muted-foreground">
                {{ t(`containerPage.${entry[0]}`) }}
              </dt>
              <dd class="mt-1 whitespace-pre-wrap" :class="['sourceVolume', 'difference', 'cod', 'purchase', 'sales'].includes(entry[0] ?? '') ? 'qs-type-data' : 'qs-type-body'">
                {{ entry[1] ?? t(['sourceVolume', 'difference', 'cod'].includes(entry[0] ?? '') ? 'containerPage.unknown' : 'containerPage.none') }}
              </dd>
            </div>
          </dl>
        </details>
      </div>
    </template>
    <template #actions="{ row }">
      <div class="flex flex-wrap gap-1.5">
        <FaButton v-if="canEdit" size="sm" variant="outline" :disabled="row.isBilled" :title="row.isBilled ? t('containerPage.billed') : undefined" @click="emit('edit', row)">
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
        <span v-if="row.isBilled" class="qs-type-meta text-muted-foreground w-full">{{ t('containerPage.billed') }}</span>
        <template v-if="auth('ocean-freight-bills:read') && auth('purchase-orders:payment')">
          <FaButton v-for="bill in row.billReferences" :key="bill.id" size="sm" variant="ghost" :title="`${t('containerPage.relatedBills')}：${bill.billName}`" @click="router.push({ name: 'qsFinanceShunlianhangOceanBillDetail', params: { id: bill.id } })">
            {{ bill.billNo }}
          </FaButton>
        </template>
      </div>
    </template>
  </QsGenericTable>
</template>
