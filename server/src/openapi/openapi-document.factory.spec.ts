import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  Controller,
  Get,
  type INestApplication,
  Module,
  type NestApplicationOptions,
  type Type,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { SwaggerModule } from '@nestjs/swagger'
import { HealthCheckService } from '@nestjs/terminus'

import { DatabaseHealthIndicator } from '../modules/health/database-health.indicator'
import { HealthController } from '../modules/health/health.controller'
import { MISSING_OPERATION_ID_PREFIX } from './openapi.constants'
import {
  createOpenApiDocument,
  type OpenApiApplicationFactory,
} from './openapi-document.factory'

@Controller('missing-operation-id')
class MissingOperationIdController {
  @Get()
  getWithoutExplicitOperationId(): { ok: true } {
    return { ok: true }
  }
}

@Module({ controllers: [MissingOperationIdController] })
class MissingOperationIdModule {}

@Module({
  controllers: [HealthController],
  providers: [
    { provide: HealthCheckService, useValue: {} },
    { provide: DatabaseHealthIndicator, useValue: {} },
  ],
})
class HealthContractModule {}

function readExpectedPackageVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(resolve(__dirname, '../../package.json'), 'utf8'),
  ) as { version?: unknown }

  if (typeof packageJson.version !== 'string') {
    throw new Error('Test package version is missing')
  }

  return packageJson.version
}

async function createPreviewApplication(
  rootModule: Type<unknown>,
  options: NestApplicationOptions,
): Promise<INestApplication> {
  return NestFactory.create(rootModule, {
    ...options,
    logger: false,
  })
}

function observeApplicationClose(
  application: INestApplication,
): { application: INestApplication; closeSpy: jest.Mock } {
  const closeApplication = application.close.bind(application)
  const closeSpy = jest.fn(() => closeApplication())

  return {
    application: new Proxy(application, {
      get(target, property) {
        if (property === 'close') {
          return closeSpy
        }

        return Reflect.get(target, property, target) as unknown
      },
    }),
    closeSpy,
  }
}

describe('createOpenApiDocument', () => {
  it('builds the fixed baseline, includes ApiError, and emits a missing-operation sentinel', async () => {
    let closeSpy: jest.Mock | undefined
    const applicationFactory: OpenApiApplicationFactory = async (
      rootModule: Type<unknown>,
      options: NestApplicationOptions,
    ) => {
      expect(options).toEqual({
        preview: true,
        logger: false,
        abortOnError: false,
      })
      const application = await createPreviewApplication(
        rootModule,
        options,
      )
      const observed = observeApplicationClose(application)
      closeSpy = observed.closeSpy
      return observed.application
    }

    const document = await createOpenApiDocument(
      MissingOperationIdModule,
      applicationFactory,
    )

    expect(document.openapi).toBe('3.0.3')
    expect(document.info).toMatchObject({
      title: 'Qianshu DMS API',
      description: '',
      version: readExpectedPackageVersion(),
    })
    expect(document.tags).toEqual([{ name: 'health', description: '' }])
    expect(document.components?.securitySchemes).toEqual({
      sessionCookie: {
        type: 'apiKey',
        in: 'cookie',
        name: '__Host-qianshu_session',
      },
    })
    expect(
      document.paths['/api/missing-operation-id']?.get?.operationId,
    ).toBe(
      `${MISSING_OPERATION_ID_PREFIX}MissingOperationIdController_getWithoutExplicitOperationId`,
    )
    expect(document.components?.schemas?.ApiError).toEqual({
      type: 'object',
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        fieldErrors: {
          type: 'object',
          additionalProperties: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        requestId: { type: 'string' },
      },
      required: ['code', 'message', 'requestId'],
    })
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it('does not initialize, listen or expose Swagger routes while scanning metadata', async () => {
    const application = {
      setGlobalPrefix: jest.fn(),
      init: jest.fn(),
      listen: jest.fn(),
      close: jest.fn().mockResolvedValue(undefined),
    } as unknown as INestApplication
    const applicationFactory = jest
      .fn<ReturnType<OpenApiApplicationFactory>, Parameters<OpenApiApplicationFactory>>()
      .mockResolvedValue(application)
    const document = {
      openapi: '3.0.3',
      info: { title: 'Qianshu DMS API', version: '0.0.0' },
      paths: {},
    }
    const createDocumentSpy = jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockReturnValue(document)
    const setupSpy = jest.spyOn(SwaggerModule, 'setup')

    try {
      await expect(
        createOpenApiDocument(
          MissingOperationIdModule,
          applicationFactory,
        ),
      ).resolves.toBe(document)
      expect(applicationFactory).toHaveBeenCalledWith(
        MissingOperationIdModule,
        {
          preview: true,
          logger: false,
          abortOnError: false,
        },
      )
      expect(application.setGlobalPrefix).toHaveBeenCalledWith('api')
      expect(application.init).not.toHaveBeenCalled()
      expect(application.listen).not.toHaveBeenCalled()
      expect(setupSpy).not.toHaveBeenCalled()
      expect(application.close).toHaveBeenCalledTimes(1)
    } finally {
      createDocumentSpy.mockRestore()
      setupSpy.mockRestore()
    }
  })

  it('closes the preview application when document creation fails', async () => {
    let closeSpy: jest.Mock | undefined
    const applicationFactory: OpenApiApplicationFactory = async (
      rootModule: Type<unknown>,
      options: NestApplicationOptions,
    ) => {
      const application = await createPreviewApplication(
        rootModule,
        options,
      )
      const observed = observeApplicationClose(application)
      closeSpy = observed.closeSpy
      return observed.application
    }
    const createDocumentSpy = jest
      .spyOn(SwaggerModule, 'createDocument')
      .mockImplementationOnce(() => {
        throw new Error('contract document failure')
      })

    try {
      await expect(
        createOpenApiDocument(
          MissingOperationIdModule,
          applicationFactory,
        ),
      ).rejects.toThrow('contract document failure')
      expect(closeSpy).toHaveBeenCalledTimes(1)
    } finally {
      createDocumentSpy.mockRestore()
    }
  })

  it('publishes the dedicated health operation and Terminus response schemas', async () => {
    const document = await createOpenApiDocument(
      HealthContractModule,
      createPreviewApplication,
    )
    const operation = document.paths['/api/health']?.get
    const contractMetadata = operation
      ? (Reflect.get(
          operation,
          'x-qianshu-contract',
        ) as unknown)
      : undefined

    expect(operation).toBeDefined()
    expect(operation?.operationId).toBe('health_get')
    expect(operation?.tags).toEqual(['health'])
    expect(contractMetadata).toEqual({
      kind: 'health',
      authentication: false,
      authorization: false,
      resourceLocator: false,
      conflict: false,
      validation: false,
    })
    expect(Object.keys(operation?.responses ?? {}).sort()).toEqual([
      '200',
      '503',
    ])

    for (const [status, schemaName] of [
      ['200', 'HealthSuccessResponseDto'],
      ['503', 'HealthFailureResponseDto'],
    ] as const) {
      const response = operation?.responses[status]
      expect(response).toBeDefined()
      expect(response).not.toHaveProperty('$ref')

      if (!response || '$ref' in response) {
        throw new Error(`Missing inline health response ${status}`)
      }

      expect(response.headers?.['X-Request-Id']).toEqual({
        schema: { type: 'string' },
      })
      expect(response.content?.['application/json']?.schema).toEqual({
        $ref: `#/components/schemas/${schemaName}`,
      })
    }

    const indicatorMapSchema = {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: { status: { type: 'string' } },
        required: ['status'],
        additionalProperties: true,
      },
    }
    expect(document.components?.schemas?.HealthSuccessResponseDto).toEqual({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['ok'] },
        info: indicatorMapSchema,
        error: indicatorMapSchema,
        details: indicatorMapSchema,
      },
      required: ['status', 'info', 'error', 'details'],
    })
    expect(document.components?.schemas?.HealthFailureResponseDto).toEqual({
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['error'] },
        info: indicatorMapSchema,
        error: indicatorMapSchema,
        details: indicatorMapSchema,
      },
      required: ['status', 'info', 'error', 'details'],
    })
  })
})
