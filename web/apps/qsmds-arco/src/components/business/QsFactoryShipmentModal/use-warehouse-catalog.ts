import type { DictionaryCatalog, DictionaryCatalogProvider } from '../../../dictionary-catalog/types'
import { inject, onBeforeUnmount, provide } from 'vue'
import { dictionaryCatalogProviderKey } from '../../../dictionary-catalog/injection'
import { useDictionaryCatalog } from '../../../dictionary-catalog/use-dictionary-catalog'
import { normalizeDictionaryCatalogCode } from '../../../dictionary-catalog/validation'

const WAREHOUSE_CODE = 'mainland.warehouse'

/** 下拉可以独立取消等待，但不得取消其他货件与父校验共用的目录读取。 */
function waitForCatalog(pending: Promise<DictionaryCatalog | null>, signal: AbortSignal): Promise<DictionaryCatalog | null> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted', 'AbortError'))
    if (signal.aborted) {
      abort()
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    pending.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * 父校验与下拉复用同一次目录重载结果。局部 Provider 只代理仓库读取，避免
 * 下拉重试成功或缓存过期后父校验仍停留在旧快照；其他字典及失效订阅原样委托。
 */
export function useFactoryShipmentWarehouseCatalog() {
  const upstream = inject(dictionaryCatalogProviderKey, null)
  if (upstream === null) {
    throw new Error('DictionaryCatalogProvider is not installed')
  }
  // 必须先消费上层 Provider，再向后代提供代理，防止仓库读取递归调用自身。
  const catalog = useDictionaryCatalog(WAREHOUSE_CODE)
  let pending: Promise<DictionaryCatalog | null> | null = null
  let settledCatalog: DictionaryCatalog | null | undefined
  const listeners = new Set<Parameters<DictionaryCatalogProvider['subscribeInvalidation']>[0]>()
  let generation = 0
  let disposed = false
  const unsubscribe = upstream.subscribeInvalidation((event) => {
    if (event.code === null || event.code === WAREHOUSE_CODE) {
      generation += 1
      pending = null
    }
  })

  function reload(): Promise<DictionaryCatalog | null> {
    if (pending !== null) {
      return pending
    }
    const startedGeneration = generation
    const request = catalog.retry().then(() => {
      if (disposed || startedGeneration !== generation || catalog.loading.value) {
        throw new DOMException('The operation was aborted', 'AbortError')
      }
      if (catalog.error.value !== null) {
        throw new Error(catalog.error.value)
      }
      const nextCatalog = catalog.catalog.value
      if (nextCatalog !== settledCatalog) {
        settledCatalog = nextCatalog
        // 缓存刷新也更新已挂载的其他货件；同一缓存对象不再次通知，避免重载循环。
        for (const listener of listeners) {
          try {
            listener({ code: WAREHOUSE_CODE })
          }
          catch {
            // 与上层 Provider 一致，一个消费者异常不能阻断其他货件恢复。
          }
        }
      }
      return nextCatalog
    }).finally(() => {
      if (pending === request) {
        pending = null
      }
    })
    pending = request
    return request
  }

  provide(dictionaryCatalogProviderKey, {
    ...upstream,
    get: (input) => {
      if (normalizeDictionaryCatalogCode(input.code) !== WAREHOUSE_CODE) {
        return upstream.get(input)
      }
      if (input.signal.aborted) {
        return Promise.reject(new DOMException('The operation was aborted', 'AbortError'))
      }
      return waitForCatalog(reload(), input.signal)
    },
    subscribeInvalidation: (listener) => {
      listeners.add(listener)
      const unsubscribeUpstream = upstream.subscribeInvalidation(listener)
      return () => {
        listeners.delete(listener)
        unsubscribeUpstream()
      }
    },
  })
  onBeforeUnmount(() => {
    disposed = true
    generation += 1
    pending = null
    listeners.clear()
    unsubscribe()
  })
  return catalog
}
