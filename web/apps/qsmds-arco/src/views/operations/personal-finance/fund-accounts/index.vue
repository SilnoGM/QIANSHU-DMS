<script setup lang="ts">
import type { ApiClientError } from '@/api/errors'
import type { FundSelfAccountDto, FundSelfTransactionDto } from '@/api/generated/types.gen'
import type { QsGenericTableColumn } from '@/components/business/QsGenericTable/logic'
import { getApiClientErrorMessage } from '@/api/errors'
import fundAccountsApi from '@/api/modules/fund-accounts'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import QsPersonalFundAccountCard from '@/components/business/QsPersonalFundAccountCard/index.vue'
import { formatUserShareRate } from '@/components/business/QsPersonalFundAccountCard/logic'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'
import {
  formatLedgerCny,
  formatLedgerSignedAmount,
  LEDGER_BATCH_KIND_META,
  LEDGER_CATEGORY_META,
  LEDGER_DIRECTION_META,
  LEDGER_REVERSAL_META,
} from './ledger.logic'

/**
 * 运营「个人财务 → 资金账户」页。
 *
 * 页面只读取本人账户与本人流水；请求带 AbortSignal，并在页面失活或身份切换时
 * 中止/重取，避免把上一个身份的数据留在当前页面。卡片与流水表是纯展示组件，
 * 状态与数据由这里传入。
 */
defineOptions({ name: 'OperationsPersonalFinanceFundAccounts' })

const { t } = useI18n()
const route = useRoute()
const { auth } = useAppAuth()
const appAccount = useAppAccountStore()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()

const active = ref(false)
/** 首帧保持骨架，避免先闪出“未开户”再被真实数据替换。 */
const accountLoading = ref(true)
const accountError = ref('')
const account = shallowRef<FundSelfAccountDto | null>(null)

const transactionPage = ref(1)
const transactionPageSize = ref(20)
const transactionTotal = ref(0)
const transactionLoading = ref(true)
const transactionError = ref('')
const transactions = shallowRef<FundSelfTransactionDto[]>([])

const canRead = computed(() => auth('fund-accounts:read-self'))
const enabled = computed(() => (
  active.value
  && canRead.value
  && route.name === 'qsOperationsPersonalFinanceFundAccounts'
))
const refreshing = computed(() => accountLoading.value || transactionLoading.value)
const ledgerColumns = computed<QsGenericTableColumn<FundSelfTransactionDto>[]>(() => [
  {
    id: 'sequence',
    accessorKey: 'accountSequence',
    title: t('personalFinanceLedger.column.sequence'),
    width: 64,
    minWidth: 64,
    maxWidth: 72,
    fixed: 'left',
  },
  {
    id: 'postedAt',
    accessorKey: 'postedAt',
    title: t('personalFinanceLedger.column.postedAt'),
    minWidth: 130,
  },
  {
    id: 'typeSource',
    accessorKey: 'postingTypeName',
    title: t('personalFinanceLedger.column.typeSource'),
    minWidth: 250,
  },
  {
    id: 'summary',
    accessorKey: 'summary',
    title: t('personalFinanceLedger.column.summary'),
    minWidth: 300,
  },
  {
    id: 'businessBasis',
    accessorKey: 'businessAmount',
    title: t('personalFinanceLedger.column.businessBasis'),
    minWidth: 180,
    align: 'right',
  },
  {
    id: 'amount',
    accessorKey: 'amount',
    title: t('personalFinanceLedger.column.amount'),
    minWidth: 180,
    align: 'right',
  },
  {
    id: 'balanceAfter',
    accessorKey: 'balanceAfter',
    title: t('personalFinanceLedger.column.balanceAfter'),
    minWidth: 180,
    align: 'right',
  },
  {
    id: 'balanceBefore',
    accessorKey: 'balanceBefore',
    title: t('personalFinanceLedger.column.balanceBefore'),
    minWidth: 180,
    align: 'right',
  },
])

let accountController: AbortController | null = null
let transactionController: AbortController | null = null

function currentAccount(request: AbortController, requestEpoch: number): boolean {
  return accountController === request
    && !request.signal.aborted
    && enabled.value
    && appAccount.authEpoch === requestEpoch
}

function currentTransactions(request: AbortController, requestEpoch: number): boolean {
  return transactionController === request
    && !request.signal.aborted
    && enabled.value
    && appAccount.authEpoch === requestEpoch
}

async function loadAccount(): Promise<void> {
  accountController?.abort()
  if (!enabled.value) {
    return
  }

  const request = new AbortController()
  const requestEpoch = appAccount.authEpoch
  accountController = request
  accountLoading.value = true
  accountError.value = ''

  try {
    const response = await fundAccountsApi.accounts.self(request.signal)
    if (currentAccount(request, requestEpoch)) {
      account.value = response.data.account
    }
  }
  catch (failure) {
    if (currentAccount(request, requestEpoch)) {
      accountError.value = getApiClientErrorMessage(failure as ApiClientError)
        || t('qsPersonalFundAccount.loadError')
    }
  }
  finally {
    if (accountController === request) {
      accountLoading.value = false
      accountController = null
    }
  }
}

async function loadTransactions(): Promise<void> {
  transactionController?.abort()
  if (!enabled.value) {
    return
  }

  const request = new AbortController()
  const requestEpoch = appAccount.authEpoch
  transactionController = request
  transactionLoading.value = true
  transactionError.value = ''

  try {
    const response = await fundAccountsApi.transactions.listSelf({
      page: transactionPage.value,
      pageSize: transactionPageSize.value,
    }, request.signal)
    if (!currentTransactions(request, requestEpoch)) {
      return
    }
    transactions.value = response.data.items
    transactionTotal.value = response.data.total
    // 新流水或数据变化后回到最后一个有效页，避免停在越界空页。
    if (
      response.data.items.length === 0
      && transactionPage.value > 1
      && response.data.total > 0
    ) {
      transactionPage.value = Math.max(
        1,
        Math.ceil(response.data.total / transactionPageSize.value),
      )
      void loadTransactions()
    }
  }
  catch (failure) {
    if (currentTransactions(request, requestEpoch)) {
      transactionError.value = getApiClientErrorMessage(failure as ApiClientError)
        || t('personalFinanceLedger.loadError')
    }
  }
  finally {
    if (transactionController === request) {
      transactionLoading.value = false
      transactionController = null
    }
  }
}

function reloadAll(): void {
  void loadAccount()
  void loadTransactions()
}

function categoryMeta(category: FundSelfTransactionDto['businessCategory']) {
  return LEDGER_CATEGORY_META[category]
}

function batchKindMeta(kind: FundSelfTransactionDto['batchKind']) {
  return LEDGER_BATCH_KIND_META[kind]
}

function reversalMeta(status: FundSelfTransactionDto['reversalStatus']) {
  return LEDGER_REVERSAL_META[status]
}

function directionMeta(direction: FundSelfTransactionDto['direction']) {
  return LEDGER_DIRECTION_META[direction]
}

function applyWithdrawal(): void {
  toast.info(t('qsPersonalFundAccount.withdrawalComingSoon'))
}

function viewWithdrawals(): void {
  toast.info(t('qsPersonalFundAccount.withdrawalRecordsComingSoon'))
}

function viewTransactionDetail(): void {
  toast.info(t('personalFinanceLedger.detailComingSoon'))
}

// 身份切换时先清空本人数据，避免在新请求完成前短暂显示上一个身份的余额与流水。
watch(() => appAccount.authEpoch, () => {
  account.value = null
  accountError.value = ''
  transactions.value = []
  transactionTotal.value = 0
  transactionPage.value = 1
})

// active 控制页面是否在台前；authEpoch 变化时重新取数。
watch([enabled, () => appAccount.authEpoch], ([isEnabled]) => {
  if (isEnabled) {
    reloadAll()
    return
  }
  accountController?.abort()
  accountController = null
  transactionController?.abort()
  transactionController = null
}, { immediate: true })

onMounted(() => {
  active.value = true
})
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
})
onBeforeUnmount(() => {
  active.value = false
  accountController?.abort()
  accountController = null
  transactionController?.abort()
  transactionController = null
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      :title="t('qsPersonalFundAccount.pageTitle')"
      :description="t('qsPersonalFundAccount.pageDescription')"
    >
      <FaButton
        v-if="canRead"
        variant="outline"
        :loading="refreshing"
        @click="reloadAll"
      >
        <FaIcon name="i-lucide:refresh-cw" aria-hidden="true" />
        {{ t('qsPersonalFundAccount.refresh') }}
      </FaButton>
    </FaPageHeader>

    <FaPageMain class="min-w-0">
      <QsPersonalFundAccountCard
        :account="account"
        :currencies="currencyCatalog.currencies.value"
        :loading="accountLoading"
        :error="accountError || null"
        @apply-withdrawal="applyWithdrawal"
        @view-withdrawals="viewWithdrawals"
        @retry="loadAccount"
      />

      <QsGenericTable
        v-model:page="transactionPage"
        v-model:page-size="transactionPageSize"
        class="mt-4"
        row-key="entryId"
        :show-row-number="false"
        :columns="ledgerColumns"
        :data="transactions"
        :total="transactionTotal"
        :loading="transactionLoading"
        :error="transactionError || undefined"
        :addable="false"
        :searchable="false"
        :page-size-options="[20, 50, 100]"
        :empty-title="t('personalFinanceLedger.empty')"
        :empty-description="t('personalFinanceLedger.emptyHint')"
        :action-column="{ fixed: 'right', width: 130, title: t('personalFinanceLedger.column.action') }"
        table-class="w-max min-w-full"
        :aria-label="t('personalFinanceLedger.ariaLabel')"
        @pagination-change="loadTransactions"
        @retry="loadTransactions"
      >
        <template #query-leading>
          <h2 class="qs-type-component-title m-0">
            {{ t('personalFinanceLedger.title') }}
          </h2>
        </template>

        <template #cell-sequence="{ row }">
          <span class="qs-type-data text-muted-foreground">
            #{{ row.original.accountSequence }}
          </span>
        </template>

        <template #cell-postedAt="{ row }">
          <div class="flex flex-col gap-1">
            <DateTimeDisplay
              :value="row.original.postedAt"
              format="date"
              class="qs-type-data-emphasis"
            />
            <DateTimeDisplay
              :value="row.original.postedAt"
              format="time"
              class="qs-type-data text-muted-foreground"
            />
          </div>
        </template>

        <template #cell-typeSource="{ row }">
          <div class="flex gap-3 items-start">
            <span
              class="rounded-xl flex-center shrink-0 size-10"
              :class="categoryMeta(row.original.businessCategory).tileClass"
              aria-hidden="true"
            >
              <FaIcon :name="categoryMeta(row.original.businessCategory).icon" class="size-5" />
            </span>
            <div class="min-w-0">
              <div class="flex flex-wrap gap-2 items-center">
                <span class="qs-type-compact-title">{{ row.original.postingTypeName }}</span>
                <span
                  v-if="batchKindMeta(row.original.batchKind)"
                  class="qs-type-tag px-2 py-0.5 border rounded-md inline-flex items-center"
                  :class="batchKindMeta(row.original.batchKind)?.pillClass"
                >
                  {{ t(batchKindMeta(row.original.batchKind)?.labelKey ?? '') }}
                </span>
              </div>
              <p class="qs-type-meta text-muted-foreground m-0 mt-1">
                {{ row.original.businessSourceName }} · {{ t(categoryMeta(row.original.businessCategory).labelKey) }}
              </p>
            </div>
          </div>
        </template>

        <template #cell-summary="{ row }">
          <div class="min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <span class="qs-type-compact-title">{{ row.original.summary }}</span>
              <span
                v-if="reversalMeta(row.original.reversalStatus)"
                class="qs-type-tag px-2 py-0.5 border rounded-md inline-flex items-center"
                :class="reversalMeta(row.original.reversalStatus)?.pillClass"
              >
                {{ t(reversalMeta(row.original.reversalStatus)?.labelKey ?? '') }}
              </span>
            </div>
            <div class="qs-type-meta text-muted-foreground mt-1 flex flex-wrap gap-x-4 gap-y-1 items-center">
              <span class="inline-flex gap-1 items-center">
                <FaIcon name="i-lucide:file-text" class="shrink-0 size-3.5" aria-hidden="true" />
                <template v-if="row.original.businessNo">
                  <span>{{ t('personalFinanceLedger.businessNo') }}:</span>
                  <span class="font-qs-data-mono">{{ row.original.businessNo }}</span>
                </template>
                <span v-else>{{ t('personalFinanceLedger.noBusinessNo') }}</span>
              </span>
              <span class="inline-flex gap-1 items-center">
                <FaIcon name="i-lucide:layers-2" class="shrink-0 size-3.5" aria-hidden="true" />
                <span>{{ t('personalFinanceLedger.batchNo') }}:</span>
                <span class="font-qs-data-mono">{{ row.original.batchNo }}</span>
              </span>
            </div>
          </div>
        </template>

        <template #cell-businessBasis="{ row }">
          <div class="text-right">
            <p class="qs-type-data-emphasis m-0 !text-base !font-semibold">
              {{ formatLedgerCny(row.original.businessAmount, currencyCatalog.currencies.value) }}
            </p>
            <p class="qs-type-meta text-muted-foreground m-0 mt-1">
              {{ t('personalFinanceLedger.shareRate') }} {{ formatUserShareRate(row.original.userShareRateSnapshot) }}
            </p>
          </div>
        </template>

        <template #cell-amount="{ row }">
          <div class="flex gap-2 items-center justify-end">
            <span
              class="qs-type-tag px-2 py-0.5 rounded-md"
              :class="directionMeta(row.original.direction).badgeClass"
            >
              {{ t(directionMeta(row.original.direction).labelKey) }}
            </span>
            <p
              class="qs-type-data-emphasis m-0 !text-base !font-semibold"
              :class="directionMeta(row.original.direction).amountClass"
            >
              {{ formatLedgerSignedAmount(row.original.amount, row.original.direction, currencyCatalog.currencies.value) }}
            </p>
          </div>
        </template>

        <template #cell-balanceAfter="{ row }">
          <p class="qs-type-data-emphasis m-0 text-right !text-base !font-semibold">
            {{ formatLedgerCny(row.original.balanceAfter, currencyCatalog.currencies.value) }}
          </p>
        </template>

        <template #cell-balanceBefore="{ row }">
          <p class="qs-type-data-emphasis m-0 text-right !text-base !font-semibold">
            {{ formatLedgerCny(row.original.balanceBefore, currencyCatalog.currencies.value) }}
          </p>
        </template>

        <template #actions>
          <FaButton
            variant="ghost"
            size="sm"
            class="min-h-11 sm:min-h-8"
            @click="viewTransactionDetail"
          >
            <FaIcon name="i-lucide:eye" aria-hidden="true" />
            {{ t('personalFinanceLedger.viewDetail') }}
          </FaButton>
        </template>
      </QsGenericTable>
    </FaPageMain>
  </div>
</template>
