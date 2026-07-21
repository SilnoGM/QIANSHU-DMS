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
    defaultVisible: false,
    fixed: 'right',
    title: '状态',
  },
  {
    id: 'amount',
    accessorKey: 'amount',
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

test('列设置保留默认显隐和左右固定配置', () => {
  const settings = createDefaultColumnSettings(columns)

  assert.deepEqual(settings, {
    amount: { fixed: undefined, visible: true },
    owner: { fixed: undefined, visible: true },
    status: { fixed: 'right', visible: false },
  })

  const visibleColumns = resolveVisibleTableColumns(columns, {
    ...settings,
    owner: { fixed: 'left', visible: true },
    status: { fixed: 'right', visible: true },
  })

  assert.deepEqual(visibleColumns.map(column => ({
    fixed: column.fixed,
    id: column.id,
    width: column.width,
  })), [
    { fixed: 'left', id: 'owner', width: 140 },
    { fixed: 'right', id: 'status', width: undefined },
    { fixed: undefined, id: 'amount', width: undefined },
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
