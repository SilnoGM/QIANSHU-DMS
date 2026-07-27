import { HttpStatus, Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import {
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from '../auth/decorators/auth.decorators'
import { RegionQueryService } from './region-query.service'
import { RegionsController } from './regions.controller'

const REGION_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'

function createControllerFixture() {
  const service = {
    navigation: jest.fn().mockResolvedValue([]),
    list: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    }),
    getById: jest.fn().mockResolvedValue({ id: REGION_ID }),
  }

  return {
    controller: new RegionsController(
      service as unknown as RegionQueryService,
    ),
    service,
  }
}

@Module({
  controllers: [RegionsController],
  providers: [
    {
      provide: RegionQueryService,
      useValue: {
        navigation: jest.fn(),
        list: jest.fn(),
        getById: jest.fn(),
      },
    },
  ],
})
class RegionsControllerContractModule {}

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

describe('RegionsController', () => {
  it('declares navigation before the dynamic id route and delegates read queries', async () => {
    const { controller, service } = createControllerFixture()
    const query = { parentId: REGION_ID, page: 1, pageSize: 20 }

    await controller.navigation()
    await controller.list(query)
    await controller.getById({ regionId: REGION_ID })

    expect(service.navigation).toHaveBeenCalledWith()
    expect(service.list).toHaveBeenCalledWith(query)
    expect(service.getById).toHaveBeenCalledWith(REGION_ID)
    expect(
      Object.getOwnPropertyNames(RegionsController.prototype),
    ).toEqual(['constructor', 'navigation', 'list', 'getById'])
  })

  it('requires regions:read per operation without stacking the selection Session marker', () => {
    const reflector = new Reflector()

    expect(
      reflector.get(
        REQUIRE_AUTHENTICATED_SESSION_METADATA,
        RegionsController,
      ),
    ).toBeUndefined()
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        RegionsController,
      ),
    ).toBeUndefined()
    for (const method of ['navigation', 'list', 'getById'] as const) {
      expect(
        reflector.get(
          REQUIRED_PERMISSIONS_METADATA,
          RegionsController.prototype[method],
        ),
      ).toEqual(['regions:read'])
      expect(
        reflector.get(
          REQUIRE_AUTHENTICATED_SESSION_METADATA,
          RegionsController.prototype[method],
        ),
      ).toBeUndefined()
    }
  })
})

describe('RegionsController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(
      RegionsControllerContractModule,
    )
  })

  it.each([
    {
      path: '/api/regions/navigation',
      operationId: 'regions_navigation_list',
      statuses: ['200', '401', '403', '500'],
      contract: {
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator: false,
        conflict: false,
        validation: false,
        session: 'required',
        privateNoStore: true,
        errors: [
          {
            status: 403,
            codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
          },
        ],
      },
    },
    {
      path: '/api/regions',
      operationId: 'regions_list',
      statuses: ['200', '400', '401', '403', '404', '422', '500'],
      contract: {
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator: false,
        conflict: false,
        validation: true,
        session: 'required',
        privateNoStore: true,
        errors: [
          {
            status: 403,
            codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
          },
          { status: 404, codes: ['REGION_PARENT_NOT_FOUND'] },
          {
            status: 422,
            codes: ['REGION_HIERARCHY_INVALID', 'VALIDATION_FAILED'],
          },
        ],
      },
    },
    {
      path: '/api/regions/{regionId}',
      operationId: 'regions_get_by_id',
      statuses: ['200', '400', '401', '403', '404', '422', '500'],
      contract: {
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator: true,
        conflict: false,
        validation: true,
        session: 'required',
        privateNoStore: true,
        errors: [
          {
            status: 403,
            codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
          },
          { status: 404, codes: ['REGION_NOT_FOUND'] },
          { status: 422, codes: ['VALIDATION_FAILED'] },
        ],
      },
    },
  ])(
    'publishes $operationId with permission, no-store and stable errors',
    ({ path, operationId, statuses, contract }) => {
      const operation = requireGetOperation(document, path)

      expect(operation.operationId).toBe(operationId)
      expect(operation.security).toEqual([{ sessionCookie: [] }])
      expect(operation['x-qianshu-contract']).toEqual(contract)
      expect(Object.keys(operation.responses).sort()).toEqual(statuses)
      expectPrivateNoStoreResponses(operation)
    },
  )

  it('publishes management DTOs and query/path validation metadata', () => {
    const navigation = requireGetOperation(
      document,
      '/api/regions/navigation',
    )
    const list = requireGetOperation(document, '/api/regions')
    const detail = requireGetOperation(
      document,
      '/api/regions/{regionId}',
    )

    const navigationResponse = JSON.stringify(
      navigation.responses[HttpStatus.OK],
    )
    const listResponse = JSON.stringify(
      list.responses[HttpStatus.OK],
    )
    const detailResponse = JSON.stringify(
      detail.responses[HttpStatus.OK],
    )
    expect(navigationResponse).toContain('"type":"array"')
    expect(navigationResponse).toContain('RegionNavigationNodeDto')
    expect(listResponse).toContain('RegionPageDto')
    expect(detailResponse).toContain('RegionDto')

    const listParameters = JSON.stringify(list.parameters)
    for (const name of [
      'parentId',
      'query',
      'code',
      'ownStatus',
      'availability',
      'page',
      'pageSize',
      'sortBy',
      'sortOrder',
    ]) {
      expect(listParameters).toContain(`"name":"${name}"`)
    }
    expect(listParameters).toContain('"maximum":100')
    const detailParameters = JSON.stringify(detail.parameters)
    expect(detailParameters).toContain('"name":"regionId"')
    expect(detailParameters).toContain('"format":"uuid"')
  })
})
