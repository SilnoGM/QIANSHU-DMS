import type {
  DictionaryCatalog,
  DictionaryCatalogInvalidationEvent,
  DictionaryCatalogItem,
  DictionaryCatalogProvider,
} from '@/dictionary-catalog/types'

export const DICTIONARY_SELECT_FIXTURE_CODES = Object.freeze({
  empty: 'workflow.empty',
  missing: 'workflow.missing',
  phase: 'workflow.phase',
  retry: 'workflow.retry',
  status: 'workflow.status',
})

export const DICTIONARY_SELECT_FIXTURE_VALUES = Object.freeze({
  archived: 'ARCHIVED',
  emptyHistory: 'EMPTY_HISTORY',
  phaseAlpha: 'PHASE_ALPHA',
  retryReady: 'RETRY_READY',
  running: 'RUNNING',
  runningAlternate: 'RUNNING_ALTERNATE',
  unknownHistory: 'LEGACY_UNKNOWN',
  waiting: 'WAITING',
})

export interface DictionarySelectFixtureController {
  readonly provider: DictionaryCatalogProvider
  readonly getRequestCount: (code: string) => number
  readonly hasPendingPhaseRequest: () => boolean
  readonly invalidate: (code: string | null) => void
  readonly releasePendingPhase: () => void
}

function createItem(
  input: Omit<DictionaryCatalogItem, 'sortOrder'> & { sortOrder: number },
): DictionaryCatalogItem {
  return Object.freeze({ ...input })
}

function createCatalog(
  code: string,
  name: string,
  items: readonly DictionaryCatalogItem[],
): DictionaryCatalog {
  return Object.freeze({
    code,
    enabled: true,
    items: Object.freeze([...items]),
    name,
  })
}

const STATUS_CATALOG = createCatalog(
  DICTIONARY_SELECT_FIXTURE_CODES.status,
  '工作流状态',
  [
    createItem({
      effectiveEnabled: true,
      enabled: true,
      label: '待处理',
      sortOrder: 10,
      tone: 'WARNING',
      value: DICTIONARY_SELECT_FIXTURE_VALUES.waiting,
    }),
    createItem({
      effectiveEnabled: true,
      enabled: true,
      label: '处理中',
      sortOrder: 20,
      tone: 'PRIMARY',
      value: DICTIONARY_SELECT_FIXTURE_VALUES.running,
    }),
    createItem({
      effectiveEnabled: true,
      enabled: true,
      label: '处理中',
      sortOrder: 30,
      tone: 'INFO',
      value: DICTIONARY_SELECT_FIXTURE_VALUES.runningAlternate,
    }),
    createItem({
      effectiveEnabled: false,
      enabled: false,
      label: '已归档',
      sortOrder: 40,
      tone: 'DEFAULT',
      value: DICTIONARY_SELECT_FIXTURE_VALUES.archived,
    }),
  ],
)

const EMPTY_CATALOG = createCatalog(
  DICTIONARY_SELECT_FIXTURE_CODES.empty,
  '空工作流',
  [
    createItem({
      effectiveEnabled: false,
      enabled: false,
      label: '历史空状态',
      sortOrder: 10,
      tone: 'DEFAULT',
      value: DICTIONARY_SELECT_FIXTURE_VALUES.emptyHistory,
    }),
  ],
)

const RETRY_CATALOG = createCatalog(
  DICTIONARY_SELECT_FIXTURE_CODES.retry,
  '重试状态',
  [
    createItem({
      effectiveEnabled: true,
      enabled: true,
      label: '重试后可用',
      sortOrder: 10,
      tone: 'SUCCESS',
      value: DICTIONARY_SELECT_FIXTURE_VALUES.retryReady,
    }),
  ],
)

const PHASE_CATALOG = createCatalog(
  DICTIONARY_SELECT_FIXTURE_CODES.phase,
  '工作流阶段',
  [
    createItem({
      effectiveEnabled: true,
      enabled: true,
      label: '阶段 Alpha',
      sortOrder: 10,
      tone: 'INFO',
      value: DICTIONARY_SELECT_FIXTURE_VALUES.phaseAlpha,
    }),
  ],
)

function createAbortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}

/**
 * 组件库专用确定性内存 Provider。
 *
 * 它不复用正式 API、Store、缓存或身份数据。`workflow.phase` 的首个请求由按钮
 * 显式释放，并刻意允许在 signal 已 Abort 后迟到 resolve，用来验证 Consumer 的
 * sequence/code/signal 防线，而不是把理想 Provider 行为当作唯一前提。
 */
export function createDictionarySelectFixtureController(): DictionarySelectFixtureController {
  const requestCounts = new Map<string, number>()
  const invalidationListeners = new Set<(
    event: DictionaryCatalogInvalidationEvent,
  ) => void>()
  let retryFailed = false
  let phaseReleased = false
  let pendingPhasePromise: Promise<DictionaryCatalog> | null = null
  let resolvePendingPhase: ((catalog: DictionaryCatalog) => void) | null = null

  function incrementRequestCount(code: string): number {
    const count = (requestCounts.get(code) ?? 0) + 1
    requestCounts.set(code, count)
    return count
  }

  function get(input: {
    readonly code: string
    readonly signal: AbortSignal
  }): Promise<DictionaryCatalog | null> {
    incrementRequestCount(input.code)
    if (input.signal.aborted) {
      return Promise.reject(createAbortError())
    }

    switch (input.code) {
      case DICTIONARY_SELECT_FIXTURE_CODES.status:
        return Promise.resolve(STATUS_CATALOG)
      case DICTIONARY_SELECT_FIXTURE_CODES.empty:
        return Promise.resolve(EMPTY_CATALOG)
      case DICTIONARY_SELECT_FIXTURE_CODES.missing:
        return Promise.resolve(null)
      case DICTIONARY_SELECT_FIXTURE_CODES.retry:
        if (!retryFailed) {
          retryFailed = true
          return Promise.reject(new Error('fixture retry failure'))
        }
        return Promise.resolve(RETRY_CATALOG)
      case DICTIONARY_SELECT_FIXTURE_CODES.phase:
        if (phaseReleased) {
          return Promise.resolve(PHASE_CATALOG)
        }
        if (pendingPhasePromise !== null) {
          return pendingPhasePromise
        }
        pendingPhasePromise = new Promise<DictionaryCatalog>((resolve) => {
          resolvePendingPhase = resolve
        })
        return pendingPhasePromise
      default:
        return Promise.reject(new TypeError('Unsupported dictionary fixture code'))
    }
  }

  const provider: DictionaryCatalogProvider = {
    get,
    async prefetch({ codes, signal }) {
      await Promise.all(codes.map(code => get({ code, signal })))
    },
    subscribeInvalidation(listener) {
      invalidationListeners.add(listener)
      return () => invalidationListeners.delete(listener)
    },
  }

  return {
    provider,
    getRequestCount: code => requestCounts.get(code) ?? 0,
    hasPendingPhaseRequest: () => pendingPhasePromise !== null,
    invalidate(code) {
      for (const listener of [...invalidationListeners]) {
        listener({ code })
      }
    },
    releasePendingPhase() {
      phaseReleased = true
      const resolve = resolvePendingPhase
      pendingPhasePromise = null
      resolvePendingPhase = null
      resolve?.(PHASE_CATALOG)
    },
  }
}
