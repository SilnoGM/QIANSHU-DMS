import type { QsGenericTableActionColumn, QsGenericTableColumn } from '../../src/components/business/QsGenericTable/logic'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line test/no-import-node-test -- 通用表格纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'
import {
  calculateColumnSummary,
  createActionColumn,
  createDefaultColumnSettings,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PAGE_SIZE_OPTIONS,
  getContinuousRowNumber,
  QS_GENERIC_TABLE_ACTION_COLUMN_ID,
  resolveVisibleTableColumns,
} from '../../src/components/business/QsGenericTable/logic'

interface GenericMetricRow {
  id: string
  owner: string
  quantity: number
  status: string
}

const columns: QsGenericTableColumn<GenericMetricRow>[] = [
  {
    id: 'owner',
    accessorKey: 'owner',
    title: '负责人',
    width: 140,
  },
  {
    id: 'status',
    accessorKey: 'status',
    align: 'center',
    defaultVisible: false,
    fixed: 'right',
    title: '状态',
  },
  {
    id: 'quantity',
    accessorKey: 'quantity',
    align: 'right',
    summary: { type: 'sum' },
    title: '数量',
  },
]

const rows: GenericMetricRow[] = [
  { id: 's-1', owner: '林舟', quantity: 120, status: '待处理' },
  { id: 's-2', owner: '陈念', quantity: 180, status: '已完成' },
  { id: 's-3', owner: '周衡', quantity: 300, status: '已完成' },
]

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
}

function countClassAttributesWithTokens(source: string, tokens: readonly string[]): number {
  return [...source.matchAll(/class="([^"]*)"/gu)].filter((match) => {
    const classNames = match[1]?.split(/\s+/u) ?? []
    return tokens.every(token => classNames.includes(token))
  }).length
}

test('通用表格默认使用20条每页并提供四档页容量', () => {
  assert.equal(DEFAULT_PAGE_SIZE, 20)
  assert.deepEqual(DEFAULT_PAGE_SIZE_OPTIONS, [20, 50, 100, 200])
})

test('行号跨分页连续计算且不依赖业务数据主键', () => {
  assert.equal(getContinuousRowNumber(1, 20, 0), 1)
  assert.equal(getContinuousRowNumber(2, 20, 0), 21)
  assert.equal(getContinuousRowNumber(3, 50, 7), 108)
})

test('受控分页事件直接携带本次变更值，不回读尚未同步的 v-model', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )

  assert.match(
    source,
    /page\.value = nextPage\s+emitPaginationChange\(nextPage, pageSize\.value\)/u,
  )
  assert.match(
    source,
    /pageSize\.value = nextPageSize\s+page\.value = 1\s+emitPaginationChange\(1, nextPageSize\)/u,
  )
  assert.match(
    source,
    /function emitPaginationChange\(nextPage: number, nextPageSize: number\)/u,
  )
})

test('受控筛选事件直接携带已应用的草稿值，不回读尚未同步的 v-model', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )

  assert.match(
    source,
    /const nextFilters = \{ \.\.\.filterDraft\.value \}\s+filters\.value = nextFilters/u,
  )
  assert.match(
    source,
    /emit\('filterChange', \{ \.\.\.nextFilters \}\)/u,
  )
})

test('列设置保留默认显隐、左右固定和对齐配置', () => {
  const settings = createDefaultColumnSettings(columns)

  assert.deepEqual(settings, {
    owner: { align: 'left', fixed: undefined, visible: true },
    quantity: { align: 'right', fixed: undefined, visible: true },
    status: { align: 'center', fixed: 'right', visible: false },
  })

  const visibleColumns = resolveVisibleTableColumns(columns, {
    ...settings,
    owner: { align: 'center', fixed: 'left', visible: true },
    status: { align: 'left', fixed: 'right', visible: true },
  })

  assert.deepEqual(visibleColumns.map(column => ({
    align: column.align,
    fixed: column.fixed,
    id: column.id,
    width: column.width,
  })), [
    { align: 'center', fixed: 'left', id: 'owner', width: 140 },
    { align: 'left', fixed: 'right', id: 'status', width: undefined },
    { align: 'right', fixed: undefined, id: 'quantity', width: undefined },
  ])
})

test('操作列默认固定在右侧且不参与隐藏和排序', () => {
  const defaultColumn = createActionColumn<GenericMetricRow>()

  assert.deepEqual({
    align: defaultColumn.align,
    enableHiding: defaultColumn.enableHiding,
    enableSorting: defaultColumn.enableSorting,
    fixed: defaultColumn.fixed,
    header: defaultColumn.header,
    id: defaultColumn.id,
    width: defaultColumn.width,
  }, {
    align: 'left',
    enableHiding: false,
    enableSorting: false,
    fixed: 'right',
    header: '操作',
    id: QS_GENERIC_TABLE_ACTION_COLUMN_ID,
    width: 160,
  })

  const customConfig: QsGenericTableActionColumn = {
    align: 'center',
    fixed: false,
    title: '更多操作',
    width: 208,
  }
  const customColumn = createActionColumn<GenericMetricRow>(customConfig, true)

  assert.deepEqual({
    align: customColumn.align,
    fixed: customColumn.fixed,
    footer: customColumn.footer,
    header: customColumn.header,
    width: customColumn.width,
  }, {
    align: 'center',
    fixed: undefined,
    footer: ' ',
    header: '更多操作',
    width: 208,
  })
})

test('列汇总支持总数、平均值和求和', () => {
  const baseColumn = columns[2]

  assert.equal(calculateColumnSummary(rows, { ...baseColumn, summary: { type: 'count' } }), 3)
  assert.equal(calculateColumnSummary(rows, { ...columns[1], summary: { type: 'count' } }), 3)
  assert.equal(calculateColumnSummary(rows, { ...baseColumn, summary: { type: 'average' } }), 200)
  assert.equal(calculateColumnSummary(rows, { ...baseColumn, summary: { type: 'sum' } }), 600)
})

test('QsGenericTable 组合 FaTable 与 FaPagination 并保持默认行号不参与列隐藏', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'QsGenericTable' \}\)/u)
  assert.match(source, /<FaTable/u)
  assert.match(source, /:sortable="true"/u)
  // 行样式透传：底层 FaTable 支持 rowClass，中间层必须把它放出来，否则业务页无法标记某类行。
  assert.match(source, /rowClass\?: TableProps<TData>\['rowClass'\]/u)
  assert.match(source, /:row-class="rowClass"/u)
  assert.match(source, /<FaPagination/u)
  assert.match(source, /\? 'total, sizes, ->, pager'/u)
  assert.match(source, /<FaPopover/u)
  assert.match(source, /<FaDrawer/u)
  assert.match(source, /QS_GENERIC_TABLE_ROW_NUMBER_COLUMN_ID/u)
  assert.match(source, /enableHiding: false/u)
  assert.match(source, /fixed: 'left'/u)
  assert.match(source, /getContinuousRowNumber/u)
  assert.match(source, /footer-/u)
  assert.match(source, /summary-/u)
  assert.match(source, /mobile-row/u)
  assert.match(source, /20, 50, 100, 200/u)
  assert.doesNotMatch(source, /@\/api|useApp\w*Store/u)
})

test('通用表格允许调用方关闭列设置并在没有工具时移除工具栏占位', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )

  assert.match(source, /showColumnSettings\?: boolean/u)
  assert.match(source, /showColumnSettings: true/u)
  assert.match(source, /const hasToolbar = computed\(/u)
  assert.match(source, /v-if="hasToolbar" class="pb-4 flex flex-wrap gap-3 items-center justify-between"/u)
  assert.match(source, /v-if="showColumnSettings && !isNarrow"/u)
  assert.match(source, /v-else-if="showColumnSettings"/u)
})

test('通用表格通过 query-leading 插槽把领域查询控件放在搜索框前', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )
  const leadingSlotIndex = source.indexOf('<slot name="query-leading"')
  const searchInputIndex = source.indexOf('<FaInput', leadingSlotIndex)

  assert.match(source, /Boolean\(slots\['query-leading'\]\)/u)
  assert.match(source, /data-slot="qs-generic-table-query-leading"/u)
  assert.ok(leadingSlotIndex >= 0, '应声明 query-leading 查询前置插槽')
  assert.ok(searchInputIndex > leadingSlotIndex, '领域查询控件必须位于搜索框前')
  assert.match(
    source,
    /v-if="slots\['query-leading'\]"[\s\S]*?basis-full[\s\S]*?sm-basis-auto/u,
  )
})

test('操作列由 actions 插槽按需启用并在桌面与窄屏复用同一行级作用域', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )

  assert.match(source, /actionColumn\?: QsGenericTableActionColumn/u)
  assert.match(source, /const hasActionColumn = computed\(\(\) => Boolean\(slots\.actions\)\)/u)
  assert.match(source, /createActionColumn<TData>\(props\.actionColumn, hasSummary\.value\)/u)
  assert.match(source, /const actionCellSlotName = `cell-\$\{QS_GENERIC_TABLE_ACTION_COLUMN_ID\}`/u)
  assert.equal(source.match(/<slot\s+name="actions"/gu)?.length, 3)
  assert.match(source, /:row="scope\.row\.original"/u)
  assert.match(source, /:row-number="getTableRowNumber\(scope\.row\)"/u)
  assert.match(source, /data-slot="qs-generic-table-mobile-actions"/u)
})

test('搜索框仅使用 FaInput 的统一清除按钮', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )
  const searchInputMatch = source.match(/<FaInput[\s\S]*?<\/FaInput>/u)

  // type="search" 会让部分浏览器额外绘制原生清除按钮，与 FaInput clearable 重复。
  assert.ok(searchInputMatch)
  assert.match(searchInputMatch[0], /\sclearable(?:\s|>)/u)
  assert.match(searchInputMatch[0], /type="text"/u)
  assert.match(searchInputMatch[0], /enterkeyhint="search"/u)
  assert.doesNotMatch(searchInputMatch[0], /type="search"/u)
})

test('窄屏搜索区独占一行，避免筛选和列设置把输入框压缩为图标', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )

  assert.match(
    source,
    /v-if="searchable" class="flex flex-1 basis-full gap-2 min-w-0 items-center sm-basis-auto"/u,
  )
})

test('筛选下拉不向 Reka Select 传入空字符串选项', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/FilterPanel.vue',
  )

  assert.doesNotMatch(source, /\{ label: '全部', value: '' \}/u)
  assert.match(source, /QS_GENERIC_TABLE_ALL_FILTER_VALUE/u)
})

test('筛选入口使用面板并根据已应用条件呈现按钮状态', () => {
  const tableSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )
  const panelSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/FilterPanel.vue',
  )

  assert.match(tableSource, /const filterButtonLabel = computed/u)
  assert.match(tableSource, /已筛选：多个条件/u)
  assert.match(tableSource, /`已筛选：\$\{activeFilters\.value\[0\]!?\.label\}`/u)
  assert.match(tableSource, /v-model:open="desktopFilterVisible"/u)
  assert.match(tableSource, /:aria-pressed="activeFilters\.length > 0"/u)
  assert.match(tableSource, /border-primary\/40 bg-primary\/8 text-primary/u)
  assert.doesNotMatch(tableSource, /v-if="desktopFilterVisible && !isNarrow"/u)
  assert.match(panelSource, /筛选条件/u)
  assert.match(panelSource, /应用筛选/u)
  assert.match(panelSource, /重置/u)
})

test('窄屏筛选与列设置 Drawer 为可操作控件提供至少 44px 触控目标', () => {
  const tableSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )
  const filterPanelSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/FilterPanel.vue',
  )
  const columnPanelSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/ColumnSettingsPanel.vue',
  )

  // 两个 Teleport Drawer 必须有稳定私有 marker，且只放大各自直接子级的关闭按钮。
  assert.match(tableSource, /content-class="[^"]*qs-generic-table-filter-drawer[^"]*\[&>button\]:size-11[^"]*"/u)
  assert.match(tableSource, /content-class="[^"]*qs-generic-table-column-drawer[^"]*\[&>button\]:size-11[^"]*"/u)

  // FaSelect 和底部操作在窄屏达到 44px，桌面仍恢复既有紧凑高度。
  assert.equal(countClassAttributesWithTokens(filterPanelSource, ['md:min-h-9', 'min-h-11', 'w-full']), 1)
  assert.equal(countClassAttributesWithTokens(filterPanelSource, ['md:min-h-9', 'min-h-11']), 3)

  // 列设置在窄屏改为两列控制组；每个实际按钮至少 44px，桌面继续使用 28px。
  assert.match(columnPanelSource, /grid-cols-2[^"]*md:grid-cols-\[minmax\(0,1fr\)_auto_auto\]/u)
  assert.equal(countClassAttributesWithTokens(columnPanelSource, [
    'flex-1',
    'h-11',
    'md:flex-none',
    'md:min-w-0',
    'md:size-7',
    'min-w-11',
  ]), 6)
  assert.match(columnPanelSource, /label-class="[^"]*min-h-11[^"]*md:min-h-0[^"]*"/u)
  assert.match(columnPanelSource, /class="[^"]*min-h-11[^"]*md:min-h-8[^"]*"[^>]*>\s*恢复默认/u)

  // Select 的选项会再次 Teleport；仅在当前表格或筛选 Drawer 的触发器展开时放大选项。
  assert.match(
    tableSource,
    /:global\(body:has\(\.qs-generic-table \[data-slot="select-trigger"\]\[aria-expanded="true"\]\) \[data-slot="select-content"\] \[role="option"\]\)/u,
  )
  assert.match(
    tableSource,
    /:global\(body:has\(\.qs-generic-table-filter-drawer \[data-slot="select-trigger"\]\[aria-expanded="true"\]\) \[data-slot="select-content"\] \[role="option"\]\)[\s\S]{0,200}min-height: 2\.75rem/u,
  )
})

test('桌面汇总行使用统一背景且自定义汇总组件跟随列对齐', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )

  assert.match(source, /function getSummaryContentClass/u)
  assert.match(source, /justify-items-end text-right/u)
  assert.match(source, /justify-items-center text-center/u)
  assert.match(source, /\[data-slot="table-footer"\]/u)
  assert.match(source, /background-color: oklch\(var\(--background\)\)/u)
})

test('通用表格支持位于数据区域之后且分页之前的可选全宽汇总区域', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )
  const readme = readRelativeSource(
    '../../src/components/business/QsGenericTable/README.md',
  )

  assert.match(source, /const hasFullWidthSummary = computed\(\(\) => Boolean\(slots\.summary\)\)/u)
  assert.match(source, /v-if="hasFullWidthSummary"[\s\S]*?data-slot="qs-generic-table-summary"[\s\S]*?<slot name="summary"\s*\/>/u)

  const summaryStart = source.indexOf('data-slot="qs-generic-table-summary"')
  const paginationStart = source.indexOf('<FaPagination')
  assert.ok(summaryStart >= 0 && paginationStart > summaryStart, '全宽汇总区域必须位于分页之前')

  assert.match(readme, /`summary`：可选全宽汇总/u)
  assert.match(readme, /数据区域之后、分页之前/u)
})

test('通用表格消费全局角色且只由显式业务语义启用结构化数据排版', () => {
  const tableSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )
  const stackedLineSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/QsTableStackedLine.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/GenericTableShowcase.vue',
  )
  const globalStyles = readRelativeSource(
    '../../src/assets/styles/globals.css',
  )
  const logicSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/logic.ts',
  )

  // 全局 bridge 提供低优先级的正文默认值，cellClass 上的显式数据角色必须能够覆盖它。
  assert.match(globalStyles, /:where\(\[data-slot="table"\],\s*\[data-slot="table-cell"\]\)\s*\{/u)
  // 表头需要覆盖 FaTable 自带的 font-medium，因此不能和可覆盖的正文默认值一起降权。
  assert.match(globalStyles, /(?:^|\n)\[data-slot="table-head"\]\s*\{[^}]*font-weight:\s*var\(--qs-type-weight-semibold\)/u)
  assert.match(globalStyles, /(?:^|\n)\[data-slot="table-footer"\]\s*\{/u)
  assert.doesNotMatch(globalStyles, /:where\(\[data-slot="table-(?:head|footer)"\]\)/u)

  // 组件内不得复制全局字号，也不得给全部单元格或右对齐列猜测 numeric / emphasis。
  assert.doesNotMatch(tableSource, /font-family\s*:|--qs-table-(?:header|body|meta)-font-size|--qs-font-data-mono/u)
  assert.doesNotMatch(tableSource, /\[data-slot="table-cell"\][^{]*\{[^}]*font-variant-numeric/u)
  assert.doesNotMatch(tableSource, /\[data-slot="table-cell"\]\.text-right/u)
  assert.doesNotMatch(tableSource, /column\.align\s*===\s*['"]right['"][\s\S]{0,200}qs-type-data/u)

  // 默认表格与移动卡片明确标注正文、行号、字段名、汇总和分页语义。
  assert.match(tableSource, /cellClass:\s*'qs-type-meta tabular-nums'/u)
  assert.match(tableSource, /class="qs-type-meta tabular-nums"/u)
  assert.match(tableSource, /<dt class="qs-type-compact-label mb-1">/u)
  assert.match(tableSource, /<dd class="m-0 break-words" :class="column\.mobileCellClass \?\? 'qs-type-body'">/u)
  assert.match(tableSource, /<span class="qs-type-meta">/u)
  assert.match(tableSource, /<strong v-else class="qs-type-data-emphasis"/u)
  assert.match(tableSource, /\[data-slot="pagination"\][\s\S]*?font-variant-numeric: tabular-nums/u)
  assert.match(stackedLineSource, /class="qs-type-body flex gap-2 min-w-0 items-baseline"/u)
  assert.match(stackedLineSource, /class="qs-type-meta shrink-0"/u)

  // Showcase 只使用现有 cellClass、slot 与展示组件表达真实业务语义。
  for (const [columnId, role] of [
    ['settlementNo', 'qs-type-data-emphasis'],
    ['shipmentCount', 'qs-type-data'],
    ['completionRate', 'qs-type-data'],
    ['amount', 'qs-type-data-emphasis'],
    ['updatedAt', 'qs-type-data'],
  ]) {
    const columnSource = showcaseSource.match(
      new RegExp(`\\{[\\s\\S]*?id: '${columnId}'[\\s\\S]*?\\}`, 'u'),
    )?.[0]
    assert.ok(columnSource, `缺少 ${columnId} 列`)
    assert.match(columnSource, new RegExp(`cellClass: '${role}'`, 'u'))
  }

  assert.match(showcaseSource, /content-class="qs-type-data-emphasis"/u)
  assert.match(showcaseSource, /content-class="qs-type-meta"/u)
  assert.match(showcaseSource, /class="qs-type-status-tag"/u)
  assert.match(showcaseSource, /<DateTimeDisplay\s+:value=/u)
  assert.match(showcaseSource, /<AmountDisplay\s+:value=/u)
  assert.match(showcaseSource, /<dt class="qs-type-compact-label mb-1">/u)
  assert.match(showcaseSource, /<dd class="qs-type-body m-0">/u)
  assert.match(showcaseSource, /<dd class="qs-type-data m-0">/u)
  assert.doesNotMatch(showcaseSource, /font-qs-data-mono|text-\[13px\]/u)
  for (const slotName of ['shipmentCount', 'completionRate']) {
    const numericCellSource = showcaseSource.match(
      new RegExp(`<template #cell-${slotName}[\\s\\S]*?<\\/template>`, 'u'),
    )?.[0]
    assert.ok(numericCellSource)
    assert.doesNotMatch(numericCellSource, /font-medium|tracking-tight|tabular-nums/u)
  }

  // 公共 column 数据结构保持不变，操作按钮继续由 FaButton 的全局 action bridge 接管。
  assert.doesNotMatch(logicSource, /\bsemantic\??\s*:/u)
  assert.match(showcaseSource, /<template #actions=/u)
  assert.match(showcaseSource, /<FaButton[\s\S]*?查看/u)
  assert.match(globalStyles, /\[data-slot="button"\][\s\S]*?font-weight:\s*var\(--qs-type-weight-medium\)/u)
})

test('固定列与普通列共享悬停背景并根据横向滚动位置显示边界层级', () => {
  const tableSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )
  const faTableSource = readRelativeSource(
    '../../../../packages/components/src/basic/table/index.vue',
  )

  // Header、Body 与 Footer 使用同一固定方向和边界标记，业务表格无需依赖列序号猜测边界。
  assert.match(faTableSource, /:data-pinned="header\.column\.getIsPinned\(\) \|\| undefined"/u)
  assert.equal(faTableSource.match(/:data-pinned-edge="getPinnedEdge\(/gu)?.length, 3)
  assert.equal(faTableSource.match(/:data-sorted="\w+\.column\.getIsSorted\(\) \|\| undefined"/gu)?.length, 2)

  assert.match(tableSource, /const hasLeftTableOverflow = ref\(false\)/u)
  assert.match(tableSource, /const hasRightTableOverflow = ref\(false\)/u)
  assert.match(tableSource, /function syncTableOverflowState/u)
  assert.match(tableSource, /@scroll\.capture="handleTableScroll"/u)
  assert.match(tableSource, /:data-has-left-overflow=/u)
  assert.match(tableSource, /:data-has-right-overflow=/u)
  assert.match(tableSource, /useResizeObserver/u)

  // 悬停时显式覆盖所有 td，并把 muted 与 background 混合成不透明颜色，
  // 固定列和排序列不能在 hover 状态重新露出下方滚动内容。
  assert.match(tableSource, /\[data-slot="table-row"\]:hover > \[data-slot="table-cell"\][\s\S]*?background-color: color-mix\(in oklch, oklch\(var\(--muted\)\) 50%, oklch\(var\(--background\)\)\) !important/u)
  assert.match(tableSource, /\[data-pinned\][\s\S]*?box-shadow: none/u)
  // 固定列的默认不透明底色刻意**不带** !important：带了之后行的状态类（rowClass 标黄、
  // 斑马纹）就再也染不到固定列，标黄会断在左固定列上。仍然带 !important 的只有表头
  // 固定列、排序列与悬停态——它们各自代表"始终不透明"和"优先级更高"。
  assert.match(tableSource, /\[data-slot="table-cell"\]\[data-pinned\]\) \{\n {2}background-color: oklch\(var\(--background\)\);\n\}/u)
  assert.doesNotMatch(tableSource, /\[data-slot="table-cell"\]\[data-pinned\]\) \{\n {2}background-color: oklch\(var\(--background\)\) !important/u)
  assert.match(tableSource, /\[data-slot="table-head"\]\[data-pinned\]\) \{\n {2}background-color: oklch\(var\(--muted\)\) !important/u)
  assert.match(tableSource, /\[data-pinned\]\[data-sorted\][\s\S]*?color-mix\(in oklch/u)
  assert.match(tableSource, /:global\(\.dark \.qs-generic-table\)/u)
  // 边界层级由位于滚动内容上方的 24px 渐变遮罩表达，不能再依赖容易被
  // 表格绘制顺序削弱的单元格模糊阴影。
  assert.match(tableSource, /\[data-pinned-edge="left"\]\)::after[\s\S]*?inset-inline-end: -24px[\s\S]*?width: 24px[\s\S]*?linear-gradient\(to right/u)
  assert.match(tableSource, /\[data-pinned-edge="right"\]\)::before[\s\S]*?inset-inline-start: -24px[\s\S]*?width: 24px[\s\S]*?linear-gradient\(to left/u)
  assert.match(tableSource, /pointer-events: none/u)
  assert.match(tableSource, /data-has-left-overflow[\s\S]*?data-pinned-edge="left"[\s\S]*?opacity: 1/u)
  assert.match(tableSource, /data-has-right-overflow[\s\S]*?data-pinned-edge="right"[\s\S]*?opacity: 1/u)
})

test('列设置面板支持动态调整左中右对齐并通过公开状态回传', () => {
  const panelSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/ColumnSettingsPanel.vue',
  )
  const tableSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )

  assert.match(panelSource, /列显示、固定与对齐/u)
  assert.match(panelSource, /对齐方式/u)
  assert.match(panelSource, /\{ align: 'left' \}/u)
  assert.match(panelSource, /\{ align: 'center' \}/u)
  assert.match(panelSource, /\{ align: 'right' \}/u)
  assert.match(tableSource, /align\?: TableAlign/u)
  assert.match(tableSource, /align: columnSettings\.value\[column\.id\]\?\.align/u)
})

test('列设置面板使用紧凑矩阵区分固定与对齐操作', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/ColumnSettingsPanel.vue',
  )

  assert.match(source, /显示列/u)
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)_auto_auto\]/u)
  assert.match(source, /<FaTooltip/u)
  assert.match(source, /i-lucide:panel-left/u)
  assert.match(source, /i-lucide:pin-off/u)
  assert.match(source, /i-lucide:panel-right/u)
  assert.match(source, /i-lucide:align-left/u)
  assert.match(source, /i-lucide:align-center/u)
  assert.match(source, /i-lucide:align-right/u)
  assert.equal(countClassAttributesWithTokens(source, [
    'flex-1',
    'h-11',
    'md:flex-none',
    'md:min-w-0',
    'md:size-7',
    'min-w-11',
  ]), 6)
})

test('列级 copyable 支持按钮与点击文字两种复制反馈', () => {
  const logicSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/logic.ts',
  )
  const tableSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/GenericTableShowcase.vue',
  )

  assert.match(logicSource, /copyable\?: boolean/u)
  assert.match(logicSource, /copyMode\?: 'button' \| 'text'/u)
  assert.match(logicSource, /mobileCellClass\?: string/u)
  assert.match(tableSource, /column\.copyable/u)
  assert.match(tableSource, /column\.mobileCellClass/u)
  assert.match(tableSource, /<CopyCellButton/u)
  assert.match(tableSource, /<QsCopyableText/u)
  assert.match(showcaseSource, /copyable: true/u)

  const buttonSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/CopyCellButton.vue',
  )
  assert.match(buttonSource, /navigator\.clipboard\.writeText/u)
  assert.match(buttonSource, /i-lucide:copy/u)
  assert.match(buttonSource, /i-lucide:check/u)
  assert.match(buttonSource, /i-lucide:triangle-alert/u)
  assert.match(buttonSource, /@click\.stop/u)
  assert.match(buttonSource, /aria-live="polite"/u)

  const textSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/QsCopyableText.vue',
  )
  assert.match(textSource, /navigator\.clipboard\.writeText/u)
  assert.match(textSource, /点击可复制/u)
  assert.match(textSource, /type="button"/u)
  assert.match(textSource, /cursor-pointer/u)
  assert.match(textSource, /\[font:inherit\]/u)
  assert.match(textSource, /@click\.stop/u)
  assert.match(textSource, /aria-live="polite"/u)
  assert.match(textSource, /useQsToast/u)
  assert.match(textSource, /toast\.success/u)
})

test('双行单元格支持主次内容、逐行样式与尾部操作', () => {
  const cellSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/QsTableStackedCell.vue',
  )
  const lineSource = readRelativeSource(
    '../../src/components/business/QsGenericTable/QsTableStackedLine.vue',
  )
  const showcaseSource = readRelativeSource(
    '../../src/views/component_library/business/components/GenericTableShowcase.vue',
  )

  assert.match(cellSource, /name: 'QsTableStackedCell'/u)
  assert.match(cellSource, /data-slot="qs-table-stacked-cell"/u)
  assert.match(cellSource, /inline-grid/u)
  assert.match(cellSource, /gap-0\.5/u)
  assert.doesNotMatch(cellSource, /gap-1(?:\s|")/u)

  assert.match(lineSource, /name: 'QsTableStackedLine'/u)
  assert.match(lineSource, /labelClass\?:/u)
  assert.match(lineSource, /contentClass\?:/u)
  assert.match(lineSource, /suffixClass\?:/u)
  assert.match(lineSource, /type StackedLineTone = 'danger' \| 'default' \| 'muted' \| 'success' \| 'warning'/u)
  assert.match(lineSource, /tone\?: StackedLineTone/u)
  assert.match(lineSource, /type StackedLineWeight = 'medium' \| 'normal' \| 'semibold'/u)
  assert.match(lineSource, /weight\?: StackedLineWeight/u)
  assert.match(lineSource, /slots\.suffix/u)
  assert.match(lineSource, /data-slot="qs-table-stacked-line-suffix"[\s\S]*?class="[^"]*h-5/u)

  assert.match(showcaseSource, /orderSource:/u)
  assert.match(showcaseSource, /standardAmount:/u)
  assert.match(showcaseSource, /<QsTableStackedCell/u)
  assert.match(showcaseSource, /<QsTableStackedLine/u)
  assert.match(showcaseSource, /#suffix/u)
  assert.match(showcaseSource, /label="实际"/u)
  assert.match(showcaseSource, /label="标准"/u)

  const amountCellSource = showcaseSource.match(
    /<template #cell-amount[\s\S]*?<\/template>/u,
  )?.[0]
  assert.ok(amountCellSource)
  assert.equal(amountCellSource.match(/<AmountDisplay\b/gu)?.length, 2)
  // 金额语义由 AmountDisplay 自身负责，复合行不得再覆盖其 500 字重。
  assert.doesNotMatch(
    amountCellSource,
    /weight="(?:medium|semibold)"|content-class="text-(?:xs|sm) tabular-nums"/u,
  )
})
