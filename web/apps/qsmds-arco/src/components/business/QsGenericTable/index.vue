<script setup lang="ts" generic="TData extends object = Record<string, unknown>">
import type {
  TableAlign,
  TableCellSlotProps,
  TableColumn,
  TableColumnFixed,
  TableExpandedState,
  TableGroupHeaderSlotProps,
  TableHeaderSlotProps,
  TableProps,
  TableSortingState,
} from '@fantastic-admin/components'
import type { Component } from 'vue'
import type { QsGenericTableGrouping } from './grouping'

import type { QsGenericTableActionColumn, QsGenericTableColumn, QsGenericTableColumnSettingItem, QsGenericTableColumnSettings, QsGenericTableFilterDefinition, QsGenericTableFilterValue, QsGenericTableFilterValues, QsGenericTableSummaryValue } from './logic'
import { useMediaQuery, useResizeObserver } from '@vueuse/core'
import ColumnSettingsPanel from './ColumnSettingsPanel.vue'
import CopyCellButton from './CopyCellButton.vue'
import FilterPanel from './FilterPanel.vue'
import GroupedMobileRows from './GroupedMobileRows.vue'
import GroupHeader from './GroupHeader.vue'
import { buildTableGroups, getGroupedRowId, getTableGroupId, isTableGroupExpanded, resolveGroupedRowKey, toggleTableGroup } from './grouping'
import {
  calculateColumnSummary,
  createActionColumn,
  createDefaultColumnSettings,
  DEFAULT_PAGE_SIZE,
  formatSummaryValue,
  getColumnRawValue,
  getContinuousRowNumber,
  getSummaryComponentProps,
  getSummaryTypeLabel,
  QS_GENERIC_TABLE_ACTION_COLUMN_ID,
  QS_GENERIC_TABLE_ROW_NUMBER_COLUMN_ID,
  reconcileColumnSettings,
  resolveVisibleTableColumns,
} from './logic'

defineOptions({ name: 'QsGenericTable' })

const props = withDefaults(defineProps<{
  actionColumn?: QsGenericTableActionColumn
  addLabel?: string
  addable?: boolean
  border?: boolean
  columns: QsGenericTableColumn<TData>[]
  data: TData[]
  emptyDescription?: string
  emptyTitle?: string
  error?: string
  filterDefinitions?: QsGenericTableFilterDefinition[]
  grouping?: QsGenericTableGrouping<TData>
  loading?: boolean
  paginationUnit?: string
  pageSizeOptions?: number[]
  rowKey?: TableProps<TData>['rowKey']
  searchable?: boolean
  searchPlaceholder?: string
  showColumnSettings?: boolean
  showPagination?: boolean
  showRowNumber?: boolean
  stripe?: boolean
  summaryValues?: Record<string, QsGenericTableSummaryValue>
  tableClass?: string
  total?: number
}>(), {
  actionColumn: () => ({}),
  addLabel: '新增数据',
  addable: true,
  border: false,
  emptyDescription: '当前没有可展示的数据。',
  emptyTitle: '暂无数据',
  error: undefined,
  filterDefinitions: () => [],
  grouping: undefined,
  loading: false,
  paginationUnit: undefined,
  pageSizeOptions: () => [20, 50, 100, 200],
  rowKey: undefined,
  searchable: true,
  searchPlaceholder: '搜索当前业务数据',
  showColumnSettings: true,
  showPagination: true,
  showRowNumber: true,
  stripe: false,
  summaryValues: () => ({}),
  tableClass: undefined,
  total: undefined,
})

const emit = defineEmits<{
  add: []
  columnSettingsChange: [settings: QsGenericTableColumnSettings]
  filterChange: [filters: QsGenericTableFilterValues]
  expandedChange: [expanded: TableExpandedState]
  paginationChange: [pagination: { page: number, pageSize: number }]
  retry: []
  search: [keyword: string]
  sortingChange: [sorting: TableSortingState]
}>()

const slots = defineSlots<{
  'actions'?: (props: { row: TData, index: number, rowNumber: number, group?: TData, groupIndex?: number, groupKey?: string }) => any
  'mobile-row'?: (props: { row: TData, index: number, rowNumber: number, columns: QsGenericTableColumn<TData>[], group?: TData, groupIndex?: number, groupKey?: string }) => any
  'group-header'?: (props: { row: TData, rows: TData[], groupKey: string, index: number, rowNumber: number, expanded: boolean }) => any
  'query-leading'?: () => any
  'summary'?: () => any
  [name: `cell-${string}`]: ((props: TableCellSlotProps<TData, any>) => any) | undefined
  [name: `header-${string}`]: ((props: TableHeaderSlotProps<TData, any>) => any) | undefined
  [name: `summary-${string}`]: ((props: { column: QsGenericTableColumn<TData>, label: string, value: QsGenericTableSummaryValue }) => any) | undefined
}>()
const page = defineModel<number>('page', { default: 1 })
const pageSize = defineModel<number>('pageSize', { default: DEFAULT_PAGE_SIZE })
const search = defineModel<string>('search', { default: '' })
const filters = defineModel<QsGenericTableFilterValues>('filters', { default: () => ({}) })
const sorting = defineModel<TableSortingState>('sorting', { default: () => [] })
const expanded = defineModel<TableExpandedState>('expanded', { default: true })
const { t: groupT } = useI18n({
  useScope: 'local',
  messages: { 'zh-cn': { rowUnit: '条', groupUnit: '组', total: '共 {count} {unit}', size: '{count} {unit}/页', before: '前往', after: '页' } },
})

const groups = computed(() => props.grouping ? buildTableGroups(props.data, props.grouping, props.rowKey) : [])
const groupByKey = computed(() => new Map(groups.value.map(group => [group.key, group])))
const groupByTableId = computed(() => new Map(groups.value.map(group => [getTableGroupId(group.key), group])))
const groupByRow = computed(() => new Map(groups.value.map(group => [group.row, group])))
const summaryRows = computed(() => props.grouping ? groups.value.flatMap(group => group.rows) : props.data)
const groupedSubRows: NonNullable<TableProps<TData>['getSubRows']> = row => groupByRow.value.get(row)?.rows
const groupedRowId: NonNullable<TableProps<TData>['getRowId']> = (row, index, parent) => {
  const key = resolveGroupedRowKey(row, index, props.rowKey)
  return parent ? getGroupedRowId(parent.id, key) : getTableGroupId(key)
}
// 内核行 ID 隔离父子命名空间；公开展开状态仍以调用方的业务组键管理。
const tableExpanded = computed<TableExpandedState>(() => expanded.value === true ? true : Object.fromEntries(groups.value.map(group => [getTableGroupId(group.key), isTableGroupExpanded(expanded.value, group.key)])))
const isGroupRow = (row: TableGroupHeaderSlotProps<TData>['row']) => row.depth === 0
const paginationTextTemplates = computed(() => {
  const unit = props.paginationUnit ?? groupT(props.grouping ? 'groupUnit' : 'rowUnit')
  return {
    total: (count: number) => groupT('total', { count, unit }),
    sizes: (count: number) => groupT('size', { count, unit }),
    jumper: { before: groupT('before'), after: groupT('after') },
  }
})

function updateExpanded(next: TableExpandedState) {
  expanded.value = next
  emit('expandedChange', next)
}

function toggleGroup(key: string) {
  updateExpanded(toggleTableGroup(expanded.value, key, groups.value.map(group => group.key)))
}

function updateTableExpanded(next: TableExpandedState) {
  updateExpanded(next === true
    ? true
    : {
        ...(expanded.value === true ? {} : expanded.value),
        ...Object.fromEntries(groups.value.map(group => [group.key, isTableGroupExpanded(next, getTableGroupId(group.key))])),
      })
}

function getGroupScope(key: string) {
  const group = groupByKey.value.get(key)!
  return { row: group.row, rows: group.rows, groupKey: key, index: group.index, rowNumber: getContinuousRowNumber(page.value, pageSize.value, group.index), expanded: isTableGroupExpanded(expanded.value, key) }
}

function getRowGroupScope(row: TableGroupHeaderSlotProps<TData>['row']) {
  const group = row.parentId === undefined ? undefined : groupByTableId.value.get(row.parentId)
  return { group: group?.row, groupIndex: group?.index, groupKey: group?.key }
}

function getTableRowNumber(row: TableGroupHeaderSlotProps<TData>['row']) {
  return getContinuousRowNumber(page.value, pageSize.value, getRowGroupScope(row).groupIndex ?? row.index)
}

const TABLE_SCROLL_EDGE_TOLERANCE = 1

const actionCellSlotName = `cell-${QS_GENERIC_TABLE_ACTION_COLUMN_ID}`
const isNarrow = useMediaQuery('(max-width: 767px)')
const desktopTableRoot = ref<HTMLElement>()
const hasLeftTableOverflow = ref(false)
const hasRightTableOverflow = ref(false)
const searchDraft = ref(search.value)
const filterDraft = ref<QsGenericTableFilterValues>({ ...filters.value })
const desktopFilterVisible = ref(false)
const filterDrawerVisible = ref(false)
const columnDrawerVisible = ref(false)
const columnSettings = ref<QsGenericTableColumnSettings>(
  createDefaultColumnSettings(props.columns),
)

const totalRows = computed(() => props.total ?? props.data.length)
// 系统页面可能复用已有页头查询与操作区；所有工具都关闭时不保留空白占位。
const hasToolbar = computed(() =>
  Boolean(slots['query-leading'])
  || props.searchable
  || props.filterDefinitions.length > 0
  || props.showColumnSettings
  || props.addable)
const paginationLayout = computed(() => isNarrow.value
  ? 'total, sizes, ->, pager'
  : 'total, sizes, ->, pager, jumper')

const columnSettingItems = computed<QsGenericTableColumnSettingItem[]>(() => props.columns.map(column => ({
  align: columnSettings.value[column.id]?.align ?? column.align ?? 'left',
  fixed: columnSettings.value[column.id]?.fixed,
  id: column.id,
  title: column.title,
  visible: columnSettings.value[column.id]?.visible ?? true,
})))

const visibleBusinessColumns = computed(() => resolveVisibleTableColumns(
  props.columns,
  columnSettings.value,
))

const visibleColumnDefinitions = computed(() => props.columns.flatMap((column) => {
  if (columnSettings.value[column.id]?.visible === false) {
    return []
  }

  return [{
    ...column,
    align: columnSettings.value[column.id]?.align ?? column.align ?? 'left',
  }]
}))

const summaryColumns = computed(() => visibleColumnDefinitions.value.filter(column => column.summary))
const hasSummary = computed(() => summaryColumns.value.length > 0)
// 全宽汇总只提供稳定的“数据后、分页前”位置，内容与业务语义仍由调用页面负责。
const hasFullWidthSummary = computed(() => Boolean(slots.summary))
const hasActionColumn = computed(() => Boolean(slots.actions))
const slottedCellColumns = computed(() => visibleColumnDefinitions.value.filter(column =>
  column.copyable || Boolean(slots[`cell-${column.id}`])))
const slottedHeaderColumns = computed(() => visibleColumnDefinitions.value.filter(column =>
  Boolean(slots[`header-${column.id}`])))

const tableColumns = computed<TableColumn<TData, any>[]>(() => {
  const rowNumberColumn: TableColumn<TData, number> = {
    id: QS_GENERIC_TABLE_ROW_NUMBER_COLUMN_ID,
    header: '#',
    footer: hasSummary.value ? '汇总' : undefined,
    cell: ({ row }) => `#${getContinuousRowNumber(page.value, pageSize.value, row.index)}`,
    cellClass: 'qs-type-meta tabular-nums',
    enableHiding: false,
    enableSorting: false,
    fixed: 'left',
    maxWidth: 64,
    minWidth: 56,
    width: 56,
  }

  return [
    ...(props.showRowNumber && !props.grouping ? [rowNumberColumn] : []),
    ...visibleBusinessColumns.value.map(column => ({
      ...column,
      // FaTable 只有发现 footer 声明或 footer-* 插槽时才生成表尾。
      footer: getSourceColumn(column.id)?.summary ? ' ' : column.footer,
    })),
    ...(hasActionColumn.value
      ? [createActionColumn<TData>(props.actionColumn, hasSummary.value)]
      : []),
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
// 筛选入口只反映已经提交的条件，面板中的草稿变化不会提前改变按钮状态。
const filterButtonLabel = computed(() => {
  if (activeFilters.value.length === 0) {
    return '筛选'
  }
  if (activeFilters.value.length === 1) {
    return `已筛选：${activeFilters.value[0]!.label}`
  }
  return '已筛选：多个条件'
})
const hasActiveQuery = computed(() => Boolean(search.value.trim()) || activeFilters.value.length > 0)

const paginationPage = computed({
  get: () => page.value,
  set: (nextPage: number) => {
    if (nextPage === page.value) {
      return
    }
    page.value = nextPage
    emitPaginationChange(nextPage, pageSize.value)
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
    emitPaginationChange(1, nextPageSize)
  },
})

/**
 * 受控 defineModel 只会先发出 update 事件，父组件的新 prop 要到后续更新周期才会
 * 回流。分页事件必须直接使用本次 setter 的值，不能立即回读仍可能是旧值的 model。
 */
function emitPaginationChange(nextPage: number, nextPageSize: number) {
  emit('paginationChange', {
    page: nextPage,
    pageSize: nextPageSize,
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
}

function updateFilterDraft(key: string, value: QsGenericTableFilterValue) {
  filterDraft.value = {
    ...filterDraft.value,
    [key]: value,
  }
}

function applyFilters() {
  // 与分页相同，事件负载必须使用本次提交值，不能回读尚未由父组件同步的 model。
  const nextFilters = { ...filterDraft.value }
  filters.value = nextFilters
  resetPage()
  desktopFilterVisible.value = false
  filterDrawerVisible.value = false
  emit('filterChange', { ...nextFilters })
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

function updateColumnSetting(id: string, patch: { align?: TableAlign, fixed?: TableColumnFixed, visible?: boolean }) {
  const current = columnSettings.value[id]
  if (!current) {
    return
  }

  columnSettings.value = {
    ...columnSettings.value,
    [id]: {
      align: patch.align ?? current.align,
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
  return calculateColumnSummary(summaryRows.value, column)
}

function getSummaryRenderer(column: QsGenericTableColumn<TData>): Component | undefined {
  return column.summary?.component
}

function getSummaryContentClass(column: QsGenericTableColumn<TData>) {
  return [
    'gap-0.5 grid',
    // Grid 会把自定义组件拉伸到整列宽度；显式设置 justify-items，才能让
    // AmountDisplay 等 inline-flex 组件与标题、表头共享同一条对齐边界。
    column.align === 'right' && 'justify-items-end text-right',
    column.align === 'center' && 'justify-items-center text-center',
  ]
}

function getMobileValue(row: TData, column: QsGenericTableColumn<TData>, index: number) {
  const value = getColumnRawValue(row, column, index)
  return value === undefined || value === null || value === '' ? '—' : String(value)
}

function getCopyCellClass(column: QsGenericTableColumn<TData>) {
  return [
    'group min-w-0 flex gap-1 items-center',
    column.align === 'right' && 'justify-end',
    column.align === 'center' && 'justify-center',
  ]
}

function getActionContentClass() {
  return [
    'min-w-0 flex flex-wrap gap-1 items-center',
    props.actionColumn.align === 'center' && 'justify-center',
    props.actionColumn.align === 'right' && 'justify-end',
  ]
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

function getTableScrollContainer() {
  return desktopTableRoot.value?.querySelector<HTMLElement>('[data-slot="table-container"]')
}

/**
 * 固定列阴影只表达“还有内容被固定列覆盖”的状态：离开左边界后显示左阴影，
 * 尚未到达右边界时显示右阴影。1px 容差用于吸收缩放和子像素滚动误差。
 */
function syncTableOverflowState(container = getTableScrollContainer()) {
  if (!container) {
    hasLeftTableOverflow.value = false
    hasRightTableOverflow.value = false
    return
  }

  const maxScrollLeft = Math.max(container.scrollWidth - container.clientWidth, 0)
  const normalizedScrollLeft = Math.min(Math.max(container.scrollLeft, 0), maxScrollLeft)
  hasLeftTableOverflow.value = normalizedScrollLeft > TABLE_SCROLL_EDGE_TOLERANCE
  hasRightTableOverflow.value = maxScrollLeft - normalizedScrollLeft > TABLE_SCROLL_EDGE_TOLERANCE
}

function handleTableScroll(event: Event) {
  const target = event.target
  if (target instanceof HTMLElement && target.dataset.slot === 'table-container') {
    syncTableOverflowState(target)
  }
}

useResizeObserver(desktopTableRoot, () => syncTableOverflowState())

onMounted(() => {
  nextTick(syncTableOverflowState)
})

watch(() => props.columns, (nextColumns) => {
  columnSettings.value = reconcileColumnSettings(nextColumns, columnSettings.value)
}, { deep: true })

watch(search, (nextSearch) => {
  searchDraft.value = nextSearch
})

watch(filters, (nextFilters) => {
  filterDraft.value = { ...nextFilters }
}, { deep: true })

// 分页与查询加载的是新的整组数据，恢复默认展开；同页更新或排序保留稳定组 ID 的折叠状态。
watch([page, pageSize, search, filters], () => {
  if (props.grouping) {
    updateExpanded(true)
  }
}, { deep: true })

watch([tableColumns, isNarrow], () => {
  nextTick(syncTableOverflowState)
}, { flush: 'post' })
</script>

<template>
  <section class="qs-generic-table qs-type-body min-w-0" aria-label="业务通用表格">
    <div v-if="hasToolbar" class="pb-4 flex flex-wrap gap-3 items-center justify-between">
      <div
        v-if="slots['query-leading'] || searchable"
        class="flex flex-1 basis-full flex-wrap gap-3 min-w-0 items-center sm-basis-auto"
      >
        <div
          v-if="slots['query-leading']"
          data-slot="qs-generic-table-query-leading"
          class="basis-full max-w-full sm-basis-auto"
        >
          <slot name="query-leading" />
        </div>

        <div v-if="searchable" class="flex flex-1 basis-full gap-2 min-w-0 items-center sm-basis-auto">
          <!-- FaInput 已提供统一的 clearable 按钮，使用 text 可避免浏览器为 search 再渲染原生清除控件。 -->
          <FaInput
            v-model="searchDraft"
            type="text"
            clearable
            class="w-full sm-max-w-80"
            enterkeyhint="search"
            inputmode="search"
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
      </div>

      <div class="ms-auto flex flex-wrap gap-2 items-center">
        <FaPopover
          v-if="filterDefinitions.length && !isNarrow"
          v-model:open="desktopFilterVisible"
          align="end"
          class="p-0"
        >
          <FaButton
            variant="outline"
            :class="activeFilters.length ? 'border-primary/40 bg-primary/8 text-primary hover-bg-primary/12' : undefined"
            :aria-expanded="desktopFilterVisible"
            :aria-pressed="activeFilters.length > 0"
            @click="openFilters"
          >
            <FaIcon name="i-lucide:list-filter" />
            {{ filterButtonLabel }}
          </FaButton>
          <template #panel>
            <FilterPanel
              :definitions="filterDefinitions"
              :values="filterDraft"
              @apply="applyFilters"
              @reset="resetFilters"
              @update="updateFilterDraft"
            />
          </template>
        </FaPopover>
        <FaButton
          v-else-if="filterDefinitions.length"
          variant="outline"
          :class="activeFilters.length ? 'border-primary/40 bg-primary/8 text-primary hover-bg-primary/12' : undefined"
          :aria-expanded="filterDrawerVisible"
          :aria-pressed="activeFilters.length > 0"
          @click="openFilters"
        >
          <FaIcon name="i-lucide:list-filter" />
          {{ filterButtonLabel }}
        </FaButton>

        <FaPopover v-if="showColumnSettings && !isNarrow" align="end" class="p-4">
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
        <FaButton v-else-if="showColumnSettings" variant="outline" @click="columnDrawerVisible = true">
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
      <span class="qs-type-meta">已应用</span>
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

    <div
      v-if="!isNarrow"
      ref="desktopTableRoot"
      class="relative"
      :aria-busy="loading"
      :data-has-left-overflow="hasLeftTableOverflow ? '' : undefined"
      :data-has-right-overflow="hasRightTableOverflow ? '' : undefined"
      @scroll.capture="handleTableScroll"
    >
      <FaTable
        :border="border"
        :columns="tableColumns"
        :data="data"
        :row-key="rowKey"
        :tree="Boolean(grouping)"
        :group-row="grouping ? isGroupRow : undefined"
        :get-sub-rows="grouping ? groupedSubRows : undefined"
        :get-row-id="grouping ? groupedRowId : undefined"
        :expanded="grouping ? tableExpanded : undefined"
        :sortable="true"
        :sorting="sorting"
        :stripe="stripe"
        :table-class="tableClass"
        table-root-class="overflow-x-auto"
        :class="loading && data.length ? 'pointer-events-none opacity-60' : undefined"
        @sorting-change="handleSortingChange"
        @expanded-change="updateTableExpanded"
      >
        <template v-if="grouping" #group-header="scope">
          <GroupHeader
            :label="groupByTableId.get(scope.row.id)!.label" :expanded="scope.expanded" :disabled="loading"
            @toggle="toggleGroup(groupByTableId.get(scope.row.id)!.key)"
          >
            <slot name="group-header" v-bind="getGroupScope(groupByTableId.get(scope.row.id)!.key)">
              {{ groupByTableId.get(scope.row.id)!.label }}
            </slot>
          </GroupHeader>
        </template>
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
          <div v-if="column.copyable" :class="getCopyCellClass(column)">
            <div class="min-w-0">
              <slot :name="`cell-${column.id}`" v-bind="scope">
                {{ getMobileValue(scope.row.original, column, scope.row.index) }}
              </slot>
            </div>
            <CopyCellButton
              :label="column.title"
              :text="getMobileValue(scope.row.original, column, scope.row.index)"
            />
          </div>
          <slot v-else :name="`cell-${column.id}`" v-bind="scope" />
        </template>

        <template v-if="hasActionColumn" #[actionCellSlotName]="scope">
          <div
            :class="getActionContentClass()"
            :aria-label="`第 ${getTableRowNumber(scope.row)} 行操作`"
          >
            <slot
              name="actions"
              :index="scope.row.index"
              :row="scope.row.original"
              :row-number="getTableRowNumber(scope.row)"
              v-bind="getRowGroupScope(scope.row)"
            />
          </div>
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
            <div :class="getSummaryContentClass(column)">
              <span class="qs-type-meta">
                {{ getSummaryTypeLabel(column.summary!.type) }}
              </span>
              <component
                :is="getSummaryRenderer(column)"
                v-if="getSummaryRenderer(column)"
                v-bind="getSummaryComponentProps(column, getSummaryValue(column))"
              />
              <strong v-else class="qs-type-data-emphasis">
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
        <GroupedMobileRows
          v-if="grouping" :groups="groups" :columns="visibleColumnDefinitions" :expanded="expanded"
          :loading="loading" :row-key="rowKey" :page="page" :page-size="pageSize"
          :action-column="actionColumn" :has-actions="hasActionColumn" @toggle="toggleGroup"
        >
          <template v-if="slots['group-header']" #group-header="scope">
            <slot name="group-header" v-bind="scope" />
          </template>
          <template v-if="slots['mobile-row']" #mobile-row="scope">
            <slot name="mobile-row" v-bind="scope" />
          </template>
          <template v-if="hasActionColumn" #actions="scope">
            <slot name="actions" v-bind="scope" />
          </template>
        </GroupedMobileRows>
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
              :group="undefined"
              :group-index="undefined"
              :group-key="undefined"
            >
              <div v-if="showRowNumber" class="mb-3 pb-3 border-b border-border flex items-center justify-between">
                <span class="qs-type-meta tabular-nums">
                  #{{ getContinuousRowNumber(page, pageSize, index) }}
                </span>
              </div>
              <dl class="m-0 gap-3 grid sm-grid-cols-2">
                <div v-for="column in visibleColumnDefinitions" :key="column.id" class="min-w-0">
                  <dt class="qs-type-compact-label mb-1">
                    {{ column.title }}
                  </dt>
                  <dd class="qs-type-body m-0 break-words">
                    <div :class="getCopyCellClass(column)">
                      <span>{{ getMobileValue(row, column, index) }}</span>
                      <CopyCellButton
                        v-if="column.copyable"
                        always-visible
                        :label="column.title"
                        :text="getMobileValue(row, column, index)"
                      />
                    </div>
                  </dd>
                </div>
              </dl>
            </slot>
            <div
              v-if="hasActionColumn"
              data-slot="qs-generic-table-mobile-actions"
              class="mt-3 pt-3 border-t border-border"
              :aria-label="`第 ${getContinuousRowNumber(page, pageSize, index)} 行操作`"
            >
              <div :class="getActionContentClass()">
                <slot
                  name="actions"
                  :index="index"
                  :row="row"
                  :row-number="getContinuousRowNumber(page, pageSize, index)"
                  :group="undefined"
                  :group-index="undefined"
                  :group-key="undefined"
                />
              </div>
            </div>
          </div>
        </template>

        <div v-if="summaryColumns.length" class="p-4 border-t-2 border-border bg-muted/20">
          <div class="qs-type-compact-title mb-3">
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
                <span class="qs-type-meta">{{ column.title }} · {{ getSummaryTypeLabel(column.summary!.type) }}</span>
                <component
                  :is="getSummaryRenderer(column)"
                  v-if="getSummaryRenderer(column)"
                  v-bind="getSummaryComponentProps(column, getSummaryValue(column))"
                  class="mt-1"
                />
                <strong v-else class="qs-type-data-emphasis mt-1 block">{{ formatSummaryValue(getSummaryValue(column)) }}</strong>
              </slot>
            </div>
          </div>
        </div>
      </template>
    </div>

    <div
      v-if="hasFullWidthSummary"
      data-slot="qs-generic-table-summary"
      class="mt-4 min-w-0"
    >
      <slot name="summary" />
    </div>

    <div v-if="showPagination && totalRows > 0" class="mt-4 max-w-full overflow-x-auto">
      <FaPagination
        v-model:page="paginationPage"
        v-model:size="paginationSize"
        :total="totalRows"
        :sizes="pageSizeOptions"
        :layout="paginationLayout"
        :text-templates="paginationTextTemplates"
        class="min-w-max"
      />
    </div>

    <FaDrawer
      v-model="filterDrawerVisible"
      title="筛选数据"
      side="bottom"
      :footer="false"
      content-class="qs-generic-table-filter-drawer h-[min(30rem,calc(100dvh-1.5rem))] [&>button]:size-11 [&>button]:inline-flex [&>button]:items-center [&>button]:justify-center"
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
      v-if="showColumnSettings"
      v-model="columnDrawerVisible"
      title="列设置"
      side="bottom"
      :footer="false"
      content-class="qs-generic-table-column-drawer h-[min(34rem,calc(100dvh-1.5rem))] [&>button]:size-11 [&>button]:inline-flex [&>button]:items-center [&>button]:justify-center"
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

<style scoped>
/*
 * 通用表格只保留固定列与交互表面的局部视觉规则。表头、正文和辅助信息均消费
 * 全局排版角色，业务数据语义由 cellClass、slot 或领域展示组件显式声明。
 */
.qs-generic-table {
  --qs-table-pinned-overlay-start: oklch(24% 0.012 285deg / 8%);
  --qs-table-pinned-overlay-middle: oklch(24% 0.012 285deg / 2%);
  --qs-table-pinned-overlay-end: oklch(24% 0.012 285deg / 0%);
}

:global(.dark .qs-generic-table) {
  --qs-table-pinned-overlay-start: oklch(4% 0.01 285deg / 28%);
  --qs-table-pinned-overlay-middle: oklch(4% 0.01 285deg / 8%);
  --qs-table-pinned-overlay-end: oklch(4% 0.01 285deg / 0%);
}

.qs-generic-table :deep([data-slot="table-head"]) {
  padding-inline: 0.75rem;
}

.qs-generic-table :deep([data-slot="table-cell"]) {
  padding: 0.5rem 0.75rem;
}

/*
 * 取消 FaTable 默认常驻阴影，再根据滚动方向只抬高实际覆盖内容的固定边界。
 * 边界线负责定位，位于滚动内容上方的渐变遮罩负责表达固定区域的纵深。
 */
.qs-generic-table :deep([data-pinned]) {
  box-shadow: none;
  transition: background-color 150ms ease-out, box-shadow 180ms cubic-bezier(0.25, 1, 0.5, 1);
}

/* 固定列始终使用不透明底色，避免排序色的透明度让滚动内容穿透。 */
.qs-generic-table :deep([data-slot="table-head"][data-pinned]) {
  background-color: oklch(var(--muted)) !important;
}

.qs-generic-table :deep([data-slot="table-body"] [data-slot="table-cell"][data-pinned]) {
  background-color: oklch(var(--background)) !important;
}

.qs-generic-table :deep([data-slot="table-head"][data-pinned][data-sorted]) {
  background-color: color-mix(in oklch, oklch(var(--primary)) 20%, oklch(var(--background))) !important;
}

.qs-generic-table :deep([data-slot="table-body"] [data-slot="table-cell"][data-pinned][data-sorted]) {
  background-color: color-mix(in oklch, oklch(var(--primary)) 10%, oklch(var(--background))) !important;
}

/*
 * FaTable 的普通列通过 tr 透出 hover 背景，固定列则拥有不透明背景。这里把
 * muted 与 background 混合为同等观感的不透明颜色，并统一写入所有 td；这样
 * 既覆盖排序列的 !bg-*，也避免固定列悬停时再次露出下方滚动内容。
 */
.qs-generic-table :deep([data-slot="table-body"] [data-slot="table-row"]:hover > [data-slot="table-cell"]) {
  background-color: color-mix(in oklch, oklch(var(--muted)) 50%, oklch(var(--background))) !important;
}

.qs-generic-table :deep([data-pinned-edge="left"])::after {
  position: absolute;
  inset-block: 0;
  inset-inline-end: -24px;
  z-index: 2;
  width: 24px;
  pointer-events: none;
  content: "";
  background: linear-gradient(to right, var(--qs-table-pinned-overlay-start) 0%, var(--qs-table-pinned-overlay-middle) 42%, var(--qs-table-pinned-overlay-end) 100%);
  opacity: 0;
  transition: opacity 180ms cubic-bezier(0.25, 1, 0.5, 1);
}

.qs-generic-table :deep([data-pinned-edge="right"])::before {
  position: absolute;
  inset-block: 0;
  inset-inline-start: -24px;
  z-index: 2;
  width: 24px;
  pointer-events: none;
  content: "";
  background: linear-gradient(to left, var(--qs-table-pinned-overlay-start) 0%, var(--qs-table-pinned-overlay-middle) 42%, var(--qs-table-pinned-overlay-end) 100%);
  opacity: 0;
  transition: opacity 180ms cubic-bezier(0.25, 1, 0.5, 1);
}

.qs-generic-table [data-has-left-overflow] :deep([data-pinned-edge="left"]) {
  box-shadow: 1px 0 0 oklch(var(--border));
}

.qs-generic-table [data-has-left-overflow] :deep([data-pinned-edge="left"])::after {
  opacity: 1;
}

.qs-generic-table [data-has-right-overflow] :deep([data-pinned-edge="right"]) {
  box-shadow: -1px 0 0 oklch(var(--border));
}

.qs-generic-table [data-has-right-overflow] :deep([data-pinned-edge="right"])::before {
  opacity: 1;
}

/*
 * 固定列由 FaTable 使用独立背景避免滚动内容透出。桌面汇总行统一覆盖为主题
 * background，消除固定列与普通列分别使用 background / muted 的色差。
 */
.qs-generic-table :deep([data-slot="table-footer"]),
.qs-generic-table :deep([data-slot="table-footer"] [data-slot="table-cell"]) {
  background-color: oklch(var(--background));
}

.qs-generic-table :deep([data-slot="pagination"]) {
  font-feature-settings: "tnum" 1;
  font-variant-numeric: tabular-nums;
}

@media (width <= 767px) {
  /*
   * Reka Select 会把选项列表再次 Teleport 到 body，无法通过表格或 Drawer 的
   * 后代选择器命中。仅当本表格或其筛选 Drawer 中的 trigger 正在展开时放大
   * 当前 Select 选项，避免影响页面上不属于 QsGenericTable 的其他下拉列表。
   */
  :global(body:has(.qs-generic-table [data-slot="select-trigger"][aria-expanded="true"]) [data-slot="select-content"] [role="option"]),
  :global(body:has(.qs-generic-table-filter-drawer [data-slot="select-trigger"][aria-expanded="true"]) [data-slot="select-content"] [role="option"]) {
    min-height: 2.75rem;
  }
}
</style>
