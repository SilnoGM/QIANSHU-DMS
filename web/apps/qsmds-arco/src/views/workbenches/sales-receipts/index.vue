<script setup lang="ts">
import type { SalesReceiptRequestDetailDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn, QsGenericTableFilterDefinition, QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'
import salesReceiptsApi from '@/api/modules/sales-receipts'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { getSalesOrderApiFailure } from '../../operations/sales-orders/sales-order-create.logic'
import ReceiptDetail from './receipt-detail.vue'

const { t } = useI18n()
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
  { id: 'order', accessorFn: item => item.salesOrder.orderNo, title: t('salesReceipt.order'), minWidth: 210 },
  { id: 'owner', accessorFn: item => item.accountOwner.name, title: t('salesReceipt.owner'), minWidth: 160 },
  { id: 'amount', accessorKey: 'amount', title: t('salesReceipt.amount'), minWidth: 190 },
  { id: 'submitted', accessorKey: 'submittedAt', title: t('salesReceipt.submittedAt'), minWidth: 190 },
])
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
        <template #cell-order="{ row }">
          <span class="font-mono">{{ row.original.salesOrder.orderNo }}</span><p class="text-muted-foreground m-0 mt-1">
            {{ row.original.salesOrder.customerName }}
          </p>
        </template>
        <template #cell-amount="{ row }">
          <span class="font-mono">{{ row.original.amount }} {{ row.original.currencyCode }}</span>
        </template>
        <template #cell-submitted="{ row }">
          <DateTimeDisplay :value="row.original.submittedAt" /><p class="text-muted-foreground m-0 mt-1">
            {{ row.original.submittedBy.name }}
          </p>
        </template>
        <template #actions="{ row }">
          <FaButton variant="ghost" size="sm" class="min-h-11 sm:min-h-8" @click="selectedId = row.id">
            <FaIcon name="i-lucide:eye" aria-hidden="true" />
            {{ t('salesReceipt.detail') }}
          </FaButton>
        </template>
        <template #mobile-row="{ row }">
          <article class="min-w-0 space-y-3">
            <p class="font-mono break-all">
              {{ row.salesOrder.orderNo }}
            </p><p>{{ row.salesOrder.customerName }} · {{ row.accountOwner.name }}</p><p class="font-mono">
              {{ row.amount }} {{ row.currencyCode }}
            </p><DateTimeDisplay :value="row.submittedAt" />
          </article>
        </template>
      </QsGenericTable>
    </FaPageMain>
    <ReceiptDetail :request-id="selectedId" @close="selectedId = null" @changed="load" />
  </div>
</template>
