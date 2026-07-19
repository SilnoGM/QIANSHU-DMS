const DEFAULT_API_BASE_URL = '/api/'
const DEVELOPMENT_PROXY_BASE_URL = '/proxy/'

/**
 * 把历史本地 `.env` 中的根路径 `/` 收敛到当前唯一 `/api` 契约。
 * 显式自定义地址仍保留，函数只裁剪首尾空白并补齐 Axios 所需的 trailing slash。
 */
export function resolveApiBaseUrl(
  configuredValue: string | undefined,
  useDevelopmentProxy: boolean,
): string {
  if (useDevelopmentProxy) {
    return DEVELOPMENT_PROXY_BASE_URL
  }

  const value = configuredValue?.trim()
  if (value === undefined || value === '' || value === '/') {
    return DEFAULT_API_BASE_URL
  }
  return value.endsWith('/') ? value : `${value}/`
}
