/**
 * 数据范围权限码：只控制业务查询的归属范围，不替代页面/接口的权限码。
 *
 * `data-scope:all` 是显式的全量开关，优先级高于 `data-scope:self`；两者都不存在时
 * 保持历史行为（全量），因此只有显式授予 self 的角色才会被收窄。
 */
export const DATA_SCOPE_ALL = 'data-scope:all' as const
export const DATA_SCOPE_SELF = 'data-scope:self' as const
export const DATA_SCOPE_PERMISSION_CODES = [
  DATA_SCOPE_ALL,
  DATA_SCOPE_SELF,
] as const

/**
 * 内置运营角色码。仓库已有 `SYSTEM_ADMIN_ROLE_CODE` 先例；这里只作为误删
 * `data-scope:self` 时的安全兜底，范围解析仍以权限码为主。
 */
export const OPERATIONS_STAFF_ROLE_CODE = 'operations_staff' as const

export type DataScope = 'ALL' | 'SELF'

/**
 * 测试环境缺省操作者：直接调用 service 的旧单测/仓储测试不传 actor 时，
 * 用一个无角色用户解析为 ALL，保持既有测试的全量预期；生产/开发环境缺少
 * actor 时由 `resolveDataScopeActor` 直接抛错，避免静默放开。
 */
export const TEST_DATA_SCOPE_ACTOR_ID = '00000000-0000-4000-8000-000000000000'

export function resolveDataScopeActor(actorUserId?: string): string {
  if (actorUserId !== undefined && actorUserId !== '') {
    return actorUserId
  }
  if (
    process.env.NODE_ENV === 'test'
    || process.env.JEST_WORKER_ID !== undefined
  ) {
    return TEST_DATA_SCOPE_ACTOR_ID
  }
  throw new Error('Data scope actor is required')
}

export interface DataScopeSubject {
  readonly permissionCodes: readonly string[]
  readonly roleCodes: readonly string[]
}

/**
 * 纯函数解析，便于在不接触数据库的测试里覆盖权限组合。
 *
 * 规则：
 * - 持有 `data-scope:all` → ALL；
 * - 持有 `data-scope:self` 或运营内置角色 → SELF；
 * - 其余角色保持 ALL，确保财务、采运、管理员及既有自定义角色不受影响。
 */
export function resolveDataScope(subject: DataScopeSubject): DataScope {
  const permissions = new Set(subject.permissionCodes)
  if (permissions.has(DATA_SCOPE_ALL)) {
    return 'ALL'
  }
  if (
    permissions.has(DATA_SCOPE_SELF)
    || subject.roleCodes.includes(OPERATIONS_STAFF_ROLE_CODE)
  ) {
    return 'SELF'
  }
  return 'ALL'
}
