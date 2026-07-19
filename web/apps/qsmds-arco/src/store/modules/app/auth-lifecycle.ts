import type { AuthContextDto } from '@/api/generated/types.gen'

export type AuthState
  = | 'loading'
    | 'anonymous'
    | 'authenticated'
    | 'password_change_required'
    | 'logging_out'
    | 'unavailable'

export interface AuthLifecycleState {
  authState: AuthState
  authContext: AuthContextDto | null
  authEpoch: number
  errorCode: string | null
}

export interface AuthLifecycleDependencies {
  getMe: (
    signal: AbortSignal,
    broadcastSessionInvalid: boolean,
  ) => Promise<AuthContextDto>
  onIdentityBoundary: (nextContext: AuthContextDto | null) => void
  onMutationRevalidated: (context: AuthContextDto) => void
  onPermissionsChanged: (permissions: string[]) => void
  state?: AuthLifecycleState
}

export interface RevalidationOptions {
  broadcastSessionInvalid?: boolean
}

/** passive `/me` 已被新的身份边界或认证 mutation 作废。 */
export class StaleAuthStateError extends Error {
  constructor() {
    super('Authentication state changed')
    this.name = 'StaleAuthStateError'
  }
}

export function createAuthLifecycleState(): AuthLifecycleState {
  return {
    authState: 'loading',
    authContext: null,
    authEpoch: 0,
    errorCode: null,
  }
}

function contextIdentity(context: AuthContextDto | null): string | null {
  return context === null
    ? null
    : `${context.user.id}\u0000${context.session.createdAt}`
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  const rightSet = new Set(right)
  return left.every(value => rightSet.has(value))
}

function isAuthenticationRequired(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'kind' in error
    && error.kind === 'http'
    && 'status' in error
    && error.status === 401
    && 'body' in error
    && typeof error.body === 'object'
    && error.body !== null
    && 'code' in error.body
    && error.body.code === 'AUTHENTICATION_REQUIRED'
}

function safeErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'AUTH_SERVICE_UNAVAILABLE'
  }
  if ('body' in error && typeof error.body === 'object' && error.body !== null) {
    const body = error.body
    if ('code' in body && typeof body.code === 'string') {
      return body.code
    }
  }
  if ('code' in error && typeof error.code === 'string') {
    return error.code
  }
  return 'AUTH_SERVICE_UNAVAILABLE'
}

/**
 * 认证生命周期协调器只管理身份状态与并发边界，不依赖 Pinia、Router 或 UI。
 * Store 通过回调清理菜单、标签页和动态路由，因此单元测试可直接证明并发语义。
 */
export class AuthLifecycleCoordinator {
  readonly state: AuthLifecycleState
  revalidatePromise: Promise<AuthContextDto | null> | null = null

  private revalidationVersion = 0
  private revalidationController: AbortController | null = null

  constructor(private readonly dependencies: AuthLifecycleDependencies) {
    this.state = dependencies.state ?? createAuthLifecycleState()
  }

  applyAuthContext(context: AuthContextDto): void {
    const previous = this.state.authContext
    const identityChanged = contextIdentity(previous) !== contextIdentity(context)

    if (identityChanged) {
      // 必须先同步阻断业务 Shell，再清理旧身份域并应用新 Context。
      this.state.authState = 'loading'
      this.state.authEpoch += 1
      this.dependencies.onIdentityBoundary(context)
    }
    else if (
      previous !== null
      && !sameStringSet(previous.permissions, context.permissions)
    ) {
      this.dependencies.onPermissionsChanged([...context.permissions])
    }

    this.state.authContext = context
    this.state.errorCode = null
    this.state.authState = context.user.mustChangePassword
      ? 'password_change_required'
      : 'authenticated'
  }

  handleSessionInvalid(requestEpoch: number): boolean {
    if (requestEpoch !== this.state.authEpoch) {
      return false
    }

    if (this.state.authContext === null) {
      this.state.errorCode = null
      this.state.authState = 'anonymous'
      return false
    }

    this.state.authState = 'loading'
    this.state.authEpoch += 1
    this.invalidatePassiveRevalidation()
    this.dependencies.onIdentityBoundary(null)
    this.state.authContext = null
    this.state.errorCode = null
    this.state.authState = 'anonymous'
    return true
  }

  markLoggingOut(): void {
    if (this.state.authContext !== null) {
      this.state.authState = 'logging_out'
    }
  }

  restoreStateFromContext(): void {
    const context = this.state.authContext
    if (context === null) {
      this.state.authState = 'anonymous'
      return
    }
    this.state.authState = context.user.mustChangePassword
      ? 'password_change_required'
      : 'authenticated'
  }

  revalidateAuth(
    options: RevalidationOptions = {},
  ): Promise<AuthContextDto | null> {
    if (this.revalidatePromise !== null) {
      return this.revalidatePromise
    }
    return this.startRevalidation(options.broadcastSessionInvalid ?? true)
  }

  /**
   * 跨标签或 pageshow 事件代表“事件到达后的服务端事实”。若事件到达前已经有
   * `/me` 在途，普通去重会让该事件直接复用旧响应，因此这里先跨过旧请求，再
   * 保证至少有一轮事件后的 revalidation。
   *
   * 这里刻意不调用 invalidatePassiveRevalidation：在途请求可能是 mutation 的
   * fresh `/me`，同步事件只能等待或复用它，不能中止 mutation 的确定性收敛。
   */
  async revalidateAfterSynchronizationEvent(
    options: RevalidationOptions = {},
  ): Promise<AuthContextDto | null> {
    const pendingBeforeSynchronization = this.revalidatePromise
    if (pendingBeforeSynchronization !== null) {
      try {
        await pendingBeforeSynchronization
      }
      catch (error) {
        // 事件之后启动的 mutation 可能使旧 passive `/me` 变 stale。此时继续复用
        // mutation fresh `/me` 即可；其他异常仍应保留原失败传播语义。
        if (!(error instanceof StaleAuthStateError)) {
          throw error
        }
      }
    }
    return this.revalidateAuth(options)
  }

  revalidateAfterMutation(): Promise<AuthContextDto | null> {
    this.invalidatePassiveRevalidation()
    return this.startRevalidation(true).then((context) => {
      if (context !== null) {
        this.dependencies.onMutationRevalidated(context)
      }
      return context
    })
  }

  invalidatePassiveRevalidation(): void {
    this.revalidationVersion += 1
    this.revalidationController?.abort()
    this.revalidationController = null
    this.revalidatePromise = null
  }

  private startRevalidation(
    broadcastSessionInvalid: boolean,
  ): Promise<AuthContextDto | null> {
    const requestEpoch = this.state.authEpoch
    const requestVersion = this.revalidationVersion
    const controller = new AbortController()
    this.revalidationController = controller

    const promise = this.dependencies.getMe(
      controller.signal,
      broadcastSessionInvalid,
    )
      .then((context) => {
        this.throwIfRevalidationStale(requestEpoch, requestVersion)
        this.applyAuthContext(context)
        return context
      })
      .catch((error: unknown) => {
        const authenticationRequired = isAuthenticationRequired(error)
        const alreadyHandledByApiClient = authenticationRequired
          && this.state.authContext === null
          && this.state.authState === 'anonymous'
          && this.state.authEpoch === requestEpoch + 1
          && this.revalidationVersion === requestVersion + 1

        // `/me` 也经过 Axios 统一 401 interceptor。若它已同步完成同一请求的
        // epoch 推进和身份清理，这里应收敛为 anonymous，而不是把结果误判为 stale。
        if (alreadyHandledByApiClient) {
          return null
        }

        if (
          error instanceof StaleAuthStateError
          || requestEpoch !== this.state.authEpoch
          || requestVersion !== this.revalidationVersion
        ) {
          throw new StaleAuthStateError()
        }

        if (authenticationRequired) {
          this.handleSessionInvalid(requestEpoch)
          return null
        }

        // Network/5xx 不得伪装退出；根层会卸载业务 Shell并提供重新检查。
        this.state.errorCode = safeErrorCode(error)
        this.state.authState = 'unavailable'
        return null
      })
      .finally(() => {
        if (this.revalidatePromise === promise) {
          this.revalidatePromise = null
          this.revalidationController = null
        }
      })

    this.revalidatePromise = promise
    return promise
  }

  private throwIfRevalidationStale(
    requestEpoch: number,
    requestVersion: number,
  ): void {
    if (
      requestEpoch !== this.state.authEpoch
      || requestVersion !== this.revalidationVersion
    ) {
      throw new StaleAuthStateError()
    }
  }
}
