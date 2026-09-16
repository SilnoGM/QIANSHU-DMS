import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import { requestIdMiddleware } from '../../../infrastructure/http/request-id.middleware'
import { attachRequestAuthContext } from '../../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../../auth/decorators/auth.decorators'
import { PurchaseOrderMutationService } from '../purchase-order-mutation.service'
import { PurchasePayableController } from './purchase-payable.controller'
import { PurchasePayableQueryService } from './purchase-payable-query.service'
import { PurchasePayableIdDto, PurchasePayableListQueryDto, PurchasePayablePayDto } from './purchase-payable.dto'

@Module({ controllers: [PurchasePayableController], providers: [PurchasePayableQueryService, PurchaseOrderMutationService].map(provide => ({ provide, useValue: {} })) })
class ContractModule {}
describe('PurchasePayableController', () => {
  it('documents protected payable detail lookup independently from the outstanding list', async () => {
    const document = await createOpenApiDocument(ContractModule)
    const operation = document.paths['/api/purchase-order-payables/{id}']?.get
    expect(operation).toMatchObject({
      operationId: 'purchase_payables_detail',
      parameters: expect.arrayContaining([expect.objectContaining({ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } })]) as unknown,
      responses: {
        200: { headers: { 'X-Request-Id': expect.any(Object) as unknown }, content: { 'application/json': { schema: { $ref: '#/components/schemas/PurchasePayableOrderDto' } } } },
        401: expect.any(Object) as unknown, 403: expect.any(Object) as unknown, 404: expect.any(Object) as unknown, 422: expect.any(Object) as unknown,
      },
      'x-qianshu-contract': { errors: expect.arrayContaining([
        { status: 404, codes: ['PURCHASE_PAYABLE_NOT_FOUND'] },
        { status: 422, codes: expect.arrayContaining(['VALIDATION_FAILED', 'PURCHASE_PAYABLE_NOT_AVAILABLE']) as unknown },
      ]) as unknown },
    })
  })
  it('requires finance payment permission for listing, detail and payment', () => {
    const reflector = new Reflector()
    for (const method of ['list', 'detail', 'pay'] as const) expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, PurchasePayableController.prototype[method])).toEqual(['purchase-orders:payment'])
  })
  it('forwards detail to the exact payable lookup without consulting the outstanding list', async () => {
    const queries = { getByPayableId: jest.fn().mockResolvedValue({ id: 'order', items: [{ id: 'payable', status: 'PAID' }] }), list: jest.fn(), getOrder: jest.fn() }
    const controller = new PurchasePayableController(queries as unknown as PurchasePayableQueryService, {} as PurchaseOrderMutationService)
    await expect(controller.detail({ id: 'payable' })).resolves.toEqual({ id: 'order', items: [{ id: 'payable', status: 'PAID' }] })
    expect(queries.getByPayableId).toHaveBeenCalledWith('payable')
    expect(queries.list).not.toHaveBeenCalled()
    expect(queries.getOrder).not.toHaveBeenCalled()
  })
  it('documents fixed server amount, idempotency, private responses, CSRF and payment conflicts', async () => {
    const document = await createOpenApiDocument(ContractModule)
    const root = '/api/purchase-order-payables'
    expect(document.paths[root].get).toMatchObject({ operationId: 'purchase_payables_list', responses: { 200: { headers: { 'X-Request-Id': expect.any(Object) as unknown } }, 403: expect.any(Object) as unknown } })
    expect(document.paths[`${root}/{id}/pay`].post).toMatchObject({ operationId: 'purchase_payables_pay', parameters: expect.arrayContaining([{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }]) as unknown,
      'x-qianshu-contract': { errors: expect.arrayContaining([
        { status: 403, codes: expect.arrayContaining(['CSRF_REJECTED']) as unknown },
        { status: 409, codes: expect.arrayContaining(['PURCHASE_PAYABLE_STATE_CHANGED', 'PURCHASE_PAYABLE_IDEMPOTENCY_CONFLICT']) as unknown },
        { status: 422, codes: expect.arrayContaining(['PURCHASE_PAYABLE_POSTING_UNAVAILABLE']) as unknown },
      ]) as unknown } })
    const schema = document.components?.schemas?.PurchasePayablePayDto
    expect(schema).toMatchObject({ required: ['expectedVersion', 'paymentMethod'] })
    expect(schema).not.toHaveProperty('properties.amount')
    expect(schema).not.toHaveProperty('properties.ownerUserId')
  })
  it('validates identifiers and pagination and rejects forged amount or account owner', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true }
    expect(await validate(plainToInstance(PurchasePayablePayDto, { expectedVersion: 1, paymentMethod: 'BANK', remark: null }), options)).toEqual([])
    for (const field of ['amount', 'ownerUserId', 'accountOwnerType']) {
      const errors = await validate(plainToInstance(PurchasePayablePayDto, { expectedVersion: 1, paymentMethod: 'BANK', [field]: 'FORGED' }), options)
      expect(errors.map(error => error.property)).toContain(field)
    }
    for (const expectedVersion of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect((await validate(plainToInstance(PurchasePayablePayDto, { expectedVersion, paymentMethod: 'BANK' }), options)).length).toBeGreaterThan(0)
    for (const input of [{ page: 0 }, { pageSize: 201 }, { keyword: 'x'.repeat(129) }]) expect((await validate(plainToInstance(PurchasePayableListQueryDto, input), options)).length).toBeGreaterThan(0)
    expect((await validate(plainToInstance(PurchasePayableIdDto, { id: 'not-a-uuid' }), options)).length).toBeGreaterThan(0)
  })
  it('uses trusted request identity and returns the refreshed complete order group after payment', async () => {
    const queries = { list: jest.fn(), getOrder: jest.fn().mockResolvedValue({ id: 'order', items: [] }) }
    const mutations = { payPayable: jest.fn().mockResolvedValue('order') }
    const controller = new PurchasePayableController(queries as unknown as PurchasePayableQueryService, mutations as unknown as PurchaseOrderMutationService)
    const request = {}
    const date = new Date('2026-09-16')
    attachRequestAuthContext(request, { id: 'session', userId: 'finance', username: 'finance', displayName: 'Finance', mustChangePassword: false, createdAt: date, lastActivityAt: date, idleExpiresAt: date, absoluteExpiresAt: date })
    requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
    const input = { expectedVersion: 1, paymentMethod: 'BANK' }
    await expect(controller.pay({ id: 'payable' }, input, 'idempotency-key', request)).resolves.toEqual({ id: 'order', items: [] })
    expect(mutations.payPayable).toHaveBeenCalledWith({ actorUserId: 'finance', requestId: expect.stringMatching(/^req_/) as unknown }, 'payable', input, 'idempotency-key')
    expect(queries.getOrder).toHaveBeenCalledWith('order')
  })
})
