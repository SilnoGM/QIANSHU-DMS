<script setup lang="ts">
import type { CurrencyFormMode } from './currency-management.logic'
import type {
  CreateCurrencyRequestDto,
  CurrencyDto,
  UpdateCurrencyRequestDto,
} from '@/api/generated/types.gen'

import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'
import currenciesApi from '@/api/modules/currencies'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import { useQsToast } from '@/components/base/QsToast/useQsToast'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'

import { invalidateCurrencyCatalogCache } from '@/currency-catalog/default-provider'
import { hasVisibleTableColumn } from '../../shared/table-query'
import CurrencyFormModal from './currency-form-modal.vue'
import {
  buildCurrencyListQuery,

  getCurrencyApiFailure,
  getCurrencyMutationFailure,
  isCurrencyAbortError,
  resolveCurrencyActions,
} from './currency-management.logic'
import CurrencyStatusChangeModal from './currency-status-change-modal.vue'

defineOptions({ name: 'SystemBasicDataCurrencies' })

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()

const canRead = computed(() => auth('currencies:read'))
const canCreate = computed(() => auth('currencies:create'))
const canUpdate = computed(() => auth('currencies:update'))
const canEnable = computed(() => auth('currencies:enable'))
const canDisable = computed(() => auth('currencies:disable'))

const rows = ref<CurrencyDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const listLoading = ref(false)
const listError = ref('')
const listRequestId = ref<string>()
let listRequestVersion = 0
let listAbortController: AbortController | null = null
let listRefreshQueued = false

const formVisible = ref(false)
const formMode = ref<CurrencyFormMode>('create')
const formTarget = ref<CurrencyDto | null>(null)
const formSubmitting = ref(false)
const formError = ref('')
const formRequestId = ref<string>()
const formFieldErrors = ref<Readonly<Record<string, string>>>({})

const statusVisible = ref(false)
const statusAction = ref<'disable' | 'enable'>('enable')
const statusTarget = ref<CurrencyDto | null>(null)
const statusSubmitting = ref(false)
const statusError = ref('')
const statusErrorCode = ref<string>()
const statusRequestId = ref<string>()

const listErrorDisplay = computed(() => {
  if (listError.value === '') {
    return undefined
  }
  return listRequestId.value === undefined
    ? listError.value
    : `${listError.value}（requestId: ${listRequestId.value}）`
})

const columns: QsGenericTableColumn<CurrencyDto>[] = [
  {
    accessorKey: 'name',
    id: 'currency',
    minWidth: 210,
    title: '货币',
  },
  {
    accessorKey: 'symbol',
    id: 'symbol',
    title: '符号',
    width: 100,
  },
  {
    accessorKey: 'minorUnit',
    align: 'right',
    id: 'minorUnit',
    title: '金额小数位',
    width: 130,
  },
  {
    accessorKey: 'enabled',
    id: 'enabled',
    title: '状态',
    width: 110,
  },
  {
    accessorKey: 'exchangeRateConfigured',
    id: 'rate',
    title: '当前汇率',
    width: 130,
  },
  {
    accessorKey: 'sortOrder',
    align: 'right',
    id: 'sortOrder',
    title: '排序',
    width: 90,
  },
  {
    accessorKey: 'updatedAt',
    id: 'updatedAt',
    minWidth: 180,
    title: '更新时间',
  },
]

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'status',
    label: '使用状态',
    options: [
      { label: '启用', value: 'ENABLED' },
      { label: '停用', value: 'DISABLED' },
    ],
  },
]

function listResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return !controller.signal.aborted
    && canRead.value
    && authEpoch === appAccountStore.authEpoch
    && requestVersion === listRequestVersion
}

async function loadCurrencies(): Promise<void> {
  if (!canRead.value) {
    return
  }

  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const requestVersion = ++listRequestVersion
  const authEpoch = appAccountStore.authEpoch
  listLoading.value = true
  listError.value = ''
  listRequestId.value = undefined

  try {
    const response = await currenciesApi.currencies.list(
      buildCurrencyListQuery({
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        status: filters.value.status,
      }),
      controller.signal,
    )
    if (!listResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }
    rows.value = response.data.items
    total.value = response.data.total
  }
  catch (error) {
    if (
      isCurrencyAbortError(error)
      || !listResponseIsCurrent(requestVersion, authEpoch, controller)
    ) {
      return
    }
    const failure = getCurrencyApiFailure(error)
    listError.value = failure.message
    listRequestId.value = failure.requestId
  }
  finally {
    if (listResponseIsCurrent(requestVersion, authEpoch, controller)) {
      listLoading.value = false
    }
  }
}

/**
 * QsGenericTable 清除查询条件时可能在同一轮发出多个查询事件；合并到一个微任务，
 * 保证页面只产生一条 Server 请求且最终读取已经更新的 v-model。
 */
function scheduleListRefresh(): void {
  page.value = 1
  if (listRefreshQueued) {
    return
  }
  listRefreshQueued = true
  queueMicrotask(() => {
    listRefreshQueued = false
    void loadCurrencies()
  })
}

function handleFilterChange(nextFilters: QsGenericTableFilterValues): void {
  filters.value = { ...nextFilters }
  scheduleListRefresh()
}

function handlePaginationChange(
  pagination: { page: number, pageSize: number },
): void {
  page.value = pagination.page
  pageSize.value = pagination.pageSize
  void loadCurrencies()
}

function currencyActions(currency: CurrencyDto) {
  return resolveCurrencyActions(currency, {
    canDisable: canDisable.value,
    canEnable: canEnable.value,
    canUpdate: canUpdate.value,
  })
}

function resetFormFailure(): void {
  formError.value = ''
  formRequestId.value = undefined
  formFieldErrors.value = {}
}

function resetStatusFailure(): void {
  statusError.value = ''
  statusErrorCode.value = undefined
  statusRequestId.value = undefined
}

function openCreate(): void {
  if (!canRead.value || !canCreate.value) {
    return
  }
  formMode.value = 'create'
  formTarget.value = null
  resetFormFailure()
  formVisible.value = true
}

function openEdit(currency: CurrencyDto): void {
  if (!canRead.value || !currencyActions(currency).canEdit) {
    return
  }
  formMode.value = 'edit'
  formTarget.value = currency
  resetFormFailure()
  formVisible.value = true
}

function openStatusChange(
  currency: CurrencyDto,
  action: 'disable' | 'enable',
): void {
  const actions = currencyActions(currency)
  if (
    !canRead.value
    || currency.isBase
    || (action === 'enable' && !actions.canEnable)
    || (action === 'disable' && !actions.canDisable)
  ) {
    return
  }
  statusAction.value = action
  statusTarget.value = currency
  resetStatusFailure()
  statusVisible.value = true
}

function clearMutationContexts(): void {
  formVisible.value = false
  formTarget.value = null
  formSubmitting.value = false
  statusVisible.value = false
  statusTarget.value = null
  statusSubmitting.value = false
  resetFormFailure()
  resetStatusFailure()
}

async function finishSuccessfulMutation(message: string): Promise<void> {
  invalidateCurrencyCatalogCache({ broadcast: true })
  toast.success(message)
  await loadCurrencies()
}

async function handleFormSubmit(payload:
  | { mode: 'create', data: CreateCurrencyRequestDto }
  | { mode: 'edit', currencyId: string, data: UpdateCurrencyRequestDto }): Promise<void> {
  if (
    formSubmitting.value
    || !canRead.value
    || (payload.mode === 'create' ? !canCreate.value : !canUpdate.value)
  ) {
    return
  }

  formSubmitting.value = true
  resetFormFailure()
  try {
    if (payload.mode === 'create') {
      await currenciesApi.currencies.create(payload.data)
      page.value = 1
    }
    else {
      await currenciesApi.currencies.update(payload.currencyId, payload.data)
    }
    formSubmitting.value = false
    await nextTick()
    formVisible.value = false
    formTarget.value = null
    await finishSuccessfulMutation(
      payload.mode === 'create' ? '货币创建成功' : '货币资料已更新',
    )
  }
  catch (error) {
    const failure = getCurrencyMutationFailure(error)
    formError.value = failure.unknownResult
      ? '操作结果未知，系统已重新查询；请核查当前货币状态后再继续。'
      : failure.message
    formRequestId.value = failure.requestId
    formFieldErrors.value = failure.fieldErrors
    if (failure.unknownResult || failure.code === 'CURRENCY_STATE_CHANGED') {
      await loadCurrencies()
      if (payload.mode === 'create') {
        // 创建结果未知时不允许原表单直接重放，回到列表核对 code 是否已存在。
        formVisible.value = false
        formTarget.value = null
      }
      else {
        const refreshedCurrency = rows.value.find(
          currency => currency.id === payload.currencyId,
        )
        if (refreshedCurrency === undefined) {
          formVisible.value = false
          formTarget.value = null
        }
        else {
          formTarget.value = refreshedCurrency
        }
      }
    }
  }
  finally {
    formSubmitting.value = false
  }
}

async function handleStatusSubmit(): Promise<void> {
  const target = statusTarget.value
  if (
    statusSubmitting.value
    || target === null
    || target.isBase
    || !canRead.value
    || (statusAction.value === 'enable' ? !canEnable.value : !canDisable.value)
  ) {
    return
  }

  statusSubmitting.value = true
  resetStatusFailure()
  try {
    const data = { expectedVersion: target.version }
    if (statusAction.value === 'enable') {
      await currenciesApi.currencies.enable(target.id, data)
    }
    else {
      await currenciesApi.currencies.disable(target.id, data)
    }
    const successMessage = statusAction.value === 'enable'
      ? '货币已启用'
      : '货币已停用'
    statusSubmitting.value = false
    await nextTick()
    statusVisible.value = false
    statusTarget.value = null
    await finishSuccessfulMutation(successMessage)
  }
  catch (error) {
    const failure = getCurrencyMutationFailure(error)
    statusErrorCode.value = failure.code
    statusRequestId.value = failure.requestId
    statusError.value = failure.unknownResult
      ? '操作结果未知，系统已重新查询；请核查当前货币状态后再继续。'
      : failure.code === 'CURRENCY_EXCHANGE_RATE_REQUIRED'
        ? '请先配置当前汇率再启用该货币'
        : failure.message
    if (failure.unknownResult || failure.code === 'CURRENCY_STATE_CHANGED') {
      await loadCurrencies()
      const refreshedCurrency = rows.value.find(
        currency => currency.id === target.id,
      )
      if (refreshedCurrency === undefined) {
        statusVisible.value = false
        statusTarget.value = null
      }
      else {
        statusTarget.value = refreshedCurrency
      }
    }
  }
  finally {
    statusSubmitting.value = false
  }
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  ([nextAuthEpoch, nextCanRead], [previousAuthEpoch]) => {
    const identityChanged = nextAuthEpoch !== previousAuthEpoch
    listAbortController?.abort()
    rows.value = []
    total.value = 0
    listError.value = ''
    listRequestId.value = undefined
    listLoading.value = false
    if (identityChanged || !nextCanRead) {
      clearMutationContexts()
    }
    if (nextCanRead) {
      page.value = 1
      void loadCurrencies()
    }
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadCurrencies()
  }
})

onBeforeUnmount(() => {
  listAbortController?.abort()
})
</script>

<template>
  <div class="currency-management-page">
    <FaPageHeader
      title="货币管理"
      description="维护系统可引用的货币资料。新增货币默认停用，非人民币货币必须配置当前汇率后才能启用。"
    >
      <div class="flex flex-wrap gap-2">
        <FaButton
          v-if="canRead"
          variant="outline"
          :loading="listLoading"
          @click="loadCurrencies"
        >
          <FaIcon v-if="!listLoading" name="i-lucide:refresh-cw" />
          刷新
        </FaButton>
        <FaButton v-if="canRead && canCreate" @click="openCreate">
          <FaIcon name="i-lucide:plus" />
          新增货币
        </FaButton>
      </div>
    </FaPageHeader>

    <FaPageMain>
      <FaAlert
        v-if="!canRead"
        icon="i-lucide:shield-alert"
        title="暂无查看权限"
        description="当前账号缺少 currencies:read，无法查看货币资料。"
      />

      <QsGenericTable
        v-else
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="search"
        v-model:filters="filters"
        data-testid="currency-table"
        row-key="id"
        :action-column="{ width: 200 }"
        :addable="false"
        :columns="columns"
        :data="rows"
        empty-title="暂无货币"
        empty-description="当前查询条件下没有可展示的货币。"
        :error="listErrorDisplay"
        :filter-definitions="filterDefinitions"
        :loading="listLoading"
        :page-size-options="[20, 50, 100]"
        search-placeholder="搜索货币名称、英文名或三位代码"
        :total="total"
        table-class="min-w-[1120px]"
        @filter-change="handleFilterChange"
        @pagination-change="handlePaginationChange"
        @retry="loadCurrencies"
        @search="scheduleListRefresh"
      >
        <template #cell-currency="{ row }">
          <div class="gap-0.5 grid min-w-0">
            <div class="flex flex-wrap gap-2 items-center">
              <strong class="qs-type-body-medium break-words">
                {{ row.original.name }}
              </strong>
              <FaTag v-if="row.original.isBase" variant="secondary" class="qs-type-status-tag">
                基准币
              </FaTag>
            </div>
            <div class="flex flex-wrap gap-x-2 gap-y-0.5 items-center">
              <code class="qs-type-data-emphasis">{{ row.original.code }}</code>
              <span class="qs-type-meta break-words">
                {{ row.original.englishName || '暂无英文名' }}
              </span>
            </div>
          </div>
        </template>

        <template #cell-symbol="{ row }">
          <span class="qs-type-data-emphasis">{{ row.original.symbol || '—' }}</span>
        </template>

        <template #cell-minorUnit="{ row }">
          <span class="qs-type-data tabular-nums">{{ row.original.minorUnit }} 位</span>
        </template>

        <template #cell-enabled="{ row }">
          <FaTag
            variant="outline"
            class="qs-type-status-tag"
            :class="row.original.enabled
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-border bg-muted text-muted-foreground'"
          >
            {{ row.original.enabled ? '启用' : '停用' }}
          </FaTag>
        </template>

        <template #cell-rate="{ row }">
          <span v-if="row.original.isBase" class="qs-type-meta">固定 1:1</span>
          <FaTag
            v-else
            variant="outline"
            class="qs-type-status-tag"
            :class="row.original.exchangeRateConfigured
              ? 'border-primary/30 bg-primary/10 text-primary'
              : 'border-destructive/30 bg-destructive/5 text-destructive'"
          >
            {{ row.original.exchangeRateConfigured ? '已配置' : '未配置' }}
          </FaTag>
        </template>

        <template #cell-sortOrder="{ row }">
          <span class="qs-type-data tabular-nums">{{ row.original.sortOrder }}</span>
        </template>

        <template #cell-updatedAt="{ row }">
          <DateTimeDisplay :value="row.original.updatedAt" />
        </template>

        <template #actions="{ row: currency }">
          <div
            v-if="currencyActions(currency).hasAny"
            class="flex flex-wrap gap-1 items-center"
          >
            <FaButton
              v-if="currencyActions(currency).canEdit"
              variant="ghost"
              size="sm"
              class="min-h-11 w-full md:min-h-8 md:w-auto"
              :aria-label="`编辑货币 ${currency.code}`"
              @click="openEdit(currency)"
            >
              编辑
            </FaButton>
            <FaButton
              v-if="currencyActions(currency).canEnable"
              variant="ghost"
              size="sm"
              class="min-h-11 w-full md:min-h-8 md:w-auto"
              :aria-label="`启用货币 ${currency.code}`"
              @click="openStatusChange(currency, 'enable')"
            >
              启用
            </FaButton>
            <FaButton
              v-if="currencyActions(currency).canDisable"
              variant="ghost"
              size="sm"
              class="text-destructive min-h-11 w-full md:min-h-8 md:w-auto"
              :aria-label="`停用货币 ${currency.code}`"
              @click="openStatusChange(currency, 'disable')"
            >
              停用
            </FaButton>
          </div>
          <span v-else class="qs-type-meta">
            {{ currency.isBase ? '基准币只读' : '仅查看' }}
          </span>
        </template>

        <!-- 移动卡片只组合业务字段，列显隐和操作区继续由 QsGenericTable 统一管理。 -->
        <template #mobile-row="{ columns: visibleColumns, row: currency, rowNumber }">
          <div data-testid="currency-card" class="gap-4 grid min-w-0">
            <div class="flex gap-3 min-w-0 items-start justify-between">
              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'currency')"
                class="min-w-0"
              >
                <div class="flex flex-wrap gap-2 items-center">
                  <strong class="qs-type-body-medium break-words">{{ currency.name }}</strong>
                  <FaTag v-if="currency.isBase" variant="secondary" class="qs-type-status-tag">
                    基准币
                  </FaTag>
                </div>
                <code class="qs-type-data-emphasis mt-1 block">{{ currency.code }}</code>
              </div>
              <span class="qs-type-meta shrink-0 tabular-nums">#{{ rowNumber }}</span>
            </div>

            <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
              <div v-if="hasVisibleTableColumn(visibleColumns, 'symbol')">
                <dt class="qs-type-compact-label mb-1">
                  符号
                </dt>
                <dd class="qs-type-data-emphasis m-0">
                  {{ currency.symbol || '—' }}
                </dd>
              </div>
              <div v-if="hasVisibleTableColumn(visibleColumns, 'minorUnit')">
                <dt class="qs-type-compact-label mb-1">
                  金额小数位
                </dt>
                <dd class="qs-type-data m-0 tabular-nums">
                  {{ currency.minorUnit }} 位
                </dd>
              </div>
              <div v-if="hasVisibleTableColumn(visibleColumns, 'enabled')">
                <dt class="qs-type-compact-label mb-1">
                  状态
                </dt>
                <dd class="qs-type-body m-0">
                  {{ currency.enabled ? '启用' : '停用' }}
                </dd>
              </div>
              <div v-if="hasVisibleTableColumn(visibleColumns, 'rate')">
                <dt class="qs-type-compact-label mb-1">
                  当前汇率
                </dt>
                <dd class="qs-type-body m-0">
                  {{ currency.isBase ? '固定 1:1' : currency.exchangeRateConfigured ? '已配置' : '未配置' }}
                </dd>
              </div>
              <div v-if="hasVisibleTableColumn(visibleColumns, 'sortOrder')">
                <dt class="qs-type-compact-label mb-1">
                  排序
                </dt>
                <dd class="qs-type-data m-0 tabular-nums">
                  {{ currency.sortOrder }}
                </dd>
              </div>
              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'updatedAt')"
                class="col-span-full max-[479px]:col-span-1"
              >
                <dt class="qs-type-compact-label mb-1">
                  更新时间
                </dt>
                <dd class="m-0">
                  <DateTimeDisplay :value="currency.updatedAt" />
                </dd>
              </div>
            </dl>
          </div>
        </template>
      </QsGenericTable>
    </FaPageMain>

    <CurrencyFormModal
      v-if="canRead"
      v-model="formVisible"
      :mode="formMode"
      :currency="formTarget"
      :submitting="formSubmitting"
      :error="formError"
      :request-id="formRequestId"
      :field-errors="formFieldErrors"
      @submit="handleFormSubmit"
    />
    <CurrencyStatusChangeModal
      v-if="canRead"
      v-model="statusVisible"
      :action="statusAction"
      :currency="statusTarget"
      :submitting="statusSubmitting"
      :error="statusError"
      :error-code="statusErrorCode"
      :request-id="statusRequestId"
      @submit="handleStatusSubmit"
    />
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .currency-management-page :deep(.qs-generic-table .animate-pulse) {
    animation: none !important;
  }
}
</style>
