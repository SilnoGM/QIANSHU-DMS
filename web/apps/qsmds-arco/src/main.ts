// 此副作用导入必须先于 App、Router、Pinia 与 Storage proxy 的模块求值。
import '@/auth/legacy-auth-bootstrap'

// eslint-disable-next-line perfectionist/sort-imports -- 外部依赖必须晚于上面的启动清理求值。
import VWave from 'v-wave'

import regionsApi from '@/api/modules/regions'
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

// Provider 必须在 Pinia 安装后读取认证身份；组件本身不直接依赖 API 或 Store。
const appAccountStore = useAppAccountStore(pinia)
const regionSelectorController = installDefaultRegionSelectorProvider({
  dataSource: {
    listOptions: (parentId, signal) =>
      regionsApi.selection
        .listOptions(parentId, signal)
        .then(response => response.data),
    getPath: (cityId, signal) =>
      regionsApi.selection
        .getPath(cityId, signal)
        .then(response => response.data),
    search: (query, signal) =>
      regionsApi.selection
        .search(query, signal)
        .then(response => response.data),
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

app.mount('#app')
