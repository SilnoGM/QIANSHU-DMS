import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Logger,
} from '@nestjs/common'

import { mapExceptionToApiError } from './api-error.mapper'
import { getRequestId } from './request-id.middleware'
import {
  type HealthFailureRequest,
  isTerminusHealthFailureExemption,
} from './terminus-health-failure.guard'

interface ErrorResponse {
  status(status: number): ErrorResponse
  json(body: unknown): unknown
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: Pick<Logger, 'error'> = new Logger(
      ApiExceptionFilter.name,
    ),
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp()
    const request = http.getRequest<HealthFailureRequest & object>()
    const response = http.getResponse<ErrorResponse>()
    const requestId = getRequestId(request)

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

    if (mapped.unexpected) {
      // 未知异常可能携带请求、数据库或堆栈敏感信息；日志只关联服务端生成的 Request ID。
      this.logger.error(`Unhandled request error requestId=${requestId}`)
    }

    response.status(mapped.status).json(mapped.body)
  }
}
