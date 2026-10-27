import {
  BadRequestException,
  type ArgumentsHost,
  ServiceUnavailableException,
} from '@nestjs/common'

import { ApiException } from './api.exception'
import { ApiExceptionFilter } from './api-exception.filter'
import type { AuthMetricLogger } from '../observability/auth-metric.logger'
import {
  getRequestId,
  requestIdMiddleware,
} from './request-id.middleware'

const SENSITIVE_CANARY = 'filter-sensitive-canary'

type HttpArgumentsHost = ReturnType<ArgumentsHost['switchToHttp']>
type RpcArgumentsHost = ReturnType<ArgumentsHost['switchToRpc']>
type WsArgumentsHost = ReturnType<ArgumentsHost['switchToWs']>

const terminusFailureBody = {
  status: 'error',
  info: {},
  error: { database: { status: 'down' } },
  details: { database: { status: 'down' } },
}

function createResponse() {
  const response = {
    setHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  }
  response.status.mockReturnValue(response)
  return response
}

function createArgumentsHost(request: object, response: object): ArgumentsHost {
  const args: unknown[] = [request, response, undefined]
  const httpHost: HttpArgumentsHost = {
    getRequest: <T = unknown>() => request as T,
    getResponse: <T = unknown>() => response as T,
    getNext: <T = unknown>() => undefined as T,
  }
  const rpcHost: RpcArgumentsHost = {
    getData: <T = unknown>() => undefined as T,
    getContext: <T = unknown>() => undefined as T,
  }
  const wsHost: WsArgumentsHost = {
    getData: <T = unknown>() => undefined as T,
    getClient: <T = unknown>() => undefined as T,
    getPattern: () => '',
  }

  // ArgumentsHost 是多传输层抽象；测试 double 保留完整接口，只在 HTTP 分支提供真实请求与响应。
  return {
    getArgs: <T extends Array<any> = any[]>() => args as T,
    getArgByIndex: <T = unknown>(index: number) => args[index] as T,
    switchToRpc: () => rpcHost,
    switchToHttp: () => httpHost,
    switchToWs: () => wsHost,
    getType: <TContext extends string = 'http'>() => 'http' as TContext,
  }
}

function createFilterContext(path = '/api/contracts') {
  const request = { method: 'GET', path }
  const response = createResponse()
  requestIdMiddleware(request, response, jest.fn())

  return {
    request,
    requestId: getRequestId(request),
    response,
    host: createArgumentsHost(request, response),
  }
}

describe('ApiExceptionFilter', () => {
  it('keeps the complete Terminus health failure body unchanged', () => {
    const logger = { error: jest.fn(), warn: jest.fn() }
    const metrics = { recordHttpError: jest.fn() }
    const filter = new ApiExceptionFilter(
      logger,
      metrics as unknown as AuthMetricLogger,
    )
    const { host, response } = createFilterContext('/api/health')

    filter.catch(
      new ServiceUnavailableException(terminusFailureBody),
      host,
    )

    expect(response.status).toHaveBeenCalledWith(503)
    expect(response.json).toHaveBeenCalledWith(terminusFailureBody)
    expect(response.setHeader).not.toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    )
    expect(logger.error).not.toHaveBeenCalled()
    expect(metrics.recordHttpError).not.toHaveBeenCalled()
  })

  it.each([401, 403, 429, 503] as const)(
    'counts non-health HTTP %s exactly once with no request data Label',
    (status) => {
      const logger = { error: jest.fn(), warn: jest.fn() }
      const metrics = { recordHttpError: jest.fn() }
      const filter = new ApiExceptionFilter(
        logger,
        metrics as unknown as AuthMetricLogger,
      )
      const { host } = createFilterContext('/api/auth/protected')

      filter.catch(
        new ApiException(status, 'FIXED_CODE', SENSITIVE_CANARY),
        host,
      )

      expect(metrics.recordHttpError).toHaveBeenCalledTimes(1)
      expect(metrics.recordHttpError).toHaveBeenCalledWith(status)
      expect(JSON.stringify(metrics.recordHttpError.mock.calls)).not.toContain(
        SENSITIVE_CANARY,
      )
    },
  )

  it('does not count statuses outside the designed HTTP metric set', () => {
    const logger = { error: jest.fn(), warn: jest.fn() }
    const metrics = { recordHttpError: jest.fn() }
    const filter = new ApiExceptionFilter(
      logger,
      metrics as unknown as AuthMetricLogger,
    )
    const { host } = createFilterContext()

    filter.catch(new ApiException(409, 'CONFLICT', '冲突'), host)

    expect(metrics.recordHttpError).not.toHaveBeenCalled()
  })

  it('preserves an explicit ApiException safe contract', () => {
    const logger = { error: jest.fn(), warn: jest.fn() }
    const filter = new ApiExceptionFilter(logger)
    const { host, requestId, response } = createFilterContext()

    filter.catch(
      new ApiException(409, 'VERSION_CONFLICT', '记录版本已变化', {
        version: ['请刷新后重试'],
      }),
      host,
    )

    expect(response.status).toHaveBeenCalledWith(409)
    expect(response.json).toHaveBeenCalledWith({
      code: 'VERSION_CONFLICT',
      message: '记录版本已变化',
      fieldErrors: { version: ['请刷新后重试'] },
      requestId,
    })
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('logs traceable business rejections with request id and route', () => {
    const logger = { error: jest.fn(), warn: jest.fn() }
    const filter = new ApiExceptionFilter(logger)
    const { host, requestId } = createFilterContext(
      '/api/purchase-orders/00000000-0000-4000-8000-000000000000/warehouse-receipts',
    )

    filter.catch(
      new ApiException(422, 'PURCHASE_WAREHOUSE_RECEIPT_TIME_FUTURE', SENSITIVE_CANARY),
      host,
    )

    expect(logger.error).not.toHaveBeenCalled()
    expect(logger.warn).toHaveBeenCalledTimes(1)
    const [line] = logger.warn.mock.calls[0] as [string]
    expect(line).toBe(
      `Business request rejected requestId=${requestId} status=422 code=PURCHASE_WAREHOUSE_RECEIPT_TIME_FUTURE method=GET path=/api/purchase-orders/00000000-0000-4000-8000-000000000000/warehouse-receipts`,
    )
    // 业务文案可能含边界值，但日志只保留 code 与路由，避免把用户输入写进日志。
    expect(line).not.toContain(SENSITIVE_CANARY)
  })

  it('keeps authentication rejections out of the business warning log', () => {
    const logger = { error: jest.fn(), warn: jest.fn() }
    const filter = new ApiExceptionFilter(logger)
    const { host } = createFilterContext('/api/auth/protected')

    filter.catch(new ApiException(401, 'AUTHENTICATION_REQUIRED', '未登录'), host)

    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('sanitizes a standard HttpException response', () => {
    const logger = { error: jest.fn(), warn: jest.fn() }
    const filter = new ApiExceptionFilter(logger)
    const { host, requestId, response } = createFilterContext()

    filter.catch(
      new BadRequestException({
        message: SENSITIVE_CANARY,
        detail: SENSITIVE_CANARY,
      }),
      host,
    )

    expect(response.status).toHaveBeenCalledWith(400)
    expect(response.json).toHaveBeenCalledWith({
      code: 'BAD_REQUEST',
      message: '请求格式错误',
      requestId,
    })
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(
      SENSITIVE_CANARY,
    )
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('sanitizes and safely logs an unknown exception', () => {
    const logger = { error: jest.fn(), warn: jest.fn() }
    const filter = new ApiExceptionFilter(logger)
    const { host, requestId, response } = createFilterContext()

    filter.catch(new Error(SENSITIVE_CANARY), host)

    expect(response.status).toHaveBeenCalledWith(500)
    expect(response.json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
      requestId,
    })
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls).toEqual([
      [`Unhandled request error requestId=${requestId}`],
    ])
    expect(JSON.stringify(response.json.mock.calls)).not.toContain(
      SENSITIVE_CANARY,
    )
  })

  it('does not exempt a health-like 503 response on another path', () => {
    const logger = { error: jest.fn(), warn: jest.fn() }
    const filter = new ApiExceptionFilter(logger)
    const { host, requestId, response } = createFilterContext(
      '/api/contracts/health-like',
    )

    filter.catch(
      new ServiceUnavailableException(terminusFailureBody),
      host,
    )

    expect(response.status).toHaveBeenCalledWith(503)
    expect(response.json).toHaveBeenCalledWith({
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
      requestId,
    })
    expect(response.json).not.toHaveBeenCalledWith(terminusFailureBody)
    expect(response.setHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store',
    )
  })
})
