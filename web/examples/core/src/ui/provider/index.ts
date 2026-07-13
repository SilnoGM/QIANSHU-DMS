import type { App } from 'vue'

function install(_app: App) {
  // app.use()
}

// 此处的对象属性和 src/locales/index.ts 中的 messages 对象属性一一对应
// const locales: Record<string, any> = {
//   'zh-cn': zhCN,
//   'zh-tw': zhTW,
//   'en': en,
// }

export default { install }
// export { locales }
