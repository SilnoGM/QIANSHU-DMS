import type { AuthContextDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 认证协调器使用 Node.js 内置 runner。
import test from 'node:test'

import {
  AuthLifecycleCoordinator,
  StaleAuthStateError,
} from '../../src/store/modules/app/auth-lifecycle'

const SESSION_ONE: AuthContextDto = {
  user: {
    id: 'user-1',
    username: 'operator',
    displayName: '操作员',
    mustChangePassword: false,
  },
  permissions: ['users:read'],
  session: {
    createdAt: '2026-07-17T00:00:00.000Z',
    lastActivityAt: '2026-07-17T01:00:00.000Z',
    idleExpiresAt: '2026-07-19T01:00:00.000Z',
    absoluteExpiresAt: '2026-08-16T00:00:00.000Z',
  },
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

function createFixture(
  getMe: (broadcastSessionInvalid: boolean) => Promise<AuthContextDto>,
) {
  const identityBoundaries: Array<AuthContextDto | null> = []
  const mutationRevalidations: AuthContextDto[] = []
  const permissionChanges: string[][] = []
  const coordinator = new AuthLifecycleCoordinator({
    getMe: (_signal, broadcastSessionInvalid) =>
      getMe(broadcastSessionInvalid),
    onIdentityBoundary: context => identityBoundaries.push(context),
    onMutationRevalidated: context => mutationRevalidations.push(context),
    onPermissionsChanged: permissions => permissionChanges.push(permissions),
  })
  return {
    coordinator,
    identityBoundaries,
    mutationRevalidations,
    permissionChanges,
  }
}

test('启动和 passive revalidation 共享一个 /me，并应用完整身份', async () => {
  const response = deferred<AuthContextDto>()
  let calls = 0
  const fixture = createFixture(() => {
    calls += 1
    return response.promise
  })

  const first = fixture.coordinator.revalidateAuth()
  const second = fixture.coordinator.revalidateAuth()
  assert.equal(first, second)
  assert.equal(calls, 1)

  response.resolve(SESSION_ONE)
  await first

  assert.equal(fixture.coordinator.state.authState, 'authenticated')
  assert.deepEqual(fixture.coordinator.state.authContext, SESSION_ONE)
  assert.equal(fixture.coordinator.state.authEpoch, 1)
  assert.deepEqual(fixture.identityBoundaries, [SESSION_ONE])
  assert.equal(fixture.coordinator.revalidatePromise, null)
})

test('BroadcastChannel 触发的 passive /me 标记为不再次广播身份失效', async () => {
  const broadcastPolicies: boolean[] = []
  const fixture = createFixture((broadcastSessionInvalid) => {
    broadcastPolicies.push(broadcastSessionInvalid)
    return Promise.resolve(SESSION_ONE)
  })

  await fixture.coordinator.revalidateAuth({
    broadcastSessionInvalid: false,
  })

  assert.deepEqual(broadcastPolicies, [false])
})

test('相同 user/session 只刷新资料和权限，不推进 epoch 或全量清理', () => {
  const fixture = createFixture(() => Promise.resolve(SESSION_ONE))
  fixture.coordinator.applyAuthContext(SESSION_ONE)

  const refreshed: AuthContextDto = {
    ...SESSION_ONE,
    user: { ...SESSION_ONE.user, displayName: '新显示名称' },
    permissions: ['roles:read'],
    session: {
      ...SESSION_ONE.session,
      lastActivityAt: '2026-07-17T02:00:00.000Z',
    },
  }
  fixture.coordinator.applyAuthContext(refreshed)

  assert.equal(fixture.coordinator.state.authEpoch, 1)
  assert.equal(fixture.coordinator.state.authContext?.user.displayName, '新显示名称')
  assert.deepEqual(fixture.identityBoundaries, [SESSION_ONE])
  assert.deepEqual(fixture.permissionChanges, [['roles:read']])
})

test('不同 Session 先阻断旧 Shell、推进 epoch 并清理身份域', () => {
  const fixture = createFixture(() => Promise.resolve(SESSION_ONE))
  fixture.coordinator.applyAuthContext(SESSION_ONE)
  const rotated = {
    ...SESSION_ONE,
    session: {
      ...SESSION_ONE.session,
      createdAt: '2026-07-18T00:00:00.000Z',
    },
  }

  fixture.coordinator.applyAuthContext(rotated)

  assert.equal(fixture.coordinator.state.authEpoch, 2)
  assert.deepEqual(fixture.coordinator.state.authContext, rotated)
  assert.deepEqual(fixture.identityBoundaries, [SESSION_ONE, rotated])
})

test('旧 revalidation 迟到时拒绝写回，mutation 后必须发起 fresh /me', async () => {
  const oldResponse = deferred<AuthContextDto>()
  const freshResponse = deferred<AuthContextDto>()
  let calls = 0
  const fixture = createFixture(() => {
    calls += 1
    return calls === 1 ? oldResponse.promise : freshResponse.promise
  })

  const oldRequest = fixture.coordinator.revalidateAuth()
  const freshRequest = fixture.coordinator.revalidateAfterMutation()
  assert.equal(calls, 2)

  oldResponse.resolve(SESSION_ONE)
  await assert.rejects(oldRequest, error => error instanceof StaleAuthStateError)
  assert.equal(fixture.coordinator.state.authContext, null)

  freshResponse.resolve(SESSION_ONE)
  await freshRequest
  assert.equal(fixture.coordinator.state.authContext?.user.id, 'user-1')
  assert.equal(fixture.coordinator.state.authEpoch, 1)
  assert.deepEqual(fixture.mutationRevalidations, [SESSION_ONE])
})

test('Axios 已处理 fresh /me 的 401 时返回 anonymous 而不是 stale', async () => {
  const authenticationRequired = {
    body: {
      code: 'AUTHENTICATION_REQUIRED',
      message: '需要登录',
      requestId: 'req-auth-required-after-mutation',
    },
    kind: 'http',
    status: 401,
  }
  let coordinator!: AuthLifecycleCoordinator
  const fixture = createFixture(async () => {
    // 模拟 Axios response interceptor 在 Promise 拒绝前同步完成统一身份清理。
    coordinator.handleSessionInvalid(coordinator.state.authEpoch)
    throw authenticationRequired
  })
  coordinator = fixture.coordinator
  coordinator.applyAuthContext(SESSION_ONE)

  const context = await coordinator.revalidateAfterMutation()

  assert.equal(context, null)
  assert.equal(coordinator.state.authState, 'anonymous')
  assert.equal(coordinator.state.authContext, null)
  assert.deepEqual(fixture.mutationRevalidations, [])
})

test('确定 401 清理身份；Network/5xx 进入 unavailable 且不伪装退出', async () => {
  const authenticationRequired = {
    body: {
      code: 'AUTHENTICATION_REQUIRED',
      message: '需要登录',
      requestId: 'req-auth-required',
    },
    kind: 'http',
    status: 401,
  }
  const authenticated = createFixture(() => Promise.reject(authenticationRequired))
  authenticated.coordinator.applyAuthContext(SESSION_ONE)

  await authenticated.coordinator.revalidateAuth()
  assert.equal(authenticated.coordinator.state.authState, 'anonymous')
  assert.equal(authenticated.coordinator.state.authContext, null)
  assert.equal(authenticated.coordinator.state.authEpoch, 2)

  const network = {
    code: 'NETWORK_ERROR',
    kind: 'network',
    message: '网络连接失败，请稍后重试',
  }
  const unavailable = createFixture(() => Promise.reject(network))
  unavailable.coordinator.applyAuthContext(SESSION_ONE)

  await unavailable.coordinator.revalidateAuth()
  assert.equal(unavailable.coordinator.state.authState, 'unavailable')
  assert.equal(unavailable.coordinator.state.authContext?.user.id, 'user-1')
  assert.equal(unavailable.coordinator.state.authEpoch, 1)
  assert.equal(unavailable.coordinator.state.errorCode, 'NETWORK_ERROR')
})

test('mustChangePassword 映射为强制改密状态，空身份 401 幂等进入 anonymous', async () => {
  const forced = {
    ...SESSION_ONE,
    user: { ...SESSION_ONE.user, mustChangePassword: true },
  }
  const fixture = createFixture(() => Promise.resolve(forced))
  await fixture.coordinator.revalidateAuth()
  assert.equal(fixture.coordinator.state.authState, 'password_change_required')

  const epoch = fixture.coordinator.state.authEpoch
  fixture.coordinator.handleSessionInvalid(epoch)
  fixture.coordinator.handleSessionInvalid(fixture.coordinator.state.authEpoch)
  assert.equal(fixture.coordinator.state.authState, 'anonymous')
  assert.equal(fixture.coordinator.state.authEpoch, epoch + 1)
})
