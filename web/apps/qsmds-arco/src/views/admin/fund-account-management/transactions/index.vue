<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type {
  FundApiFailure,
  FundBatchDetailState,
  FundIdempotentSubmissionState,
} from '../shared/fund-request.logic'
import type { FundTransactionFilterState } from './fund-transaction.logic'
import type {
  CreateFundReversalRequestDto,
  FundAccountDto,
  FundBusinessSourceDto,
  FundPostingBatchDetailDto,
  FundPostingTypeDto,
  FundTransactionDto,
} from '@/api/generated/types.gen'

import fundAccountsApi from '@/api/modules/fund-accounts'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

import { withFundAccountPrecision } from '../list/fund-account-list.logic'
import {
  abandonFundIdempotentSubmission,
  applyFundBatchDetail,
  beginFundIdempotentSubmission,
  canApplyFundResponse,
  clearFundIdempotentSubmission,
  closeFundBatchDetail,
  completeFundIdempotentSubmission,
  createClosedFundBatchDetailState,
  createFundIdempotentSubmissionState,
  failFundBatchDetail,
  failFundIdempotentSubmission,
  getFundApiFailure,
  isFundAbortError,
  retryFundIdempotentSubmission,
  startFundBatchDetailLoad,
} from '../shared/fund-request.logic'
import FundBatchDetailDrawer from './fund-batch-detail-drawer.vue'
import FundReversalModal from './fund-reversal-modal.vue'
import FundTransactionFilters from './fund-transaction-filters.vue'
import FundTransactionTable from './fund-transaction-table.vue'
import {
  buildFundTransactionQuery,
  canReverseFundBatch,
} from './fund-transaction.logic'

defineOptions({ name: 'QsFinanceFundAccountTransactions' })

interface FilterOption {
  readonly label: string
  readonly value: string
}

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const SORT_FIELDS = new Set(['amount', 'businessOccurredAt', 'postedAt'])

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const route = useRoute()
const currencyCatalog = useCurrencyCatalog()
const toast = useQsToast()

const canRead = computed(() => auth('fund-accounts:read'))
const canReverse = computed(() => auth('fund-transactions:reverse'))
const canManagePostingTypes = computed(() => auth('fund-posting-types:manage'))
const canManageBusinessSources = computed(() => auth('fund-business-sources:manage'))
const fundCurrencies = computed(() => withFundAccountPrecision(
  currencyCatalog.currencies.value,
))

const initialAccountId = typeof route.query.accountId === 'string'
  && UUID_V4_PATTERN.test(route.query.accountId)
  ? route.query.accountId
  : undefined

const transactions = ref<FundTransactionDto[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const sorting = ref<TableSortingState>([])
const filters = ref<FundTransactionFilterState>(
  initialAccountId === undefined ? {} : { accountId: initialAccountId },
)
const loading = ref(false)
const listFailure = ref<FundApiFailure | null>(null)

const catalogAccounts = ref<FundAccountDto[]>([])
const catalogPostingTypes = ref<FundPostingTypeDto[]>([])
const catalogBusinessSources = ref<FundBusinessSourceDto[]>([])
const catalogLoading = ref(false)
const catalogFailure = ref<FundApiFailure | null>(null)

const detailVisible = ref(false)
const detailState = ref<FundBatchDetailState>(createClosedFundBatchDetailState())

const reversalVisible = ref(false)
const reversalTarget = ref<FundPostingBatchDetailDto | null>(null)
const reversalSubmitting = ref(false)
const reversalFailure = ref<FundApiFailure | null>(null)
const reversalSubmission = ref<FundIdempotentSubmissionState<CreateFundReversalRequestDto>>(
  createFundIdempotentSubmissionState<CreateFundReversalRequestDto>(),
)

let listRequestVersion = 0
let listAbortController: AbortController | null = null
let catalogRequestVersion = 0
let catalogAbortController: AbortController | null = null
let detailRequestVersion = 0
let detailAbortController: AbortController | null = null
let reversalMutationVersion = 0

const listErrorDisplay = computed(() => formatFailure(listFailure.value))
const catalogErrorDisplay = computed(() => formatFailure(catalogFailure.value))
const detail = computed(() => detailState.value.phase === 'ready'
  ? detailState.value.detail
  : null)
const detailLoading = computed(() => detailState.value.phase === 'loading')
const detailFailure = computed(() => detailState.value.phase === 'failed'
  ? detailState.value.failure
  : null)
const detailCanReverse = computed(() => detail.value !== null && (
  canReverseFundBatch(detail.value, canReverse.value)
))
const reversalUnknownResult = computed(() => (
  reversalSubmission.value.phase === 'unknown'
))

const accountOptions = computed<FilterOption[]>(() => uniqueOptions([
  ...catalogAccounts.value.map(account => ({
    label: account.ownerType === 'COMPANY'
      ? '公司资金账户'
      : `${account.user?.displayName ?? '未知用户'} · ${account.user?.username ?? '—'}`,
    value: account.id,
  })),
  ...transactions.value.map(transaction => ({
    label: transaction.account.ownerType === 'COMPANY'
      ? '公司资金账户'
      : `${transaction.account.user?.displayName ?? '未知用户'} · ${transaction.account.user?.username ?? '—'}`,
    value: transaction.account.id,
  })),
]))

const userOptions = computed<FilterOption[]>(() => uniqueOptions([
  ...catalogAccounts.value.flatMap(account => account.user === null
    ? []
    : [{
        label: `${account.user.displayName} · ${account.user.username}`,
        value: account.user.id,
      }]),
  ...transactions.value.flatMap(transaction => transaction.account.user === null
    ? []
    : [{
        label: `${transaction.account.user.displayName} · ${transaction.account.user.username}`,
        value: transaction.account.user.id,
      }]),
]))

const postingTypeOptions = computed<FilterOption[]>(() => uniqueOptions([
  ...catalogPostingTypes.value.map(type => ({
    label: type.name,
    value: type.id,
  })),
  ...transactions.value.map(transaction => ({
    label: transaction.postingTypeName,
    value: transaction.postingTypeId,
  })),
]))

const businessSourceOptions = computed<FilterOption[]>(() => uniqueOptions([
  ...catalogBusinessSources.value.map(source => ({
    label: source.name,
    value: source.id,
  })),
  ...transactions.value.map(transaction => ({
    label: transaction.businessSourceName,
    value: transaction.businessSourceId,
  })),
]))

function uniqueOptions(options: readonly FilterOption[]): FilterOption[] {
  const byValue = new Map<string, FilterOption>()
  for (const option of options) {
    if (!byValue.has(option.value)) {
      byValue.set(option.value, option)
    }
  }
  return [...byValue.values()].sort((left, right) => (
    left.label.localeCompare(right.label, 'zh-CN')
  ))
}

function formatFailure(failure: FundApiFailure | null): string | undefined {
  if (failure === null) {
    return undefined
  }
  return failure.requestId === undefined
    ? failure.message
    : `${failure.message}（requestId: ${failure.requestId}）`
}

function localFailure(error: RangeError): FundApiFailure {
  return Object.freeze({
    code: 'LOCAL_VALIDATION_FAILED',
    fieldErrors: Object.freeze({}),
    message: error.message,
    requestId: undefined,
    status: undefined,
    unknownResult: false,
  })
}

function responseIsCurrent(
  requestVersion: number,
  latestRequestVersion: number,
  authEpoch: number,
  controller: AbortController,
  authorized: boolean,
): boolean {
  return canApplyFundResponse({
    aborted: controller.signal.aborted,
    authEpoch,
    authorized,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion,
    requestVersion,
  })
}

function mutationResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  batchId: string,
): boolean {
  return canApplyFundResponse({
    aborted: false,
    authEpoch,
    authorized: canRead.value
      && canReverse.value
      && reversalTarget.value?.id === batchId,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion: reversalMutationVersion,
    requestVersion,
  })
}

function currentSort(): {
  sortBy: 'amount' | 'businessOccurredAt' | 'postedAt'
  sortOrder: 'asc' | 'desc'
} {
  const first = sorting.value[0]
  if (first && SORT_FIELDS.has(first.id)) {
    return {
      sortBy: first.id as 'amount' | 'businessOccurredAt' | 'postedAt',
      sortOrder: first.desc ? 'desc' : 'asc',
    }
  }
  return { sortBy: 'postedAt', sortOrder: 'desc' }
}

async function loadTransactions(): Promise<void> {
  if (!canRead.value) {
    return
  }
  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const requestVersion = ++listRequestVersion
  const authEpoch = appAccountStore.authEpoch
  let query
  try {
    query = buildFundTransactionQuery({
      filters: filters.value,
      page: page.value,
      pageSize: pageSize.value,
      ...currentSort(),
    })
  }
  catch (error) {
    if (error instanceof RangeError) {
      listFailure.value = localFailure(error)
    }
    return
  }

  loading.value = true
  listFailure.value = null
  try {
    const response = await fundAccountsApi.transactions.list(
      query,
      controller.signal,
    )
    if (!responseIsCurrent(
      requestVersion,
      listRequestVersion,
      authEpoch,
      controller,
      canRead.value,
    )) {
      return
    }
    transactions.value = response.data.items.map(item => ({
      ...item,
      account: {
        ...item.account,
        user: item.account.user === null ? null : { ...item.account.user },
      },
    }))
    total.value = response.data.total
    if (
      transactions.value.length === 0
      && page.value > 1
      && response.data.total > 0
    ) {
      page.value = Math.max(1, Math.ceil(response.data.total / pageSize.value))
      void loadTransactions()
    }
  }
  catch (error) {
    if (
      !isFundAbortError(error)
      && responseIsCurrent(
        requestVersion,
        listRequestVersion,
        authEpoch,
        controller,
        canRead.value,
      )
    ) {
      transactions.value = []
      total.value = 0
      listFailure.value = getFundApiFailure(error)
    }
  }
  finally {
    if (requestVersion === listRequestVersion) {
      loading.value = false
    }
  }
}

async function readAllAccounts(signal: AbortSignal): Promise<FundAccountDto[]> {
  const items: FundAccountDto[] = []
  let nextPage = 1
  while (!signal.aborted) {
    const response = await fundAccountsApi.accounts.list({
      page: nextPage,
      pageSize: 100,
      sortBy: 'createdAt',
      sortOrder: 'asc',
    }, signal)
    items.push(...response.data.items)
    if (items.length >= response.data.total || response.data.items.length === 0) {
      break
    }
    nextPage += 1
  }
  return items
}

async function readAllPostingTypes(signal: AbortSignal): Promise<FundPostingTypeDto[]> {
  if (!canManagePostingTypes.value) {
    return []
  }
  const items: FundPostingTypeDto[] = []
  let nextPage = 1
  while (!signal.aborted) {
    const response = await fundAccountsApi.postingTypes.list({
      page: nextPage,
      pageSize: 100,
      sortBy: 'code',
      sortOrder: 'asc',
    }, signal)
    items.push(...response.data.items)
    if (items.length >= response.data.total || response.data.items.length === 0) {
      break
    }
    nextPage += 1
  }
  return items
}

async function readAllBusinessSources(
  signal: AbortSignal,
): Promise<FundBusinessSourceDto[]> {
  if (!canManageBusinessSources.value) {
    return []
  }
  const items: FundBusinessSourceDto[] = []
  let nextPage = 1
  while (!signal.aborted) {
    const response = await fundAccountsApi.businessSources.list({
      page: nextPage,
      pageSize: 100,
      sortBy: 'code',
      sortOrder: 'asc',
    }, signal)
    items.push(...response.data.items)
    if (items.length >= response.data.total || response.data.items.length === 0) {
      break
    }
    nextPage += 1
  }
  return items
}

async function loadFilterCatalog(): Promise<void> {
  if (!canRead.value) {
    return
  }
  catalogAbortController?.abort()
  const controller = new AbortController()
  catalogAbortController = controller
  const requestVersion = ++catalogRequestVersion
  const authEpoch = appAccountStore.authEpoch
  catalogLoading.value = true
  catalogFailure.value = null
  try {
    const [accounts, postingTypes, businessSources] = await Promise.all([
      readAllAccounts(controller.signal),
      readAllPostingTypes(controller.signal),
      readAllBusinessSources(controller.signal),
    ])
    if (!responseIsCurrent(
      requestVersion,
      catalogRequestVersion,
      authEpoch,
      controller,
      canRead.value,
    )) {
      return
    }
    catalogAccounts.value = accounts
    catalogPostingTypes.value = postingTypes
    catalogBusinessSources.value = businessSources
  }
  catch (error) {
    if (
      !isFundAbortError(error)
      && responseIsCurrent(
        requestVersion,
        catalogRequestVersion,
        authEpoch,
        controller,
        canRead.value,
      )
    ) {
      catalogFailure.value = getFundApiFailure(error)
    }
  }
  finally {
    if (requestVersion === catalogRequestVersion) {
      catalogLoading.value = false
    }
  }
}

function applyFilters(nextFilters: FundTransactionFilterState): void {
  filters.value = { ...nextFilters }
  page.value = 1
  void loadTransactions()
}

function handlePagination(input: { page: number, pageSize: number }): void {
  page.value = input.page
  pageSize.value = input.pageSize
  void loadTransactions()
}

function handleSorting(nextSorting: TableSortingState): void {
  sorting.value = [...nextSorting]
  page.value = 1
  void loadTransactions()
}

async function loadBatchDetail(batchId: string): Promise<void> {
  if (!canRead.value || !detailVisible.value) {
    return
  }
  detailAbortController?.abort()
  const controller = new AbortController()
  detailAbortController = controller
  const requestVersion = ++detailRequestVersion
  const authEpoch = appAccountStore.authEpoch
  detailState.value = startFundBatchDetailLoad(detailState.value, batchId)
  try {
    const response = await fundAccountsApi.batches.get(batchId, controller.signal)
    if (!responseIsCurrent(
      requestVersion,
      detailRequestVersion,
      authEpoch,
      controller,
      canRead.value && detailVisible.value,
    )) {
      return
    }
    detailState.value = applyFundBatchDetail(detailState.value, {
      ...response.data,
      entries: response.data.entries.map(entry => ({
        ...entry,
        account: {
          ...entry.account,
          user: entry.account.user === null ? null : { ...entry.account.user },
        },
      })),
      metadata: { ...response.data.metadata },
      reversalChain: {
        ...response.data.reversalChain,
        reversals: response.data.reversalChain.reversals.map(item => ({ ...item })),
      },
      user: response.data.user === null ? null : { ...response.data.user },
    })
  }
  catch (error) {
    if (
      !isFundAbortError(error)
      && responseIsCurrent(
        requestVersion,
        detailRequestVersion,
        authEpoch,
        controller,
        canRead.value && detailVisible.value,
      )
    ) {
      detailState.value = failFundBatchDetail(
        detailState.value,
        getFundApiFailure(error),
      )
    }
  }
}

function openBatchDetail(transaction: FundTransactionDto): void {
  if (!canRead.value) {
    return
  }
  detailVisible.value = true
  void loadBatchDetail(transaction.batchId)
}

function updateDetailVisible(value: boolean): void {
  if (value) {
    detailVisible.value = true
    return
  }
  if (reversalSubmitting.value || reversalUnknownResult.value) {
    return
  }
  detailRequestVersion += 1
  detailAbortController?.abort()
  detailVisible.value = false
  detailState.value = closeFundBatchDetail(detailState.value)
  reversalVisible.value = false
  reversalTarget.value = null
  reversalFailure.value = null
  reversalSubmission.value = clearFundIdempotentSubmission(
    reversalSubmission.value,
  )
}

function retryBatchDetail(): void {
  const batchId = detailState.value.batchId
  if (batchId !== null) {
    void loadBatchDetail(batchId)
  }
}

function openReversal(target: FundPostingBatchDetailDto): void {
  if (!canReverseFundBatch(target, canReverse.value)) {
    return
  }
  reversalTarget.value = target
  reversalFailure.value = null
  reversalSubmission.value = createFundIdempotentSubmissionState<CreateFundReversalRequestDto>()
  reversalVisible.value = true
}

function updateReversalVisible(value: boolean): void {
  if (value) {
    reversalVisible.value = true
    return
  }
  if (reversalSubmitting.value || reversalUnknownResult.value) {
    return
  }
  reversalVisible.value = false
  reversalTarget.value = null
  reversalFailure.value = null
  reversalSubmission.value = clearFundIdempotentSubmission(
    reversalSubmission.value,
  )
}

async function executeReversal(
  requestVersion: number,
  authEpoch: number,
  batchId: string,
): Promise<void> {
  const submission = reversalSubmission.value.submission
  if (submission === null) {
    return
  }
  reversalSubmitting.value = true
  reversalFailure.value = null
  try {
    await fundAccountsApi.batches.reverse(
      batchId,
      submission.payload,
      submission.idempotencyKey,
    )
    if (!mutationResponseIsCurrent(requestVersion, authEpoch, batchId)) {
      return
    }
    reversalSubmission.value = completeFundIdempotentSubmission(
      reversalSubmission.value,
    )
    // QsGenericModal 在 submitting=true 时拒绝程序化关闭，先释放锁并等待属性回流。
    reversalSubmitting.value = false
    await nextTick()
    reversalVisible.value = false
    reversalTarget.value = null
    toast.success('批次冲账已提交')
    void loadTransactions()
    if (detailVisible.value) {
      void loadBatchDetail(batchId)
    }
  }
  catch (error) {
    if (!mutationResponseIsCurrent(requestVersion, authEpoch, batchId)) {
      return
    }
    const failure = getFundApiFailure(error)
    reversalFailure.value = failure
    reversalSubmission.value = failFundIdempotentSubmission(
      reversalSubmission.value,
      failure,
    )
  }
  finally {
    if (requestVersion === reversalMutationVersion) {
      reversalSubmitting.value = false
    }
  }
}

function submitReversal(payload: CreateFundReversalRequestDto): void {
  const target = reversalTarget.value
  if (
    target === null
    || !canReverseFundBatch(target, canReverse.value)
    || reversalSubmitting.value
    || reversalSubmission.value.phase !== 'idle'
  ) {
    return
  }
  reversalSubmission.value = beginFundIdempotentSubmission(
    reversalSubmission.value,
    () => payload,
    () => crypto.randomUUID(),
  )
  const requestVersion = ++reversalMutationVersion
  void executeReversal(requestVersion, appAccountStore.authEpoch, target.id)
}

function retryReversal(): void {
  const target = reversalTarget.value
  if (
    target === null
    || !canReverseFundBatch(target, canReverse.value)
    || reversalSubmitting.value
    || reversalSubmission.value.phase !== 'unknown'
  ) {
    return
  }
  reversalSubmission.value = retryFundIdempotentSubmission(
    reversalSubmission.value,
  )
  const requestVersion = ++reversalMutationVersion
  void executeReversal(requestVersion, appAccountStore.authEpoch, target.id)
}

function abandonReversal(): void {
  const batchId = reversalTarget.value?.id
  if (reversalSubmission.value.phase !== 'unknown') {
    return
  }
  reversalSubmission.value = abandonFundIdempotentSubmission(
    reversalSubmission.value,
  )
  reversalVisible.value = false
  reversalTarget.value = null
  reversalFailure.value = null
  void loadTransactions()
  if (batchId !== undefined && detailVisible.value) {
    void loadBatchDetail(batchId)
  }
}

/** 身份或任一相关权限变化时，不允许列表、筛选、详情和幂等快照跨边界存活。 */
function clearTransactionPageState(resetQuery: boolean): void {
  listRequestVersion += 1
  listAbortController?.abort()
  catalogRequestVersion += 1
  catalogAbortController?.abort()
  detailRequestVersion += 1
  detailAbortController?.abort()
  reversalMutationVersion += 1

  transactions.value = []
  total.value = 0
  loading.value = false
  listFailure.value = null
  catalogAccounts.value = []
  catalogPostingTypes.value = []
  catalogBusinessSources.value = []
  catalogLoading.value = false
  catalogFailure.value = null
  detailVisible.value = false
  detailState.value = closeFundBatchDetail(detailState.value)
  reversalVisible.value = false
  reversalTarget.value = null
  reversalSubmitting.value = false
  reversalFailure.value = null
  reversalSubmission.value = clearFundIdempotentSubmission(
    reversalSubmission.value,
  )
  if (resetQuery) {
    page.value = 1
    pageSize.value = 20
    filters.value = {}
    sorting.value = []
  }
}

watch(
  [
    () => appAccountStore.authEpoch,
    canRead,
    canReverse,
    canManagePostingTypes,
    canManageBusinessSources,
  ],
  () => {
    clearTransactionPageState(true)
    if (canRead.value) {
      void loadTransactions()
      void loadFilterCatalog()
    }
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadTransactions()
    void loadFilterCatalog()
  }
})

onBeforeUnmount(() => clearTransactionPageState(false))
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      title="资金账户流水"
      description="按真实账户分录核对业务归属、收支方向、前后余额与批次冲账链。"
    >
      <FaButton v-if="canRead" variant="outline" class="min-h-11 sm:min-h-9" :disabled="loading" @click="loadTransactions">
        <FaIcon name="i-lucide:refresh-cw" />刷新流水
      </FaButton>
    </FaPageHeader>

    <FaPageMain v-if="!canRead">
      <FaEmpty icon="i-lucide:shield-alert" title="无权查看资金流水" description="当前身份缺少 fund-accounts:read 权限。" class="py-12" />
    </FaPageMain>

    <FaPageMain v-else class="min-w-0 overflow-x-hidden">
      <FaAlert v-if="currencyCatalog.errorMessage.value" icon="i-lucide:triangle-alert" title="人民币展示资料暂不可用" description="页面会保留服务端原始十进制字符串；冲账将在货币资料恢复后开放。" class="mb-4">
        <template #actions>
          <FaButton variant="outline" size="sm" class="min-h-11 sm:min-h-9" @click="currencyCatalog.reload">
            重试货币资料
          </FaButton>
        </template>
      </FaAlert>

      <FundTransactionFilters
        :model-value="filters"
        :account-options="accountOptions"
        :user-options="userOptions"
        :posting-type-options="postingTypeOptions"
        :business-source-options="businessSourceOptions"
        :catalog-loading="catalogLoading"
        :catalog-error="catalogErrorDisplay"
        :disabled="loading"
        @apply="applyFilters"
        @refresh-catalog="loadFilterCatalog"
      />

      <FundTransactionTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:sorting="sorting"
        :items="transactions"
        :currencies="fundCurrencies"
        :error="listErrorDisplay"
        :loading="loading"
        :total="total"
        @detail="openBatchDetail"
        @pagination-change="handlePagination"
        @retry="loadTransactions"
        @sorting-change="handleSorting"
      />
    </FaPageMain>

    <FundBatchDetailDrawer
      :model-value="detailVisible"
      :detail="detail"
      :loading="detailLoading"
      :error="detailFailure?.message"
      :request-id="detailFailure?.requestId"
      :can-reverse="detailCanReverse"
      :currencies="fundCurrencies"
      @update:model-value="updateDetailVisible"
      @retry="retryBatchDetail"
      @reverse="openReversal"
    />
    <FundReversalModal
      :model-value="reversalVisible"
      :detail="reversalTarget"
      :currencies="fundCurrencies"
      :submitting="reversalSubmitting"
      :unknown-result="reversalUnknownResult"
      :error="reversalFailure?.message"
      :request-id="reversalFailure?.requestId"
      @update:model-value="updateReversalVisible"
      @abandon="abandonReversal"
      @retry="retryReversal"
      @submit="submitReversal"
    />
  </div>
</template>
