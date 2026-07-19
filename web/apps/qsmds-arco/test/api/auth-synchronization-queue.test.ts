import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 认证同步队列使用 Node.js 内置 runner 验证并发时序。
import test from 'node:test'

import {
  AuthSynchronizationQueue,
  LatestVersionTaskQueue,
} from '../../src/store/modules/app/auth-synchronization-queue'

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

test('认证广播在旧 /me 在途时到达会追加最新一轮，而不是复用旧结果后丢失', async () => {
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
