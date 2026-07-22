import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- 此脚本由 `tsx --test` 直接运行，不引入额外测试框架。
import test from 'node:test'
import {
  AppFontLoadingError,
  APP_LOADING_MINIMUM_DURATION_ANIMATION,
  finishAppLoadingAfterMinimumDuration,
  finishInitialAppLoading,
  REQUIRED_APP_FONTS,
  waitForRequiredAppFonts,
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

function assertFontLoadingErrorCode(expectedCode: string) {
  return (error: unknown) => {
    assert.ok(error instanceof AppFontLoadingError)
    assert.equal(error.code, expectedCode)
    return true
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

test('核心 Sans 与 Mono 样本均完成加载并通过可用性检查', async () => {
  const loadCalls: Array<{ descriptor: string, sample: string }> = []
  const checkCalls: Array<{ descriptor: string, sample: string }> = []

  await waitForRequiredAppFonts({
    async load(descriptor, sample) {
      loadCalls.push({ descriptor, sample })
      return [{}]
    },
    check(descriptor, sample) {
      checkCalls.push({ descriptor, sample })
      return true
    },
  })

  assert.deepEqual(loadCalls, REQUIRED_APP_FONTS)
  assert.deepEqual(checkCalls, REQUIRED_APP_FONTS)
})

test('字体加载请求拒绝时传播稳定错误码', async () => {
  await assert.rejects(
    waitForRequiredAppFonts({
      async load() {
        throw new Error('network failed')
      },
      check: () => true,
    }),
    assertFontLoadingErrorCode('FONT_LOAD_FAILED'),
  )
})

test('字体未注册时不能把空加载结果误判为系统字体可用', async () => {
  await assert.rejects(
    waitForRequiredAppFonts({
      async load() {
        return []
      },
      check: () => true,
    }),
    assertFontLoadingErrorCode('FONT_NOT_REGISTERED'),
  )
})

test('字体加载完成但检查失败时传播可用性错误', async () => {
  await assert.rejects(
    waitForRequiredAppFonts({
      async load() {
        return [{}]
      },
      check: () => false,
    }),
    assertFontLoadingErrorCode('FONT_CHECK_FAILED'),
  )
})

test('字体加载超过受控时限时传播超时错误', async () => {
  const neverFinishes = createDeferred()
  let triggerTimeout: (() => void) | undefined

  const waiting = waitForRequiredAppFonts(
    {
      load: () => neverFinishes.promise.then(() => [{}]),
      check: () => true,
    },
    {
      cancelTimeout: () => {},
      scheduleTimeout: (callback) => {
        triggerTimeout = callback
        return 0
      },
      timeoutMs: 5_000,
    },
  )

  assert.ok(triggerTimeout)
  triggerTimeout()
  await assert.rejects(waiting, assertFontLoadingErrorCode('FONT_LOAD_TIMEOUT'))
})

test('路由、字体与最短动画全部完成后才淡出首屏', async () => {
  const routeReady = createDeferred()
  const fontsReady = createDeferred()
  const minimumDuration = createDeferred()
  let fadeOutCount = 0

  const finishing = finishInitialAppLoading({
    fadeOut: () => fadeOutCount++,
    fontsReady: fontsReady.promise,
    loadingElement: createLoadingElement([{
      animationName: APP_LOADING_MINIMUM_DURATION_ANIMATION,
      finished: minimumDuration.promise,
    }]),
    routeReady: routeReady.promise,
    showFontFailure: () => assert.fail('字体成功时不应进入失败状态'),
  })

  routeReady.resolve()
  await Promise.resolve()
  assert.equal(fadeOutCount, 0)

  fontsReady.resolve()
  await Promise.resolve()
  assert.equal(fadeOutCount, 0)

  minimumDuration.resolve()
  await finishing
  assert.equal(fadeOutCount, 1)
})

test('路由失败但字体成功时仍遵守最短动画并淡出一次', async () => {
  let fadeOutCount = 0

  await finishInitialAppLoading({
    fadeOut: () => fadeOutCount++,
    fontsReady: Promise.resolve(),
    loadingElement: createLoadingElement([]),
    routeReady: Promise.reject(new Error('route failed')),
    showFontFailure: () => assert.fail('路由失败不能伪装成字体失败'),
  })

  assert.equal(fadeOutCount, 1)
})

test('字体失败时进入诊断状态且绝不淡出首屏', async () => {
  const routeReady = createDeferred()
  const fontError = new AppFontLoadingError('FONT_LOAD_FAILED', 'font failed')
  let fadeOutCount = 0
  const failures: unknown[] = []

  const result = await finishInitialAppLoading({
    fadeOut: () => fadeOutCount++,
    fontsReady: Promise.reject(fontError),
    loadingElement: createLoadingElement([]),
    routeReady: routeReady.promise,
    showFontFailure: error => failures.push(error),
  })

  assert.equal(result, 'font-error')
  assert.equal(fadeOutCount, 0)
  assert.deepEqual(failures, [fontError])
})
