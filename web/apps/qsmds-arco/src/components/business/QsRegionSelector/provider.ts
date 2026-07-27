import type { InjectionKey } from 'vue'
import type {
  RegionLevel,
  RegionSelectorNode,
  RegionSelectorPath,
  RegionSelectorProvider,
  RegionSelectorSearchResult,
} from './types'

export const REGION_SELECTOR_CACHE_TTL_MS = 300_000

const REGION_BROADCAST_CHANNEL_NAME = 'qianshu-regions-v1'
const REGION_RESPONSE_ERROR_CODE = 'REGION_SELECTOR_RESPONSE_INVALID'
const REGION_RESPONSE_ERROR_MESSAGE = '地区数据响应格式无效'
const UNICODE_WHITESPACE_PATTERN = /\p{White_Space}+/gu
const UUID_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const REGION_LEVELS = new Set<RegionLevel>([
  'COUNTRY_REGION',
  'PROVINCE_STATE',
  'CITY',
])
const REGION_CHANGED_MESSAGE = Object.freeze({
  type: 'REGIONS_CHANGED',
} as const)

export interface RegionSelectorIdentity {
  readonly authEpoch: number
  readonly userId: string | null
}

/**
 * API adapter 只把 AxiosResponse 解包为 `unknown`，运行时可信边界由 Provider 统一承担。
 * 这样 Provider 不依赖 Axios、generated DTO、Store 或任何持久化实现。
 */
export interface RegionSelectorDataSource {
  readonly listOptions: (
    parentId: string | null,
    signal: AbortSignal,
  ) => Promise<unknown>
  readonly getPath: (
    cityId: string,
    signal: AbortSignal,
  ) => Promise<unknown>
  readonly search: (
    query: string,
    signal: AbortSignal,
  ) => Promise<unknown>
}

export interface RegionBroadcastChannel {
  onmessage: ((event: MessageEvent<unknown>) => void) | null
  postMessage: (message: unknown) => void
  close: () => void
}

export type RegionBroadcastChannelFactory
  = (name: string) => RegionBroadcastChannel

export interface CreateRegionSelectorProviderOptions {
  readonly dataSource: RegionSelectorDataSource
  readonly getIdentity: () => RegionSelectorIdentity
  readonly getAuthSignal: () => AbortSignal
  readonly now: () => number
  readonly channelFactory?: RegionBroadcastChannelFactory
}

export interface RegionSelectorCacheInvalidationOptions {
  readonly broadcast: boolean
}

export interface RegionSelectorProviderController {
  readonly provider: RegionSelectorProvider
  readonly invalidate: (
    options: RegionSelectorCacheInvalidationOptions,
  ) => void
  readonly dispose: () => void
}

interface CacheEntry<T> {
  readonly expiresAt: number
  readonly value: T
}

interface RuntimeContext {
  readonly authSignal: AbortSignal
  readonly identityKey: string
}

interface InFlightEntry<T> {
  readonly controller: AbortController
  readonly consumers: Set<symbol>
  promise: Promise<T>
  settled: boolean
}

/**
 * API 成功但响应结构不可信时统一使用固定错误。
 *
 * 错误不包含字段路径、原始响应或 getter 抛出的异常，组件可以安全展示固定本地文案，
 * 同时避免把服务端内部数据带入用户界面或日志。
 */
export class RegionSelectorResponseError extends Error {
  readonly code = REGION_RESPONSE_ERROR_CODE

  constructor() {
    super(REGION_RESPONSE_ERROR_MESSAGE)
    this.name = 'RegionSelectorResponseError'
  }
}

export const regionSelectorProviderKey
  = Symbol('QsRegionSelectorProvider') as InjectionKey<RegionSelectorProvider>

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function expectPlainRecord(value: unknown): Record<string, unknown> {
  if (!isPlainRecord(value)) {
    throw new TypeError('Invalid object')
  }
  return value
}

function expectUuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new TypeError('Invalid UUID')
  }
  return value
}

function expectRequiredString(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Invalid string')
  }
  return value
}

function expectNullableString(value: unknown): string | null {
  if (value !== null && typeof value !== 'string') {
    throw new TypeError('Invalid nullable string')
  }
  return value
}

function expectBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError('Invalid boolean')
  }
  return value
}

function expectLevel(value: unknown): RegionLevel {
  if (typeof value !== 'string' || !REGION_LEVELS.has(value as RegionLevel)) {
    throw new TypeError('Invalid region level')
  }
  return value as RegionLevel
}

function expectParentId(value: unknown): string | null {
  return value === null ? null : expectUuid(value)
}

/**
 * 只读取公共领域字段并创建新对象；即使 DTO 带有未来新增字段，也不会扩散到组件契约。
 */
function cloneNode(value: unknown): RegionSelectorNode {
  const source = expectPlainRecord(value)
  const node: RegionSelectorNode = {
    id: expectUuid(source.id),
    parentId: expectParentId(source.parentId),
    level: expectLevel(source.level),
    name: expectRequiredString(source.name),
    englishName: expectNullableString(source.englishName),
    code: expectRequiredString(source.code),
    enabled: expectBoolean(source.enabled),
    effectiveEnabled: expectBoolean(source.effectiveEnabled),
    hasChildren: expectBoolean(source.hasChildren),
  }
  return Object.freeze(node)
}

function clonePath(value: unknown, expectedCityId: string): RegionSelectorPath {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError('Invalid path length')
  }

  const country = cloneNode(value[0])
  const province = cloneNode(value[1])
  const city = cloneNode(value[2])

  if (
    country.level !== 'COUNTRY_REGION'
    || province.level !== 'PROVINCE_STATE'
    || city.level !== 'CITY'
    || country.parentId !== null
    || province.parentId !== country.id
    || city.parentId !== province.id
    || city.id !== expectedCityId
  ) {
    throw new TypeError('Invalid path hierarchy')
  }

  return Object.freeze([
    country as RegionSelectorNode<'COUNTRY_REGION'>,
    province as RegionSelectorNode<'PROVINCE_STATE'>,
    city as RegionSelectorNode<'CITY'>,
  ])
}

function safelyCloneResponse<T>(clone: () => T): T {
  try {
    return clone()
  }
  catch {
    throw new RegionSelectorResponseError()
  }
}

function cloneOptionsResponse(
  value: unknown,
  expectedParentId: string | null,
): readonly RegionSelectorNode[] {
  return safelyCloneResponse(() => {
    if (!Array.isArray(value)) {
      throw new TypeError('Invalid options')
    }

    const ids = new Set<string>()
    let level: RegionLevel | undefined
    const nodes = value.map((item) => {
      const node = cloneNode(item)
      if (
        node.parentId !== expectedParentId
        || (expectedParentId === null && node.level !== 'COUNTRY_REGION')
        || (expectedParentId !== null && node.level === 'COUNTRY_REGION')
        || !node.enabled
        || !node.effectiveEnabled
        || ids.has(node.id)
        || (level !== undefined && node.level !== level)
      ) {
        throw new TypeError('Invalid option hierarchy')
      }
      ids.add(node.id)
      level = node.level
      return node
    })

    return Object.freeze(nodes)
  })
}

function clonePathResponse(
  value: unknown,
  requestedCityId: string,
): RegionSelectorPath {
  return safelyCloneResponse(() => {
    const source = expectPlainRecord(value)
    const responseCityId = expectUuid(source.cityId)
    if (responseCityId !== requestedCityId) {
      throw new TypeError('Invalid response city ID')
    }
    return clonePath(source.path, requestedCityId)
  })
}

function cloneSearchResponse(value: unknown): RegionSelectorSearchResult {
  return safelyCloneResponse(() => {
    const source = expectPlainRecord(value)
    if (
      !Array.isArray(source.items)
      || !Number.isSafeInteger(source.limit)
      || (source.limit as number) < 1
      || (source.limit as number) > 50
    ) {
      throw new TypeError('Invalid search response')
    }

    const hasMore = expectBoolean(source.hasMore)
    const paths = source.items.map((item) => {
      const searchItem = expectPlainRecord(item)
      const cityId = expectUuid(searchItem.cityId)
      const path = clonePath(searchItem.path, cityId)
      if (path.some(node => !node.enabled || !node.effectiveEnabled)) {
        throw new TypeError('Invalid disabled search path')
      }
      return path
    })

    return Object.freeze({
      paths: Object.freeze(paths),
      hasMore,
    })
  })
}

function normalizeSearchQuery(query: string): string {
  return query
    .normalize('NFC')
    .replace(UNICODE_WHITESPACE_PATTERN, ' ')
    .trim()
    .toLocaleLowerCase('en-US')
    .normalize('NFC')
}

function identityKey(identity: RegionSelectorIdentity): string {
  if (
    !Number.isSafeInteger(identity.authEpoch)
    || identity.authEpoch < 0
    || (identity.userId !== null && typeof identity.userId !== 'string')
  ) {
    throw new TypeError('Invalid region selector identity')
  }
  return `${identity.authEpoch}:${identity.userId ?? 'null'}`
}

function isExactRegionChangedMessage(
  value: unknown,
): value is typeof REGION_CHANGED_MESSAGE {
  if (!isPlainRecord(value)) {
    return false
  }
  const keys = Object.keys(value)
  return keys.length === 1
    && keys[0] === 'type'
    && value.type === REGION_CHANGED_MESSAGE.type
}

/**
 * 创建完全隔离的 Provider。默认实例注册由 `installDefaultRegionSelectorProvider`
 * 单独处理，避免 Showcase 或测试 fixture 意外覆盖正式应用的缓存控制器。
 */
export function createRegionSelectorProvider(
  options: CreateRegionSelectorProviderOptions,
): RegionSelectorProviderController {
  const cache = new Map<string, CacheEntry<unknown>>()
  const inFlight = new Map<string, InFlightEntry<unknown>>()
  const invalidationListeners = new Set<() => void>()
  let generation = 0
  let disposed = false
  let currentIdentityKey: string | null = null
  let currentAuthSignal: AbortSignal | null = null
  let authAbortListener: (() => void) | null = null
  let channel: RegionBroadcastChannel | null = null

  function notifyInvalidation(): void {
    for (const listener of [...invalidationListeners]) {
      try {
        listener()
      }
      catch {
        // 一个组件的回调异常不能阻止其他已挂载选择器收到失效通知。
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

  function invalidateLocal(): void {
    if (disposed) {
      return
    }
    generation += 1
    abortAllInFlight()
    cache.clear()
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
    ) {
      throw new TypeError('Invalid region selector auth signal')
    }
    return {
      authSignal,
      identityKey: nextIdentityKey,
    }
  }

  function applyRuntimeContext(next: RuntimeContext): void {
    const changed = currentIdentityKey !== next.identityKey
      || currentAuthSignal !== next.authSignal
    if (currentIdentityKey !== null && changed) {
      // 身份边界必须先推进 generation 并中止旧请求，再切换到新 identity/signal。
      invalidateLocal()
    }
    currentIdentityKey = next.identityKey
    if (currentAuthSignal !== next.authSignal) {
      bindAuthSignal(next.authSignal)
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

  function createInFlightEntry<T>(
    key: string,
    context: RuntimeContext,
    loader: (signal: AbortSignal) => Promise<unknown>,
    clone: (value: unknown) => T,
  ): InFlightEntry<T> {
    const controller = new AbortController()
    const capturedGeneration = generation
    const entry: InFlightEntry<T> = {
      controller,
      consumers: new Set(),
      promise: Promise.resolve(undefined as T),
      settled: false,
    }

    const work = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) {
          throw createAbortError()
        }
        return loader(controller.signal)
      })
      .then((rawValue) => {
        if (controller.signal.aborted) {
          throw createAbortError()
        }
        const value = clone(rawValue)
        if (!completionIsCurrent(
          context,
          capturedGeneration,
          controller,
        )) {
          throw createAbortError()
        }
        cache.set(key, {
          expiresAt: options.now() + REGION_SELECTOR_CACHE_TTL_MS,
          value,
        })
        return value
      })

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

  function consumeInFlight<T>(
    key: string,
    entry: InFlightEntry<T>,
    signal: AbortSignal,
  ): Promise<T> {
    const consumer = Symbol(key)
    entry.consumers.add(consumer)

    return new Promise<T>((resolve, reject) => {
      let finished = false
      let abortListener: (() => void) | null = null

      const cleanup = () => {
        if (abortListener !== null) {
          signal.removeEventListener('abort', abortListener)
        }
        entry.consumers.delete(consumer)
      }
      const finish = (
        settle: (value: T | PromiseLike<T>) => void,
        value: T,
      ) => {
        if (finished) {
          return
        }
        finished = true
        cleanup()
        settle(value)
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

      entry.promise.then(
        value => finish(resolve, value),
        fail,
      )
    })
  }

  async function getOrLoad<T>(
    keySuffix: string,
    signal: AbortSignal,
    loader: (signal: AbortSignal) => Promise<unknown>,
    clone: (value: unknown) => T,
  ): Promise<T> {
    if (signal.aborted) {
      throw createAbortError()
    }

    const context = synchronizeRuntimeContext()
    const key = `${context.identityKey}|${keySuffix}`
    const cached = cache.get(key) as CacheEntry<T> | undefined
    if (cached !== undefined) {
      if (options.now() < cached.expiresAt) {
        return cached.value
      }
      cache.delete(key)
    }

    let entry = inFlight.get(key) as InFlightEntry<T> | undefined
    if (entry === undefined) {
      entry = createInFlightEntry(key, context, loader, clone)
      inFlight.set(key, entry as InFlightEntry<unknown>)
    }
    return consumeInFlight(key, entry, signal)
  }

  try {
    channel = options.channelFactory?.(REGION_BROADCAST_CHANNEL_NAME) ?? null
  }
  catch {
    // BroadcastChannel 是可选增强；创建失败时仍依赖当前 tab 失效和 5 分钟 TTL。
    channel = null
  }

  if (channel !== null) {
    channel.onmessage = (event) => {
      if (isExactRegionChangedMessage(event.data)) {
        invalidateLocal()
      }
    }
  }

  const initialContext = readRuntimeContext()
  currentIdentityKey = initialContext.identityKey
  bindAuthSignal(initialContext.authSignal)

  const provider: RegionSelectorProvider = Object.freeze({
    listChildren: ({
      parentId,
      signal,
    }: {
      readonly parentId: string | null
      readonly signal: AbortSignal
    }) => getOrLoad(
      `options|${parentId ?? 'root'}`,
      signal,
      requestSignal => options.dataSource.listOptions(
        parentId,
        requestSignal,
      ),
      value => cloneOptionsResponse(value, parentId),
    ),
    resolvePath: ({
      cityId,
      signal,
    }: {
      readonly cityId: string
      readonly signal: AbortSignal
    }) => getOrLoad(
      `path|${cityId}`,
      signal,
      requestSignal => options.dataSource.getPath(cityId, requestSignal),
      value => clonePathResponse(value, cityId),
    ),
    search: ({
      query,
      signal,
    }: {
      readonly query: string
      readonly signal: AbortSignal
    }) => {
      const normalizedQuery = normalizeSearchQuery(query)
      return getOrLoad(
        `search|${normalizedQuery}`,
        signal,
        requestSignal => options.dataSource.search(
          normalizedQuery,
          requestSignal,
        ),
        cloneSearchResponse,
      )
    },
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

  const controller: RegionSelectorProviderController = Object.freeze({
    provider,
    invalidate: ({
      broadcast,
    }: RegionSelectorCacheInvalidationOptions) => {
      if (disposed) {
        return
      }
      invalidateLocal()
      if (broadcast && channel !== null) {
        try {
          channel.postMessage(REGION_CHANGED_MESSAGE)
        }
        catch {
          // 当前 tab 已经完成失效；跨 tab 失败由 TTL 最终收敛，不能反向破坏写流程。
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
          // dispose 必须幂等且不因浏览器 channel teardown 异常阻断应用卸载。
        }
        channel = null
      }
    },
  })

  return controller
}

let defaultController: RegionSelectorProviderController | null = null

/**
 * 应用启动层显式安装唯一默认实例；隔离测试和 Showcase 继续使用普通 factory。
 */
export function installDefaultRegionSelectorProvider(
  options: CreateRegionSelectorProviderOptions,
): RegionSelectorProviderController {
  const created = createRegionSelectorProvider(options)
  const previous = defaultController
  let installed = true

  const controller: RegionSelectorProviderController = Object.freeze({
    provider: created.provider,
    invalidate: created.invalidate,
    dispose: () => {
      if (!installed) {
        return
      }
      installed = false
      created.dispose()
      if (defaultController === controller) {
        defaultController = null
      }
    },
  })

  defaultController = controller
  previous?.dispose()
  return controller
}

/**
 * 地区管理 mutation 成功后的应用级失效入口。
 *
 * 未安装默认 Provider 时安全 no-op，避免业务写已经成功却因展示层尚未挂载而报错。
 */
export function invalidateRegionSelectorCache(
  options: RegionSelectorCacheInvalidationOptions,
): void {
  defaultController?.invalidate(options)
}
