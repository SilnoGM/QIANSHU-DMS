import { HttpStatus, Module } from '@nestjs/common'
import { HTTP_CODE_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { OpenAPIObject } from '@nestjs/swagger'

import { requestIdMiddleware } from '../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { CSRF_HEADER_NAME } from '../../openapi/openapi.constants'
import { attachRequestAuthContext } from '../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { SupplierCommandService } from './supplier-command.service'
import { SupplierLifecycleService } from './supplier-lifecycle.service'
import { SupplierQueryService } from './supplier-query.service'
import { SuppliersController } from './suppliers.controller'

const SUPPLIER_ID = '42ad40d4-7fa5-46fb-81e4-1986bcebf8f1'
const ACTOR_ID = 'ba6e6036-42c7-489b-b22b-238c3d36a879'
const SESSION_ID = '5f6ddb91-c9a0-4ee4-a1de-e2587128fdc3'
const IDEMPOTENCY_KEY = '2f1adcbc-5d63-4f0f-9a9f-265d4c823241'

function createRequest(): object {
  const request = {}
  requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(request, {
    id: SESSION_ID,
    userId: ACTOR_ID,
    username: 'supplier_operator',
    displayName: '供应商管理员',
    mustChangePassword: false,
    createdAt: new Date('2026-08-05T00:00:00.000Z'),
    lastActivityAt: new Date('2026-08-05T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-08-06T00:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-09-05T00:00:00.000Z'),
  })
  return request
}

function createFixture() {
  const query = {
    list: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }),
    getById: jest.fn().mockResolvedValue({ id: SUPPLIER_ID }),
  }
  const command = {
    create: jest.fn().mockResolvedValue({ id: SUPPLIER_ID }),
  }
  const lifecycle = {
    update: jest.fn().mockResolvedValue({ id: SUPPLIER_ID }),
    enable: jest.fn().mockResolvedValue({ id: SUPPLIER_ID }),
    disable: jest.fn().mockResolvedValue({ id: SUPPLIER_ID }),
  }
  return {
    query,
    command,
    lifecycle,
    controller: new SuppliersController(
      query as unknown as SupplierQueryService,
      command as unknown as SupplierCommandService,
      lifecycle as unknown as SupplierLifecycleService,
    ),
  }
}

@Module({
  controllers: [SuppliersController],
  providers: [
    { provide: SupplierQueryService, useValue: { list: jest.fn(), getById: jest.fn() } },
    { provide: SupplierCommandService, useValue: { create: jest.fn() } },
    {
      provide: SupplierLifecycleService,
      useValue: { update: jest.fn(), enable: jest.fn(), disable: jest.fn() },
    },
  ],
})
class SuppliersControllerContractModule {}

type ContractOperation = NonNullable<
  OpenAPIObject['paths'][string]['get']
> & { 'x-qianshu-contract'?: unknown }

function operation(
  document: OpenAPIObject,
  path: string,
  method: 'get' | 'patch' | 'post',
): ContractOperation {
  const result = document.paths[path]?.[method]
  if (!result) throw new Error(`Missing ${method.toUpperCase()} ${path}`)
  return result
}

describe('SuppliersController', () => {
  it('delegates exactly six operations and forwards trusted context/key', async () => {
    const fixture = createFixture()
    const request = createRequest()
    const listDto = { page: 1, pageSize: 20 }
    const createDto = { legalName: '示例供方', entityType: 'ORGANIZATION' as const }
    const updateDto = { legalName: '新供方', expectedVersion: 1 }
    const statusDto = { expectedVersion: 2 }

    await fixture.controller.list(listDto)
    await fixture.controller.getById({ supplierId: SUPPLIER_ID })
    await fixture.controller.create(createDto, IDEMPOTENCY_KEY, request)
    await fixture.controller.update(
      { supplierId: SUPPLIER_ID },
      updateDto,
      request,
    )
    await fixture.controller.enable(
      { supplierId: SUPPLIER_ID },
      statusDto,
      request,
    )
    await fixture.controller.disable(
      { supplierId: SUPPLIER_ID },
      statusDto,
      request,
    )

    expect(fixture.query.list).toHaveBeenCalledWith(listDto)
    expect(fixture.query.getById).toHaveBeenCalledWith(SUPPLIER_ID)
    expect(fixture.command.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      IDEMPOTENCY_KEY,
      createDto,
    )
    expect(fixture.lifecycle.update).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      SUPPLIER_ID,
      updateDto,
    )
    expect(fixture.lifecycle.enable).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      SUPPLIER_ID,
      statusDto,
    )
    expect(fixture.lifecycle.disable).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      SUPPLIER_ID,
      statusDto,
    )
  })

  it('declares one exact permission and mutation status per handler', () => {
    const reflector = new Reflector()
    const expected = {
      list: 'suppliers:read',
      getById: 'suppliers:read',
      create: 'suppliers:create',
      update: 'suppliers:update',
      enable: 'suppliers:enable',
      disable: 'suppliers:disable',
    } as const
    for (const [method, permission] of Object.entries(expected)) {
      expect(reflector.get(
        REQUIRED_PERMISSIONS_METADATA,
        SuppliersController.prototype[method as keyof typeof expected],
      )).toEqual([permission])
    }
    expect(Reflect.getMetadata(
      HTTP_CODE_METADATA,
      SuppliersController.prototype.create,
    )).toBe(HttpStatus.CREATED)
    expect(Reflect.getMetadata(
      HTTP_CODE_METADATA,
      SuppliersController.prototype.enable,
    )).toBe(HttpStatus.OK)
    expect(Reflect.getMetadata(
      HTTP_CODE_METADATA,
      SuppliersController.prototype.disable,
    )).toBe(HttpStatus.OK)
  })
})

describe('SuppliersController OpenAPI contract', () => {
  let document: OpenAPIObject

  beforeAll(async () => {
    document = await createOpenApiDocument(SuppliersControllerContractModule)
  })

  it('publishes exactly the six approved operationIds and no delete/catalog/generate', () => {
    expect(Object.keys(document.paths).filter(path => path.includes('supplier')))
      .toEqual([
        '/api/suppliers',
        '/api/suppliers/{supplierId}',
        '/api/suppliers/{supplierId}/enable',
        '/api/suppliers/{supplierId}/disable',
      ])
    expect(operation(document, '/api/suppliers', 'get').operationId)
      .toBe('suppliers_list')
    expect(operation(document, '/api/suppliers', 'post').operationId)
      .toBe('suppliers_create')
    expect(operation(document, '/api/suppliers/{supplierId}', 'get').operationId)
      .toBe('suppliers_get_by_id')
    expect(operation(document, '/api/suppliers/{supplierId}', 'patch').operationId)
      .toBe('suppliers_update')
    expect(operation(document, '/api/suppliers/{supplierId}/enable', 'post').operationId)
      .toBe('suppliers_enable')
    expect(operation(document, '/api/suppliers/{supplierId}/disable', 'post').operationId)
      .toBe('suppliers_disable')
    expect(JSON.stringify(document.paths)).not.toContain('delete')
    expect(JSON.stringify(document.paths)).not.toContain('catalog')
    expect(JSON.stringify(document.paths)).not.toContain('generate')
  })

  it('publishes the required canonical Idempotency-Key header on create only', () => {
    const create = operation(document, '/api/suppliers', 'post')
    expect(create.parameters).toContainEqual({
      in: 'header',
      name: 'Idempotency-Key',
      required: true,
      schema: {
        type: 'string',
        format: 'uuid',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
      },
    })
    for (const [path, method] of [
      ['/api/suppliers', 'get'],
      ['/api/suppliers/{supplierId}', 'get'],
      ['/api/suppliers/{supplierId}', 'patch'],
      ['/api/suppliers/{supplierId}/enable', 'post'],
      ['/api/suppliers/{supplierId}/disable', 'post'],
    ] as const) {
      expect(operation(document, path, method).parameters ?? [])
        .not.toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'Idempotency-Key' }),
        ]))
    }
  })

  it('marks reads private and writes CSRF-protected with exact status families', () => {
    const list = operation(document, '/api/suppliers', 'get')
    const detail = operation(document, '/api/suppliers/{supplierId}', 'get')
    const create = operation(document, '/api/suppliers', 'post')
    const update = operation(document, '/api/suppliers/{supplierId}', 'patch')
    const enable = operation(document, '/api/suppliers/{supplierId}/enable', 'post')
    const disable = operation(document, '/api/suppliers/{supplierId}/disable', 'post')

    for (const read of [list, detail]) {
      expect(read.security).toEqual([{ sessionCookie: [] }])
      expect(read['x-qianshu-contract']).toMatchObject({
        authentication: true,
        authorization: true,
        privateNoStore: true,
        conflict: false,
      })
    }
    for (const write of [create, update, enable, disable]) {
      expect(write.security).toEqual([{ sessionCookie: [] }])
      expect(write.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            in: 'header',
            name: CSRF_HEADER_NAME,
            required: true,
          }),
        ]),
      )
      expect(write['x-qianshu-contract']).toMatchObject({
        authentication: true,
        authorization: true,
        csrf: true,
        privateNoStore: true,
        conflict: true,
      })
    }
    expect(Object.keys(list.responses).sort()).toEqual(['200', '400', '401', '403', '422', '500'])
    expect(Object.keys(detail.responses).sort()).toEqual(['200', '400', '401', '403', '404', '422', '500'])
    expect(Object.keys(create.responses).sort()).toEqual(['201', '400', '401', '403', '409', '422', '500', '503'])
    expect(Object.keys(update.responses).sort()).toEqual(['200', '400', '401', '403', '404', '409', '422', '500'])
    expect(Object.keys(enable.responses).sort()).toEqual(['200', '400', '401', '403', '404', '409', '422', '500'])
    expect(Object.keys(disable.responses).sort()).toEqual(['200', '400', '401', '403', '404', '409', '422', '500'])
  })
})
