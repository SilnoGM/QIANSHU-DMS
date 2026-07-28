// 此副作用导入必须先于 App、Router、Pinia 与 Storage proxy 的模块求值。
import '@/auth/legacy-auth-bootstrap'

// eslint-disable-next-line perfectionist/sort-imports -- 外部依赖必须晚于上面的启动清理求值。
import VWave from 'v-wave'

import {
  installDefaultRegionSelectorProvider,
  regionSelectorProviderKey,
} from '@/components/business/QsRegionSelector/provider'
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
app.mount('#app')
