<script setup lang="ts">
import type { ExchangeRateFormSubmission } from './exchange-rates.logic'
import type { ExchangeRateManagementItemDto } from '@/api/generated/types.gen'
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
import { formatExchangeRate } from '@/utils/exchange-rate'

import { hasVisibleTableColumn } from '../../shared/table-query'
import ExchangeRateFormModal from './exchange-rate-form-modal.vue'
import {
  buildExchangeRateListQuery,
  canApplyExchangeRateResponse,
  exchangeRateStatusLabel,
  getExchangeRateApiFailure,
  isExchangeRateAbortError,
} from './exchange-rates.logic'

defineOptions({ name: 'ExchangeRateManagementPanel' })

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()
const toast = useQsToast()

const canRead = computed(() => auth('exchange-rates:read'))
const canCreate = computed(() => auth('exchange-rates:create'))
const canUpdate = computed(() => auth('exchange-rates:update'))

const rows = ref<ExchangeRateManagementItemDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const loading = ref(false)
const listError = ref('')
const listRequestId = ref<string>()
let listRequestVersion = 0
let listAbortController: AbortController | null = null
let queryRefreshPending = false

const formVisible = ref(false)
const formTarget = ref<ExchangeRateManagementItemDto | null>(null)
const formSubmitting = ref(false)
const formError = ref<string | null>(null)
const formRequestId = ref<string | null>(null)
const formFieldErrors = ref<Readonly<Record<string, string>>>({})

const listErrorDisplay = computed(() => {
  if (listError.value === '') {
    return undefined
  }
  return listRequestId.value === undefined
    ? listError.value
    : `${listError.value}（requestId: ${listRequestId.value}）`
})

const columns: QsGenericTableColumn<ExchangeRateManagementItemDto>[] = [
  {
    accessorFn: item => item.currency.name,
    id: 'currency',
    minWidth: 220,
    title: '货币',
  },
  {
    accessorFn: item => item.currentRate === null
      ? 'UNCONFIGURED'
      : 'CONFIGURED',
    id: 'status',
    title: '配置状态',
    width: 120,
  },
  {
    accessorFn: item => item.currentRate?.foreignUnitsPerCny ?? null,
    id: 'foreignUnitsPerCny',
    minWidth: 210,
    title: '外币单位数 / 1 CNY',
  },
  {
    id: 'formula',
    minWidth: 260,
    title: '人民币换算',
  },
  {
    accessorFn: item => item.currentRate?.updatedAt ?? null,
    id: 'updatedAt',
    minWidth: 190,
    title: '更新时间',
  },
]

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'status',
    label: '配置状态',
    options: [
      { label: '已配置', value: 'CONFIGURED' },
      { label: '未配置', value: 'UNCONFIGURED' },
    ],
  },
]

function listResponseIsCurrent(
  requestVersion: number,
  authEpoch: number,
  controller: AbortController,
): boolean {
  return canApplyExchangeRateResponse({
    aborted: controller.signal.aborted,
    authorized: canRead.value,
    authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion: listRequestVersion,
    requestVersion,
  })
}

async function loadExchangeRates(): Promise<void> {
  if (!canRead.value) {
    return
  }

  listAbortController?.abort()
  const controller = new AbortController()
  listAbortController = controller
  const requestVersion = ++listRequestVersion
  const authEpoch = appAccountStore.authEpoch
  loading.value = true
  listError.value = ''
  listRequestId.value = undefined

  try {
    const response = await currenciesApi.exchangeRates.list(
      buildExchangeRateListQuery({
        filters: filters.value,
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
      }),
      controller.signal,
    )
    if (!listResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }

    /*
     * 服务端列表契约本身排除基准货币；这里保留显式防线，避免未来契约漂移时
     * 管理员误把 CNY 当作可配置外币。
     */
    rows.value = response.data.items.filter(item => item.currency.code !== 'CNY')
    page.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    if (
      isExchangeRateAbortError(error)
      || !listResponseIsCurrent(requestVersion, authEpoch, controller)
    ) {
      return
    }
    const failure = getExchangeRateApiFailure(error)
    listError.value = failure.message
    listRequestId.value = failure.requestId
  }
  finally {
    if (requestVersion === listRequestVersion) {
      loading.value = false
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
    page.value = 1
    void loadExchangeRates()
  })
}

function handlePaginationChange(): void {
  void loadExchangeRates()
}

function handleFilterChange(): void {
  scheduleQueryRefresh()
}

function resetFormFailure(): void {
  formError.value = null
  formRequestId.value = null
  formFieldErrors.value = {}
}

function canConfigure(item: ExchangeRateManagementItemDto): boolean {
  return item.currentRate === null ? canCreate.value : canUpdate.value
}

function openForm(item: ExchangeRateManagementItemDto): void {
  if (!canRead.value || !canConfigure(item) || item.currency.code === 'CNY') {
    return
  }
  formTarget.value = item
  resetFormFailure()
  formVisible.value = true
}

function cancelForm(): void {
  if (!formSubmitting.value) {
    formVisible.value = false
  }
}

function clearFormContext(): void {
  formVisible.value = false
  formTarget.value = null
  formSubmitting.value = false
  resetFormFailure()
}

async function closeFormAfterSuccess(): Promise<void> {
  // QsGenericModal 在提交态拒绝关闭，先解除锁并等待一帧再收起。
  formSubmitting.value = false
  await nextTick()
  formVisible.value = false
}

function applyFormFailure(error: unknown) {
  const failure = getExchangeRateApiFailure(error)
  formError.value = failure.unknownResult
    ? '操作结果未知，系统已重新查询；请核查当前汇率后再继续'
    : failure.message
  formRequestId.value = failure.requestId ?? null
  formFieldErrors.value = failure.fieldErrors
  formSubmitting.value = false
  return failure
}

async function handleFormSubmit(
  submission: ExchangeRateFormSubmission,
): Promise<void> {
  const target = formTarget.value
  if (
    !canRead.value
    || formSubmitting.value
    || !formVisible.value
    || target === null
    || target.currency.code === 'CNY'
  ) {
    return
  }
  if (
    (submission.mode === 'create'
      && (target.currentRate !== null || !canCreate.value))
    || (submission.mode === 'edit'
      && (target.currentRate === null || !canUpdate.value))
  ) {
    formError.value = '当前资料或权限已发生变化，请关闭弹窗并刷新后重试'
    return
  }
  if (
    submission.mode === 'edit'
    && submission.exchangeRateId !== target.currentRate?.id
  ) {
    formError.value = '待编辑汇率已发生变化，请关闭弹窗并刷新后重试'
    return
  }

  resetFormFailure()
  formSubmitting.value = true
  try {
    if (submission.mode === 'create') {
      await currenciesApi.exchangeRates.create(submission.value)
    }
    else {
      await currenciesApi.exchangeRates.update(
        submission.exchangeRateId,
        submission.value,
      )
    }

    await closeFormAfterSuccess()
    invalidateCurrencyCatalogCache({ broadcast: true })
    toast.success(
      submission.mode === 'create' ? '当前汇率已配置' : '当前汇率已更新',
      { description: `${target.currency.name}（${target.currency.code}）` },
    )
    if (canRead.value) {
      await loadExchangeRates()
    }
  }
  catch (error) {
    const failure = applyFormFailure(error)
    if (
      canRead.value
      && (
        failure.unknownResult
        || failure.code === 'EXCHANGE_RATE_STATE_CHANGED'
      )
    ) {
      await loadExchangeRates()
      const refreshedTarget = rows.value.find(
        item => item.currency.id === target.currency.id,
      )
      if (refreshedTarget === undefined) {
        formVisible.value = false
        formTarget.value = null
      }
      else {
        formTarget.value = refreshedTarget
      }
    }
  }
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  ([nextAuthEpoch, nextCanRead], [previousAuthEpoch]) => {
    const identityChanged = nextAuthEpoch !== previousAuthEpoch
    listAbortController?.abort()
    listRequestVersion += 1
    loading.value = false
    if (identityChanged || !nextCanRead) {
      clearFormContext()
    }

    if (!nextCanRead) {
      rows.value = []
      total.value = 0
      listError.value = ''
      listRequestId.value = undefined
      return
    }
    void loadExchangeRates()
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadExchangeRates()
  }
})

onBeforeUnmount(() => {
  listRequestVersion += 1
  listAbortController?.abort()
})
</script>

<template>
  <div class="exchange-rate-management-page">
    <p class="qs-type-description mb-5 mt-0 max-w-3xl">
      维护非人民币货币当前兑人民币的换算比例；首期不记录有效期或历史版本。
    </p>

    <FaEmpty
      v-if="!canRead"
      icon="i-lucide:shield-alert"
      title="无权查看汇率"
      description="当前身份缺少 exchange-rates:read 权限。"
      class="min-h-64"
    />

    <template v-else>
      <FaAlert
        icon="i-lucide:calculator"
        title="换算口径"
        description="统一口径：1 CNY = X CODE；人民币金额 = 外币金额 ÷ 比例。页面不会预设任何生产汇率。"
        class="mb-5"
      />

      <QsGenericTable
        v-model:page="page"
        v-model:page-size="pageSize"
        v-model:search="search"
        v-model:filters="filters"
        data-testid="exchange-rate-table"
        :row-key="item => item.currency.id"
        :addable="false"
        :columns="columns"
        :data="rows"
        :empty-description="search.trim() || filters.status
          ? '没有符合当前搜索与筛选条件的非人民币货币。'
          : '请先在货币管理中建立非人民币货币。'"
        :empty-title="search.trim() || filters.status ? '未找到匹配汇率' : '暂无可维护汇率'"
        :error="listErrorDisplay"
        :filter-definitions="filterDefinitions"
        :loading="loading"
        :page-size-options="[20, 50, 100]"
        search-placeholder="搜索货币名称、英文名或 Currency Code"
        :total="total"
        table-class="min-w-[1120px]"
        @filter-change="handleFilterChange"
        @pagination-change="handlePaginationChange"
        @retry="loadExchangeRates"
        @search="scheduleQueryRefresh"
      >
        <template #cell-currency="{ row }">
          <div class="gap-0.5 grid min-w-0">
            <strong class="qs-type-body-medium break-words">
              {{ row.original.currency.name }}
            </strong>
            <span class="qs-type-meta break-words">
              {{ row.original.currency.englishName || '暂无英文名' }}
            </span>
            <code class="qs-type-data-emphasis break-all">
              {{ row.original.currency.code }}
            </code>
          </div>
        </template>

        <template #cell-status="{ row }">
          <FaTag
            variant="outline"
            class="qs-type-status-tag"
            :class="row.original.currentRate === null
              ? 'border-border bg-muted text-muted-foreground'
              : 'border-primary/30 bg-primary/10 text-primary'"
          >
            {{ exchangeRateStatusLabel(row.original) }}
          </FaTag>
        </template>

        <template #cell-foreignUnitsPerCny="{ row }">
          <span
            v-if="row.original.currentRate"
            class="flex flex-wrap gap-1 items-baseline"
          >
            <span class="qs-type-meta">1 CNY =</span>
            <code class="qs-type-data-emphasis break-all tabular-nums">
              {{ formatExchangeRate(row.original.currentRate.foreignUnitsPerCny) }}
            </code>
            <code class="qs-type-data-emphasis">
              {{ row.original.currency.code }}
            </code>
          </span>
          <span v-else class="qs-type-meta">未配置</span>
        </template>

        <template #cell-formula="{ row }">
          <span v-if="row.original.currentRate" class="qs-type-body">
            {{ row.original.currency.code }} 金额 ÷
            <code class="qs-type-data-emphasis tabular-nums">
              {{ formatExchangeRate(row.original.currentRate.foreignUnitsPerCny) }}
            </code>
            = CNY
          </span>
          <span v-else class="qs-type-meta">配置比例后可换算</span>
        </template>

        <template #cell-updatedAt="{ row }">
          <DateTimeDisplay
            v-if="row.original.currentRate"
            :value="row.original.currentRate.updatedAt"
          />
          <span v-else class="qs-type-meta">—</span>
        </template>

        <template #actions="{ row: item }">
          <FaButton
            v-if="canConfigure(item)"
            variant="ghost"
            size="sm"
            class="min-h-11 w-full md:min-h-8 md:w-auto"
            :aria-label="`${item.currentRate === null ? '配置' : '编辑'} ${item.currency.name} 当前汇率`"
            @click="openForm(item)"
          >
            {{ item.currentRate === null ? '配置' : '编辑' }}
          </FaButton>
          <span v-else class="qs-type-meta">当前身份仅可查看</span>
        </template>

        <template #mobile-row="{ columns: visibleColumns, row: item, rowNumber }">
          <div data-testid="exchange-rate-card" class="gap-4 grid min-w-0">
            <div class="flex gap-3 min-w-0 items-start justify-between">
              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'currency')"
                class="min-w-0"
              >
                <strong class="qs-type-body-medium block break-words">
                  {{ item.currency.name }}
                </strong>
                <code class="qs-type-data-emphasis break-all">
                  {{ item.currency.code }}
                </code>
              </div>
              <div class="flex shrink-0 flex-col gap-1 items-end">
                <FaTag
                  v-if="hasVisibleTableColumn(visibleColumns, 'status')"
                  variant="outline"
                  class="qs-type-status-tag"
                >
                  {{ exchangeRateStatusLabel(item) }}
                </FaTag>
                <span class="qs-type-meta tabular-nums">#{{ rowNumber }}</span>
              </div>
            </div>

            <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-2 max-[479px]:grid-cols-1">
              <div v-if="hasVisibleTableColumn(visibleColumns, 'foreignUnitsPerCny')">
                <dt class="qs-type-compact-label mb-1">
                  外币单位数 / 1 CNY
                </dt>
                <dd class="qs-type-data-emphasis m-0 break-all tabular-nums">
                  {{ item.currentRate
                    ? `1 CNY = ${formatExchangeRate(item.currentRate.foreignUnitsPerCny)} ${item.currency.code}`
                    : '未配置' }}
                </dd>
              </div>
              <div v-if="hasVisibleTableColumn(visibleColumns, 'formula')">
                <dt class="qs-type-compact-label mb-1">
                  人民币换算
                </dt>
                <dd class="qs-type-body m-0 break-words">
                  {{ item.currentRate
                    ? `${item.currency.code} 金额 ÷ ${formatExchangeRate(item.currentRate.foreignUnitsPerCny)} = CNY`
                    : '配置比例后可换算' }}
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
                  <DateTimeDisplay
                    v-if="item.currentRate"
                    :value="item.currentRate.updatedAt"
                  />
                  <span v-else class="qs-type-meta">—</span>
                </dd>
              </div>
            </dl>
          </div>
        </template>
      </QsGenericTable>
    </template>

    <ExchangeRateFormModal
      v-if="canRead"
      :model-value="formVisible"
      :item="formTarget"
      :submitting="formSubmitting"
      :error="formError"
      :request-id="formRequestId"
      :field-errors="formFieldErrors"
      @cancel="cancelForm"
      @submit="handleFormSubmit"
    />
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .exchange-rate-management-page :deep(.qs-generic-table .animate-pulse) {
    animation: none !important;
  }
}
</style>
