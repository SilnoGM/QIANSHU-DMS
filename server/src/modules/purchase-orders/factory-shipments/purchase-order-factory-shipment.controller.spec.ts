import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import {
  requestIdMiddleware,
} from '../../../infrastructure/http/request-id.middleware'
import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import { attachRequestAuthContext } from '../../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../../auth/decorators/auth.decorators'
import {
  PurchaseOrderFactoryShipmentController,
  SalesOrderFactoryShipmentController,
} from './purchase-order-factory-shipment.controller'
import { PurchaseOrderFactoryShipmentQueryService } from './purchase-order-factory-shipment-query.service'
import { PurchaseOrderFactoryShipmentService } from './purchase-order-factory-shipment.service'

const ACTOR_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const PURCHASE_ORDER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const SALES_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function request(): object {
  const value = {}
  requestIdMiddleware(value, { setHeader: jest.fn() }, jest.fn())
  attachRequestAuthContext(value, {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    userId: ACTOR_ID,
    username: 'operator',
    displayName: '业务员',
    mustChangePassword: false,
    createdAt: new Date('2026-09-04T00:00:00.000Z'),
    lastActivityAt: new Date('2026-09-04T00:00:00.000Z'),
    idleExpiresAt: new Date('2026-09-04T01:00:00.000Z'),
    absoluteExpiresAt: new Date('2026-10-04T00:00:00.000Z'),
  })
  return value
}

const shipmentResult = {
  purchaseOrders: [],
  changedPurchaseOrderCount: 0,
  alreadySatisfiedCount: 0,
  remainingPendingShipmentCount: 0,
  salesOrder: null,
}

@Module({
  controllers: [
    PurchaseOrderFactoryShipmentController,
    SalesOrderFactoryShipmentController,
  ],
  providers: [{
    provide: PurchaseOrderFactoryShipmentService,
    useValue: { shipPurchaseOrder: jest.fn(), shipSalesOrder: jest.fn() },
  }, {
    provide: PurchaseOrderFactoryShipmentQueryService,
    useValue: { getSalesOrderContext: jest.fn() },
  }],
})
class FactoryShipmentContractModule {}

describe('factory shipment controllers', () => {
  it('declares the cross-domain permission combinations', () => {
    const reflector = new Reflector()
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      PurchaseOrderFactoryShipmentController.prototype.ship,
    )).toEqual(['purchase-orders:update'])
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      SalesOrderFactoryShipmentController.prototype.context,
    )).toEqual(['sales-orders:read', 'purchase-orders:read'])
    expect(reflector.get(
      REQUIRED_PERMISSIONS_METADATA,
      SalesOrderFactoryShipmentController.prototype.ship,
    )).toEqual(['sales-orders:update', 'purchase-orders:update'])
  })

  it('delegates purchase and sales shipment intents with trusted context', async () => {
    const service = {
      shipPurchaseOrder: jest.fn().mockResolvedValue(shipmentResult),
      shipSalesOrder: jest.fn().mockResolvedValue(shipmentResult),
    }
    const query = { getSalesOrderContext: jest.fn().mockResolvedValue({}) }
    const purchaseController = new PurchaseOrderFactoryShipmentController(
      service as unknown as PurchaseOrderFactoryShipmentService,
    )
    const salesController = new SalesOrderFactoryShipmentController(
      query as unknown as PurchaseOrderFactoryShipmentQueryService,
      service as unknown as PurchaseOrderFactoryShipmentService,
    )
    const authenticated = request()

    await purchaseController.ship(
      { purchaseOrderId: PURCHASE_ORDER_ID },
      { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 2 },
      authenticated,
    )
    await salesController.context({ salesOrderId: SALES_ORDER_ID })
    await salesController.ship(
      { salesOrderId: SALES_ORDER_ID },
      {
        mode: 'SELECTED',
        targets: [{ purchaseOrderId: PURCHASE_ORDER_ID, partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 2 }],
      },
      authenticated,
    )

    expect(service.shipPurchaseOrder).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      PURCHASE_ORDER_ID,
      { partIds: [PURCHASE_ORDER_ID], destinationWarehouses: [PURCHASE_ORDER_ID].map(partId => ({ partId, warehouseValue: 'CN-A' })), expectedVersion: 2 },
    )
    expect(query.getSalesOrderContext).toHaveBeenCalledWith(SALES_ORDER_ID)
    expect(service.shipSalesOrder).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: ACTOR_ID }),
      SALES_ORDER_ID,
      expect.objectContaining({ mode: 'SELECTED' }),
    )
  })

  it('publishes the three approved OpenAPI operations', async () => {
    const document = await createOpenApiDocument(FactoryShipmentContractModule)
    const paths = document.paths
    expect(paths['/api/purchase-orders/{purchaseOrderId}/factory-shipments']?.post)
      .toMatchObject({ operationId: 'purchase_orders_factory_shipment' })
    expect(paths['/api/sales-orders/{salesOrderId}/factory-shipment-context']?.get)
      .toMatchObject({ operationId: 'sales_orders_factory_shipment_context' })
    expect(paths['/api/sales-orders/{salesOrderId}/factory-shipments']?.post)
      .toMatchObject({ operationId: 'sales_orders_factory_shipment' })
    const productPreviewSchema = JSON.stringify(
      document.components?.schemas?.FactoryShipmentProductPreviewDto,
    )
    expect(productPreviewSchema).toContain('"quantity":{"type":"integer","minimum":1}')
    expect(productPreviewSchema).toContain('"required":["lineId","productName","quantity","mainImage"]')
  })
})
