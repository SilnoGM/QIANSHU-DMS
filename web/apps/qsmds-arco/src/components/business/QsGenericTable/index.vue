<script setup lang="ts" generic="TData extends object = Record<string, unknown>">
import type {
  TableColumn,
  TableColumnFixed,
  TableProps,
  TableSortingState,
} from '@fantastic-admin/components'
import type { Component } from 'vue'
import type { QsGenericTableColumn, QsGenericTableColumnSettingItem, QsGenericTableColumnSettings, QsGenericTableFilterDefinition, QsGenericTableFilterValue, QsGenericTableFilterValues, QsGenericTableSummaryValue } from './logic'

import { useMediaQuery } from '@vueuse/core'
import ColumnSettingsPanel from './ColumnSettingsPanel.vue'
import FilterPanel from './FilterPanel.vue'
import {
  calculateColumnSummary,
  createDefaultColumnSettings,
  DEFAULT_PAGE_SIZE,
  formatSummaryValue,
  getColumnRawValue,
  getContinuousRowNumber,
  getSummaryComponentProps,
  getSummaryTypeLabel,
  QS_GENERIC_TABLE_ROW_NUMBER_COLUMN_ID,
  reconcileColumnSettings,
  resolveVisibleTableColumns,
} from './logic'

defineOptions({ name: 'QsGenericTable' })

const props = withDefaults(defineProps<{
  addLabel?: string
  addable?: boolean
  border?: boolean
  columns: QsGenericTableColumn<TData>[]
  data: TData[]
  emptyDescription?: string
  emptyTitle?: string
  error?: string
  filterDefinitions?: QsGenericTableFilterDefinition[]
  loading?: boolean
  pageSizeOptions?: number[]
  rowKey?: TableProps<TData>['rowKey']
  searchable?: boolean
  searchPlaceholder?: string
  showPagination?: boolean
  stripe?: boolean
  summaryValues?: Record<string, QsGenericTableSummaryValue>
  tableClass?: string
  total?: number
}>(), {
  addLabel: '新增数据',
  addable: true,
  border: false,
  emptyDescription: '当前没有可展示的数据。',
  emptyTitle: '暂无数据',
  error: undefined,
  filterDefinitions: () => [],
  loading: false,
  pageSizeOptions: () => [20, 50, 100, 200],
  rowKey: undefined,
  searchable: true,
  searchPlaceholder: '搜索当前业务数据',
  showPagination: true,
  stripe: false,
  summaryValues: () => ({}),
  tableClass: undefined,
  total: undefined,
})

const emit = defineEmits<{
  add: []
  columnSettingsChange: [settings: QsGenericTableColumnSettings]
  filterChange: [filters: QsGenericTableFilterValues]
  paginationChange: [pagination: { page: number, pageSize: number }]
  retry: []
  search: [keyword: string]
  sortingChange: [sorting: TableSortingState]
}>()

const page = defineModel<number>('page', { default: 1 })
const pageSize = defineModel<number>('pageSize', { default: DEFAULT_PAGE_SIZE })
const search = defineModel<string>('search', { default: '' })
const filters = defineModel<QsGenericTableFilterValues>('filters', { default: () => ({}) })
const sorting = defineModel<TableSortingState>('sorting', { default: () => [] })

const slots = useSlots()
const isNarrow = useMediaQuery('(max-width: 767px)')
const searchDraft = ref(search.value)
const filterDraft = ref<QsGenericTableFilterValues>({ ...filters.value })
const desktopFilterVisible = ref(false)
const filterDrawerVisible = ref(false)
const columnDrawerVisible = ref(false)
const columnSettings = ref<QsGenericTableColumnSettings>(
  createDefaultColumnSettings(props.columns),
)

const totalRows = computed(() => props.total ?? props.data.length)
const paginationLayout = computed(() => isNarrow.value
  ? 'total, ->, pager'
  : 'total, sizes, ->, pager, jumper')

const columnSettingItems = computed<QsGenericTableColumnSettingItem[]>(() => props.columns.map(column => ({
  fixed: columnSettings.value[column.id]?.fixed,
  id: column.id,
  title: column.title,
  visible: columnSettings.value[column.id]?.visible ?? true,
})))

const visibleBusinessColumns = computed(() => resolveVisibleTableColumns(
  props.columns,
  columnSettings.value,
))

const visibleColumnDefinitions = computed(() => props.columns.filter(column =>
  columnSettings.value[column.id]?.visible !== false))

const summaryColumns = computed(() => visibleColumnDefinitions.value.filter(column => column.summary))
const hasSummary = computed(() => summaryColumns.value.length > 0)
const slottedCellColumns = computed(() => visibleColumnDefinitions.value.filter(column =>
  Boolean(slots[`cell-${column.id}`])))
const slottedHeaderColumns = computed(() => visibleColumnDefinitions.value.filter(column =>
  Boolean(slots[`header-${column.id}`])))

const tableColumns = computed<TableColumn<TData, any>[]>(() => {
  const rowNumberColumn: TableColumn<TData, number> = {
    id: QS_GENERIC_TABLE_ROW_NUMBER_COLUMN_ID,
    header: '#',
    footer: hasSummary.value ? '汇总' : undefined,
    cell: ({ row }) => `#${getContinuousRowNumber(page.value, pageSize.value, row.index)}`,
    enableHiding: false,
    enableSorting: false,
    fixed: 'left',
    maxWidth: 64,
    minWidth: 56,
    width: 56,
  }

  return [
    rowNumberColumn,
    ...visibleBusinessColumns.value.map(column => ({
      ...column,
      // FaTable 只有发现 footer 声明或 footer-* 插槽时才生成表尾。
      footer: getSourceColumn(column.id)?.summary ? ' ' : column.footer,
    })),
  ]
})

const activeFilters = computed(() => props.filterDefinitions.flatMap((definition) => {
  const value = filters.value[definition.key]
  if (value === undefined || value === '') {
    return []
  }

  return [{
    key: definition.key,
    label: definition.label,
    value,
    valueLabel: definition.options.find(option => option.value === value)?.label ?? String(value),
  }]
}))
const hasActiveQuery = computed(() => Boolean(search.value.trim()) || activeFilters.value.length > 0)

const paginationPage = computed({
  get: () => page.value,
  set: (nextPage: number) => {
    if (nextPage === page.value) {
      return
    }
    page.value = nextPage
    emitPaginationChange()
  },
})

const paginationSize = computed({
  get: () => pageSize.value,
  set: (nextPageSize: number) => {
    if (nextPageSize === pageSize.value) {
      return
    }
    pageSize.value = nextPageSize
    page.value = 1
    emitPaginationChange()
  },
})

function emitPaginationChange() {
  emit('paginationChange', {
    page: page.value,
    pageSize: pageSize.value,
  })
}

function resetPage() {
  page.value = 1
}

function submitSearch() {
  const nextSearch = searchDraft.value.trim()
  searchDraft.value = nextSearch
  search.value = nextSearch
  resetPage()
  emit('search', nextSearch)
}

function clearSearch() {
  searchDraft.value = ''
  submitSearch()
}

function openFilters() {
  filterDraft.value = { ...filters.value }
  if (isNarrow.value) {
    filterDrawerVisible.value = true
  }
  else {
    desktopFilterVisible.value = !desktopFilterVisible.value
  }
}

function updateFilterDraft(key: string, value: QsGenericTableFilterValue) {
  filterDraft.value = {
    ...filterDraft.value,
    [key]: value,
  }
}

function applyFilters() {
  filters.value = { ...filterDraft.value }
  resetPage()
  desktopFilterVisible.value = false
  filterDrawerVisible.value = false
  emit('filterChange', { ...filters.value })
}

function resetFilters() {
  filterDraft.value = {}
  filters.value = {}
  resetPage()
  desktopFilterVisible.value = false
  filterDrawerVisible.value = false
  emit('filterChange', {})
}

function removeFilter(key: string) {
  const nextFilters = { ...filters.value }
  delete nextFilters[key]
  filterDraft.value = { ...nextFilters }
  filters.value = nextFilters
  resetPage()
  emit('filterChange', { ...nextFilters })
}

function resetAllQueries() {
  searchDraft.value = ''
  search.value = ''
  filterDraft.value = {}
  filters.value = {}
  resetPage()
  emit('search', '')
  emit('filterChange', {})
}

function updateColumnSetting(id: string, patch: { fixed?: TableColumnFixed, visible?: boolean }) {
  const current = columnSettings.value[id]
  if (!current) {
    return
  }

  columnSettings.value = {
    ...columnSettings.value,
    [id]: {
      fixed: Object.hasOwn(patch, 'fixed') ? patch.fixed : current.fixed,
      visible: patch.visible ?? current.visible,
    },
  }
  emit('columnSettingsChange', { ...columnSettings.value })
}

function resetColumnSettings() {
  columnSettings.value = createDefaultColumnSettings(props.columns)
  emit('columnSettingsChange', { ...columnSettings.value })
}

function handleSortingChange(nextSorting: TableSortingState) {
  sorting.value = nextSorting
  resetPage()
  emit('sortingChange', nextSorting)
}

function getSourceColumn(id: string | undefined) {
  if (!id) {
    return undefined
  }
  return props.columns.find(column => column.id === id)
}

function getSummaryValue(column: QsGenericTableColumn<TData>) {
  if (Object.hasOwn(props.summaryValues, column.id)) {
    return props.summaryValues[column.id] ?? null
  }
  return calculateColumnSummary(props.data, column)
}

function getSummaryRenderer(column: QsGenericTableColumn<TData>): Component | undefined {
  return column.summary?.component
}

function getMobileValue(row: TData, column: QsGenericTableColumn<TData>, index: number) {
  const value = getColumnRawValue(row, column, index)
  return value === undefined || value === null || value === '' ? '—' : String(value)
}

function getMobileRowKey(row: TData, index: number) {
  if (typeof props.rowKey === 'function') {
    return props.rowKey(row, index)
  }
  if (typeof props.rowKey === 'string') {
    const value = (row as Record<string, unknown>)[props.rowKey]
    if (typeof value === 'number' || typeof value === 'string') {
      return value
    }
  }
  return getContinuousRowNumber(page.value, pageSize.value, index)
}

watch(() => props.columns, (nextColumns) => {
  columnSettings.value = reconcileColumnSettings(nextColumns, columnSettings.value)
}, { deep: true })

watch(search, (nextSearch) => {
  searchDraft.value = nextSearch
})

watch(filters, (nextFilters) => {
  filterDraft.value = { ...nextFilters }
}, { deep: true })
</script>

<template>
  <section class="qs-generic-table min-w-0" aria-label="业务通用表格">
    <div class="pb-4 flex flex-wrap gap-3 items-center justify-between">
      <div v-if="searchable" class="flex flex-1 gap-2 min-w-0 items-center">
        <FaInput
          v-model="searchDraft"
          type="search"
          clearable
          class="w-full sm-max-w-80"
          :placeholder="searchPlaceholder"
          @clear="clearSearch"
          @keyup.enter="submitSearch"
        >
          <template #start>
            <FaIcon name="i-lucide:search" />
          </template>
        </FaInput>
        <FaButton variant="outline" @click="submitSearch">
          查询
        </FaButton>
      </div>

      <div class="ms-auto flex flex-wrap gap-2 items-center">
        <FaButton
          v-if="filterDefinitions.length"
          variant="outline"
          :aria-expanded="desktopFilterVisible || filterDrawerVisible"
          @click="openFilters"
        >
          <FaIcon name="i-lucide:list-filter" />
          筛选
          <span v-if="activeFilters.length" class="text-xs px-1.5 rounded-full bg-primary/12 flex-center h-5 min-w-5">
            {{ activeFilters.length }}
          </span>
        </FaButton>

        <FaPopover v-if="!isNarrow" align="end" class="p-4">
          <FaButton variant="outline">
            <FaIcon name="i-lucide:columns-3" />
            列设置
          </FaButton>
          <template #panel>
            <ColumnSettingsPanel
              :items="columnSettingItems"
              @reset="resetColumnSettings"
              @update="updateColumnSetting"
            />
          </template>
        </FaPopover>
        <FaButton v-else variant="outline" @click="columnDrawerVisible = true">
          <FaIcon name="i-lucide:columns-3" />
          列设置
        </FaButton>

        <FaButton v-if="addable" @click="emit('add')">
          <FaIcon name="i-lucide:plus" />
          {{ addLabel }}
        </FaButton>
      </div>
    </div>

    <div v-if="activeFilters.length" class="pb-4 flex flex-wrap gap-2 items-center">
      <span class="text-xs text-muted-foreground">已应用</span>
      <FaTag
        v-for="filter in activeFilters"
        :key="filter.key"
        variant="secondary"
        closable
        @close="removeFilter(filter.key)"
      >
        {{ filter.label }}：{{ filter.valueLabel }}
      </FaTag>
      <FaButton variant="ghost" size="sm" class="text-muted-foreground" @click="resetFilters">
        清空筛选
      </FaButton>
    </div>

    <div v-if="desktopFilterVisible && !isNarrow" class="mb-4 p-4 border border-border rounded-lg bg-muted/20">
      <FilterPanel
        :definitions="filterDefinitions"
        :values="filterDraft"
        @apply="applyFilters"
        @reset="resetFilters"
        @update="updateFilterDraft"
      />
    </div>

    <FaAlert v-if="error" variant="destructive" icon="i-lucide:circle-alert" class="mb-4">
      <template #description>
        <div class="flex flex-wrap gap-3 items-center justify-between">
          <span>{{ error }}</span>
          <FaButton variant="outline" size="sm" @click="emit('retry')">
            重试
          </FaButton>
        </div>
      </template>
    </FaAlert>

    <div v-if="!isNarrow" class="relative" :aria-busy="loading">
      <FaTable
        :border="border"
        :columns="tableColumns"
        :data="data"
        :row-key="rowKey"
        :sorting="sorting"
        :stripe="stripe"
        :table-class="tableClass"
        table-root-class="overflow-x-auto"
        :class="loading && data.length ? 'pointer-events-none opacity-60' : undefined"
        @sorting-change="handleSortingChange"
      >
        <template
          v-for="column in slottedHeaderColumns"
          :key="`header-${column.id}`"
          #[`header-${column.id}`]="scope"
        >
          <slot :name="`header-${column.id}`" v-bind="scope" />
        </template>

        <template
          v-for="column in slottedCellColumns"
          :key="`cell-${column.id}`"
          #[`cell-${column.id}`]="scope"
        >
          <slot :name="`cell-${column.id}`" v-bind="scope" />
        </template>

        <template
          v-for="column in summaryColumns"
          :key="`footer-${column.id}`"
          #[`footer-${column.id}`]
        >
          <slot
            :name="`summary-${column.id}`"
            :column="column"
            :label="getSummaryTypeLabel(column.summary!.type)"
            :value="getSummaryValue(column)"
          >
            <div class="gap-0.5 grid">
              <span class="text-[11px] text-muted-foreground font-normal">
                {{ getSummaryTypeLabel(column.summary!.type) }}
              </span>
              <component
                :is="getSummaryRenderer(column)"
                v-if="getSummaryRenderer(column)"
                v-bind="getSummaryComponentProps(column, getSummaryValue(column))"
              />
              <strong v-else class="font-semibold">
                {{ formatSummaryValue(getSummaryValue(column)) }}
              </strong>
            </div>
          </slot>
        </template>

        <template #empty>
          <div v-if="loading" class="p-5 gap-4 grid min-h-48" role="status" aria-label="正在加载数据">
            <div v-for="index in 4" :key="index" class="rounded-md bg-muted h-8 animate-pulse" />
          </div>
          <div v-else class="py-8 flex-col-center">
            <FaEmpty
              :icon="hasActiveQuery ? 'i-lucide:search-x' : 'i-lucide:inbox'"
              :title="hasActiveQuery ? '没有匹配结果' : emptyTitle"
              :description="hasActiveQuery ? '请调整搜索词或筛选条件后重试。' : emptyDescription"
              class="min-h-36"
            />
            <FaButton v-if="hasActiveQuery" variant="outline" size="sm" @click="resetAllQueries">
              清除查询条件
            </FaButton>
          </div>
        </template>
      </FaTable>
    </div>

    <div v-else class="gap-3 grid" :aria-busy="loading">
      <template v-if="loading && !data.length">
        <div v-for="index in 4" :key="index" class="p-4 border border-border rounded-lg gap-3 grid">
          <div class="rounded bg-muted h-4 w-20 animate-pulse" />
          <div class="rounded bg-muted h-8 w-full animate-pulse" />
          <div class="rounded bg-muted h-4 w-3/4 animate-pulse" />
        </div>
      </template>

      <div v-else-if="!data.length" class="py-6 border border-border rounded-lg border-dashed flex-col-center">
        <FaEmpty
          :icon="hasActiveQuery ? 'i-lucide:search-x' : 'i-lucide:inbox'"
          :title="hasActiveQuery ? '没有匹配结果' : emptyTitle"
          :description="hasActiveQuery ? '请调整搜索词或筛选条件后重试。' : emptyDescription"
          class="min-h-36"
        />
        <FaButton v-if="hasActiveQuery" variant="outline" size="sm" @click="resetAllQueries">
          清除查询条件
        </FaButton>
      </div>

      <template v-else>
        <div
          v-for="(row, index) in data"
          :key="getMobileRowKey(row, index)"
          class="p-4 border border-border rounded-lg bg-background"
          :class="loading ? 'pointer-events-none opacity-60' : undefined"
        >
          <slot
            name="mobile-row"
            :columns="visibleColumnDefinitions"
            :index="index"
            :row="row"
            :row-number="getContinuousRowNumber(page, pageSize, index)"
          >
            <div class="mb-3 pb-3 border-b border-border flex items-center justify-between">
              <span class="text-xs text-muted-foreground font-mono">
                #{{ getContinuousRowNumber(page, pageSize, index) }}
              </span>
            </div>
            <dl class="m-0 gap-3 grid sm-grid-cols-2">
              <div v-for="column in visibleColumnDefinitions" :key="column.id" class="min-w-0">
                <dt class="text-xs text-muted-foreground mb-1">
                  {{ column.title }}
                </dt>
                <dd class="text-sm m-0 break-words">
                  {{ getMobileValue(row, column, index) }}
                </dd>
              </div>
            </dl>
          </slot>
        </div>

        <div v-if="summaryColumns.length" class="p-4 border-t-2 border-border bg-muted/20">
          <div class="text-xs text-muted-foreground font-semibold mb-3">
            当前页汇总
          </div>
          <div class="gap-4 grid grid-cols-2">
            <div v-for="column in summaryColumns" :key="column.id" class="min-w-0">
              <slot
                :name="`summary-${column.id}`"
                :column="column"
                :label="getSummaryTypeLabel(column.summary!.type)"
                :value="getSummaryValue(column)"
              >
                <span class="text-xs text-muted-foreground">{{ column.title }} · {{ getSummaryTypeLabel(column.summary!.type) }}</span>
                <component
                  :is="getSummaryRenderer(column)"
                  v-if="getSummaryRenderer(column)"
                  v-bind="getSummaryComponentProps(column, getSummaryValue(column))"
                  class="mt-1"
                />
                <strong v-else class="mt-1 block">{{ formatSummaryValue(getSummaryValue(column)) }}</strong>
              </slot>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div v-if="showPagination && totalRows > 0" class="mt-4 max-w-full overflow-x-auto">
      <FaPagination
        v-model:page="paginationPage"
        v-model:size="paginationSize"
        :total="totalRows"
        :sizes="pageSizeOptions"
        :layout="paginationLayout"
        class="min-w-max"
      />
    </div>

    <FaDrawer
      v-model="filterDrawerVisible"
      title="筛选数据"
      side="bottom"
      :footer="false"
      content-class="h-[min(30rem,calc(100dvh-1.5rem))]"
      destroy-on-close
    >
      <FilterPanel
        :definitions="filterDefinitions"
        :values="filterDraft"
        @apply="applyFilters"
        @reset="resetFilters"
        @update="updateFilterDraft"
      />
    </FaDrawer>

    <FaDrawer
      v-model="columnDrawerVisible"
      title="列设置"
      side="bottom"
      :footer="false"
      content-class="h-[min(34rem,calc(100dvh-1.5rem))]"
      destroy-on-close
    >
      <ColumnSettingsPanel
        class="w-full"
        :items="columnSettingItems"
        @reset="resetColumnSettings"
        @update="updateColumnSetting"
      />
    </FaDrawer>
  </section>
</template>
