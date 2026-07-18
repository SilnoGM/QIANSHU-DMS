import 'axios'

declare module 'axios' {
  /** 千树 DMS 的请求级配置，在上游 AxiosRequestConfig 上做增量扩展。 */
  interface AxiosRequestConfig {
    authEpoch?: number
    broadcastSessionInvalid?: boolean
    retry?: boolean
    retryCount?: number
    fake?: boolean
  }

  interface InternalAxiosRequestConfig {
    broadcastSessionInvalid?: boolean
  }
}

export {}
