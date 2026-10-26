import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../../auth/decorators/auth.decorators'
import { PurchasePaymentController } from './purchase-payment.controller'
import { PurchasePaymentQueryService } from './purchase-payment-query.service'

@Module({
  controllers: [PurchasePaymentController],
  providers: [{ provide: PurchasePaymentQueryService, useValue: {} }],
})
class ContractModule {}

describe('PurchasePaymentController', () => {
  it('requires the finance payment permission', () => {
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      PurchasePaymentController.prototype.list,
    )).toEqual(['purchase-orders:payment'])
  })

  it('documents the flat payment record list contract', async () => {
    const document = await createOpenApiDocument(ContractModule)
    expect(document.paths['/api/purchase-order-payments'].get).toMatchObject({
      operationId: 'purchase_payments_list',
      responses: {
        200: {
          headers: { 'X-Request-Id': expect.any(Object) as unknown },
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PurchasePaymentRecordPageDto' },
            },
          },
        },
        401: expect.any(Object) as unknown,
        403: expect.any(Object) as unknown,
        422: expect.any(Object) as unknown,
      },
      'x-qianshu-contract': {
        errors: expect.arrayContaining([
          { status: 403, codes: ['FORBIDDEN', 'PASSWORD_CHANGE_REQUIRED'] },
          { status: 422, codes: ['VALIDATION_FAILED'] },
        ]) as unknown,
      },
    })
  })

  it('forwards the query and actor to the read service', async () => {
    const queries = {
      list: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    }
    const controller = new PurchasePaymentController(
      queries as unknown as PurchasePaymentQueryService,
    )
    await expect(controller.list({ page: 1, pageSize: 20 }, 'actor-id'))
      .resolves.toEqual({ items: [], total: 0, page: 1, pageSize: 20 })
    expect(queries.list).toHaveBeenCalledWith(
      { page: 1, pageSize: 20 },
      'actor-id',
    )
  })
})
