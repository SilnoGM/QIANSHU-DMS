<script setup lang="ts">
import type { ApiClientError } from '@/api/errors'
import type { FundSelfAccountDto, FundWithdrawalDto } from '@/api/generated/types.gen'
import type { FundWithdrawalListSelfQuery } from '@/api/modules/fund-withdrawals'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { getApiClientErrorMessage } from '@/api/errors'
import fundAccountsApi from '@/api/modules/fund-accounts'
import fundWithdrawalsApi from '@/api/modules/fund-withdrawals'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import ImageGroup from '@/components/base/ImageGroup/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonDisplay from '@/components/business/QsPersonDisplay/index.vue'
import QsStatusSwitchToolbar from '@/components/business/QsStatusSwitchToolbar/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import ApplyWithdrawalModal from '../fund-accounts/apply-withdrawal-modal.vue'
import FundWithdrawalDetailDrawer from './fund-withdrawal-detail-drawer.vue'
import {
  FUND_WITHDRAWAL_STATUS_FILTER_OPTIONS,
  withdrawalStatusMeta,
} from './status.logic'
import { buildWithdrawalProofItems } from './withdrawal-proof.logic'

defineOptions({ name: 'OperationsPersonalFinanceWithdrawals' })

const { t } = useI18n()
const { auth } = useAppAuth()
const appAccount = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()
const canRead = computed(() => auth('fund-withdrawals:create'))
const canReadAccount = computed(() => auth('fund-accounts:read-self'))
const active = ref(false)
const status = ref<'ALL' | FundWithdrawalDto['status']>('ALL')
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const items = ref<FundWithdrawalDto[]>([])
const counts = ref<Record<string, number>>({})
const loading = ref(false)
const loadError = ref('')
const account = shallowRef<FundSelfAccountDto | null>(null)
const accountLoading = ref(true)
const accountError = ref('')
const withdrawalOpen = ref(false)
const withdrawalSubmitting = ref(false)
const withdrawalError = ref('')
const withdrawalKey = ref('')
const detailOpen = ref(false)
const detail = ref<FundWithdrawalDto | null>(null)
let controller: AbortController | null = null
let accountController: AbortController | null = null

const enabled = computed(() => active.value && canRead.value)
const accountEnabled = computed(() => enabled.value && canReadAccount.value)
const toolbarItems = computed(() => FUND_WITHDRAWAL_STATUS_FILTER_OPTIONS.map(item => ({
  value: item.value,
  label: t(item.labelKey),
  count: counts.value[item.value] ?? 0,
})))
const columns = computed<QsGenericTableColumn<FundWithdrawalDto>[]>(() => [
  { id: 'withdrawalNo', accessorKey: 'withdrawalNo', title: t('fundWithdrawal.column.withdrawalNo'), minWidth: 174, fixed: 'left' },
  { id: 'amount', accessorKey: 'amount', title: t('fundWithdrawal.column.amount'), minWidth: 220, align: 'right' },
  { id: 'paymentProof', accessorFn: row => row.paymentProof?.mediaAssetId ?? '', title: t('fundWithdrawal.column.paymentProof'), minWidth: 110 },
  { id: 'status', accessorKey: 'status', title: t('fundWithdrawal.column.status'), minWidth: 120 },
  { id: 'submittedAt', accessorKey: 'submittedAt', title: t('fundWithdrawal.column.submittedAt'), minWidth: 190 },
  { id: 'reviewedAt', accessorKey: 'reviewedAt', title: t('fundWithdrawal.column.reviewedAt'), minWidth: 190 },
  { id: 'reviewer', accessorKey: 'reviewerName', title: t('fundWithdrawal.column.reviewer'), minWidth: 150 },
])

/**
 * 列表与各状态计数来自同一个服务端快照；不再为其余状态各发一次列表请求。
 * 请求共享同一个 AbortSignal，避免筛选切换后旧计数覆盖新状态。
 */
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
  try {
    const query: FundWithdrawalListSelfQuery = {
      page: page.value,
      pageSize: pageSize.value,
      status: selectedStatus,
    }
    const list = await fundWithdrawalsApi.listSelf(query, request.signal)
    if (!request.signal.aborted && controller === request) {
      items.value = list.data.items
      total.value = list.data.total
      const nextCounts: Record<string, number> = {}
      let allCount = 0
      for (const entry of list.data.statusCounts) {
        nextCounts[entry.status] = entry.count
        allCount += entry.count
      }
      nextCounts.ALL = allCount
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

async function loadAccount(): Promise<void> {
  accountController?.abort()
  if (!accountEnabled.value) {
    account.value = null
    accountLoading.value = false
    return
  }
  const request = new AbortController()
  accountController = request
  accountLoading.value = true
  accountError.value = ''
  try {
    const response = await fundAccountsApi.accounts.self(request.signal)
    if (!request.signal.aborted && accountController === request) {
      account.value = response.data.account
    }
  }
  catch (failure) {
    if (!request.signal.aborted && accountController === request) {
      account.value = null
      accountError.value = getApiClientErrorMessage(failure as ApiClientError)
        || t('fundWithdrawal.error.account')
    }
  }
  finally {
    if (accountController === request) {
      accountLoading.value = false
      accountController = null
    }
  }
}

function openApply(): void {
  if (account.value === null) {
    if (accountError.value) {
      toast.error(accountError.value)
    }
    else {
      toast.info(t('fundWithdrawal.apply.unavailable'))
    }
    return
  }
  withdrawalKey.value = crypto.randomUUID()
  withdrawalError.value = ''
  withdrawalOpen.value = true
}

async function submitWithdrawal(payload: { amount: string, currency: string }): Promise<void> {
  if (withdrawalSubmitting.value || account.value === null) {
    return
  }
  withdrawalSubmitting.value = true
  withdrawalError.value = ''
  let succeeded = false
  try {
    await fundWithdrawalsApi.create({ amount: payload.amount }, withdrawalKey.value)
    succeeded = true
  }
  catch (failure) {
    withdrawalError.value = getApiClientErrorMessage(failure as ApiClientError)
      || t('fundWithdrawal.error.submit')
  }
  finally {
    withdrawalSubmitting.value = false
  }
  if (!succeeded) {
    return
  }
  withdrawalOpen.value = false
  toast.info(t('fundWithdrawal.toast.submitted'))
  if (status.value !== 'ALL' || page.value !== 1) {
    status.value = 'ALL'
    page.value = 1
    return
  }
  void load()
}

// 身份切换时先中止旧请求并清空本人数据，随后由下面的取数 watcher 重新加载。
watch(() => appAccount.authEpoch, () => {
  controller?.abort()
  controller = null
  accountController?.abort()
  accountController = null
  loading.value = false
  accountLoading.value = false
  account.value = null
  accountError.value = ''
  items.value = []
  counts.value = {}
  total.value = 0
  withdrawalOpen.value = false
})

watch([enabled, status, page, pageSize, () => appAccount.authEpoch], () => {
  if (enabled.value) {
    void load()
  }
}, { immediate: true })

watch([accountEnabled, () => appAccount.authEpoch], () => {
  void loadAccount()
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
  withdrawalOpen.value = false
  controller?.abort()
  controller = null
  accountController?.abort()
  accountController = null
  loading.value = false
  accountLoading.value = false
})
onBeforeUnmount(() => {
  active.value = false
  controller?.abort()
  controller = null
  accountController?.abort()
  accountController = null
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
      <FaButton v-if="canRead" :loading="accountLoading" @click="openApply">
        <FaIcon name="i-lucide:plus" aria-hidden="true" />
        {{ t('fundWithdrawal.action.create') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <QsStatusSwitchToolbar
        v-model="status"
        :items="toolbarItems"
        :aria-label="t('fundWithdrawal.pageTitle')"
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
        :empty-title="t('fundWithdrawal.empty.own')"
        :empty-description="t('fundWithdrawal.empty.ownHint')"
        :action-column="{ fixed: 'right', width: 120, title: t('fundWithdrawal.column.action') }"
        table-class="w-max min-w-full"
        :aria-label="t('fundWithdrawal.pageTitle')"
        @pagination-change="load"
        @retry="load"
      >
        <template #cell-amount="{ row }">
          <AmountDisplay
            :value="row.original.amount"
            :currency="row.original.currency"
            :currencies="currencyCatalog.currencies.value"
          />
        </template>

        <template #cell-paymentProof="{ row }">
          <ImageGroup
            :items="buildWithdrawalProofItems(row.original, t('fundWithdrawal.column.paymentProof'))"
            :max-count="1"
            radius="lg"
            size="sm"
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

        <template #cell-reviewer="{ row }">
          <QsPersonDisplay v-if="row.original.reviewerName" :display-name="row.original.reviewerName" size="md" :avatar-url="row.original.reviewerAvatarUrl" />
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

      <ApplyWithdrawalModal
        v-if="account"
        v-model="withdrawalOpen"
        :balance="account.balance"
        :currency="account.currency"
        :currencies="currencyCatalog.currencies.value"
        :error="withdrawalError || null"
        :submitting="withdrawalSubmitting"
        @submit="submitWithdrawal"
      />
    </FaPageMain>

    <FundWithdrawalDetailDrawer
      v-model="detailOpen"
      :request="detail"
      scope="self"
    />
  </div>
</template>
