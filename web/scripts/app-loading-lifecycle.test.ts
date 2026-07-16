import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 `tsx --test` 直接运行，不引入额外测试框架。
import test from 'node:test'
import {
  APP_LOADING_MINIMUM_DURATION_ANIMATION,
  finishAppLoadingAfterMinimumDuration,
} from '../apps/qsmds-arco/src/router/loading'

interface Deferred {
  promise: Promise<void>
  reject: (reason?: unknown) => void
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, reject, resolve }
}

function createLoadingElement(animations: Array<{ animationName?: string, finished: Promise<unknown> }>) {
  return {
    getAnimations: () => animations,
  }
}

test('短加载等待最短展示动画完成后再淡出', async () => {
  const minimumDuration = createDeferred()
  let fadeOutCount = 0

  const finishing = finishAppLoadingAfterMinimumDuration(
    createLoadingElement([{
      animationName: APP_LOADING_MINIMUM_DURATION_ANIMATION,
      finished: minimumDuration.promise,
    }]),
    () => fadeOutCount++,
  )

  await Promise.resolve()
  assert.equal(fadeOutCount, 0)

  minimumDuration.resolve()
  await finishing
  assert.equal(fadeOutCount, 1)
})

test('长加载在最短展示动画已经结束后立即淡出', async () => {
  let fadeOutCount = 0

  await finishAppLoadingAfterMinimumDuration(
    createLoadingElement([]),
    () => fadeOutCount++,
  )

  assert.equal(fadeOutCount, 1)
})

test('只等待最短展示动画，不受斜线和进度条无限动画阻塞', async () => {
  const unrelatedAnimation = createDeferred()
  let fadeOutCount = 0

  const finishing = finishAppLoadingAfterMinimumDuration(
    createLoadingElement([{
      animationName: 'qianshu-loading-progress',
      finished: unrelatedAnimation.promise,
    }]),
    () => fadeOutCount++,
  )

  await Promise.resolve()
  assert.equal(fadeOutCount, 1)
  await finishing
})

test('最短展示动画被取消时仍然解除 Loading', async () => {
  const minimumDuration = createDeferred()
  let fadeOutCount = 0

  const finishing = finishAppLoadingAfterMinimumDuration(
    createLoadingElement([{
      animationName: APP_LOADING_MINIMUM_DURATION_ANIMATION,
      finished: minimumDuration.promise,
    }]),
    () => fadeOutCount++,
  )

  minimumDuration.reject(new Error('animation cancelled'))
  await finishing
  assert.equal(fadeOutCount, 1)
})
