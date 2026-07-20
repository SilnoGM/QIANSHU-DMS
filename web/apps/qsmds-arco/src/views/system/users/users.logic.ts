export interface UserListQuery {
  page: number
  pageSize: number
  username?: string
}

export interface PasswordFields {
  newPassword: string
  confirmPassword: string
}

export interface ApiFailure {
  message: string
  requestId: string | undefined
  unknownResult: boolean
}

export type FieldErrors = Record<string, string>

export interface UserAdminActionsInput {
  canAssignRoles: boolean
  canDisable: boolean
  canEnable: boolean
  canResetPassword: boolean
  currentUserId: string
  status: 'ACTIVE' | 'DISABLED'
  userId: string
}

export interface UserAdminActions {
  canAssignRoles: boolean
  canDisable: boolean
  canEnable: boolean
  canResetPassword: boolean
  hasMoreAction: boolean
}

export interface RefreshAfterRoleAssignmentInput {
  currentUserId: string
  reloadUsers: () => Promise<unknown>
  revalidateCurrentAuth: () => Promise<unknown>
  userId: string
}

export interface RefreshAfterUserUpdateInput
  extends RefreshAfterRoleAssignmentInput {
  refreshCurrentProfile: () => Promise<unknown>
}

/** 分配角色同时需要用户授权写权限与角色目录读取权限。 */
export function canManageUserRoles(
  hasAssignPermission: boolean,
  hasRoleReadPermission: boolean,
): boolean {
  return hasAssignPermission && hasRoleReadPermission
}

/**
 * 管理员不能通过用户管理入口重置或禁用自己；本人改密由头像菜单的改密弹窗负责。
 * 角色分配仍保留，并由服务端的最后一个 system_admin 规则兜底。
 */
export function resolveUserAdminActions(
  input: UserAdminActionsInput,
): UserAdminActions {
  const isCurrentUser = input.userId === input.currentUserId
  const canResetPassword = !isCurrentUser && input.canResetPassword
  const canDisable = !isCurrentUser
    && input.status === 'ACTIVE'
    && input.canDisable
  const canEnable = !isCurrentUser
    && input.status === 'DISABLED'
    && input.canEnable

  return {
    canAssignRoles: input.canAssignRoles,
    canDisable,
    canEnable,
    canResetPassword,
    hasMoreAction: input.canAssignRoles
      || canResetPassword
      || canDisable
      || canEnable,
  }
}

/**
 * 修改本人角色后，服务端权限已经即时生效，必须先刷新 AuthContext，再刷新列表。
 * 修改其他用户时不触碰当前身份域，避免无意义的路由与菜单重建。
 */
export async function refreshAfterRoleAssignment(
  input: RefreshAfterRoleAssignmentInput,
): Promise<void> {
  if (input.userId === input.currentUserId) {
    await input.revalidateCurrentAuth()
  }
  await input.reloadUsers()
}

/**
 * 管理员通过用户管理修改本人时，响应里的 UserDto 不属于账户身份域真相源。
 * 先重验 AuthContext，再读取本人受限 Profile，最后刷新管理列表；修改其他用户
 * 时只刷新列表，避免无意义的账户请求和跨标签广播。
 */
export async function refreshAfterUserUpdate(
  input: RefreshAfterUserUpdateInput,
): Promise<void> {
  if (input.userId === input.currentUserId) {
    await input.revalidateCurrentAuth()
    await input.refreshCurrentProfile()
  }
  await input.reloadUsers()
}

/** 目录未知时禁止提交，避免把“加载失败的空数组”误当成清空全部角色。 */
export function canSubmitRoleAssignment(
  rolesLoading: boolean,
  rolesErrorMessage: string,
): boolean {
  return !rolesLoading && rolesErrorMessage.length === 0
}

/**
 * 用户查询目前只有精确用户名和分页参数。
 * 空用户名必须省略，不能把设计中尚无服务端契约的 status 偷渡成查询参数。
 */
export function buildUserListQuery(
  page: number,
  pageSize: number,
  username: string,
): UserListQuery {
  const normalizedUsername = username.normalize('NFC').trim()
  return {
    page,
    pageSize,
    ...(normalizedUsername === '' ? {} : { username: normalizedUsername }),
  }
}

function codePointLength(value: string): number {
  return Array.from(value).length
}

export function validateIdentityFields(
  username: string,
  displayName: string,
): FieldErrors {
  const errors: FieldErrors = {}
  const normalizedUsername = username.normalize('NFC').trim()
  const normalizedDisplayName = displayName.normalize('NFC').trim()

  if (normalizedUsername === '') {
    errors.username = '请输入用户名'
  }
  else if (codePointLength(normalizedUsername) > 128) {
    errors.username = '用户名不能超过 128 个字符'
  }

  if (normalizedDisplayName === '') {
    errors.displayName = '请输入显示名称'
  }
  else if (codePointLength(normalizedDisplayName) > 128) {
    errors.displayName = '显示名称不能超过 128 个字符'
  }

  return errors
}

export function validatePasswordFields(
  newPassword: string,
  confirmPassword: string,
): FieldErrors {
  const errors: FieldErrors = {}
  const length = codePointLength(newPassword)
  if (length < 8 || length > 20) {
    errors.newPassword = '密码长度应为 8 至 20 个字符'
  }
  else if (newPassword !== confirmPassword) {
    errors.confirmPassword = '两次输入的密码不一致'
  }
  return errors
}

export function createPasswordFields(): PasswordFields {
  return { confirmPassword: '', newPassword: '' }
}

export function clearPasswordFields(fields: PasswordFields): void {
  fields.newPassword = ''
  fields.confirmPassword = ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * API client 已把 Axios 异常收敛为有限联合；页面仍按不可信对象读取，避免异常 getter
 * 或未来调用方错误影响弹窗关闭与密码清理流程。
 */
export function getApiFailure(error: unknown): ApiFailure {
  try {
    if (!isRecord(error)) {
      return {
        message: '操作失败，请稍后重试',
        requestId: undefined,
        unknownResult: false,
      }
    }

    const kind = error.kind
    if (kind === 'network') {
      return {
        message: typeof error.message === 'string'
          ? error.message
          : '网络连接失败，请稍后重试',
        requestId: undefined,
        unknownResult: true,
      }
    }

    const status = typeof error.status === 'number' ? error.status : undefined
    if (kind === 'http' && isRecord(error.body)) {
      return {
        message: typeof error.body.message === 'string'
          ? error.body.message
          : '操作失败，请稍后重试',
        requestId: typeof error.body.requestId === 'string'
          ? error.body.requestId
          : undefined,
        unknownResult: status !== undefined && status >= 500,
      }
    }

    return {
      message: typeof error.message === 'string'
        ? error.message
        : '服务器返回了无法识别的错误响应',
      requestId: typeof error.requestId === 'string' ? error.requestId : undefined,
      unknownResult: status === undefined || status >= 500,
    }
  }
  catch {
    return {
      message: '操作失败，请稍后重试',
      requestId: undefined,
      unknownResult: false,
    }
  }
}

export function getApiFieldError(error: unknown, field: string): string | undefined {
  try {
    if (!isRecord(error) || !isRecord(error.body) || !isRecord(error.body.fieldErrors)) {
      return undefined
    }
    const messages = error.body.fieldErrors[field]
    return Array.isArray(messages) && typeof messages[0] === 'string'
      ? messages[0]
      : undefined
  }
  catch {
    return undefined
  }
}

export function normalizeIdentityValue(value: string): string {
  return value.normalize('NFC').trim()
}
