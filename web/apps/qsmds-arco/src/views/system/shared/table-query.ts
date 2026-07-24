import type { PermissionDto, RoleDto } from '@/api/generated/types.gen'
import type { QsGenericTableFilterValues } from '@/components/business/QsGenericTable/logic'

import {
  permissionResource,
  permissionResourceLabel,
} from '../permissions/catalog'

function normalizedKeyword(keyword: string): string {
  return keyword.trim().toLocaleLowerCase('zh-CN')
}

function includesKeyword(keyword: string, values: readonly (null | string)[]): boolean {
  if (!keyword) {
    return true
  }

  return values.some(value => value?.toLocaleLowerCase('zh-CN').includes(keyword))
}

/**
 * 角色接口一次返回完整目录，因此搜索和筛选必须基于原始完整数组共同计算。
 * 函数只返回新数组，不改变 Server 返回顺序，便于刷新后保持稳定展示。
 */
export function filterRoleTableRows(
  roles: readonly RoleDto[],
  search: string,
  filters: QsGenericTableFilterValues,
): RoleDto[] {
  const keyword = normalizedKeyword(search)

  return roles.filter((role) => {
    const matchesSearch = includesKeyword(keyword, [
      role.name,
      role.code,
      role.description,
    ])
    const matchesType = filters.roleType === 'system'
      ? role.isSystem
      : filters.roleType === 'custom'
        ? !role.isSystem
        : true

    return matchesSearch && matchesType
  })
}

/**
 * 权限目录同样是全量数据；资源搜索同时匹配技术标识和中文展示名，
 * 让用户输入 users 或“用户管理”都能找到相同权限。
 */
export function filterPermissionTableRows(
  permissions: readonly PermissionDto[],
  search: string,
  filters: QsGenericTableFilterValues,
): PermissionDto[] {
  const keyword = normalizedKeyword(search)

  return permissions.filter((permission) => {
    const resource = permissionResource(permission.code)
    const matchesSearch = includesKeyword(keyword, [
      permission.code,
      permission.name,
      permission.description,
      resource,
      permissionResourceLabel(resource),
    ])
    const matchesResource = typeof filters.resource !== 'string'
      || filters.resource === ''
      || resource === filters.resource
    const matchesScope = filters.permissionScope === 'system'
      ? permission.systemOnly
      : filters.permissionScope === 'business'
        ? !permission.systemOnly
        : true

    return matchesSearch && matchesResource && matchesScope
  })
}

export function permissionResourceOptions(
  permissions: readonly PermissionDto[],
): { label: string, value: string }[] {
  const resources = new Set(permissions.map(permission => permissionResource(permission.code)))

  return [...resources]
    .sort()
    .map(resource => ({
      label: permissionResourceLabel(resource),
      value: resource,
    }))
}

/**
 * 自定义 mobile-row 不会自动隐藏业务字段，必须使用组件传入的可见列同步列设置。
 */
export function hasVisibleTableColumn(
  columns: readonly { id?: string }[],
  columnId: string,
): boolean {
  return columns.some(column => column.id === columnId)
}
