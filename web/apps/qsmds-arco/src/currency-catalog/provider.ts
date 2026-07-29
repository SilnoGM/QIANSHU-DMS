import type {
  CurrencyCatalogItem,
  CurrencyCatalogProvider,
} from './types'
import {
  cloneCurrencyCatalogResponse,
  isPlainRecord,
} from './validation'

export { CurrencyCatalogResponseError } from './validation'

export const CURRENCY_CATALOG_CACHE_TTL_MS = 300_000

const CURRENCY_CATALOG_BROADCAST_CHANNEL_NAME
  = 'qianshu-currency-catalog-v1'
const CURRENCY_CATALOG_CHANGED_MESSAGE = Object.freeze({
  type: 'CURRENCY_CATALOG_CHANGED',
} as const)

export interface CurrencyCatalogIdentity {
  readonly authEpoch: number
  readonly userId: string | null
}

/**
 * 应用 adapter 只负责调用 API 并解包响应，catalog 内核独立承担运行时可信边界。
 */
export type CurrencyCatalogLoader
  = (signal: AbortSignal) => Promise<unknown>

export interface CurrencyCatalogBroadcastChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: unknown) => void
  close: () => void
}

export type CurrencyCatalogBroadcastChannelFactory
  = (name: string) => CurrencyCatalogBroadcastChannel

export interface CreateCurrencyCatalogProviderOptions {
  readonly loader: CurrencyCatalogLoader
  readonly getIdentity: () => CurrencyCatalogIdentity
  readonly getAuthSignal: () => AbortSignal
  readonly now: () => number
  readonly channelFactory?: CurrencyCatalogBroadcastChannelFactory
}

export interface CurrencyCatalogInvalidationOptions {
  readonly broadcast: boolean
}

export interface CurrencyCatalogProviderController {
  readonly provider: CurrencyCatalogProvider
  readonly invalidate: (options: CurrencyCatalogInvalidationOptions) => void
  readonly dispose: () => void
}

interface CacheEntry {
  readonly expiresAt: number
  readonly value: readonly CurrencyCatalogItem[]
}

interface RuntimeContext {
  readonly authSignal: AbortSignal
  readonly identityKey: string
}

interface InFlightEntry {
  readonly controller: AbortController
  readonly consumers: Set<symbol>
  promise: Promise<readonly CurrencyCatalogItem[]>
  settled: boolean
}

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

function identityKey(identity: CurrencyCatalogIdentity): string {
  if (
    typeof identity !== 'object'
    || identity === null
    || !Number.isSafeInteger(identity.authEpoch)
    || identity.authEpoch < 0
    || (identity.userId !== null && typeof identity.userId !== 'string')
  ) {
    throw new TypeError('Invalid currency catalog identity')
  }

  // JSON tuple 明确区分 `null` 与字符串 `"null"`，避免身份缓存 key 碰撞。
  return JSON.stringify([identity.authEpoch, identity.userId])
}

function isExactCatalogChangedMessage(
  value: unknown,
): value is typeof CURRENCY_CATALOG_CHANGED_MESSAGE {
  if (!isPlainRecord(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.length === 1
    && keys[0] === 'type'
    && value.type === CURRENCY_CATALOG_CHANGED_MESSAGE.type
}

/**
 * 创建隔离的货币目录内核。
 *
 * API、账户 Store 和浏览器 BroadcastChannel 的构造均由调用方注入；因此测试、
 * Showcase 与正式应用可以复用同一套缓存和可信边界，而不会形成隐藏全局状态。
 */
export function createCurrencyCatalogProvider(
  options: CreateCurrencyCatalogProviderOptions,
): CurrencyCatalogProviderController {
  const cache = new Map<string, CacheEntry>()
  const inFlight = new Map<string, InFlightEntry>()
  const invalidationListeners = new Set<() => void>()
  let generation = 0
  let disposed = false
  let currentIdentityKey: string | null = null
  let currentAuthSignal: AbortSignal | null = null
  let authAbortListener: (() => void) | null = null
  let channel: CurrencyCatalogBroadcastChannel | null = null

  function notifyInvalidation(): void {
    for (const listener of [...invalidationListeners]) {
      try {
        listener()
      }
      catch {
        // 一个消费者异常不能阻止其他金额组件收到目录失效通知。
      }
    }
  }

  function abortAllInFlight(): void {
    const entries = [...inFlight.values()]
    inFlight.clear()
    for (const entry of entries) {
      entry.controller.abort()
    }
  }

  function clearRuntimeData(): void {
    generation += 1
    abortAllInFlight()
    cache.clear()
  }

  function invalidateLocal(): void {
    if (disposed) {
      return
    }
    clearRuntimeData()
    notifyInvalidation()
  }

  function unbindAuthSignal(): void {
    if (currentAuthSignal !== null && authAbortListener !== null) {
      currentAuthSignal.removeEventListener('abort', authAbortListener)
    }
    authAbortListener = null
  }

  function bindAuthSignal(signal: AbortSignal): void {
    unbindAuthSignal()
    currentAuthSignal = signal
    authAbortListener = () => {
      if (currentAuthSignal === signal) {
        invalidateLocal()
      }
    }
    if (!signal.aborted) {
      signal.addEventListener('abort', authAbortListener, { once: true })
    }
  }

  function readRuntimeContext(): RuntimeContext {
    const nextIdentityKey = identityKey(options.getIdentity())
    const authSignal = options.getAuthSignal()
    if (
      typeof authSignal !== 'object'
      || authSignal === null
      || typeof authSignal.aborted !== 'boolean'
      || typeof authSignal.addEventListener !== 'function'
      || typeof authSignal.removeEventListener !== 'function'
    ) {
      throw new TypeError('Invalid currency catalog auth signal')
    }
    return {
      authSignal,
      identityKey: nextIdentityKey,
    }
  }

  function applyRuntimeContext(next: RuntimeContext): void {
    const authSignalChanged = currentAuthSignal !== next.authSignal
    const changed = currentIdentityKey !== next.identityKey
      || authSignalChanged
    const shouldInvalidate = currentIdentityKey !== null && changed

    if (shouldInvalidate) {
      /*
       * 先切断旧 generation，再发布新上下文，保证失效订阅者同步重取时看到的
       * 是新 identity/signal，并可和当前发起者共享同一 in-flight 请求。
       */
      clearRuntimeData()
    }
    currentIdentityKey = next.identityKey
    if (authSignalChanged) {
      bindAuthSignal(next.authSignal)
    }
    if (shouldInvalidate) {
      notifyInvalidation()
    }
  }

  function synchronizeRuntimeContext(): RuntimeContext {
    if (disposed) {
      throw createAbortError()
    }
    const next = readRuntimeContext()
    applyRuntimeContext(next)
    if (next.authSignal.aborted) {
      throw createAbortError()
    }
    return next
  }

  function completionIsCurrent(
    capturedContext: RuntimeContext,
    capturedGeneration: number,
    controller: AbortController,
  ): boolean {
    if (
      disposed
      || controller.signal.aborted
      || capturedGeneration !== generation
      || capturedContext.authSignal.aborted
    ) {
      return false
    }

    let current: RuntimeContext
    try {
      current = readRuntimeContext()
    }
    catch {
      invalidateLocal()
      return false
    }

    if (
      current.identityKey !== capturedContext.identityKey
      || current.authSignal !== capturedContext.authSignal
      || current.authSignal.aborted
    ) {
      applyRuntimeContext(current)
      return false
    }
    return capturedGeneration === generation
  }

  function createInFlightEntry(
    key: string,
    context: RuntimeContext,
  ): InFlightEntry {
    const controller = new AbortController()
    const capturedGeneration = generation
    const entry: InFlightEntry = {
      controller,
      consumers: new Set(),
      promise: Promise.resolve(Object.freeze([])),
      settled: false,
    }

    const work = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) {
          throw createAbortError()
        }
        return options.loader(controller.signal)
      })
      .then((rawValue) => {
        if (controller.signal.aborted) {
          throw createAbortError()
        }
        const value = cloneCurrencyCatalogResponse(rawValue)
        if (!completionIsCurrent(
          context,
          capturedGeneration,
          controller,
        )) {
          throw createAbortError()
        }
        cache.set(key, {
          expiresAt: options.now() + CURRENCY_CATALOG_CACHE_TTL_MS,
          value,
        })
        return value
      })

    /*
     * loader 允许忽略 AbortSignal；主动 race 底层 controller，确保 logout、
     * local invalidation 或最后一个消费者取消时，上层 Promise 仍会立即终止。
     */
    const aborted = new Promise<never>((_resolve, reject) => {
      const rejectAsAborted = () => {
        reject(createAbortError())
      }
      if (controller.signal.aborted) {
        rejectAsAborted()
      }
      else {
        controller.signal.addEventListener('abort', rejectAsAborted, {
          once: true,
        })
      }
    })

    entry.promise = Promise.race([work, aborted])
      .finally(() => {
        entry.settled = true
        if (inFlight.get(key) === entry) {
          inFlight.delete(key)
        }
      })

    return entry
  }

  function consumeInFlight(
    key: string,
    entry: InFlightEntry,
    signal: AbortSignal,
  ): Promise<readonly CurrencyCatalogItem[]> {
    const consumer = Symbol(key)
    entry.consumers.add(consumer)

    return new Promise((resolve, reject) => {
      let finished = false
      let abortListener: (() => void) | null = null

      const cleanup = () => {
        if (abortListener !== null) {
          signal.removeEventListener('abort', abortListener)
        }
        entry.consumers.delete(consumer)
      }
      const finish = (value: readonly CurrencyCatalogItem[]) => {
        if (finished) {
          return
        }
        finished = true
        cleanup()
        resolve(value)
      }
      const fail = (reason: unknown) => {
        if (finished) {
          return
        }
        finished = true
        cleanup()
        reject(reason)
      }
      abortListener = () => {
        fail(createAbortError())
        if (!entry.settled && entry.consumers.size === 0) {
          if (inFlight.get(key) === entry) {
            inFlight.delete(key)
          }
          entry.controller.abort()
        }
      }

      signal.addEventListener('abort', abortListener, { once: true })
      if (signal.aborted) {
        abortListener()
        return
      }

      entry.promise.then(finish, fail)
    })
  }

  function list(
    signal: AbortSignal,
  ): Promise<readonly CurrencyCatalogItem[]> {
    if (signal.aborted) {
      return Promise.reject(createAbortError())
    }

    let context: RuntimeContext
    try {
      context = synchronizeRuntimeContext()
    }
    catch (error) {
      return Promise.reject(error)
    }

    const key = `${context.identityKey}|catalog`
    const cached = cache.get(key)
    if (cached !== undefined) {
      if (options.now() < cached.expiresAt) {
        return Promise.resolve(cached.value)
      }
      cache.delete(key)
    }

    let entry = inFlight.get(key)
    if (entry === undefined) {
      entry = createInFlightEntry(key, context)
      inFlight.set(key, entry)
    }
    return consumeInFlight(key, entry, signal)
  }

  // 先验证身份上下文，再创建可选的跨标签资源；初始化失败不能泄漏 channel。
  const initialContext = readRuntimeContext()
  currentIdentityKey = initialContext.identityKey
  bindAuthSignal(initialContext.authSignal)

  try {
    channel = options.channelFactory?.(
      CURRENCY_CATALOG_BROADCAST_CHANNEL_NAME,
    ) ?? null
  }
  catch {
    // 跨标签同步是可选增强；创建失败时仍由 local invalidation 与 TTL 最终收敛。
    channel = null
  }

  if (channel !== null) {
    channel.onmessage = (event) => {
      if (isExactCatalogChangedMessage(event.data)) {
        invalidateLocal()
      }
    }
  }

  const provider: CurrencyCatalogProvider = Object.freeze({
    list: ({
      signal,
    }: {
      readonly signal: AbortSignal
    }) => list(signal),
    subscribeInvalidation: (listener: () => void) => {
      if (disposed) {
        return () => undefined
      }
      invalidationListeners.add(listener)
      let subscribed = true
      return () => {
        if (subscribed) {
          subscribed = false
          invalidationListeners.delete(listener)
        }
      }
    },
  })

  return Object.freeze({
    provider,
    invalidate: ({
      broadcast,
    }: CurrencyCatalogInvalidationOptions) => {
      if (disposed) {
        return
      }
      invalidateLocal()
      if (broadcast && channel !== null) {
        try {
          channel.postMessage(CURRENCY_CATALOG_CHANGED_MESSAGE)
        }
        catch {
          // 当前 tab 已完成失效；跨标签失败不能反向破坏已经成功的管理写操作。
        }
      }
    },
    dispose: () => {
      if (disposed) {
        return
      }
      generation += 1
      abortAllInFlight()
      cache.clear()
      unbindAuthSignal()
      invalidationListeners.clear()
      disposed = true
      if (channel !== null) {
        channel.onmessage = null
        try {
          channel.close()
        }
        catch {
          // dispose 保持幂等，浏览器 channel teardown 异常不应阻断应用卸载。
        }
        channel = null
      }
    },
  } satisfies CurrencyCatalogProviderController)
}
