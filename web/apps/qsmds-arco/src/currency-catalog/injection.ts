import type { InjectionKey } from 'vue'
import type { CurrencyCatalogProvider } from './types'

export const currencyCatalogProviderKey
  = Symbol('CurrencyCatalogProvider') as InjectionKey<CurrencyCatalogProvider>
