import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common'

import { ApiException } from './api.exception'
import { mapExceptionToApiError } from './api-error.mapper'
import { getRequestId } from './request-id.middleware'
import {
  AuthMetricLogger,
  NOOP_AUTH_METRIC_LOGGER,
  isAuthHttpErrorStatus,
} from '../observability/auth-metric.logger'
import {
  type HealthFailureRequest,
  isTerminusHealthFailureExemption,
} from './terminus-health-failure.guard'
import {
  isExactHealthRequest,
  PRIVATE_NO_STORE_CACHE_CONTROL,
} from './private-no-store.interceptor'

interface ErrorResponse {
  setHeader(name: string, value: string): unknown
  status(status: number): ErrorResponse
  json(body: unknown): unknown
}

/**
 * 业务拒绝（冲突/规则不满足）默认不落日志，导致一线拿到 requestId 也无从反查。
 * 只记录服务端显式声明的 ApiException，且只覆盖 409/422；认证类 401/403 不进日志。
 */
const TRACEABLE_BUSINESS_ERROR_STATUSES: ReadonlySet<number> = new Set([
  HttpStatus.CONFLICT,
  HttpStatus.UNPROCESSABLE_ENTITY,
])

interface RequestLogFacts {
  readonly method: string
  readonly path: string
}

/** 只取方法与非查询串路径：查询参数可能包含关键词等业务敏感内容。 */
function readRequestLogFacts(request: object): RequestLogFacts {
  try {
    const candidate = request as { method?: unknown, path?: unknown }
    return {
      method: typeof candidate.method === 'string' ? candidate.method.slice(0, 8) : '',
      path: typeof candidate.path === 'string' ? (candidate.path.split('?')[0] ?? '').slice(0, 200) : '',
    }
  }
  catch {
    // 不可信请求对象不得让错误边界二次抛错。
    return { method: '', path: '' }
  }
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Pick<Logger, 'error' | 'warn'> = new Logger(
      ApiExceptionFilter.name,
    ),
    private readonly metrics: AuthMetricLogger = NOOP_AUTH_METRIC_LOGGER,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<HealthFailureRequest & object>()
    const response = http.getResponse<ErrorResponse>()
    const requestId = getRequestId(request)

    // APP_GUARD 早于 APP_INTERCEPTOR 执行；认证或权限 Guard 抛错时，缓存拦截器
    // 尚未进入。全局错误边界因此负责所有非 health 错误响应的同值兜底。
    if (!isExactHealthRequest(request)) {
      response.setHeader('Cache-Control', PRIVATE_NO_STORE_CACHE_CONTROL)
    }

    if (exception instanceof HttpException) {
      const originalStatus = exception.getStatus()
      const originalBody = exception.getResponse()

      // Terminus 的失败 body 是既定健康检查协议；只有完整匹配公开路由与结构时才允许绕过统一 ApiError。
      if (
        isTerminusHealthFailureExemption(
          request,
          originalStatus,
          originalBody,
        )
      ) {
        response.status(originalStatus).json(originalBody)
        return
      }
    }

    const mapped = mapExceptionToApiError(exception, requestId)

    if (isAuthHttpErrorStatus(mapped.status)) {
      // Guard 与 Controller 的异常都会汇聚到这里；Label 只保留固定 status 枚举。
      this.metrics.recordHttpError(mapped.status)
    }

    if (mapped.unexpected) {
      // 未知异常可能携带请求、数据库或堆栈敏感信息；日志只关联服务端生成的 Request ID。
      this.logger.error(`Unhandled request error requestId=${requestId}`)
    }
    else if (
      exception instanceof ApiException
      && TRACEABLE_BUSINESS_ERROR_STATUSES.has(mapped.status)
    ) {
      // ApiException 的 code 与文案由服务端显式声明为可公开内容；这里只补定位所需的路由信息，
      // 不写请求体，避免把业务参数带进日志。
      const facts = readRequestLogFacts(request)
      this.logger.warn(
        `Business request rejected requestId=${requestId} status=${mapped.status} code=${mapped.body.code} method=${facts.method} path=${facts.path}`,
      )
    }

    response.status(mapped.status).json(mapped.body)
  }
}
