import type { QsGenericTableColumn } from '../../src/components/business/QsGenericTable/logic'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// eslint-disable-next-line test/no-import-node-test -- 通用表格纯逻辑与源码契约使用 Node.js 内置 runner。
import test from 'node:test'
import {
  calculateColumnSummary,
  createDefaultColumnSettings,
  DEFAULT_PAGE_SIZE,
  DEFAULT_PAGE_SIZE_OPTIONS,
  getContinuousRowNumber,
  resolveVisibleTableColumns,
} from '../../src/components/business/QsGenericTable/logic'

interface SettlementRow {
  amount: number
  id: string
  owner: string
  status: string
}

const columns: QsGenericTableColumn<SettlementRow>[] = [
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
    id: 'amount',
    accessorKey: 'amount',
    align: 'right',
    summary: { type: 'sum' },
    title: '金额',
  },
]

const rows: SettlementRow[] = [
  { amount: 120, id: 's-1', owner: '林舟', status: '待处理' },
  { amount: 180, id: 's-2', owner: '陈念', status: '已完成' },
  { amount: 300, id: 's-3', owner: '周衡', status: '已完成' },
]

function readRelativeSource(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), 'utf8')
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

test('列设置保留默认显隐、左右固定和对齐配置', () => {
  const settings = createDefaultColumnSettings(columns)

  assert.deepEqual(settings, {
    amount: { align: 'right', fixed: undefined, visible: true },
    owner: { align: 'left', fixed: undefined, visible: true },
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
    { align: 'right', fixed: undefined, id: 'amount', width: undefined },
  ])
})

test('列汇总支持总数、平均值和求和', () => {
  const baseColumn = columns[2]

  assert.equal(calculateColumnSummary(rows, { ...baseColumn, summary: { type: 'count' } }), 3)
  assert.equal(calculateColumnSummary(rows, { ...columns[1], summary: { type: 'count' } }), 3)
  assert.equal(calculateColumnSummary(rows, { ...baseColumn, summary: { type: 'average' } }), 200)
  assert.equal(calculateColumnSummary(rows, { ...baseColumn, summary: { type: 'sum' } }), 600)
})

test('QsGenericTable 组合 FaTable 与 FaPagination 并保持行号和响应式设置不可取消', () => {
  const source = readRelativeSource(
    '../../src/components/business/QsGenericTable/index.vue',
  )

  assert.match(source, /defineOptions\(\{ name: 'QsGenericTable' \}\)/u)
  assert.match(source, /<FaTable/u)
  assert.match(source, /:sortable="true"/u)
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
  assert.match(source, /class="(?:p-0 size-7|size-7 p-0)"/u)
})

test('列级 copyable 配置为桌面与窄屏提供剪贴板复制反馈', () => {
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
  assert.match(tableSource, /column\.copyable/u)
  assert.match(tableSource, /<CopyCellButton/u)
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
})
