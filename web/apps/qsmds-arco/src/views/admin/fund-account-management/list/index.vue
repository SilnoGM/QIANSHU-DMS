<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type {
  FundApiFailure,
  FundIdempotentSubmissionState,
} from '../shared/fund-request.logic'
import type {
  CreateFundAccountRequestDto,
  CreateFundManualAdjustmentRequestDto,
  FundAccountDto,
  FundAccountUserDto,
  UpdateFundShareRateRequestDto,
} from '@/api/generated/types.gen'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import fundAccountsApi from '@/api/modules/fund-accounts'
import AmountDisplay from '@/components/base/AmountDisplay/index.vue'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'
import { useCurrencyCatalog } from '@/currency-catalog/use-currency-catalog'

import {
  abandonFundIdempotentSubmission,
  beginFundIdempotentSubmission,
  canApplyFundResponse,
  clearFundIdempotentSubmission,
  completeFundIdempotentSubmission,
  createFundIdempotentSubmissionState,
  failFundIdempotentSubmission,
  getFundApiFailure,
  isFundAbortError,
  retryFundIdempotentSubmission,
} from '../shared/fund-request.logic'
import FundAccountCreateModal from './fund-account-create-modal.vue'
import {
  adaptFundAccountPage,
  buildFundAccountListQuery,
  findCompanyFundAccount,
  formatFundShareRate,
  getFundBalanceState,
  withFundAccountPrecision,
} from './fund-account-list.logic'
import FundConfigurationDrawer from './fund-configuration-drawer.vue'
import FundManualAdjustmentModal from './fund-manual-adjustment-modal.vue'
import FundShareRateModal from './fund-share-rate-modal.vue'

defineOptions({ name: 'QsFinanceFundAccountList' })

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const router = useRouter()
const currencyCatalog = useCurrencyCatalog()

const canRead = computed(() => auth('fund-accounts:read'))
const canCreate = computed(() => auth('fund-accounts:create'))
const canUpdateShareRate = computed(() => auth('fund-accounts:update-share-rate'))
const canManualAdjust = computed(() => auth('fund-accounts:manual-adjust'))
const canManagePostingTypes = computed(() => auth('fund-posting-types:manage'))
const canManageBusinessSources = computed(() => auth('fund-business-sources:manage'))
const canConfigure = computed(() => canRead.value && (
  canManagePostingTypes.value || canManageBusinessSources.value
))
const fundCurrencies = computed(() => withFundAccountPrecision(
  currencyCatalog.currencies.value,
))

const accounts = ref<FundAccountDto[]>([])
const companyAccount = ref<FundAccountDto | null>(null)
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const search = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const sorting = ref<TableSortingState>([])
const loading = ref(false)
const listFailure = ref<FundApiFailure | null>(null)

const createVisible = ref(false)
const createCandidates = ref<FundAccountUserDto[]>([])
const createCandidatesLoading = ref(false)
const createFailure = ref<FundApiFailure | null>(null)
const createSubmitting = ref(false)

const shareVisible = ref(false)
const shareTarget = ref<FundAccountDto | null>(null)
const shareFailure = ref<FundApiFailure | null>(null)
const shareSubmitting = ref(false)

const adjustmentVisible = ref(false)
const adjustmentTarget = ref<FundAccountDto | null>(null)
const adjustmentFailure = ref<FundApiFailure | null>(null)
const adjustmentSubmitting = ref(false)
const adjustmentSubmission = ref<FundIdempotentSubmissionState<CreateFundManualAdjustmentRequestDto>>(
  createFundIdempotentSubmissionState<CreateFundManualAdjustmentRequestDto>(),
)
const configurationVisible = ref(false)

let listRequestVersion = 0
let listAbortController: AbortController | null = null
let companyRequestVersion = 0
let companyAbortController: AbortController | null = null
let candidateRequestVersion = 0
let candidateAbortController: AbortController | null = null
let createMutationVersion = 0
let shareMutationVersion = 0
let adjustmentMutationVersion = 0
let queryRefreshPending = false

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'ownerType',
    label: '账户主体',
    options: [
      { label: '用户账户', value: 'USER' },
      { label: '公司账户', value: 'COMPANY' },
    ],
    placeholder: '选择账户主体',
  },
]

const columns: QsGenericTableColumn<FundAccountDto>[] = [
  {
    accessorFn: account => account.user?.displayName ?? '公司账户',
    fixed: 'left',
    id: 'subject',
    minWidth: 220,
    title: '账户主体',
  },
  {
    accessorKey: 'balance',
    align: 'right',
    id: 'balance',
    minWidth: 190,
    sortable: true,
    title: '实时余额',
  },
  {
    accessorKey: 'userShareRate',
    align: 'right',
    id: 'userShareRate',
    minWidth: 130,
    sortable: true,
    title: '用户分成',
  },
  {
    accessorKey: 'companyShareRate',
    align: 'right',
    id: 'companyShareRate',
    minWidth: 130,
    title: '公司分成',
  },
  {
    accessorKey: 'shareRateUpdatedAt',
    id: 'shareRateUpdatedAt',
    minWidth: 190,
    title: '比例更新时间',
  },
  {
    accessorKey: 'updatedAt',
    id: 'updatedAt',
    minWidth: 190,
    sortable: true,
    title: '更新时间',
  },
  {
    accessorKey: 'createdAt',
    id: 'createdAt',
    minWidth: 190,
    sortable: true,
    title: '创建时间',
  },
]

const listErrorDisplay = computed(() => {
  if (listFailure.value === null) {
    return undefined
  }
  return listFailure.value.requestId === undefined
    ? listFailure.value.message
    : `${listFailure.value.message}（requestId: ${listFailure.value.requestId}）`
})
const adjustmentUnknownResult = computed(() => (
  adjustmentSubmission.value.phase === 'unknown'
))

/** 余额的正值与负值使用语义色，零值不覆盖 AmountDisplay 的默认文字颜色。 */
function getFundBalanceTextClass(balance: string): string | undefined {
  const tone = getFundBalanceState(balance).tone
  if (tone === 'positive') {
    return 'text-green-600 dark:text-green-400'
  }
  if (tone === 'negative') {
    return 'text-destructive'
  }
  return undefined
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
  latestRequestVersion: number,
  authEpoch: number,
  authorized: boolean,
): boolean {
  return canApplyFundResponse({
    aborted: false,
    authEpoch,
    authorized,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion,
    requestVersion,
  })
}

async function loadAccounts(): Promise<void> {
  if (!canRead.value) {
    return
  }
  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const requestVersion = ++listRequestVersion
  const authEpoch = appAccountStore.authEpoch
  loading.value = true
  listFailure.value = null

  try {
    const response = await fundAccountsApi.accounts.list(
      buildFundAccountListQuery({
        filters: filters.value,
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        sorting: sorting.value,
      }),
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
    const nextPage = adaptFundAccountPage(response.data)
    accounts.value = nextPage.items
    page.value = nextPage.page
    pageSize.value = nextPage.pageSize
    total.value = nextPage.total
    companyAccount.value = findCompanyFundAccount(nextPage.items)
      ?? companyAccount.value
  }
  catch (error) {
    if (
      isFundAbortError(error)
      || !responseIsCurrent(
        requestVersion,
        listRequestVersion,
        authEpoch,
        controller,
        canRead.value,
      )
    ) {
      return
    }
    listFailure.value = getFundApiFailure(error)
  }
  finally {
    if (requestVersion === listRequestVersion) {
      loading.value = false
    }
  }
}

/** 公司账户可能不在当前分页或被主体筛选排除，因此用独立轻量查询保持预览完整。 */
async function loadCompanyAccount(): Promise<void> {
  if (!canRead.value) {
    return
  }
  companyAbortController?.abort()
  const controller = new AbortController()
  companyAbortController = controller
  const requestVersion = ++companyRequestVersion
  const authEpoch = appAccountStore.authEpoch

  try {
    const response = await fundAccountsApi.accounts.list({
      ownerType: 'COMPANY',
      page: 1,
      pageSize: 20,
    }, controller.signal)
    if (responseIsCurrent(
      requestVersion,
      companyRequestVersion,
      authEpoch,
      controller,
      canRead.value,
    )) {
      companyAccount.value = findCompanyFundAccount(response.data.items)
    }
  }
  catch (error) {
    if (
      !isFundAbortError(error)
      && responseIsCurrent(
        requestVersion,
        companyRequestVersion,
        authEpoch,
        controller,
        canRead.value,
      )
    ) {
      // 公司账户读取失败不应覆盖主表错误；调账 Modal 会明确降级为 USER_ONLY。
      companyAccount.value = null
    }
  }
}

async function loadCreateCandidates(): Promise<void> {
  if (!canCreate.value || !createVisible.value) {
    return
  }
  candidateAbortController?.abort()
  const controller = new AbortController()
  candidateAbortController = controller
  const requestVersion = ++candidateRequestVersion
  const authEpoch = appAccountStore.authEpoch
  createCandidatesLoading.value = true
  createFailure.value = null

  try {
    // 候选归属人（尚无账户的用户）由资金域端点一次算好，页面不再读取用户管理接口。
    const response = await fundAccountsApi.accounts.ownerCandidates(controller.signal)
    if (responseIsCurrent(
      requestVersion,
      candidateRequestVersion,
      authEpoch,
      controller,
      canCreate.value && createVisible.value,
    )) {
      createCandidates.value = [...response.data.items]
    }
  }
  catch (error) {
    if (
      !isFundAbortError(error)
      && responseIsCurrent(
        requestVersion,
        candidateRequestVersion,
        authEpoch,
        controller,
        canCreate.value && createVisible.value,
      )
    ) {
      createCandidates.value = []
      createFailure.value = getFundApiFailure(error)
    }
  }
  finally {
    if (requestVersion === candidateRequestVersion) {
      createCandidatesLoading.value = false
    }
  }
}

function scheduleQueryRefresh(): void {
  if (queryRefreshPending) {
    return
  }
  queryRefreshPending = true
  queueMicrotask(() => {
    queryRefreshPending = false
    void loadAccounts()
  })
}

function handleSearch(keyword: string): void {
  search.value = keyword
  page.value = 1
  scheduleQueryRefresh()
}

function handleFilterChange(nextFilters: QsGenericTableFilterValues): void {
  filters.value = nextFilters.ownerType === 'USER' || nextFilters.ownerType === 'COMPANY'
    ? { ownerType: nextFilters.ownerType }
    : {}
  page.value = 1
  scheduleQueryRefresh()
}

function handleSortingChange(nextSorting: TableSortingState): void {
  sorting.value = nextSorting.slice(0, 1)
  page.value = 1
  scheduleQueryRefresh()
}

function handlePaginationChange(input: { page: number, pageSize: number }): void {
  page.value = input.page
  pageSize.value = input.pageSize
  void loadAccounts()
}

function openCreateModal(): void {
  if (!canCreate.value) {
    return
  }
  createCandidates.value = []
  createFailure.value = null
  createVisible.value = true
  void loadCreateCandidates()
}

async function createAccount(payload: CreateFundAccountRequestDto): Promise<void> {
  if (!canCreate.value || createSubmitting.value) {
    return
  }
  const requestVersion = ++createMutationVersion
  const authEpoch = appAccountStore.authEpoch
  createSubmitting.value = true
  createFailure.value = null
  try {
    await fundAccountsApi.accounts.create(payload)
    if (!mutationResponseIsCurrent(
      requestVersion,
      createMutationVersion,
      authEpoch,
      canCreate.value && createVisible.value,
    )) {
      return
    }
    createSubmitting.value = false
    await nextTick()
    createVisible.value = false
    useFaToast().success('资金账户已创建')
    void loadAccounts()
  }
  catch (error) {
    if (!mutationResponseIsCurrent(
      requestVersion,
      createMutationVersion,
      authEpoch,
      canCreate.value && createVisible.value,
    )) {
      return
    }
    createFailure.value = getFundApiFailure(error)
    if (createFailure.value.unknownResult) {
      useFaToast().warning('开户结果未知，已刷新账户与候选用户，请核对后再操作。')
      void loadAccounts()
      void loadCreateCandidates()
    }
  }
  finally {
    if (requestVersion === createMutationVersion) {
      createSubmitting.value = false
    }
  }
}

function openShareModal(account: FundAccountDto): void {
  if (!canUpdateShareRate.value || account.ownerType !== 'USER') {
    return
  }
  shareTarget.value = account
  shareFailure.value = null
  shareVisible.value = true
}

async function updateShareRate(payload: UpdateFundShareRateRequestDto): Promise<void> {
  const target = shareTarget.value
  if (!canUpdateShareRate.value || target?.ownerType !== 'USER' || shareSubmitting.value) {
    return
  }
  const requestVersion = ++shareMutationVersion
  const authEpoch = appAccountStore.authEpoch
  shareSubmitting.value = true
  shareFailure.value = null
  try {
    await fundAccountsApi.accounts.updateShareRate(target.id, payload)
    if (!mutationResponseIsCurrent(
      requestVersion,
      shareMutationVersion,
      authEpoch,
      canUpdateShareRate.value && shareTarget.value?.id === target.id,
    )) {
      return
    }
    shareSubmitting.value = false
    await nextTick()
    shareVisible.value = false
    shareTarget.value = null
    useFaToast().success('未来分成比例已更新')
    void loadAccounts()
  }
  catch (error) {
    if (!mutationResponseIsCurrent(
      requestVersion,
      shareMutationVersion,
      authEpoch,
      canUpdateShareRate.value && shareTarget.value?.id === target.id,
    )) {
      return
    }
    shareFailure.value = getFundApiFailure(error)
    if (shareFailure.value.unknownResult) {
      shareSubmitting.value = false
      await nextTick()
      shareVisible.value = false
      shareTarget.value = null
      useFaToast().warning('比例修改结果未知，已刷新账户，请以最新比例为准。')
      void loadAccounts()
    }
  }
  finally {
    if (requestVersion === shareMutationVersion) {
      shareSubmitting.value = false
    }
  }
}

function openAdjustmentModal(account: FundAccountDto): void {
  if (!canManualAdjust.value || account.ownerType !== 'USER') {
    return
  }
  adjustmentTarget.value = account
  adjustmentFailure.value = null
  adjustmentSubmission.value = clearFundIdempotentSubmission(adjustmentSubmission.value)
  adjustmentVisible.value = true
  if (companyAccount.value === null) {
    void loadCompanyAccount()
  }
}

async function executeManualAdjustment(
  requestVersion: number,
  authEpoch: number,
  accountId: string,
): Promise<void> {
  const submission = adjustmentSubmission.value.submission
  if (submission === null) {
    return
  }
  adjustmentSubmitting.value = true
  adjustmentFailure.value = null
  try {
    await fundAccountsApi.accounts.manualAdjust(
      accountId,
      submission.payload,
      submission.idempotencyKey,
    )
    if (!mutationResponseIsCurrent(
      requestVersion,
      adjustmentMutationVersion,
      authEpoch,
      canManualAdjust.value && adjustmentTarget.value?.id === accountId,
    )) {
      return
    }
    adjustmentSubmission.value = completeFundIdempotentSubmission(adjustmentSubmission.value)
    adjustmentSubmitting.value = false
    await nextTick()
    adjustmentVisible.value = false
    adjustmentTarget.value = null
    useFaToast().success('手动调账已入账')
    void loadAccounts()
    void loadCompanyAccount()
  }
  catch (error) {
    if (!mutationResponseIsCurrent(
      requestVersion,
      adjustmentMutationVersion,
      authEpoch,
      canManualAdjust.value && adjustmentTarget.value?.id === accountId,
    )) {
      return
    }
    const failure = getFundApiFailure(error)
    adjustmentFailure.value = failure
    adjustmentSubmission.value = failFundIdempotentSubmission(
      adjustmentSubmission.value,
      failure,
    )
  }
  finally {
    if (requestVersion === adjustmentMutationVersion) {
      adjustmentSubmitting.value = false
    }
  }
}

function submitManualAdjustment(payload: CreateFundManualAdjustmentRequestDto): void {
  const target = adjustmentTarget.value
  if (
    !canManualAdjust.value
    || target?.ownerType !== 'USER'
    || adjustmentSubmitting.value
    || adjustmentSubmission.value.phase !== 'idle'
  ) {
    return
  }
  adjustmentSubmission.value = beginFundIdempotentSubmission(
    adjustmentSubmission.value,
    () => payload,
    () => crypto.randomUUID(),
  )
  const requestVersion = ++adjustmentMutationVersion
  void executeManualAdjustment(requestVersion, appAccountStore.authEpoch, target.id)
}

function retryManualAdjustment(): void {
  const target = adjustmentTarget.value
  if (
    !canManualAdjust.value
    || target?.ownerType !== 'USER'
    || adjustmentSubmitting.value
    || adjustmentSubmission.value.phase !== 'unknown'
  ) {
    return
  }
  adjustmentSubmission.value = retryFundIdempotentSubmission(adjustmentSubmission.value)
  const requestVersion = ++adjustmentMutationVersion
  void executeManualAdjustment(requestVersion, appAccountStore.authEpoch, target.id)
}

function abandonManualAdjustment(): void {
  if (adjustmentSubmission.value.phase !== 'unknown') {
    return
  }
  adjustmentSubmission.value = abandonFundIdempotentSubmission(adjustmentSubmission.value)
  adjustmentFailure.value = null
  adjustmentVisible.value = false
  adjustmentTarget.value = null
  void loadAccounts()
  void loadCompanyAccount()
}

function navigateToTransactions(account: FundAccountDto): void {
  void router.push({
    name: 'qsFinanceFundAccountTransactions',
    query: { accountId: account.id },
  })
}

function openConfigurationDrawer(): void {
  if (canConfigure.value) {
    configurationVisible.value = true
  }
}

/** 身份或权限边界变化时，不允许列表、候选集、草稿或幂等快照跨边界存活。 */
function clearFundPageState(): void {
  listRequestVersion += 1
  listAbortController?.abort()
  companyRequestVersion += 1
  companyAbortController?.abort()
  candidateRequestVersion += 1
  candidateAbortController?.abort()
  createMutationVersion += 1
  shareMutationVersion += 1
  adjustmentMutationVersion += 1

  accounts.value = []
  companyAccount.value = null
  total.value = 0
  loading.value = false
  listFailure.value = null
  createVisible.value = false
  createCandidates.value = []
  createCandidatesLoading.value = false
  createFailure.value = null
  createSubmitting.value = false
  shareVisible.value = false
  shareTarget.value = null
  shareFailure.value = null
  shareSubmitting.value = false
  adjustmentVisible.value = false
  adjustmentTarget.value = null
  adjustmentFailure.value = null
  adjustmentSubmitting.value = false
  adjustmentSubmission.value = clearFundIdempotentSubmission(adjustmentSubmission.value)
  configurationVisible.value = false
}

watch(createVisible, (visible) => {
  if (visible) {
    return
  }
  // 用户主动关闭开户窗口时立即终止可能跨多页的候选集合请求。
  candidateRequestVersion += 1
  candidateAbortController?.abort()
  createCandidatesLoading.value = false
})

watch(
  [
    () => appAccountStore.authEpoch,
    canRead,
    canCreate,
    canUpdateShareRate,
    canManualAdjust,
    canManagePostingTypes,
    canManageBusinessSources,
  ],
  ([nextAuthEpoch, nextCanRead], [previousAuthEpoch]) => {
    const identityChanged = nextAuthEpoch !== previousAuthEpoch
    clearFundPageState()
    if (identityChanged) {
      page.value = 1
      search.value = ''
      filters.value = {}
      sorting.value = []
    }
    if (nextCanRead) {
      void loadAccounts()
      void loadCompanyAccount()
    }
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadAccounts()
    void loadCompanyAccount()
  }
})

onBeforeUnmount(() => {
  clearFundPageState()
})
</script>

<template>
  <div class="min-w-0">
    <FaPageHeader
      title="资金账户列表"
      description="核对用户与公司人民币账户的实时余额、分成比例和最近更新时间。"
    >
      <div data-testid="fund-account-header-actions" class="flex flex-wrap gap-2 items-center">
        <FaButton
          v-if="canConfigure"
          variant="outline"
          class="min-h-11 sm:min-h-9"
          @click="openConfigurationDrawer"
        >
          <FaIcon name="i-lucide:sliders-horizontal" />业务配置
        </FaButton>
        <FaButton v-if="canCreate" class="min-h-11 sm:min-h-9" @click="openCreateModal">
          <FaIcon name="i-lucide:plus" />创建资金账户
        </FaButton>
      </div>
    </FaPageHeader>

    <FaPageMain v-if="!canRead">
      <FaEmpty
        icon="i-lucide:shield-alert"
        title="无权查看资金账户"
        description="当前身份缺少 fund-accounts:read 权限。"
        class="py-12"
      />
    </FaPageMain>

    <FaPageMain v-else class="min-w-0 overflow-x-hidden">
      <FaAlert
        v-if="currencyCatalog.errorMessage.value"
        icon="i-lucide:triangle-alert"
        title="人民币展示资料暂不可用"
        description="列表会保留服务端原始金额；手动调账将在货币资料恢复后开放。"
        class="mb-4"
      >
        <template #actions>
          <FaButton variant="outline" size="sm" class="min-h-11 sm:min-h-9" @click="currencyCatalog.reload">
            重试货币资料
          </FaButton>
        </template>
      </FaAlert>

      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="search"
        v-model:filters="filters"
        v-model:sorting="sorting"
        data-testid="fund-account-list-table"
        row-key="id"
        :action-column="{ fixed: 'right', minWidth: 260, width: 260 }"
        :addable="false"
        :columns="columns"
        :data="accounts"
        empty-title="暂无资金账户"
        empty-description="当前查询条件下没有可展示的资金账户。"
        :error="listErrorDisplay"
        :filter-definitions="filterDefinitions"
        :loading="loading"
        :page-size-options="[20, 50, 100]"
        search-placeholder="搜索用户名或显示名称"
        :show-column-settings="true"
        :total="total"
        table-class="min-w-[1260px]"
        @filter-change="handleFilterChange"
        @pagination-change="handlePaginationChange"
        @retry="loadAccounts"
        @search="handleSearch"
        @sorting-change="handleSortingChange"
      >
        <template #cell-subject="{ row }">
          <div v-if="row.original.ownerType === 'COMPANY'" class="flex gap-2 items-center">
            <span class="qs-type-data-emphasis">公司资金账户</span>
            <FaTag variant="outline" class="text-primary qs-type-status-tag border-primary/30 bg-primary/8">
              公司账户
            </FaTag>
          </div>
          <div v-else class="min-w-0">
            <div class="qs-type-data-emphasis break-words">
              {{ row.original.user?.displayName ?? '未知用户' }}
            </div>
            <div class="qs-type-meta font-mono mt-1 break-all">
              {{ row.original.user?.username ?? '—' }}
              <span v-if="row.original.user?.status === 'DISABLED'"> · 已禁用</span>
            </div>
          </div>
        </template>

        <template #cell-balance="{ row }">
          <div class="flex items-center justify-end">
            <AmountDisplay
              :value="row.original.balance"
              :currency="row.original.currency"
              :currencies="fundCurrencies"
              class="!font-semibold"
              :class="getFundBalanceTextClass(row.original.balance)"
            />
          </div>
        </template>

        <template #cell-userShareRate="{ row }">
          <span class="qs-type-data">{{ formatFundShareRate(row.original.userShareRate) }}</span>
        </template>
        <template #cell-companyShareRate="{ row }">
          <span class="qs-type-data">{{ formatFundShareRate(row.original.companyShareRate) }}</span>
        </template>
        <template #cell-shareRateUpdatedAt="{ row }">
          <DateTimeDisplay :value="row.original.shareRateUpdatedAt" />
        </template>
        <template #cell-updatedAt="{ row }">
          <DateTimeDisplay :value="row.original.updatedAt" />
        </template>
        <template #cell-createdAt="{ row }">
          <DateTimeDisplay :value="row.original.createdAt" />
        </template>

        <template #actions="{ row, rowNumber }">
          <FaButton
            v-if="canUpdateShareRate && row.ownerType === 'USER'"
            variant="ghost"
            size="sm"
            class="shrink-0 min-h-11 whitespace-nowrap sm:min-h-9"
            :aria-label="`修改第 ${rowNumber} 行 ${row.user?.username ?? ''} 的分成比例`"
            @click="openShareModal(row)"
          >
            <FaIcon name="i-lucide:percent" />比例
          </FaButton>
          <FaButton
            v-if="canManualAdjust && row.ownerType === 'USER'"
            variant="ghost"
            size="sm"
            class="shrink-0 min-h-11 whitespace-nowrap sm:min-h-9"
            :aria-label="`调整第 ${rowNumber} 行 ${row.user?.username ?? ''} 的资金余额`"
            @click="openAdjustmentModal(row)"
          >
            <FaIcon name="i-lucide:circle-dollar-sign" />调账
          </FaButton>
          <FaButton
            variant="ghost"
            size="sm"
            class="shrink-0 min-h-11 whitespace-nowrap sm:min-h-9"
            :aria-label="`查看第 ${rowNumber} 行账户流水`"
            @click="navigateToTransactions(row)"
          >
            <FaIcon name="i-lucide:scroll-text" />流水
          </FaButton>
        </template>

        <template #mobile-row="{ row, rowNumber }">
          <article data-testid="fund-account-card" class="gap-4 grid min-w-0">
            <header class="pb-3 border-b border-border flex gap-3 min-w-0 items-start justify-between">
              <div class="min-w-0">
                <div class="flex flex-wrap gap-2 items-center">
                  <span class="qs-type-data-emphasis break-words">
                    {{ row.ownerType === 'COMPANY' ? '公司资金账户' : (row.user?.displayName ?? '未知用户') }}
                  </span>
                  <FaTag
                    v-if="row.ownerType === 'COMPANY'"
                    variant="outline"
                    class="text-primary qs-type-status-tag border-primary/30 bg-primary/8"
                  >
                    公司账户
                  </FaTag>
                </div>
                <div v-if="row.ownerType === 'USER'" class="qs-type-meta font-mono mt-1 break-all">
                  {{ row.user?.username ?? '—' }}<span v-if="row.user?.status === 'DISABLED'"> · 已禁用</span>
                </div>
              </div>
              <span class="qs-type-meta shrink-0 tabular-nums">#{{ rowNumber }}</span>
            </header>

            <div>
              <div class="qs-type-compact-label mb-1">
                实时余额
              </div>
              <div class="flex items-center">
                <AmountDisplay
                  :value="row.balance"
                  :currency="row.currency"
                  :currencies="fundCurrencies"
                  class="!font-semibold"
                  :class="getFundBalanceTextClass(row.balance)"
                />
              </div>
            </div>

            <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
              <div>
                <dt class="qs-type-compact-label mb-1">
                  用户分成
                </dt><dd class="qs-type-data m-0">
                  {{ formatFundShareRate(row.userShareRate) }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  公司分成
                </dt><dd class="qs-type-data m-0">
                  {{ formatFundShareRate(row.companyShareRate) }}
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  比例更新时间
                </dt><dd class="m-0">
                  <DateTimeDisplay :value="row.shareRateUpdatedAt" />
                </dd>
              </div>
              <div>
                <dt class="qs-type-compact-label mb-1">
                  更新时间
                </dt><dd class="m-0">
                  <DateTimeDisplay :value="row.updatedAt" />
                </dd>
              </div>
            </dl>
          </article>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <FundAccountCreateModal
      v-model="createVisible"
      :users="createCandidates"
      :loading-users="createCandidatesLoading"
      :submitting="createSubmitting"
      :error="createFailure?.message"
      :request-id="createFailure?.requestId"
      @retry="loadCreateCandidates"
      @submit="createAccount"
    />
    <FundShareRateModal
      v-model="shareVisible"
      :account="shareTarget"
      :submitting="shareSubmitting"
      :error="shareFailure?.message"
      :request-id="shareFailure?.requestId"
      @submit="updateShareRate"
    />
    <FundManualAdjustmentModal
      v-model="adjustmentVisible"
      :account="adjustmentTarget"
      :company-account="companyAccount"
      :currencies="fundCurrencies"
      :submitting="adjustmentSubmitting"
      :unknown-result="adjustmentUnknownResult"
      :error="adjustmentFailure?.message"
      :request-id="adjustmentFailure?.requestId"
      @abandon="abandonManualAdjustment"
      @retry="retryManualAdjustment"
      @submit="submitManualAdjustment"
    />
    <FundConfigurationDrawer
      v-model="configurationVisible"
      :can-manage-posting-types="canManagePostingTypes"
      :can-manage-business-sources="canManageBusinessSources"
    />
  </div>
</template>
