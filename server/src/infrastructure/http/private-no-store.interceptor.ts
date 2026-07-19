import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common'
import type { Observable } from 'rxjs'

export const PRIVATE_NO_STORE_CACHE_CONTROL = 'private, no-store'

const HEALTH_PATH = '/api/health'
const REQUEST_URL_KEYS = ['path', 'originalUrl', 'url'] as const

interface HeaderResponse {
  setHeader(name: string, value: string): unknown
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return (
    (typeof value === 'object' && value !== null) ||
    typeof value === 'function'
  )
}

function getNormalizedRequestPaths(request: unknown): string[] | undefined {
  if (!isObjectLike(request)) {
    return []
  }

  const paths: string[] = []

  try {
    for (const key of REQUEST_URL_KEYS) {
      const value = request[key]

      if (typeof value === 'string') {
        paths.push(value.split('?', 1)[0])
      }
    }
  } catch {
    // URL 属性可能由框架 getter 或恶意测试替身提供；读取失败时绝不能误判为健康检查。
    return undefined
  }

  return paths
}

export function isExactHealthRequest(request: unknown): boolean {
  const paths = getNormalizedRequestPaths(request)

  // 所有已提供的 URL 视图必须一致，避免用伪造的 path 掩盖真实 application URL。
  return (
    paths !== undefined &&
    paths.length > 0 &&
    paths.every((path) => path === HEALTH_PATH)
  )
}

@Injectable()
export class PrivateNoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const request = http.getRequest<unknown>()

    if (!isExactHealthRequest(request)) {
      const response = http.getResponse<HeaderResponse>()

      // 必须在业务处理器运行前设置，确保成功、异常以及随后写入或清理 Cookie 的响应都不可缓存。
      response.setHeader('Cache-Control', PRIVATE_NO_STORE_CACHE_CONTROL)
    }

    return next.handle()
  }
}
