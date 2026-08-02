<script setup lang="ts">
import type { TableSortingState } from '@fantastic-admin/components'
import type { NumberingRuleListItemDto } from '@/api/modules/numbering'
import type {
  QsGenericTableColumn,
  QsGenericTableFilterDefinition,
  QsGenericTableFilterValues,
} from '@/components/business/QsGenericTable/logic'

import numberingApi from '@/api/modules/numbering'
import DateTimeDisplay from '@/components/base/DateTimeDisplay/index.vue'
import QsGenericTable from '@/components/business/QsGenericTable/index.vue'

import { hasVisibleTableColumn } from '../../shared/table-query'
import {
  buildNumberingTableListQuery,
  canApplyNumberingRuleListResponse,
  formatNumberingRuleStructure,
  getNumberingListFailure,
  isNumberingAbortError,
  numberingResetPolicyLabel,
} from './numbering-list.logic'
import {
  formatNumberingDecimal,
  numberingPeriodStatusLabel,
  numberingRuleStatusLabel,
} from './numbering-management.logic'

defineOptions({ name: 'SystemBasicDataNumbering' })

const { auth } = useAppAuth()
const appAccountStore = useAppAccountStore()

const canRead = computed(() => auth('numbering-rules:read'))
const rows = ref<NumberingRuleListItemDto[]>([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(20)
const search = ref('')
const filters = ref<QsGenericTableFilterValues>({})
const sorting = ref<TableSortingState>([
  { desc: true, id: 'updatedAt' },
])
const listLoading = ref(false)
const listError = ref('')
const listRequestId = ref<string>()
let listRequestVersion = 0
let listAbortController: AbortController | null = null
let queryRefreshQueued = false
let listDisposed = false

const listErrorDisplay = computed(() => listError.value === ''
  ? undefined
  : listRequestId.value === undefined
    ? listError.value
    : `${listError.value}（requestId: ${listRequestId.value}）`)

const columns: QsGenericTableColumn<NumberingRuleListItemDto>[] = [
  {
    accessorFn: item => item.name,
    id: 'rule',
    minWidth: 220,
    title: '编号规则',
  },
  {
    accessorFn: item => formatNumberingRuleStructure(item.displayVersion.config),
    id: 'structure',
    minWidth: 340,
    title: '编号结构',
  },
  {
    accessorKey: 'status',
    id: 'status',
    title: '状态',
    width: 100,
  },
  {
    id: 'revision',
    title: '版本',
    width: 130,
  },
  {
    accessorFn: item => item.statistics.capacity,
    align: 'right',
    id: 'capacity',
    minWidth: 150,
    title: '容量',
  },
  {
    accessorFn: item => item.statistics.usedCount,
    align: 'right',
    id: 'usedCount',
    minWidth: 140,
    title: '已使用',
  },
  {
    accessorFn: item => item.statistics.remainingCount,
    align: 'right',
    id: 'remainingCount',
    minWidth: 140,
    title: '剩余',
  },
  {
    accessorFn: item => item.statistics.nextNumberPreview,
    id: 'nextNumber',
    minWidth: 230,
    title: '下一编号',
  },
  {
    accessorKey: 'updatedAt',
    enableMultiSort: false,
    id: 'updatedAt',
    minWidth: 190,
    sortable: true,
    title: '更新时间',
  },
]

const filterDefinitions: QsGenericTableFilterDefinition[] = [
  {
    key: 'status',
    label: '规则状态',
    options: [
      { label: '草稿', value: 'DRAFT' },
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
  return canApplyNumberingRuleListResponse({
    aborted: controller.signal.aborted,
    authorized: canRead.value,
    authEpoch,
    currentAuthEpoch: appAccountStore.authEpoch,
    latestRequestVersion: listRequestVersion,
    requestVersion,
  })
}

async function loadNumberingRules(): Promise<void> {
  if (listDisposed || !canRead.value) {
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
    const response = await numberingApi.rules.list(
      buildNumberingTableListQuery({
        filters: filters.value,
        page: page.value,
        pageSize: pageSize.value,
        search: search.value,
        sorting: sorting.value,
      }),
      controller.signal,
    )
    if (!listResponseIsCurrent(requestVersion, authEpoch, controller)) {
      return
    }

    rows.value = response.data.items
    page.value = response.data.page
    pageSize.value = response.data.pageSize
    total.value = response.data.total
  }
  catch (error) {
    if (
      isNumberingAbortError(error)
      || !listResponseIsCurrent(requestVersion, authEpoch, controller)
    ) {
      return
    }
    const failure = getNumberingListFailure(error)
    listError.value = failure.message
    listRequestId.value = failure.requestId
  }
  finally {
    if (requestVersion === listRequestVersion) {
      listLoading.value = false
    }
  }
}

/**
 * QsGenericTable 清除查询条件时会在同一轮更新多个 v-model；合并到一个微任务，
 * 避免同一份最终查询状态产生重复 GET。
 */
function scheduleQueryRefresh(): void {
  page.value = 1
  if (queryRefreshQueued) {
    return
  }
  queryRefreshQueued = true
  queueMicrotask(() => {
    queryRefreshQueued = false
    void loadNumberingRules()
  })
}

function handlePaginationChange(): void {
  void loadNumberingRules()
}

function clearListContext(): void {
  rows.value = []
  total.value = 0
  listError.value = ''
  listRequestId.value = undefined
  listLoading.value = false
}

function statusClass(item: NumberingRuleListItemDto): string {
  if (item.status === 'ENABLED') {
    return 'border-primary/30 bg-primary/10 text-primary'
  }
  if (item.status === 'DRAFT') {
    return 'border-warning/30 bg-warning/10 text-warning'
  }
  return 'border-border bg-muted text-muted-foreground'
}

function revisionText(revision: number | null): string {
  return revision === null ? '—' : `R${revision}`
}

function statisticsPeriodLabel(item: NumberingRuleListItemDto): string {
  return item.statistics.periodKey === 'ALL'
    ? '全生命周期'
    : item.statistics.periodKey
}

function nextNumberText(item: NumberingRuleListItemDto): string {
  if (item.statistics.periodStatus === 'EXHAUSTED') {
    return '容量已用尽'
  }
  return item.statistics.nextNumberPreview ?? '暂不可预览'
}

function nextNumberMeta(item: NumberingRuleListItemDto): string {
  if (item.statistics.periodStatus === 'EXHAUSTED') {
    return numberingPeriodStatusLabel(item.statistics.periodStatus)
  }
  const previewKind = item.statistics.nextNumberDeterministic
    ? '确定下一编号'
    : '随机预览'
  return item.statistics.nextSequenceValue === null
    ? previewKind
    : `${previewKind} · 序列 ${item.statistics.nextSequenceValue}`
}

watch(
  [() => appAccountStore.authEpoch, canRead],
  ([nextAuthEpoch, nextCanRead], [previousAuthEpoch]) => {
    const identityChanged = nextAuthEpoch !== previousAuthEpoch
    listAbortController?.abort()
    listRequestVersion += 1

    if (identityChanged || !nextCanRead) {
      clearListContext()
    }
    if (!nextCanRead) {
      return
    }

    page.value = 1
    void loadNumberingRules()
  },
)

onMounted(() => {
  if (canRead.value) {
    void loadNumberingRules()
  }
})

onBeforeUnmount(() => {
  listDisposed = true
  listRequestVersion += 1
  listAbortController?.abort()
})
</script>

<template>
  <div class="numbering-management-page min-w-0">
    <FaPageHeader
      title="编号管理"
      description="集中查看后续业务域的编号结构、规则状态、版本与当前周期容量；所有时间均按 Asia/Shanghai 展示。"
    >
      <FaButton
        v-if="canRead"
        variant="outline"
        :loading="listLoading"
        @click="loadNumberingRules"
      >
        <FaIcon v-if="!listLoading" name="i-lucide:refresh-cw" />
        刷新
      </FaButton>
    </FaPageHeader>

    <FaPageMain>
      <FaEmpty
        v-if="!canRead"
        icon="i-lucide:shield-alert"
        title="无权查看编号规则"
        description="当前身份缺少 numbering-rules:read 权限。"
        class="min-h-64"
      />

      <section v-else class="min-w-0" aria-label="编号规则列表与容量统计">
        <div class="mb-4 flex flex-wrap gap-3 items-baseline justify-between">
          <p class="qs-type-description m-0 max-w-3xl">
            容量、已使用与剩余量均为精确整数；下一编号可能是确定值或随机预览。
          </p>
          <p class="qs-type-meta m-0 shrink-0">
            统计时区 · <code>Asia/Shanghai</code>
          </p>
        </div>

        <QsGenericTable
          v-model:page="page"
          v-model:page-size="pageSize"
          v-model:search="search"
          v-model:filters="filters"
          v-model:sorting="sorting"
          data-testid="numbering-rule-table"
          row-key="id"
          :addable="false"
          :columns="columns"
          :data="rows"
          empty-title="暂无编号规则"
          empty-description="当前还没有可展示的编号规则。"
          :error="listErrorDisplay"
          :filter-definitions="filterDefinitions"
          :loading="listLoading"
          :page-size-options="[20, 50, 100]"
          search-placeholder="搜索规则名称或 Rule Code"
          :total="total"
          table-class="min-w-[1740px]"
          @filter-change="scheduleQueryRefresh"
          @pagination-change="handlePaginationChange"
          @retry="loadNumberingRules"
          @search="scheduleQueryRefresh"
          @sorting-change="scheduleQueryRefresh"
        >
          <template #cell-rule="{ row }">
            <div class="gap-0.5 grid min-w-0">
              <strong class="qs-type-body-medium break-words">
                {{ row.original.name }}
              </strong>
              <code class="qs-type-data-emphasis [overflow-wrap:anywhere]">
                {{ row.original.ruleCode }}
              </code>
              <span class="qs-type-meta break-words line-clamp-2">
                {{ row.original.description || '暂无说明' }}
              </span>
            </div>
          </template>

          <template #cell-structure="{ row }">
            <div class="gap-1 grid min-w-0">
              <code class="qs-type-data-mono whitespace-normal [overflow-wrap:anywhere]">
                {{ formatNumberingRuleStructure(row.original.displayVersion.config) }}
              </code>
              <span class="qs-type-meta break-words">
                {{ numberingResetPolicyLabel(row.original.displayVersion.config.resetPolicy) }}
                · {{ row.original.displayVersion.config.timezone }}
                · 最长 {{ row.original.displayVersion.config.maxOutputLength }} 位
              </span>
            </div>
          </template>

          <template #cell-status="{ row }">
            <FaTag
              variant="outline"
              class="qs-type-status-tag"
              :class="statusClass(row.original)"
            >
              {{ numberingRuleStatusLabel(row.original.status) }}
            </FaTag>
          </template>

          <template #cell-revision="{ row }">
            <div class="gap-0.5 grid tabular-nums">
              <span class="qs-type-data">生效 {{ revisionText(row.original.activeRevision) }}</span>
              <span class="qs-type-meta">草稿 {{ revisionText(row.original.draftRevision) }}</span>
            </div>
          </template>

          <template #cell-capacity="{ row }">
            <div class="text-right gap-0.5 grid">
              <code class="qs-type-data-emphasis tabular-nums">
                {{ formatNumberingDecimal(row.original.statistics.capacity) }}
              </code>
              <span class="qs-type-meta">{{ statisticsPeriodLabel(row.original) }}</span>
            </div>
          </template>

          <template #cell-usedCount="{ row }">
            <code class="qs-type-data tabular-nums">
              {{ formatNumberingDecimal(row.original.statistics.usedCount) }}
            </code>
          </template>

          <template #cell-remainingCount="{ row }">
            <code class="qs-type-data-emphasis tabular-nums">
              {{ formatNumberingDecimal(row.original.statistics.remainingCount) }}
            </code>
          </template>

          <template #cell-nextNumber="{ row }">
            <div class="gap-0.5 grid min-w-0">
              <code class="qs-type-data-emphasis whitespace-normal [overflow-wrap:anywhere]">
                {{ nextNumberText(row.original) }}
              </code>
              <span class="qs-type-meta break-words">
                {{ nextNumberMeta(row.original) }}
              </span>
            </div>
          </template>

          <template #cell-updatedAt="{ row }">
            <DateTimeDisplay
              :value="row.original.updatedAt"
              time-zone="Asia/Shanghai"
            />
          </template>

          <template #mobile-row="{ columns: visibleColumns, row: item, rowNumber }">
            <div data-testid="numbering-mobile-row" class="gap-4 grid min-w-0">
              <div class="flex gap-3 min-w-0 items-start justify-between">
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'rule')"
                  class="min-w-0"
                >
                  <strong class="qs-type-body-medium block break-words">
                    {{ item.name }}
                  </strong>
                  <code class="qs-type-data-emphasis block [overflow-wrap:anywhere]">
                    {{ item.ruleCode }}
                  </code>
                  <span v-if="item.description" class="qs-type-meta mt-1 block break-words">
                    {{ item.description }}
                  </span>
                </div>
                <div class="flex shrink-0 flex-col gap-1 items-end">
                  <FaTag
                    v-if="hasVisibleTableColumn(visibleColumns, 'status')"
                    variant="outline"
                    class="qs-type-status-tag"
                    :class="statusClass(item)"
                  >
                    {{ numberingRuleStatusLabel(item.status) }}
                  </FaTag>
                  <span class="qs-type-meta tabular-nums">#{{ rowNumber }}</span>
                </div>
              </div>

              <div
                v-if="hasVisibleTableColumn(visibleColumns, 'structure')"
                class="min-w-0"
              >
                <p class="qs-type-compact-label mb-1 mt-0">
                  编号结构
                </p>
                <code class="qs-type-data-mono block whitespace-normal [overflow-wrap:anywhere]">
                  {{ formatNumberingRuleStructure(item.displayVersion.config) }}
                </code>
                <span class="qs-type-meta mt-1 block break-words">
                  {{ numberingResetPolicyLabel(item.displayVersion.config.resetPolicy) }}
                  · {{ item.displayVersion.config.timezone }}
                  · 最长 {{ item.displayVersion.config.maxOutputLength }} 位
                </span>
              </div>

              <dl class="m-0 gap-x-4 gap-y-3 grid grid-cols-3 max-[390px]:grid-cols-1">
                <div v-if="hasVisibleTableColumn(visibleColumns, 'revision')">
                  <dt class="qs-type-compact-label mb-1">
                    版本
                  </dt>
                  <dd class="qs-type-data m-0 tabular-nums">
                    生效 {{ revisionText(item.activeRevision) }}
                    · 草稿 {{ revisionText(item.draftRevision) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'capacity')">
                  <dt class="qs-type-compact-label mb-1">
                    容量
                  </dt>
                  <dd class="qs-type-data-emphasis m-0 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(item.statistics.capacity) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'usedCount')">
                  <dt class="qs-type-compact-label mb-1">
                    已使用
                  </dt>
                  <dd class="qs-type-data m-0 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(item.statistics.usedCount) }}
                  </dd>
                </div>
                <div v-if="hasVisibleTableColumn(visibleColumns, 'remainingCount')">
                  <dt class="qs-type-compact-label mb-1">
                    剩余
                  </dt>
                  <dd class="qs-type-data-emphasis m-0 [overflow-wrap:anywhere] tabular-nums">
                    {{ formatNumberingDecimal(item.statistics.remainingCount) }}
                  </dd>
                </div>
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'nextNumber')"
                  class="col-span-2 min-w-0 max-[390px]:col-span-1"
                >
                  <dt class="qs-type-compact-label mb-1">
                    下一编号
                  </dt>
                  <dd class="m-0 min-w-0">
                    <code class="qs-type-data-emphasis block whitespace-normal [overflow-wrap:anywhere]">
                      {{ nextNumberText(item) }}
                    </code>
                    <span class="qs-type-meta mt-1 block break-words">
                      {{ nextNumberMeta(item) }} · {{ statisticsPeriodLabel(item) }}
                    </span>
                  </dd>
                </div>
                <div
                  v-if="hasVisibleTableColumn(visibleColumns, 'updatedAt')"
                  class="col-span-full max-[390px]:col-span-1"
                >
                  <dt class="qs-type-compact-label mb-1">
                    更新时间
                  </dt>
                  <dd class="m-0">
                    <DateTimeDisplay
                      :value="item.updatedAt"
                      time-zone="Asia/Shanghai"
                    />
                  </dd>
                </div>
              </dl>
            </div>
          </template>
        </QsGenericTable>
      </section>
    </FaPageMain>
  </div>
</template>

<style scoped>
@media (prefers-reduced-motion: reduce) {
  .numbering-management-page :deep(.qs-generic-table .animate-pulse) {
    animation: none !important;
  }
}
</style>
