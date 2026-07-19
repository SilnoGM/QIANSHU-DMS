import type {
  AxiosAdapter,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios'
import type { ApiClientHooks } from '../../src/api/client'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test -- API Client 单元测试由 Node.js 内置 test runner 直接运行。
import test from 'node:test'

import {
  AxiosError,
  CanceledError,
  isCancel,
} from 'axios'

import {
  createApiClient,
  StaleAuthEpochError,
} from '../../src/api/client'

const validApiError = {
  code: 'VALIDATION_FAILED',
  message: '请检查输入内容',
  requestId: 'req_12345678-1234-4234-9234-123456789abc',
}

interface HookRecorder {
  hooks: ApiClientHooks
  authRevalidationCodes: string[]
  authEpochReads: number
  invalidationBroadcasts: boolean[]
  invalidatedEpochs: number[]
  languageReads: number
  notifications: string[]
}

function createHookRecorder(options: {
  getAuthEpoch?: () => number
  getAuthSignal?: () => AbortSignal
  getLanguage?: () => string
  handleSessionInvalid?: (
    requestEpoch: number,
    broadcastSessionInvalid: boolean,
  ) => void
  handleAuthRevalidationRequired?: (code: string) => void
  notifyError?: (message: string) => void
  now?: () => number
  sleep?: ApiClientHooks['sleep']
} = {}): HookRecorder {
  const invalidatedEpochs: number[] = []
  const invalidationBroadcasts: boolean[] = []
  const notifications: string[] = []
  const authRevalidationCodes: string[] = []
  let authEpochReads = 0
  let languageReads = 0
  const defaultAuthController = new AbortController()

  return {
    hooks: {
      getAuthEpoch: () => {
        authEpochReads += 1
        return options.getAuthEpoch?.() ?? 0
      },
      getAuthSignal: () =>
        options.getAuthSignal?.() ?? defaultAuthController.signal,
      getLanguage: () => {
        languageReads += 1
        return options.getLanguage?.() ?? 'zh-CN'
      },
      handleSessionInvalid: (requestEpoch, broadcastSessionInvalid) => {
        invalidatedEpochs.push(requestEpoch)
        invalidationBroadcasts.push(broadcastSessionInvalid)
        return options.handleSessionInvalid?.(
          requestEpoch,
          broadcastSessionInvalid,
        )
      },
      handleAuthRevalidationRequired: (code) => {
        authRevalidationCodes.push(code)
        return options.handleAuthRevalidationRequired?.(code)
      },
      notifyError: (message) => {
        notifications.push(message)
        return options.notifyError?.(message)
      },
      now: options.now,
      sleep: options.sleep,
    },
    authRevalidationCodes,
    get authEpochReads() {
      return authEpochReads
    },
    invalidationBroadcasts,
    invalidatedEpochs,
    get languageReads() {
      return languageReads
    },
    notifications,
  }
}

function createResponse<T>(
  config: InternalAxiosRequestConfig,
  data: T,
  options: {
    headers?: AxiosResponse<T>['headers']
    request?: unknown
    status?: number
    statusText?: string
  } = {},
): AxiosResponse<T> {
  return {
    config,
    data,
    headers: options.headers ?? {},
    request: options.request,
    status: options.status ?? 200,
    statusText: options.statusText ?? 'OK',
  }
}

function createHttpError(
  config: InternalAxiosRequestConfig,
  status: number,
  data: unknown,
  headers: AxiosResponse<unknown>['headers'] = {},
): AxiosError<unknown> {
  return new AxiosError(
    'raw axios secret',
    AxiosError.ERR_BAD_RESPONSE,
    config,
    undefined,
    createResponse(config, data, {
      headers,
      status,
      statusText: 'Request failed',
    }),
  )
}

function createNetworkError(
  config: InternalAxiosRequestConfig,
): AxiosError<unknown> {
  return new AxiosError(
    'raw network secret',
    AxiosError.ERR_NETWORK,
    config,
  )
}

function isCanceledError(error: unknown): boolean {
  return error instanceof CanceledError
    && error.code === AxiosError.ERR_CANCELED
    && isCancel(error)
}

test('成功请求保留 adapter 返回的完整 AxiosResponse', async () => {
  const responseData = { status: 'ok' }
  const request = { transport: 'test-adapter' }
  let adapterResponse: AxiosResponse<typeof responseData> | undefined
  const adapter: AxiosAdapter = async (config) => {
    adapterResponse = createResponse(config, responseData, {
      headers: { 'X-Request-Id': 'req_success' },
      request,
      status: 201,
      statusText: 'Created',
    })
    return adapterResponse
  }
  const recorder = createHookRecorder()
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  const response = await client.get<typeof responseData>('/health')

  assert.equal(response, adapterResponse)
  assert.deepEqual(response.data, responseData)
  assert.equal(response.status, 201)
  assert.equal(response.statusText, 'Created')
  assert.equal(response.headers.get('X-Request-Id'), 'req_success')
  assert.equal(response.config.url, '/health')
  assert.equal(response.config.baseURL, '/api/')
  assert.equal(response.request, request)
})

test('每个请求绑定当前身份域 AbortSignal 以便身份切换时取消在途业务请求', async () => {
  const authController = new AbortController()
  let capturedSignal: AbortSignal | undefined
  const recorder = createHookRecorder({
    getAuthSignal: () => authController.signal,
  })
  const client = createApiClient({
    adapter: async (config) => {
      capturedSignal = config.signal
      return createResponse(config, { ok: true })
    },
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await client.get('/protected')

  assert.equal(capturedSignal, authController.signal)
})

test('BroadcastChannel 的 /me 可禁止 401 身份清理再次广播', async () => {
  const recorder = createHookRecorder()
  const adapter: AxiosAdapter = async (config) => {
    throw createHttpError(config, 401, {
      ...validApiError,
      code: 'AUTHENTICATION_REQUIRED',
    })
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await assert.rejects(client.get('/auth/me', {
    broadcastSessionInvalid: false,
  }))

  assert.deepEqual(recorder.invalidatedEpochs, [0])
  assert.deepEqual(recorder.invalidationBroadcasts, [false])
})

test('每次请求动态读取语言、移除 Token，并为 Cookie 与 unsafe method 设置固定语义', async () => {
  let language = 'zh-CN'
  const configs: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (config) => {
    configs.push(config)
    return createResponse(config, { ok: true })
  }
  const recorder = createHookRecorder({
    getLanguage: () => language,
  })
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    fakeBaseURL: '/fake/',
    hooks: recorder.hooks,
  })

  await client.get('/menus', {
    fake: true,
    headers: { Token: 'legacy-token' },
  })
  language = 'en-US'
  await client.post('/users', { displayName: '操作员' }, {
    headers: { Token: 'caller-token' },
  })

  assert.equal(configs.length, 2)
  assert.equal(configs[0]?.baseURL, '/fake/')
  assert.equal(configs[0]?.headers.get('Accept-Language'), 'zh-CN')
  assert.equal(configs[0]?.headers.has('Token'), false)
  assert.equal(configs[0]?.withCredentials, true)
  assert.equal(configs[1]?.baseURL, '/api/')
  assert.equal(configs[1]?.headers.get('Accept-Language'), 'en-US')
  assert.equal(configs[1]?.headers.has('Token'), false)
  assert.equal(configs[1]?.headers.get('Content-Type'), 'application/json')
  assert.equal(configs[1]?.headers.get('X-Qianshu-CSRF'), '1')
  assert.equal(configs[1]?.withCredentials, true)
  assert.equal(recorder.languageReads, 2)
  assert.equal(recorder.authEpochReads, 4)
})

test('确定的 AUTHENTICATION_REQUIRED 才清理身份，403 只提示权限不足', async () => {
  for (const status of [401, 403]) {
    const recorder = createHookRecorder()
    const adapter: AxiosAdapter = async (config) => {
      throw createHttpError(config, status, {
        ...validApiError,
        code: status === 401
          ? 'AUTHENTICATION_REQUIRED'
          : 'FORBIDDEN',
        message: 'raw server authorization message',
      })
    }
    const client = createApiClient({
      adapter,
      baseURL: '/api/',
      hooks: recorder.hooks,
    })

    await assert.rejects(
      client.get('/protected'),
      error => typeof error === 'object'
        && error !== null
        && 'kind' in error
        && error.kind === 'http'
        && 'status' in error
        && error.status === status,
    )

    if (status === 401) {
      assert.deepEqual(recorder.invalidatedEpochs, [0])
      assert.deepEqual(recorder.notifications, [])
    }
    else {
      assert.deepEqual(recorder.invalidatedEpochs, [])
      assert.deepEqual(recorder.notifications, ['没有权限执行此操作'])
    }
  }
})

test('403 按错误码触发正确认证恢复与提示，页面本地处理时不重复 toast', async () => {
  const cases = [
    {
      code: 'FORBIDDEN',
      expectedAuthRevalidationCodes: [],
      expectedNotifications: ['没有权限执行此操作'],
    },
    {
      code: 'PASSWORD_CHANGE_REQUIRED',
      expectedAuthRevalidationCodes: ['PASSWORD_CHANGE_REQUIRED'],
      expectedNotifications: [],
    },
    {
      code: 'CSRF_REJECTED',
      expectedAuthRevalidationCodes: ['CSRF_REJECTED'],
      expectedNotifications: ['登录状态校验失败，请重试操作'],
    },
    {
      code: 'FUTURE_FORBIDDEN_REASON',
      expectedAuthRevalidationCodes: [],
      expectedNotifications: ['服务端提供的安全错误文案'],
    },
  ] as const

  for (const testCase of cases) {
    const recorder = createHookRecorder()
    const adapter: AxiosAdapter = async (config) => {
      throw createHttpError(config, 403, {
        ...validApiError,
        code: testCase.code,
        message: '服务端提供的安全错误文案',
      })
    }
    const client = createApiClient({
      adapter,
      baseURL: '/api/',
      hooks: recorder.hooks,
    })

    await assert.rejects(client.get('/protected'))

    assert.deepEqual(
      recorder.authRevalidationCodes,
      testCase.expectedAuthRevalidationCodes,
      testCase.code,
    )
    assert.deepEqual(
      recorder.notifications,
      testCase.expectedNotifications,
      testCase.code,
    )
  }

  const localRecorder = createHookRecorder()
  const localClient = createApiClient({
    adapter: async (config) => {
      throw createHttpError(config, 403, {
        ...validApiError,
        code: 'CSRF_REJECTED',
        message: '请求来源校验失败',
      })
    },
    baseURL: '/api/',
    hooks: localRecorder.hooks,
  })

  await assert.rejects(localClient.post('/form-mutation', {}, {
    errorPresentation: 'local',
  }))
  assert.deepEqual(localRecorder.authRevalidationCodes, ['CSRF_REJECTED'])
  assert.deepEqual(localRecorder.notifications, [])
})

test('handleSessionInvalid 同步抛错时仍拒绝 normalized 401，且不泄漏 hook 错误', async () => {
  const hookError = new Error('raw logout hook secret')
  const recorder = createHookRecorder({
    handleSessionInvalid: () => {
      throw hookError
    },
  })
  const adapter: AxiosAdapter = async (config) => {
    throw createHttpError(config, 401, {
      ...validApiError,
      code: 'AUTHENTICATION_REQUIRED',
    })
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  let rejected: unknown
  try {
    await client.get('/expired')
  }
  catch (error) {
    rejected = error
  }

  assert.deepEqual(rejected, {
    body: {
      ...validApiError,
      code: 'AUTHENTICATION_REQUIRED',
    },
    kind: 'http',
    status: 401,
  })
  assert.notEqual(rejected, hookError)
  assert.equal(JSON.stringify(rejected).includes('raw logout hook secret'), false)
  assert.deepEqual(recorder.invalidatedEpochs, [0])
  assert.deepEqual(recorder.notifications, [])
})

test('notifyError 异步拒绝时等待并隔离失败，最终仍拒绝 normalized 403', async () => {
  const hookError = new Error('raw notify hook secret')
  let thenCalled = false
  const rejectedThenable = {
    then: (
      _resolve: (value?: void) => void,
      reject: (reason: unknown) => void,
    ) => {
      thenCalled = true
      reject(hookError)
    },
  }
  const recorder = createHookRecorder({
    notifyError: () => rejectedThenable as unknown as void,
  })
  const adapter: AxiosAdapter = async (config) => {
    throw createHttpError(
      config,
      403,
      '<html>raw authorization response</html>',
    )
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  let rejected: unknown
  try {
    await client.get('/forbidden')
  }
  catch (error) {
    rejected = error
  }

  assert.equal(thenCalled, true)
  assert.deepEqual(rejected, {
    kind: 'http-unparseable',
    message: '服务器返回了无法识别的错误响应',
    status: 403,
  })
  assert.notEqual(rejected, hookError)
  assert.equal(JSON.stringify(rejected).includes('raw notify hook secret'), false)
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, ['服务器返回了无法识别的错误响应'])
})

test('401/403 的 unparseable response 不作为 Session 失效证明', async () => {
  for (const status of [401, 403]) {
    const recorder = createHookRecorder()
    const adapter: AxiosAdapter = async (config) => {
      throw createHttpError(
        config,
        status,
        '<html>raw authorization response</html>',
      )
    }
    const client = createApiClient({
      adapter,
      baseURL: '/api/',
      hooks: recorder.hooks,
    })

    await assert.rejects(
      client.get('/unparseable-authorization'),
      error => typeof error === 'object'
        && error !== null
        && 'kind' in error
        && error.kind === 'http-unparseable'
        && 'status' in error
        && error.status === status,
    )

    assert.deepEqual(recorder.invalidatedEpochs, [])
    assert.deepEqual(
      recorder.notifications,
      ['服务器返回了无法识别的错误响应'],
    )
  }
})

test('旧 epoch 的成功响应以内部取消错误结束，不写回或触发全局副作用', async () => {
  let authEpoch = 7
  const recorder = createHookRecorder({
    getAuthEpoch: () => authEpoch,
  })
  const adapter: AxiosAdapter = async (config) => {
    authEpoch += 1
    return createResponse(config, { shouldNotEscape: true })
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await assert.rejects(
    client.get('/late-success'),
    error => error instanceof StaleAuthEpochError && isCanceledError(error),
  )
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
})

test('旧 epoch 迟到的 AUTHENTICATION_REQUIRED 不得清理新身份', async () => {
  let authEpoch = 3
  const recorder = createHookRecorder({
    getAuthEpoch: () => authEpoch,
  })
  const adapter: AxiosAdapter = async (config) => {
    authEpoch += 1
    throw createHttpError(config, 401, {
      ...validApiError,
      code: 'AUTHENTICATION_REQUIRED',
    })
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await assert.rejects(
    client.get('/late-unauthorized'),
    error => error instanceof StaleAuthEpochError,
  )
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
})

test('INVALID_CREDENTIALS 保留给登录表单处理，不触发 Session 清理', async () => {
  const recorder = createHookRecorder()
  const adapter: AxiosAdapter = async (config) => {
    throw createHttpError(config, 401, {
      ...validApiError,
      code: 'INVALID_CREDENTIALS',
      message: '用户名或密码错误',
    })
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await assert.rejects(client.post('/auth/login', {}))
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, ['用户名或密码错误'])
})

test('最终 http、http-unparseable 与 network 错误只显示安全文案', async () => {
  const cases = [
    {
      createError: (config: InternalAxiosRequestConfig) => createHttpError(
        config,
        422,
        validApiError,
      ),
      expectedKind: 'http',
      expectedMessage: validApiError.message,
    },
    {
      createError: (config: InternalAxiosRequestConfig) => createHttpError(
        config,
        500,
        '<html>raw server secret</html>',
      ),
      expectedKind: 'http-unparseable',
      expectedMessage: '服务器返回了无法识别的错误响应',
    },
    {
      createError: createNetworkError,
      expectedKind: 'network',
      expectedMessage: '网络连接失败，请稍后重试',
    },
  ] as const

  for (const testCase of cases) {
    const recorder = createHookRecorder()
    const adapter: AxiosAdapter = async (config) => {
      throw testCase.createError(config)
    }
    const client = createApiClient({
      adapter,
      baseURL: '/api/',
      hooks: recorder.hooks,
    })

    let rejected: unknown
    try {
      await client.get('/failure')
      assert.fail('请求应拒绝')
    }
    catch (error) {
      rejected = error
    }

    assert.equal(
      typeof rejected === 'object'
      && rejected !== null
      && 'kind' in rejected
        ? rejected.kind
        : undefined,
      testCase.expectedKind,
    )
    assert.deepEqual(recorder.notifications, [testCase.expectedMessage])
    assert.deepEqual(recorder.invalidatedEpochs, [])
    assert.equal(JSON.stringify(rejected).includes('raw server secret'), false)
    assert.equal(JSON.stringify(rejected).includes('raw network secret'), false)
    assert.equal(JSON.stringify(rejected).includes('raw axios secret'), false)
  }
})

test('非 Axios Error 收敛为安全 network 错误，不泄漏原始异常', async () => {
  const rawError = new Error('raw non-axios adapter secret')
  const recorder = createHookRecorder()
  const adapter: AxiosAdapter = async () => {
    throw rawError
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  let rejected: unknown
  try {
    await client.get('/non-axios-failure')
  }
  catch (error) {
    rejected = error
  }

  assert.deepEqual(rejected, {
    code: 'NETWORK_ERROR',
    kind: 'network',
    message: '网络连接失败，请稍后重试',
  })
  assert.notEqual(rejected, rawError)
  assert.equal(JSON.stringify(rejected).includes('raw non-axios adapter secret'), false)
  assert.deepEqual(recorder.notifications, ['网络连接失败，请稍后重试'])
  assert.deepEqual(recorder.invalidatedEpochs, [])
})

test('显式 retry 只对允许的 method 与暂时性失败执行一次重试', async () => {
  const retryableCases = [
    { method: 'get', status: undefined },
    { method: 'head', status: 502 },
    { method: 'options', status: 503 },
    { method: 'put', status: 504 },
  ] as const

  for (const testCase of retryableCases) {
    let adapterCalls = 0
    const delays: number[] = []
    const recorder = createHookRecorder({
      sleep: async (delayMs) => {
        delays.push(delayMs)
      },
    })
    const adapter: AxiosAdapter = async (config) => {
      adapterCalls += 1
      if (adapterCalls === 1) {
        throw testCase.status === undefined
          ? createNetworkError(config)
          : createHttpError(config, testCase.status, validApiError)
      }
      return createResponse(config, { ok: true })
    }
    const client = createApiClient({
      adapter,
      baseURL: '/api/',
      hooks: recorder.hooks,
    })

    const response = await client.request({
      method: testCase.method,
      retry: true,
      url: '/temporary',
    })

    assert.deepEqual(response.data, { ok: true })
    assert.equal(adapterCalls, 2, testCase.method)
    assert.deepEqual(delays, [500], testCase.method)
    assert.deepEqual(recorder.notifications, [])
  }

  const forbiddenCases = [
    { method: 'post', retry: true, status: undefined },
    { method: 'patch', retry: true, status: undefined },
    { method: 'delete', retry: true, status: undefined },
    { method: 'get', retry: true, status: 429 },
    { method: 'get', retry: false, status: undefined },
  ] as const

  for (const testCase of forbiddenCases) {
    let adapterCalls = 0
    const delays: number[] = []
    const recorder = createHookRecorder({
      sleep: async (delayMs) => {
        delays.push(delayMs)
      },
    })
    const adapter: AxiosAdapter = async (config) => {
      adapterCalls += 1
      throw testCase.status === undefined
        ? createNetworkError(config)
        : createHttpError(config, testCase.status, validApiError)
    }
    const client = createApiClient({
      adapter,
      baseURL: '/api/',
      hooks: recorder.hooks,
    })

    await assert.rejects(client.request({
      method: testCase.method,
      retry: testCase.retry,
      url: '/forbidden-retry',
    }))

    assert.equal(adapterCalls, 1, testCase.method)
    assert.deepEqual(delays, [], testCase.method)
  }
})

test('adapter 内三次失败后成功只经过一次外层 request/response chain，且复用同一 config', async () => {
  let adapterCalls = 0
  let downstreamRequestCalls = 0
  let downstreamSuccessCalls = 0
  const configs: InternalAxiosRequestConfig[] = []
  const recorder = createHookRecorder({
    sleep: async () => {},
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    configs.push(config)
    if (adapterCalls <= 3) {
      throw createNetworkError(config)
    }
    return createResponse(config, { ok: true })
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })
  client.interceptors.request.use((config) => {
    downstreamRequestCalls += 1
    return config
  })
  client.interceptors.response.use((response) => {
    downstreamSuccessCalls += 1
    return response
  })

  const response = await client.get('/pipeline-success', { retry: true })

  assert.deepEqual(response.data, { ok: true })
  assert.equal(adapterCalls, 4)
  assert.equal(downstreamRequestCalls, 1)
  assert.equal(downstreamSuccessCalls, 1)
  assert.equal(configs.length, 4)
  assert.ok(configs.every(config => config === configs[0]))
})

test('adapter 内四次失败只进入一次下游 response error interceptor', async () => {
  let adapterCalls = 0
  let downstreamErrorCalls = 0
  const recorder = createHookRecorder({
    sleep: async () => {},
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    throw createNetworkError(config)
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })
  client.interceptors.response.use(undefined, (error: unknown) => {
    downstreamErrorCalls += 1
    return Promise.reject(error)
  })

  await assert.rejects(client.get('/pipeline-failure', { retry: true }))

  assert.equal(adapterCalls, 4)
  assert.equal(downstreamErrorCalls, 1)
})

test('adapter 内重试不重复执行 transformRequest 或 transformResponse', async () => {
  let adapterCalls = 0
  let transformRequestCalls = 0
  let transformResponseCalls = 0
  const recorder = createHookRecorder({
    sleep: async () => {},
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    if (adapterCalls <= 3) {
      throw createHttpError(config, 503, validApiError)
    }
    return createResponse(config, { ok: true })
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  const response = await client.get('/transforms', {
    data: { query: 'once' },
    retry: true,
    transformRequest: [(data) => {
      transformRequestCalls += 1
      return data
    }],
    transformResponse: [(data) => {
      transformResponseCalls += 1
      return data
    }],
  })

  assert.deepEqual(response.data, { ok: true })
  assert.equal(adapterCalls, 4)
  assert.equal(transformRequestCalls, 1)
  assert.equal(transformResponseCalls, 1)
})

test('request-level adapter 也被包装，并在重试时复用同一 config', async () => {
  let defaultAdapterCalls = 0
  let requestAdapterCalls = 0
  const configs: InternalAxiosRequestConfig[] = []
  const recorder = createHookRecorder({
    sleep: async () => {},
  })
  const defaultAdapter: AxiosAdapter = async (config) => {
    defaultAdapterCalls += 1
    return createResponse(config, { source: 'default' })
  }
  const requestAdapter: AxiosAdapter = async (config) => {
    requestAdapterCalls += 1
    configs.push(config)
    if (requestAdapterCalls === 1) {
      throw createNetworkError(config)
    }
    return createResponse(config, { source: 'request' })
  }
  const client = createApiClient({
    adapter: defaultAdapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  const response = await client.get('/request-adapter', {
    adapter: requestAdapter,
    retry: true,
  })

  assert.deepEqual(response.data, { source: 'request' })
  assert.equal(defaultAdapterCalls, 0)
  assert.equal(requestAdapterCalls, 2)
  assert.equal(configs[0], configs[1])
})

test('命名 request-level adapter 在 dispatch 前安全拒绝，不调用 factory 或 config.env.fetch', async () => {
  let factoryAdapterCalls = 0
  let customFetchCalls = 0
  const recorder = createHookRecorder()
  const factoryAdapter: AxiosAdapter = async (config) => {
    factoryAdapterCalls += 1
    return createResponse(config, { source: 'factory' })
  }
  const customFetch = async (): Promise<Response> => {
    customFetchCalls += 1
    return new Response(JSON.stringify({ source: 'custom-fetch' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }
  const client = createApiClient({
    adapter: factoryAdapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  let rejected: unknown
  try {
    await client.get('data:application/json,%7B%22unsafe%22%3Atrue%7D', {
      adapter: 'fetch',
      env: { fetch: customFetch },
    })
  }
  catch (error) {
    rejected = error
  }

  assert.deepEqual(rejected, {
    code: 'NETWORK_ERROR',
    kind: 'network',
    message: '网络连接失败，请稍后重试',
  })
  assert.equal(factoryAdapterCalls, 0)
  assert.equal(customFetchCalls, 0)
  assert.equal(recorder.languageReads, 0)
  assert.equal(recorder.authEpochReads, 0)
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
  assert.equal(
    JSON.stringify(rejected).includes('Unsafe Axios adapter configuration'),
    false,
  )
})

test('默认 factory 遇到 config.env fetch 环境时在 adapter 前安全拒绝', async () => {
  let customFetchCalls = 0
  const recorder = createHookRecorder()
  const customFetch = async (): Promise<Response> => {
    customFetchCalls += 1
    return new Response(JSON.stringify({ source: 'custom-fetch' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    })
  }
  const client = createApiClient({
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  let rejected: unknown
  try {
    await client.get('data:application/json,%7B%22unsafe%22%3Atrue%7D', {
      env: { fetch: customFetch },
    })
  }
  catch (error) {
    rejected = error
  }

  assert.deepEqual(rejected, {
    code: 'NETWORK_ERROR',
    kind: 'network',
    message: '网络连接失败，请稍后重试',
  })
  assert.equal(customFetchCalls, 0)
  assert.equal(recorder.languageReads, 0)
  assert.equal(recorder.authEpochReads, 0)
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
  assert.equal(
    JSON.stringify(rejected).includes('Unsafe Axios adapter configuration'),
    false,
  )
})

test('已取消请求优先于不安全 adapter 限制，保持 CanceledError 且不执行 hooks', async () => {
  let factoryAdapterCalls = 0
  let customFetchCalls = 0
  const recorder = createHookRecorder()
  const factoryAdapter: AxiosAdapter = async (config) => {
    factoryAdapterCalls += 1
    return createResponse(config, { source: 'factory' })
  }
  const customFetch = async (): Promise<Response> => {
    customFetchCalls += 1
    return new Response()
  }
  const client = createApiClient({
    adapter: factoryAdapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    client.get('data:application/json,%7B%7D', {
      adapter: 'fetch',
      env: { fetch: customFetch },
      signal: controller.signal,
    }),
    isCanceledError,
  )

  assert.equal(factoryAdapterCalls, 0)
  assert.equal(customFetchCalls, 0)
  assert.equal(recorder.languageReads, 0)
  assert.equal(recorder.authEpochReads, 0)
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
})

test('now 或 sleep 抛出的原始异常不会泄漏，并按首次 AxiosError 归一化', async () => {
  const dependencyCases = [
    {
      createError: (config: InternalAxiosRequestConfig) => createHttpError(
        config,
        503,
        validApiError,
        { 'Retry-After': 'Thu, 01 Jan 2026 00:00:10 GMT' },
      ),
      expectedError: {
        body: validApiError,
        kind: 'http',
        status: 503,
      },
      expectedMessage: validApiError.message,
      name: 'now',
    },
    {
      createError: createNetworkError,
      expectedError: {
        code: 'NETWORK_ERROR',
        kind: 'network',
        message: '网络连接失败，请稍后重试',
      },
      expectedMessage: '网络连接失败，请稍后重试',
      name: 'sleep',
    },
  ] as const

  for (const testCase of dependencyCases) {
    const rawDependencyError = new Error(`raw ${testCase.name} secret`)
    let adapterCalls = 0
    const now = testCase.name === 'now'
      ? () => {
          throw rawDependencyError
        }
      : undefined
    const sleep: NonNullable<ApiClientHooks['sleep']> = async () => {
      if (testCase.name === 'sleep') {
        throw rawDependencyError
      }
    }
    const recorder = createHookRecorder({
      now,
      sleep,
    })
    const adapter: AxiosAdapter = async (config) => {
      adapterCalls += 1
      throw testCase.createError(config)
    }
    const client = createApiClient({
      adapter,
      baseURL: '/api/',
      hooks: recorder.hooks,
    })

    let rejected: unknown
    try {
      await client.get(`/dependency-${testCase.name}`, { retry: true })
    }
    catch (error) {
      rejected = error
    }

    assert.deepEqual(rejected, testCase.expectedError, testCase.name)
    assert.notEqual(rejected, rawDependencyError, testCase.name)
    assert.equal(
      JSON.stringify(rejected).includes(`raw ${testCase.name} secret`),
      false,
      testCase.name,
    )
    assert.equal(adapterCalls, 1, testCase.name)
    assert.deepEqual(recorder.notifications, [testCase.expectedMessage])
  }
})

test('重试 refresh hook 抛错时仍按首次 AxiosError 归一化', async () => {
  const rawRefreshError = new Error('raw refresh hook secret')
  let adapterCalls = 0
  let languageReads = 0
  const recorder = createHookRecorder({
    getLanguage: () => {
      languageReads += 1
      if (languageReads > 1) {
        throw rawRefreshError
      }
      return 'zh-CN'
    },
    sleep: async () => {},
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    throw createHttpError(config, 503, validApiError)
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  let rejected: unknown
  try {
    await client.get('/refresh-failure', { retry: true })
  }
  catch (error) {
    rejected = error
  }

  assert.deepEqual(rejected, {
    body: validApiError,
    kind: 'http',
    status: 503,
  })
  assert.notEqual(rejected, rawRefreshError)
  assert.equal(JSON.stringify(rejected).includes('raw refresh hook secret'), false)
  assert.equal(adapterCalls, 1)
  assert.deepEqual(recorder.notifications, [validApiError.message])
})

test('网络失败最多重试三次，固定退避为 500/1000/2000ms', async () => {
  let adapterCalls = 0
  const delays: number[] = []
  const recorder = createHookRecorder({
    sleep: async (delayMs) => {
      delays.push(delayMs)
    },
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    throw createNetworkError(config)
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await assert.rejects(client.get('/network', { retry: true }))

  assert.equal(adapterCalls, 4)
  assert.deepEqual(delays, [500, 1000, 2000])
  assert.deepEqual(recorder.notifications, ['网络连接失败，请稍后重试'])
})

test('同一重试链刷新语言但保持原 authEpoch，并始终删除 Token', async () => {
  let language = 'zh-CN'
  const headerSnapshots: Array<{
    authEpoch: number | undefined
    hasToken: boolean
    language: unknown
  }> = []
  const recorder = createHookRecorder({
    getLanguage: () => language,
    sleep: async () => {},
  })
  const adapter: AxiosAdapter = async (config) => {
    headerSnapshots.push({
      authEpoch: config.authEpoch,
      hasToken: config.headers.has('Token'),
      language: config.headers.get('Accept-Language'),
    })
    if (headerSnapshots.length === 1) {
      language = 'en-US'
      throw createNetworkError(config)
    }
    return createResponse(config, { ok: true })
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  const response = await client.get('/dynamic-headers', {
    headers: { Token: 'legacy-token' },
    retry: true,
  })

  assert.deepEqual(response.data, { ok: true })
  assert.deepEqual(headerSnapshots, [
    { authEpoch: 0, hasToken: false, language: 'zh-CN' },
    { authEpoch: 0, hasToken: false, language: 'en-US' },
  ])
  assert.equal(recorder.authEpochReads, 2)
})

test('外部 retryCount 在每次决策前规范化，且任意原始值最多调用 adapter 四次', async () => {
  const cases = [
    { count: 3, expectedEntryCounts: [3], expectedDelays: [] },
    { count: 4, expectedEntryCounts: [4], expectedDelays: [] },
    { count: -1, expectedEntryCounts: [-1, 1, 2, 3], expectedDelays: [500, 1000, 2000] },
    { count: 1.9, expectedEntryCounts: [1.9, 2, 3], expectedDelays: [1000, 2000] },
    { count: Number.NaN, expectedEntryCounts: [Number.NaN, 1, 2, 3], expectedDelays: [500, 1000, 2000] },
    { count: Infinity, expectedEntryCounts: [Infinity, 1, 2, 3], expectedDelays: [500, 1000, 2000] },
    { count: -Infinity, expectedEntryCounts: [-Infinity, 1, 2, 3], expectedDelays: [500, 1000, 2000] },
  ] as const

  for (const testCase of cases) {
    const entryCounts: unknown[] = []
    const delays: number[] = []
    const recorder = createHookRecorder({
      sleep: async (delayMs) => {
        delays.push(delayMs)
      },
    })
    const adapter: AxiosAdapter = async (config) => {
      entryCounts.push(config.retryCount)
      throw createNetworkError(config)
    }
    const client = createApiClient({
      adapter,
      baseURL: '/api/',
      hooks: recorder.hooks,
    })

    await assert.rejects(client.get('/count', {
      retry: true,
      retryCount: testCase.count,
    }))

    assert.ok(entryCounts.length <= 4, `retryCount=${String(testCase.count)}`)
    assert.deepEqual(
      entryCounts,
      testCase.expectedEntryCounts,
      `retryCount=${String(testCase.count)}`,
    )
    assert.deepEqual(
      delays,
      testCase.expectedDelays,
      `retryCount=${String(testCase.count)}`,
    )
  }
})

test('503 Retry-After 使用注入时钟解析 HTTP 日期，并将每次等待限制在 5000ms', async () => {
  let adapterCalls = 0
  const delays: number[] = []
  const now = Date.UTC(2026, 0, 1, 0, 0, 0)
  const recorder = createHookRecorder({
    now: () => now,
    sleep: async (delayMs) => {
      delays.push(delayMs)
    },
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    throw createHttpError(
      config,
      503,
      validApiError,
      { 'Retry-After': 'Thu, 01 Jan 2026 00:00:10 GMT' },
    )
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await assert.rejects(client.get('/unavailable', { retry: true }))

  assert.equal(adapterCalls, 4)
  assert.deepEqual(delays, [5000, 5000, 5000])
})

test('发送前已经 aborted 时拒绝 CanceledError，且不读取 hooks 或调用 adapter', async () => {
  let adapterCalls = 0
  const recorder = createHookRecorder()
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    return createResponse(config, { ok: true })
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })
  const controller = new AbortController()
  controller.abort()

  await assert.rejects(
    client.get('/canceled', { signal: controller.signal }),
    isCanceledError,
  )

  assert.equal(adapterCalls, 0)
  assert.equal(recorder.languageReads, 0)
  assert.equal(recorder.authEpochReads, 0)
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
})

test('adapter 返回的 CanceledError 原样拒绝，且不重试、不提示、不登出', async () => {
  let adapterCalls = 0
  let cancellation: CanceledError | undefined
  const delays: number[] = []
  const recorder = createHookRecorder({
    sleep: async (delayMs) => {
      delays.push(delayMs)
    },
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    cancellation = new CanceledError('adapter canceled', config)
    throw cancellation
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await assert.rejects(
    client.get('/canceled', { retry: true }),
    (error) => {
      assert.equal(error, cancellation)
      return isCanceledError(error)
    },
  )

  assert.equal(adapterCalls, 1)
  assert.deepEqual(delays, [])
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
})

test('仅带 ERR_CANCELED code 的 AxiosError 也原样拒绝且无副作用', async () => {
  let adapterCalls = 0
  let cancellation: AxiosError | undefined
  const delays: number[] = []
  const recorder = createHookRecorder({
    sleep: async (delayMs) => {
      delays.push(delayMs)
    },
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    cancellation = new AxiosError(
      'raw code-only cancellation',
      AxiosError.ERR_CANCELED,
      config,
    )
    assert.equal(isCancel(cancellation), false)
    throw cancellation
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await assert.rejects(
    client.get('/code-only-cancel', { retry: true }),
    (error) => {
      assert.equal(error, cancellation)
      return error instanceof AxiosError
        && error.code === AxiosError.ERR_CANCELED
        && !isCancel(error)
    },
  )

  assert.equal(adapterCalls, 1)
  assert.deepEqual(delays, [])
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
})

test('重试等待期间 abort 时原样拒绝 sleep 的 CanceledError，且不继续 adapter', async () => {
  const controller = new AbortController()
  let adapterCalls = 0
  let releaseSleepStarted: (() => void) | undefined
  let sleepCancellation: CanceledError | undefined
  const sleepStarted = new Promise<void>((resolve) => {
    releaseSleepStarted = resolve
  })
  const recorder = createHookRecorder({
    sleep: (_delayMs, signal) => new Promise((_resolve, reject) => {
      const onAbort = () => {
        sleepCancellation = new CanceledError('sleep canceled')
        reject(sleepCancellation)
      }
      signal?.addEventListener?.('abort', onAbort, { once: true })
      releaseSleepStarted?.()
    }),
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    throw createNetworkError(config)
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  const request = client.get('/waiting', {
    retry: true,
    signal: controller.signal,
  })
  await sleepStarted
  controller.abort()

  await assert.rejects(request, (error) => {
    assert.equal(error, sleepCancellation)
    return isCanceledError(error)
  })
  assert.equal(adapterCalls, 1)
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
})

test('sleep 完成后重新检查 signal，阻止下一次 adapter 调用', async () => {
  const controller = new AbortController()
  let adapterCalls = 0
  const recorder = createHookRecorder({
    sleep: async () => {
      controller.abort()
    },
  })
  const adapter: AxiosAdapter = async (config) => {
    adapterCalls += 1
    throw createNetworkError(config)
  }
  const client = createApiClient({
    adapter,
    baseURL: '/api/',
    hooks: recorder.hooks,
  })

  await assert.rejects(
    client.get('/post-sleep-cancel', {
      retry: true,
      signal: controller.signal,
    }),
    isCanceledError,
  )

  assert.equal(adapterCalls, 1)
  assert.deepEqual(recorder.invalidatedEpochs, [])
  assert.deepEqual(recorder.notifications, [])
})
