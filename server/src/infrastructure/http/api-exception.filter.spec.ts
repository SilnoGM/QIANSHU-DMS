import {
  BadRequestException,
  type ArgumentsHost,
  ServiceUnavailableException,
} from '@nestjs/common'

import { ApiException } from './api.exception'
import { ApiExceptionFilter } from './api-exception.filter'
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
    const logger = { error: jest.fn() }
    const filter = new ApiExceptionFilter(logger)
    const { host, response } = createFilterContext('/api/health')

    filter.catch(
      new ServiceUnavailableException(terminusFailureBody),
      host,
    )

    expect(response.status).toHaveBeenCalledWith(503)
    expect(response.json).toHaveBeenCalledWith(terminusFailureBody)
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('preserves an explicit ApiException safe contract', () => {
    const logger = { error: jest.fn() }
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
    expect(logger.error).not.toHaveBeenCalled()
  })

  it('sanitizes a standard HttpException response', () => {
    const logger = { error: jest.fn() }
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
    const logger = { error: jest.fn() }
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
    const logger = { error: jest.fn() }
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
  })
})
