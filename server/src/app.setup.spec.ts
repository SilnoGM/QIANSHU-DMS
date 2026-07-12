import {
  type HttpException,
  type PipeTransform,
  ValidationPipe,
} from '@nestjs/common'
import { IsString } from 'class-validator'

import { API_PREFIX } from './app.constants'
import { configureApplication } from './app.setup'
import { requestIdMiddleware } from './infrastructure/http/request-id.middleware'

class RequestDto {
  @IsString()
  name!: string
}

describe('configureApplication', () => {
  it('configures request ID, API prefix, validation and shutdown in order', async () => {
    const globalPipes: PipeTransform[] = []
    const application = {
      use: jest.fn(),
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn((...pipes: PipeTransform[]) => {
        globalPipes.push(...pipes)
      }),
      enableShutdownHooks: jest.fn(),
    }

    configureApplication(application)

    expect(application.use).toHaveBeenCalledWith(requestIdMiddleware)
    expect(application.setGlobalPrefix).toHaveBeenCalledWith(API_PREFIX)
    expect(application.useGlobalPipes).toHaveBeenCalledTimes(1)
    expect(application.enableShutdownHooks).toHaveBeenCalledTimes(1)
    expect(application.use.mock.invocationCallOrder[0]).toBeLessThan(
      application.setGlobalPrefix.mock.invocationCallOrder[0],
    )
    expect(
      application.setGlobalPrefix.mock.invocationCallOrder[0],
    ).toBeLessThan(application.useGlobalPipes.mock.invocationCallOrder[0])
    expect(application.useGlobalPipes.mock.invocationCallOrder[0]).toBeLessThan(
      application.enableShutdownHooks.mock.invocationCallOrder[0],
    )

    const validationPipe = globalPipes[0]
    expect(validationPipe).toBeInstanceOf(ValidationPipe)

    const exception = (validationPipe as ValidationPipe).createExceptionFactory()(
      [],
    ) as HttpException
    expect(exception.getStatus()).toBe(422)

    await expect(
      (validationPipe as ValidationPipe).transform(
        { name: 'allowed' },
        { type: 'body', metatype: RequestDto },
      ),
    ).resolves.toBeInstanceOf(RequestDto)
    await expect(
      (validationPipe as ValidationPipe).transform(
        { name: 'allowed', unknown: 'blocked' },
        { type: 'body', metatype: RequestDto },
      ),
    ).rejects.toMatchObject({ status: 422 })
  })
})
