import {
  type ExceptionFilter,
  HttpStatus,
  type PipeTransform,
  ValidationPipe,
} from '@nestjs/common'

import { API_PREFIX } from './app.constants'
import { ApiExceptionFilter } from './infrastructure/http/api-exception.filter'
import { requestIdMiddleware } from './infrastructure/http/request-id.middleware'
import { createSecurityHeadersMiddleware } from './infrastructure/http/security-headers.middleware'
import { createValidationException } from './infrastructure/http/validation-exception.factory'

interface ApplicationSetupTarget {
  use(...handlers: unknown[]): unknown
  setGlobalPrefix(prefix: string): unknown
  useGlobalPipes(...pipes: PipeTransform[]): unknown
  useGlobalFilters(...filters: ExceptionFilter[]): unknown
  enableShutdownHooks(): unknown
}

interface ApplicationSetupOptions {
  nodeEnvironment?: 'development' | 'test' | 'production'
}

/**
 * 集中配置所有进程入口都必须遵守的 HTTP 与生命周期基线。
 *
 * Request ID 必须最先进入请求链，保证后续路由与校验失败都能共享同一追踪标识；
 * 未声明字段直接返回 422，避免多余输入悄悄进入业务层；shutdown hooks 则确保
 * Nest 能在终止信号下释放资源。
 */
export function configureApplication(
  application: ApplicationSetupTarget,
  options: ApplicationSetupOptions = {},
): void {
  application.use(requestIdMiddleware)
  application.use(
    createSecurityHeadersMiddleware(
      options.nodeEnvironment ?? 'development',
    ),
  )
  application.setGlobalPrefix(API_PREFIX)
  application.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      exceptionFactory: createValidationException,
    }),
  )
  application.useGlobalFilters(new ApiExceptionFilter())
  application.enableShutdownHooks()
}
