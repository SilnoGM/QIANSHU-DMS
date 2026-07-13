import type { App } from 'vue'
import { createLocalesInfo } from '@fantastic-admin/locales'
import messages from '@intlify/unplugin-vue-i18n/messages'
import { createI18n } from 'vue-i18n'

const i18n = createI18n({
  legacy: false,
  flatJson: true,
  fallbackLocale: 'zh-cn',
  messages,
  missingWarn: false,
  fallbackWarn: false,
})

function install(app: App) {
  const appSettingsStore = useAppSettingsStore()
  i18n.global.locale.value = appSettingsStore.lang
  app.use(i18n)
}

const localesInfo = createLocalesInfo(messages)

// 用于路由 meta 配置，方便在 VSCode I18n Ally 插件进行显示，无实际作用
function $t(key: string) {
  return key
}

export default { install }

export {
  $t,
  i18n,
  localesInfo,
}
