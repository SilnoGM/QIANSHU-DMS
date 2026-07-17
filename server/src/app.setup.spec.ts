import {
  type ExceptionFilter,
  type PipeTransform,
  ValidationPipe,
} from '@nestjs/common'
import { IsString } from 'class-validator'

import { API_PREFIX } from './app.constants'
import { configureApplication } from './app.setup'
import { ApiException } from './infrastructure/http/api.exception'
import { ApiExceptionFilter } from './infrastructure/http/api-exception.filter'
import { requestIdMiddleware } from './infrastructure/http/request-id.middleware'

class RequestDto {
  @IsString()
  name!: string
}

describe('configureApplication', () => {
  it('configures request ID, API prefix, validation, filter and shutdown in order', async () => {
    const globalPipes: PipeTransform[] = []
    const globalFilters: ExceptionFilter[] = []
    const use = jest.fn<void, unknown[]>()
    const application = {
      use,
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn((...pipes: PipeTransform[]) => {
        globalPipes.push(...pipes)
      }),
      useGlobalFilters: jest.fn((...filters: ExceptionFilter[]) => {
        globalFilters.push(...filters)
      }),
      enableShutdownHooks: jest.fn(),
    }

    configureApplication(application, { nodeEnvironment: 'production' })

    expect(application.use).toHaveBeenCalledWith(requestIdMiddleware)
    expect(application.use).toHaveBeenCalledTimes(2)
    const securityHeadersMiddleware = use.mock.calls[1]?.[0]
    if (typeof securityHeadersMiddleware !== 'function') {
      throw new Error('Security headers middleware was not registered')
    }
    const invokeSecurityHeaders = securityHeadersMiddleware as (
      request: unknown,
      response: { setHeader(name: string, value: string): void },
      next: () => void,
    ) => void
    const setHeader = jest.fn()
    const next = jest.fn()
    invokeSecurityHeaders({}, { setHeader }, next)
    expect(setHeader).toHaveBeenCalledWith(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    )
    expect(next).toHaveBeenCalledTimes(1)
    expect(application.setGlobalPrefix).toHaveBeenCalledWith(API_PREFIX)
    expect(application.useGlobalPipes).toHaveBeenCalledTimes(1)
    expect(application.useGlobalFilters).toHaveBeenCalledTimes(1)
    expect(globalFilters).toEqual([expect.any(ApiExceptionFilter)])
    expect(application.enableShutdownHooks).toHaveBeenCalledTimes(1)
    expect(application.use.mock.invocationCallOrder[0]).toBeLessThan(
      application.use.mock.invocationCallOrder[1] ?? Infinity,
    )
    expect(application.use.mock.invocationCallOrder[1]).toBeLessThan(
      application.setGlobalPrefix.mock.invocationCallOrder[0] ?? Infinity,
    )
    expect(
      application.setGlobalPrefix.mock.invocationCallOrder[0],
    ).toBeLessThan(application.useGlobalPipes.mock.invocationCallOrder[0])
    expect(application.useGlobalPipes.mock.invocationCallOrder[0]).toBeLessThan(
      application.useGlobalFilters.mock.invocationCallOrder[0],
    )
    expect(
      application.useGlobalFilters.mock.invocationCallOrder[0],
    ).toBeLessThan(
      application.enableShutdownHooks.mock.invocationCallOrder[0],
    )

    const validationPipe = globalPipes[0]
    expect(validationPipe).toBeInstanceOf(ValidationPipe)

    await expect(
      (validationPipe as ValidationPipe).transform(
        { name: 'allowed' },
        { type: 'body', metatype: RequestDto },
      ),
    ).resolves.toBeInstanceOf(RequestDto)
    const invalidTransform = (validationPipe as ValidationPipe).transform(
      { name: 'allowed', unknown: 'blocked' },
      { type: 'body', metatype: RequestDto },
    )
    await expect(invalidTransform).rejects.toBeInstanceOf(ApiException)
    await expect(invalidTransform).rejects.toMatchObject({
      status: 422,
      code: 'VALIDATION_FAILED',
      publicMessage: '请求参数校验失败',
      fieldErrors: { unknown: ['不允许提交该字段'] },
    })
  })
})
