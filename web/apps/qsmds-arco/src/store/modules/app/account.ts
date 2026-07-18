import type {
  AuthContextDto,
  ChangePasswordRequestDto,
  LoginRequestDtoWritable,
} from '@/api/generated/types.gen'

import authApi from '@/api/modules/auth'
import router from '@/router'
import {
  AuthLifecycleCoordinator,
  createAuthLifecycleState,
} from './auth-lifecycle'

type AuthBroadcastType = 'AUTH_CONTEXT_CHANGED' | 'AUTH_INVALIDATED'

const AUTH_CHANNEL_NAME = 'qianshu-auth-v1'

function readErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined
  }
  if ('body' in error && typeof error.body === 'object' && error.body !== null) {
    const body = error.body
    if ('code' in body && typeof body.code === 'string') {
      return body.code
    }
  }
  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

function isUnknownMutationResult(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('kind' in error)) {
    return false
  }
  if (error.kind === 'network') {
    return true
  }
  return 'status' in error
    && typeof error.status === 'number'
    && error.status >= 500
}

export const useAppAccountStore = defineStore('appAccount', () => {
  const appTabbarStore = useAppTabbarStore()
  const appRouteStore = useAppRouteStore()
  const appMenuStore = useAppMenuStore()
  const appFavoritesStore = useAppFavoritesStore()
  const appKeepAliveStore = useAppKeepAliveStore()
  const appIframeStore = useAppIframeStore()

  const lifecycleState = reactive(createAuthLifecycleState())
  const logoutPromise = shallowRef<Promise<void> | null>(null)
  let authAbortController = new AbortController()
  let authChannel: BroadcastChannel | null = null
  let synchronizationStarted = false

  function cleanIdentityDomain(): void {
    authAbortController.abort()
    authAbortController = new AbortController()
    appTabbarStore.clean()
    appFavoritesStore.clean()
    appKeepAliveStore.clean()
    appIframeStore.close(appIframeStore.openedList.map(item => item.path))
    appRouteStore.removeRoutes()
    appMenuStore.setActived(0)
  }

  function getAuthSignal(): AbortSignal {
    return authAbortController.signal
  }

  function rebuildPermissionRoutes(): void {
    appKeepAliveStore.clean()
    appTabbarStore.clean()
    appRouteStore.removeRoutes()
    queueMicrotask(async () => {
      if (router.currentRoute.value.name !== 'login') {
        try {
          await router.replace(router.currentRoute.value.fullPath)
          const { auth } = useAppAuth()
          const currentAllowed = router.currentRoute.value.matched.every(route =>
            auth(route.meta.auth ?? ''))
          if (!currentAllowed) {
            // 权限缩减后优先进入当前菜单域首个可访问页面；无菜单时回到稳定首页。
            await router.replace(appMenuStore.sidebarMenusFirstDeepestPath)
          }
        }
        catch {
          // Router 取消或组件加载失败时保留根层 403/错误态，不制造重定向循环。
        }
      }
    })
  }

  const coordinator = new AuthLifecycleCoordinator({
    state: lifecycleState,
    getMe: (signal, broadcastSessionInvalid) =>
      authApi.me(signal, broadcastSessionInvalid).then(response => response.data),
    onIdentityBoundary: cleanIdentityDomain,
    onMutationRevalidated: () => broadcast('AUTH_CONTEXT_CHANGED'),
    onPermissionsChanged: rebuildPermissionRoutes,
  })

  const authState = toRef(lifecycleState, 'authState')
  const authContext = toRef(lifecycleState, 'authContext')
  const authEpoch = toRef(lifecycleState, 'authEpoch')
  const errorCode = toRef(lifecycleState, 'errorCode')
  const permissions = computed(() => authContext.value?.permissions ?? [])
  const userId = computed(() => authContext.value?.user.id ?? '')
  const account = computed(() => authContext.value?.user.username ?? '')
  const displayName = computed(() => authContext.value?.user.displayName ?? '')
  const avatar = computed(() => '')
  const isLogin = computed(() => authContext.value !== null)

  function broadcast(type: AuthBroadcastType): void {
    try {
      authChannel?.postMessage({ type })
    }
    catch {
      // BroadcastChannel 是 best effort；失败不改变当前标签的服务端认证结果。
    }
  }

  function isAuthBroadcastMessage(value: unknown): value is { type: AuthBroadcastType } {
    return typeof value === 'object'
      && value !== null
      && 'type' in value
      && (value.type === 'AUTH_CONTEXT_CHANGED' || value.type === 'AUTH_INVALIDATED')
  }

  function startAuthSynchronization(): void {
    if (synchronizationStarted) {
      return
    }
    synchronizationStarted = true

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        authChannel = new BroadcastChannel(AUTH_CHANNEL_NAME)
        authChannel.addEventListener('message', (event: MessageEvent<unknown>) => {
          if (isAuthBroadcastMessage(event.data)) {
            void coordinator.revalidateAuth({
              broadcastSessionInvalid: false,
            }).catch(() => undefined)
          }
        })
      }
      catch {
        authChannel = null
      }
    }

    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        void coordinator.revalidateAuth().catch(() => undefined)
      }
    })
  }

  function navigateToLogin(): void {
    if (router.currentRoute.value.name === 'login') {
      return
    }
    const currentPath = router.currentRoute.value.fullPath
    void router.replace({
      name: 'login',
      query: { redirect: currentPath },
    })
  }

  async function initializeAuth(): Promise<AuthContextDto | null> {
    startAuthSynchronization()
    return coordinator.revalidateAuth()
  }

  async function revalidateAuth(): Promise<AuthContextDto | null> {
    const pendingNotice = lifecycleState.errorCode === 'PASSWORD_CHANGE_RESULT_UNKNOWN'
      ? lifecycleState.errorCode
      : null
    const context = await coordinator.revalidateAuth()
    if (pendingNotice !== null && context === null) {
      lifecycleState.errorCode = pendingNotice
    }
    return context
  }

  function revalidateAfterMutation(): Promise<AuthContextDto | null> {
    return coordinator.revalidateAfterMutation()
  }

  function applyAuthContext(context: AuthContextDto): void {
    coordinator.applyAuthContext(context)
  }

  function handleSessionInvalid(
    requestEpoch: number,
    shouldBroadcast = true,
  ): void {
    const changed = coordinator.handleSessionInvalid(requestEpoch)
    if (!changed) {
      return
    }
    if (shouldBroadcast) {
      broadcast('AUTH_INVALIDATED')
    }
    navigateToLogin()
  }

  async function login(data: LoginRequestDtoWritable): Promise<AuthContextDto | null> {
    lifecycleState.errorCode = null
    coordinator.invalidatePassiveRevalidation()
    try {
      const response = await authApi.login(data)
      coordinator.applyAuthContext(response.data)
      broadcast('AUTH_CONTEXT_CHANGED')
      return response.data
    }
    catch (error) {
      if (
        readErrorCode(error) === 'ALREADY_AUTHENTICATED'
        || isUnknownMutationResult(error)
      ) {
        const context = await coordinator.revalidateAfterMutation()
        if (context !== null) {
          return context
        }
      }
      throw error
    }
  }

  async function changePassword(
    data: ChangePasswordRequestDto,
  ): Promise<AuthContextDto | null> {
    lifecycleState.errorCode = null
    const previousSessionCreatedAt = lifecycleState.authContext?.session.createdAt
    coordinator.invalidatePassiveRevalidation()
    try {
      const response = await authApi.changePassword(data)
      coordinator.applyAuthContext(response.data)
      broadcast('AUTH_CONTEXT_CHANGED')
      return response.data
    }
    catch (error) {
      if (isUnknownMutationResult(error)) {
        const context = await coordinator.revalidateAfterMutation()
        if (
          context !== null
          && context.session.createdAt !== previousSessionCreatedAt
        ) {
          return context
        }
        if (
          lifecycleState.authState === 'anonymous'
          || lifecycleState.authState === 'unavailable'
        ) {
          // 安全提示不含密码，仅用于在 Modal 因 401 卸载后向登录页交代未知结果。
          lifecycleState.errorCode = 'PASSWORD_CHANGE_RESULT_UNKNOWN'
        }
      }
      throw error
    }
  }

  function performLogout(allSessions: boolean): Promise<void> {
    if (logoutPromise.value !== null) {
      return logoutPromise.value
    }

    const requestEpoch = lifecycleState.authEpoch
    coordinator.markLoggingOut()
    coordinator.invalidatePassiveRevalidation()

    const operation = (allSessions ? authApi.logoutAll() : authApi.logout())
      .then(() => {
        const changed = coordinator.handleSessionInvalid(requestEpoch)
        if (changed) {
          broadcast('AUTH_INVALIDATED')
          navigateToLogin()
        }
      })
      .catch(async (error: unknown) => {
        // API Client 可能已经用确定 401 完成统一身份清理。
        if (lifecycleState.authContext === null) {
          navigateToLogin()
          return
        }

        if (isUnknownMutationResult(error)) {
          await coordinator.revalidateAfterMutation()
          if (lifecycleState.authState === 'anonymous') {
            broadcast('AUTH_INVALIDATED')
            navigateToLogin()
            return
          }
        }
        else {
          coordinator.restoreStateFromContext()
        }
        throw error
      })
      .finally(() => {
        logoutPromise.value = null
      })

    logoutPromise.value = operation
    return operation
  }

  function logout(): Promise<void> {
    return performLogout(false)
  }

  function logoutAll(): Promise<void> {
    return performLogout(true)
  }

  return {
    authState,
    authContext,
    authEpoch,
    getAuthSignal,
    errorCode,
    logoutPromise,
    permissions,
    userId,
    account,
    displayName,
    avatar,
    isLogin,
    initializeAuth,
    revalidateAuth,
    revalidateAfterMutation,
    applyAuthContext,
    handleSessionInvalid,
    login,
    changePassword,
    logout,
    logoutAll,
  }
}, {
  // 浏览器身份只允许由本次启动的 /api/auth/me 建立，禁止 Pinia hydrate 旧认证状态。
  persist: false,
})
