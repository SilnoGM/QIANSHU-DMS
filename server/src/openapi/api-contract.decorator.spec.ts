import {
  Controller,
  Delete,
  Get,
  Module,
  Post,
} from '@nestjs/common'
import {
  ApiProperty,
  type OpenAPIObject,
} from '@nestjs/swagger'

import { REQUEST_ID_HEADER } from '../app.constants'
import {
  ApiApplicationContract,
} from './api-contract.decorator'
import { ApiContractResponse } from './contract-response.decorator'
import { createOpenApiDocument } from './openapi-document.factory'

class DecoratorResponseDto {
  @ApiProperty()
  value!: string
}

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }
type ContractResponse = Exclude<
  NonNullable<ContractOperation['responses'][string]>,
  { $ref: string }
>

@Controller('decorator-contract')
class DecoratorContractController {
  @Get('full')
  @ApiApplicationContract({
    operationId: 'decorator_contract_full',
    badRequest: true,
    authentication: true,
    authorization: true,
    resourceLocator: true,
    conflict: true,
    validation: true,
  })
  @ApiContractResponse({ status: 200, type: DecoratorResponseDto })
  getFullContract(): DecoratorResponseDto {
    return { value: 'full' }
  }

  @Get('minimal')
  @ApiApplicationContract({
    operationId: 'decorator_contract_minimal',
  })
  @ApiContractResponse({ status: 200, type: DecoratorResponseDto })
  getMinimalContract(): DecoratorResponseDto {
    return { value: 'minimal' }
  }

  @Post('resources')
  @ApiApplicationContract({
    operationId: 'decorator_contract_create',
  })
  @ApiContractResponse({
    status: 201,
    type: DecoratorResponseDto,
    headers: {
      Location: {
        description: '新建资源地址',
        schema: { type: 'string' },
      },
    },
  })
  createResource(): DecoratorResponseDto {
    return { value: 'created' }
  }

  @Delete('resources/current')
  @ApiApplicationContract({
    operationId: 'decorator_contract_delete',
  })
  @ApiContractResponse({ status: 204 })
  deleteResource(): void {}

  @Get('document.pdf')
  @ApiApplicationContract({
    operationId: 'decorator_contract_download',
  })
  @ApiContractResponse({
    status: 200,
    content: {
      'application/pdf': {
        schema: { type: 'string', format: 'binary' },
      },
    },
  })
  downloadDocument(): void {}

  @Get('session-none')
  @ApiApplicationContract({
    operationId: 'decorator_contract_session_none',
    session: 'none',
  })
  @ApiContractResponse({ status: 200, type: DecoratorResponseDto })
  getSessionNoneContract(): DecoratorResponseDto {
    return { value: 'session-none' }
  }

  @Get('session-required')
  @ApiApplicationContract({
    operationId: 'decorator_contract_session_required',
    session: 'required',
    authorization: true,
  })
  @ApiContractResponse({ status: 200, type: DecoratorResponseDto })
  getSessionRequiredContract(): DecoratorResponseDto {
    return { value: 'session-required' }
  }

  @Post('session-optional')
  @ApiApplicationContract({
    operationId: 'decorator_contract_session_optional',
    session: 'optional',
    csrf: true,
    privateNoStore: true,
    errors: [
      { status: 503, codes: ['AUTH_CAPACITY_UNAVAILABLE'] },
      {
        status: 401,
        codes: ['INVALID_CREDENTIALS', 'AUTHENTICATION_REQUIRED'],
      },
      { status: 429, codes: ['AUTH_RATE_LIMITED', 'AUTH_RATE_LIMITED'] },
      { status: 401, codes: ['INVALID_CREDENTIALS'] },
      { status: 400, codes: ['BAD_REQUEST'] },
      { status: 403, codes: ['CSRF_REJECTED'] },
      { status: 404, codes: ['USER_NOT_FOUND'] },
      { status: 409, codes: ['ALREADY_AUTHENTICATED'] },
      { status: 422, codes: ['PASSWORD_POLICY_VIOLATION'] },
      { status: 500, codes: ['INTERNAL_ERROR'] },
    ],
  })
  @ApiContractResponse({ status: 204 })
  postSessionOptionalContract(): void {}
}

@Module({ controllers: [DecoratorContractController] })
class DecoratorContractModule {}

function requireOperation(
  document: OpenAPIObject,
  path: string,
  method: 'get' | 'post' | 'delete',
): ContractOperation {
  const operation = document.paths[path]?.[method]

  if (!operation) {
    throw new Error(`Missing test operation ${method.toUpperCase()} ${path}`)
  }

  return operation
}

function requireResponse(
  operation: ContractOperation,
  status: number,
): ContractResponse {
  const response = operation.responses[String(status)]

  if (!response || '$ref' in response) {
    throw new Error(`Missing inline test response ${status}`)
  }

  return response
}

function expectRequestIdHeader(response: ContractResponse): void {
  expect(response.headers?.[REQUEST_ID_HEADER]).toEqual({
    schema: { type: 'string' },
  })
}

describe('OpenAPI contract decorators', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(DecoratorContractModule)
  })

  it('rejects authorization metadata without authentication', () => {
    expect(() =>
      ApiApplicationContract({
        operationId: 'invalid_authorization_contract',
        authorization: true,
      }),
    ).toThrow('OpenAPI authorization requires authentication')
  })

  it('rejects authorization unless the effective Session requirement is required', () => {
    expect(() =>
      ApiApplicationContract({
        operationId: 'invalid_optional_authorization_contract',
        session: 'optional',
        authorization: true,
      }),
    ).toThrow('OpenAPI authorization requires a required Session')
    expect(() =>
      ApiApplicationContract({
        operationId: 'invalid_no_session_authorization_contract',
        session: 'none',
        authorization: true,
      }),
    ).toThrow('OpenAPI authorization requires a required Session')
  })

  it('rejects contradictory legacy authentication and explicit Session requirements', () => {
    expect(() =>
      ApiApplicationContract({
        operationId: 'invalid_legacy_required_contract',
        authentication: false,
        session: 'required',
      }),
    ).toThrow('OpenAPI authentication conflicts with Session requirement')
    expect(() =>
      ApiApplicationContract({
        operationId: 'invalid_legacy_optional_contract',
        authentication: true,
        session: 'optional',
      }),
    ).toThrow('OpenAPI authentication conflicts with Session requirement')
  })

  it('rejects unsupported error statuses and unstable error codes', () => {
    expect(() =>
      ApiApplicationContract({
        operationId: 'invalid_error_status_contract',
        errors: [
          {
            status: 418 as 400,
            codes: ['REQUEST_REJECTED'],
          },
        ],
      }),
    ).toThrow('OpenAPI contract error status is unsupported: 418')
    expect(() =>
      ApiApplicationContract({
        operationId: 'invalid_error_code_contract',
        errors: [{ status: 400, codes: ['bad-request'] }],
      }),
    ).toThrow('OpenAPI contract error code is invalid: bad-request')
    expect(() =>
      ApiApplicationContract({
        operationId: 'missing_error_code_contract',
        errors: [{ status: 400, codes: [] }],
      }),
    ).toThrow('OpenAPI contract error codes cannot be empty for status 400')
  })

  it('publishes the complete application error matrix and metadata', () => {
    const operation = requireOperation(
      document,
      '/api/decorator-contract/full',
      'get',
    )

    expect(operation.operationId).toBe('decorator_contract_full')
    expect(operation['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: true,
      authorization: true,
      resourceLocator: true,
      conflict: true,
      validation: true,
    })
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '400',
      '401',
      '403',
      '404',
      '409',
      '422',
      '500',
    ])

    for (const status of [400, 401, 403, 404, 409, 422, 500]) {
      const response = requireResponse(operation, status)
      expectRequestIdHeader(response)
      expect(response.content?.['application/json']?.schema).toEqual({
        $ref: '#/components/schemas/ApiError',
      })
    }
  })

  it('always adds 500 while keeping optional application requirements disabled', () => {
    const operation = requireOperation(
      document,
      '/api/decorator-contract/minimal',
      'get',
    )

    expect(operation.operationId).toBe('decorator_contract_minimal')
    expect(operation['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: false,
      authorization: false,
      resourceLocator: false,
      conflict: false,
      validation: false,
    })
    expect(Object.keys(operation.responses).sort()).toEqual(['200', '500'])
    expectRequestIdHeader(requireResponse(operation, 200))
    expectRequestIdHeader(requireResponse(operation, 500))
  })

  it('preserves Location and adds the request ID response header', () => {
    const operation = requireOperation(
      document,
      '/api/decorator-contract/resources',
      'post',
    )
    const response = requireResponse(operation, 201)

    expect(response.headers).toEqual({
      Location: {
        description: '新建资源地址',
        schema: { type: 'string' },
      },
      [REQUEST_ID_HEADER]: { schema: { type: 'string' } },
    })
  })

  it('keeps 204 bodyless and rejects body metadata at decorator creation', () => {
    const operation = requireOperation(
      document,
      '/api/decorator-contract/resources/current',
      'delete',
    )
    const response = requireResponse(operation, 204)

    expectRequestIdHeader(response)
    expect(response).not.toHaveProperty('content')

    expect(() =>
      ApiContractResponse({ status: 204, type: DecoratorResponseDto }),
    ).toThrow('OpenAPI 204 response cannot declare a body')
    expect(() =>
      ApiContractResponse({ status: 204, schema: { type: 'string' } }),
    ).toThrow('OpenAPI 204 response cannot declare a body')
    expect(() =>
      ApiContractResponse({
        status: 204,
        content: { 'application/json': { schema: { type: 'object' } } },
      }),
    ).toThrow('OpenAPI 204 response cannot declare a body')
  })

  it('preserves the explicit PDF binary media type and schema', () => {
    const operation = requireOperation(
      document,
      '/api/decorator-contract/document.pdf',
      'get',
    )
    const response = requireResponse(operation, 200)

    expectRequestIdHeader(response)
    expect(response.content).toEqual({
      'application/pdf': {
        schema: { type: 'string', format: 'binary' },
      },
    })
  })

  it('publishes explicit none and required Session security requirements', () => {
    const noneOperation = requireOperation(
      document,
      '/api/decorator-contract/session-none',
      'get',
    )
    const requiredOperation = requireOperation(
      document,
      '/api/decorator-contract/session-required',
      'get',
    )

    expect(noneOperation.security).toEqual([])
    expect(noneOperation['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: false,
      authorization: false,
      resourceLocator: false,
      conflict: false,
      validation: false,
      session: 'none',
    })
    expect(requiredOperation.security).toEqual([
      { sessionCookie: [] },
    ])
    expect(requiredOperation['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: true,
      authorization: true,
      resourceLocator: false,
      conflict: false,
      validation: false,
      session: 'required',
    })
  })

  it('normalizes optional Session, CSRF, no-store and stable error metadata', () => {
    const operation = requireOperation(
      document,
      '/api/decorator-contract/session-optional',
      'post',
    )

    expect(operation.security).toEqual([
      { sessionCookie: [] },
      {},
    ])
    expect(operation.parameters).toContainEqual({
      name: 'X-Qianshu-CSRF',
      in: 'header',
      required: true,
      schema: { type: 'string', enum: ['1'] },
    })
    expect(operation['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: false,
      authorization: false,
      resourceLocator: false,
      conflict: false,
      validation: false,
      session: 'optional',
      csrf: true,
      privateNoStore: true,
      errors: [
        { status: 400, codes: ['BAD_REQUEST'] },
        {
          status: 401,
          codes: ['AUTHENTICATION_REQUIRED', 'INVALID_CREDENTIALS'],
        },
        { status: 403, codes: ['CSRF_REJECTED'] },
        { status: 404, codes: ['USER_NOT_FOUND'] },
        { status: 409, codes: ['ALREADY_AUTHENTICATED'] },
        { status: 422, codes: ['PASSWORD_POLICY_VIOLATION'] },
        { status: 429, codes: ['AUTH_RATE_LIMITED'] },
        { status: 500, codes: ['INTERNAL_ERROR'] },
        { status: 503, codes: ['AUTH_CAPACITY_UNAVAILABLE'] },
      ],
    })
    expect(Object.keys(operation.responses).sort()).toEqual([
      '204',
      '400',
      '401',
      '403',
      '404',
      '409',
      '422',
      '429',
      '500',
      '503',
    ])

    for (const response of Object.values(operation.responses)) {
      expect(response).toBeDefined()
      expect(response).not.toHaveProperty('$ref')

      if (!response || '$ref' in response) {
        throw new Error('Missing inline optional Session response')
      }

      expect(response.headers?.['Cache-Control']).toEqual({
        description: '身份相关响应禁止缓存',
        schema: {
          type: 'string',
          enum: ['private, no-store'],
        },
      })
    }

    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 503]) {
      expect(requireResponse(operation, status).content?.['application/json']?.schema).toEqual({
        $ref: '#/components/schemas/ApiError',
      })
    }
  })
})
