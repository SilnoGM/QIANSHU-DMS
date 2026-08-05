import type {
  DictionaryCatalog,
  DictionaryCatalogIdentity,
  DictionaryCatalogIdentitySource,
  DictionaryCatalogInvalidationEvent,
  DictionaryCatalogLoader,
  DictionaryCatalogProvider,
} from './types'
import {
  cloneDictionaryCatalogBatchResponse,
  cloneDictionaryCatalogResponse,
  isPlainRecord,
  normalizeDictionaryCatalogCode,
} from './validation'

export { DictionaryCatalogResponseError } from './validation'

export const DICTIONARY_CATALOG_CACHE_TTL_MS = 300_000

const DICTIONARY_CATALOG_BROADCAST_CHANNEL_NAME
  = 'qianshu-dictionary-catalog-v1'
const DICTIONARY_CATALOG_CHANGED_MESSAGE_TYPE
  = 'DICTIONARY_CATALOG_CHANGED'
const DICTIONARY_CATALOG_PREFETCH_MAX_CODES = 20

export interface DictionaryCatalogInvalidationInput {
  readonly code: string
  readonly broadcast: boolean
}

export interface CreateDictionaryCatalogProviderInput {
  readonly identitySource: DictionaryCatalogIdentitySource
  readonly loader: DictionaryCatalogLoader
  readonly now?: () => number
  readonly createBroadcastChannel?: (name: string) => BroadcastChannel
}

export interface DictionaryCatalogProviderController {
  readonly provider: DictionaryCatalogProvider
  readonly invalidate: (input: DictionaryCatalogInvalidationInput) => void
  readonly dispose: () => void
}

interface CacheEntry {
  readonly code: string
  readonly expiresAt: number
  readonly value: DictionaryCatalog | null
}

interface InFlightEntry<T> {
  readonly controller: AbortController
  readonly consumers: Set<symbol>
  promise: Promise<T>
  settled: boolean
}

interface SingleInFlightEntry
  extends InFlightEntry<DictionaryCatalog | null> {
  readonly code: string
  readonly key: string
}

interface BatchInFlightEntry extends InFlightEntry<void> {
  readonly codes: readonly string[]
  readonly keys: readonly string[]
}

type CatalogInFlightEntry = BatchInFlightEntry | SingleInFlightEntry

interface CapturedIdentity {
  readonly fingerprint: string
  readonly generation: number
  readonly identity: DictionaryCatalogIdentity & { readonly userId: string }
}

interface DictionaryCatalogChangedMessage {
  readonly code: string
  readonly type: typeof DICTIONARY_CATALOG_CHANGED_MESSAGE_TYPE
}

/** 未建立认证身份时使用固定错误，避免调用方误把未登录当成 Catalog 缺失。 */
export class DictionaryCatalogIdentityRequiredError extends Error {
  readonly code = 'DICTIONARY_CATALOG_IDENTITY_REQUIRED'

  constructor() {
    super('Dictionary catalog identity is required')
    this.name = 'DictionaryCatalogIdentityRequiredError'
  }
}

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

function validateIdentity(value: unknown): DictionaryCatalogIdentity {
  if (
    !isPlainRecord(value)
    || !Number.isSafeInteger(value.authEpoch)
    || (value.authEpoch as number) < 0
    || (value.userId !== null && typeof value.userId !== 'string')
  ) {
    throw new TypeError('Invalid dictionary catalog identity')
  }

  return Object.freeze({
    authEpoch: value.authEpoch as number,
    userId: value.userId as string | null,
  })
}

function createIdentityFingerprint(
  identity: DictionaryCatalogIdentity,
): string {
  return JSON.stringify([identity.authEpoch, identity.userId])
}

function createCacheKey(
  identity: DictionaryCatalogIdentity,
  code: string,
): string {
  const { authEpoch, userId } = identity
  // JSON tuple 可无歧义地区分身份 epoch、用户和规范化后的目录 code。
  return JSON.stringify([authEpoch, userId, code])
}

function isStableDictionaryTypeNotFound(error: unknown): boolean {
  try {
    return isPlainRecord(error)
      && error.kind === 'http'
      && error.status === 404
      && isPlainRecord(error.body)
      && error.body.code === 'DICTIONARY_TYPE_NOT_FOUND'
      && typeof error.body.message === 'string'
      && typeof error.body.requestId === 'string'
  }
  catch {
    // Proxy/getter 等不可信错误对象不能绕过负缓存白名单。
    return false
  }
}

function normalizePrefetchCodes(codes: readonly string[]): readonly string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const code of codes) {
    const normalizedCode = normalizeDictionaryCatalogCode(code)
    if (seen.has(normalizedCode)) {
      continue
    }
    seen.add(normalizedCode)
    normalized.push(normalizedCode)
    if (normalized.length > DICTIONARY_CATALOG_PREFETCH_MAX_CODES) {
      throw new TypeError('Too many dictionary catalog prefetch codes')
    }
  }
  return Object.freeze(normalized)
}

function parseExactCatalogChangedMessage(
  value: unknown,
): DictionaryCatalogChangedMessage | null {
  try {
    if (!isPlainRecord(value)) {
      return null
    }
    const keys = Reflect.ownKeys(value)
    if (
      keys.length !== 2
      || !keys.includes('code')
      || !keys.includes('type')
      || value.type !== DICTIONARY_CATALOG_CHANGED_MESSAGE_TYPE
    ) {
      return null
    }
    const code = normalizeDictionaryCatalogCode(value.code)
    return Object.freeze({
      code,
      type: DICTIONARY_CATALOG_CHANGED_MESSAGE_TYPE,
    })
  }
  catch {
    return null
  }
}

/**
 * 创建身份隔离的 Dictionary Catalog 内核。
 *
 * API、账户状态与 BroadcastChannel 构造全部由外部注入；内核只维护内存缓存、
 * 并发 ownership 和可信响应边界，不形成 Store 或持久化依赖。
 */
export function createDictionaryCatalogProviderController(
  input: CreateDictionaryCatalogProviderInput,
): DictionaryCatalogProviderController {
  const now = input.now ?? (() => Date.now())
  const cache = new Map<string, CacheEntry>()
  const singleInFlight = new Map<string, SingleInFlightEntry>()
  const batchInFlightByCode = new Map<string, BatchInFlightEntry>()
  const batchInFlightEntries = new Set<BatchInFlightEntry>()
  const batchGetControllersByCode = new Map<
    string,
    Set<AbortController>
  >()
  const codeGenerations = new Map<string, number>()
  const invalidationListeners = new Set<(
    event: DictionaryCatalogInvalidationEvent,
  ) => void>()
  let identityGeneration = 0
  let currentIdentity = validateIdentity(input.identitySource.getSnapshot())
  let currentIdentityFingerprint = createIdentityFingerprint(currentIdentity)
  let pendingIdentity: DictionaryCatalogIdentity | null = null
  let identitySourceInvalid = false
  let disposed = false
  let channel: BroadcastChannel | null = null

  function notifyInvalidation(event: DictionaryCatalogInvalidationEvent): void {
    for (const listener of [...invalidationListeners]) {
      try {
        listener(event)
      }
      catch {
        // 一个消费方异常不能阻止其他页面收到同一失效事件。
      }
    }
  }

  function abortAllInFlight(): void {
    const singleEntries = [...singleInFlight.values()]
    const batchEntries = [...batchInFlightEntries]
    singleInFlight.clear()
    batchInFlightByCode.clear()
    batchInFlightEntries.clear()
    batchGetControllersByCode.clear()
    for (const entry of [...singleEntries, ...batchEntries]) {
      entry.controller.abort()
    }
  }

  function clearIdentityDomain(): void {
    identityGeneration += 1
    abortAllInFlight()
    cache.clear()
    codeGenerations.clear()
  }

  function invalidateIdentitySource(): TypeError {
    pendingIdentity = null
    if (!identitySourceInvalid) {
      identitySourceInvalid = true
      clearIdentityDomain()
      notifyInvalidation({ code: null })
    }
    return new TypeError('Invalid dictionary catalog identity')
  }

  function applyIdentity(nextIdentity: DictionaryCatalogIdentity): void {
    identitySourceInvalid = false
    const nextFingerprint = createIdentityFingerprint(nextIdentity)
    if (nextFingerprint === currentIdentityFingerprint) {
      currentIdentity = nextIdentity
      return
    }

    /*
     * 先切断旧 generation 和请求 ownership，再发布新身份。失效订阅者同步重取
     * 时只能看到新 identity，不会与旧用户的 in-flight 合并。
     */
    clearIdentityDomain()
    currentIdentity = nextIdentity
    currentIdentityFingerprint = nextFingerprint
    notifyInvalidation({ code: null })
  }

  function synchronizeIdentity(): CapturedIdentity {
    if (disposed) {
      throw createAbortError()
    }
    let snapshot: DictionaryCatalogIdentity
    try {
      snapshot = validateIdentity(input.identitySource.getSnapshot())
    }
    catch {
      throw invalidateIdentitySource()
    }

    if (pendingIdentity !== null) {
      const pendingFingerprint = createIdentityFingerprint(pendingIdentity)
      const snapshotFingerprint = createIdentityFingerprint(snapshot)
      if (snapshotFingerprint === pendingFingerprint) {
        pendingIdentity = null
      }
      else if (snapshot.authEpoch <= pendingIdentity.authEpoch) {
        /*
         * subscribe 可能先发布新身份、随后才提交 snapshot。该短暂窗口内拒绝
         * 同步 reload，绝不切回旧身份并重新发起 Catalog 请求。
         */
        throw createAbortError()
      }
      else {
        // snapshot 已越过订阅事件，说明后续身份通知被合并，直接采用更新状态。
        pendingIdentity = null
      }
    }
    applyIdentity(snapshot)
    if (currentIdentity.userId === null) {
      throw new DictionaryCatalogIdentityRequiredError()
    }
    return {
      fingerprint: currentIdentityFingerprint,
      generation: identityGeneration,
      identity: currentIdentity as DictionaryCatalogIdentity & {
        readonly userId: string
      },
    }
  }

  function completionHasCurrentIdentity(
    captured: CapturedIdentity,
    controller: AbortController,
  ): boolean {
    if (
      disposed
      || controller.signal.aborted
      || captured.generation !== identityGeneration
    ) {
      return false
    }

    try {
      const snapshot = validateIdentity(input.identitySource.getSnapshot())
      applyIdentity(snapshot)
    }
    catch {
      /*
       * 身份源异常时宁可清空所有缓存。原始异常不进入 loader Promise，避免身份
       * 对象中潜在的不可信内容沿错误链泄漏。
       */
      invalidateIdentitySource()
      return false
    }

    return !controller.signal.aborted
      && captured.generation === identityGeneration
      && captured.fingerprint === currentIdentityFingerprint
      && currentIdentity.userId !== null
  }

  function codeGeneration(code: string): number {
    return codeGenerations.get(code) ?? 0
  }

  function readCache(key: string): DictionaryCatalog | null | undefined {
    const cached = cache.get(key)
    if (cached === undefined) {
      return undefined
    }
    if (now() < cached.expiresAt) {
      return cached.value
    }
    cache.delete(key)
    return undefined
  }

  function writeCache(
    key: string,
    code: string,
    value: DictionaryCatalog | null,
  ): void {
    cache.set(key, {
      code,
      expiresAt: now() + DICTIONARY_CATALOG_CACHE_TTL_MS,
      value,
    })
  }

  function consumeInFlight<T>(
    entry: InFlightEntry<T>,
    signal: AbortSignal,
    removeOwnership: () => void,
  ): Promise<T> {
    const consumer = Symbol('dictionary-catalog-consumer')
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
      const finish = (value: T) => {
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
          removeOwnership()
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

  function removeSingleOwnership(entry: SingleInFlightEntry): void {
    if (singleInFlight.get(entry.key) === entry) {
      singleInFlight.delete(entry.key)
    }
  }

  function createSingleInFlight(
    code: string,
    key: string,
    capturedIdentity: CapturedIdentity,
  ): SingleInFlightEntry {
    const controller = new AbortController()
    const capturedCodeGeneration = codeGeneration(code)
    const entry: SingleInFlightEntry = {
      code,
      controller,
      consumers: new Set(),
      key,
      promise: Promise.resolve(null),
      settled: false,
    }

    const work = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) {
          throw createAbortError()
        }
        return input.loader.get({ code, signal: controller.signal })
      })
      .then(
        rawValue => cloneDictionaryCatalogResponse(rawValue, code),
        (error) => {
          if (isStableDictionaryTypeNotFound(error)) {
            return null
          }
          throw error
        },
      )
      .then((value) => {
        if (
          !completionHasCurrentIdentity(capturedIdentity, controller)
          || capturedCodeGeneration !== codeGeneration(code)
        ) {
          throw createAbortError()
        }
        writeCache(key, code, value)
        return value
      })

    const aborted = new Promise<never>((_resolve, reject) => {
      const rejectAsAborted = () => reject(createAbortError())
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
        removeSingleOwnership(entry)
      })
    return entry
  }

  function removeBatchOwnership(entry: BatchInFlightEntry): void {
    batchInFlightEntries.delete(entry)
    entry.keys.forEach((key) => {
      if (batchInFlightByCode.get(key) === entry) {
        batchInFlightByCode.delete(key)
      }
    })
  }

  function consumeBatchForCode(
    entry: BatchInFlightEntry,
    code: string,
    signal: AbortSignal,
  ): Promise<void> {
    const controller = new AbortController()
    const controllers = batchGetControllersByCode.get(code) ?? new Set()
    controllers.add(controller)
    batchGetControllersByCode.set(code, controllers)

    const abortConsumer = () => controller.abort()
    signal.addEventListener('abort', abortConsumer, { once: true })
    if (signal.aborted) {
      abortConsumer()
    }

    return consumeInFlight(
      entry,
      controller.signal,
      () => removeBatchOwnership(entry),
    ).finally(() => {
      signal.removeEventListener('abort', abortConsumer)
      controllers.delete(controller)
      if (controllers.size === 0) {
        batchGetControllersByCode.delete(code)
      }
    })
  }

  function createBatchInFlight(
    codes: readonly string[],
    capturedIdentity: CapturedIdentity,
  ): BatchInFlightEntry {
    const controller = new AbortController()
    const keys = Object.freeze(codes.map(code =>
      createCacheKey(capturedIdentity.identity, code)))
    const capturedCodeGenerations = new Map(
      codes.map(code => [code, codeGeneration(code)] as const),
    )
    const entry: BatchInFlightEntry = {
      codes,
      controller,
      consumers: new Set(),
      keys,
      promise: Promise.resolve(),
      settled: false,
    }

    const work = Promise.resolve()
      .then(() => {
        if (controller.signal.aborted) {
          throw createAbortError()
        }
        return input.loader.batch({
          codes,
          signal: controller.signal,
        })
      })
      .then(rawValue => cloneDictionaryCatalogBatchResponse(rawValue, codes))
      .then((batch) => {
        if (!completionHasCurrentIdentity(capturedIdentity, controller)) {
          throw createAbortError()
        }

        const values = new Map<string, DictionaryCatalog | null>(
          batch.dictionaries.map(catalog => [catalog.code, catalog]),
        )
        batch.missingCodes.forEach(code => values.set(code, null))
        codes.forEach((code, index) => {
          /*
           * 精确失效不终止共享 batch；只跳过 generation 已变化的 code，其他
           * 分区仍可安全进入自己的身份缓存。
           */
          if (capturedCodeGenerations.get(code) === codeGeneration(code)) {
            writeCache(keys[index]!, code, values.get(code) ?? null)
          }
        })
      })

    const aborted = new Promise<never>((_resolve, reject) => {
      const rejectAsAborted = () => reject(createAbortError())
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
        removeBatchOwnership(entry)
      })
    return entry
  }

  function get(inputValue: {
    readonly code: string
    readonly signal: AbortSignal
  }): Promise<DictionaryCatalog | null> {
    if (inputValue.signal.aborted) {
      return Promise.reject(createAbortError())
    }

    let code: string
    let capturedIdentity: CapturedIdentity
    try {
      code = normalizeDictionaryCatalogCode(inputValue.code)
      capturedIdentity = synchronizeIdentity()
    }
    catch (error) {
      return Promise.reject(error)
    }
    const key = createCacheKey(capturedIdentity.identity, code)
    const cached = readCache(key)
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }

    const batchEntry = batchInFlightByCode.get(key)
    if (batchEntry !== undefined) {
      return consumeBatchForCode(
        batchEntry,
        code,
        inputValue.signal,
      ).then(() => get(inputValue))
    }

    let entry = singleInFlight.get(key)
    if (entry === undefined) {
      entry = createSingleInFlight(code, key, capturedIdentity)
      singleInFlight.set(key, entry)
    }
    return consumeInFlight(
      entry,
      inputValue.signal,
      () => removeSingleOwnership(entry),
    )
  }

  function prefetch(inputValue: {
    readonly codes: readonly string[]
    readonly signal: AbortSignal
  }): Promise<void> {
    if (inputValue.signal.aborted) {
      return Promise.reject(createAbortError())
    }

    let codes: readonly string[]
    let capturedIdentity: CapturedIdentity
    try {
      capturedIdentity = synchronizeIdentity()
      codes = normalizePrefetchCodes(inputValue.codes)
    }
    catch (error) {
      return Promise.reject(error)
    }
    if (codes.length === 0) {
      return Promise.resolve()
    }

    const pending = new Set<CatalogInFlightEntry>()
    const uncachedCodes: string[] = []
    for (const code of codes) {
      const key = createCacheKey(capturedIdentity.identity, code)
      if (readCache(key) !== undefined) {
        continue
      }
      const singleEntry = singleInFlight.get(key)
      if (singleEntry !== undefined) {
        pending.add(singleEntry)
        continue
      }
      const batchEntry = batchInFlightByCode.get(key)
      if (batchEntry !== undefined) {
        pending.add(batchEntry)
        continue
      }
      uncachedCodes.push(code)
    }

    if (uncachedCodes.length > 0) {
      const frozenCodes = Object.freeze([...uncachedCodes])
      const entry = createBatchInFlight(frozenCodes, capturedIdentity)
      batchInFlightEntries.add(entry)
      entry.keys.forEach(key => batchInFlightByCode.set(key, entry))
      pending.add(entry)
    }

    return Promise.all([...pending].map((entry) => {
      if ('key' in entry) {
        return consumeInFlight(
          entry,
          inputValue.signal,
          () => removeSingleOwnership(entry),
        )
      }
      return consumeInFlight(
        entry,
        inputValue.signal,
        () => removeBatchOwnership(entry),
      )
    })).then(() => undefined)
  }

  function invalidateLocal(code: string): void {
    codeGenerations.set(code, codeGeneration(code) + 1)
    for (const [key, entry] of cache) {
      if (entry.code === code) {
        cache.delete(key)
      }
    }
    for (const entry of [...singleInFlight.values()]) {
      if (entry.code === code) {
        removeSingleOwnership(entry)
        entry.controller.abort()
      }
    }
    for (const entry of batchInFlightEntries) {
      const codeIndex = entry.codes.indexOf(code)
      const key = entry.keys[codeIndex]
      if (codeIndex >= 0 && key !== undefined) {
        batchInFlightByCode.delete(key)
      }
    }
    for (const controller of batchGetControllersByCode.get(code) ?? []) {
      controller.abort()
    }
    batchGetControllersByCode.delete(code)
    notifyInvalidation({ code })
  }

  const unsubscribeIdentity = input.identitySource.subscribe((nextIdentity) => {
    if (disposed) {
      return
    }
    try {
      /*
       * 订阅事件是身份变化的即时信号，不能等待 adapter 的 snapshot 提交时序；
       * 请求入口与完成阶段仍会重读 snapshot，形成第二层迟到写回保护。
       */
      const identity = validateIdentity(nextIdentity)
      pendingIdentity = identity
      applyIdentity(identity)
    }
    catch {
      invalidateIdentitySource()
    }
  })

  try {
    channel = input.createBroadcastChannel?.(
      DICTIONARY_CATALOG_BROADCAST_CHANNEL_NAME,
    ) ?? null
  }
  catch {
    // 跨标签同步是可选增强；创建失败时仍由本地失效与 TTL 最终收敛。
    channel = null
  }

  if (channel !== null) {
    channel.onmessage = (event) => {
      const message = parseExactCatalogChangedMessage(event.data)
      if (!disposed && message !== null) {
        invalidateLocal(message.code)
      }
    }
  }

  const provider: DictionaryCatalogProvider = Object.freeze({
    get,
    prefetch,
    subscribeInvalidation: (
      listener: (event: DictionaryCatalogInvalidationEvent) => void,
    ) => {
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
    invalidate: ({ broadcast, code }) => {
      if (disposed) {
        return
      }
      const normalizedCode = normalizeDictionaryCatalogCode(code)
      invalidateLocal(normalizedCode)
      if (broadcast && channel !== null) {
        try {
          channel.postMessage({
            code: normalizedCode,
            type: DICTIONARY_CATALOG_CHANGED_MESSAGE_TYPE,
          } satisfies DictionaryCatalogChangedMessage)
        }
        catch {
          // 本标签已完成失效；广播失败不能反向破坏已经成功的管理写操作。
        }
      }
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      identityGeneration += 1
      abortAllInFlight()
      batchGetControllersByCode.clear()
      cache.clear()
      codeGenerations.clear()
      invalidationListeners.clear()
      try {
        unsubscribeIdentity()
      }
      catch {
        // 身份 adapter 的 teardown 异常不能阻断其余资源释放。
      }
      if (channel !== null) {
        channel.onmessage = null
        try {
          channel.close()
        }
        catch {
          // dispose 保持幂等，浏览器 channel teardown 异常不应冒泡。
        }
        channel = null
      }
    },
  } satisfies DictionaryCatalogProviderController)
}
