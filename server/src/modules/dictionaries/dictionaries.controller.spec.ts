import { HttpStatus, Module } from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import {
  getRequestId,
  requestIdMiddleware,
} from '../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { attachRequestAuthContext } from '../auth/auth-context'
import {
  REQUIRE_AUTHENTICATED_SESSION_METADATA,
  REQUIRED_PERMISSIONS_METADATA,
} from '../auth/decorators/auth.decorators'
import { DictionaryCommandService } from './dictionary-command.service'
import { DictionaryQueryService } from './dictionary-query.service'
import { DictionariesController } from './dictionaries.controller'
import {
  UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA,
  UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA,
} from './dto/dictionary-command.dto'

const TYPE_ID = '10000000-0000-4000-8000-000000000001'
const ITEM_ID = '10000000-0000-4000-8000-000000000002'
const ACTOR_ID = '10000000-0000-4000-8000-000000000003'
const SESSION_ID = '10000000-0000-4000-8000-000000000004'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR_ID,
    username: 'dictionary_operator',
    displayName: '字典管理员',
    mustChangePassword: false,
    createdAt: new Date('2026-08-03T00:00:00.000Z'),
    lastActivityAt: new Date('2026-08-03T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-08-04T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-09-03T00:00:00.000Z'),
  })
  return request
}

function createControllerFixture() {
  const query = {
    listTypes: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    }),
    getTypeById: jest.fn().mockResolvedValue({ id: TYPE_ID }),
    listItems: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    }),
    getItemById: jest.fn().mockResolvedValue({ id: ITEM_ID }),
  }
  const command = {
    createType: jest.fn().mockResolvedValue({ id: TYPE_ID }),
    updateType: jest.fn().mockResolvedValue({ id: TYPE_ID }),
    enableType: jest.fn().mockResolvedValue({ id: TYPE_ID }),
    disableType: jest.fn().mockResolvedValue({ id: TYPE_ID }),
    createItem: jest.fn().mockResolvedValue({ id: ITEM_ID }),
    updateItem: jest.fn().mockResolvedValue({ id: ITEM_ID }),
    enableItem: jest.fn().mockResolvedValue({ id: ITEM_ID }),
    disableItem: jest.fn().mockResolvedValue({ id: ITEM_ID }),
  }

  return {
    controller: new DictionariesController(
      query as unknown as DictionaryQueryService,
      command as unknown as DictionaryCommandService,
    ),
    query,
    command,
  }
}

@Module({
  controllers: [DictionariesController],
  providers: [
    {
      provide: DictionaryQueryService,
      useValue: {
        listTypes: jest.fn(),
        getTypeById: jest.fn(),
        listItems: jest.fn(),
        getItemById: jest.fn(),
      },
    },
    {
      provide: DictionaryCommandService,
      useValue: {
        createType: jest.fn(),
        updateType: jest.fn(),
        enableType: jest.fn(),
        disableType: jest.fn(),
        createItem: jest.fn(),
        updateItem: jest.fn(),
        enableItem: jest.fn(),
        disableItem: jest.fn(),
      },
    },
  ],
})
class DictionariesControllerContractModule {}

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

type HttpMethod = 'get' | 'patch' | 'post'

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

function requireOperation(
  document: OpenAPIObject,
  path: string,
  method: HttpMethod,
): ContractOperation {
  const operation = document.paths[path]?.[method]
  if (!operation) {
    throw new Error(`Missing ${method.toUpperCase()} ${path}`)
  }
  return operation
}

function expectPrivateNoStoreResponses(operation: ContractOperation): void {
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

function requireResponseSchemaRef(
  operation: ContractOperation,
  status: string,
): string {
  const response = operation.responses[status]
  if (!response || '$ref' in response) {
    throw new Error(`Missing inline ${status} response`)
  }
  const schema = response.content?.['application/json']?.schema
  if (!schema || !('$ref' in schema) || typeof schema.$ref !== 'string') {
    throw new Error(`Missing ${status} response schema ref`)
  }
  return schema.$ref
}

function requireRequestSchema(operation: ContractOperation): object {
  const requestBody = operation.requestBody
  if (!requestBody || '$ref' in requestBody) {
    throw new Error('Missing inline request body')
  }
  const schema = requestBody.content['application/json']?.schema
  if (!schema) {
    throw new Error('Missing JSON request schema')
  }
  return schema
}

const READ_FORBIDDEN_ERRORS = [{
  status: 403,
  codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
}]
const WRITE_FORBIDDEN_ERRORS = [{
  status: 403,
  codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
}]
const TYPE_NOT_FOUND = {
  status: 404,
  codes: ['DICTIONARY_TYPE_NOT_FOUND'],
}
const ITEM_NOT_FOUND = {
  status: 404,
  codes: ['DICTIONARY_ITEM_NOT_FOUND'],
}
const VALIDATION_FAILED = {
  status: 422,
  codes: ['VALIDATION_FAILED'],
}

interface OperationContractSpec {
  readonly method: HttpMethod
  readonly path: string
  readonly operationId: string
  readonly status: string
  readonly responseRef: string
  readonly requestSchema?: object
  readonly statuses: readonly string[]
  readonly permission: readonly string[]
  readonly resourceLocator: boolean
  readonly conflict: boolean
  readonly csrf: true | undefined
  readonly errors: readonly {
    readonly status: number
    readonly codes: readonly string[]
  }[]
}

const OPERATIONS: readonly OperationContractSpec[] = [
  {
    method: 'get',
    path: '/api/dictionary-types',
    operationId: 'dictionary_types_list',
    status: '200',
    responseRef: '#/components/schemas/DictionaryTypePageDto',
    statuses: ['200', '400', '401', '403', '422', '500'],
    permission: ['dictionaries:read'],
    resourceLocator: false,
    conflict: false,
    csrf: undefined,
    errors: [...READ_FORBIDDEN_ERRORS, VALIDATION_FAILED],
  },
  {
    method: 'post',
    path: '/api/dictionary-types',
    operationId: 'dictionary_types_create',
    status: '201',
    responseRef: '#/components/schemas/DictionaryTypeDto',
    requestSchema: {
      $ref: '#/components/schemas/CreateDictionaryTypeRequestDto',
    },
    statuses: ['201', '400', '401', '403', '409', '422', '500'],
    permission: ['dictionaries:create'],
    resourceLocator: false,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      {
        status: 409,
        codes: [
          'DICTIONARY_TYPE_CODE_ALREADY_EXISTS',
          'DICTIONARY_TYPE_STATE_CHANGED',
        ],
      },
      VALIDATION_FAILED,
    ],
  },
  {
    method: 'get',
    path: '/api/dictionary-types/{typeId}',
    operationId: 'dictionary_types_get_by_id',
    status: '200',
    responseRef: '#/components/schemas/DictionaryTypeDto',
    statuses: ['200', '400', '401', '403', '404', '422', '500'],
    permission: ['dictionaries:read'],
    resourceLocator: true,
    conflict: false,
    csrf: undefined,
    errors: [...READ_FORBIDDEN_ERRORS, TYPE_NOT_FOUND, VALIDATION_FAILED],
  },
  {
    method: 'patch',
    path: '/api/dictionary-types/{typeId}',
    operationId: 'dictionary_types_update',
    status: '200',
    responseRef: '#/components/schemas/DictionaryTypeDto',
    requestSchema: UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA,
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['dictionaries:update'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      TYPE_NOT_FOUND,
      { status: 409, codes: ['DICTIONARY_TYPE_STATE_CHANGED'] },
      VALIDATION_FAILED,
    ],
  },
  {
    method: 'post',
    path: '/api/dictionary-types/{typeId}/enable',
    operationId: 'dictionary_types_enable',
    status: '200',
    responseRef: '#/components/schemas/DictionaryTypeDto',
    requestSchema: {
      $ref: '#/components/schemas/ChangeDictionaryStatusRequestDto',
    },
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['dictionaries:enable'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      TYPE_NOT_FOUND,
      { status: 409, codes: ['DICTIONARY_TYPE_STATE_CHANGED'] },
      {
        status: 422,
        codes: [
          'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  },
  {
    method: 'post',
    path: '/api/dictionary-types/{typeId}/disable',
    operationId: 'dictionary_types_disable',
    status: '200',
    responseRef: '#/components/schemas/DictionaryTypeDto',
    requestSchema: {
      $ref: '#/components/schemas/ChangeDictionaryStatusRequestDto',
    },
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['dictionaries:disable'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      TYPE_NOT_FOUND,
      { status: 409, codes: ['DICTIONARY_TYPE_STATE_CHANGED'] },
      VALIDATION_FAILED,
    ],
  },
  {
    method: 'get',
    path: '/api/dictionary-types/{typeId}/items',
    operationId: 'dictionary_items_list',
    status: '200',
    responseRef: '#/components/schemas/DictionaryItemPageDto',
    statuses: ['200', '400', '401', '403', '404', '422', '500'],
    permission: ['dictionaries:read'],
    resourceLocator: true,
    conflict: false,
    csrf: undefined,
    errors: [...READ_FORBIDDEN_ERRORS, TYPE_NOT_FOUND, VALIDATION_FAILED],
  },
  {
    method: 'post',
    path: '/api/dictionary-types/{typeId}/items',
    operationId: 'dictionary_items_create',
    status: '201',
    responseRef: '#/components/schemas/DictionaryItemDto',
    requestSchema: {
      $ref: '#/components/schemas/CreateDictionaryItemRequestDto',
    },
    statuses: ['201', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['dictionaries:create'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      TYPE_NOT_FOUND,
      {
        status: 409,
        codes: [
          'DICTIONARY_ITEM_VALUE_ALREADY_EXISTS',
          'DICTIONARY_TYPE_STATE_CHANGED',
        ],
      },
      VALIDATION_FAILED,
    ],
  },
  {
    method: 'get',
    path: '/api/dictionary-types/{typeId}/items/{itemId}',
    operationId: 'dictionary_items_get_by_id',
    status: '200',
    responseRef: '#/components/schemas/DictionaryItemDto',
    statuses: ['200', '400', '401', '403', '404', '422', '500'],
    permission: ['dictionaries:read'],
    resourceLocator: true,
    conflict: false,
    csrf: undefined,
    errors: [...READ_FORBIDDEN_ERRORS, ITEM_NOT_FOUND, VALIDATION_FAILED],
  },
  {
    method: 'patch',
    path: '/api/dictionary-types/{typeId}/items/{itemId}',
    operationId: 'dictionary_items_update',
    status: '200',
    responseRef: '#/components/schemas/DictionaryItemDto',
    requestSchema: UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA,
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['dictionaries:update'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      ITEM_NOT_FOUND,
      { status: 409, codes: ['DICTIONARY_ITEM_STATE_CHANGED'] },
      VALIDATION_FAILED,
    ],
  },
  {
    method: 'post',
    path: '/api/dictionary-types/{typeId}/items/{itemId}/enable',
    operationId: 'dictionary_items_enable',
    status: '200',
    responseRef: '#/components/schemas/DictionaryItemDto',
    requestSchema: {
      $ref: '#/components/schemas/ChangeDictionaryStatusRequestDto',
    },
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['dictionaries:enable'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      ITEM_NOT_FOUND,
      { status: 409, codes: ['DICTIONARY_ITEM_STATE_CHANGED'] },
      VALIDATION_FAILED,
    ],
  },
  {
    method: 'post',
    path: '/api/dictionary-types/{typeId}/items/{itemId}/disable',
    operationId: 'dictionary_items_disable',
    status: '200',
    responseRef: '#/components/schemas/DictionaryItemDto',
    requestSchema: {
      $ref: '#/components/schemas/ChangeDictionaryStatusRequestDto',
    },
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['dictionaries:disable'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      ITEM_NOT_FOUND,
      { status: 409, codes: ['DICTIONARY_ITEM_STATE_CHANGED'] },
      {
        status: 422,
        codes: [
          'DICTIONARY_TYPE_ENABLED_ITEM_REQUIRED',
          'VALIDATION_FAILED',
        ],
      },
    ],
  },
]

describe('DictionariesController', () => {
  it('delegates all twelve endpoints and forwards only trusted mutation context', async () => {
    const { command, controller, query } = createControllerFixture()
    const request = createRequest()
    const requestId = getRequestId(request)
    const typeListQuery = {
      query: 'order',
      page: 2,
      pageSize: 10,
      sortBy: 'sortOrder' as const,
      sortOrder: 'asc' as const,
    }
    const itemListQuery = {
      status: 'ENABLED' as const,
      page: 1,
      pageSize: 20,
      sortBy: 'sortOrder' as const,
      sortOrder: 'asc' as const,
    }
    const createTypeDto = {
      code: 'order.status',
      name: '订单状态',
      sortOrder: 10,
    }
    const updateTypeDto = { name: '订单状态二', expectedVersion: 1 }
    const createItemDto = {
      value: 'pending',
      label: '待处理',
      sortOrder: 10,
    }
    const updateItemDto = { label: '待处理二', expectedVersion: 1 }
    const statusDto = { expectedVersion: 2 }

    await controller.listTypes(typeListQuery)
    await controller.createType(createTypeDto, request)
    await controller.getTypeById({ typeId: TYPE_ID })
    await controller.updateType({ typeId: TYPE_ID }, updateTypeDto, request)
    await controller.enableType({ typeId: TYPE_ID }, statusDto, request)
    await controller.disableType({ typeId: TYPE_ID }, statusDto, request)
    await controller.listItems({ typeId: TYPE_ID }, itemListQuery)
    await controller.createItem(
      { typeId: TYPE_ID },
      createItemDto,
      request,
    )
    await controller.getItemById({ typeId: TYPE_ID, itemId: ITEM_ID })
    await controller.updateItem(
      { typeId: TYPE_ID, itemId: ITEM_ID },
      updateItemDto,
      request,
    )
    await controller.enableItem(
      { typeId: TYPE_ID, itemId: ITEM_ID },
      statusDto,
      request,
    )
    await controller.disableItem(
      { typeId: TYPE_ID, itemId: ITEM_ID },
      statusDto,
      request,
    )

    expect(query.listTypes).toHaveBeenCalledWith(typeListQuery)
    expect(query.getTypeById).toHaveBeenCalledWith(TYPE_ID)
    expect(query.listItems).toHaveBeenCalledWith(TYPE_ID, itemListQuery)
    expect(query.getItemById).toHaveBeenCalledWith(TYPE_ID, ITEM_ID)

    const context = { actorUserId: ACTOR_ID, requestId }
    expect(command.createType).toHaveBeenCalledWith(context, createTypeDto)
    expect(command.updateType).toHaveBeenCalledWith(
      context,
      TYPE_ID,
      updateTypeDto,
    )
    expect(command.enableType).toHaveBeenCalledWith(
      context,
      TYPE_ID,
      statusDto,
    )
    expect(command.disableType).toHaveBeenCalledWith(
      context,
      TYPE_ID,
      statusDto,
    )
    expect(command.createItem).toHaveBeenCalledWith(
      context,
      TYPE_ID,
      createItemDto,
    )
    expect(command.updateItem).toHaveBeenCalledWith(
      context,
      TYPE_ID,
      ITEM_ID,
      updateItemDto,
    )
    expect(command.enableItem).toHaveBeenCalledWith(
      context,
      TYPE_ID,
      ITEM_ID,
      statusDto,
    )
    expect(command.disableItem).toHaveBeenCalledWith(
      context,
      TYPE_ID,
      ITEM_ID,
      statusDto,
    )
  })

  it('declares exact handler permissions and POST success codes', () => {
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRE_AUTHENTICATED_SESSION_METADATA,
      DictionariesController,
    )).toBeUndefined()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      DictionariesController,
    )).toBeUndefined()

    const permissionByMethod = {
      listTypes: ['dictionaries:read'],
      createType: ['dictionaries:create'],
      getTypeById: ['dictionaries:read'],
      updateType: ['dictionaries:update'],
      enableType: ['dictionaries:enable'],
      disableType: ['dictionaries:disable'],
      listItems: ['dictionaries:read'],
      createItem: ['dictionaries:create'],
      getItemById: ['dictionaries:read'],
      updateItem: ['dictionaries:update'],
      enableItem: ['dictionaries:enable'],
      disableItem: ['dictionaries:disable'],
    } as const

    for (const [method, permissions] of Object.entries(permissionByMethod)) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        DictionariesController.prototype[
          method as keyof typeof permissionByMethod
        ],
      )).toEqual(permissions)
    }

    for (const method of ['createType', 'createItem'] as const) {
      expect(Reflect.getMetadata(
        HTTP_CODE_METADATA,
        DictionariesController.prototype[method],
      )).toBe(HttpStatus.CREATED)
    }
    for (const method of [
      'enableType',
      'disableType',
      'enableItem',
      'disableItem',
    ] as const) {
      expect(Reflect.getMetadata(
        HTTP_CODE_METADATA,
        DictionariesController.prototype[method],
      )).toBe(HttpStatus.OK)
    }
  })
})

describe('DictionariesController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(DictionariesControllerContractModule)
  })

  it.each(OPERATIONS)(
    'publishes $method $path with its frozen operation and security contract',
    ({
      conflict,
      csrf,
      errors,
      method,
      operationId,
      path,
      permission,
      requestSchema,
      resourceLocator,
      responseRef,
      status,
      statuses,
    }) => {
      const operation = requireOperation(document, path, method)

      expect(operation.operationId).toBe(operationId)
      expect(operation.security).toEqual([{ sessionCookie: [] }])
      expect(Object.keys(operation.responses).sort()).toEqual(statuses)
      expect(requireResponseSchemaRef(operation, status)).toBe(responseRef)
      if (requestSchema === undefined) {
        expect(operation.requestBody).toBeUndefined()
      } else {
        expect(requireRequestSchema(operation)).toEqual(requestSchema)
      }
      expect(operation['x-qianshu-contract']).toEqual({
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator,
        conflict,
        validation: true,
        session: 'required',
        ...(csrf === undefined ? {} : { csrf }),
        privateNoStore: true,
        errors,
      })
      expect(operation.parameters).toEqual(
        csrf === true
          ? expect.arrayContaining([{
              name: 'X-Qianshu-CSRF',
              in: 'header',
              required: true,
              schema: { type: 'string', enum: ['1'] },
            }])
          : expect.not.arrayContaining([expect.objectContaining({
              name: 'X-Qianshu-CSRF',
            })]),
      )

      const expectedPathNames = [...path.matchAll(/\{([^}]+)\}/g)]
        .map(match => match[1])
      const actualPathNames: string[] = []
      for (const parameter of operation.parameters ?? []) {
        if ('$ref' in parameter || parameter.in !== 'path') {
          continue
        }
        actualPathNames.push(parameter.name)
        expect(parameter).toMatchObject({
          required: true,
          schema: { type: 'string', format: 'uuid' },
        })
      }
      expect(actualPathNames.sort()).toEqual(expectedPathNames.sort())

      const actualQueryNames: string[] = []
      for (const parameter of operation.parameters ?? []) {
        if ('$ref' in parameter || parameter.in !== 'query') {
          continue
        }
        actualQueryNames.push(parameter.name)
      }
      expect(actualQueryNames.sort()).toEqual(
        operationId === 'dictionary_types_list'
        || operationId === 'dictionary_items_list'
          ? ['page', 'pageSize', 'query', 'sortBy', 'sortOrder', 'status']
          : [],
      )
      expectPrivateNoStoreResponses(operation)

      const reflector = new Reflector()
      const controllerMethod = Object.entries({
        listTypes: 'dictionary_types_list',
        createType: 'dictionary_types_create',
        getTypeById: 'dictionary_types_get_by_id',
        updateType: 'dictionary_types_update',
        enableType: 'dictionary_types_enable',
        disableType: 'dictionary_types_disable',
        listItems: 'dictionary_items_list',
        createItem: 'dictionary_items_create',
        getItemById: 'dictionary_items_get_by_id',
        updateItem: 'dictionary_items_update',
        enableItem: 'dictionary_items_enable',
        disableItem: 'dictionary_items_disable',
      }).find(([, id]) => id === operationId)?.[0]
      if (controllerMethod === undefined) {
        throw new Error(`Missing controller method for ${operationId}`)
      }
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        DictionariesController.prototype[
          controllerMethod as keyof DictionariesController
        ],
      )).toEqual(permission)
    },
  )

  it('binds the distinct Type and Item list sort enums', () => {
    const cases = [
      {
        path: '/api/dictionary-types',
        enumValues: ['sortOrder', 'code', 'name', 'updatedAt'],
      },
      {
        path: '/api/dictionary-types/{typeId}/items',
        enumValues: ['sortOrder', 'value', 'label', 'updatedAt'],
      },
    ] as const

    for (const { enumValues, path } of cases) {
      const operation = requireOperation(document, path, 'get')
      const parameter = operation.parameters?.find(candidate =>
        !('$ref' in candidate) && candidate.name === 'sortBy',
      )
      if (parameter === undefined || '$ref' in parameter) {
        throw new Error(`Missing inline sortBy query parameter for ${path}`)
      }
      expect(parameter.schema).toMatchObject({
        type: 'string',
        enum: enumValues,
      })
    }
  })

  it('registers both PATCH DTO component refs used by the anyOf bodies', () => {
    const schemas = document.components?.schemas ?? {}
    expect(Object.hasOwn(schemas, 'UpdateDictionaryTypeRequestDto'))
      .toBe(true)
    expect(Object.hasOwn(schemas, 'UpdateDictionaryItemRequestDto'))
      .toBe(true)
  })

  it('publishes both mutable-field anyOf bodies and no DELETE surface', () => {
    expect(requireRequestSchema(requireOperation(
      document,
      '/api/dictionary-types/{typeId}',
      'patch',
    ))).toEqual(UPDATE_DICTIONARY_TYPE_REQUEST_BODY_SCHEMA)
    expect(requireRequestSchema(requireOperation(
      document,
      '/api/dictionary-types/{typeId}/items/{itemId}',
      'patch',
    ))).toEqual(UPDATE_DICTIONARY_ITEM_REQUEST_BODY_SCHEMA)

    const operations = Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/api/dictionary-types'))
      .flatMap(([path, item]) => HTTP_OPERATION_METHODS
        .flatMap(method => item?.[method] === undefined
        ? []
        : [`${method.toUpperCase()} ${path}`]))
      .sort()

    expect(operations).toEqual(OPERATIONS.map(({ method, path }) =>
      `${method.toUpperCase()} ${path}`,
    ).sort())
  })
})
