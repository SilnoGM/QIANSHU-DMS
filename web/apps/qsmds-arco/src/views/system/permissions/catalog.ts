import type { PermissionDto } from '@/api/generated/types.gen'

export interface PermissionGroup {
  key: string
  label: string
  permissions: PermissionDto[]
}

const RESOURCE_LABELS: Readonly<Record<string, string>> = {
  'audit': '安全审计',
  'currencies': '货币管理',
  'dictionaries': '字典管理',
  'exchange-rates': '当前汇率',
  'numbering-rules': '编号规则',
  'regions': '地区管理',
  'roles': '角色管理',
  'users': '用户管理',
}

function compareText(left: string, right: string): number {
  if (left === right) {
    return 0
  }
  return left < right ? -1 : 1
}

export function permissionResource(code: string): string {
  const separator = code.indexOf(':')
  return separator > 0 ? code.slice(0, separator) : code
}

export function permissionResourceLabel(resource: string): string {
  return RESOURCE_LABELS[resource] ?? resource
}

/**
 * 权限目录由 Server 按 code 排序返回；页面仍在本地稳定排序，避免测试 fixture、
 * 缓存恢复或以后分页合并时让相同数据出现不同顺序。
 */
export function groupPermissions(permissions: readonly PermissionDto[]): PermissionGroup[] {
  const groups = new Map<string, PermissionDto[]>()
  const sortedPermissions = [...permissions].sort((left, right) =>
    compareText(left.code, right.code) || compareText(left.id, right.id))

  for (const permission of sortedPermissions) {
    const resource = permissionResource(permission.code)
    const current = groups.get(resource) ?? []
    current.push(permission)
    groups.set(resource, current)
  }

  return [...groups.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, entries]) => ({
      key,
      label: permissionResourceLabel(key),
      permissions: entries,
    }))
}

/**
 * 普通角色绝不能提交 systemOnly 权限。这里先做 UI 防误操作，Server 仍是最终裁决。
 * 输出使用目录顺序，并自然去掉未知 ID 与重复 ID。
 */
export function sanitizePermissionSelection(
  selectedIds: readonly string[],
  permissions: readonly PermissionDto[],
): string[] {
  const selected = new Set(selectedIds)
  return [...permissions]
    .sort((left, right) =>
      compareText(left.code, right.code) || compareText(left.id, right.id))
    .filter(permission => !permission.systemOnly && selected.has(permission.id))
    .map(permission => permission.id)
}
