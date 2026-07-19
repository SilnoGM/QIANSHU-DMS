import type { AuthContextDto } from '../../src/api/generated/types.gen'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 认证同步队列使用 Node.js 内置 runner 验证并发时序。
import test from 'node:test'

import {
  AuthLifecycleCoordinator,
  StaleAuthStateError,
} from '../../src/store/modules/app/auth-lifecycle'
import {
  AuthSynchronizationQueue,
  LatestVersionTaskQueue,
} from '../../src/store/modules/app/auth-synchronization-queue'

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

const SESSION_TWO: AuthContextDto = {
  ...SESSION_ONE,
  session: {
    ...SESSION_ONE.session,
    createdAt: '2026-07-18T00:00:00.000Z',
  },
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createCoordinator(
  getMe: (
    signal: AbortSignal,
    broadcastSessionInvalid: boolean,
  ) => Promise<AuthContextDto>,
) {
  const mutationRevalidations: AuthContextDto[] = []
  const coordinator = new AuthLifecycleCoordinator({
    getMe,
    onIdentityBoundary: () => undefined,
    onMutationRevalidated: context => mutationRevalidations.push(context),
    onPermissionsChanged: () => undefined,
  })
  return { coordinator, mutationRevalidations }
}

test('事件前已有 foreground /me 在途时，认证队列必须跨过旧请求后再发起新 /me', async () => {
  const oldResponse = deferred<AuthContextDto>()
  const eventResponse = deferred<AuthContextDto>()
  const signals: AbortSignal[] = []
  let calls = 0
  const { coordinator } = createCoordinator((signal) => {
    signals.push(signal)
    calls += 1
    return calls === 1 ? oldResponse.promise : eventResponse.promise
  })
  const queue = new AuthSynchronizationQueue(
    async (broadcastSessionInvalid) => {
      await coordinator.revalidateAfterSynchronizationEvent({
        broadcastSessionInvalid,
      })
    },
  )

  const foreground = coordinator.revalidateAuth()
  assert.equal(calls, 1)
  const event = queue.request(false)
  await Promise.resolve()

  // Broadcast 只能等待事件前的请求，不能为了制造 fresh /me 而中止它。
  assert.equal(signals[0]?.aborted, false)
  assert.equal(calls, 1)
  oldResponse.resolve(SESSION_ONE)
  await foreground
  await Promise.resolve()

  assert.equal(calls, 2)
  eventResponse.resolve(SESSION_TWO)
  await event
  assert.equal(coordinator.state.authContext?.session.createdAt, SESSION_TWO.session.createdAt)
})

test('事件前已有 mutation fresh /me 在途时，认证队列不取消 mutation 且在其后再校验', async () => {
  const mutationResponse = deferred<AuthContextDto>()
  const eventResponse = deferred<AuthContextDto>()
  const signals: AbortSignal[] = []
  let calls = 0
  const { coordinator, mutationRevalidations } = createCoordinator((signal) => {
    signals.push(signal)
    calls += 1
    return calls === 1 ? mutationResponse.promise : eventResponse.promise
  })
  const queue = new AuthSynchronizationQueue(
    async (broadcastSessionInvalid) => {
      await coordinator.revalidateAfterSynchronizationEvent({
        broadcastSessionInvalid,
      })
    },
  )

  const mutation = coordinator.revalidateAfterMutation()
  const event = queue.request(false)
  await Promise.resolve()

  assert.equal(signals[0]?.aborted, false)
  assert.equal(calls, 1)
  mutationResponse.resolve(SESSION_ONE)
  await mutation
  await Promise.resolve()

  assert.equal(calls, 2)
  assert.deepEqual(mutationRevalidations, [SESSION_ONE])
  eventResponse.resolve(SESSION_ONE)
  await event
})

test('同步事件等待旧 passive /me 时，mutation fresh /me 可以安全接管', async () => {
  const oldResponse = deferred<AuthContextDto>()
  const mutationResponse = deferred<AuthContextDto>()
  const signals: AbortSignal[] = []
  let calls = 0
  const { coordinator, mutationRevalidations } = createCoordinator((signal) => {
    signals.push(signal)
    calls += 1
    return calls === 1 ? oldResponse.promise : mutationResponse.promise
  })
  const queue = new AuthSynchronizationQueue(
    async (broadcastSessionInvalid) => {
      await coordinator.revalidateAfterSynchronizationEvent({
        broadcastSessionInvalid,
      })
    },
  )

  const passive = coordinator.revalidateAuth()
  const event = queue.request(false)
  await Promise.resolve()
  const mutation = coordinator.revalidateAfterMutation()

  assert.equal(calls, 2)
  assert.equal(signals[0]?.aborted, true)
  assert.equal(signals[1]?.aborted, false)
  oldResponse.resolve(SESSION_ONE)
  await assert.rejects(passive, error => error instanceof StaleAuthStateError)
  // 同步事件应复用事件后创建的 mutation fresh `/me`，不得再启动第三个请求。
  assert.equal(calls, 2)

  mutationResponse.resolve(SESSION_TWO)
  await Promise.all([mutation, event])
  assert.equal(signals[1]?.aborted, false)
  assert.deepEqual(mutationRevalidations, [SESSION_TWO])
  assert.equal(coordinator.state.authContext?.session.createdAt, SESSION_TWO.session.createdAt)
})

test('队列已发出 /me 后收到新广播会追加最新一轮', async () => {
  const firstRequest = deferred()
  const policies: boolean[] = []
  const queue = new AuthSynchronizationQueue(async (broadcastSessionInvalid) => {
    policies.push(broadcastSessionInvalid)
    if (policies.length === 1) {
      await firstRequest.promise
    }
  })

  const invalidated = queue.request(false)
  await Promise.resolve()
  assert.deepEqual(policies, [false])
  // 模拟旧 Session 的 /me 尚未结束时，另一标签已经完成重新登录。
  const authenticated = queue.request(false)
  firstRequest.resolve()

  await Promise.all([invalidated, authenticated])
  assert.deepEqual(policies, [false, false])
})

test('合并认证事件时保留需要广播 Session 失效的较强策略', async () => {
  const firstRequest = deferred()
  const policies: boolean[] = []
  const queue = new AuthSynchronizationQueue(async (broadcastSessionInvalid) => {
    policies.push(broadcastSessionInvalid)
    if (policies.length === 1) {
      await firstRequest.promise
    }
  })

  const broadcastRequest = queue.request(false)
  await Promise.resolve()
  assert.deepEqual(policies, [false])
  const pageShowRequest = queue.request(true)
  firstRequest.resolve()

  await Promise.all([broadcastRequest, pageShowRequest])
  assert.deepEqual(policies, [false, true])
})

test('路由协调失败后保留未完成版本，同版本下一次请求能够真正重试', async () => {
  const routeFailure = new Error('simulated route failure')
  let calls = 0
  const queue = new LatestVersionTaskQueue(async () => {
    calls += 1
    if (calls === 1) {
      throw routeFailure
    }
  })

  await assert.rejects(queue.request(1), error => error === routeFailure)
  assert.equal(queue.hasPending, true)

  await queue.request(1)
  assert.equal(calls, 2)
  assert.equal(queue.hasPending, false)
})

test('路由协调执行期间出现更高版本时，在同一 drain 中继续处理', async () => {
  const firstNavigation = deferred()
  let calls = 0
  const queue = new LatestVersionTaskQueue(async () => {
    calls += 1
    if (calls === 1) {
      await firstNavigation.promise
    }
  })

  const first = queue.request(1)
  await Promise.resolve()
  assert.equal(calls, 1)
  const second = queue.request(2)
  firstNavigation.resolve()

  await Promise.all([first, second])
  assert.equal(calls, 2)
  assert.equal(queue.hasPending, false)
})
