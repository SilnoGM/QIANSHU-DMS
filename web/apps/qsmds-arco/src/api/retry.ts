import type {
  AxiosError,
  AxiosRequestConfig,
  GenericAbortSignal,
} from 'axios'

import {
  AxiosError as AxiosErrorValue,
  CanceledError,
  isCancel,
} from 'axios'

export type Sleep = (
  delayMs: number,
  signal?: GenericAbortSignal,
) => Promise<void>

export type Now = () => number

const RETRY_DELAYS_MS = [500, 1000, 2000] as const
const RETRYABLE_METHODS = new Set(['get', 'head', 'options', 'put'])
const RETRYABLE_STATUSES = new Set([502, 503, 504])
const MAX_RETRY_COUNT = 3
const MAX_RETRY_AFTER_MS = 5000
const IMF_FIXDATE_PATTERN = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/
const RFC850_DATE_PATTERN = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} \d{2}:\d{2}:\d{2} GMT$/
const ASCTIME_DATE_PATTERN = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: \d|\d{2}) \d{2}:\d{2}:\d{2} \d{4}$/

/** 按第几次重试选择受限退避，越界索引固定落在最近的边界值。 */
export function fallbackRetryDelayMs(retryIndex: number): number {
  const boundedIndex = Math.min(
    Math.max(Math.trunc(retryIndex), 0),
    RETRY_DELAYS_MS.length - 1,
  )
  return RETRY_DELAYS_MS[boundedIndex] ?? 2000
}

/**
 * 可取消的等待原语：入口、listener 注册后与 timer 唤醒时各检查一次 signal。
 *
 * Axios 的 GenericAbortSignal 只保证 listener API 可选存在，因此只在 add/remove 同时可用时注册；
 * 一旦注册，resolve 和 reject 两条路径都必须对称移除。
 */
export function abortableSleep(
  delayMs: number,
  signal?: GenericAbortSignal,
): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(new CanceledError())
  }

  return new Promise((resolve, reject) => {
    const addEventListener = signal?.addEventListener
    const removeEventListener = signal?.removeEventListener
    const canListen = typeof addEventListener === 'function'
      && typeof removeEventListener === 'function'
    let settled = false
    let listenerRegistered = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const cleanup = () => {
      if (timeoutId !== undefined) {
        const currentTimeoutId = timeoutId
        timeoutId = undefined
        try {
          clearTimeout(currentTimeoutId)
        }
        catch {
          // 清理是 best-effort，不得让非标准 timer 实现阻断 Promise settlement。
        }
      }
      if (listenerRegistered && canListen) {
        listenerRegistered = false
        try {
          removeEventListener.call(signal, 'abort', onAbort)
        }
        catch {
          // 非标准 signal 的 remove 异常不得覆盖原始取消或正常完成结果。
        }
      }
    }

    const rejectCanceled = () => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      reject(new CanceledError())
    }

    function onAbort() {
      rejectCanceled()
    }

    const onAwake = () => {
      if (signal?.aborted === true) {
        rejectCanceled()
        return
      }
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve()
    }

    timeoutId = setTimeout(onAwake, delayMs)
    if (canListen) {
      // 先标记已注册，使同步触发 abort 的非标准 signal 也能执行对称 cleanup。
      listenerRegistered = true
      try {
        addEventListener.call(signal, 'abort', onAbort)
      }
      catch (error) {
        if (!settled) {
          settled = true
          cleanup()
          reject(error)
        }
        return
      }
      if (signal?.aborted === true) {
        rejectCanceled()
      }
    }
  })
}

/**
 * 将外部可写配置收敛为确定性非负整数，不做字符串等隐式 coercion。
 * 不把大于上限的计数 clamp 回 3，使 `shouldRetry()` 能正确识别任意已耗尽值。
 */
export function normalizeRetryCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  return Math.max(Math.trunc(value), 0)
}

/** 只对显式开启、幂等且尚未耗尽的暂时性失败放行重试。 */
export function shouldRetry(
  config: AxiosRequestConfig,
  error: AxiosError,
): boolean {
  if (config.retry !== true) {
    return false
  }

  const method = config.method?.toLowerCase()
  if (method === undefined || !RETRYABLE_METHODS.has(method)) {
    return false
  }

  if (
    isCancel(error)
    || error.code === AxiosErrorValue.ERR_CANCELED
    || config.signal?.aborted === true
    || normalizeRetryCount(config.retryCount) >= MAX_RETRY_COUNT
  ) {
    return false
  }

  return error.response === undefined
    || RETRYABLE_STATUSES.has(error.response.status)
}

function readRetryAfter(headers: unknown): string | undefined {
  try {
    if (typeof headers !== 'object' || headers === null) {
      return undefined
    }

    const headerContainer = headers as {
      get?: (name: string) => unknown
      [key: string]: unknown
    }
    const getHeader = headerContainer.get
    if (typeof getHeader === 'function') {
      const value = getHeader.call(headers, 'Retry-After')
      return typeof value === 'string' ? value : undefined
    }

    let matched = false
    let matchedValue: string | undefined
    for (const [name, value] of Object.entries(headerContainer)) {
      if (name.toLowerCase() !== 'retry-after') {
        continue
      }
      if (matched) {
        return undefined
      }
      matched = true
      matchedValue = typeof value === 'string' ? value : undefined
    }

    return matchedValue
  }
  catch {
    return undefined
  }
}

function parseRetryAfterMs(value: string, now: Now): number | undefined {
  const normalizedValue = value.trim()
  if (/^\d+$/.test(normalizedValue)) {
    const seconds = Number(normalizedValue)
    return Number.isFinite(seconds)
      ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS)
      : MAX_RETRY_AFTER_MS
  }

  // Date.parse 会宽松接受自然语言日期；必须先限定在 RFC 9110 HTTP-date 的三种语法内。
  const isAsctimeDate = ASCTIME_DATE_PATTERN.test(normalizedValue)
  if (
    !IMF_FIXDATE_PATTERN.test(normalizedValue)
    && !RFC850_DATE_PATTERN.test(normalizedValue)
    && !isAsctimeDate
  ) {
    return undefined
  }

  // asctime 语法不带时区字面量，HTTP-date 语义仍是 GMT；显式补齐以避免受本机时区影响。
  const timestamp = Date.parse(
    isAsctimeDate ? `${normalizedValue} GMT` : normalizedValue,
  )
  if (!Number.isFinite(timestamp)) {
    return undefined
  }

  return Math.min(Math.max(timestamp - now(), 0), MAX_RETRY_AFTER_MS)
}

/**
 * 503 优先遵循 Server Retry-After；其他状态与不可解析值回退到固定退避。
 * Header 只接受 string，避免把适配器中的未知值 stringify 后误当成 Server 指令。
 */
export function resolveRetryDelayMs(
  error: AxiosError,
  retryIndex: number,
  now: Now,
): number {
  if (error.response?.status !== 503) {
    return fallbackRetryDelayMs(retryIndex)
  }

  let responseHeaders: unknown
  try {
    responseHeaders = error.response.headers
  }
  catch {
    return fallbackRetryDelayMs(retryIndex)
  }

  const retryAfter = readRetryAfter(responseHeaders)
  const retryAfterMs = retryAfter === undefined
    ? undefined
    : parseRetryAfterMs(retryAfter, now)

  return retryAfterMs ?? fallbackRetryDelayMs(retryIndex)
}
