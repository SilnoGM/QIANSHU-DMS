import type { Observable } from 'rxjs'

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  RequestMethod,
} from '@nestjs/common'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import { throwError } from 'rxjs'
import { catchError, finalize } from 'rxjs/operators'

import { RequestPerformanceMetrics } from './request-performance-metrics'

const EXCLUDED_CONTROLLER_PATHS = new Set([
  // Docker healthcheck 每 30 秒请求一次，不能把探活流量算进业务请求量和 P95。
  'health',
  // 状态页自身轮询也不计入，避免页面刷新改变它展示的统计。
  'system/status',
  // 会话校验与通知未读轮询是页面基础设施请求，不应占据“慢请求”榜。
  'auth',
  'notifications/me/inbox',
])

const EXCLUDED_OPERATIONS = new Set([
  // 工作台头部与代理节点页摘要轮询，不是业务主查询。
  'GET /proxy-nodes/mine/expiry-summary',
  'GET /proxy-nodes/expiry-summary',
  // 当前用户资料读取，属于页面基础设施。
  'GET /profile',
])

interface ErrorStatusProvider {
  getStatus: () => unknown
}

function isErrorStatusProvider(error: unknown): error is ErrorStatusProvider {
  return typeof error === 'object'
    && error !== null
    && typeof Reflect.get(error, 'getStatus') === 'function'
}

function resolveErrorStatus(error: unknown): number {
  if (!isErrorStatusProvider(error)) {
    return 500
  }
  try {
    const status: unknown = error.getStatus()
    return typeof status === 'number'
      && Number.isInteger(status)
      && status >= 400
      && status <= 599
      ? status
      : 500
  }
  catch {
    return 500
  }
}

/**
 * 记录通过 Guard 的 HTTP 请求耗时与状态码。
 *
 * Guard 在拦截器之前执行，因此 401/403/CSRF 拒绝不会进入这里；页面把 4xx
 * 单列时，不会把未登录探测混进业务错误率。路由标签来自 Controller/Handler
 * 元数据而不是原始 URL，避免路径参数造成高基数。
 */
@Injectable()
export class RequestPerformanceInterceptor implements NestInterceptor {
  constructor(
    private readonly metrics: RequestPerformanceMetrics,
    private readonly reflector: Reflector,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    const controllerPath = this.reflector.get<string>(
      PATH_METADATA,
      context.getClass(),
    )
    const operation = this.resolveOperation(context, controllerPath)
    if (
      (controllerPath !== undefined && EXCLUDED_CONTROLLER_PATHS.has(controllerPath))
      || EXCLUDED_OPERATIONS.has(operation)
    ) {
      return next.handle()
    }

    const startedAt = process.hrtime.bigint()
    let recorded = false
    const response = context.switchToHttp().getResponse<{ statusCode?: number }>()
    const record = (statusCode: number): void => {
      if (recorded) {
        return
      }
      recorded = true
      this.metrics.record({
        at: Date.now(),
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
        operation,
        statusCode,
      })
    }

    return next.handle().pipe(
      catchError((error: unknown) => {
        record(resolveErrorStatus(error))
        return throwError(() => error)
      }),
      finalize(() => {
        record(response.statusCode ?? 200)
      }),
    )
  }

  private resolveOperation(
    context: ExecutionContext,
    controllerPath: string | undefined,
  ): string {
    const handlerPath = this.reflector.get<string | undefined>(
      PATH_METADATA,
      context.getHandler(),
    )
    const method = this.reflector.get<RequestMethod | undefined>(
      METHOD_METADATA,
      context.getHandler(),
    )
    const methodName = method === undefined ? 'ANY' : RequestMethod[method]
    const path = [controllerPath ?? 'unknown', handlerPath ?? '']
      .join('/')
      .replace(/\/+/gu, '/')
      .replace(/^\/+|\/+$/gu, '')
    return `${methodName} /${path}`
  }
}
