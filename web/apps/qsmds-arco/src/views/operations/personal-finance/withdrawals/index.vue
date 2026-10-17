<script setup lang="ts">
import type { FundWithdrawalDto } from '@/api/generated/types.gen'
import type { FundWithdrawalListSelfQuery } from '@/api/modules/fund-withdrawals'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { getApiClientErrorMessage } from '@/api/errors'
import fundWithdrawalsApi from '@/api/modules/fund-withdrawals'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import FundWithdrawalDetailModal from './fund-withdrawal-detail-modal.vue'
import {
  FUND_WITHDRAWAL_STATUS_FILTER_OPTIONS,
  withdrawalStatusMeta,
} from './status.logic'

defineOptions({ name: 'OperationsPersonalFinanceWithdrawals' })

const { t } = useI18n()
const { auth } = useAppAuth()
const currencyCatalog = useCurrencyCatalog()
const canRead = computed(() => auth('fund-withdrawals:create'))
const active = ref(false)
const status = ref<'ALL' | FundWithdrawalDto['status']>('ALL')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<FundWithdrawalDto[]>([])
const loading = ref(false)
const loadError = ref('')
const detailOpen = ref(false)
const detail = ref<FundWithdrawalDto | null>(null)
let controller: AbortController | null = null

const enabled = computed(() => active.value && canRead.value)
const statusOptions = computed(() => FUND_WITHDRAWAL_STATUS_FILTER_OPTIONS.map(item => ({
  value: item.value,
  label: t(item.labelKey),
})))
const columns = computed<QsGenericTableColumn<FundWithdrawalDto>[]>(() => [
  { id: 'withdrawalNo', accessorKey: 'withdrawalNo', title: t('fundWithdrawal.column.withdrawalNo'), minWidth: 190, fixed: 'left' },
  { id: 'amount', accessorKey: 'amount', title: t('fundWithdrawal.column.amount'), minWidth: 220, align: 'right' },
  { id: 'status', accessorKey: 'status', title: t('fundWithdrawal.column.status'), minWidth: 120 },
  { id: 'submittedAt', accessorKey: 'submittedAt', title: t('fundWithdrawal.column.submittedAt'), minWidth: 190 },
  { id: 'reviewedAt', accessorKey: 'reviewedAt', title: t('fundWithdrawal.column.reviewedAt'), minWidth: 190 },
  { id: 'reviewer', accessorKey: 'reviewerName', title: t('fundWithdrawal.column.reviewer'), minWidth: 150 },
])

async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value) {
    return
  }
  const request = new AbortController()
  controller = request
  loading.value = true
  loadError.value = ''
  try {
    const query: FundWithdrawalListSelfQuery = {
      page: page.value,
      pageSize: pageSize.value,
      status: status.value,
    }
    const response = await fundWithdrawalsApi.listSelf(query, request.signal)
    if (!request.signal.aborted && controller === request) {
      items.value = response.data.items
      total.value = response.data.total
    }
  }
  catch (failure) {
    if (!request.signal.aborted && controller === request) {
      loadError.value = getApiClientErrorMessage(failure as Parameters<typeof getApiClientErrorMessage>[0])
        || t('fundWithdrawal.error.load')
    }
  }
  finally {
    if (controller === request) {
      loading.value = false
      controller = null
    }
  }
}

watch([enabled, status, page, pageSize], () => {
  if (enabled.value) {
    void load()
  }
}, { immediate: true })

watch(status, () => {
  page.value = 1
})

onMounted(() => {
  active.value = true
})
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
  controller?.abort()
  controller = null
})
onBeforeUnmount(() => {
  active.value = false
  controller?.abort()
  controller = null
})

function openDetail(row: FundWithdrawalDto): void {
  detail.value = row
  detailOpen.value = true
}
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      :title="t('fundWithdrawal.pageTitle')"
      :description="t('fundWithdrawal.pageDescription')"
    >
      <FaButton v-if="canRead" variant="outline" :loading="loading" @click="load">
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />
        {{ t('fundWithdrawal.refresh') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        row-key="id"
        :show-row-number="false"
        :columns="columns"
        :data="items"
        :total="total"
        :loading="loading"
        :error="loadError || undefined"
        :addable="false"
        :searchable="false"
        :page-size-options="[20, 50, 100]"
        :empty-title="t('fundWithdrawal.empty.own')"
        :empty-description="t('fundWithdrawal.empty.ownHint')"
        :action-column="{ fixed: 'right', width: 120, title: t('fundWithdrawal.column.action') }"
        table-class="w-max min-w-full"
        :aria-label="t('fundWithdrawal.pageTitle')"
        @pagination-change="load"
        @retry="load"
      >
        <template #query-leading>
          <div class="flex flex-wrap gap-3 items-center">
            <h2 class="qs-type-component-title m-0">
              {{ t('fundWithdrawal.pageTitle') }}
            </h2>
            <FaSelect
              v-model="status"
              :options="statusOptions"
              class="w-32"
              :aria-label="t('fundWithdrawal.statusFilter')"
            />
          </div>
        </template>

        <template #cell-amount="{ row }">
          <AmountDisplay
            :value="row.original.amount"
            :currency="row.original.currency"
            :currencies="currencyCatalog.currencies.value"
          />
        </template>

        <template #cell-status="{ row }">
          <span class="qs-type-tag px-2 py-0.5 border rounded-md" :class="withdrawalStatusMeta(row.original.status).tagClass">
            {{ t(withdrawalStatusMeta(row.original.status).labelKey) }}
          </span>
        </template>

        <template #cell-submittedAt="{ row }">
          <DateTimeDisplay :value="row.original.submittedAt" format="datetime" />
        </template>

        <template #cell-reviewedAt="{ row }">
          <DateTimeDisplay v-if="row.original.reviewedAt" :value="row.original.reviewedAt" format="datetime" />
          <span v-else class="text-muted-foreground">—</span>
        </template>

        <template #actions="{ row }">
          <FaButton
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            :aria-label="`${row.withdrawalNo} · ${t('fundWithdrawal.action.view')}`"
            @click="openDetail(row)"
          >
            <FaIcon name="i-lucide:eye" aria-hidden="true" />
            {{ t('fundWithdrawal.action.view') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <FundWithdrawalDetailModal
      v-model="detailOpen"
      :request="detail"
      scope="self"
    />
  </div>
</template>
