import type {
  AxiosResponse,
  GenericAbortSignal,
  InternalAxiosRequestConfig,
} from 'axios'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API 纯函数单元测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'

import {
  AxiosError,
  AxiosHeaders,
  CanceledError,
} from 'axios'

import {
  abortableSleep,
  fallbackRetryDelayMs,
  normalizeRetryCount,
  resolveRetryDelayMs,
  shouldRetry,
} from '../../src/api/retry'

function createAxiosError(
  status?: number,
  headers: AxiosResponse<unknown>['headers'] = {},
): AxiosError<unknown> {
  const config = {
    headers: new AxiosHeaders(),
  } as InternalAxiosRequestConfig
  if (status === undefined) {
    return new AxiosError(
      'network failure',
      AxiosError.ERR_NETWORK,
      config,
    )
  }

  const response: AxiosResponse<unknown> = {
    config,
    data: undefined,
    headers,
    status,
    statusText: 'Request failed',
  }
  return new AxiosError(
    'http failure',
    AxiosError.ERR_BAD_RESPONSE,
    config,
    undefined,
    response,
  )
}

function isCanceledError(error: unknown): boolean {
  return error instanceof CanceledError
    && error.code === AxiosError.ERR_CANCELED
}

function installTimerHarness(onClear: () => void = () => {}) {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const timerId = 1 as unknown as ReturnType<typeof setTimeout>
  let callback: (() => void) | undefined
  let clearCount = 0

  globalThis.setTimeout = ((handler: () => void) => {
    callback = handler
    return timerId
  }) as typeof setTimeout
  globalThis.clearTimeout = ((_timerId: ReturnType<typeof setTimeout>) => {
    clearCount += 1
    onClear()
  }) as typeof clearTimeout

  return {
    get clearCount() {
      return clearCount
    },
    restore() {
      globalThis.setTimeout = originalSetTimeout
      globalThis.clearTimeout = originalClearTimeout
    },
    run() {
      assert.notEqual(callback, undefined)
      callback?.()
    },
  }
}

test('normalizeRetryCount 仅规范化有限 number，且不向下 clamp 大整数', () => {
  assert.deepEqual(
    [3, 4, -1, 1.9, Number.NaN, Infinity, -Infinity]
      .map(value => normalizeRetryCount(value)),
    [3, 4, 0, 1, 0, 0, 0],
  )
  assert.deepEqual(
    [undefined, null, '2', true, {}, []]
      .map(value => normalizeRetryCount(value)),
    [0, 0, 0, 0, 0, 0],
  )
})

test('fallbackRetryDelayMs 返回受限 500/1000/2000ms 退避', () => {
  assert.deepEqual(
    [0, 1, 2].map(index => fallbackRetryDelayMs(index)),
    [500, 1000, 2000],
  )
  assert.deepEqual(
    [-1, 1.9, 3, 99].map(index => fallbackRetryDelayMs(index)),
    [500, 1000, 2000, 2000],
  )
})

test('shouldRetry 仅允许显式 retry 的幂等 method', () => {
  const networkError = createAxiosError()
  const retryableMethods = ['get', 'head', 'options', 'put', 'GET']
  const forbiddenMethods = ['post', 'patch', 'delete', undefined]

  for (const method of retryableMethods) {
    assert.equal(
      shouldRetry({ method, retry: true, retryCount: 0 }, networkError),
      true,
      method,
    )
  }
  for (const method of forbiddenMethods) {
    assert.equal(
      shouldRetry({ method, retry: true, retryCount: 0 }, networkError),
      false,
      String(method),
    )
  }
  assert.equal(
    shouldRetry({ method: 'get', retryCount: 0 }, networkError),
    false,
  )
  assert.equal(
    shouldRetry({ method: 'get', retry: false, retryCount: 0 }, networkError),
    false,
  )
})

test('shouldRetry 仅允许 network 与 HTTP 502/503/504', () => {
  const retryableStatuses = [502, 503, 504]
  const forbiddenStatuses = [400, 401, 403, 404, 409, 422, 429, 500]
  const config = { method: 'get', retry: true, retryCount: 0 }

  assert.equal(shouldRetry(config, createAxiosError()), true)
  for (const status of retryableStatuses) {
    assert.equal(shouldRetry(config, createAxiosError(status)), true, `${status}`)
  }
  for (const status of forbiddenStatuses) {
    assert.equal(shouldRetry(config, createAxiosError(status)), false, `${status}`)
  }
})

test('shouldRetry 对取消、已 aborted 或已耗尽次数始终返回 false', () => {
  const baseConfig = { method: 'get', retry: true }
  const countCases = [
    { expected: true, value: -1 },
    { expected: true, value: 1.9 },
    { expected: true, value: Number.NaN },
    { expected: true, value: Infinity },
    { expected: true, value: -Infinity },
    { expected: false, value: 3 },
    { expected: false, value: 4 },
  ]

  for (const { expected, value } of countCases) {
    assert.equal(
      shouldRetry({ ...baseConfig, retryCount: value }, createAxiosError()),
      expected,
      `retryCount=${String(value)}`,
    )
  }

  assert.equal(
    shouldRetry(
      { ...baseConfig, retryCount: 0 },
      new CanceledError('request canceled'),
    ),
    false,
  )
  assert.equal(
    shouldRetry(
      { ...baseConfig, retryCount: 0 },
      new AxiosError('request canceled', AxiosError.ERR_CANCELED),
    ),
    false,
  )
  assert.equal(
    shouldRetry({
      ...baseConfig,
      retryCount: 0,
      signal: { aborted: true },
    }, createAxiosError()),
    false,
  )
})

test('resolveRetryDelayMs 对 network、502 与 504 使用固定退避', () => {
  const now = () => Date.UTC(2026, 0, 1)

  assert.equal(resolveRetryDelayMs(createAxiosError(), 0, now), 500)
  assert.equal(resolveRetryDelayMs(createAxiosError(502), 1, now), 1000)
  assert.equal(resolveRetryDelayMs(createAxiosError(504), 2, now), 2000)
  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(502, { 'Retry-After': '4' }),
      1,
      now,
    ),
    1000,
  )
})

test('resolveRetryDelayMs 仅对 503 大小写不敏感解析完整非负整数秒', () => {
  const now = () => Date.UTC(2026, 0, 1)

  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(503, { 'rEtRy-AfTeR': '2' }),
      0,
      now,
    ),
    2000,
  )
  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(503, new AxiosHeaders({ 'Retry-After': '99' })),
      0,
      now,
    ),
    5000,
  )

  for (const invalidValue of ['1.5', '-1', '1e2', '+1', '1 second', '']) {
    assert.equal(
      resolveRetryDelayMs(
        createAxiosError(503, { 'Retry-After': invalidValue }),
        1,
        now,
      ),
      1000,
      invalidValue,
    )
  }
  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(503, { 'Retry-After': 2 }),
      1,
      now,
    ),
    1000,
  )
  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(503, {
        'Retry-After': '2',
        'retry-after': '2',
      }),
      1,
      now,
    ),
    1000,
  )
  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(503, {
        get: () => {
          throw new Error('raw Retry-After getter secret')
        },
      } as unknown as AxiosResponse<unknown>['headers']),
      1,
      now,
    ),
    1000,
  )
})

test('resolveRetryDelayMs 解析 503 HTTP 日期、过去日期与 5 秒上限', () => {
  const nowValue = Date.UTC(2026, 0, 1, 0, 0, 0)
  const now = () => nowValue

  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(503, {
        'Retry-After': new Date(nowValue + 3000).toUTCString(),
      }),
      0,
      now,
    ),
    3000,
  )
  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(503, {
        'Retry-After': new Date(nowValue - 1000).toUTCString(),
      }),
      0,
      now,
    ),
    0,
  )
  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(503, {
        'Retry-After': new Date(nowValue + 60_000).toUTCString(),
      }),
      0,
      now,
    ),
    5000,
  )
  assert.equal(
    resolveRetryDelayMs(
      createAxiosError(503, { 'Retry-After': 'not a date' }),
      2,
      now,
    ),
    2000,
  )
})

test('resolveRetryDelayMs 接受 RFC 9110 的三种 HTTP-date 严格语法', () => {
  const now = () => Date.UTC(2026, 0, 2, 0, 0, 0)
  const httpDates = [
    'Fri, 02 Jan 2026 00:00:03 GMT',
    'Friday, 02-Jan-26 00:00:03 GMT',
    'Fri Jan  2 00:00:03 2026',
  ]

  for (const retryAfter of httpDates) {
    assert.equal(
      resolveRetryDelayMs(
        createAxiosError(503, { 'Retry-After': retryAfter }),
        0,
        now,
      ),
      3000,
      retryAfter,
    )
  }
})

test('resolveRetryDelayMs 拒绝 day、month 或 GMT 使用 lowercase 的 HTTP-date', () => {
  const now = () => Date.UTC(2026, 0, 2, 0, 0, 0)
  const lowercaseDates = [
    { expected: 500, retryAfter: 'fri, 02 jan 2026 00:00:03 gmt', retryIndex: 0 },
    { expected: 1000, retryAfter: 'friday, 02-jan-26 00:00:03 gmt', retryIndex: 1 },
    { expected: 2000, retryAfter: 'fri jan  2 00:00:03 2026', retryIndex: 2 },
  ]

  for (const { expected, retryAfter, retryIndex } of lowercaseDates) {
    assert.equal(
      resolveRetryDelayMs(
        createAxiosError(503, { 'Retry-After': retryAfter }),
        retryIndex,
        now,
      ),
      expected,
      retryAfter,
    )
  }
})

test('resolveRetryDelayMs 拒绝 Date.parse 可接受但不属于 HTTP-date 的自然语言日期', () => {
  const now = () => Date.UTC(2026, 0, 2, 0, 0, 0)

  for (const retryAfter of ['January 2, 2026', 'Jan 02 2026']) {
    assert.equal(
      resolveRetryDelayMs(
        createAxiosError(503, { 'Retry-After': retryAfter }),
        1,
        now,
      ),
      1000,
      retryAfter,
    )
  }
})

test('abortableSleep 在入口已 aborted 时立即拒绝 CanceledError 且不注册 listener', async () => {
  let addCount = 0
  let removeCount = 0
  const signal: GenericAbortSignal = {
    aborted: true,
    addEventListener: () => {
      addCount += 1
    },
    removeEventListener: () => {
      removeCount += 1
    },
  }

  await assert.rejects(abortableSleep(60_000, signal), isCanceledError)
  assert.equal(addCount, 0)
  assert.equal(removeCount, 0)
})

test('abortableSleep 在 listener 注册竞态与等待期间 abort 时拒绝并移除 listener', async () => {
  let raceRemoveCount = 0
  const registrationRaceSignal: GenericAbortSignal & { aborted: boolean } = {
    aborted: false,
    addEventListener: () => {
      registrationRaceSignal.aborted = true
    },
    removeEventListener: () => {
      raceRemoveCount += 1
    },
  }
  await assert.rejects(
    abortableSleep(60_000, registrationRaceSignal),
    isCanceledError,
  )
  assert.equal(raceRemoveCount, 1)

  let abortListener: (() => void) | undefined
  let waitingRemoveCount = 0
  const waitingSignal: GenericAbortSignal & { aborted: boolean } = {
    aborted: false,
    addEventListener: (_event, listener: () => void) => {
      abortListener = listener
    },
    removeEventListener: () => {
      waitingRemoveCount += 1
    },
  }
  const sleeping = abortableSleep(60_000, waitingSignal)
  waitingSignal.aborted = true
  abortListener?.()

  await assert.rejects(sleeping, isCanceledError)
  assert.equal(waitingRemoveCount, 1)
})

test('abortableSleep 正常完成时移除 listener，缺失完整 listener API 时仍在 awake 检查', async () => {
  let removeCount = 0
  const normalSignal: GenericAbortSignal = {
    aborted: false,
    addEventListener: () => {},
    removeEventListener: () => {
      removeCount += 1
    },
  }

  await abortableSleep(0, normalSignal)
  assert.equal(removeCount, 1)

  const incompleteSignal: GenericAbortSignal & { aborted: boolean } = {
    aborted: false,
  }
  const sleeping = abortableSleep(0, incompleteSignal)
  incompleteSignal.aborted = true
  await assert.rejects(sleeping, isCanceledError)
})

test('abortableSleep 在 addEventListener 抛错时先清理 timer、尝试移除 listener 并拒绝原错误', async () => {
  const events: string[] = []
  const timers = installTimerHarness(() => events.push('clear'))
  const addError = new Error('add listener failed')
  const signal: GenericAbortSignal = {
    aborted: false,
    addEventListener: () => {
      throw addError
    },
    removeEventListener: () => {
      events.push('remove')
    },
  }

  try {
    await assert.rejects(abortableSleep(60_000, signal), error => error === addError)
    assert.deepEqual(events, ['clear', 'remove'])
    assert.equal(timers.clearCount, 1)
  }
  finally {
    timers.restore()
  }
})

test('abortableSleep 不让 removeEventListener 抛错阻止正常 resolve', async () => {
  const events: string[] = []
  const timers = installTimerHarness(() => events.push('clear'))
  const signal: GenericAbortSignal = {
    aborted: false,
    addEventListener: () => {},
    removeEventListener: () => {
      events.push('remove')
      throw new Error('remove listener failed')
    },
  }

  try {
    const sleeping = abortableSleep(60_000, signal)
    assert.doesNotThrow(() => timers.run())
    await sleeping
    assert.deepEqual(events, ['clear', 'remove'])
  }
  finally {
    timers.restore()
  }
})

test('abortableSleep 不让 removeEventListener 抛错阻止 abort 拒绝 CanceledError', async () => {
  const events: string[] = []
  const timers = installTimerHarness(() => events.push('clear'))
  let abortListener: (() => void) | undefined
  const signal: GenericAbortSignal & { aborted: boolean } = {
    aborted: false,
    addEventListener: (_event, listener: () => void) => {
      abortListener = listener
    },
    removeEventListener: () => {
      events.push('remove')
      throw new Error('remove listener failed')
    },
  }

  try {
    const sleeping = abortableSleep(60_000, signal)
    signal.aborted = true
    assert.doesNotThrow(() => abortListener?.())
    await assert.rejects(sleeping, isCanceledError)
    assert.deepEqual(events, ['clear', 'remove'])
  }
  finally {
    timers.restore()
  }
})
