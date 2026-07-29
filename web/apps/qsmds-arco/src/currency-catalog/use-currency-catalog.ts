import type { CurrencyCatalogItem } from './types'
import { toCurrencyDescriptors } from './adapter'
import { currencyCatalogProviderKey } from './injection'

const CURRENCY_CATALOG_UNAVAILABLE_MESSAGE
  = '货币资料暂时不可用，请稍后重试'

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

/**
 * 金额输入与展示的应用级唯一目录入口。
 *
 * Composable 不保留第二份静态币种表；它只订阅注入的 Provider，并把同一份可信
 * catalog 映射给 MoneyInput 与 AmountDisplay。失效时自动重取，失败时保留明确
 * unavailable 状态且不泄漏服务端错误细节。
 */
export function useCurrencyCatalog() {
  const provider = inject(currencyCatalogProviderKey, null)
  if (provider === null) {
    throw new Error('CurrencyCatalogProvider is not installed')
  }

  const catalog = shallowRef<readonly CurrencyCatalogItem[]>([])
  const loading = ref(false)
  const errorMessage = ref<string | null>(null)
  let activeController: AbortController | null = null
  let requestSequence = 0

  const currencies = computed(() => toCurrencyDescriptors(catalog.value))
  const enabledCurrencies = computed(() => currencies.value.filter(
    currency => currency.enabled,
  ))

  async function reload(): Promise<void> {
    const sequence = ++requestSequence
    activeController?.abort()
    const controller = new AbortController()
    activeController = controller
    loading.value = true
    errorMessage.value = null

    try {
      const nextCatalog = await provider.list({
        signal: controller.signal,
      })
      if (sequence === requestSequence && !controller.signal.aborted) {
        catalog.value = nextCatalog
      }
    }
    catch (error) {
      if (
        sequence === requestSequence
        && !controller.signal.aborted
        && !isAbortError(error)
      ) {
        errorMessage.value = CURRENCY_CATALOG_UNAVAILABLE_MESSAGE
      }
    }
    finally {
      if (sequence === requestSequence) {
        loading.value = false
      }
    }
  }

  const unsubscribe = provider.subscribeInvalidation?.(() => {
    void reload()
  })

  onBeforeUnmount(() => {
    requestSequence += 1
    activeController?.abort()
    unsubscribe?.()
  })

  void reload()

  return {
    catalog: readonly(catalog),
    currencies,
    enabledCurrencies,
    errorMessage: readonly(errorMessage),
    loading: readonly(loading),
    reload,
  }
}
