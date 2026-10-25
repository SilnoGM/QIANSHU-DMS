import type { TableAlign, TableColumn, TableColumnFixed } from '@fantastic-admin/components'
import type { Component } from 'vue'

export type { QsGenericTableGrouping } from './grouping'

export const DEFAULT_PAGE_SIZE = 20
export const DEFAULT_PAGE_SIZE_OPTIONS = [20, 50, 100, 200] as const
export const QS_GENERIC_TABLE_ALL_FILTER_VALUE = '__qs_generic_table_all_filter__'
export const QS_GENERIC_TABLE_ACTION_COLUMN_ID = '__qs_generic_table_actions__'
export const QS_GENERIC_TABLE_ROW_NUMBER_COLUMN_ID = '__qs_generic_table_row_number__'

export type QsGenericTableFilterValue = number | string | undefined
export type QsGenericTableSummaryType = 'average' | 'count' | 'sum'
export type QsGenericTableSummaryValue = number | string | null

export interface QsGenericTableFilterOption {
  label: string
  value: number | string
}

export interface QsGenericTableFilterDefinition {
  key: string
  label: string
  options: readonly QsGenericTableFilterOption[]
  placeholder?: string
}

export type QsGenericTableFilterValues = Record<string, QsGenericTableFilterValue>

export interface QsGenericTableSummaryDefinition<TData extends object> {
  component?: Component
  componentProps?: Record<string, unknown> | ((value: QsGenericTableSummaryValue) => Record<string, unknown>)
  getValue?: (row: TData, index: number) => unknown
  type: QsGenericTableSummaryType
}

/**
 * 操作列只定义稳定的表格展示约束，按钮、权限和业务副作用继续由 actions 插槽负责。
 * fixed 显式传 false 时取消固定；未配置时默认固定在最右侧。
 */
export interface QsGenericTableActionColumn {
  align?: TableAlign
  fixed?: false | TableColumnFixed
  maxWidth?: number | string
  minWidth?: number | string
  title?: string
  width?: number | string
}

/**
 * 业务列继续继承 FaTable/TanStack 的列描述，只增加业务层需要的稳定标题、
 * 默认显隐、复制、排序与汇总配置，避免重新发明另一套单元格渲染协议。
 */
export type QsGenericTableColumn<TData extends object = Record<string, unknown>, TValue = unknown>
  = TableColumn<TData, TValue> & {
    copyable?: boolean
    copyMode?: 'button' | 'text'
    defaultVisible?: boolean
    id: string
    mobileCellClass?: string
    sortable?: boolean
    summary?: QsGenericTableSummaryDefinition<TData>
    title: string
  }

export function createActionColumn<TData extends object>(
  config: QsGenericTableActionColumn = {},
  hasSummary = false,
): TableColumn<TData, unknown> {
  return {
    align: config.align ?? 'left',
    enableHiding: false,
    enableSorting: false,
    fixed: config.fixed === false ? undefined : config.fixed ?? 'right',
    footer: hasSummary ? ' ' : undefined,
    header: config.title ?? '操作',
    id: QS_GENERIC_TABLE_ACTION_COLUMN_ID,
    maxWidth: config.maxWidth,
    minWidth: config.minWidth,
    width: config.width ?? 160,
  }
}

export interface QsGenericTableColumnSetting {
  align: TableAlign
  fixed: TableColumnFixed | undefined
  visible: boolean
}

export type QsGenericTableColumnSettings = Record<string, QsGenericTableColumnSetting>

export interface QsGenericTableColumnSettingItem extends QsGenericTableColumnSetting {
  id: string
  title: string
}

function normalizeFixed(fixed: boolean | TableColumnFixed | undefined): TableColumnFixed | undefined {
  return fixed === true ? 'left' : fixed || undefined
}

function normalizeAlign(align: TableAlign | undefined): TableAlign {
  return align ?? 'left'
}

export function createDefaultColumnSettings<TData extends object>(
  columns: readonly QsGenericTableColumn<TData>[],
): QsGenericTableColumnSettings {
  return Object.fromEntries(columns.map(column => [
    column.id,
    {
      align: normalizeAlign(column.align),
      fixed: normalizeFixed(column.fixed),
      visible: column.defaultVisible !== false,
    },
  ]))
}

/**
 * columns 热更新时保留用户已经调整的状态，新列使用自己的默认值；已移除列不会
 * 继续残留在状态对象中，防止长期运行后出现不可见的陈旧配置。
 */
export function reconcileColumnSettings<TData extends object>(
  columns: readonly QsGenericTableColumn<TData>[],
  current: QsGenericTableColumnSettings,
): QsGenericTableColumnSettings {
  const defaults = createDefaultColumnSettings(columns)

  return Object.fromEntries(columns.map((column) => {
    const currentSetting = current[column.id]
    const defaultSetting = defaults[column.id]!

    return [
      column.id,
      currentSetting
        ? {
            align: currentSetting.align ?? defaultSetting.align,
            fixed: currentSetting.fixed,
            visible: currentSetting.visible,
          }
        : defaultSetting,
    ]
  }))
}

export function resolveVisibleTableColumns<TData extends object>(
  columns: readonly QsGenericTableColumn<TData>[],
  settings: QsGenericTableColumnSettings,
): TableColumn<TData, any>[] {
  return columns.flatMap((column) => {
    const setting = settings[column.id] ?? {
      align: normalizeAlign(column.align),
      fixed: normalizeFixed(column.fixed),
      visible: column.defaultVisible !== false,
    }

    if (!setting.visible) {
      return []
    }

    return [{
      ...column,
      align: setting.align,
      enableHiding: false,
      enableSorting: column.sortable ?? column.enableSorting ?? false,
      fixed: setting.fixed,
      header: column.header ?? column.title,
    }]
  })
}

export function getContinuousRowNumber(page: number, pageSize: number, rowIndex: number): number {
  const normalizedPage = Math.max(1, Math.trunc(page))
  const normalizedPageSize = Math.max(1, Math.trunc(pageSize))
  const normalizedRowIndex = Math.max(0, Math.trunc(rowIndex))

  return (normalizedPage - 1) * normalizedPageSize + normalizedRowIndex + 1
}

function getValueByPath(row: object, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => {
    if (typeof value !== 'object' || value === null) {
      return undefined
    }
    return (value as Record<string, unknown>)[key]
  }, row)
}

export function getColumnRawValue<TData extends object>(
  row: TData,
  column: QsGenericTableColumn<TData>,
  rowIndex: number,
): unknown {
  if ('accessorFn' in column && typeof column.accessorFn === 'function') {
    return column.accessorFn(row, rowIndex)
  }

  if ('accessorKey' in column && column.accessorKey != null) {
    return getValueByPath(row, String(column.accessorKey))
  }

  return undefined
}

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined
  }

  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value.trim())) {
    return undefined
  }

  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : undefined
}

export function calculateColumnSummary<TData extends object>(
  data: readonly TData[],
  column: QsGenericTableColumn<TData>,
): QsGenericTableSummaryValue {
  const summary = column.summary
  if (!summary) {
    return null
  }

  const rawValues = data.map((row, index) => summary.getValue
    ? summary.getValue(row, index)
    : getColumnRawValue(row, column, index))

  // “总数”统计有效业务值，不要求字段必须是数字，状态、单号等文本列也能汇总。
  if (summary.type === 'count') {
    return rawValues.filter(value => value !== undefined && value !== null && value !== '').length
  }

  const values = rawValues.flatMap((rawValue) => {
    const numericValue = toFiniteNumber(rawValue)
    return numericValue === undefined ? [] : [numericValue]
  })

  if (!values.length) {
    return null
  }

  const sum = values.reduce((total, value) => total + value, 0)
  return summary.type === 'average' ? sum / values.length : sum
}

export function getSummaryTypeLabel(type: QsGenericTableSummaryType): string {
  return {
    average: '平均',
    count: '总数',
    sum: '求和',
  }[type]
}

export function formatSummaryValue(value: QsGenericTableSummaryValue): string {
  if (value === null || value === '') {
    return '—'
  }

  if (typeof value === 'string') {
    return value
  }

  return new Intl.NumberFormat('zh-CN', {
    maximumFractionDigits: 2,
  }).format(value)
}

export function getSummaryComponentProps<TData extends object>(
  column: QsGenericTableColumn<TData>,
  value: QsGenericTableSummaryValue,
): Record<string, unknown> {
  const configuredProps = typeof column.summary?.componentProps === 'function'
    ? column.summary.componentProps(value)
    : column.summary?.componentProps ?? {}

  return {
    ...configuredProps,
    value,
  }
}
