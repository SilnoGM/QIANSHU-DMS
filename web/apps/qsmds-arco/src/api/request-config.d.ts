import 'axios'

declare module 'axios' {
  /** 千树 DMS 的请求级配置，在上游 AxiosRequestConfig 上做增量扩展。 */
  interface AxiosRequestConfig {
    authEpoch?: number
    broadcastSessionInvalid?: boolean
    /** 页面已经提供内联错误态时，禁止 API Client 再弹重复 Toast。 */
    errorPresentation?: 'global' | 'local'
    retry?: boolean
    retryCount?: number
    fake?: boolean
  }

  interface InternalAxiosRequestConfig {
    broadcastSessionInvalid?: boolean
    errorPresentation?: 'global' | 'local'
  }
}

export {}
