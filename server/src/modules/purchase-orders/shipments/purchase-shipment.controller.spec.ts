import { Module } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { createOpenApiDocument } from '../../../openapi/openapi-document.factory'
import { requestIdMiddleware } from '../../../infrastructure/http/request-id.middleware'
import { attachRequestAuthContext } from '../../auth/auth-context'
import { REQUIRED_PERMISSIONS_METADATA } from '../../auth/decorators/auth.decorators'
import { PurchaseShipmentController } from './purchase-shipment.controller'
import { PurchaseShipmentDeliveryService } from './purchase-shipment-delivery.service'
import { PurchaseShipmentQueryService } from './purchase-shipment-query.service'
import { PurchaseShipmentFilterDto, PurchaseShipmentIdParamDto, PurchaseShipmentListQueryDto } from './purchase-shipment.dto'

@Module({ controllers: [PurchaseShipmentController], providers: [
  { provide: PurchaseShipmentQueryService, useValue: {} },
  { provide: PurchaseShipmentDeliveryService, useValue: {} },
] })
class ShipmentContractModule {}

describe('PurchaseShipmentController contract', () => {
  it('requires read permission on queries and update permission on delivery', () => {
    const reflector = new Reflector()
    for (const method of ['list', 'statusCounts', 'detail'] as const) {
      expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, PurchaseShipmentController.prototype[method])).toEqual(['purchase-orders:read'])
    }
    expect(reflector.get(REQUIRED_PERMISSIONS_METADATA, PurchaseShipmentController.prototype.deliver)).toEqual(['purchase-orders:update'])
  })

  it('delegates read operations and the delivery command', async () => {
    const service = { list: jest.fn().mockResolvedValue({ items: [] }), statusCounts: jest.fn().mockResolvedValue({ items: [] }), getById: jest.fn().mockResolvedValue({ id: 'part' }) }
    const deliveries = { deliver: jest.fn().mockResolvedValue({ shipment: { id: 'part' }, salesOrderSigned: false, remainingShipmentCount: 0, salesOrderReceiptRequired: false }) }
    const controller = new PurchaseShipmentController(service as unknown as PurchaseShipmentQueryService, deliveries as unknown as PurchaseShipmentDeliveryService)
    const request = {}
    requestIdMiddleware(request, { setHeader: jest.fn() }, () => {})
    attachRequestAuthContext(request, {
      id: 'session-1',
      userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      username: 'tester',
      displayName: '测试',
      mustChangePassword: false,
      createdAt: new Date('2026-10-21T00:00:00.000Z'),
      lastActivityAt: new Date('2026-10-21T00:00:00.000Z'),
      idleExpiresAt: new Date('2026-10-22T00:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-11-21T00:00:00.000Z'),
    })
    await controller.list({ view: 'ALL' }); await controller.statusCounts({ supplierSource: 'CUSTOM_TEXT' }); await controller.detail({ partId: 'part' }); await controller.deliver({ partId: 'part' }, { remark: '已签收' }, request)
    expect(service.list).toHaveBeenCalledWith({ view: 'ALL' }, expect.any(String))
    expect(service.statusCounts).toHaveBeenCalledWith({ supplierSource: 'CUSTOM_TEXT' }, expect.any(String))
    expect(service.getById).toHaveBeenCalledWith('part', expect.any(String))
    expect(deliveries.deliver).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }), 'part', { remark: '已签收' })
  })

  it.each([
    { view: 'ACTIVE' }, { page: '0' }, { pageSize: '101' }, { createdByUserId: 'bad' },
    { supplierSource: 'OTHER' }, { keyword: 'x'.repeat(129) }, { purchaseType: 'OTHER' },
    { orderDateFrom: '2026/09/14' },
  ])('rejects invalid filters %j at the protocol boundary', async value => {
    expect((await validate(plainToInstance(PurchaseShipmentListQueryDto, value))).length).toBeGreaterThan(0)
  })

  it('transforms numeric pagination and rejects view/pagination fields on counts', async () => {
    const query = plainToInstance(PurchaseShipmentListQueryDto, { view: 'SHIPPED', page: '2', pageSize: '10' })
    expect(await validate(query)).toEqual([])
    expect(query).toMatchObject({ page: 2, pageSize: 10 })
    expect((await validate(plainToInstance(PurchaseShipmentFilterDto, { view: 'ALL', page: '2' }), { whitelist: true, forbidNonWhitelisted: true })).map(error => error.property)).toEqual(['view', 'page'])
    expect((await validate(plainToInstance(PurchaseShipmentIdParamDto, { partId: 'bad' }))).map(error => error.property)).toEqual(['partId'])
  })

  it('documents stable operations, authenticated private responses and exact schemas', async () => {
    const document = await createOpenApiDocument(ShipmentContractModule)
    for (const [path, operationId] of [
      ['/api/purchase-order-parts', 'purchase_shipments_list'],
      ['/api/purchase-order-parts/status-counts', 'purchase_shipments_status_counts'],
      ['/api/purchase-order-parts/{partId}', 'purchase_shipments_detail'],
    ]) {
      expect(document.paths[path].get).toMatchObject({ operationId, responses: { 200: { headers: { 'X-Request-Id': expect.any(Object) as unknown } }, 401: expect.any(Object) as unknown, 403: expect.any(Object) as unknown, 422: expect.any(Object) as unknown } })
    }
    expect(document.paths['/api/purchase-order-parts/{partId}'].get?.responses).toHaveProperty('404')
    expect(document.paths['/api/purchase-order-parts/{partId}/deliver']?.post).toMatchObject({ operationId: 'purchase_shipments_deliver', responses: { 200: expect.any(Object) as unknown, 401: expect.any(Object) as unknown, 403: expect.any(Object) as unknown, 404: expect.any(Object) as unknown, 409: expect.any(Object) as unknown, 422: expect.any(Object) as unknown } })
    for (const schema of ['PurchaseShipmentListItemDto', 'PurchaseShipmentDetailDto']) {
      expect(document.components?.schemas?.[schema]).toMatchObject({
        required: expect.arrayContaining(['shipmentNo', 'warehouseReceivedAt', 'warehouseReceivedById', 'warehouseRecordedAt', 'warehouseRemark', 'warehouseReceivedBy', 'loadedAt', 'loadedBy', 'loadedRecordedAt', 'deliveredAt', 'deliveredBy', 'deliveredRecordedAt', 'deliveryRemark']) as unknown,
        properties: { shipmentNo: { type: 'string', nullable: true, maxLength: 64 }, warehouseReceivedAt: { type: 'string', format: 'date-time', nullable: true }, loadedAt: { type: 'string', format: 'date-time', nullable: true }, deliveredAt: { type: 'string', format: 'date-time', nullable: true } },
      })
    }
    expect(document.components?.schemas?.PurchaseShipmentDetailDto).toMatchObject({ properties: { items: { type: 'array' }, purchaseOrder: expect.any(Object) as unknown, shippedAt: { nullable: true }, viewStatus: { enum: ['PENDING_REVIEW', 'AWAITING_SHIPMENT', 'SHIPPED', 'WAREHOUSE_RECEIVED', 'CONTAINER_LOADED', 'DELIVERED', 'CANCELLED'] } } })
    expect(document.components?.schemas?.PurchaseShipmentStatusCountsDto).toMatchObject({ properties: { buyerOptions: { type: 'array' } } })
  })
})
