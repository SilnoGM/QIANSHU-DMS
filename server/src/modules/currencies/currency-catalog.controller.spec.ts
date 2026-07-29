import { HttpStatus, Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import {
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from '../auth/decorators/auth.decorators'
import { CurrencyCatalogController } from './currency-catalog.controller'
import { CurrencyQueryService } from './currency-query.service'

function createControllerFixture() {
  const service = {
    catalog: jest.fn().mockResolvedValue([]),
  }

  return {
    controller: new CurrencyCatalogController(
      service as unknown as CurrencyQueryService,
    ),
    service,
  }
}

@Module({
  controllers: [CurrencyCatalogController],
  providers: [
    {
      provide: CurrencyQueryService,
      useValue: { catalog: jest.fn() },
    },
  ],
})
class CurrencyCatalogContractModule {}

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

function requireCatalogOperation(
  document: OpenAPIObject,
): ContractOperation {
  const operation = document.paths['/api/currency-catalog']?.get
  if (!operation) {
    throw new Error('Missing GET /api/currency-catalog')
  }
  return operation
}

describe('CurrencyCatalogController', () => {
  it('delegates the full catalog without adding management filtering', async () => {
    const { controller, service } = createControllerFixture()

    await controller.list()

    expect(service.catalog).toHaveBeenCalledWith()
  })

  it('requires only a normal authenticated Session at controller scope', () => {
    const reflector = new Reflector()

    expect(
      reflector.get(
        REQUIRE_AUTHENTICATED_SESSION_METADATA,
        CurrencyCatalogController,
      ),
    ).toBe(true)
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        CurrencyCatalogController,
      ),
    ).toBeUndefined()
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        CurrencyCatalogController.prototype.list,
      ),
    ).toBeUndefined()
  })
})

describe('CurrencyCatalogController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(
      CurrencyCatalogContractModule,
    )
  })

  it('publishes the stable Session-only operation and response DTO', () => {
    const operation = requireCatalogOperation(document)

    expect(operation.operationId).toBe('currency_catalog_list')
    expect(operation.security).toEqual([{ sessionCookie: [] }])
    expect(operation['x-qianshu-contract']).toEqual({
      kind: 'application',
      authentication: true,
      authorization: false,
      resourceLocator: false,
      conflict: false,
      validation: false,
      session: 'required',
      privateNoStore: true,
      errors: [
        {
          status: 403,
          codes: ['PASSWORD_CHANGE_REQUIRED'],
        },
      ],
    })
    expect(Object.keys(operation.responses).sort()).toEqual([
      '200',
      '401',
      '403',
      '500',
    ])
    expect(JSON.stringify(operation.responses[HttpStatus.OK]))
      .toContain('CurrencyCatalogItemDto')
  })

  it('marks every response private/no-store with request correlation', () => {
    const operation = requireCatalogOperation(document)

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
  })
})
