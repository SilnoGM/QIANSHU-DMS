import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { createOpenApiDocument } from '../../openapi/openapi-document.factory'
import { REQUIRED_PERMISSIONS_METADATA } from '../auth/decorators/auth.decorators'
import { SalesOrderPendingPurchaseController } from './sales-order-pending-purchase.controller'
import { SalesOrderPendingPurchaseQueryService } from './sales-order-pending-purchase-query.service'

@Module({
  controllers: [SalesOrderPendingPurchaseController],
  providers: [{ provide: SalesOrderPendingPurchaseQueryService, useValue: {} }],
})
class ContractModule {}

describe('SalesOrderPendingPurchaseController', () => {
  it('requires both sales read and purchase create and delegates the order ID', async () => {
    const list = jest.fn().mockResolvedValue({ items: [] })
    const controller = new SalesOrderPendingPurchaseController({ list } as unknown as SalesOrderPendingPurchaseQueryService)
    expect(new Reflector().get(REQUIRED_PERMISSIONS_METADATA, SalesOrderPendingPurchaseController.prototype.list))
      .toEqual(['sales-orders:read', 'purchase-orders:create'])
    await expect(controller.list({ salesOrderId: 'order' })).resolves.toEqual({ items: [] })
    expect(list).toHaveBeenCalledWith('order', expect.any(String))
  })

  it('publishes the read-only response and protected error contract', async () => {
    const document = await createOpenApiDocument(ContractModule)
    const operation = document.paths['/api/sales-orders/{salesOrderId}/pending-purchase-products']?.get
    expect(operation).toMatchObject({
      operationId: 'sales_orders_pending_purchase_products', security: [{ sessionCookie: [] }],
      'x-qianshu-contract': { authorization: true, privateNoStore: true, resourceLocator: true,
        errors: expect.arrayContaining([{ status: 404, codes: ['SALES_ORDER_NOT_FOUND'] }]) as unknown },
    })
    expect(operation?.responses).toHaveProperty('200')
    expect(document.components?.schemas?.SalesOrderPendingPurchaseProductsDto).toMatchObject({
      required: ['items'], properties: { items: { type: 'array', items: { $ref: '#/components/schemas/SalesOrderPendingPurchaseProductDto' } } },
    })
  })
})
