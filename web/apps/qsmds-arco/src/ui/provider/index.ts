import en from '@arco-design/web-vue/es/locale/lang/en-us'
import zhCN from '@arco-design/web-vue/es/locale/lang/zh-cn'
import zhTW from '@arco-design/web-vue/es/locale/lang/zh-tw'

/*
 * Arco 只按组件导入（见各使用点），不再全局注册整套组件与全量 arco.css。
 * 这里仅保留 AConfigProvider 需要的语言包映射。
 *
 * 语言代码需与当前应用 src/locales/index.ts 导出的 localesInfo 保持一致。
 */
const locales: Record<string, any> = {
  'zh-cn': zhCN,
  'zh-tw': zhTW,
  'en': en,
}

export { locales }
