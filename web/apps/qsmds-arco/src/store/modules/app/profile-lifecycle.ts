import type {
  CurrentUserProfileDto,
  UpdateCurrentUserProfileRequestDto,
} from '@/api/generated/types.gen'

import { isProfilePatchApplied } from '../../../utils/user-profile'

export type ProfileState = 'idle' | 'loading' | 'ready' | 'unavailable'

export interface ProfileLifecycleState {
  profile: CurrentUserProfileDto | null
  profileState: ProfileState
  profileErrorCode: string | null
}

export interface ProfileIdentity {
  authEpoch: number
  userId: string
}

export interface ProfileLifecycleDependencies {
  getIdentity: () => ProfileIdentity | null
  getProfile: (signal: AbortSignal) => Promise<CurrentUserProfileDto>
  updateProfile: (
    patch: UpdateCurrentUserProfileRequestDto,
  ) => Promise<CurrentUserProfileDto>
  /** 回调没有参数，保证跨标签广播不可能夹带任何 Profile 字段。 */
  onProfileChanged: () => void
  state?: ProfileLifecycleState
}

export interface LoadProfileOptions {
  force?: boolean
}

interface QueuedForcedLoad {
  promise: Promise<CurrentUserProfileDto | null>
  reject: (error: unknown) => void
  resolve: (profile: CurrentUserProfileDto | null) => void
}

/** Profile 请求已被身份切换、更晚的 GET 或 mutation 作废。 */
export class StaleProfileStateError extends Error {
  constructor() {
    super('Profile state changed')
    this.name = 'StaleProfileStateError'
  }
}

/** mutation 可能成功，但强制 GET 无法证明提交字段已经生效。 */
export class ProfileMutationResultUnknownError extends Error {
  readonly code = 'PROFILE_UPDATE_RESULT_UNKNOWN'

  constructor() {
    super('Profile update result is unknown')
    this.name = 'ProfileMutationResultUnknownError'
  }
}

export function createProfileLifecycleState(): ProfileLifecycleState {
  return {
    profile: null,
    profileState: 'idle',
    profileErrorCode: null,
  }
}

/**
 * Profile 生命周期协调器只管理资料缓存和并发边界，不依赖 Pinia、Router 或 UI。
 * 身份快照同时包含 authEpoch 与 userId；请求版本另行阻止同一身份下旧 GET 覆盖
 * PATCH 或跨标签 force GET 的新结果。mutation 在途时收到的 force GET 会合并排队，
 * 等所有 mutation settle 后再读取一次，防止跨标签更新事件被本地旧响应吞掉。
 */
export class ProfileLifecycleCoordinator {
  readonly state: ProfileLifecycleState
  loadPromise: Promise<CurrentUserProfileDto | null> | null = null

  private loadVersion = 0
  private mutationVersion = 0
  private activeMutationCount = 0
  private loadController: AbortController | null = null
  private queuedForcedLoad: QueuedForcedLoad | null = null

  constructor(private readonly dependencies: ProfileLifecycleDependencies) {
    this.state = dependencies.state ?? createProfileLifecycleState()
  }

  loadProfile(
    options: LoadProfileOptions = {},
  ): Promise<CurrentUserProfileDto | null> {
    if (options.force === true && this.activeMutationCount > 0) {
      const identity = this.dependencies.getIdentity()
      if (identity === null || identity.userId === '') {
        this.clearProfile()
        return Promise.resolve(null)
      }
      return this.queueForcedLoad()
    }

    return this.loadProfileImmediately(options)
  }

  private loadProfileImmediately(
    options: LoadProfileOptions = {},
  ): Promise<CurrentUserProfileDto | null> {
    const identity = this.dependencies.getIdentity()
    if (identity === null || identity.userId === '') {
      this.clearProfile()
      return Promise.resolve(null)
    }

    if (options.force !== true) {
      if (this.loadPromise !== null) {
        return this.loadPromise
      }
      if (this.state.profileState === 'ready' && this.state.profile !== null) {
        return Promise.resolve(this.state.profile)
      }
    }
    else {
      this.invalidatePendingLoad()
    }

    return this.startLoad(identity)
  }

  clearProfile(): void {
    this.invalidatePendingLoad()
    this.rejectQueuedForcedLoad()
    // 身份域清理必须同时作废在途 mutation，避免退出登录或强制改密后旧响应写回。
    this.mutationVersion += 1
    this.state.profile = null
    this.state.profileState = 'idle'
    this.state.profileErrorCode = null
  }

  async updateProfile(
    patch: UpdateCurrentUserProfileRequestDto,
  ): Promise<CurrentUserProfileDto> {
    const identity = this.dependencies.getIdentity()
    if (identity === null || identity.userId === '') {
      throw new StaleProfileStateError()
    }

    // mutation 必须先跨过所有旧 GET；否则旧响应可能在 PATCH 后迟到并覆盖新资料。
    this.invalidatePendingLoad()
    this.mutationVersion += 1
    const mutationVersion = this.mutationVersion
    this.activeMutationCount += 1
    this.state.profileErrorCode = null

    try {
      const profile = await this.dependencies.updateProfile(patch)
      this.throwIfMutationStale(identity, mutationVersion, profile.userId)
      // PATCH 在途期间可能收到跨标签变更事件并启动 force GET。成功的 mutation
      // 是更新后的服务端事实，因此在应用它之前还要作废这些并发读取。
      this.invalidatePendingLoad()
      this.applyProfile(profile)
      this.dependencies.onProfileChanged()
      return profile
    }
    catch (error) {
      if (this.isMutationStale(identity, mutationVersion)) {
        throw new StaleProfileStateError()
      }
      if (!isUnknownMutationResult(error)) {
        throw error
      }

      // Network/5xx 不重试 mutation，只用事件后的强制 GET 对账本次提交字段。
      let profile: CurrentUserProfileDto | null
      try {
        // 这是当前 mutation 的结果对账，必须立即读取；若进入公开 force 队列，
        // 会等待当前 mutation settle，从而形成自等待。
        profile = await this.loadProfileImmediately({ force: true })
      }
      catch (revalidationError) {
        if (revalidationError instanceof StaleProfileStateError) {
          throw revalidationError
        }
        profile = null
      }

      if (this.isMutationStale(identity, mutationVersion)) {
        throw new StaleProfileStateError()
      }

      if (profile !== null && isProfilePatchApplied(profile, patch)) {
        this.state.profileErrorCode = null
        this.dependencies.onProfileChanged()
        return profile
      }

      this.state.profileErrorCode = 'PROFILE_UPDATE_RESULT_UNKNOWN'
      throw new ProfileMutationResultUnknownError()
    }
    finally {
      this.finishMutation()
    }
  }

  private startLoad(
    identity: ProfileIdentity,
  ): Promise<CurrentUserProfileDto | null> {
    const loadVersion = this.loadVersion
    const controller = new AbortController()
    this.loadController = controller
    this.state.profileState = 'loading'
    this.state.profileErrorCode = null

    const promise = this.dependencies.getProfile(controller.signal)
      .then((profile) => {
        this.throwIfLoadStale(identity, loadVersion, profile.userId)
        this.applyProfile(profile)
        return profile
      })
      .catch((error: unknown) => {
        if (
          error instanceof StaleProfileStateError
          || this.isLoadStale(identity, loadVersion)
        ) {
          throw new StaleProfileStateError()
        }

        this.state.profile = null
        this.state.profileState = 'unavailable'
        this.state.profileErrorCode = safeProfileErrorCode(error)
        return null
      })
      .finally(() => {
        if (this.loadPromise === promise) {
          this.loadPromise = null
          this.loadController = null
        }
      })

    this.loadPromise = promise
    return promise
  }

  private applyProfile(profile: CurrentUserProfileDto): void {
    this.state.profile = profile
    this.state.profileState = 'ready'
    this.state.profileErrorCode = null
  }

  private invalidatePendingLoad(): void {
    this.loadVersion += 1
    this.loadController?.abort()
    this.loadController = null
    this.loadPromise = null
  }

  private queueForcedLoad(): Promise<CurrentUserProfileDto | null> {
    if (this.queuedForcedLoad !== null) {
      return this.queuedForcedLoad.promise
    }

    let resolve!: (profile: CurrentUserProfileDto | null) => void
    let reject!: (error: unknown) => void
    const promise = new Promise<CurrentUserProfileDto | null>((
      resolvePromise,
      rejectPromise,
    ) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    this.queuedForcedLoad = { promise, reject, resolve }
    return promise
  }

  private finishMutation(): void {
    this.activeMutationCount = Math.max(0, this.activeMutationCount - 1)
    if (this.activeMutationCount > 0 || this.queuedForcedLoad === null) {
      return
    }

    const queued = this.queuedForcedLoad
    this.queuedForcedLoad = null
    try {
      void this.loadProfileImmediately({ force: true })
        .then(queued.resolve, queued.reject)
    }
    catch (error) {
      queued.reject(error)
    }
  }

  private rejectQueuedForcedLoad(): void {
    if (this.queuedForcedLoad === null) {
      return
    }
    const queued = this.queuedForcedLoad
    this.queuedForcedLoad = null
    queued.reject(new StaleProfileStateError())
  }

  private isIdentityStale(identity: ProfileIdentity): boolean {
    const currentIdentity = this.dependencies.getIdentity()
    return currentIdentity === null
      || currentIdentity.authEpoch !== identity.authEpoch
      || currentIdentity.userId !== identity.userId
  }

  private isLoadStale(
    identity: ProfileIdentity,
    loadVersion: number,
  ): boolean {
    return loadVersion !== this.loadVersion || this.isIdentityStale(identity)
  }

  private isMutationStale(
    identity: ProfileIdentity,
    mutationVersion: number,
  ): boolean {
    return mutationVersion !== this.mutationVersion
      || this.isIdentityStale(identity)
  }

  private throwIfLoadStale(
    identity: ProfileIdentity,
    loadVersion: number,
    responseUserId: string,
  ): void {
    if (
      this.isLoadStale(identity, loadVersion)
      || responseUserId !== identity.userId
    ) {
      throw new StaleProfileStateError()
    }
  }

  private throwIfMutationStale(
    identity: ProfileIdentity,
    mutationVersion: number,
    responseUserId: string,
  ): void {
    if (
      this.isMutationStale(identity, mutationVersion)
      || responseUserId !== identity.userId
    ) {
      throw new StaleProfileStateError()
    }
  }
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

function safeProfileErrorCode(error: unknown): string {
  if (typeof error !== 'object' || error === null) {
    return 'PROFILE_SERVICE_UNAVAILABLE'
  }
  if ('body' in error && typeof error.body === 'object' && error.body !== null) {
    const body = error.body
    if ('code' in body && typeof body.code === 'string') {
      return body.code
    }
  }
  return 'code' in error && typeof error.code === 'string'
    ? error.code
    : 'PROFILE_SERVICE_UNAVAILABLE'
}
