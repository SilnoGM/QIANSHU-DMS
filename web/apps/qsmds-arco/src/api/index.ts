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
    notifyError: message => useFaToast().error('Error', {
      description: message,
    }),
  },
})

export default api
