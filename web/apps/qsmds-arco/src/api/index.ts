import { resolveApiBaseUrl } from './base-url'
import { createApiClient } from './client'

const environment = import.meta.env

/**
 * 生产运行时只在此处装配一次 Client；factory 负责请求重试和错误归一化，
 * 这里仅桥接 Vite env、Pinia store 与用户提示能力。
 */
const api = createApiClient({
  baseURL: resolveApiBaseUrl(
    environment?.VITE_APP_API_BASEURL,
    environment?.DEV === true && environment.VITE_ENABLE_PROXY === true,
  ),
  fakeBaseURL: '/fake/',
  timeout: 60_000,
  hooks: {
    getAuthEpoch: () => useAppAccountStore().authEpoch,
    getAuthSignal: () => useAppAccountStore().getAuthSignal(),
    getLanguage: () => useAppSettingsStore().lang,
    handleSessionInvalid: (requestEpoch, broadcastSessionInvalid) =>
      useAppAccountStore().handleSessionInvalid(
        requestEpoch,
        broadcastSessionInvalid,
      ),
    handleAuthRevalidationRequired: () =>
      useAppAccountStore().revalidateAuth(),
    notifyError: (message) => {
      // API 层不能静态依赖 Vue 组件：动态加载轻提示，避免 Node 测试解析 .vue 失败。
      void import('@/components/base/QsToast/useQsToast')
        .then(({ useQsToast }) => {
          useQsToast().error('Error', { description: message })
        })
        .catch(() => undefined)
    },
  },
})

export default api
