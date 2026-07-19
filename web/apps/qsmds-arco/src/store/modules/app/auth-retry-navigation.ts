import type { AuthState } from './auth-lifecycle'

export type AuthRetryNavigation
  = | string
    | {
      name: 'login'
      query: { redirect?: string }
    }
    | null

export interface AuthSynchronizationNavigationInput {
  currentFullPath: string
  currentRouteName: string | symbol | null | undefined
  homeFullPath: string
  loginRedirect: unknown
  state: AuthState
}

export interface AuthPermissionFallbackInput {
  currentAllowed: boolean
  currentFullPath: string
  fallbackFullPath: string
  state: AuthState
}

/**
 * 首次导航的 `/me` 网络失败会让 Vue Router 中止导航，但 hash history 的
 * 地址栏仍保留用户请求的深链。重试前应优先恢复这个真实请求路径。
 */
export function resolveRequestedFullPath(
  currentFullPath: string,
  locationHash: string,
): string {
  return locationHash.startsWith('#/') && locationHash.length > 1
    ? locationHash.slice(1)
    : currentFullPath
}

/**
 * 身份故障页重试后的唯一导航决策。
 *
 * Router Guard 在首次 `/me` 网络失败时会中止原导航；如果重试最终得到确定
 * `401`，必须显式补一次登录导航，否则页面会停留在没有已确认组件的空状态。
 */
export function resolveAuthRetryNavigation(
  state: AuthState,
  currentFullPath: string,
  homeFullPath: string,
): AuthRetryNavigation {
  if (state === 'authenticated') {
    return currentFullPath
  }
  if (state === 'anonymous') {
    return {
      name: 'login',
      query: currentFullPath !== homeFullPath
        ? { redirect: currentFullPath }
        : {},
    }
  }
  return null
}

/**
 * 强制改密响应会先更新 Store，Vue 因而可能在子 Modal 发出 success 事件前
 * 卸载它。导航必须由根层观察认证状态迁移，不能依赖已可能卸载的组件事件。
 */
export function resolveForcedPasswordCompletionNavigation(
  previousState: AuthState | undefined,
  state: AuthState,
  homeFullPath: string,
): string | null {
  return previousState === 'password_change_required'
    && state === 'authenticated'
    ? homeFullPath
    : null
}

/**
 * 登录页 redirect 只能恢复站内绝对路径，而且不能再次指向登录页。
 * 这既避免广播风暴造成 `/login -> /login` 循环，也不允许协议相对 URL
 * 被当成跨标签登录后的恢复目标。
 */
function resolveSafeLoginRedirect(
  value: unknown,
  homeFullPath: string,
): string {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
  ) {
    return homeFullPath
  }
  const pathname = value.split(/[?#]/u, 1)[0]
  return pathname === '/login' ? homeFullPath : value
}

/**
 * BroadcastChannel 或 mutation revalidation 完成后的唯一导航决策。
 * 动态路由是否需要重新注册由 Router Guard 根据 isGenerate 负责；这里仅重新
 * 进入正确路径，避免 Store 复制第二套路由生成流程。
 */
export function resolveAuthSynchronizationNavigation(
  input: AuthSynchronizationNavigationInput,
): AuthRetryNavigation {
  if (input.state === 'anonymous') {
    if (input.currentRouteName === 'login') {
      return null
    }
    return {
      name: 'login',
      query: input.currentFullPath !== input.homeFullPath
        ? { redirect: input.currentFullPath }
        : {},
    }
  }

  if (input.state !== 'authenticated') {
    return null
  }

  return input.currentRouteName === 'login'
    ? resolveSafeLoginRedirect(input.loginRedirect, input.homeFullPath)
    : input.currentFullPath || input.homeFullPath
}

/** 按 Route.matched 的逐层 any-of 语义检查最新权限快照。 */
export function isAuthRouteAuthorized(
  routeRequirements: readonly (readonly string[] | string | undefined)[],
  permissions: readonly string[],
): boolean {
  return routeRequirements.every((requirement) => {
    if (requirement === undefined || requirement === '') {
      return true
    }
    return typeof requirement === 'string'
      ? permissions.includes(requirement)
      : requirement.length === 0
        || requirement.some(permission => permissions.includes(permission))
  })
}

/** 权限缩减后的单次降级决策；目标相同则停留根层 403，禁止自循环。 */
export function resolveAuthPermissionFallback(
  input: AuthPermissionFallbackInput,
): string | null {
  return input.state === 'authenticated'
    && !input.currentAllowed
    && input.fallbackFullPath !== input.currentFullPath
    ? input.fallbackFullPath
    : null
}
