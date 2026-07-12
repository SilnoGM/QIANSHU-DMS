import { createApiClient } from './client'

const environment = import.meta.env

/**
 * 生产运行时只在此处装配一次 Client；factory 负责请求重试和错误归一化，
 * 这里仅桥接 Vite env、Pinia store 与用户提示能力。
 */
const api = createApiClient({
  baseURL: environment?.DEV && environment.VITE_ENABLE_PROXY
    ? '/proxy/'
    : environment?.VITE_APP_API_BASEURL ?? '/api',
  fakeBaseURL: '/fake/',
  timeout: 60_000,
  hooks: {
    getLanguage: () => useAppSettingsStore().lang,
    getToken: () => {
      const account = useAppAccountStore()
      return account.isLogin ? account.token : undefined
    },
    requestLogout: () => useAppAccountStore().requestLogout(),
    notifyError: message => useFaToast().error('Error', {
      description: message,
    }),
  },
})

export default api
