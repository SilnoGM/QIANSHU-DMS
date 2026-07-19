// 此副作用导入必须先于 App、Router、Pinia 与 Storage proxy 的模块求值。
import '@/auth/legacy-auth-bootstrap'

// eslint-disable-next-line perfectionist/sort-imports -- 外部依赖必须晚于上面的启动清理求值。
import VWave from 'v-wave'

// 加载 iconify 图标
import { downloadAndInstall } from '@/iconify'

import icons from '@/iconify/index.json'
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

app.mount('#app')
