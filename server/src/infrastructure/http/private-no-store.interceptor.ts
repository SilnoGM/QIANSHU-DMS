import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Observable } from 'rxjs'

export const PRIVATE_NO_STORE_CACHE_CONTROL = 'private, no-store'

/**
 * 内容按资产标识物化后不可变、URL 里含不可复用的资产标识，因此允许浏览器长期私有缓存。
 *
 * 只放宽到 `private`，**绝不使用 `public`**：这些路由仍需会话鉴权与业务权限，公共缓存会绕过鉴权。
 * 该策略只允许标注在低敏、内容不可变的商品素材路由上；资金凭证类媒体永远保持 `private, no-store`。
 * 派生变体（缩略图/封面）由不可变原件确定性生成，任何路由上都可以使用同一策略。
 */
export const IMMUTABLE_MEDIA_CACHE_CONTROL = 'private, max-age=31536000, immutable'

const IMMUTABLE_MEDIA_CACHE_METADATA = 'qianshu:immutable-media-content'

/** 显式标注「本路由返回内容不可变的低敏媒体」；其余路由一律维持默认的不可缓存策略。 */
export const ImmutableMediaContentCache = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IMMUTABLE_MEDIA_CACHE_METADATA, true)

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

/**
 * 路由元数据读取失败时回落到 `private, no-store`。
 *
 * 放宽缓存是纯性能优化：既不能因为框架上下文异常把正常请求放大成 500，
 * 也不能在读取失败时给出比默认更宽的策略。
 */
function isImmutableMediaRoute(
  context: ExecutionContext,
  reflector: Reflector,
): boolean {
  try {
    return reflector.getAllAndOverride<boolean>(
      IMMUTABLE_MEDIA_CACHE_METADATA,
      [context.getHandler(), context.getClass()],
    ) === true
  }
  catch {
    return false
  }
}

@Injectable()
export class PrivateNoStoreInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp()
    const request = http.getRequest<unknown>()

    if (!isExactHealthRequest(request)) {
      const response = http.getResponse<HeaderResponse>()

      // 必须在业务处理器运行前设置：这样成功、异常以及随后写入或清理 Cookie 的响应都带上
      // 同一份缓存策略。放宽必须由路由显式声明（而不是匹配 URL 形态），否则改名会让策略静默失效。
      response.setHeader(
        'Cache-Control',
        isImmutableMediaRoute(context, this.reflector)
          ? IMMUTABLE_MEDIA_CACHE_CONTROL
          : PRIVATE_NO_STORE_CACHE_CONTROL,
      )
    }

    return next.handle()
  }
}
