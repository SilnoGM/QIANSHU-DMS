<script setup lang="ts">
import type { InvoiceRequestStatusValue } from '../invoice-status.logic'
import type { InvoiceRequestListItemDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import invoiceRequestsApi from '@/api/modules/invoice-requests'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsTableStackedCell from '@/components/business/QsGenericTable/QsTableStackedCell.vue'
import QsTableStackedLine from '@/components/business/QsGenericTable/QsTableStackedLine.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useAppAuth } from '@/composables/app/auth'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import InvoiceRequestDetailDrawer from '../invoice-request-detail-drawer.vue'
import { isSettleable, resolveSettleRemaining, statusSwitchItems, statusTagClass } from '../invoice-status.logic'

/** 开票记录（运营）：仅本人数据，六态筛选（始终带计数），只有「已退回」提供重新填写入口。 */
const { t } = useI18n()
const router = useRouter()
const { auth } = useAppAuth()
const currencyCatalog = useCurrencyCatalog()
const canRead = computed(() => auth('invoice-requests:read'))
const canCreate = computed(() => auth('invoice-requests:create'))

const status = ref<'ALL' | InvoiceRequestStatusValue>('ALL')
const search = ref('')
const items = ref<InvoiceRequestListItemDto[]>([])
const counts = ref<Record<string, number>>({})
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const loading = ref(false)
const loadError = ref<string | null>(null)
const detailOpen = ref(false)
const detailId = ref<string | null>(null)
const now = ref(new Date())

// 计数始终显示：缺失按 0，避免工具栏在计数回来之前跳动。
const toolbarItems = computed(() => statusSwitchItems().map(item => ({
  value: item.value,
  label: t(item.labelKey),
  count: counts.value[item.value] ?? 0,
})))

function settleHint(row: InvoiceRequestListItemDto): string {
  if (row.documentUploadedAt === null || row.documentUploadedAt === undefined) {
    return t('invoiceRequest.detail.documentNone')
  }
  if (isSettleable(row.documentUploadedAt, now.value)) {
    return t('invoiceRequest.detail.settleable')
  }
  const remaining = resolveSettleRemaining(row.documentUploadedAt, now.value)
  return remaining === null ? '' : t('invoiceRequest.detail.settleWait', remaining)
}

const columns = computed<QsGenericTableColumn<InvoiceRequestListItemDto>[]>(() => [
  { id: 'invoiceNo', accessorKey: 'invoiceNo', title: t('invoiceRequest.column.invoiceNo'), minWidth: 190, fixed: 'left' },
  { id: 'submittedAt', accessorFn: row => row.submittedAt, title: t('invoiceRequest.column.submittedAt'), minWidth: 200 },
  { id: 'lineSummary', accessorFn: row => row.lineSummary ?? '—', title: t('invoiceRequest.column.lineSummary'), minWidth: 220 },
  { id: 'totalAmount', accessorKey: 'totalAmount', title: t('invoiceRequest.field.totalAmount'), minWidth: 150, align: 'right' },
  { id: 'status', accessorFn: row => row.status, title: t('invoiceRequest.column.status'), minWidth: 130 },
  { id: 'settleable', accessorFn: row => settleHint(row), title: t('invoiceRequest.detail.settleableAt'), minWidth: 200 },
])

async function load(): Promise<void> {
  if (!canRead.value) {
    return
  }
  loading.value = true
  loadError.value = null
  now.value = new Date()
  try {
    const signal = new AbortController().signal
    const [list, statusCounts] = await Promise.all([
      invoiceRequestsApi.list({ page: page.value, pageSize: pageSize.value, status: status.value, ...(search.value === '' ? {} : { keyword: search.value }) }, signal),
      invoiceRequestsApi.statusCounts(search.value === '' ? {} : { keyword: search.value }, signal),
    ])
    items.value = list.data.items
    total.value = list.data.total
    counts.value = Object.fromEntries(statusCounts.data.statuses.map(entry => [entry.value, entry.count]))
  }
  catch {
    loadError.value = t('invoiceRequest.list.loadFailed')
  }
  finally {
    loading.value = false
  }
}

function changeStatus(): void {
  page.value = 1
  void load()
}

function openDetail(row: InvoiceRequestListItemDto): void {
  detailId.value = row.id
  detailOpen.value = true
}

function closeDetail(): void {
  detailOpen.value = false
  detailId.value = null
}

function refill(row: InvoiceRequestListItemDto): void {
  void router.push({ name: 'qsOperationsInvoicesCreate', query: { id: row.id } })
}

onMounted(load)
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader :title="t('invoiceRequest.records.title')" :description="t('invoiceRequest.records.description')">
      <FaButton v-if="canCreate" class="min-h-11 sm:min-h-9" @click="router.push({ name: 'qsOperationsInvoicesCreate' })">
        <FaIcon name="i-lucide:receipt-text" aria-hidden="true" />{{ t('invoiceRequest.create.title') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canRead">
      <FaEmpty icon="i-lucide:shield-alert" :title="t('invoiceRequest.list.noPermission')" class="py-12" />
    </FaPageMain>
    <FaPageMain v-else class="min-w-0">
      <QsStatusSwitchToolbar v-model="status" :items="toolbarItems" :aria-label="t('invoiceRequest.records.title')" class="mb-4" @update:model-value="changeStatus" />
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="search"
        row-key="id"
        :columns="columns"
        :data="items"
        :loading="loading"
        :total="total"
        :error="loadError || undefined"
        :search-placeholder="t('invoiceRequest.list.searchPlaceholder')"
        :empty-title="t('invoiceRequest.list.empty')"
        :empty-description="t('invoiceRequest.list.emptyDescription')"
        :action-column="{ fixed: 'right', minWidth: 210 }"
        @pagination-change="load"
        @search="load"
        @retry="load"
      >
        <template #cell-invoiceNo="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="qs-type-data-emphasis break-all whitespace-normal">
              {{ row.original.invoiceNo }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-submittedAt="{ row }">
          <QsTableStackedCell>
            <QsPersonDisplay :display-name="row.original.creatorName" size="sm" />
            <QsTableStackedLine tone="muted">
              <DateTimeDisplay :value="row.original.submittedAt" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-lineSummary="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine content-class="whitespace-normal break-words">
              {{ row.original.lineSummary ?? '—' }}
            </QsTableStackedLine>
            <QsTableStackedLine v-if="row.original.invoiceRemark !== null" tone="muted">
              {{ row.original.invoiceRemark }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-totalAmount="{ row }">
          <QsTableStackedCell class="text-right justify-items-end">
            <QsTableStackedLine>
              <AmountDisplay :value="row.original.totalAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" />
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>
        <template #cell-status="{ row }">
          <FaTag variant="outline" class="qs-type-status-tag" :class="statusTagClass(row.original.status)">
            {{ t(`invoiceRequest.status.${row.original.status}`) }}
          </FaTag>
        </template>
        <template #cell-settleable="{ row }">
          <QsTableStackedCell>
            <QsTableStackedLine tone="muted" content-class="whitespace-normal">
              {{ settleHint(row.original) }}
            </QsTableStackedLine>
          </QsTableStackedCell>
        </template>

        <template #mobile-row="{ row }">
          <div class="space-y-2">
            <div class="flex gap-3 items-start justify-between">
              <span class="qs-type-data-emphasis break-all">{{ row.invoiceNo }}</span>
              <FaTag variant="outline" class="qs-type-status-tag whitespace-nowrap" :class="statusTagClass(row.status)">
                {{ t(`invoiceRequest.status.${row.status}`) }}
              </FaTag>
            </div>
            <dl class="m-0 gap-x-4 gap-y-2 grid grid-cols-2">
              <div class="min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.column.submittedAt') }}
                </dt>
                <dd class="text-sm m-0">
                  {{ row.submittedAt.slice(0, 19).replace('T', ' ') }}
                </dd>
              </div>
              <div class="min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.field.totalAmount') }}
                </dt>
                <dd class="m-0">
                  <AmountDisplay :value="row.totalAmount" currency="TWD" :currencies="currencyCatalog.currencies.value" />
                </dd>
              </div>
              <div class="col-span-2 min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.column.lineSummary') }}
                </dt>
                <dd class="text-sm m-0 break-words">
                  {{ row.lineSummary ?? '—' }}
                </dd>
              </div>
              <div class="col-span-2 min-w-0">
                <dt class="qs-type-meta mb-1">
                  {{ t('invoiceRequest.detail.settleableAt') }}
                </dt>
                <dd class="text-sm text-muted-foreground m-0">
                  {{ settleHint(row) }}
                </dd>
              </div>
            </dl>
          </div>
        </template>

        <template #actions="{ row }">
          <FaButton
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.invoiceNo} · ${t('invoiceRequest.action.viewDetail')}`"
            @click="openDetail(row)"
          >
            <FaIcon name="i-lucide:eye" aria-hidden="true" />{{ t('invoiceRequest.action.viewDetail') }}
          </FaButton>
          <FaButton
            v-if="row.status === 'RETURNED'"
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.invoiceNo} · ${t('invoiceRequest.action.refill')}`"
            @click="refill(row)"
          >
            <FaIcon name="i-lucide:pencil-line" aria-hidden="true" />{{ t('invoiceRequest.action.refill') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <InvoiceRequestDetailDrawer :id="detailId" v-model="detailOpen" @closed="closeDetail" />
  </div>
</template>
