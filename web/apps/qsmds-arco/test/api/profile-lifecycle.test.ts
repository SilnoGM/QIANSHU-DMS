import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- Profile 生命周期协调器使用 Node.js 内置 runner。
import test from 'node:test'

import {
  ProfileLifecycleCoordinator,
  ProfileMutationResultUnknownError,
  StaleProfileStateError,
} from '../../src/store/modules/app/profile-lifecycle'

const PROFILE_ONE = {
  avatarUrl: null,
  createdAt: '2026-07-20T00:00:00.000Z',
  email: 'operator@example.com',
  mobileE164: '+8613800138000',
  updatedAt: '2026-07-20T00:00:00.000Z',
  userId: 'user-1',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

test('并发 Profile GET 去重，并在同一 authEpoch 与 userId 下应用响应', async () => {
  const response = deferred<typeof PROFILE_ONE>()
  const signals: AbortSignal[] = []
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: (signal) => {
      signals.push(signal)
      return response.promise
    },
    onProfileChanged: () => undefined,
    updateProfile: () => Promise.resolve(PROFILE_ONE),
  })

  const first = coordinator.loadProfile()
  const second = coordinator.loadProfile()

  assert.equal(first, second)
  assert.equal(signals.length, 1)
  assert.equal(coordinator.state.profileState, 'loading')

  response.resolve(PROFILE_ONE)
  assert.deepEqual(await first, PROFILE_ONE)
  assert.deepEqual(coordinator.state.profile, PROFILE_ONE)
  assert.equal(coordinator.state.profileState, 'ready')
  assert.equal(coordinator.state.profileErrorCode, null)
})

test('身份清理会同步清空 Profile、取消请求并拒绝旧响应写回', async () => {
  const response = deferred<typeof PROFILE_ONE>()
  let signal!: AbortSignal
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: (requestSignal) => {
      signal = requestSignal
      return response.promise
    },
    onProfileChanged: () => undefined,
    updateProfile: () => Promise.resolve(PROFILE_ONE),
  })

  const pending = coordinator.loadProfile()
  coordinator.clearProfile()

  assert.equal(signal.aborted, true)
  assert.equal(coordinator.state.profile, null)
  assert.equal(coordinator.state.profileState, 'idle')

  response.resolve(PROFILE_ONE)
  await assert.rejects(pending, error => error instanceof StaleProfileStateError)
  assert.equal(coordinator.state.profile, null)
})

test('force Profile GET 会跨过旧请求并只保留事件后的服务端事实', async () => {
  const oldResponse = deferred<typeof PROFILE_ONE>()
  const freshProfile = {
    ...PROFILE_ONE,
    email: 'fresh@example.com',
  }
  const signals: AbortSignal[] = []
  let calls = 0
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: (signal) => {
      signals.push(signal)
      calls += 1
      return calls === 1
        ? oldResponse.promise
        : Promise.resolve(freshProfile)
    },
    onProfileChanged: () => undefined,
    updateProfile: () => Promise.resolve(PROFILE_ONE),
  })

  const oldRequest = coordinator.loadProfile()
  assert.deepEqual(
    await coordinator.loadProfile({ force: true }),
    freshProfile,
  )
  assert.equal(signals[0]?.aborted, true)

  oldResponse.resolve(PROFILE_ONE)
  await assert.rejects(
    oldRequest,
    error => error instanceof StaleProfileStateError,
  )
  assert.deepEqual(coordinator.state.profile, freshProfile)
})

test('即使请求未被取消，authEpoch 改变也拒绝迟到 Profile', async () => {
  const response = deferred<typeof PROFILE_ONE>()
  let identity = { authEpoch: 4, userId: 'user-1' }
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => identity,
    getProfile: () => response.promise,
    onProfileChanged: () => undefined,
    updateProfile: () => Promise.resolve(PROFILE_ONE),
  })

  const pending = coordinator.loadProfile()
  identity = { authEpoch: 5, userId: 'user-1' }
  response.resolve(PROFILE_ONE)

  await assert.rejects(pending, error => error instanceof StaleProfileStateError)
  assert.equal(coordinator.state.profile, null)
  assert.equal(coordinator.state.profileState, 'loading')
})

test('即使 authEpoch 相同，当前 userId 改变也拒绝迟到 Profile', async () => {
  const response = deferred<typeof PROFILE_ONE>()
  let identity = { authEpoch: 4, userId: 'user-1' }
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => identity,
    getProfile: () => response.promise,
    onProfileChanged: () => undefined,
    updateProfile: () => Promise.resolve(PROFILE_ONE),
  })

  const pending = coordinator.loadProfile()
  identity = { authEpoch: 4, userId: 'user-2' }
  response.resolve(PROFILE_ONE)

  await assert.rejects(pending, error => error instanceof StaleProfileStateError)
  assert.equal(coordinator.state.profile, null)
  assert.equal(coordinator.state.profileState, 'loading')
})

test('Profile GET 故障只进入资料 unavailable，并使用脱敏错误码', async () => {
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: () => Promise.reject(Object.assign(
      new Error('profile unavailable'),
      {
        body: { code: 'PROFILE_SERVICE_UNAVAILABLE', detail: 'sensitive' },
        kind: 'http',
        status: 503,
      },
    )),
    onProfileChanged: () => undefined,
    updateProfile: () => Promise.resolve(PROFILE_ONE),
  })

  assert.equal(await coordinator.loadProfile(), null)
  assert.equal(coordinator.state.profile, null)
  assert.equal(coordinator.state.profileState, 'unavailable')
  assert.equal(
    coordinator.state.profileErrorCode,
    'PROFILE_SERVICE_UNAVAILABLE',
  )
})

test('资料更新成功整体替换缓存，并只发送无数据的变更事件', async () => {
  const changedEvents: unknown[][] = []
  const updated = {
    ...PROFILE_ONE,
    avatarUrl: 'https://cdn.example.com/avatar.png',
    updatedAt: '2026-07-20T01:00:00.000Z',
  }
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: () => Promise.resolve(PROFILE_ONE),
    onProfileChanged: (...args: unknown[]) => changedEvents.push(args),
    updateProfile: () => Promise.resolve(updated),
  })

  assert.deepEqual(await coordinator.updateProfile({
    avatarUrl: updated.avatarUrl,
  }), updated)
  assert.deepEqual(coordinator.state.profile, updated)
  assert.deepEqual(changedEvents, [[]])
})

test('PATCH 开始后使更早的 GET 失效，旧响应不能覆盖 mutation 响应', async () => {
  const oldResponse = deferred<typeof PROFILE_ONE>()
  const updated = {
    ...PROFILE_ONE,
    mobileE164: '+8613900139000',
  }
  let oldSignal!: AbortSignal
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: (signal) => {
      oldSignal = signal
      return oldResponse.promise
    },
    onProfileChanged: () => undefined,
    updateProfile: () => Promise.resolve(updated),
  })

  const oldRequest = coordinator.loadProfile()
  assert.deepEqual(
    await coordinator.updateProfile({ mobileE164: updated.mobileE164 }),
    updated,
  )
  assert.equal(oldSignal.aborted, true)

  oldResponse.resolve(PROFILE_ONE)
  await assert.rejects(
    oldRequest,
    error => error instanceof StaleProfileStateError,
  )
  assert.deepEqual(coordinator.state.profile, updated)
})

test('PATCH 在途时收到的跨标签 force GET 会在 mutation settle 后刷新最新状态', async () => {
  const mutationResponse = deferred<typeof PROFILE_ONE>()
  const synchronizationResponse = deferred<typeof PROFILE_ONE>()
  const mutationProfile = {
    ...PROFILE_ONE,
    email: 'mutation@example.com',
  }
  const synchronizedProfile = {
    ...PROFILE_ONE,
    email: 'newer-cross-tab@example.com',
  }
  const synchronizationSignals: AbortSignal[] = []
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: (signal) => {
      synchronizationSignals.push(signal)
      return synchronizationResponse.promise
    },
    onProfileChanged: () => undefined,
    updateProfile: () => mutationResponse.promise,
  })

  const mutation = coordinator.updateProfile({ email: mutationProfile.email })
  const synchronization = coordinator.loadProfile({ force: true })
  const duplicateSynchronization = coordinator.loadProfile({ force: true })
  assert.equal(synchronization, duplicateSynchronization)
  assert.equal(synchronizationSignals.length, 0)

  mutationResponse.resolve(mutationProfile)
  assert.deepEqual(await mutation, mutationProfile)
  assert.equal(synchronizationSignals.length, 1)
  assert.equal(synchronizationSignals[0]?.aborted, false)
  assert.deepEqual(coordinator.state.profile, mutationProfile)

  synchronizationResponse.resolve(synchronizedProfile)
  assert.deepEqual(await synchronization, synchronizedProfile)
  assert.deepEqual(await duplicateSynchronization, synchronizedProfile)
  assert.deepEqual(coordinator.state.profile, synchronizedProfile)
})

test('身份清理会拒绝 mutation 期间排队的 force GET，settle 后不再发起请求', async () => {
  const mutationResponse = deferred<typeof PROFILE_ONE>()
  let profileGetCalls = 0
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: () => {
      profileGetCalls += 1
      return Promise.resolve(PROFILE_ONE)
    },
    onProfileChanged: () => undefined,
    updateProfile: () => mutationResponse.promise,
  })

  const mutation = coordinator.updateProfile({ email: 'mutation@example.com' })
  const queuedSynchronization = coordinator.loadProfile({ force: true })
  const queuedRejection = assert.rejects(
    queuedSynchronization,
    error => error instanceof StaleProfileStateError,
  )

  coordinator.clearProfile()
  await queuedRejection
  mutationResponse.resolve({
    ...PROFILE_ONE,
    email: 'mutation@example.com',
  })
  await assert.rejects(
    mutation,
    error => error instanceof StaleProfileStateError,
  )

  assert.equal(profileGetCalls, 0)
  assert.equal(coordinator.state.profile, null)
  assert.equal(coordinator.state.profileState, 'idle')
})

test('未知 mutation 结果强制 GET；只在提交字段一致时收敛为成功', async () => {
  const networkError = Object.assign(new Error('transport unavailable'), {
    kind: 'network',
  })
  const changedEvents: unknown[][] = []
  let reloaded = { ...PROFILE_ONE, email: 'new@example.com' }
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: () => Promise.resolve(reloaded),
    onProfileChanged: (...args: unknown[]) => changedEvents.push(args),
    updateProfile: () => Promise.reject(networkError),
  })

  assert.deepEqual(
    await coordinator.updateProfile({ email: 'new@example.com' }),
    reloaded,
  )
  assert.deepEqual(changedEvents, [[]])

  reloaded = { ...PROFILE_ONE, email: 'different@example.com' }
  await assert.rejects(
    coordinator.updateProfile({ email: 'not-applied@example.com' }),
    error => error instanceof ProfileMutationResultUnknownError,
  )
  assert.equal(coordinator.state.profileState, 'ready')
  assert.equal(
    coordinator.state.profileErrorCode,
    'PROFILE_UPDATE_RESULT_UNKNOWN',
  )
})

test('同一 identity 下响应 userId 不一致时拒绝写入 Profile', async () => {
  const coordinator = new ProfileLifecycleCoordinator({
    getIdentity: () => ({ authEpoch: 1, userId: 'user-1' }),
    getProfile: () => Promise.resolve({
      ...PROFILE_ONE,
      userId: 'user-2',
    }),
    onProfileChanged: () => undefined,
    updateProfile: () => Promise.resolve(PROFILE_ONE),
  })

  await assert.rejects(
    coordinator.loadProfile(),
    error => error instanceof StaleProfileStateError,
  )
  assert.equal(coordinator.state.profile, null)
})
