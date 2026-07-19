import type { RoleDto } from '@/api/generated/types.gen'

/** 系统角色只读；这只是前端防误操作，服务端仍必须拒绝非法修改。 */
export function canEditRole(role: Pick<RoleDto, 'isSystem'>): boolean {
  return !role.isSystem
}

/** 系统角色授权关系不通过通用管理页面修改。 */
export function canAssignRolePermissions(role: Pick<RoleDto, 'isSystem'>): boolean {
  return !role.isSystem
}
