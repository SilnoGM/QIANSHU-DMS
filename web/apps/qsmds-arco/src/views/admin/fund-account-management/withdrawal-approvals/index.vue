<script setup lang="ts">
import type { ApiClientError } from '@/api/errors'
import type { FundWithdrawalDto } from '@/api/generated/types.gen'
import type { FundWithdrawalListQuery } from '@/api/modules/fund-withdrawals'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { getApiClientErrorMessage } from '@/api/errors'
import fundWithdrawalsApi from '@/api/modules/fund-withdrawals'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import FundWithdrawalApproveModal from '@/views/operations/personal-finance/withdrawals/fund-withdrawal-approve-modal.vue'
import FundWithdrawalDetailDrawer from '@/views/operations/personal-finance/withdrawals/fund-withdrawal-detail-drawer.vue'
import FundWithdrawalRejectModal from '@/views/operations/personal-finance/withdrawals/fund-withdrawal-reject-modal.vue'
import {
  FUND_WITHDRAWAL_STATUS_FILTER_OPTIONS,
  withdrawalStatusMeta,
} from '@/views/operations/personal-finance/withdrawals/status.logic'

defineOptions({ name: 'FinanceFundWithdrawalApprovals' })

const { t } = useI18n()
const { auth } = useAppAuth()
const currencyCatalog = useCurrencyCatalog()
const canReview = computed(() => auth('fund-withdrawals:review'))
const active = ref(false)
const status = ref<'ALL' | FundWithdrawalDto['status']>('PENDING')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<FundWithdrawalDto[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(false)
const loadError = ref('')
const detailOpen = ref(false)
const detail = ref<FundWithdrawalDto | null>(null)
const approveOpen = ref(false)
const rejectOpen = ref(false)
const reviewTarget = ref<FundWithdrawalDto | null>(null)
let controller: AbortController | null = null

const enabled = computed(() => active.value && canReview.value)
const toolbarItems = computed(() => FUND_WITHDRAWAL_STATUS_FILTER_OPTIONS.map(item => ({
  value: item.value,
  label: t(item.labelKey),
  count: counts.value[item.value] ?? 0,
})))
const columns = computed<QsGenericTableColumn<FundWithdrawalDto>[]>(() => [
  { id: 'withdrawalNo', accessorKey: 'withdrawalNo', title: t('fundWithdrawal.column.withdrawalNo'), minWidth: 174, fixed: 'left' },
  { id: 'applicant', accessorKey: 'applicantName', title: t('fundWithdrawal.column.applicant'), minWidth: 190 },
  { id: 'amount', accessorKey: 'amount', title: t('fundWithdrawal.column.amount'), minWidth: 200, align: 'right' },
  { id: 'accountBalance', accessorKey: 'accountBalance', title: t('fundWithdrawal.column.accountBalance'), minWidth: 190, align: 'right' },
  { id: 'status', accessorKey: 'status', title: t('fundWithdrawal.column.status'), minWidth: 120 },
  { id: 'submittedAt', accessorKey: 'submittedAt', title: t('fundWithdrawal.column.submittedAt'), minWidth: 190 },
  { id: 'reviewedAt', accessorKey: 'reviewedAt', title: t('fundWithdrawal.column.reviewedAt'), minWidth: 190 },
])

/** 与运营页同口径：当前状态取整页，其余三个视图各取一页 total 作为工具栏计数。 */
async function load(): Promise<void> {
  controller?.abort()
  if (!enabled.value) {
    return
  }
  const request = new AbortController()
  controller = request
  loading.value = true
  loadError.value = ''
  const selectedStatus = status.value
  const countStatuses = FUND_WITHDRAWAL_STATUS_FILTER_OPTIONS.filter(
    item => item.value !== selectedStatus,
  )
  try {
    const query: FundWithdrawalListQuery = {
      page: page.value,
      pageSize: pageSize.value,
      status: selectedStatus,
    }
    const [list, ...countResponses] = await Promise.all([
      fundWithdrawalsApi.list(query, request.signal),
      ...countStatuses.map(item => fundWithdrawalsApi.list({
        page: 1,
        pageSize: 1,
        status: item.value,
      }, request.signal)),
    ])
    if (!request.signal.aborted && controller === request) {
      items.value = list.data.items
      total.value = list.data.total
      const nextCounts: Record<string, number> = { [selectedStatus]: list.data.total }
      countStatuses.forEach((item, index) => {
        nextCounts[item.value] = countResponses[index]?.data.total ?? 0
      })
      counts.value = nextCounts
    }
  }
  catch (failure) {
    if (!request.signal.aborted && controller === request) {
      loadError.value = getApiClientErrorMessage(failure as ApiClientError)
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

function openApprove(row: FundWithdrawalDto): void {
  reviewTarget.value = row
  approveOpen.value = true
}

function openReject(row: FundWithdrawalDto): void {
  reviewTarget.value = row
  rejectOpen.value = true
}

function completed(): void {
  void load()
}
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      :title="t('fundWithdrawal.approvalPageTitle')"
      :description="t('fundWithdrawal.approvalPageDescription')"
    />

    <FaPageMain class="min-w-0">
      <QsStatusSwitchToolbar
        v-model="status"
        :items="toolbarItems"
        :aria-label="t('fundWithdrawal.approvalPageTitle')"
        class="mb-4"
      />
      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        row-key="id"
        :columns="columns"
        :data="items"
        :total="total"
        :loading="loading"
        :error="loadError || undefined"
        :addable="false"
        :searchable="false"
        :page-size-options="[20, 50, 100]"
        :empty-title="t('fundWithdrawal.empty.review')"
        :empty-description="t('fundWithdrawal.empty.reviewHint')"
        :action-column="{ fixed: 'right', minWidth: 180, width: 180, title: t('fundWithdrawal.column.action') }"
        table-class="w-max min-w-full"
        :aria-label="t('fundWithdrawal.approvalPageTitle')"
        @pagination-change="load"
        @retry="load"
      >
        <template #cell-applicant="{ row }">
          <QsPersonDisplay :display-name="row.original.applicantName" size="md" :avatar-url="row.original.applicantAvatarUrl" />
        </template>

        <template #cell-amount="{ row }">
          <AmountDisplay
            :value="row.original.amount"
            :currency="row.original.currency"
            :currencies="currencyCatalog.currencies.value"
          />
        </template>

        <template #cell-accountBalance="{ row }">
          <AmountDisplay
            :value="row.original.accountBalance"
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
          <div v-if="row.status === 'PENDING'" class="flex gap-1">
            <FaButton
              variant="ghost"
              size="sm"
              class="min-h-11 sm:min-h-8"
              @click="openApprove(row)"
            >
              <FaIcon name="i-lucide:check" aria-hidden="true" />
              {{ t('fundWithdrawal.action.approve') }}
            </FaButton>
            <FaButton
              variant="ghost"
              size="sm"
              class="text-destructive min-h-11 sm:min-h-8"
              @click="openReject(row)"
            >
              <FaIcon name="i-lucide:x" aria-hidden="true" />
              {{ t('fundWithdrawal.action.reject') }}
            </FaButton>
          </div>
          <FaButton
            v-else
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            @click="openDetail(row)"
          >
            <FaIcon name="i-lucide:eye" aria-hidden="true" />
            {{ t('fundWithdrawal.action.view') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <FundWithdrawalDetailDrawer
      v-model="detailOpen"
      :request="detail"
      scope="review"
    />
    <FundWithdrawalApproveModal
      v-model="approveOpen"
      :request="reviewTarget"
      @completed="completed"
    />
    <FundWithdrawalRejectModal
      v-model="rejectOpen"
      :request="reviewTarget"
      @completed="completed"
    />
  </div>
</template>
