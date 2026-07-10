import type { App } from 'vue'
import ArcoVue from '@arco-design/web-vue'
import en from '@arco-design/web-vue/es/locale/lang/en-US'
import zhCN from '@arco-design/web-vue/es/locale/lang/zh-CN'
import zhTW from '@arco-design/web-vue/es/locale/lang/zh-TW'
import '@arco-design/web-vue/dist/arco.css'

function install(app: App) {
  app.use(ArcoVue)
}

// 语言代码需与当前应用 src/locales/index.ts 导出的 localesInfo 保持一致
const locales: Record<string, any> = {
  'zh-cn': zhCN,
  'zh-tw': zhTW,
  'en': en,
}

export default { install }
export { locales }
