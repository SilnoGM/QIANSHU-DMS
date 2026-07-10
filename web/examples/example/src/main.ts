import VWave from 'v-wave'
import VxeUI from 'vxe-pc-ui'
import VxeUITable from 'vxe-table'

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

import '@/utils/baidu'

import 'vxe-table/es/style.css'
import 'vxe-pc-ui/es/style.css'

// UnoCSS
import 'virtual:uno.css'
// 全局样式
import '@/assets/styles/globals.css'

const app = createApp(App)
app.use(VWave, {})
app.use(VxeUI).use(VxeUITable)
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
