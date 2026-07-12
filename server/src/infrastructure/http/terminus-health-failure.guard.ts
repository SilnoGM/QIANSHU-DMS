export interface HealthFailureRequest {
  method?: string
  path?: string
  originalUrl?: string
  url?: string
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getNormalizedPath(request: HealthFailureRequest): string | undefined {
  // Express 的 request.path 是外部完整路径且不含 query；测试适配器缺失时才回退到原始 URL。
  const path = request.path ?? request.originalUrl ?? request.url
  return path?.split('?', 1)[0]
}

function isCompleteTerminusFailureBody(body: unknown): boolean {
  if (!isNonArrayObject(body)) {
    return false
  }

  return (
    body.status === 'error' &&
    isNonArrayObject(body.info) &&
    isNonArrayObject(body.error) &&
    isNonArrayObject(body.details)
  )
}

export function isTerminusHealthFailureExemption(
  request: HealthFailureRequest,
  status: number,
  body: unknown,
): boolean {
  return (
    request.method === 'GET' &&
    getNormalizedPath(request) === '/api/health' &&
    status === 503 &&
    isCompleteTerminusFailureBody(body)
  )
}
