<script setup lang="ts">
import type { SalesReceiptRequestDetailDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import salesReceiptsApi from '@/api/modules/sales-receipts'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { getSalesOrderApiFailure } from '../../operations/sales-orders/sales-order-create.logic'
import ReceiptDetail from './receipt-detail.vue'

const { t } = useI18n()
const { auth } = useAppAuth()
const accountStore = useAppAccountStore()
const status = ref<SalesReceiptRequestDetailDto['status']>('PENDING_REVIEW')
const keyword = ref('')
const currencyCode = ref<'TWD' | 'MYR' | 'ALL'>('ALL')
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
const tabs = computed(() => (['PENDING_REVIEW', 'APPROVED', 'REJECTED'] as const).map(value => ({ value, label: `${t(`salesReceipt.status.${value}`)} (${counts.value[value]})` })))
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
    const response = await salesReceiptsApi.list({ page: page.value, pageSize: pageSize.value, status: status.value, keyword: keyword.value.trim() || undefined, currencyCode: currencyCode.value === 'ALL' ? undefined : currencyCode.value }, current.signal)
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
  <FaPageMain>
    <h1 class="text-xl font-semibold">
      {{ t('workbench.salesReceipts') }}
    </h1>
    <p class="text-muted-foreground">
      {{ t('salesReceipt.intro') }}
    </p>
    <FaAlert v-if="!canRead" :title="t('salesReceipt.noPermission')" />
    <template v-else>
      <FaTabs :model-value="status" :list="tabs" @update:model-value="selectTab" />
      <form class="my-4 flex flex-wrap gap-3" @submit.prevent="search">
        <FaInput v-model="keyword" :placeholder="t('salesReceipt.search')" :aria-label="t('salesReceipt.search')" class="min-w-0 w-full sm:w-72" />
        <FaSelect v-model="currencyCode" :options="[{ label: t('salesReceipt.allCurrencies'), value: 'ALL' }, { label: 'TWD', value: 'TWD' }, { label: 'MYR', value: 'MYR' }]" :aria-label="t('salesReceipt.currency')" class="w-36" />
        <FaButton type="submit" variant="outline" :loading="loading">
          {{ t('salesReceipt.searchButton') }}
        </FaButton>
      </form>
      <QsGenericTable v-model:page="page" v-model:page-size="pageSize" row-key="id" :columns="columns" :data="items" :loading="loading" :error="error || undefined" :total="total" :addable="false" :searchable="false" :empty-title="t('salesReceipt.empty')" :action-column="{ minWidth: 130 }" @pagination-change="load" @retry="load">
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
          <FaButton variant="outline" class="min-h-11" @click="selectedId = row.id">
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
    </template>
    <ReceiptDetail :request-id="selectedId" @close="selectedId = null" @changed="load" />
  </FaPageMain>
</template>
