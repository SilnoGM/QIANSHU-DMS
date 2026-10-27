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

import { recordServerClockSample } from '../utils/server-clock'
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
  getAuthEpoch: () => number
  getAuthSignal: () => AbortSignal
  getLanguage: () => string
  handleSessionInvalid: (
    requestEpoch: number,
    broadcastSessionInvalid: boolean,
  ) => void
  handleAuthRevalidationRequired: (code: string) => void
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

/** 身份边界变化后的旧响应使用 Axios 取消语义结束，调用方仍会执行 finally。 */
export class StaleAuthEpochError extends CanceledError<unknown> {
  constructor(config?: InternalAxiosRequestConfig) {
    super('Authentication context changed', config)
  }
}

/**
 * 在读取语言或进入 adapter 前检查取消状态。
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
 * 初始发送与 adapter 内重试共用语言、CSRF 和 fake URL 刷新逻辑。
 *
 * 每个可执行用户代码的 hook 前后都检查 signal，避免取消后继续读取认证状态；
 * 自定义 Token Header 无论来自旧代码还是调用方都必须被移除；Cookie 才是身份凭证。
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

  config.headers.set('Accept-Language', language)
  config.headers.delete('Token')

  const method = config.method?.toLowerCase()
  if (method !== undefined && ['delete', 'patch', 'post', 'put'].includes(method)) {
    // FormData 的 multipart boundary 只能由浏览器生成。若通用 Client 强制写成
    // application/json，Axios 还会把 FormData 序列化为 JSON，导致流式 parser
    // 在读取边界前直接拒绝请求。其余写请求继续固定 JSON 语义。
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      // AxiosHeaders 的 false 是“不发送且不允许默认 transform 覆盖”；单纯 delete
      // 会被 Axios 的 POST 默认值重新写成 application/x-www-form-urlencoded。
      config.headers.set('Content-Type', false)
    }
    else {
      config.headers.set('Content-Type', 'application/json')
    }
    config.headers.set('X-Qianshu-CSRF', '1')
  }
}

function currentAuthEpochOrStale(
  config: InternalAxiosRequestConfig,
  hooks: ApiClientHooks,
): number {
  try {
    const epoch = hooks.getAuthEpoch()
    if (!Number.isSafeInteger(epoch) || epoch < 0) {
      throw new StaleAuthEpochError(config)
    }
    return epoch
  }
  catch (error) {
    if (error instanceof StaleAuthEpochError) {
      throw error
    }
    // Hook 原始异常可能含运行时状态，统一收敛为固定取消错误。
    throw new StaleAuthEpochError(config)
  }
}

/**
 * 把调用方取消信号与当前身份域信号合并。身份切换会 Abort 旧身份全部在途请求，
 * 调用方自己的取消（例如 passive /me 被 mutation 作废）也继续生效。
 */
function bindCurrentAuthSignal(
  config: InternalAxiosRequestConfig,
  hooks: ApiClientHooks,
): void {
  let authSignal: AbortSignal
  try {
    authSignal = hooks.getAuthSignal()
  }
  catch {
    throw new StaleAuthEpochError(config)
  }

  if (config.signal === undefined) {
    config.signal = authSignal
  }
  else if (config.signal !== authSignal) {
    // 本项目调用方只传标准 AbortController.signal；Axios 为兼容性将字段声明得更宽。
    config.signal = AbortSignal.any([
      config.signal as AbortSignal,
      authSignal,
    ])
  }
  throwIfRequestCanceled(config)
}

function throwIfAuthEpochStale(
  config: InternalAxiosRequestConfig | undefined,
  hooks: ApiClientHooks,
): void {
  if (
    config !== undefined
    && config.authEpoch !== undefined
    && config.authEpoch !== currentAuthEpochOrStale(config, hooks)
  ) {
    throw new StaleAuthEpochError(config)
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
 * 服务端时钟校准是 best-effort 副作用：Date 头缺失、被代理改写或取时钟 hook 抛错，
 * 都不能影响请求本身的成功与否。
 */
function recordServerClock(dateHeader: unknown, now: Now): void {
  try {
    recordServerClockSample(dateHeader, now())
  }
  catch {
    // 校准失败保持上一个样本。
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
    withCredentials: true,
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

    config.authEpoch = currentAuthEpochOrStale(config, options.hooks)
    bindCurrentAuthSignal(config, options.hooks)
    refreshRequestConfig(config, retryingAdapterOptions)
    return config
  })

  instance.interceptors.response.use(
    (response) => {
      recordServerClock(response.headers?.date, now)
      throwIfAuthEpochStale(response.config, options.hooks)
      return response
    },
    async (error: unknown) => {
      const axiosError = axios.isAxiosError<unknown>(error)
        ? error
        : undefined
      const config = axiosError?.config
      recordServerClock(axiosError?.response?.headers?.date, now)

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

      try {
        throwIfAuthEpochStale(config, options.hooks)
      }
      catch (staleError) {
        return Promise.reject(staleError)
      }

      // 非 Axios adapter 异常同样收敛为固定 network 文案，绝不透传原始 Error。
      const normalized = await normalizeAxiosError(
        axiosError ?? new AxiosErrorValue(),
      )
      const shouldNotifyGlobally = config?.errorPresentation !== 'local'

      if (
        normalized.kind === 'http'
        && normalized.status === 401
        && normalized.body.code === 'AUTHENTICATION_REQUIRED'
        && config?.authEpoch !== undefined
      ) {
        await invokeSideEffectSafely(
          () => options.hooks.handleSessionInvalid(
            config.authEpoch as number,
            config.broadcastSessionInvalid !== false,
          ),
        )
      }
      else if (normalized.kind === 'http' && normalized.status === 403) {
        const code = normalized.body.code
        if (code === 'PASSWORD_CHANGE_REQUIRED' || code === 'CSRF_REJECTED') {
          // 两类拒绝都说明本地 AuthContext 可能落后于服务端，先重新读取 /auth/me。
          await invokeSideEffectSafely(
            () => options.hooks.handleAuthRevalidationRequired(code),
          )
        }

        if (shouldNotifyGlobally) {
          if (code === 'FORBIDDEN') {
            await invokeSideEffectSafely(
              () => options.hooks.notifyError('没有权限执行此操作'),
            )
          }
          else if (code === 'CSRF_REJECTED') {
            await invokeSideEffectSafely(
              () => options.hooks.notifyError('登录状态校验失败，请重试操作'),
            )
          }
          else if (code !== 'PASSWORD_CHANGE_REQUIRED') {
            await invokeSideEffectSafely(
              () => options.hooks.notifyError(
                getApiClientErrorMessage(normalized),
              ),
            )
          }
        }
      }
      else if (shouldNotifyGlobally) {
        await invokeSideEffectSafely(
          () => options.hooks.notifyError(getApiClientErrorMessage(normalized)),
        )
      }

      return Promise.reject(normalized)
    },
  )

  return instance
}
