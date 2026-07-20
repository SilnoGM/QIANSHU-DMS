import type { AuthRetryNavigationTarget } from './auth-retry-navigation'
import type { LoadProfileOptions } from './profile-lifecycle'
import type {
  AuthContextDto,
  ChangePasswordRequestDto,
  CurrentUserProfileDto,
  LoginRequestDtoWritable,
  UpdateCurrentUserProfileRequestDto,
} from '@/api/generated/types.gen'

import { isNavigationFailure, NavigationFailureType } from 'vue-router'
import authApi from '@/api/modules/auth'
import profileApi from '@/api/modules/profile'
import router from '@/router'
import {
  AuthLifecycleCoordinator,
  createAuthLifecycleState,
  StaleAuthStateError,
} from './auth-lifecycle'
import {
  isAuthRouteAuthorized,
  resolveAuthPermissionFallback,
  resolveAuthSynchronizationNavigation,
  shouldRequestAuthRouteReconciliation,
  toForcedAuthNavigation,
} from './auth-retry-navigation'
import {
  AuthSynchronizationQueue,
  LatestVersionTaskQueue,
} from './auth-synchronization-queue'
import {
  createProfileLifecycleState,
  ProfileLifecycleCoordinator,
  StaleProfileStateError,
} from './profile-lifecycle'

type AuthBroadcastType = 'AUTH_CONTEXT_CHANGED' | 'AUTH_INVALIDATED'
type AccountBroadcastType = AuthBroadcastType | 'PROFILE_CHANGED'
type AuthRevalidationSource = 'mutation' | 'passive' | 'synchronization'

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
  const appSettingsStore = useAppSettingsStore()
  const appFavoritesStore = useAppFavoritesStore()
  const appKeepAliveStore = useAppKeepAliveStore()
  const appIframeStore = useAppIframeStore()

  const lifecycleState = reactive(createAuthLifecycleState())
  const profileLifecycleState = reactive(createProfileLifecycleState())
  const logoutPromise = shallowRef<Promise<void> | null>(null)
  let authAbortController = new AbortController()
  let authChannel: BroadcastChannel | null = null
  let synchronizationStarted = false
  let routeDomainVersion = 0
  let routeReconciliationRequestVersion = 0
  const routeReconciliationQueue = new LatestVersionTaskQueue(
    reconcileAuthRoute,
  )
  const backgroundAuthSynchronizationQueue = new AuthSynchronizationQueue(
    broadcastSessionInvalid => revalidateAndReconcile(
      broadcastSessionInvalid,
      'synchronization',
    ).then(() => undefined),
  )
  const profileCoordinator = new ProfileLifecycleCoordinator({
    state: profileLifecycleState,
    getIdentity: () => {
      const context = lifecycleState.authContext
      return lifecycleState.authState === 'authenticated' && context !== null
        ? {
            authEpoch: lifecycleState.authEpoch,
            userId: context.user.id,
          }
        : null
    },
    getProfile: signal => profileApi.get(signal).then(response => response.data),
    updateProfile: patch => profileApi.update(patch).then(response => response.data),
    onProfileChanged: () => broadcast('PROFILE_CHANGED'),
  })

  function cleanIdentityDomain(): void {
    routeDomainVersion += 1
    authAbortController.abort()
    authAbortController = new AbortController()
    profileCoordinator.clearProfile()
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

  function resetPermissionRoutes(): void {
    routeDomainVersion += 1
    appKeepAliveStore.clean()
    appTabbarStore.clean()
    appRouteStore.removeRoutes()
    appMenuStore.setActived(0)
  }

  const coordinator = new AuthLifecycleCoordinator({
    state: lifecycleState,
    getMe: (signal, broadcastSessionInvalid) =>
      authApi.me(signal, broadcastSessionInvalid).then(response => response.data),
    onIdentityBoundary: cleanIdentityDomain,
    onMutationRevalidated: () => broadcast('AUTH_CONTEXT_CHANGED'),
    onPermissionsChanged: resetPermissionRoutes,
  })

  const authState = toRef(lifecycleState, 'authState')
  const authContext = toRef(lifecycleState, 'authContext')
  const authEpoch = toRef(lifecycleState, 'authEpoch')
  const errorCode = toRef(lifecycleState, 'errorCode')
  const profile = toRef(profileLifecycleState, 'profile')
  const profileState = toRef(profileLifecycleState, 'profileState')
  const profileErrorCode = toRef(profileLifecycleState, 'profileErrorCode')
  const permissions = computed(() => authContext.value?.permissions ?? [])
  const userId = computed(() => authContext.value?.user.id ?? '')
  const account = computed(() => authContext.value?.user.username ?? '')
  const displayName = computed(() => authContext.value?.user.displayName ?? '')
  const avatar = computed(() => profile.value?.avatarUrl ?? '')
  const isLogin = computed(() => authContext.value !== null)

  async function replaceAuthRoute(
    target: AuthRetryNavigationTarget,
  ): Promise<void> {
    const failure = await router.replace(toForcedAuthNavigation(target))
    if (failure === undefined) {
      return
    }
    if (isNavigationFailure(
      failure,
      NavigationFailureType.cancelled | NavigationFailureType.duplicated,
    )) {
      // 新认证事件抢占旧导航或目标已经一致时无需报错；其余失败必须上抛。
      return
    }
    throw failure
  }

  async function reconcileAuthRoute(): Promise<void> {
    const reconciliationEpoch = lifecycleState.authEpoch
    const currentRoute = router.currentRoute.value
    const target = resolveAuthSynchronizationNavigation({
      currentFullPath: currentRoute.fullPath,
      currentRouteName: currentRoute.name,
      homeFullPath: appSettingsStore.settings.app.home.fullPath,
      loginRedirect: currentRoute.query.redirect,
      state: lifecycleState.authState,
    })
    if (target === null) {
      return
    }

    await replaceAuthRoute(target)
    if (
      reconciliationEpoch !== lifecycleState.authEpoch
      || lifecycleState.authState !== 'authenticated'
    ) {
      return
    }

    const currentAllowed = isAuthRouteAuthorized(
      router.currentRoute.value.matched.map(route => route.meta.auth),
      permissions.value,
    )
    // 权限缩减后只降级一次：有菜单时进入第一个可访问页面；无菜单时回到
    // 稳定首页，由根层 403 提供账户自服务入口，避免两个无权路径互相跳转。
    const fallback = resolveAuthPermissionFallback({
      currentAllowed,
      currentFullPath: router.currentRoute.value.fullPath,
      fallbackFullPath: appMenuStore.sidebarMenusFirstDeepestPath,
      state: lifecycleState.authState,
    })
    if (fallback !== null) {
      await replaceAuthRoute(fallback)
    }
  }

  async function revalidateAndReconcile(
    broadcastSessionInvalid: boolean,
    source: AuthRevalidationSource = 'passive',
  ): Promise<AuthContextDto | null> {
    const previousRouteDomainVersion = routeDomainVersion
    const previousAuthState = lifecycleState.authState
    const context = source === 'mutation'
      ? await coordinator.revalidateAfterMutation()
      : source === 'synchronization'
        ? await coordinator.revalidateAfterSynchronizationEvent({
            broadcastSessionInvalid,
          })
        : await coordinator.revalidateAuth({ broadcastSessionInvalid })
    if (shouldRequestAuthRouteReconciliation({
      currentState: lifecycleState.authState,
      previousState: previousAuthState,
      routeDomainChanged: routeDomainVersion !== previousRouteDomainVersion,
      routeReconciliationPending: routeReconciliationQueue.hasPending,
    })) {
      // 身份域版本可以保持 0，也可能一次请求内增长多次；任务队列使用独立、
      // 严格单调的请求版本，确保每个需要协调的确定状态都不会被当作已完成。
      routeReconciliationRequestVersion += 1
      await routeReconciliationQueue.request(routeReconciliationRequestVersion)
    }
    return context
  }

  function reportBackgroundSynchronizationError(error: unknown): void {
    if (error instanceof StaleAuthStateError) {
      return
    }
    lifecycleState.errorCode = 'AUTH_ROUTE_RECONCILIATION_FAILED'
    lifecycleState.authState = 'unavailable'
    // 原始 Axios/Router error 可能携带 URL 或请求配置，日志只输出固定脱敏文本。
    console.error('[auth] Background synchronization failed')
  }

  function broadcast(type: AccountBroadcastType): void {
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

  function isProfileBroadcastMessage(value: unknown): value is { type: 'PROFILE_CHANGED' } {
    return typeof value === 'object'
      && value !== null
      && Object.keys(value).length === 1
      && 'type' in value
      && value.type === 'PROFILE_CHANGED'
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
          if (isProfileBroadcastMessage(event.data)) {
            void loadProfile({ force: true })
              .catch(reportBackgroundProfileError)
          }
          else if (isAuthBroadcastMessage(event.data)) {
            void backgroundAuthSynchronizationQueue.request(false)
              .catch(reportBackgroundSynchronizationError)
          }
        })
      }
      catch {
        authChannel = null
      }
    }

    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        void backgroundAuthSynchronizationQueue.request(true)
          .catch(reportBackgroundSynchronizationError)
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

  function loadProfile(
    options: LoadProfileOptions = {},
  ): Promise<CurrentUserProfileDto | null> {
    return profileCoordinator.loadProfile(options)
  }

  function updateProfile(
    patch: UpdateCurrentUserProfileRequestDto,
  ): Promise<CurrentUserProfileDto> {
    return profileCoordinator.updateProfile(patch)
  }

  async function refreshProfileAfterMutation(): Promise<CurrentUserProfileDto | null> {
    const refreshedProfile = await loadProfile({ force: true })
    // 管理接口可能更新当前登录用户；这里只广播无数据事件，让其他标签自行 GET。
    broadcast('PROFILE_CHANGED')
    return refreshedProfile
  }

  function clearProfile(): void {
    profileCoordinator.clearProfile()
  }

  function reportBackgroundProfileError(error: unknown): void {
    if (error instanceof StaleProfileStateError) {
      return
    }
    // 原始请求错误可能包含 URL 或配置；后台刷新只输出固定脱敏文本。
    console.error('[profile] Background synchronization failed')
  }

  watch(authState, (state) => {
    if (state === 'authenticated') {
      void loadProfile().catch(reportBackgroundProfileError)
    }
    else {
      clearProfile()
    }
  }, { flush: 'sync' })

  async function initializeAuth(): Promise<AuthContextDto | null> {
    startAuthSynchronization()
    return coordinator.revalidateAuth()
  }

  async function revalidateAuth(): Promise<AuthContextDto | null> {
    const pendingNotice = lifecycleState.errorCode === 'PASSWORD_CHANGE_RESULT_UNKNOWN'
      ? lifecycleState.errorCode
      : null
    const context = await revalidateAndReconcile(true)
    if (pendingNotice !== null && context === null) {
      lifecycleState.errorCode = pendingNotice
    }
    return context
  }

  function revalidateAfterMutation(): Promise<AuthContextDto | null> {
    return revalidateAndReconcile(true, 'mutation')
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
    profile,
    profileState,
    profileErrorCode,
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
    loadProfile,
    updateProfile,
    refreshProfileAfterMutation,
    clearProfile,
    logout,
    logoutAll,
  }
}, {
  // 浏览器身份只允许由本次启动的 /api/auth/me 建立，禁止 Pinia hydrate 旧认证状态。
  persist: false,
})
