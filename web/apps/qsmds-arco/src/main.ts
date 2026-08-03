import type {
  DictionaryCatalogIdentitySource,
} from '@/dictionary-catalog/types'

// 此副作用导入必须先于 App、Router、Pinia 与 Storage proxy 的模块求值。
import '@/auth/legacy-auth-bootstrap'

// eslint-disable-next-line perfectionist/sort-imports -- 外部依赖必须晚于上面的启动清理求值。
import VWave from 'v-wave'

import {
  installDefaultRegionSelectorProvider,
  regionSelectorProviderKey,
} from '@/components/business/QsRegionSelector/provider'
import {
  installDefaultCurrencyCatalogProvider,
} from '@/currency-catalog/default-provider'
import {
  currencyCatalogProviderKey,
} from '@/currency-catalog/injection'
import {
  installDefaultDictionaryCatalogProvider,
} from '@/dictionary-catalog/default-provider'
import {
  dictionaryCatalogProviderKey,
} from '@/dictionary-catalog/injection'
// 加载 iconify 图标
import { downloadAndInstall } from '@/iconify'
import icons from '@/iconify/index.json'
import { useAppAccountStore } from '@/store/modules/app/account'

// 自定义指令
import directive from '@/utils/directive'
// 错误日志上报
import errorLog from '@/utils/errorLog'
import App from './App.vue'

import i18n from './locales'
import router from './router'
import pinia from './store'
import uiProvider from './ui/provider'
import '@/utils/storage'

// UnoCSS
import 'virtual:uno.css'
// 全局样式
import '@/assets/styles/globals.css'

const app = createApp(App)
app.use(VWave, {})
app.use(pinia)

app.use(router)
app.use(uiProvider)
app.use(i18n)
directive(app)
errorLog(app)
if (icons.isOfflineUse) {
  for (const info of icons.collections) {
    downloadAndInstall(info)
  }
}

/*
 * 地区 API 的默认实例依赖应用级 API Client，而 Client 又通过 hook 读取 Account
 * Store。这里不能顶层静态装载地区 API，否则生产构建会扩大 API/Store/Router 的
 * 模块求值环，导致首次 `/api/auth/me` 尚未发出便同步失败。
 *
 * Provider 本身仍在 mount 前同步注入；只有用户真正读取地区数据时才动态装载 API。
 * 因此 Router 首次导航遇到网络故障时，根组件也能正常挂载并展示 unavailable 重试态。
 */
const appAccountStore = useAppAccountStore(pinia)
const regionSelectorController = installDefaultRegionSelectorProvider({
  dataSource: {
    listOptions: async (parentId, signal) => {
      const { default: regionsApi } = await import('@/api/modules/regions')
      return regionsApi.selection
        .listOptions(parentId, signal)
        .then(response => response.data)
    },
    getPath: async (cityId, signal) => {
      const { default: regionsApi } = await import('@/api/modules/regions')
      return regionsApi.selection
        .getPath(cityId, signal)
        .then(response => response.data)
    },
    search: async (query, signal) => {
      const { default: regionsApi } = await import('@/api/modules/regions')
      return regionsApi.selection
        .search(query, signal)
        .then(response => response.data)
    },
  },
  getAuthSignal: () => appAccountStore.getAuthSignal(),
  getIdentity: () => ({
    authEpoch: appAccountStore.authEpoch,
    userId: appAccountStore.authContext?.user.id ?? null,
  }),
  now: () => Date.now(),
  channelFactory: typeof BroadcastChannel === 'undefined'
    ? undefined
    : name => new BroadcastChannel(name),
})
app.provide(regionSelectorProviderKey, regionSelectorController.provider)

/*
 * 货币目录与地区目录采用同一应用生命周期和身份隔离策略。动态装载 API 可以避免
 * Client -> Account Store -> Router 与启动入口形成同步求值环；金额组件只消费注入
 * 的中立目录，不直接读取 generated DTO 或维护本地静态币种。
 */
const currencyCatalogController = installDefaultCurrencyCatalogProvider({
  loader: async (signal) => {
    const { default: currenciesApi } = await import('@/api/modules/currencies')
    return currenciesApi.catalog
      .list(signal)
      .then(response => response.data)
  },
  getAuthSignal: () => appAccountStore.getAuthSignal(),
  getIdentity: () => ({
    authEpoch: appAccountStore.authEpoch,
    userId: appAccountStore.authContext?.user.id ?? null,
  }),
  now: () => Date.now(),
  channelFactory: typeof BroadcastChannel === 'undefined'
    ? undefined
    : name => new BroadcastChannel(name),
})
app.provide(currencyCatalogProviderKey, currencyCatalogController.provider)

/*
 * 字典目录的身份真相源只暴露 authEpoch 和 userId。同步 watch 保证身份
 * 边界变化在当前调用栈内通知 Provider，不留出旧身份缓存可被重用的窗口。
 */
const dictionaryCatalogIdentitySource: DictionaryCatalogIdentitySource = {
  getSnapshot: () => ({
    authEpoch: appAccountStore.authEpoch,
    userId: appAccountStore.authContext?.user.id ?? null,
  }),
  subscribe: listener => watch(
    () => dictionaryCatalogIdentitySource.getSnapshot(),
    identity => listener(identity),
    { flush: 'sync' },
  ),
}

/*
 * 应用启动只同步安装中立 Provider，不预取任何字典。真正读取时才动态
 * 装载 API，避免 API Client -> Account Store -> Router 形成启动求值环。
 */
const dictionaryCatalogController = installDefaultDictionaryCatalogProvider({
  identitySource: dictionaryCatalogIdentitySource,
  loader: {
    get: async ({ code, signal }) => {
      const { default: dictionariesApi }
        = await import('@/api/modules/dictionaries')
      return dictionariesApi.catalog
        .get(code, signal)
        .then(response => response.data)
    },
    batch: async ({ codes: readonlyCodes, signal }) => {
      const codes = [...readonlyCodes]
      const { default: dictionariesApi }
        = await import('@/api/modules/dictionaries')
      return dictionariesApi.catalog
        .batch(codes, signal)
        .then(response => response.data)
    },
  },
  now: () => Date.now(),
  createBroadcastChannel: typeof BroadcastChannel === 'undefined'
    ? undefined
    : name => new BroadcastChannel(name),
})
app.provide(dictionaryCatalogProviderKey, dictionaryCatalogController.provider)
app.mount('#app')
