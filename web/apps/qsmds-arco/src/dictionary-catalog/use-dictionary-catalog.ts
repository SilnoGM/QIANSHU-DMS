import type { ComputedRef, Ref } from 'vue'
import type { DictionaryCatalogValueResolution } from './options'
import type {
  DictionaryCatalog,
  DictionaryCatalogItem,
  DictionaryCatalogProvider,
} from './types'

import {
  computed,
  inject,
  onBeforeUnmount,
  readonly,
  ref,
  shallowRef,
} from 'vue'
import { dictionaryCatalogProviderKey } from './injection'
import {
  resolveDictionaryCatalogValue,
  selectEffectiveDictionaryItems,
} from './options'
import { normalizeDictionaryCatalogCode } from './validation'

const DICTIONARY_CATALOG_UNAVAILABLE_MESSAGE
  = '字典选项暂时不可用，请稍后重试'

export interface DictionaryCatalogConsumer {
  readonly catalog: Readonly<Ref<DictionaryCatalog | null>>
  readonly error: Readonly<Ref<string | null>>
  readonly loading: Readonly<Ref<boolean>>
  readonly missing: Readonly<Ref<boolean>>
  readonly resolve: (
    value: string | null | undefined,
  ) => DictionaryCatalogValueResolution | null
  readonly retry: () => Promise<void>
  readonly selectableItems: ComputedRef<readonly DictionaryCatalogItem[]>
}

function isAbortError(error: unknown): boolean {
  try {
    if (error instanceof DOMException && error.name === 'AbortError') {
      return true
    }
    if ((typeof error !== 'object' && typeof error !== 'function') || error === null) {
      return false
    }
    const candidate = error as { readonly code?: unknown, readonly name?: unknown }
    return candidate.name === 'AbortError'
      || candidate.name === 'CanceledError'
      || candidate.code === 'ERR_CANCELED'
  }
  catch {
    return false
  }
}

/**
 * 业务字段消费系统字典的应用级入口。
 *
 * Composable 只组合已安装的身份隔离 Provider，不依赖 API、Store 或持久化。
 * 目录失效后会立即清除旧快照并精确重取；加载或失败期间不再提供历史解释与
 * 新选择，防止调用方把已经失效的快照误当成当前事实。
 */
export function useDictionaryCatalog(code: string): DictionaryCatalogConsumer {
  const injectedProvider = inject(dictionaryCatalogProviderKey, null)
  if (injectedProvider === null) {
    throw new Error('DictionaryCatalogProvider is not installed')
  }
  const provider: DictionaryCatalogProvider = injectedProvider
  const normalizedCode = normalizeDictionaryCatalogCode(code)

  const catalog = shallowRef<DictionaryCatalog | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const missing = ref(false)
  let activeController: AbortController | null = null
  let requestSequence = 0
  let reloadScheduleVersion = 0
  let reloadScheduled = false
  let identityReloadScheduled = false
  let disposed = false

  const selectableItems = computed(() => {
    if (loading.value || error.value !== null || missing.value) {
      return Object.freeze([])
    }
    return selectEffectiveDictionaryItems(catalog.value)
  })

  function resolve(value: string | null | undefined) {
    return resolveDictionaryCatalogValue(catalog.value, value)
  }

  function clearCatalogForReload(): void {
    catalog.value = null
    loading.value = true
    error.value = null
    missing.value = false
  }

  async function executeReload(identityRetryBudget = 0): Promise<void> {
    if (disposed) {
      return
    }

    const sequence = ++requestSequence
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    clearCatalogForReload()
    let retryAfterIdentityTurn = false

    try {
      const nextCatalog = await provider.get({
        code: normalizedCode,
        signal: controller.signal,
      })
      if (
        !disposed
        && sequence === requestSequence
        && !controller.signal.aborted
      ) {
        catalog.value = nextCatalog
        missing.value = nextCatalog === null
      }
    }
    catch (cause) {
      if (
        !disposed
        && sequence === requestSequence
        && !controller.signal.aborted
      ) {
        if (isAbortError(cause) && identityRetryBudget > 0) {
          retryAfterIdentityTurn = true
        }
        else {
          error.value = DICTIONARY_CATALOG_UNAVAILABLE_MESSAGE
        }
      }
    }
    finally {
      if (!disposed && sequence === requestSequence) {
        if (activeController === controller) {
          activeController = null
        }
        if (!retryAfterIdentityTurn) {
          loading.value = false
        }
      }
    }

    if (retryAfterIdentityTurn) {
      // identity subscribe 可能早于 Store snapshot 提交。仅跨一个 task 再试一次，
      // 既给 snapshot 收敛窗口，也避免 Provider 持续 Abort 时形成无限重试。
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      if (!disposed && sequence === requestSequence) {
        await executeReload(identityRetryBudget - 1)
      }
    }
  }

  /** 用户显式 retry 会作废尚未执行的失效 microtask，避免同一轮重复请求。 */
  function retry(): Promise<void> {
    reloadScheduleVersion += 1
    reloadScheduled = false
    identityReloadScheduled = false
    return executeReload()
  }

  /**
   * Provider 的身份事件可能先于外部 snapshot 提交；延迟到 microtask 再读取，
   * 同时合并同一调用栈的多次精确/全量失效。
   */
  function scheduleReload(identityDomainChanged: boolean): void {
    if (disposed) {
      return
    }
    identityReloadScheduled ||= identityDomainChanged
    // 失效回调内同步撤销旧请求所有权；若仅等到 reload microtask 才 abort，
    // 已排队的旧 Promise continuation 仍可能短暂回填失效快照。
    requestSequence += 1
    activeController?.abort()
    activeController = null
    clearCatalogForReload()
    if (reloadScheduled) {
      return
    }
    reloadScheduled = true
    const scheduleVersion = ++reloadScheduleVersion
    queueMicrotask(() => {
      if (
        disposed
        || !reloadScheduled
        || scheduleVersion !== reloadScheduleVersion
      ) {
        return
      }
      reloadScheduled = false
      const identityRetryBudget = identityReloadScheduled ? 1 : 0
      identityReloadScheduled = false
      void executeReload(identityRetryBudget)
    })
  }

  const unsubscribe = provider.subscribeInvalidation((event) => {
    if (event.code === null || event.code === normalizedCode) {
      scheduleReload(event.code === null)
    }
  })

  onBeforeUnmount(() => {
    disposed = true
    reloadScheduleVersion += 1
    reloadScheduled = false
    identityReloadScheduled = false
    requestSequence += 1
    activeController?.abort()
    activeController = null
    unsubscribe()
  })

  void retry()

  return {
    catalog: readonly(catalog),
    error: readonly(error),
    loading: readonly(loading),
    missing: readonly(missing),
    resolve,
    retry,
    selectableItems,
  }
}
