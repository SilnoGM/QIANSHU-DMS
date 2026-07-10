import {
  type HttpException,
  type PipeTransform,
  ValidationPipe,
} from '@nestjs/common'
import { IsString } from 'class-validator'

import { configureApplication } from './app.setup'

class RequestDto {
  @IsString()
  name!: string
}

describe('configureApplication', () => {
  it('configures the API prefix, strict validation and shutdown hooks', async () => {
    const globalPipes: PipeTransform[] = []
    const application = {
      setGlobalPrefix: jest.fn(),
      useGlobalPipes: jest.fn((...pipes: PipeTransform[]) => {
        globalPipes.push(...pipes)
      }),
      enableShutdownHooks: jest.fn(),
    }

    configureApplication(application)

    expect(application.setGlobalPrefix).toHaveBeenCalledWith('api')
    expect(application.useGlobalPipes).toHaveBeenCalledTimes(1)
    expect(application.enableShutdownHooks).toHaveBeenCalledTimes(1)

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
