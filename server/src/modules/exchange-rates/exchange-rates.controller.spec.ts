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
import { ExchangeRateCommandService } from './exchange-rate-command.service'
import { ExchangeRateQueryService } from './exchange-rate-query.service'
import { ExchangeRatesController } from './exchange-rates.controller'

const RATE_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const CURRENCY_ID = '40ad40d4-7fa5-46fb-81e4-1986bcebf8f4'
const ACTOR_ID = '50ad40d4-7fa5-46fb-81e4-1986bcebf8f5'
const SESSION_ID = '60ad40d4-7fa5-46fb-81e4-1986bcebf8f6'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR_ID,
    username: 'exchange_rate_operator',
    displayName: '汇率管理员',
    mustChangePassword: false,
    createdAt: new Date('2026-07-29T00:00:00.000Z'),
    lastActivityAt: new Date('2026-07-29T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-07-30T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-08-29T00:00:00.000Z'),
  })
  return request
}

function createControllerFixture() {
  const queries = {
    list: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 20,
      total: 0,
    }),
    getById: jest.fn().mockResolvedValue({ id: RATE_ID }),
  }
  const commands = {
    create: jest.fn().mockResolvedValue({ id: RATE_ID }),
    update: jest.fn().mockResolvedValue({ id: RATE_ID }),
  }

  return {
    controller: new ExchangeRatesController(
      queries as unknown as ExchangeRateQueryService,
      commands as unknown as ExchangeRateCommandService,
    ),
    commands,
    queries,
  }
}

@Module({
  controllers: [ExchangeRatesController],
  providers: [
    {
      provide: ExchangeRateQueryService,
      useValue: {
        list: jest.fn(),
        getById: jest.fn(),
      },
    },
    {
      provide: ExchangeRateCommandService,
      useValue: {
        create: jest.fn(),
        update: jest.fn(),
      },
    },
  ],
})
class ExchangeRatesControllerContractModule {}

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

describe('ExchangeRatesController', () => {
  it('delegates reads and writes without introducing domain behavior', async () => {
    const { commands, controller, queries } = createControllerFixture()
    const query = { query: 'TWD', page: 1, pageSize: 20 }
    const request = createRequest()
    const createDto = {
      currencyId: CURRENCY_ID,
      foreignUnitsPerCny: '4.8',
    }
    const updateDto = {
      foreignUnitsPerCny: '5',
      expectedVersion: 1,
    }

    await controller.list(query)
    await controller.getById({ exchangeRateId: RATE_ID })
    await controller.create(createDto, request)
    await controller.update(
      { exchangeRateId: RATE_ID },
      updateDto,
      request,
    )

    expect(queries.list).toHaveBeenCalledWith(query)
    expect(queries.getById).toHaveBeenCalledWith(RATE_ID)
    expect(commands.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      createDto,
    )
    expect(commands.update).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      RATE_ID,
      updateDto,
    )
    expect(
      Object.getOwnPropertyNames(ExchangeRatesController.prototype),
    ).toEqual([
      'constructor',
      'list',
      'create',
      'getById',
      'update',
      'commandContext',
    ])
  })

  it('declares one exact permission per management operation', () => {
    const reflector = new Reflector()

    expect(
      reflector.get(
        REQUIRE_AUTHENTICATED_SESSION_METADATA,
        ExchangeRatesController,
      ),
    ).toBeUndefined()
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        ExchangeRatesController,
      ),
    ).toBeUndefined()

    const permissionByMethod = {
      list: 'exchange-rates:read',
      getById: 'exchange-rates:read',
      create: 'exchange-rates:create',
      update: 'exchange-rates:update',
    } as const

    for (const [method, permission] of Object.entries(permissionByMethod)) {
      expect(
        reflector.get(
          REQUIRED_PERMISSIONS_METADATA,
          ExchangeRatesController.prototype[
            method as keyof typeof permissionByMethod
          ],
        ),
      ).toEqual([permission])
    }

    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        ExchangeRatesController.prototype.create,
      ),
    ).toBe(HttpStatus.CREATED)
  })
})

describe('ExchangeRatesController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(
      ExchangeRatesControllerContractModule,
    )
  })

  it.each([
    {
      path: '/api/exchange-rates',
      operationId: 'exchange_rates_list',
      statuses: ['200', '400', '401', '403', '422', '500'],
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
          { status: 422, codes: ['VALIDATION_FAILED'] },
        ],
      },
    },
    {
      path: '/api/exchange-rates/{exchangeRateId}',
      operationId: 'exchange_rates_get_by_id',
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
          {
            status: 404,
            codes: ['EXCHANGE_RATE_NOT_FOUND'],
          },
          { status: 422, codes: ['VALIDATION_FAILED'] },
        ],
      },
    },
  ])(
    'publishes $operationId, permission contract and stable errors',
    ({ path, operationId, statuses, contract }) => {
      const operation = requireGetOperation(document, path)

      expect(operation.operationId).toBe(operationId)
      expect(operation.security).toEqual([{ sessionCookie: [] }])
      expect(operation['x-qianshu-contract']).toEqual(contract)
      expect(Object.keys(operation.responses).sort()).toEqual(statuses)
      expectPrivateNoStoreResponses(operation)
    },
  )

  it('publishes page/detail DTOs and query/path validation metadata', () => {
    const list = requireGetOperation(
      document,
      '/api/exchange-rates',
    )
    const detail = requireGetOperation(
      document,
      '/api/exchange-rates/{exchangeRateId}',
    )

    expect(
      JSON.stringify(list.responses[HttpStatus.OK]),
    ).toContain('ExchangeRatePageDto')
    expect(
      JSON.stringify(detail.responses[HttpStatus.OK]),
    ).toContain('ExchangeRateDto')

    const listParameters = JSON.stringify(list.parameters)
    for (const name of ['query', 'status', 'page', 'pageSize']) {
      expect(listParameters).toContain(`"name":"${name}"`)
    }
    expect(listParameters).toContain('"maximum":100')

    const detailParameters = JSON.stringify(detail.parameters)
    expect(detailParameters).toContain('"name":"exchangeRateId"')
    expect(detailParameters).toContain('"format":"uuid"')
  })

  it.each([
    {
      path: '/api/exchange-rates',
      method: 'post' as const,
      operationId: 'exchange_rates_create',
      status: HttpStatus.CREATED,
      statuses: ['201', '400', '401', '403', '404', '409', '422', '500'],
      resourceLocator: false,
      errors: [
        {
          status: 403,
          codes: [
            'CSRF_REJECTED',
            'FORBIDDEN',
            'PASSWORD_CHANGE_REQUIRED',
          ],
        },
        { status: 404, codes: ['CURRENCY_NOT_FOUND'] },
        {
          status: 409,
          codes: [
            'EXCHANGE_RATE_ALREADY_EXISTS',
            'EXCHANGE_RATE_STATE_CHANGED',
          ],
        },
        {
          status: 422,
          codes: [
            'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
            'VALIDATION_FAILED',
          ],
        },
      ],
    },
    {
      path: '/api/exchange-rates/{exchangeRateId}',
      method: 'patch' as const,
      operationId: 'exchange_rates_update',
      status: HttpStatus.OK,
      statuses: ['200', '400', '401', '403', '404', '409', '422', '500'],
      resourceLocator: true,
      errors: [
        {
          status: 403,
          codes: [
            'CSRF_REJECTED',
            'FORBIDDEN',
            'PASSWORD_CHANGE_REQUIRED',
          ],
        },
        { status: 404, codes: ['EXCHANGE_RATE_NOT_FOUND'] },
        { status: 409, codes: ['EXCHANGE_RATE_STATE_CHANGED'] },
        {
          status: 422,
          codes: [
            'BASE_CURRENCY_EXCHANGE_RATE_FORBIDDEN',
            'VALIDATION_FAILED',
          ],
        },
      ],
    },
  ])(
    'publishes $operationId as a CSRF-protected permission mutation',
    ({
      path,
      method,
      operationId,
      status,
      statuses,
      resourceLocator,
      errors,
    }) => {
      const operation = requireWriteOperation(document, path, method)

      expect(operation.operationId).toBe(operationId)
      expect(operation['x-qianshu-contract']).toEqual({
        kind: 'application',
        authentication: true,
        authorization: true,
        csrf: true,
        resourceLocator,
        conflict: true,
        validation: true,
        session: 'required',
        privateNoStore: true,
        errors,
      })
      expect(Object.keys(operation.responses).sort()).toEqual(statuses)
      expect(JSON.stringify(operation.responses[status]))
        .toContain('ExchangeRateDto')
    },
  )
})
