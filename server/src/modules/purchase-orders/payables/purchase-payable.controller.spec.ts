import { PurchasePayableVoucherService } from './purchase-payable-voucher.service'
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
import { PurchasePayableBatchPayDto, PurchasePayableIdDto, PurchasePayableListQueryDto, PurchasePayablePayDto } from './purchase-payable.dto'

@Module({ controllers: [PurchasePayableController], providers: [PurchasePayableQueryService, PurchaseOrderMutationService, PurchasePayableVoucherService].map(provide => ({ provide, useValue: {} })) })
class ContractModule {}
describe('PurchasePayableController', () => {
  it.each([
    ['/api/purchase-order-payables/{id}', 'purchase_payables_detail'],
    ['/api/purchase-order-payables/orders/{id}', 'purchase_payables_order_detail'],
  ])('documents protected detail lookup independently from the outstanding list: %s', async (path, operationId) => {
    const document = await createOpenApiDocument(ContractModule)
    const operation = document.paths[path]?.get
    expect(operation).toMatchObject({
      operationId,
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
    for (const method of ['list', 'detail', 'orderDetail', 'pay', 'uploadVoucher', 'voucherContent', 'batchSuppliers', 'batchOrders', 'batchPay'] as const) expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, PurchasePayableController.prototype[method])).toEqual(['purchase-orders:payment'])
  })
  it('documents batch read and atomic write contracts with CSRF, idempotency and no client money or owner input', async () => {
    const document = await createOpenApiDocument(ContractModule)
    const root = '/api/purchase-order-payables/batch'
    expect(document.paths[`${root}/suppliers`].get?.operationId).toBe('purchase_payables_batch_suppliers')
    expect(document.paths[`${root}/orders`].get).toMatchObject({ operationId: 'purchase_payables_batch_orders', parameters: expect.arrayContaining([expect.objectContaining({ name: 'supplierValue', in: 'query', required: true })]) as unknown })
    expect(document.paths[`${root}/pay`].post).toMatchObject({ operationId: 'purchase_payables_batch_pay',
      parameters: expect.arrayContaining([{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } }]) as unknown,
      responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/PurchasePayableBatchResultDto' } } } } },
      'x-qianshu-contract': { errors: expect.arrayContaining([{ status: 403, codes: expect.arrayContaining(['CSRF_REJECTED']) as unknown }]) as unknown } })
    const input = { supplierValue: 'SUPPLIER', recipientAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', recipientProfileVersion: 1, paymentMethod: 'BANK_TRANSFER', items: [{ payableId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', expectedVersion: 1, voucher: { mediaAssetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' } }] }
    const options = { whitelist: true, forbidNonWhitelisted: true }
    expect(await validate(plainToInstance(PurchasePayableBatchPayDto, input), options)).toEqual([])
    for (const invalid of [{ ...input, items: [] }, { ...input, amount: '0.01' }, { ...input, ownerUserId: input.recipientAccountId }, { ...input, items: [{ ...input.items[0], expectedVersion: 0 }] }]) {
      expect((await validate(plainToInstance(PurchasePayableBatchPayDto, invalid), options)).length).toBeGreaterThan(0)
    }
  })
  it('forwards the order link to the exact order lookup without searching the list or interpreting it as a payable', async () => {
    const group = { id: 'order', items: [{ id: 'deposit', paymentType: 'DEPOSIT' }, { id: 'balance', paymentType: 'BALANCE' }] }
    const queries = { getOrder: jest.fn().mockResolvedValue(group), list: jest.fn(), getByPayableId: jest.fn() }
    const controller = new PurchasePayableController(queries as unknown as PurchasePayableQueryService, {} as PurchaseOrderMutationService, {} as PurchasePayableVoucherService)
    await expect(controller.orderDetail({ id: 'order' })).resolves.toEqual(group)
    expect(queries.getOrder).toHaveBeenCalledWith('order', expect.any(String))
    expect(queries.list).not.toHaveBeenCalled()
    expect(queries.getByPayableId).not.toHaveBeenCalled()
  })
  it('forwards detail to the exact payable lookup without consulting the outstanding list', async () => {
    const queries = { getByPayableId: jest.fn().mockResolvedValue({ id: 'order', items: [{ id: 'payable', status: 'PAID' }] }), list: jest.fn(), getOrder: jest.fn() }
    const controller = new PurchasePayableController(queries as unknown as PurchasePayableQueryService, {} as PurchaseOrderMutationService, {} as PurchasePayableVoucherService)
    await expect(controller.detail({ id: 'payable' })).resolves.toEqual({ id: 'order', items: [{ id: 'payable', status: 'PAID' }] })
    expect(queries.getByPayableId).toHaveBeenCalledWith('payable', expect.any(String))
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
    expect(schema).toMatchObject({ required: ['recipientAccountId', 'recipientProfileVersion', 'voucher', 'expectedVersion', 'paymentMethod'] })
    expect(schema).not.toHaveProperty('properties.amount')
    expect(schema).not.toHaveProperty('properties.ownerUserId')
  })
  it('validates identifiers and pagination and rejects forged amount or account owner', async () => {
    const options = { whitelist: true, forbidNonWhitelisted: true }
    expect(await validate(plainToInstance(PurchasePayablePayDto, { recipientAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', recipientProfileVersion: 1, voucher: { mediaAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, expectedVersion: 1, paymentMethod: 'BANK', remark: null }), options)).toEqual([])
    for (const field of ['amount', 'ownerUserId', 'accountOwnerType']) {
      const errors = await validate(plainToInstance(PurchasePayablePayDto, { recipientAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', recipientProfileVersion: 1, voucher: { mediaAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, expectedVersion: 1, paymentMethod: 'BANK', [field]: 'FORGED' }), options)
      expect(errors.map(error => error.property)).toContain(field)
    }
    for (const expectedVersion of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) expect((await validate(plainToInstance(PurchasePayablePayDto, { expectedVersion, paymentMethod: 'BANK' }), options)).length).toBeGreaterThan(0)
    for (const input of [{ page: 0 }, { pageSize: 201 }, { keyword: 'x'.repeat(129) }]) expect((await validate(plainToInstance(PurchasePayableListQueryDto, input), options)).length).toBeGreaterThan(0)
    expect((await validate(plainToInstance(PurchasePayableIdDto, { id: 'not-a-uuid' }), options)).length).toBeGreaterThan(0)
  })
  it('uses trusted request identity and returns the refreshed complete order group after payment', async () => {
    const queries = { list: jest.fn(), getOrder: jest.fn().mockResolvedValue({ id: 'order', items: [] }) }
    const mutations = { payPayable: jest.fn().mockResolvedValue('order') }
    const controller = new PurchasePayableController(queries as unknown as PurchasePayableQueryService, mutations as unknown as PurchaseOrderMutationService, {} as PurchasePayableVoucherService)
    const request = {}
    const date = new Date('2026-09-16')
    attachRequestAuthContext(request, { id: 'session', userId: 'finance', username: 'finance', displayName: 'Finance', mustChangePassword: false, createdAt: date, lastActivityAt: date, idleExpiresAt: date, absoluteExpiresAt: date })
    requestIdMiddleware(request, { setHeader: jest.fn() }, jest.fn())
    const input = { recipientAccountId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', recipientProfileVersion: 1, voucher: { mediaAssetId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }, expectedVersion: 1, paymentMethod: 'BANK' }
    await expect(controller.pay({ id: 'payable' }, input, 'idempotency-key', request)).resolves.toEqual({ id: 'order', items: [] })
    expect(mutations.payPayable).toHaveBeenCalledWith({ actorUserId: 'finance', requestId: expect.stringMatching(/^req_/) as unknown }, 'payable', input, 'idempotency-key')
    expect(queries.getOrder).toHaveBeenCalledWith('order', expect.any(String))
  })
})
