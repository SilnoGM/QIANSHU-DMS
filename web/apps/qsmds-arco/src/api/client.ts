import type {
  AxiosAdapter,
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios'
import type { Now, Sleep } from './retry'

import axios, {
  AxiosError as AxiosErrorValue,
  CanceledError,
} from 'axios'

import {
  getApiClientErrorMessage,
  normalizeAxiosError,
} from './errors'
import {
  abortableSleep,
  normalizeRetryCount,
  resolveRetryDelayMs,
  shouldRetry,
} from './retry'

export interface ApiClientHooks {
  getLanguage: () => string
  getToken: () => string | undefined
  requestLogout: () => void
  notifyError: (message: string) => void
  sleep?: Sleep
  now?: Now
}

export interface CreateApiClientOptions {
  baseURL: string
  fakeBaseURL?: string
  timeout?: number
  adapter?: AxiosAdapter
  hooks: ApiClientHooks
}

interface RetryingAdapterOptions {
  fakeBaseURL?: string
  hooks: ApiClientHooks
  now: Now
  sleep: Sleep
}

const UNSAFE_ADAPTER_CONFIGURATION_MESSAGE
  = 'Unsafe Axios adapter configuration'

/** 本地 adapter 安全策略拒绝；类型与固定内部消息都不向模块外暴露。 */
class UnsupportedAdapterConfigurationError extends TypeError {
  constructor() {
    super(UNSAFE_ADAPTER_CONFIGURATION_MESSAGE)
    this.name = 'UnsupportedAdapterConfigurationError'
  }
}

/**
 * 在读取语言、Token 或进入 adapter 前检查取消状态。
 *
 * 这里创建 Axios 原生 CanceledError，确保发送前取消与 adapter/等待阶段取消
 * 对调用方呈现一致语义，也不会进入错误归一化和用户提示流程。
 */
function throwIfRequestCanceled(
  config: InternalAxiosRequestConfig,
): void {
  if (config.signal?.aborted === true) {
    throw new CanceledError(undefined, config)
  }
}

function isAxiosCancellation(
  error: unknown,
  axiosError: AxiosError<unknown> | undefined,
): boolean {
  return axios.isCancel(error)
    || axiosError?.code === AxiosErrorValue.ERR_CANCELED
}

/**
 * 初始发送与 adapter 内重试共用同一份动态配置刷新逻辑。
 *
 * 每个可执行用户代码的 hook 前后都检查 signal，避免取消后继续读取认证状态；
 * headers 只在两个 hook 都成功且请求仍有效时更新，避免留下部分刷新的配置。
 */
function refreshRequestConfig(
  config: InternalAxiosRequestConfig,
  options: Pick<RetryingAdapterOptions, 'fakeBaseURL' | 'hooks'>,
): void {
  throwIfRequestCanceled(config)

  if (config.fake === true && options.fakeBaseURL !== undefined) {
    config.baseURL = options.fakeBaseURL
  }

  const language = options.hooks.getLanguage()
  throwIfRequestCanceled(config)
  const token = options.hooks.getToken()
  throwIfRequestCanceled(config)

  config.headers.set('Accept-Language', language)
  if (token === undefined) {
    // 同一 config 会被 adapter 循环复用；Token 失效时必须主动删除旧 header。
    config.headers.delete('Token')
  }
  else {
    config.headers.set('Token', token)
  }
}

/**
 * captured default adapter 无法依据单次请求的 env 重新选择 fetch 实现。
 * 任一配置级 fetch seed 都必须显式配合函数型 adapter，否则在 dispatch 前安全拒绝。
 */
function hasConfigSpecificFetchEnvironment(
  config: InternalAxiosRequestConfig,
): boolean {
  try {
    return config.env?.fetch !== undefined
      || config.env?.Request !== undefined
      || config.env?.Response !== undefined
  }
  catch {
    // 不可信 env getter 无法安全判断 underlying adapter，按存在自定义环境处理。
    return true
  }
}

/**
 * 重试准备阶段失败时，只允许取消错误成为新的拒绝值。
 *
 * `now`、`sleep` 与动态 header hook 都是可注入代码；它们的原始异常可能包含敏感
 * 运行时信息，因此非取消失败统一退回首次 adapter AxiosError，由外层完成安全归一化。
 */
function throwRetryPreparationFailure(
  failure: unknown,
  originalError: AxiosError<unknown>,
  config: InternalAxiosRequestConfig,
): never {
  const axiosFailure = axios.isAxiosError<unknown>(failure)
    ? failure
    : undefined
  if (isAxiosCancellation(failure, axiosFailure)) {
    throw failure
  }
  if (config.signal?.aborted === true) {
    throw new CanceledError(undefined, config)
  }
  throw originalError
}

/**
 * 把重试限制在单次 Axios dispatch 内，避免重复执行 transform 与公开 interceptor。
 *
 * wrapper 在循环外已经拿到真实 underlying adapter，循环内绝不再次解析
 * `config.adapter`（此时它正是 wrapper 自身），从结构上消除递归包装风险。
 */
function createRetryingAdapter(
  underlyingAdapter: AxiosAdapter,
  options: RetryingAdapterOptions,
): AxiosAdapter {
  return async (config) => {
    while (true) {
      try {
        return await underlyingAdapter(config)
      }
      catch (error) {
        const axiosError = axios.isAxiosError<unknown>(error)
          ? error
          : undefined

        // adapter 取消保留对象身份；signal 取消统一转换为 Axios CanceledError。
        if (isAxiosCancellation(error, axiosError)) {
          throw error
        }
        if (config.signal?.aborted === true) {
          throw new CanceledError(undefined, config)
        }
        if (axiosError === undefined) {
          // 非 Axios adapter 异常不重试，交给外层收敛为安全 network 错误。
          throw error
        }

        const retryIndex = normalizeRetryCount(config.retryCount)
        config.retryCount = retryIndex
        if (!shouldRetry(config, axiosError)) {
          throw axiosError
        }
        config.retryCount = retryIndex + 1

        try {
          const delayMs = resolveRetryDelayMs(axiosError, retryIndex, options.now)
          await options.sleep(delayMs, config.signal)
          throwIfRequestCanceled(config)
          refreshRequestConfig(config, options)
          throwIfRequestCanceled(config)
        }
        catch (failure) {
          throwRetryPreparationFailure(failure, axiosError, config)
        }
      }
    }
  }
}

/**
 * 认证与提示 hook 属于 best-effort 副作用，不能改变对调用方公开的标准错误。
 *
 * 虽然 hooks 的公开签名保持 `void`，实际应用实现仍可能是 async function；这里用
 * `await` 同时接住同步 throw、Promise reject 和 thenable reject，且不记录潜在敏感异常。
 */
async function invokeSideEffectSafely(action: () => void): Promise<void> {
  try {
    await action()
  }
  catch {
    // hook 失败不得替换 normalized error，也不得把内部错误写入日志或用户提示。
  }
}

/**
 * 创建不依赖 Pinia/store 的 Axios Client，所有运行时状态通过 hooks 即时读取。
 *
 * factory 只配置当前实例，不修改 Axios 全局 defaults；因此单元测试、fake Client
 * 与未来生产 Client 可以并行存在，且不会相互污染 adapter、baseURL 或 headers。
 */
export function createApiClient(
  options: CreateApiClientOptions,
): AxiosInstance {
  const usesDefaultAxiosAdapter = options.adapter === undefined
  const sleep = options.hooks.sleep ?? abortableSleep
  const now = options.hooks.now ?? Date.now
  const retryingAdapterOptions: RetryingAdapterOptions = {
    fakeBaseURL: options.fakeBaseURL,
    hooks: options.hooks,
    now,
    sleep,
  }
  const underlyingAdapter = axios.getAdapter(
    options.adapter ?? axios.defaults.adapter,
  )
  const defaultRetryingAdapter = createRetryingAdapter(
    underlyingAdapter,
    retryingAdapterOptions,
  )
  const instance = axios.create({
    adapter: defaultRetryingAdapter,
    baseURL: options.baseURL,
    responseType: 'json',
    timeout: options.timeout,
  })

  instance.interceptors.request.use((config) => {
    // 取消语义优先于适配器安全限制，已取消请求必须保持 CanceledError。
    throwIfRequestCanceled(config)

    // request-level adapter 会覆盖 instance default，只允许可直接捕获的函数实现。
    if (config.adapter !== defaultRetryingAdapter) {
      if (typeof config.adapter !== 'function') {
        throw new UnsupportedAdapterConfigurationError()
      }
      config.adapter = createRetryingAdapter(
        config.adapter,
        retryingAdapterOptions,
      )
    }
    else if (
      usesDefaultAxiosAdapter
      && hasConfigSpecificFetchEnvironment(config)
    ) {
      throw new UnsupportedAdapterConfigurationError()
    }

    refreshRequestConfig(config, retryingAdapterOptions)
    return config
  })

  instance.interceptors.response.use(
    response => response,
    async (error: unknown) => {
      const axiosError = axios.isAxiosError<unknown>(error)
        ? error
        : undefined
      const config = axiosError?.config

      // Axios 原生取消必须保留对象身份，禁止转换、toast、登出或继续重试。
      if (isAxiosCancellation(error, axiosError)) {
        return Promise.reject(error)
      }
      if (config?.signal?.aborted === true) {
        return Promise.reject(new CanceledError(undefined, config))
      }
      if (error instanceof UnsupportedAdapterConfigurationError) {
        // 本地策略拒绝保持统一 network 形状，但跳过 toast/logout 且不复制 TypeError。
        const normalized = await normalizeAxiosError(new AxiosErrorValue())
        return Promise.reject(normalized)
      }

      // 非 Axios adapter 异常同样收敛为固定 network 文案，绝不透传原始 Error。
      const normalized = await normalizeAxiosError(
        axiosError ?? new AxiosErrorValue(),
      )

      if ('status' in normalized && normalized.status === 401) {
        await invokeSideEffectSafely(options.hooks.requestLogout)
      }
      else if ('status' in normalized && normalized.status === 403) {
        await invokeSideEffectSafely(
          () => options.hooks.notifyError('没有权限执行此操作'),
        )
      }
      else {
        await invokeSideEffectSafely(
          () => options.hooks.notifyError(getApiClientErrorMessage(normalized)),
        )
      }

      return Promise.reject(normalized)
    },
  )

  return instance
}
