import type { AuthState } from './auth-lifecycle'

export type AuthRetryNavigation
  = | string
    | {
      name: 'login'
      query: { redirect?: string }
    }
    | null

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
