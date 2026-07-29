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
import { CurrenciesController } from './currencies.controller'
import { CurrencyCommandService } from './currency-command.service'
import { CurrencyQueryService } from './currency-query.service'

const CURRENCY_ID = '20ad40d4-7fa5-46fb-81e4-1986bcebf8f2'
const ACTOR_ID = '30ad40d4-7fa5-46fb-81e4-1986bcebf8f3'
const SESSION_ID = '40ad40d4-7fa5-46fb-81e4-1986bcebf8f4'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR_ID,
    username: 'currency_operator',
    displayName: '货币管理员',
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
    getById: jest.fn().mockResolvedValue({ id: CURRENCY_ID }),
  }
  const commands = {
    create: jest.fn().mockResolvedValue({ id: CURRENCY_ID }),
    update: jest.fn().mockResolvedValue({ id: CURRENCY_ID }),
    enable: jest.fn().mockResolvedValue({ id: CURRENCY_ID }),
    disable: jest.fn().mockResolvedValue({ id: CURRENCY_ID }),
  }

  return {
    controller: new CurrenciesController(
      queries as unknown as CurrencyQueryService,
      commands as unknown as CurrencyCommandService,
    ),
    commands,
    queries,
  }
}

@Module({
  controllers: [CurrenciesController],
  providers: [
    {
      provide: CurrencyQueryService,
      useValue: {
        list: jest.fn(),
        getById: jest.fn(),
      },
    },
    {
      provide: CurrencyCommandService,
      useValue: {
        create: jest.fn(),
        update: jest.fn(),
        enable: jest.fn(),
        disable: jest.fn(),
      },
    },
  ],
})
class CurrenciesControllerContractModule {}

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

describe('CurrenciesController', () => {
  it('delegates reads and writes without adding domain behavior', async () => {
    const { commands, controller, queries } = createControllerFixture()
    const query = { query: 'USD', page: 2, pageSize: 10 }
    const request = createRequest()
    const createDto = {
      code: 'USD',
      name: '美元',
      minorUnit: 2,
      sortOrder: 40,
    }
    const updateDto = {
      name: '美元',
      expectedVersion: 1,
    }
    const statusDto = { expectedVersion: 1 }

    await controller.list(query)
    await controller.getById({ currencyId: CURRENCY_ID })
    await controller.create(createDto, request)
    await controller.update(
      { currencyId: CURRENCY_ID },
      updateDto,
      request,
    )
    await controller.enable(
      { currencyId: CURRENCY_ID },
      statusDto,
      request,
    )
    await controller.disable(
      { currencyId: CURRENCY_ID },
      statusDto,
      request,
    )

    expect(queries.list).toHaveBeenCalledWith(query)
    expect(queries.getById).toHaveBeenCalledWith(CURRENCY_ID)
    expect(commands.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      createDto,
    )
    expect(commands.update).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      CURRENCY_ID,
      updateDto,
    )
    expect(commands.enable).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      CURRENCY_ID,
      statusDto,
    )
    expect(commands.disable).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      CURRENCY_ID,
      statusDto,
    )
  })

  it('declares one exact permission per handler without class-level policy', () => {
    const reflector = new Reflector()

    expect(
      reflector.get(
        REQUIRE_AUTHENTICATED_SESSION_METADATA,
        CurrenciesController,
      ),
    ).toBeUndefined()
    expect(
      reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        CurrenciesController,
      ),
    ).toBeUndefined()

    const permissionByMethod = {
      list: 'currencies:read',
      getById: 'currencies:read',
      create: 'currencies:create',
      update: 'currencies:update',
      enable: 'currencies:enable',
      disable: 'currencies:disable',
    } as const

    for (const [method, permission] of Object.entries(permissionByMethod)) {
      expect(
        reflector.get(
          REQUIRED_PERMISSIONS_METADATA,
          CurrenciesController.prototype[
            method as keyof typeof permissionByMethod
          ],
        ),
      ).toEqual([permission])
    }

    expect(
      Reflect.getMetadata(
        HTTP_CODE_METADATA,
        CurrenciesController.prototype.create,
      ),
    ).toBe(HttpStatus.CREATED)
  })
})

describe('CurrenciesController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(
      CurrenciesControllerContractModule,
    )
  })

  it.each([
    {
      path: '/api/currencies',
      operationId: 'currencies_list',
      statuses: ['200', '400', '401', '403', '422', '500'],
      resourceLocator: false,
      errors: [
        {
          status: 403,
          codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
        },
        {
          status: 422,
          codes: ['VALIDATION_FAILED'],
        },
      ],
    },
    {
      path: '/api/currencies/{currencyId}',
      operationId: 'currencies_get_by_id',
      statuses: ['200', '400', '401', '403', '404', '422', '500'],
      resourceLocator: true,
      errors: [
        {
          status: 403,
          codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'],
        },
        {
          status: 404,
          codes: ['CURRENCY_NOT_FOUND'],
        },
        {
          status: 422,
          codes: ['VALIDATION_FAILED'],
        },
      ],
    },
  ])(
    'publishes $operationId with its exact permission boundary',
    ({ path, operationId, statuses, resourceLocator, errors }) => {
      const operation = requireGetOperation(document, path)

      expect(operation.operationId).toBe(operationId)
      expect(operation.security).toEqual([{ sessionCookie: [] }])
      expect(operation['x-qianshu-contract']).toEqual({
        kind: 'application',
        authentication: true,
        authorization: true,
        resourceLocator,
        conflict: false,
        validation: true,
        session: 'required',
        privateNoStore: true,
        errors,
      })
      expect(Object.keys(operation.responses).sort()).toEqual(statuses)
    },
  )

  it('publishes management response DTOs and validated parameters', () => {
    const list = requireGetOperation(document, '/api/currencies')
    const detail = requireGetOperation(
      document,
      '/api/currencies/{currencyId}',
    )

    expect(JSON.stringify(list.responses[HttpStatus.OK]))
      .toContain('CurrencyPageDto')
    expect(JSON.stringify(detail.responses[HttpStatus.OK]))
      .toContain('CurrencyDto')
    expect(detail.parameters).toContainEqual({
      in: 'path',
      name: 'currencyId',
      required: true,
      schema: {
        type: 'string',
        format: 'uuid',
      },
    })
  })

  it.each([
    {
      path: '/api/currencies',
      method: 'post' as const,
      operationId: 'currencies_create',
      status: HttpStatus.CREATED,
      statuses: ['201', '400', '401', '403', '409', '422', '500'],
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
        {
          status: 409,
          codes: [
            'CURRENCY_CODE_ALREADY_EXISTS',
            'CURRENCY_STATE_CHANGED',
          ],
        },
        { status: 422, codes: ['VALIDATION_FAILED'] },
      ],
    },
    {
      path: '/api/currencies/{currencyId}',
      method: 'patch' as const,
      operationId: 'currencies_update',
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
        { status: 404, codes: ['CURRENCY_NOT_FOUND'] },
        { status: 409, codes: ['CURRENCY_STATE_CHANGED'] },
        { status: 422, codes: ['VALIDATION_FAILED'] },
      ],
    },
    {
      path: '/api/currencies/{currencyId}/enable',
      method: 'post' as const,
      operationId: 'currencies_enable',
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
        { status: 404, codes: ['CURRENCY_NOT_FOUND'] },
        { status: 409, codes: ['CURRENCY_STATE_CHANGED'] },
        {
          status: 422,
          codes: ['CURRENCY_EXCHANGE_RATE_REQUIRED', 'VALIDATION_FAILED'],
        },
      ],
    },
    {
      path: '/api/currencies/{currencyId}/disable',
      method: 'post' as const,
      operationId: 'currencies_disable',
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
        { status: 404, codes: ['CURRENCY_NOT_FOUND'] },
        { status: 409, codes: ['CURRENCY_STATE_CHANGED'] },
        {
          status: 422,
          codes: ['BASE_CURRENCY_CANNOT_BE_DISABLED', 'VALIDATION_FAILED'],
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
        .toContain('CurrencyDto')
    },
  )
})
