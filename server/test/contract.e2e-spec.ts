import { type INestApplication, Logger } from '@nestjs/common'
import type {
  OpenAPIObject,
} from '@nestjs/swagger'
import {
  Test,
  type TestingModule,
} from '@nestjs/testing'
import { TerminusModule } from '@nestjs/terminus'
import type { Response } from 'supertest'
import request from 'supertest'

import { configureApplication } from '../src/app.setup'
import { DatabaseHealthIndicator } from '../src/modules/health/database-health.indicator'
import { HealthController } from '../src/modules/health/health.controller'
import { createOpenApiDocument } from '../src/openapi/openapi-document.factory'
import {
  CONTRACT_SENSITIVE_CANARY,
} from './fixtures/contract-fixture.controller'
import { ContractFixtureModule } from './fixtures/contract-fixture.module'

const REQUEST_ID_PATTERN =
  /^req_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CLIENT_REQUEST_ID = 'req_00000000-0000-4000-8000-000000000000'

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }
type ContractOpenApiResponse = Exclude<
  NonNullable<ContractOperation['responses'][string]>,
  { $ref: string }
>

function requireApplication(
  application: INestApplication | undefined,
): INestApplication {
  if (!application) {
    throw new Error('Contract E2E application is not initialized')
  }

  return application
}

function expectRequestId(response: Response): string {
  const requestId = response.headers['x-request-id']
  expect(typeof requestId).toBe('string')
  expect(requestId).toMatch(REQUEST_ID_PATTERN)
  return requestId
}

function expectApiError(
  response: Response,
  expected: {
    status: number
    code: string
    message: string
    fieldErrors?: Record<string, string[]>
  },
): void {
  const requestId = expectRequestId(response)
  expect(response.status).toBe(expected.status)
  expect(response.body).toEqual({
    code: expected.code,
    message: expected.message,
    ...(expected.fieldErrors
      ? { fieldErrors: expected.fieldErrors }
      : {}),
    requestId,
  })
}

function requireOpenApiDocument(
  document: OpenAPIObject | undefined,
): OpenAPIObject {
  if (!document) {
    throw new Error('Contract OpenAPI document is not initialized')
  }

  return document
}

function requireOpenApiOperation(
  document: OpenAPIObject,
  path: string,
  method: 'get' | 'post' | 'delete',
): ContractOperation {
  const operation = document.paths[path]?.[method]

  if (!operation) {
    throw new Error(`Missing contract operation ${method.toUpperCase()} ${path}`)
  }

  return operation
}

function requireOpenApiResponse(
  operation: ContractOperation,
  status: string,
): ContractOpenApiResponse {
  const response = operation.responses[status]

  if (!response || '$ref' in response) {
    throw new Error(`Missing inline contract response ${status}`)
  }

  return response
}

describe('health runtime contract', () => {
  it('preserves the Terminus no-cache response header', async () => {
    let moduleRef: TestingModule | undefined
    let healthApplication: INestApplication | undefined

    try {
      moduleRef = await Test.createTestingModule({
        imports: [TerminusModule.forRoot({ logger: false })],
        controllers: [HealthController],
        providers: [
          {
            provide: DatabaseHealthIndicator,
            useValue: {
              isHealthy: (key: string) =>
                Promise.resolve({ [key]: { status: 'up' as const } }),
            },
          },
        ],
      }).compile()

      healthApplication = moduleRef.createNestApplication()
      configureApplication(healthApplication)
      await healthApplication.init()

      const response = await request(
        healthApplication.getHttpServer(),
      ).get('/api/health')

      expectRequestId(response)
      expect(response.status).toBe(200)
      expect(response.body).toEqual({
        status: 'ok',
        info: { database: { status: 'up' } },
        error: {},
        details: { database: { status: 'up' } },
      })
      expect(response.headers['cache-control']).toBe(
        'no-cache, no-store, must-revalidate',
      )
    } finally {
      if (healthApplication) {
        await healthApplication.close()
      } else {
        await moduleRef?.close()
      }
    }
  })
})

describe('global HTTP response contract', () => {
  let application: INestApplication | undefined
  let openApiDocument: OpenAPIObject | undefined
  let loggerError: jest.SpyInstance

  beforeAll(async () => {
    loggerError = jest.spyOn(Logger.prototype, 'error').mockImplementation()

    try {
      const moduleRef = await Test.createTestingModule({
        imports: [ContractFixtureModule],
      }).compile()

      application = moduleRef.createNestApplication()
      configureApplication(application)
      await application.init()
      openApiDocument = await createOpenApiDocument(ContractFixtureModule)
    } catch (error) {
      await application?.close().catch(() => undefined)
      application = undefined
      openApiDocument = undefined
      loggerError.mockRestore()
      throw error
    }
  })

  afterAll(async () => {
    await application?.close()
    application = undefined
    openApiDocument = undefined
    loggerError.mockRestore()
  })

  it('returns a bare DTO without a success envelope and owns the request ID', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .get('/api/contract/dto')
      .set('X-Request-Id', CLIENT_REQUEST_ID)

    const requestId = expectRequestId(response)
    expect(requestId).not.toBe(CLIENT_REQUEST_ID)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ id: 'fixture-1', name: '测试记录' })
    expect(response.body).not.toHaveProperty('data')
  })

  it('keeps pagination metadata at the top level', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    ).get('/api/contract/pagination')

    expectRequestId(response)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      items: [{ id: 'fixture-1', name: '测试记录' }],
      page: 1,
      pageSize: 20,
      total: 1,
    })
    expect(response.body).not.toHaveProperty('data')
  })

  it('keeps 201 and Location semantics', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    ).post('/api/contract/resources')

    expectRequestId(response)
    expect(response.status).toBe(201)
    expect(response.headers.location).toBe(
      '/api/contract/resources/fixture-2',
    )
    expect(response.body).toEqual({ id: 'fixture-2', name: '新建记录' })
  })

  it('keeps 202 semantics without a success envelope', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    ).post('/api/contract/jobs')

    expectRequestId(response)
    expect(response.status).toBe(202)
    expect(response.body).toEqual({ jobId: 'job-1', status: 'accepted' })
  })

  it('keeps 204 responses bodyless', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    ).delete('/api/contract/resources/fixture-1')

    expectRequestId(response)
    expect(response.status).toBe(204)
    expect(response.text).toBe('')
  })

  it('keeps PDF responses binary with their content type', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    ).get('/api/contract/document.pdf')

    expectRequestId(response)
    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toMatch(/^application\/pdf\b/)
    expect(Buffer.isBuffer(response.body)).toBe(true)
    expect(response.body).toEqual(
      Buffer.from('%PDF-1.4\ncontract-fixture\n%%EOF\n'),
    )
  })

  it('transforms and returns a valid DTO without an envelope', async () => {
    const payload = {
      name: '订单',
      items: [{ name: '商品' }],
    }
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .post('/api/contract/echo')
      .send(payload)

    expectRequestId(response)
    expect(response.status).toBe(201)
    expect(response.body).toEqual(payload)
    expect(response.body).not.toHaveProperty('data')
  })

  it.each([
    [400, 'BAD_REQUEST', '请求格式错误'],
    [401, 'UNAUTHORIZED', '未登录或登录已失效'],
    [403, 'FORBIDDEN', '没有权限执行此操作'],
    [404, 'NOT_FOUND', '请求的资源不存在'],
    [409, 'CONFLICT', '请求与当前资源状态冲突'],
    [422, 'VALIDATION_FAILED', '请求参数校验失败'],
  ] as const)(
    'returns the explicit ApiError contract for status %i',
    async (status, code, message) => {
      const response = await request(
        requireApplication(application).getHttpServer(),
      ).get(`/api/contract/errors/${status}`)

      expectApiError(response, { status, code, message })
    },
  )

  it('sanitizes an unknown 500 response and its log entry', async () => {
    loggerError.mockClear()

    const response = await request(
      requireApplication(application).getHttpServer(),
    ).get('/api/contract/errors/500')

    const requestId = expectRequestId(response)
    expectApiError(response, {
      status: 500,
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
    })
    expect(loggerError).toHaveBeenCalledTimes(1)
    expect(loggerError.mock.calls).toEqual([
      [`Unhandled request error requestId=${requestId}`],
    ])
    expect(JSON.stringify(response.body)).not.toContain(
      CONTRACT_SENSITIVE_CANARY,
    )
  })

  it('maps malformed JSON to the safe 400 contract', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .post('/api/contract/echo')
      .set('Content-Type', 'application/json')
      .send('{"name":')

    expectApiError(response, {
      status: 400,
      code: 'BAD_REQUEST',
      message: '请求格式错误',
    })
  })

  it('rejects non-whitelisted fields with the 422 field error contract', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .post('/api/contract/echo')
      .send({
        name: '订单',
        items: [{ name: '商品' }],
        unknown: 'blocked',
      })

    expectApiError(response, {
      status: 422,
      code: 'VALIDATION_FAILED',
      message: '请求参数校验失败',
      fieldErrors: { unknown: ['不允许提交该字段'] },
    })
  })

  it('sanitizes the default whitelist message for a Chinese unknown field', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .post('/api/contract/echo')
      .send({
        name: '订单',
        items: [{ name: '商品' }],
        敏感字段: 'blocked',
      })

    expectApiError(response, {
      status: 422,
      code: 'VALIDATION_FAILED',
      message: '请求参数校验失败',
      fieldErrors: { 敏感字段: ['不允许提交该字段'] },
    })
  })

  it('safely discards a raw __proto__ field without prototype pollution', async () => {
    const prototypeProperties = Object.getOwnPropertyNames(Object.prototype)
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .post('/api/contract/echo')
      .set('Content-Type', 'application/json')
      .send(
        '{"name":"订单","items":[{"name":"商品"}],"__proto__":{"contractPrototypePolluted":true}}',
      )

    expectRequestId(response)
    expect(response.status).toBe(201)
    expect(response.body).toEqual({
      name: '订单',
      items: [{ name: '商品' }],
    })
    expect(
      Object.prototype.hasOwnProperty.call(response.body, '__proto__'),
    ).toBe(false)
    // class-transformer 会在 whitelist 校验前安全跳过此特殊键；需同时锁定响应与全局原型均未受输入影响。
    expect(Object.getPrototypeOf({})).toBe(Object.prototype)
    expect(Object.getOwnPropertyNames(Object.prototype)).toEqual(
      prototypeProperties,
    )
  })

  it('flattens nested array validation paths in the 422 field errors', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    )
      .post('/api/contract/echo')
      .send({
        name: '订单',
        items: [{ name: 123 }],
      })

    expectApiError(response, {
      status: 422,
      code: 'VALIDATION_FAILED',
      message: '请求参数校验失败',
      fieldErrors: { 'items.0.name': ['必须是字符串'] },
    })
  })

  it('does not exempt a health-like 503 outside the health route', async () => {
    const response = await request(
      requireApplication(application).getHttpServer(),
    ).get('/api/contract/health-like')

    expectApiError(response, {
      status: 503,
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
    })
    expect(response.body).not.toHaveProperty('status', 'error')
  })

  it('generates different request IDs for concurrent requests', async () => {
    const [first, second] = await Promise.all([
      request(requireApplication(application).getHttpServer()).get(
        '/api/contract/dto',
      ),
      request(requireApplication(application).getHttpServer()).get(
        '/api/contract/dto',
      ),
    ])

    const firstRequestId = expectRequestId(first)
    const secondRequestId = expectRequestId(second)
    expect(firstRequestId).not.toBe(secondRequestId)
  })

  it('publishes the exact test-only OpenAPI response matrix', () => {
    const document = requireOpenApiDocument(openApiDocument)
    const operationMatrix = [
      [
        '/api/contract/dto',
        'get',
        'contract_fixture_get_dto',
        ['200', '500'],
      ],
      [
        '/api/contract/pagination',
        'get',
        'contract_fixture_get_page',
        ['200', '500'],
      ],
      [
        '/api/contract/resources',
        'post',
        'contract_fixture_create',
        ['201', '500'],
      ],
      [
        '/api/contract/jobs',
        'post',
        'contract_fixture_accept',
        ['202', '500'],
      ],
      [
        '/api/contract/resources/fixture-1',
        'delete',
        'contract_fixture_delete',
        ['204', '500'],
      ],
      [
        '/api/contract/document.pdf',
        'get',
        'contract_fixture_download',
        ['200', '500'],
      ],
      [
        '/api/contract/echo',
        'post',
        'contract_fixture_echo',
        ['201', '400', '422', '500'],
      ],
      [
        '/api/contract/errors/{status}',
        'get',
        'contract_fixture_get_error',
        ['400', '401', '403', '404', '409', '422', '500'],
      ],
      [
        '/api/contract/health-like',
        'get',
        'contract_fixture_get_health_like_failure',
        ['500', '503'],
      ],
    ] as const

    expect(Object.keys(document.paths).sort()).toEqual(
      operationMatrix.map(([path]) => path).sort(),
    )

    const operationIds = new Set<string>()

    for (const [path, method, operationId, statuses] of operationMatrix) {
      const operation = requireOpenApiOperation(document, path, method)
      expect(operation.operationId).toBe(operationId)
      expect(operation.operationId).not.toContain(
        '__missing_operation_id__',
      )
      operationIds.add(operationId)
      expect(operation['x-qianshu-contract']).toMatchObject({
        kind: 'application',
      })
      expect(Object.keys(operation.responses).sort()).toEqual(
        [...statuses].sort(),
      )

      for (const status of statuses) {
        const response = requireOpenApiResponse(operation, status)
        expect(response.headers?.['X-Request-Id']).toEqual({
          schema: { type: 'string' },
        })

        if (Number(status) >= 400) {
          expect(response.content?.['application/json']?.schema).toEqual({
            $ref: '#/components/schemas/ApiError',
          })
        }
      }
    }

    expect(operationIds.size).toBe(operationMatrix.length)
    expect(
      requireOpenApiOperation(
        document,
        '/api/contract/errors/{status}',
        'get',
      )['x-qianshu-contract'],
    ).toEqual({
      kind: 'application',
      authentication: true,
      authorization: true,
      resourceLocator: true,
      conflict: true,
      validation: true,
    })

    const jsonSuccessSchemas = [
      ['/api/contract/dto', 'get', '200', 'ContractFixtureRecordDto'],
      [
        '/api/contract/pagination',
        'get',
        '200',
        'ContractFixturePageDto',
      ],
      [
        '/api/contract/resources',
        'post',
        '201',
        'ContractFixtureRecordDto',
      ],
      ['/api/contract/jobs', 'post', '202', 'ContractFixtureJobDto'],
      ['/api/contract/echo', 'post', '201', 'ContractFixtureDto'],
    ] as const

    for (const [path, method, status, schemaName] of jsonSuccessSchemas) {
      const operation = requireOpenApiOperation(document, path, method)
      expect(
        requireOpenApiResponse(operation, status).content?.[
          'application/json'
        ]?.schema,
      ).toEqual({ $ref: `#/components/schemas/${schemaName}` })
    }

    const created = requireOpenApiResponse(
      requireOpenApiOperation(
        document,
        '/api/contract/resources',
        'post',
      ),
      '201',
    )
    expect(created.headers?.Location).toEqual({
      description: '新建资源地址',
      schema: { type: 'string' },
    })

    const noContent = requireOpenApiResponse(
      requireOpenApiOperation(
        document,
        '/api/contract/resources/fixture-1',
        'delete',
      ),
      '204',
    )
    expect(noContent).not.toHaveProperty('content')

    const pdf = requireOpenApiResponse(
      requireOpenApiOperation(
        document,
        '/api/contract/document.pdf',
        'get',
      ),
      '200',
    )
    expect(pdf.content).toEqual({
      'application/pdf': {
        schema: { type: 'string', format: 'binary' },
      },
    })
    expect(document.components?.schemas?.ApiError).toBeDefined()
  })
})
