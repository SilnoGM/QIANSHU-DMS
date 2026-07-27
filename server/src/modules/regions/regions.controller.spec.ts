import { HttpStatus, Module } from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { attachRequestAuthContext } from '../auth/auth-context'
import {
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from '../auth/decorators/auth.decorators'
import { RegionCommandService } from './region-command.service'
import { RegionQueryService } from './region-query.service'
import { RegionsController } from './regions.controller'

const REGION_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const ACTOR_ID = '40ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const SESSION_ID = '50ad40d4-7fa5-46fb-81e4-1986bcebf8f3'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR_ID,
    username: 'region_operator',
    displayName: '地区管理员',
    mustChangePassword: false,
    createdAt: new Date('2026-07-27T00:00:00.000Z'),
    lastActivityAt: new Date('2026-07-27T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-07-28T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-08-27T00:00:00.000Z'),
  })
  return request
}

function createControllerFixture() {
  const queries = {
    navigation: jest.fn().mockResolvedValue([]),
    list: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    }),
    getById: jest.fn().mockResolvedValue({ id: REGION_ID }),
  }
  const commands = {
    create: jest.fn().mockResolvedValue({ id: REGION_ID }),
    update: jest.fn().mockResolvedValue({ id: REGION_ID }),
    enable: jest.fn().mockResolvedValue({
      region: { id: REGION_ID },
      affectedCount: 1,
    }),
    disable: jest.fn().mockResolvedValue({
      region: { id: REGION_ID },
      affectedCount: 1,
    }),
  }

  return {
    controller: new RegionsController(
      queries as unknown as RegionQueryService,
      commands as unknown as RegionCommandService,
    ),
    commands,
    queries,
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
    {
      provide: RegionCommandService,
      useValue: {
        create: jest.fn(),
        update: jest.fn(),
        enable: jest.fn(),
        disable: jest.fn(),
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

function requireWriteOperation(
  document: OpenAPIObject,
  path: string,
  method: 'patch' | 'post',
): ContractOperation {
  const operation = document.paths[path]?.[method]
  if (!operation) {
    throw new Error(`Missing ${method.toUpperCase()} ${path}`)
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
    const { controller, queries } = createControllerFixture()
    const query = { parentId: REGION_ID, page: 1, pageSize: 20 }

    await controller.navigation()
    await controller.list(query)
    await controller.getById({ regionId: REGION_ID })

    expect(queries.navigation).toHaveBeenCalledWith()
    expect(queries.list).toHaveBeenCalledWith(query)
    expect(queries.getById).toHaveBeenCalledWith(REGION_ID)
    expect(
      Object.getOwnPropertyNames(RegionsController.prototype),
    ).toEqual([
      'constructor',
      'navigation',
      'list',
      'create',
      'enable',
      'disable',
      'getById',
      'update',
      'commandContext',
    ])
  })

  it('builds trusted command context and delegates all four mutations', async () => {
    const { commands, controller } = createControllerFixture()
    const request = createRequest()
    const createDto = {
      parentId: null,
      code: 'TEST',
      name: '测试地区',
      sortOrder: 10,
      enabled: true,
    }
    const updateDto = { name: '测试地区二' }

    await controller.create(createDto, request)
    await controller.update({ regionId: REGION_ID }, updateDto, request)
    await controller.enable({ regionId: REGION_ID }, {}, request)
    await controller.disable({ regionId: REGION_ID }, {}, request)

    expect(commands.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      createDto,
    )
    expect(commands.update).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      REGION_ID,
      updateDto,
    )
    expect(commands.enable).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      REGION_ID,
    )
    expect(commands.disable).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      REGION_ID,
    )
  })

  it('requires the exact per-operation permission without a class-level marker', () => {
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
    for (const [method, permission] of [
      ['create', 'regions:create'],
      ['update', 'regions:update'],
      ['enable', 'regions:enable'],
      ['disable', 'regions:disable'],
    ] as const) {
      expect(
        reflector.get(
          REQUIRED_PERMISSIONS_METADATA,
          RegionsController.prototype[method],
        ),
      ).toEqual([permission])
    }
    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        RegionsController.prototype.create,
      ),
    ).toBe(HttpStatus.CREATED)
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

  it.each([
    {
      method: 'post' as const,
      path: '/api/regions',
      operationId: 'regions_create',
      successStatus: HttpStatus.CREATED,
      responseDto: 'RegionDto',
      requestDto: 'CreateRegionRequestDto',
      statuses: ['201', '400', '401', '403', '404', '409', '422', '500'],
      contract: {
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator: false,
        conflict: true,
        validation: true,
        session: 'required',
        csrf: true,
        privateNoStore: true,
        errors: [
          {
            status: 403,
            codes: [
              'CSRF_REJECTED',
              'FORBIDDEN',
              'PASSWORD_CHANGE_REQUIRED',
            ],
          },
          { status: 404, codes: ['REGION_PARENT_NOT_FOUND'] },
          {
            status: 409,
            codes: [
              'REGION_CODE_ALREADY_EXISTS',
              'REGION_NAME_ALREADY_EXISTS',
              'REGION_STATE_CHANGED',
            ],
          },
          {
            status: 422,
            codes: ['REGION_HIERARCHY_INVALID', 'VALIDATION_FAILED'],
          },
        ],
      },
    },
    {
      method: 'patch' as const,
      path: '/api/regions/{regionId}',
      operationId: 'regions_update',
      successStatus: HttpStatus.OK,
      responseDto: 'RegionDto',
      requestDto: 'UpdateRegionRequestDto',
      statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
      contract: {
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator: true,
        conflict: true,
        validation: true,
        session: 'required',
        csrf: true,
        privateNoStore: true,
        errors: [
          {
            status: 403,
            codes: [
              'CSRF_REJECTED',
              'FORBIDDEN',
              'PASSWORD_CHANGE_REQUIRED',
            ],
          },
          { status: 404, codes: ['REGION_NOT_FOUND'] },
          {
            status: 409,
            codes: [
              'REGION_NAME_ALREADY_EXISTS',
              'REGION_STATE_CHANGED',
            ],
          },
          { status: 422, codes: ['VALIDATION_FAILED'] },
        ],
      },
    },
    ...(['enable', 'disable'] as const).map(action => ({
      method: 'post' as const,
      path: `/api/regions/{regionId}/${action}`,
      operationId: `regions_${action}`,
      successStatus: HttpStatus.OK,
      responseDto: 'RegionMutationResultDto',
      requestDto: 'EmptyRequestDto',
      statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
      contract: {
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator: true,
        conflict: true,
        validation: true,
        session: 'required',
        csrf: true,
        privateNoStore: true,
        errors: [
          {
            status: 403,
            codes: [
              'CSRF_REJECTED',
              'FORBIDDEN',
              'PASSWORD_CHANGE_REQUIRED',
            ],
          },
          { status: 404, codes: ['REGION_NOT_FOUND'] },
          { status: 409, codes: ['REGION_STATE_CHANGED'] },
          { status: 422, codes: ['VALIDATION_FAILED'] },
        ],
      },
    })),
  ])(
    'publishes $operationId with CSRF, body DTO and stable mutation errors',
    ({
      contract,
      method,
      operationId,
      path,
      requestDto,
      responseDto,
      statuses,
      successStatus,
    }) => {
      const operation = requireWriteOperation(document, path, method)

      expect(operation.operationId).toBe(operationId)
      expect(operation.security).toEqual([{ sessionCookie: [] }])
      expect(operation['x-qianshu-contract']).toEqual(contract)
      expect(operation.parameters).toContainEqual({
        name: 'X-Qianshu-CSRF',
        in: 'header',
        required: true,
        schema: { type: 'string', enum: ['1'] },
      })
      expect(JSON.stringify(operation.requestBody)).toContain(requestDto)
      expect(
        JSON.stringify(operation.responses[String(successStatus)]),
      ).toContain(responseDto)
      expect(Object.keys(operation.responses).sort()).toEqual(statuses)
      expectPrivateNoStoreResponses(operation)
    },
  )

  it('does not publish a destructive Region DELETE operation', () => {
    expect(
      document.paths['/api/regions/{regionId}']?.delete,
    ).toBeUndefined()
  })
})
