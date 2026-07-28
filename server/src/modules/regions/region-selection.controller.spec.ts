import { HttpStatus, Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import {
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from '../auth/decorators/auth.decorators'
import { RegionSelectionController } from './region-selection.controller'
import { RegionQueryService } from './region-query.service'

const CITY_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'

function createControllerFixture() {
  const service = {
    options: jest.fn().mockResolvedValue([]),
    search: jest.fn().mockResolvedValue({
      items: [],
      limit: 20,
      hasMore: false,
    }),
    path: jest.fn().mockResolvedValue({ cityId: CITY_ID, path: [] }),
  }

  return {
    controller: new RegionSelectionController(
      service as unknown as RegionQueryService,
    ),
    service,
  }
}

@Module({
  controllers: [RegionSelectionController],
  providers: [
    {
      provide: RegionQueryService,
      useValue: {
        options: jest.fn(),
        search: jest.fn(),
        path: jest.fn(),
      },
    },
  ],
})
class RegionSelectionContractModule {}

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

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

describe('RegionSelectionController', () => {
  it('delegates typed selection queries without adding domain behavior', async () => {
    const { controller, service } = createControllerFixture()
    const optionsQuery = { parentId: CITY_ID }
    const searchQuery = { query: '高雄', limit: 12 }

    await controller.options(optionsQuery)
    await controller.search(searchQuery)
    await controller.path({ cityId: CITY_ID })

    expect(service.options).toHaveBeenCalledWith(optionsQuery)
    expect(service.search).toHaveBeenCalledWith(searchQuery)
    expect(service.path).toHaveBeenCalledWith(CITY_ID)
  })

  it('requires only a normal authenticated Session at controller scope', () => {
    const reflector = new Reflector()

    expect(
      reflector.get(
        REQUIRE_AUTHENTICATED_SESSION_METADATA,
        RegionSelectionController,
      ),
    ).toBe(true)
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        RegionSelectionController,
      ),
    ).toBeUndefined()

    for (const method of ['options', 'search', 'path'] as const) {
      expect(
        reflector.get(
          REQUIRED_PERMISSIONS_METADATA,
          RegionSelectionController.prototype[method],
        ),
      ).toBeUndefined()
    }
  })
})

describe('RegionSelectionController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(
      RegionSelectionContractModule,
    )
  })

  it.each([
    {
      path: '/api/region-selection/options',
      operationId: 'region_selection_options_list',
      statuses: ['200', '400', '401', '403', '404', '422', '500'],
      errors: [
        { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
        { status: 404, codes: ['REGION_PARENT_NOT_FOUND'] },
        {
          status: 422,
          codes: ['REGION_HIERARCHY_INVALID', 'VALIDATION_FAILED'],
        },
      ],
    },
    {
      path: '/api/region-selection/search',
      operationId: 'region_selection_search',
      statuses: ['200', '400', '401', '403', '422', '500'],
      errors: [
        { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
        { status: 422, codes: ['VALIDATION_FAILED'] },
      ],
    },
    {
      path: '/api/region-selection/paths/{cityId}',
      operationId: 'region_selection_path_get',
      statuses: ['200', '400', '401', '403', '404', '422', '500'],
      errors: [
        { status: 403, codes: ['PASSWORD_CHANGE_REQUIRED'] },
        { status: 404, codes: ['REGION_NOT_FOUND'] },
        {
          status: 422,
          codes: ['REGION_VALUE_NOT_CITY', 'VALIDATION_FAILED'],
        },
      ],
    },
  ])(
    'publishes $operationId as Session-only, validated and no-store',
    ({ path, operationId, statuses, errors }) => {
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
      expectPrivateNoStoreResponses(operation)
    },
  )

  it('publishes the three response DTOs and UUID/query parameter boundaries', () => {
    const options = requireGetOperation(
      document,
      '/api/region-selection/options',
    )
    const search = requireGetOperation(
      document,
      '/api/region-selection/search',
    )
    const path = requireGetOperation(
      document,
      '/api/region-selection/paths/{cityId}',
    )

    const optionsResponse = JSON.stringify(
      options.responses[HttpStatus.OK],
    )
    const searchResponse = JSON.stringify(
      search.responses[HttpStatus.OK],
    )
    const pathResponse = JSON.stringify(path.responses[HttpStatus.OK])
    expect(optionsResponse).toContain('"type":"array"')
    expect(optionsResponse).toContain('RegionOptionDto')
    expect(searchResponse).toContain('RegionSearchResponseDto')
    expect(pathResponse).toContain('RegionPathDto')

    const optionsParameters = JSON.stringify(options.parameters)
    const searchParameters = JSON.stringify(search.parameters)
    const pathParameters = JSON.stringify(path.parameters)
    expect(optionsParameters).toContain(
      '"name":"parentId","required":false,"in":"query"',
    )
    expect(optionsParameters).toContain('"format":"uuid"')
    expect(searchParameters).toContain(
      '"name":"query","required":true,"in":"query"',
    )
    expect(searchParameters).toContain(
      '"name":"limit","required":false,"in":"query"',
    )
    expect(searchParameters).toContain('"default":20')
    expect(searchParameters).toContain('"minimum":1')
    expect(searchParameters).toContain('"maximum":50')
    expect(pathParameters).toContain(
      '"name":"cityId","required":true,"in":"path"',
    )
    expect(pathParameters).toContain('"format":"uuid"')
  })
})
