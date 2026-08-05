import { HttpStatus, Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import {
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from '../auth/decorators/auth.decorators'
import { DictionaryCatalogController } from './dictionary-catalog.controller'
import { DictionaryQueryService } from './dictionary-query.service'

const CATALOG = {
  code: 'order.status',
  name: '订单状态',
  enabled: true,
  items: [],
}

const BATCH = {
  dictionaries: [CATALOG],
  missingCodes: ['shipping.method'],
}

function createControllerFixture() {
  const service = {
    getCatalogByCode: jest.fn().mockResolvedValue(CATALOG),
    listCatalogs: jest.fn().mockResolvedValue(BATCH),
  }

  return {
    controller: new DictionaryCatalogController(
      service as unknown as DictionaryQueryService,
    ),
    service,
  }
}

@Module({
  controllers: [DictionaryCatalogController],
  providers: [
    {
      provide: DictionaryQueryService,
      useValue: {
        getCatalogByCode: jest.fn(),
        listCatalogs: jest.fn(),
      },
    },
  ],
})
class DictionaryCatalogContractModule {}

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

const HTTP_OPERATION_METHODS = [
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
] as const

function requireGetOperation(
  document: OpenAPIObject,
  path: string,
): ContractOperation {
  const operation = document.paths[path]?.get
  if (!operation) {
    throw new Error(`Missing GET ${path}`)
  }

  return operation
}

function expectPrivateNoStoreResponses(
  operation: ContractOperation,
): void {
  for (const response of Object.values(operation.responses)) {
    if (response && !('$ref' in response)) {
      expect(response.headers).toMatchObject({
        'Cache-Control': {
          schema: {
            type: 'string',
            enum: ['private, no-store'],
          },
        },
        'X-Request-Id': {
          schema: { type: 'string' },
        },
      })
    }
  }
}

describe('DictionaryCatalogController', () => {
  it('delegates the raw single code and repeated batch codes without management filtering', async () => {
    const { controller, service } = createControllerFixture()
    const codeParams = { code: ' Order.Status ' }
    const batchQuery = {
      codes: [' Order.Status ', 'shipping.method'],
    }

    await expect(controller.getByCode(codeParams)).resolves.toBe(CATALOG)
    await expect(controller.list(batchQuery)).resolves.toBe(BATCH)

    expect(service.getCatalogByCode).toHaveBeenCalledWith(codeParams.code)
    expect(service.listCatalogs).toHaveBeenCalledWith(batchQuery.codes)
  })

  it('requires only a normal authenticated Session and no management permission', () => {
    const reflector = new Reflector()

    expect(
      reflector.get(
        REQUIRE_AUTHENTICATED_SESSION_METADATA,
        DictionaryCatalogController,
      ),
    ).toBe(true)
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        DictionaryCatalogController,
      ),
    ).toBeUndefined()

    for (const method of ['getByCode', 'list'] as const) {
      expect(
        reflector.get(
          REQUIRED_PERMISSIONS_METADATA,
          DictionaryCatalogController.prototype[method],
        ),
      ).toBeUndefined()
    }
  })
})

describe('DictionaryCatalogController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(
      DictionaryCatalogContractModule,
    )
  })

  it.each([
    {
      path: '/api/dictionary-catalog/{code}',
      operationId: 'dictionary_catalog_get_by_code',
      responseDto: 'DictionaryCatalogDto',
      statuses: ['200', '400', '401', '403', '404', '422', '500'],
      errors: [
        { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
        { status: 404, codes: ['DICTIONARY_TYPE_NOT_FOUND'] },
        { status: 422, codes: ['VALIDATION_FAILED'] },
      ],
    },
    {
      path: '/api/dictionary-catalog',
      operationId: 'dictionary_catalog_batch_list',
      responseDto: 'DictionaryCatalogBatchDto',
      statuses: ['200', '400', '401', '403', '422', '500'],
      errors: [
        { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
        { status: 422, codes: ['VALIDATION_FAILED'] },
      ],
    },
  ])(
    'publishes $operationId as a validated Session-only no-store GET',
    ({ path, operationId, responseDto, statuses, errors }) => {
      const operation = requireGetOperation(document, path)

      expect(operation.operationId).toBe(operationId)
      expect(operation.security).toEqual([{ sessionCookie: [] }])
      expect(operation['x-qianshu-contract']).toEqual({
        kind: 'application',
        authentication: true,
        authorization: false,
        resourceLocator: false,
        conflict: false,
        validation: true,
        session: 'required',
        privateNoStore: true,
        errors,
      })
      expect(Object.keys(operation.responses).sort()).toEqual(statuses)
      expect(JSON.stringify(operation.responses[HttpStatus.OK]))
        .toContain(responseDto)
      expect(operation.parameters ?? []).not.toContainEqual(
        expect.objectContaining({
          name: 'X-Qianshu-CSRF',
          in: 'header',
        }),
      )
      expectPrivateNoStoreResponses(operation)
    },
  )

  it('publishes codes as one required repeated array query parameter', () => {
    const operation = requireGetOperation(
      document,
      '/api/dictionary-catalog',
    )
    const parameter = operation.parameters?.[0]
    if (parameter === undefined || '$ref' in parameter) {
      throw new Error('Missing inline codes query parameter')
    }

    expect(operation.parameters).toHaveLength(1)
    expect(parameter).toMatchObject({
      name: 'codes',
      required: true,
      in: 'query',
      schema: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 20,
        uniqueItems: true,
      },
    })
    // OpenAPI 省略默认值时仍必须解释为 repeated `?codes=a&codes=b`。
    expect(parameter.style ?? 'form').toBe('form')
    expect(parameter.explode ?? true).toBe(true)
  })

  it('binds the single code as one required path parameter', () => {
    const operation = requireGetOperation(
      document,
      '/api/dictionary-catalog/{code}',
    )
    const parameter = operation.parameters?.find(candidate =>
      !('$ref' in candidate) && candidate.name === 'code',
    )
    if (parameter === undefined || '$ref' in parameter) {
      throw new Error('Missing inline code path parameter')
    }

    expect(parameter).toMatchObject({
      name: 'code',
      required: true,
      in: 'path',
      schema: { type: 'string' },
    })
  })

  it('publishes exactly the two GET operations and no DELETE boundary', () => {
    const operations = Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/api/dictionary-catalog'))
      .flatMap(([path, item]) => HTTP_OPERATION_METHODS
        .flatMap(method => item?.[method] === undefined
        ? []
        : [`${method.toUpperCase()} ${path}`]))
      .sort()

    expect(operations).toEqual([
      'GET /api/dictionary-catalog',
      'GET /api/dictionary-catalog/{code}',
    ])
  })
})
