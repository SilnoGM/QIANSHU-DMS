<script setup lang="ts">
import type { SalesReceiptRequestDetailDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableFilterDefinition, QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'
import salesReceiptsApi from '@/api/modules/sales-receipts'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import { getSalesOrderApiFailure } from '../../operations/sales-orders/sales-order-create.logic'
import ReceiptDetail from './receipt-detail.vue'
import ReceiptVoucher from './receipt-voucher.vue'

const { t } = useI18n()
const currencyCatalog = useCurrencyCatalog()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const status = ref<SalesReceiptRequestDetailDto['status']>('PENDING_REVIEW')
const keyword = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const page = ref(1)
const pageSize = ref(20)
const items = shallowRef<SalesReceiptRequestDetailDto[]>([])
const total = ref(0)
const counts = ref({ PENDING_REVIEW: 0, APPROVED: 0, REJECTED: 0 })
const loading = ref(false)
const error = ref('')
const selectedId = ref<string | null>(null)
let controller: AbortController | null = null
const canRead = computed(() => auth('sales-receipts:read'))
const tabs = computed(() => (['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const).map(value => ({ value, label: t(`salesReceipt.status.${value}`), count: counts.value[value] })))
const filterDefinitions = computed<QsGenericTableFilterDefinition[]>(() => [{
  key: 'currencyCode',
  label: t('salesReceipt.currency'),
  placeholder: t('salesReceipt.allCurrencies'),
  options: [{ label: 'TWD', value: 'TWD' }, { label: 'MYR', value: 'MYR' }],
}])
const columns = computed<QsGenericTableColumn<SalesReceiptRequestDetailDto>[]>(() => [
  { id: 'collectionNo', accessorKey: 'collectionNo', title: t('salesReceipt.collectionNo'), width: 225, minWidth: 225, fixed: 'left', copyable: true },
  { id: 'order', accessorFn: item => item.salesOrder.orderNo, title: t('salesReceipt.order'), minWidth: 235, copyable: true },
  { id: 'receipt', accessorKey: 'paymentType', title: t('salesReceipt.receiptInfo'), minWidth: 185 },
  { id: 'amount', accessorKey: 'amount', title: t('salesReceipt.amount'), minWidth: 205, align: 'right' },
  { id: 'method', accessorKey: 'paymentMethodNameSnapshot', title: t('salesReceipt.method'), minWidth: 140 },
  { id: 'voucher', accessorFn: item => item.voucher?.title, title: t('salesReceipt.voucherTitle'), minWidth: 180 },
  { id: 'owner', accessorFn: item => item.accountOwner.name, title: t('salesReceipt.owner'), minWidth: 155 },
  { id: 'submitted', accessorKey: 'submittedAt', title: t('salesReceipt.submittedAt'), minWidth: 185 },
  { id: 'review', accessorKey: 'status', title: t('salesReceipt.reviewInfo'), minWidth: 200 },
  { id: 'notes', accessorKey: 'remark', title: t('salesReceipt.notes'), minWidth: 220 },
])
function statusClass(item: SalesReceiptRequestDetailDto): string {
  if (item.status === 'REJECTED') {
    return 'border-destructive/30 bg-destructive/10 text-destructive'
  }
  return item.status === 'APPROVED'
    ? 'border-primary/30 bg-primary/10 text-primary'
    : 'border-amber-500/30 bg-amber-500/8 text-amber-700 dark:text-amber-300'
}
function voucherUrl(item: SalesReceiptRequestDetailDto): string {
  return `/api/sales-receipt-requests/${encodeURIComponent(item.id)}/voucher`
}
async function load(): Promise<void> {
  controller?.abort()
  if (!canRead.value) {
    items.value = []
    total.value = 0
    return
  }
  const current = new AbortController()
  controller = current
  loading.value = true
  error.value = ''
  try {
    const response = await salesReceiptsApi.list({ page: page.value, pageSize: pageSize.value, status: status.value, keyword: keyword.value.trim() || undefined, currencyCode: filters.value.currencyCode === 'TWD' || filters.value.currencyCode === 'MYR' ? filters.value.currencyCode : undefined }, current.signal)
    if (current.signal.aborted || !canRead.value) {
      return
    }
    items.value = response.data.items
    total.value = response.data.total
    counts.value = response.data.statusCounts
  }
  catch (failure) {
    if (!current.signal.aborted) {
      error.value = getSalesOrderApiFailure(failure).message
    }
  }
  finally {
    if (controller === current) {
      loading.value = false
    }
  }
}
function selectTab(value: string | number): void {
  if (value === 'PENDING_REVIEW' || value === 'APPROVED' || value === 'REJECTED') {
    status.value = value
    page.value = 1
    void load()
  }
}
function search(): void {
  page.value = 1
  void load()
}
watch(() => [canRead.value, accountStore.authEpoch], () => {
  items.value = []
  counts.value = { PENDING_REVIEW: 0, APPROVED: 0, REJECTED: 0 }
  selectedId.value = null
  void load()
}, { immediate: true })
onBeforeUnmount(() => controller?.abort())
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('workbench.salesReceipts')" :description="t('salesReceipt.intro')" />
    <FaPageMain v-if="!canRead">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('salesReceipt.noPermission')" class="py-12" />
    </FaPageMain>
    <FaPageMain v-else class="min-w-0">
      <QsStatusSwitchToolbar :model-value="status" :items="tabs" :aria-label="t('workbench.salesReceipts')" class="mb-4" @update:model-value="selectTab" />
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="keyword"
        v-model:filters="filters"
        row-key="id"
        table-class="min-w-[2040px]"
        :show-row-number="false"
        :columns="columns"
        :data="items"
        :loading="loading"
        :error="error || undefined"
        :total="total"
        :addable="false"
        :filter-definitions="filterDefinitions"
        :search-placeholder="t('salesReceipt.search')"
        :page-size-options="[20, 50, 100]"
        :empty-title="t('salesReceipt.empty')"
        :action-column="{ fixed: 'right', minWidth: 130 }"
        @search="search"
        @filter-change="search"
        @pagination-change="load"
        @retry="load"
      >
        <template #cell-collectionNo="{ row }">
          <span v-if="row.original.collectionNo" class="qs-type-data-emphasis font-mono break-all">{{ row.original.collectionNo }}</span>
          <span v-else class="qs-type-meta">{{ t('salesReceipt.unnumbered') }}</span>
        </template>
        <template #cell-order="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="qs-type-data-emphasis font-mono break-all whitespace-normal">
              {{ row.original.salesOrder.orderNo }}
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted">
              {{ row.original.salesOrder.customerName }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="row.original.resubmittedFromId">
              <FaTag variant="outline" class="qs-type-status-tag">
                {{ t('salesReceipt.resubmitted') }}
              </FaTag>
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-receipt="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine weight="medium">
              {{ t(`salesReceipt.type.${row.original.paymentType}`) }}
            </QsTableStackedLine>
            <QsTableStackedLine tone="muted">
              <DateTimeDisplay :value="row.original.receivedAt" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-amount="{ row }">
          <QsTableStackedCell class="items-end">
            <QsTableStackedLine><AmountDisplay :value="row.original.amount" :currency="row.original.currencyCode" :currencies="currencyCatalog.currencies.value" /></QsTableStackedLine>
            <QsTableStackedLine v-if="row.original.approvedPayment?.posting" :label="t('salesReceipt.totalCny')">
              <AmountDisplay :value="row.original.approvedPayment.posting.businessAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
            <QsTableStackedLine v-else tone="muted">
              {{ t('salesReceipt.notPosted') }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-method="{ row }">
          <FaTag variant="outline" class="max-w-full whitespace-normal break-words">
            {{ row.original.paymentMethodNameSnapshot }}
          </FaTag>
        </template>
        <template #cell-voucher="{ row }">
          <ReceiptVoucher :voucher="row.original.voucher" :url="voucherUrl(row.original)" />
        </template>
        <template #cell-owner="{ row }">
          <QsPersonDisplay :display-name="row.original.accountOwner.name" size="md" />
        </template>
        <template #cell-submitted="{ row }">
          <QsTableStackedCell>
            <QsPersonDisplay :display-name="row.original.submittedBy.name" size="sm" />
            <QsTableStackedLine tone="muted">
              <DateTimeDisplay :value="row.original.submittedAt" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-review="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine>
              <FaTag variant="outline" class="qs-type-status-tag" :class="statusClass(row.original)">
                {{ t(`salesReceipt.status.${row.original.status}`) }}
              </FaTag>
              <FaTag v-if="row.original.approvedPayment?.voidedAt" variant="outline" class="text-destructive qs-type-status-tag ml-1 border-destructive/30">
                {{ t('salesReceipt.voided') }}
              </FaTag>
            </QsTableStackedLine>
            <QsTableStackedLine v-if="row.original.reviewedBy">
              {{ row.original.reviewedBy.name }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="row.original.reviewedAt" tone="muted">
              <DateTimeDisplay :value="row.original.reviewedAt" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-notes="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine :label="t('salesReceipt.remark')" content-class="whitespace-pre-wrap break-words">
              {{ row.original.remark || '—' }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="row.original.reviewRemark" :label="t('salesReceipt.reviewRemark')" tone="muted" content-class="whitespace-pre-wrap break-words">
              {{ row.original.reviewRemark }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #actions="{ row }">
          <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-8" :aria-label="`${row.collectionNo || row.salesOrder.orderNo} · ${t('salesReceipt.detail')}`" @click="selectedId = row.id">
            <FaIcon name="i-lucide:eye" aria-hidden="true" />{{ t('salesReceipt.view') }}
          </FaButton>
        </template>
        <template #mobile-row="{ row }">
          <article class="min-w-0 space-y-4">
            <div class="flex flex-wrap gap-2 items-center justify-between">
              <span class="qs-type-data-emphasis font-mono break-all">{{ row.collectionNo || t('salesReceipt.unnumbered') }}</span>
              <FaTag variant="outline" class="qs-type-status-tag" :class="statusClass(row)">
                {{ t(`salesReceipt.status.${row.status}`) }}
              </FaTag>
              <FaTag v-if="row.approvedPayment?.voidedAt" variant="outline" class="text-destructive qs-type-status-tag">
                {{ t('salesReceipt.voided') }}
              </FaTag>
            </div>
            <p class="qs-type-body m-0">
              {{ row.salesOrder.orderNo }} · {{ row.salesOrder.customerName }}
            </p>
            <div class="p-3 rounded-lg bg-muted/30 flex flex-wrap gap-2 items-center justify-between">
              <span>{{ t(`salesReceipt.type.${row.paymentType}`) }}</span>
              <AmountDisplay :value="row.amount" :currency="row.currencyCode" :currencies="currencyCatalog.currencies.value" />
            </div>
            <dl class="m-0 gap-3 grid grid-cols-1">
              <div>
                <dt class="qs-type-meta">
                  {{ t('salesReceipt.owner') }}
                </dt><dd class="m-0 mt-1">
                  <QsPersonDisplay :display-name="row.accountOwner.name" size="md" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta">
                  {{ t('salesReceipt.receivedAt') }}
                </dt><dd class="m-0">
                  <DateTimeDisplay :value="row.receivedAt" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta">
                  {{ t('salesReceipt.method') }}
                </dt><dd class="m-0">
                  <FaTag variant="outline" class="max-w-full whitespace-normal break-words">
                    {{ row.paymentMethodNameSnapshot }}
                  </FaTag>
                </dd>
              </div>
              <div>
                <dt class="qs-type-meta">
                  {{ t('salesReceipt.submittedAt') }}
                </dt><dd class="m-0">
                  {{ row.submittedBy.name }} · <DateTimeDisplay :value="row.submittedAt" />
                </dd>
              </div>
              <div v-if="row.reviewedAt">
                <dt class="qs-type-meta">
                  {{ t('salesReceipt.reviewedAt') }}
                </dt><dd class="m-0">
                  {{ row.reviewedBy?.name }} · <DateTimeDisplay :value="row.reviewedAt" />
                </dd>
              </div>
              <div v-if="row.approvedPayment?.posting">
                <dt class="qs-type-meta">
                  {{ t('salesReceipt.totalCny') }}
                </dt><dd class="m-0">
                  <AmountDisplay :value="row.approvedPayment.posting.businessAmount" currency="CNY" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div v-if="row.remark">
                <dt class="qs-type-meta">
                  {{ t('salesReceipt.remark') }}
                </dt><dd class="m-0 whitespace-pre-wrap break-words">
                  {{ row.remark }}
                </dd>
              </div>
              <div v-if="row.reviewRemark">
                <dt class="qs-type-meta">
                  {{ t('salesReceipt.reviewRemark') }}
                </dt><dd class="m-0 whitespace-pre-wrap break-words">
                  {{ row.reviewRemark }}
                </dd>
              </div>
            </dl>
            <div class="flex flex-wrap gap-2 items-center">
              <FaTag v-if="row.resubmittedFromId" variant="outline">
                {{ t('salesReceipt.resubmitted') }}
              </FaTag>
              <ReceiptVoucher :voucher="row.voucher" :url="voucherUrl(row)" />
            </div>
          </article>
        </template>
      </QsGenericTable>
    </FaPageMain>
    <ReceiptDetail :request-id="selectedId" @close="selectedId = null" @changed="load" />
  </div>
</template>
