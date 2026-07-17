type NodeEnvironment = 'development' | 'test' | 'production'

interface HeaderResponse {
  setHeader(name: string, value: string): unknown
}

type NextFunction = () => void

export type SecurityHeadersMiddleware = (
  request: unknown,
  response: HeaderResponse,
  next: NextFunction,
) => void

const CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; frame-ancestors 'none'"
const HSTS_VALUE = 'max-age=31536000; includeSubDomains'
const UNSUPPORTED_ENVIRONMENT_MESSAGE =
  'Unsupported security header environment'

/**
 * 为 API 响应设置固定浏览器安全 Header。
 *
 * HSTS 只允许 production 返回，避免本地 HTTP 联调被浏览器永久升级；其余 Header
 * 在所有环境保持一致，且固定值不依赖 Host、Origin 或任何请求输入。
 */
export function createSecurityHeadersMiddleware(
  nodeEnvironment: NodeEnvironment,
): SecurityHeadersMiddleware {
  if (
    nodeEnvironment !== 'development' &&
    nodeEnvironment !== 'test' &&
    nodeEnvironment !== 'production'
  ) {
    throw new Error(UNSUPPORTED_ENVIRONMENT_MESSAGE)
  }

  return (_request, response, next) => {
    response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    response.setHeader('Referrer-Policy', 'no-referrer')

    if (nodeEnvironment === 'production') {
      response.setHeader('Strict-Transport-Security', HSTS_VALUE)
    }

    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    next()
  }
}
