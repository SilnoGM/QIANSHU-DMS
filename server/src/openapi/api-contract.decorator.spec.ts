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
})
