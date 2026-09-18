import type { TableExpandedState, TableProps } from '@fantastic-admin/components'

export interface QsGenericTableGrouping<TData extends object> {
  getRows: (group: TData) => readonly TData[]
  getLabel: (group: TData) => string
}

export interface QsGenericTableGroup<TData extends object> {
  key: string
  label: string
  row: TData
  rows: TData[]
  index: number
}

export function resolveGroupedRowKey<TData extends object>(row: TData, index: number, rowKey: TableProps<TData>['rowKey']): string {
  if (!rowKey) {
    throw new Error('QsGenericTable grouping requires rowKey')
  }
  const key = typeof rowKey === 'function' ? rowKey(row, index) : (row as Record<string, unknown>)[String(rowKey)]
  if ((typeof key !== 'number' && typeof key !== 'string') || String(key).trim() === '' || (typeof key === 'number' && !Number.isFinite(key))) {
    throw new Error('Invalid row key in QsGenericTable grouping')
  }
  return String(key)
}

export function getGroupedRowId(groupKey: string, childKey: string): string {
  return JSON.stringify(['row', groupKey, childKey])
}

export function getTableGroupId(groupKey: string): string {
  return JSON.stringify(['group', groupKey])
}

export function isTableGroupExpanded(expanded: TableExpandedState, key: string): boolean {
  return expanded === true || (Object.hasOwn(expanded, key) && expanded[key] === true)
}

/** 分页数据已经由调用方按完整组切好；此处只核对身份并保留组内顺序，不自行切页或排序。 */
export function buildTableGroups<TData extends object>(data: readonly TData[], grouping: QsGenericTableGrouping<TData>, rowKey: TableProps<TData>['rowKey']): QsGenericTableGroup<TData>[] {
  if (!rowKey) {
    throw new Error('QsGenericTable grouping requires rowKey')
  }
  const groupKeys = new Set<string>()
  return data.map((row, index) => {
    const key = resolveGroupedRowKey(row, index, rowKey)
    if (groupKeys.has(key)) {
      throw new Error('Duplicate group key in QsGenericTable grouping')
    }
    groupKeys.add(key)
    const childKeys = new Set<string>()
    const rows = [...grouping.getRows(row)]
    rows.forEach((child, childIndex) => {
      const childKey = resolveGroupedRowKey(child, childIndex, rowKey)
      if (childKeys.has(childKey)) {
        throw new Error('Duplicate child key in QsGenericTable grouping')
      }
      childKeys.add(childKey)
    })
    return { key, label: grouping.getLabel(row), row, rows, index }
  })
}

export function toggleTableGroup(expanded: TableExpandedState, key: string, groupKeys: readonly string[]): TableExpandedState {
  const next = expanded === true ? Object.fromEntries(groupKeys.map(id => [id, true])) : { ...expanded }
  return { ...next, [key]: !isTableGroupExpanded(expanded, key) }
}
