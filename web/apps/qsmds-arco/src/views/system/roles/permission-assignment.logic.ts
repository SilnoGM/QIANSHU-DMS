import type { PermissionGroup } from '../permissions/catalog'
import type { PermissionDto } from '@/api/generated/types.gen'

import { groupPermissions } from '../permissions/catalog'
import { filterPermissionTableRows } from '../shared/table-query'

/** 范围筛选的「全部」哨兵：FaSelect 没有可清空契约，用显式取值表达未筛选。 */
export const PERMISSION_SCOPE_ALL = 'all' as const

export type PermissionScopeFilter
  = | typeof PERMISSION_SCOPE_ALL
    | 'business'
    | 'system'

export type PermissionGroupSelectionState
  = | 'all'
    | 'none'
    | 'partial'
    /** 本组全是系统专用权限，组级勾选没有可作用对象。 */
    | 'unavailable'

export interface PermissionGroupSummary {
  assignable: number
  selected: number
  state: PermissionGroupSelectionState
  systemOnly: number
}

export interface PermissionSelectionSummary {
  added: number
  groupCount: number
  removed: number
  total: number
}

export interface AssignmentGroupOptions {
  keyword: string
  onlySelected: boolean
  scope: PermissionScopeFilter
  selectedIds: readonly string[]
}

/** 可分配成员用于组级勾选与计数，系统专用权限永远不参与。 */
export function assignablePermissionIds(group: PermissionGroup): string[] {
  return group.permissions.filter(permission => !permission.systemOnly).map(permission => permission.id)
}

export function summarizeGroup(
  group: PermissionGroup,
  selectedIds: readonly string[],
): PermissionGroupSummary {
  const selected = new Set(selectedIds)
  const assignablePermissions = group.permissions.filter(permission => !permission.systemOnly)
  const selectedCount = assignablePermissions.filter(permission => selected.has(permission.id)).length

  return {
    assignable: assignablePermissions.length,
    selected: selectedCount,
    state: assignablePermissions.length === 0
      ? 'unavailable'
      : selectedCount === 0
        ? 'none'
        : selectedCount === assignablePermissions.length ? 'all' : 'partial',
    systemOnly: group.permissions.length - assignablePermissions.length,
  }
}

/**
 * 组级勾选始终作用于完整组的可分配成员，不跟随搜索或筛选结果，
 * 使「采购订单组」这类语义稳定；批量勾选当前结果由 selectPermissions 单独表达。
 */
export function toggleGroupSelection(
  group: PermissionGroup,
  selectedIds: readonly string[],
): string[] {
  const assignableIds = assignablePermissionIds(group)
  if (assignableIds.length === 0) {
    return [...selectedIds]
  }

  const shouldClear = summarizeGroup(group, selectedIds).state === 'all'
  const next = new Set(selectedIds)
  for (const id of assignableIds) {
    if (shouldClear) {
      next.delete(id)
    }
    else {
      next.add(id)
    }
  }
  return [...next]
}

/** 并入一批权限（用于「选中当前结果」），只追加缺失项，不退出现有选择。 */
export function selectPermissions(
  permissionIds: readonly string[],
  selectedIds: readonly string[],
): string[] {
  return [...new Set([...selectedIds, ...permissionIds])]
}

export function summarizeSelection(
  groups: readonly PermissionGroup[],
  selectedIds: readonly string[],
  baselineIds: readonly string[],
): PermissionSelectionSummary {
  const selected = new Set(selectedIds)
  const baseline = new Set(baselineIds)
  const groupCount = groups.filter(group =>
    group.permissions.some(permission => selected.has(permission.id))).length

  let added = 0
  let removed = 0
  for (const id of selected) {
    if (!baseline.has(id)) {
      added += 1
    }
  }
  for (const id of baseline) {
    if (!selected.has(id)) {
      removed += 1
    }
  }

  return { added, groupCount, removed, total: selected.size }
}

/**
 * 工具栏搜索与范围筛选直接复用权限目录页的匹配口径（含中文资源名），
 * 「只看已选」在匹配之后再收窄，保证筛选计数与列表展示同源。
 */
export function buildAssignmentGroups(
  permissions: readonly PermissionDto[],
  options: AssignmentGroupOptions,
): PermissionGroup[] {
  const matched = filterPermissionTableRows(permissions, options.keyword, {
    permissionScope: options.scope === PERMISSION_SCOPE_ALL ? undefined : options.scope,
  })

  if (!options.onlySelected) {
    return groupPermissions(matched)
  }

  const selected = new Set(options.selectedIds)
  return groupPermissions(matched.filter(permission => selected.has(permission.id)))
}
