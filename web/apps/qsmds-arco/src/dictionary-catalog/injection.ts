import type { InjectionKey } from 'vue'
import type { DictionaryCatalogProvider } from './types'

/** 业务消费者只能注入中立 Provider，不接触 controller 的失效副作用。 */
export const dictionaryCatalogProviderKey
  = Symbol('DictionaryCatalogProvider') as InjectionKey<DictionaryCatalogProvider>
