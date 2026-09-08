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
import { NumberingCommandService } from './numbering-command.service'
import { NumberingController } from './numbering.controller'
import { NumberingQueryService } from './numbering-query.service'

const RULE_ID = '10000000-0000-4000-8000-000000000001'
const ACTOR_ID = '10000000-0000-4000-8000-000000000002'
const SESSION_ID = '10000000-0000-4000-8000-000000000003'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR_ID,
    username: 'numbering_operator',
    displayName: '编号管理员',
    mustChangePassword: false,
    createdAt: new Date('2026-08-02T00:00:00.000Z'),
    lastActivityAt: new Date('2026-08-02T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-08-03T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-09-02T00:00:00.000Z'),
  })
  return request
}

function createControllerFixture() {
  const query = {
    list: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    }),
    getDetail: jest.fn().mockResolvedValue({ id: RULE_ID }),
    preview: jest.fn().mockResolvedValue({ periodKey: 'ALL' }),
    listVersions: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    }),
    listIssuances: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    }),
  }
  const command = {
    create: jest.fn().mockResolvedValue({ id: RULE_ID }),
    update: jest.fn().mockResolvedValue({ id: RULE_ID }),
    publish: jest.fn().mockResolvedValue({ id: RULE_ID }),
    enable: jest.fn().mockResolvedValue({ id: RULE_ID }),
    disable: jest.fn().mockResolvedValue({ id: RULE_ID }),
    clone: jest.fn().mockResolvedValue({ id: RULE_ID }),
  }

  return {
    controller: new NumberingController(
      query as unknown as NumberingQueryService,
      command as unknown as NumberingCommandService,
    ),
    query,
    command,
  }
}

@Module({
  controllers: [NumberingController],
  providers: [
    {
      provide: NumberingQueryService,
      useValue: {
        list: jest.fn(),
        getDetail: jest.fn(),
        preview: jest.fn(),
        listVersions: jest.fn(),
        listIssuances: jest.fn(),
      },
    },
    {
      provide: NumberingCommandService,
      useValue: {
        create: jest.fn(),
        update: jest.fn(),
        publish: jest.fn(),
        enable: jest.fn(),
        disable: jest.fn(),
        clone: jest.fn(),
      },
    },
  ],
})
class NumberingControllerContractModule {}

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

type HttpMethod = 'get' | 'patch' | 'post'

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

function requireRequestSchemaRef(operation: ContractOperation): string {
  const requestBody = operation.requestBody
  if (!requestBody || '$ref' in requestBody) {
    throw new Error('Missing inline request body')
  }
  const schema = requestBody.content['application/json']?.schema
  if (!schema || !('$ref' in schema) || typeof schema.$ref !== 'string') {
    throw new Error('Missing request schema ref')
  }
  return schema.$ref
}

const READ_FORBIDDEN_ERRORS = [{
  status: 403,
  codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
}]
const WRITE_FORBIDDEN_ERRORS = [{
  status: 403,
  codes: ['CSRF_REJECTED', 'FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
}]

interface OperationContractSpec {
  readonly method: HttpMethod
  readonly path: string
  readonly operationId: string
  readonly status: string
  readonly responseRef: string
  readonly requestRef?: string
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
    path: '/api/numbering-rules',
    operationId: 'numbering_rules_list',
    status: '200',
    responseRef: '#/components/schemas/NumberingRulePageDto',
    statuses: ['200', '400', '401', '403', '422', '500'],
    permission: ['numbering-rules:read'],
    resourceLocator: false,
    conflict: false,
    csrf: undefined,
    errors: [
      ...READ_FORBIDDEN_ERRORS,
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  },
  {
    method: 'get',
    path: '/api/numbering-rules/{ruleId}',
    operationId: 'numbering_rules_get',
    status: '200',
    responseRef: '#/components/schemas/NumberingRuleDetailDto',
    statuses: ['200', '400', '401', '403', '404', '422', '500'],
    permission: ['numbering-rules:read'],
    resourceLocator: true,
    conflict: false,
    csrf: undefined,
    errors: [
      ...READ_FORBIDDEN_ERRORS,
      { status: 404, codes: ['NUMBERING_RULE_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  },
  {
    method: 'post',
    path: '/api/numbering-rules/preview',
    operationId: 'numbering_rules_preview',
    status: '200',
    responseRef: '#/components/schemas/PreviewNumberingRuleResponseDto',
    requestRef: '#/components/schemas/PreviewNumberingRuleRequestDto',
    statuses: ['200', '400', '401', '403', '404', '422', '500'],
    permission: ['numbering-rules:read'],
    resourceLocator: false,
    conflict: false,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      { status: 404, codes: ['NUMBERING_RULE_NOT_FOUND'] },
      {
        status: 422,
        codes: ['NUMBERING_RULE_CONFIG_INVALID', 'VALIDATION_FAILED'],
      },
    ],
  },
  {
    method: 'post',
    path: '/api/numbering-rules',
    operationId: 'numbering_rules_create',
    status: '201',
    responseRef: '#/components/schemas/NumberingRuleDetailDto',
    requestRef: '#/components/schemas/CreateNumberingRuleRequestDto',
    statuses: ['201', '400', '401', '403', '409', '422', '500'],
    permission: ['numbering-rules:create'],
    resourceLocator: false,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      {
        status: 409,
        codes: [
          'NUMBERING_RULE_CODE_ALREADY_EXISTS',
          'NUMBERING_RULE_STATE_CHANGED',
        ],
      },
      {
        status: 422,
        codes: ['NUMBERING_RULE_CONFIG_INVALID', 'VALIDATION_FAILED'],
      },
    ],
  },
  {
    method: 'patch',
    path: '/api/numbering-rules/{ruleId}',
    operationId: 'numbering_rules_update',
    status: '200',
    responseRef: '#/components/schemas/NumberingRuleDetailDto',
    requestRef: '#/components/schemas/UpdateNumberingRuleRequestDto',
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['numbering-rules:update'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      { status: 404, codes: ['NUMBERING_RULE_NOT_FOUND'] },
      { status: 409, codes: ['NUMBERING_RULE_STATE_CHANGED'] },
      {
        status: 422,
        codes: ['NUMBERING_RULE_CONFIG_INVALID', 'VALIDATION_FAILED'],
      },
    ],
  },
  {
    method: 'get',
    path: '/api/numbering-rules/{ruleId}/versions',
    operationId: 'numbering_rule_versions_list',
    status: '200',
    responseRef: '#/components/schemas/NumberingRuleVersionPageDto',
    statuses: ['200', '400', '401', '403', '404', '422', '500'],
    permission: ['numbering-rules:read'],
    resourceLocator: true,
    conflict: false,
    csrf: undefined,
    errors: [
      ...READ_FORBIDDEN_ERRORS,
      { status: 404, codes: ['NUMBERING_RULE_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  },
  {
    method: 'post',
    path: '/api/numbering-rules/{ruleId}/publish',
    operationId: 'numbering_rules_publish',
    status: '200',
    responseRef: '#/components/schemas/NumberingRuleDetailDto',
    requestRef: '#/components/schemas/PublishNumberingRuleRequestDto',
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['numbering-rules:publish'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      { status: 404, codes: ['NUMBERING_RULE_NOT_FOUND'] },
      {
        status: 409,
        codes: ['NUMBERING_RULE_STATE_CHANGED', 'NUMBERING_RULE_UNAVAILABLE'],
      },
      {
        status: 422,
        codes: ['NUMBERING_RULE_CONFIG_INVALID', 'VALIDATION_FAILED'],
      },
    ],
  },
  {
    method: 'post',
    path: '/api/numbering-rules/{ruleId}/enable',
    operationId: 'numbering_rules_enable',
    status: '200',
    responseRef: '#/components/schemas/NumberingRuleDetailDto',
    requestRef: '#/components/schemas/ChangeNumberingRuleStatusRequestDto',
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['numbering-rules:enable'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      { status: 404, codes: ['NUMBERING_RULE_NOT_FOUND'] },
      {
        status: 409,
        codes: ['NUMBERING_RULE_STATE_CHANGED', 'NUMBERING_RULE_UNAVAILABLE'],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  },
  {
    method: 'post',
    path: '/api/numbering-rules/{ruleId}/disable',
    operationId: 'numbering_rules_disable',
    status: '200',
    responseRef: '#/components/schemas/NumberingRuleDetailDto',
    requestRef: '#/components/schemas/ChangeNumberingRuleStatusRequestDto',
    statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['numbering-rules:disable'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      { status: 404, codes: ['NUMBERING_RULE_NOT_FOUND'] },
      {
        status: 409,
        codes: ['NUMBERING_RULE_STATE_CHANGED', 'NUMBERING_RULE_UNAVAILABLE'],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  },
  {
    method: 'post',
    path: '/api/numbering-rules/{ruleId}/clone',
    operationId: 'numbering_rules_clone',
    status: '201',
    responseRef: '#/components/schemas/NumberingRuleDetailDto',
    requestRef: '#/components/schemas/CloneNumberingRuleRequestDto',
    statuses: ['201', '400', '401', '403', '404', '409', '422', '500'],
    permission: ['numbering-rules:read', 'numbering-rules:create'],
    resourceLocator: true,
    conflict: true,
    csrf: true,
    errors: [
      ...WRITE_FORBIDDEN_ERRORS,
      { status: 404, codes: ['NUMBERING_RULE_NOT_FOUND'] },
      {
        status: 409,
        codes: [
          'NUMBERING_RULE_CODE_ALREADY_EXISTS',
          'NUMBERING_RULE_STATE_CHANGED',
          'NUMBERING_RULE_UNAVAILABLE',
        ],
      },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  },
  {
    method: 'get',
    path: '/api/numbering-rules/{ruleId}/issuances',
    operationId: 'numbering_rule_issuances_list',
    status: '200',
    responseRef: '#/components/schemas/NumberingIssuancePageDto',
    statuses: ['200', '400', '401', '403', '404', '422', '500'],
    permission: [
      'numbering-rules:read',
      'numbering-rules:read-issuances',
    ],
    resourceLocator: true,
    conflict: false,
    csrf: undefined,
    errors: [
      ...READ_FORBIDDEN_ERRORS,
      { status: 404, codes: ['NUMBERING_RULE_NOT_FOUND'] },
      { status: 422, codes: ['VALIDATION_FAILED'] },
    ],
  },
]

describe('NumberingController', () => {
  it('delegates all reads and forwards only trusted mutation context', async () => {
    const { command, controller, query } = createControllerFixture()
    const request = createRequest()
    const requestId = getRequestId(request)
    const listQuery = {
      page: 1,
      pageSize: 20,
      sortBy: 'updatedAt' as const,
      sortOrder: 'desc' as const,
    }
    const versionQuery = { page: 2, pageSize: 10 }
    const issuanceQuery = {
      page: 1,
      pageSize: 20,
      generatedNumber: 'SO001',
    }
    const config = {
      resetPolicy: 'NEVER' as const,
      segments: [{
        type: 'SEQUENCE' as const,
        width: 6,
        startValue: '1',
        step: '1',
      }],
    }
    const createDto = {
      purpose: 'BUSINESS' as const,
      ...config,
      ruleCode: 'SALES_ORDER',
      name: '销售订单',
    }
    const updateDto = { name: '销售订单二', expectedVersion: 1 }
    const publishDto = { draftRevision: 2, expectedVersion: 1 }
    const statusDto = { expectedVersion: 2 }
    const cloneDto = {
      ruleCode: 'SALES_ORDER_COPY',
      name: '销售订单副本',
      expectedVersion: 2,
    }

    await controller.list(listQuery)
    await controller.getDetail({ ruleId: RULE_ID })
    await controller.preview(config)
    await controller.listVersions({ ruleId: RULE_ID }, versionQuery)
    await controller.listIssuances({ ruleId: RULE_ID }, issuanceQuery)
    await controller.create(createDto, request)
    await controller.update({ ruleId: RULE_ID }, updateDto, request)
    await controller.publish({ ruleId: RULE_ID }, publishDto, request)
    await controller.enable({ ruleId: RULE_ID }, statusDto, request)
    await controller.disable({ ruleId: RULE_ID }, statusDto, request)
    await controller.clone({ ruleId: RULE_ID }, cloneDto, request)

    expect(query.list).toHaveBeenCalledWith(listQuery)
    expect(query.getDetail).toHaveBeenCalledWith(RULE_ID)
    expect(query.preview).toHaveBeenCalledWith(config)
    expect(query.listVersions).toHaveBeenCalledWith(RULE_ID, versionQuery)
    expect(query.listIssuances).toHaveBeenCalledWith(RULE_ID, issuanceQuery)

    const context = { actorUserId: ACTOR_ID, requestId }
    expect(command.create).toHaveBeenCalledWith(context, createDto)
    expect(command.update).toHaveBeenCalledWith(context, RULE_ID, updateDto)
    expect(command.publish).toHaveBeenCalledWith(context, RULE_ID, publishDto)
    expect(command.enable).toHaveBeenCalledWith(context, RULE_ID, statusDto)
    expect(command.disable).toHaveBeenCalledWith(context, RULE_ID, statusDto)
    expect(command.clone).toHaveBeenCalledWith(context, RULE_ID, cloneDto)

    expect(Object.getOwnPropertyNames(NumberingController.prototype)).toEqual([
      'constructor',
      'list',
      'preview',
      'create',
      'getDetail',
      'update',
      'listVersions',
      'publish',
      'enable',
      'disable',
      'clone',
      'listIssuances',
      'commandContext',
    ])
  })

  it('declares exact handler permissions and success codes', () => {
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRE_AUTHENTICATED_SESSION_METADATA,
      NumberingController,
    )).toBeUndefined()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      NumberingController,
    )).toBeUndefined()

    const permissionByMethod = {
      list: ['numbering-rules:read'],
      getDetail: ['numbering-rules:read'],
      preview: ['numbering-rules:read'],
      create: ['numbering-rules:create'],
      update: ['numbering-rules:update'],
      listVersions: ['numbering-rules:read'],
      publish: ['numbering-rules:publish'],
      enable: ['numbering-rules:enable'],
      disable: ['numbering-rules:disable'],
      clone: ['numbering-rules:read', 'numbering-rules:create'],
      listIssuances: [
        'numbering-rules:read',
        'numbering-rules:read-issuances',
      ],
    } as const

    for (const [method, permissions] of Object.entries(permissionByMethod)) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        NumberingController.prototype[
          method as keyof typeof permissionByMethod
        ],
      )).toEqual(permissions)
    }

    for (const method of [
      'preview',
      'update',
      'publish',
      'enable',
      'disable',
    ] as const) {
      expect(Reflect.getMetadata(
        HTTP_CODE_METADATA,
        NumberingController.prototype[method],
      )).toBe(HttpStatus.OK)
    }
    for (const method of ['create', 'clone'] as const) {
      expect(Reflect.getMetadata(
        HTTP_CODE_METADATA,
        NumberingController.prototype[method],
      )).toBe(HttpStatus.CREATED)
    }
  })
})

describe('NumberingController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(NumberingControllerContractModule)
  })

  it.each(OPERATIONS)(
    'publishes $method $path with frozen operationId and contract',
    ({
      conflict,
      csrf,
      errors,
      method,
      operationId,
      path,
      requestRef,
      resourceLocator,
      responseRef,
      status,
      statuses,
    }) => {
      const operation = requireOperation(document, path, method)
      expect(operation.operationId).toBe(operationId)
      expect(Object.keys(operation.responses).sort()).toEqual(statuses)
      expect(requireResponseSchemaRef(operation, status)).toBe(responseRef)
      if (requestRef !== undefined) {
        expect(requireRequestSchemaRef(operation)).toBe(requestRef)
      } else {
        expect(operation.requestBody).toBeUndefined()
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
      expectPrivateNoStoreResponses(operation)
    },
  )

  it('contains exactly the eleven management operations and no public generate/delete', () => {
    const numberingOperations = Object.entries(document.paths)
      .filter(([path]) => path.startsWith('/api/numbering-rules'))
      .flatMap(([path, item]) => (
        ['get', 'post', 'patch', 'delete'] as const
      ).flatMap((method) => item?.[method] === undefined
        ? []
        : [`${method.toUpperCase()} ${path}`]))

    expect(numberingOperations).toHaveLength(11)
    expect(numberingOperations).not.toContain(
      'POST /api/numbering-rules/{ruleId}/generate',
    )
    expect(document.paths['/api/numbering/generate']).toBeUndefined()
    expect(numberingOperations.every(operation =>
      !operation.startsWith('DELETE '),
    )).toBe(true)
  })
})
